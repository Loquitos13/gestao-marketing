import { prisma } from "@/lib/prisma";
import { adMessaging, contentGaps, keywordGaps, speedComparison } from "@/server/competitors/analysis";
import type { SourceStatuses } from "@/server/competitors/refresh";

const DAY = 86_400_000;

/** Tudo o que a página Concorrência e as ferramentas do agente precisam, já analisado. */
export async function loadCompetitorData(clientId: string) {
  const since = new Date(Date.now() - 90 * DAY);
  const [client, competitors, ideas, pages, ads, speed, queries, adsKw] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { id: true, name: true, website: true, currency: true, competitorStatus: true, isDemo: true } }),
    prisma.competitor.findMany({ where: { clientId }, orderBy: [{ suggested: "asc" }, { name: "asc" }] }),
    prisma.keywordIdea.findMany({ where: { clientId }, orderBy: { avgMonthlySearches: "desc" }, take: 2000 }),
    prisma.competitorPage.findMany({ where: { clientId }, orderBy: { url: "asc" } }),
    prisma.competitorAd.findMany({ where: { clientId }, orderBy: [{ startDate: "desc" }], take: 300 }),
    prisma.pageSpeedResult.findMany({ where: { clientId }, orderBy: { fetchedAt: "desc" }, take: 300 }),
    prisma.searchMetricDaily.groupBy({ by: ["key"], where: { clientId, dimension: "QUERY", date: { gte: since } }, _sum: { impressions: true } }),
    prisma.adsTermDaily.findMany({ where: { clientId, kind: "KEYWORD", date: { gte: since } }, distinct: ["text"], select: { text: true } }),
  ]);
  const active = competitors.filter((c) => !c.suggested);
  const nameOf = new Map(competitors.map((c) => [c.id, c.name]));
  const brandTerms = [client.name, ...active.flatMap((c) => [c.name, c.domain?.split(".")[0] ?? ""])];

  const gaps = keywordGaps(
    ideas.map((i) => ({ keyword: i.keyword, avgMonthlySearches: i.avgMonthlySearches, lowCpc: i.lowCpc === null ? null : Number(i.lowCpc), highCpc: i.highCpc === null ? null : Number(i.highCpc), competition: i.competition, competitorName: i.competitorId ? (nameOf.get(i.competitorId) ?? null) : null })),
    queries.map((q) => ({ query: q.key, impressions: q._sum.impressions ?? 0 })),
    adsKw.map((k) => k.text),
    { brandTerms },
  );
  const clientPages = pages.filter((p) => !p.competitorId);
  const compPages = pages.filter((p) => p.competitorId).map((p) => ({ ...p, competitorName: nameOf.get(p.competitorId!) ?? "?" }));
  const content = contentGaps(compPages, clientPages, { brandTerms });

  const latest = new Map<string, (typeof speed)[number]>();
  for (const s of speed) if (!latest.has(s.url)) latest.set(s.url, s);
  const speedRows = [...latest.values()].map((s) => ({ ...s, competitorName: s.competitorId ? (nameOf.get(s.competitorId) ?? "?") : null }));

  const lastSeen = ads.reduce((m, a) => Math.max(m, a.lastSeenAt.getTime()), 0);
  const activeAds = ads.filter((a) => !a.stopDate || a.stopDate.getTime() > Date.now()).filter((a) => a.lastSeenAt.getTime() >= lastSeen - DAY);
  const adsView = activeAds.map((a) => ({ ...a, competitorName: a.competitorId ? (nameOf.get(a.competitorId) ?? a.pageName) : a.pageName }));

  return {
    client,
    status: (client.competitorStatus ?? {}) as SourceStatuses,
    competitors,
    active,
    suggested: competitors.filter((c) => c.suggested),
    ideas,
    keywordSource: ideas[0] ? { source: ideas[0].source, fetchedAt: ideas.reduce((m, i) => (i.fetchedAt > m ? i.fetchedAt : m), ideas[0].fetchedAt) } : null,
    gaps,
    pages,
    clientPages,
    compPages,
    content,
    ads: adsView,
    messaging: adMessaging(adsView),
    speedRows,
    speed: speedComparison(speedRows),
    simulated: client.isDemo,
  };
}

export type CompetitorData = Awaited<ReturnType<typeof loadCompetitorData>>;
