import { Prisma, type DataSource, type PrismaClient } from "@prisma/client";
import { toDate } from "@/lib/dates";
import type { EntityBatch, SyncResult } from "@/server/integrations/types";

/** Remove duplicados pela chave natural (a última ocorrência prevalece). */
export function dedupe<T>(rows: T[], key: (r: T) => string): T[] {
  const m = new Map<string, T>();
  for (const r of rows) m.set(key(r), r);
  return [...m.values()];
}

/** Forma canónica para comparar BD vs conector: Decimal→número, chaves de JSON ordenadas (o jsonb reordena-as). */
const canon = (v: unknown) =>
  JSON.stringify(Prisma.Decimal.isDecimal(v) ? Number(v) : (v ?? null), (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));

type Delegate = { findMany(a: object): Promise<Record<string, unknown>[]>; createManyAndReturn(a: object): Promise<{ id: string; externalId: string }[]>; update(a: object): Prisma.PrismaPromise<unknown> };
type Row = { parentId: string; externalId: string; create?: object; data: Record<string, unknown> };

/**
 * Escreve um nível (campanhas, conjuntos, criativos ou anúncios) em lote: 1 findMany das linhas da fonte,
 * 1 createManyAndReturn das novas e 1 transação só com os updates das que mudaram. Devolve externalId → id.
 */
async function syncLevel(db: PrismaClient, model: object, parentField: string, where: object, rows: Row[]) {
  const ids = new Map<string, string>();
  if (!rows.length) return ids;
  const m = model as Delegate; // os delegates do Prisma são genéricos demais para tipar aqui
  const fields = [...new Set(rows.flatMap((r) => Object.keys(r.data)))];
  const select = Object.fromEntries(["id", "externalId", parentField, ...fields].map((f) => [f, true]));
  const existing = new Map((await m.findMany({ where, select })).map((r) => [`${r[parentField]}|${r.externalId}`, r]));
  const creates: object[] = [];
  const updates: Prisma.PrismaPromise<unknown>[] = [];
  for (const r of rows) {
    const ex = existing.get(`${r.parentId}|${r.externalId}`);
    if (!ex) {
      creates.push({ [parentField]: r.parentId, externalId: r.externalId, ...r.create, ...r.data });
      continue;
    }
    ids.set(r.externalId, ex.id as string);
    // undefined não é escrito pelo Prisma, por isso também não conta como alteração
    if (fields.some((f) => r.data[f] !== undefined && canon(ex[f]) !== canon(r.data[f]))) updates.push(m.update({ where: { id: ex.id }, data: r.data }));
  }
  if (updates.length) await db.$transaction(updates);
  if (creates.length) for (const c of await m.createManyAndReturn({ data: creates, select: { id: true, externalId: true }, skipDuplicates: true })) ids.set(c.externalId, c.id);
  return ids;
}

async function writeEntities(db: PrismaClient, ds: DataSource, e: EntityBatch) {
  const src = { dataSourceId: ds.id };
  const campaignIds = await syncLevel(db, db.campaign, "dataSourceId", src, e.campaigns.map((c) => ({
    parentId: ds.id, externalId: c.externalId, create: { clientId: ds.clientId, platform: ds.platform },
    data: { name: c.name, status: c.status, objective: c.objective, campaignType: c.campaignType, biddingStrategy: c.biddingStrategy, dailyBudget: c.dailyBudget, raw: c.raw as Prisma.InputJsonValue | undefined },
  })));
  const adGroupIds = await syncLevel(db, db.adGroup, "campaignId", { campaign: src }, e.adGroups.filter((g) => campaignIds.has(g.campaignExternalId)).map((g) => ({
    parentId: campaignIds.get(g.campaignExternalId)!, externalId: g.externalId,
    data: { name: g.name, status: g.status, dailyBudget: g.dailyBudget ?? null, raw: g.raw as Prisma.InputJsonValue | undefined },
  })));
  const ads = e.ads.filter((a) => adGroupIds.has(a.adGroupExternalId));
  const creativeIds = await syncLevel(db, db.creative, "dataSourceId", src, ads.flatMap((a) => {
    if (!a.creative) return [];
    const { externalId, ...rest } = a.creative;
    return [{ parentId: ds.id, externalId, data: rest }];
  }));
  await syncLevel(db, db.ad, "adGroupId", { adGroup: { campaign: src } }, ads.map((a) => ({
    parentId: adGroupIds.get(a.adGroupExternalId)!, externalId: a.externalId,
    data: { name: a.name, status: a.status, adType: a.adType, finalUrl: a.finalUrl, headlines: a.headlines ?? [], descriptions: a.descriptions ?? [], createdTime: a.createdTime ?? null, creativeId: a.creative ? (creativeIds.get(a.creative.externalId) ?? null) : null },
  })));
}

/**
 * Escrita idempotente: para cada tabela devolvida pelo conector, substitui as linhas da fonte
 * no intervalo sincronizado (captura revisões históricas das plataformas) numa transação.
 */
export async function writeSyncResult(db: PrismaClient, ds: DataSource, range: { start: string; end: string }, r: SyncResult): Promise<number> {
  if (r.entities) await writeEntities(db, ds, r.entities);
  const between = { gte: toDate(range.start), lte: toDate(range.end) };
  const base = { clientId: ds.clientId, dataSourceId: ds.id };
  // Lock por fonte: sincronizações HISTORICAL e INCREMENTAL concorrentes colidiriam (P2002) no delete+createMany.
  const ops: Prisma.PrismaPromise<unknown>[] = [db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ds.id}))`];
  let rows = 0;
  if (r.adMetrics) {
    const data = dedupe(r.adMetrics, (m) => `${m.level}|${m.campaignExternalId}|${m.adGroupExternalId ?? ""}|${m.adExternalId ?? ""}|${m.date}`).map((m) => ({
      ...base,
      ...m,
      platform: ds.platform,
      currency: m.currency || ds.currency,
      adGroupExternalId: m.adGroupExternalId ?? "",
      adExternalId: m.adExternalId ?? "",
      date: toDate(m.date),
    }));
    ops.push(db.adMetricDaily.deleteMany({ where: { dataSourceId: ds.id, date: between } }), db.adMetricDaily.createMany({ data }));
    rows += data.length;
  }
  if (r.breakdowns) {
    const data = dedupe(r.breakdowns, (b) => `${b.campaignExternalId}|${b.date}|${b.dimension}|${b.value}`).map((b) => ({ ...base, ...b, platform: ds.platform, currency: b.currency || ds.currency, date: toDate(b.date) }));
    ops.push(db.campaignBreakdownDaily.deleteMany({ where: { dataSourceId: ds.id, date: between } }), db.campaignBreakdownDaily.createMany({ data }));
    rows += data.length;
  }
  if (r.terms) {
    const data = dedupe(r.terms, (t) => `${t.kind}|${t.adGroupExternalId}|${t.text}|${t.matchType ?? ""}|${t.date}`).map((t) => ({ ...base, ...t, matchType: t.matchType ?? "", currency: t.currency || ds.currency, date: toDate(t.date) }));
    ops.push(db.adsTermDaily.deleteMany({ where: { dataSourceId: ds.id, date: between } }), db.adsTermDaily.createMany({ data }));
    rows += data.length;
  }
  if (r.search) {
    const data = dedupe(r.search, (s) => `${s.dimension}|${s.key}|${s.date}`).map((s) => ({ ...base, ...s, date: toDate(s.date) }));
    ops.push(db.searchMetricDaily.deleteMany({ where: { dataSourceId: ds.id, date: between } }), db.searchMetricDaily.createMany({ data }));
    rows += data.length;
  }
  if (r.web) {
    const data = dedupe(r.web, (w) => `${w.dimension}|${w.key}|${w.date}`).map((w) => ({ ...base, ...w, currency: w.currency || ds.currency, date: toDate(w.date) }));
    ops.push(db.webAnalyticsDaily.deleteMany({ where: { dataSourceId: ds.id, date: between } }), db.webAnalyticsDaily.createMany({ data }));
    rows += data.length;
  }
  if (r.seoSnapshots?.length) {
    const dates = [...new Set(r.seoSnapshots.map((s) => s.snapshotDate))].map(toDate);
    ops.push(
      db.seoKeywordSnapshot.deleteMany({ where: { dataSourceId: ds.id, snapshotDate: { in: dates } } }),
      db.seoKeywordSnapshot.createMany({ data: r.seoSnapshots.map((s) => ({ ...base, ...s, snapshotDate: toDate(s.snapshotDate), isEstimate: true })) }),
    );
    rows += r.seoSnapshots.length;
  }
  if (ops.length > 1) await db.$transaction(ops);
  for (const o of r.organic ?? []) {
    const data = { ...o, metricsAsOf: new Date() };
    await db.organicContent.upsert({ where: { dataSourceId_externalId: { dataSourceId: ds.id, externalId: o.externalId } }, update: data, create: { ...data, clientId: ds.clientId, dataSourceId: ds.id } });
    rows++;
  }
  return rows;
}
