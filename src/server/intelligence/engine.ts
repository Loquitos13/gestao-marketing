import type { Client, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDays, fromDate, todayInTz } from "@/lib/dates";
import { dataUntil, loadClientContext } from "@/server/queries/context";
import { queryPaid, type PaidResultRow } from "@/server/queries/paid";
import { searchByKey } from "@/server/queries/seo";
import { webByKey, webTotals } from "@/server/queries/web";
import { loadBudgets } from "@/server/queries/budget";
import { loadEntities } from "@/server/queries/entities";
import { runRules, type EntityPerf, type PerfWindow, type RuleInput } from "./rules";

const PAID_WINDOW = 14;
const SEO_WINDOW = 28;

const win = (r: PaidResultRow | undefined): PerfWindow => ({
  impressions: r?.totals.impressions ?? 0,
  clicks: r?.totals.clicks ?? 0,
  cost: r?.totals.cost ?? 0,
  conversions: r?.totals.conversions ?? null,
  conversionValue: r?.totals.conversionValue ?? null,
  reach: r?.totals.reach ?? null,
  lostIsBudget: r?.totals.searchLostIsBudget ?? null,
  impressionShare: r?.totals.searchImpressionShare ?? null,
});

export async function buildRuleInput(client: Client, now = new Date()): Promise<RuleInput> {
  const ctx = await loadClientContext(client);
  const yesterday = addDays(todayInTz(client.timezone, now), -1);
  const asOf = dataUntil(ctx, ctx.sources.map((s) => s.platform), yesterday);
  const cur = { start: addDays(asOf, -(PAID_WINDOW - 1)), end: asOf };
  const prev = { start: addDays(cur.start, -PAID_WINDOW), end: addDays(cur.start, -1) };
  const seoCur = { start: addDays(asOf, -(SEO_WINDOW - 1)), end: asOf };
  const seoPrev = { start: addDays(seoCur.start, -SEO_WINDOW), end: addDays(seoCur.start, -1) };
  const base = { clientId: client.id, clientCurrency: client.currency, platforms: ["GOOGLE_ADS", "META_ADS"] as const };

  const [entities, cC, cP, aC, aP, queries, pages, landing, site, budgets, goals] = await Promise.all([
    loadEntities(client.id),
    queryPaid({ ...base, platforms: [...base.platforms], ...cur, groupBy: "campaign" }),
    queryPaid({ ...base, platforms: [...base.platforms], ...prev, groupBy: "campaign" }),
    queryPaid({ ...base, platforms: [...base.platforms], ...cur, groupBy: "ad" }),
    queryPaid({ ...base, platforms: [...base.platforms], ...prev, groupBy: "ad" }),
    ctx.has.SEARCH_CONSOLE ? searchByKey(client.id, "QUERY", seoCur, seoPrev, 500) : [],
    ctx.has.SEARCH_CONSOLE ? searchByKey(client.id, "PAGE", seoCur, seoPrev, 500) : [],
    ctx.has.GA4 ? webByKey(client.id, "LANDING_PAGE", seoCur.start, seoCur.end) : [],
    ctx.has.GA4 ? webTotals(client.id, seoCur.start, seoCur.end) : null,
    loadBudgets(ctx, todayInTz(client.timezone, now)),
    prisma.goal.findMany({ where: { clientId: client.id, periodStart: { lte: new Date() }, periodEnd: { gte: new Date() } } }),
  ]);

  const goal = (m: string) => {
    const g = goals.find((x) => x.metric === m);
    return g ? Number(g.target) : undefined;
  };
  const campaigns: EntityPerf[] = cC.rows.map((r) => {
    const info = entities.campaigns.get(r.key);
    return { id: r.key, name: info?.name ?? r.key, platform: r.platform!, dailyBudget: info?.dailyBudget, cur: win(r), prev: win(cP.rows.find((p) => p.key === r.key)) };
  });
  const ads: EntityPerf[] = aC.rows
    .filter((r) => r.key)
    .map((r) => {
      const info = entities.ads.get(r.key);
      return { id: r.key, name: info?.name ?? r.key, platform: r.platform!, campaignName: info?.campaignName, cur: win(r), prev: win(aP.rows.find((p) => p.key === r.key)) };
    });

  return {
    fmt: ctx.fmt,
    windowLabel: `últimos ${PAID_WINDOW} dias vs. ${PAID_WINDOW} dias anteriores`,
    goals: { cpaMax: goal("CPA_MAX"), cplMax: goal("CPL_MAX"), roasMin: goal("ROAS_MIN"), ctrMin: goal("CTR_MIN") },
    campaigns,
    ads,
    landingPages: landing.map((l) => ({ key: l.key, sessions: l.sessions, keyEvents: l.keyEvents })),
    siteKeyEventRate: site?.keyEventRate ?? null,
    queries: queries.map((q) => ({ key: q.key, cur: q.current, prev: q.previous })),
    pages: pages.map((p) => ({ key: p.key, curClicks: p.current.clicks, prevClicks: p.previous.clicks })),
    pacing: budgets.budgets
      .filter((b) => b.periodStart <= asOf && b.periodEnd >= asOf)
      .map((b) => ({ scope: b.scope, platform: b.platform, amount: b.pacing.amount, projection: b.pacing.projection, spent: b.pacing.spent, remainingDays: b.pacing.remainingDays })),
  };
}

/** Executa as regras e guarda as recomendações. Mantém o estado (aprovada/descartada) de recomendações existentes. */
export async function refreshRecommendations(client: Client, now = new Date()) {
  const input = await buildRuleInput(client, now);
  const drafts = runRules(input);
  const month = fromDate(now).slice(0, 7);
  let created = 0;
  for (const d of drafts) {
    const fingerprint = `${d.fingerprint}:${month}`;
    const existing = await prisma.recommendation.findUnique({ where: { clientId_fingerprint: { clientId: client.id, fingerprint } } });
    const data = {
      type: d.type,
      source: d.source,
      platform: d.platform,
      entityLevel: d.entityLevel,
      entityId: d.entityId,
      entityName: d.entityName,
      title: d.title,
      explanation: d.explanation,
      suggestedAction: d.suggestedAction,
      priority: d.priority,
      confidence: d.confidence,
      impactEstimate: d.impactEstimate,
      evidence: d.evidence as Prisma.InputJsonValue,
    };
    if (existing) await prisma.recommendation.update({ where: { id: existing.id }, data });
    else {
      await prisma.recommendation.create({ data: { ...data, clientId: client.id, fingerprint, detectedAt: now } });
      created++;
    }
  }
  return { evaluated: drafts.length, created };
}
