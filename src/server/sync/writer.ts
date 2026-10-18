import type { DataSource, Prisma, PrismaClient } from "@prisma/client";
import { toDate } from "@/lib/dates";
import type { EntityBatch, SyncResult } from "@/server/integrations/types";

/** Remove duplicados pela chave natural (a última ocorrência prevalece). */
export function dedupe<T>(rows: T[], key: (r: T) => string): T[] {
  const m = new Map<string, T>();
  for (const r of rows) m.set(key(r), r);
  return [...m.values()];
}

async function writeEntities(db: PrismaClient, ds: DataSource, e: EntityBatch) {
  const campaignIds = new Map<string, string>();
  for (const c of e.campaigns) {
    const data = { name: c.name, status: c.status, objective: c.objective, campaignType: c.campaignType, biddingStrategy: c.biddingStrategy, dailyBudget: c.dailyBudget, raw: c.raw as Prisma.InputJsonValue | undefined };
    const row = await db.campaign.upsert({
      where: { dataSourceId_externalId: { dataSourceId: ds.id, externalId: c.externalId } },
      update: data,
      create: { clientId: ds.clientId, dataSourceId: ds.id, platform: ds.platform, externalId: c.externalId, ...data },
    });
    campaignIds.set(c.externalId, row.id);
  }
  const adGroupIds = new Map<string, string>();
  for (const g of e.adGroups) {
    const campaignId = campaignIds.get(g.campaignExternalId);
    if (!campaignId) continue;
    const data = { name: g.name, status: g.status, dailyBudget: g.dailyBudget ?? null, raw: g.raw as Prisma.InputJsonValue | undefined };
    const row = await db.adGroup.upsert({
      where: { campaignId_externalId: { campaignId, externalId: g.externalId } },
      update: data,
      create: { campaignId, externalId: g.externalId, ...data },
    });
    adGroupIds.set(g.externalId, row.id);
  }
  for (const a of e.ads) {
    const adGroupId = adGroupIds.get(a.adGroupExternalId);
    if (!adGroupId) continue;
    let creativeId: string | null = null;
    if (a.creative) {
      const { externalId, ...rest } = a.creative;
      const cr = await db.creative.upsert({
        where: { dataSourceId_externalId: { dataSourceId: ds.id, externalId } },
        update: rest,
        create: { dataSourceId: ds.id, externalId, ...rest },
      });
      creativeId = cr.id;
    }
    const data = { name: a.name, status: a.status, adType: a.adType, finalUrl: a.finalUrl, headlines: a.headlines ?? [], descriptions: a.descriptions ?? [], createdTime: a.createdTime ?? null, creativeId };
    await db.ad.upsert({ where: { adGroupId_externalId: { adGroupId, externalId: a.externalId } }, update: data, create: { adGroupId, externalId: a.externalId, ...data } });
  }
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
