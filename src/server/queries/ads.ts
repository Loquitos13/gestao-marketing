import { Prisma, type Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { autoGranularity, toDate } from "@/lib/dates";
import { cpa, cpc, ctr, delta, roas } from "@/server/metrics/calc";
import type { ClientContext } from "./context";
import { loadEntities } from "./entities";
import type { Filters } from "./filters";
import { paidTotals, queryPaid, type PaidResultRow } from "./paid";

export interface EntityRow {
  id: string;
  name: string;
  platform: Platform;
  status: string;
  campaignName?: string;
  adGroupName?: string;
  type?: string | null;
  objective?: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  conversions: number | null;
  cpa: number | null;
  conversionValue: number | null;
  roas: number | null;
  leads: number | null;
  cpl: number | null;
  reach: number | null;
  frequency: number | null;
  linkClicks: number | null;
  linkCtr: number | null;
  videoViews: number | null;
  thruplays: number | null;
  engagements: number | null;
  searchImpressionShare: number | null;
  searchLostIsBudget: number | null;
  searchLostIsRank: number | null;
  costDeltaPct: number | null;
  costDeltaAbs: number | null;
  cpaDeltaPct: number | null;
  conversionsDeltaPct: number | null;
  conversionsDeltaAbs: number | null;
}

type EntityInfo = Pick<EntityRow, "id" | "name" | "platform" | "status" | "campaignName" | "adGroupName" | "type" | "objective">;

export function toEntityRow(r: PaidResultRow, prev: PaidResultRow | undefined, info: EntityInfo): EntityRow {
  const cost = delta(r.totals.cost, prev?.totals.cost ?? null);
  const conv = delta(r.totals.conversions, prev?.totals.conversions ?? null);
  return {
    ...info,
    ...metricsOf(r),
    costDeltaPct: cost.pct,
    costDeltaAbs: cost.abs,
    cpaDeltaPct: delta(r.derived.cpa, prev?.derived.cpa ?? null).pct,
    conversionsDeltaPct: conv.pct,
    conversionsDeltaAbs: conv.abs,
  };
}

function metricsOf(r: PaidResultRow) {
  return {
    impressions: r.totals.impressions,
    clicks: r.totals.clicks,
    cost: r.totals.cost,
    ctr: r.derived.ctr,
    cpc: r.derived.cpc,
    cpm: r.derived.cpm,
    conversions: r.totals.conversions,
    cpa: r.derived.cpa,
    conversionValue: r.totals.conversionValue,
    roas: r.derived.roas,
    leads: r.totals.leads,
    cpl: r.derived.cpl,
    reach: r.totals.reach,
    frequency: r.derived.frequency,
    linkClicks: r.totals.linkClicks,
    linkCtr: r.derived.linkCtr,
    videoViews: r.totals.videoViews,
    thruplays: r.totals.thruplays,
    engagements: r.totals.engagements,
    searchImpressionShare: r.totals.searchImpressionShare,
    searchLostIsBudget: r.totals.searchLostIsBudget,
    searchLostIsRank: r.totals.searchLostIsRank,
  };
}

export async function loadPlatformAnalytics(ctx: ClientContext, f: Filters, platforms: Platform[]) {
  const { client } = ctx;
  const base = { clientId: client.id, clientCurrency: client.currency, platforms, campaignIds: f.campaign ? [f.campaign] : null, device: f.device, country: f.country };
  const cur = f.period;
  const prev = f.compare;
  const g = autoGranularity(cur.start, cur.end);
  const [entities, tCur, tPrev, series, campCur, campPrev, adCur, adPrev, devices, countries] = await Promise.all([
    loadEntities(client.id),
    paidTotals({ ...base, start: cur.start, end: cur.end }),
    prev ? paidTotals({ ...base, start: prev.start, end: prev.end }) : null,
    queryPaid({ ...base, start: cur.start, end: cur.end, groupBy: g }),
    queryPaid({ ...base, start: cur.start, end: cur.end, groupBy: "campaign" }),
    prev ? queryPaid({ ...base, start: prev.start, end: prev.end, groupBy: "campaign" }) : null,
    queryPaid({ ...base, device: null, country: null, start: cur.start, end: cur.end, groupBy: "ad" }),
    prev ? queryPaid({ ...base, device: null, country: null, start: prev.start, end: prev.end, groupBy: "ad" }) : null,
    breakdown(client.id, platforms, "DEVICE", cur.start, cur.end, f.campaign),
    breakdown(client.id, platforms, "COUNTRY", cur.start, cur.end, f.campaign),
  ]);

  const campaigns: EntityRow[] = campCur.rows.map((r) => {
    const info = entities.campaigns.get(r.key);
    return toEntityRow(r, campPrev?.rows.find((p) => p.key === r.key), {
      id: r.key,
      name: info?.name ?? `Campanha ${r.key}`,
      platform: r.platform!,
      status: info?.status ?? "UNKNOWN",
      type: info?.campaignType,
      objective: info?.objective,
    });
  });
  const ads: EntityRow[] = adCur.rows
    .filter((r) => r.key)
    .map((r) => {
      const info = entities.ads.get(r.key);
      return toEntityRow(r, adPrev?.rows.find((p) => p.key === r.key), {
        id: r.key,
        name: info?.name ?? `Anúncio ${r.key}`,
        platform: r.platform!,
        status: info?.status ?? "UNKNOWN",
        campaignName: info?.campaignName ?? entities.campaigns.get(r.campaignExternalId ?? "")?.name,
        adGroupName: info?.adGroupName,
        type: info?.adType ?? info?.creative?.format,
      });
    });

  return {
    granularity: g,
    totals: tCur,
    previous: tPrev,
    series: series.rows.map((r) => ({
      date: r.key,
      cost: r.totals.cost,
      clicks: r.totals.clicks,
      impressions: r.totals.impressions,
      conversions: r.totals.conversions ?? 0,
      value: r.totals.conversionValue ?? 0,
      ctr: r.derived.ctr,
      cpa: r.derived.cpa,
      frequency: r.derived.frequency,
    })),
    campaigns,
    ads,
    adInfo: Object.fromEntries([...entities.ads.entries()].filter(([, a]) => platforms.includes(a.platform))),
    campaignOptions: [...entities.campaigns.values()].filter((c) => platforms.includes(c.platform)).map((c) => ({ id: c.externalId, name: c.name })),
    devices,
    countries,
    warnings: [...tCur.warnings, ...(tCur.breakdownMode ? ["Filtro de dispositivo/país ativo: só estão disponíveis impressões, cliques, investimento, conversões, valor e leads."] : [])],
    completeness: ctx.completenessWarning(platforms, cur.end),
  };
}

async function breakdown(clientId: string, platforms: Platform[], dimension: string, start: string, end: string, campaign: string | null) {
  if (!platforms.length) return [];
  const rows = await prisma.$queryRaw<{ value: string; i: number; c: number; cost: number; conv: number | null; val: number | null }[]>`
    SELECT value, SUM(impressions)::float8 i, SUM(clicks)::float8 c, SUM(cost)::float8 cost, SUM(conversions)::float8 conv, SUM("conversionValue")::float8 val
    FROM "CampaignBreakdownDaily"
    WHERE "clientId" = ${clientId} AND platform IN (${Prisma.join(platforms.map((p) => Prisma.sql`${p}::"Platform"`))})
      AND dimension = ${dimension} AND date BETWEEN ${toDate(start)} AND ${toDate(end)}
      ${campaign ? Prisma.sql`AND "campaignExternalId" = ${campaign}` : Prisma.empty}
    GROUP BY value ORDER BY 4 DESC`;
  return rows.map((r) => ({
    value: r.value,
    impressions: r.i,
    clicks: r.c,
    cost: r.cost,
    conversions: r.conv,
    conversionValue: r.val,
    ctr: ctr(r.c, r.i),
    cpc: cpc(r.cost, r.c),
    cpa: cpa(r.cost, r.conv),
    roas: roas(r.val, r.cost),
  }));
}

export async function loadSearchTerms(clientId: string, kind: "KEYWORD" | "SEARCH_TERM", start: string, end: string, campaign: string | null) {
  const rows = await prisma.$queryRaw<{ text: string; match: string; campaign: string; i: number; c: number; cost: number; conv: number | null; val: number | null }[]>`
    SELECT text, "matchType" match, MIN("campaignExternalId") campaign, SUM(impressions)::float8 i, SUM(clicks)::float8 c, SUM(cost)::float8 cost,
      SUM(conversions)::float8 conv, SUM("conversionValue")::float8 val
    FROM "AdsTermDaily"
    WHERE "clientId" = ${clientId} AND kind = ${kind} AND date BETWEEN ${toDate(start)} AND ${toDate(end)}
      ${campaign ? Prisma.sql`AND "campaignExternalId" = ${campaign}` : Prisma.empty}
    GROUP BY text, "matchType" ORDER BY 6 DESC LIMIT 500`;
  return rows.map((r) => ({
    text: r.text,
    matchType: r.match || null,
    campaignExternalId: r.campaign,
    impressions: r.i,
    clicks: r.c,
    cost: r.cost,
    conversions: r.conv,
    conversionValue: r.val,
    ctr: ctr(r.c, r.i),
    cpc: cpc(r.cost, r.c),
    cpa: cpa(r.cost, r.conv),
    roas: roas(r.val, r.cost),
  }));
}
