import { Prisma, type Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toDate, type ISODate } from "@/lib/dates";
import { aggregateAdRows, deriveAd, type AdRow, type AdTotals, type DerivedAdMetrics } from "@/server/metrics/aggregate";
import { convertAmount, loadRates, type RateTable } from "./fx";

export type PaidGroupBy = "total" | "day" | "week" | "month" | "campaign" | "adGroup" | "ad" | "platform";

export interface PaidQuery {
  clientId: string;
  clientCurrency: string;
  platforms: Platform[];
  start: ISODate;
  end: ISODate;
  groupBy: PaidGroupBy;
  campaignIds?: string[] | null;
  device?: string | null;
  country?: string | null;
}

export interface PaidResultRow {
  key: string;
  platform?: Platform;
  campaignExternalId?: string;
  adGroupExternalId?: string;
  totals: AdTotals;
  derived: DerivedAdMetrics;
}

export interface PaidResult {
  rows: PaidResultRow[];
  warnings: string[];
  /** true quando o filtro de dispositivo/país força o uso de repartições (menos métricas). */
  breakdownMode: boolean;
  /** Plataformas com dados excluídos por falta de taxa de câmbio (os totais ficam incompletos). */
  excludedPlatforms: Platform[];
}

interface RawRow {
  bucket: string;
  platform: Platform;
  campaign: string;
  adgroup: string;
  currency: string;
  impressions: number;
  clicks: number;
  cost: number;
  reach: number | null;
  reach_rows: number;
  link_clicks: number | null;
  lpv: number | null;
  conversions: number | null;
  conversion_value: number | null;
  all_conversions: number | null;
  all_conversion_value: number | null;
  leads: number | null;
  lead_cost: number | null;
  purchases: number | null;
  purchase_value: number | null;
  interactions: number | null;
  video_views: number | null;
  thruplays: number | null;
  engagements: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  is_w: number | null;
  lost_b_w: number | null;
  lost_r_w: number | null;
  eligible: number | null;
}

function bucketSql(groupBy: PaidGroupBy, levelAd: boolean): Prisma.Sql {
  switch (groupBy) {
    case "day":
      return Prisma.sql`to_char(date, 'YYYY-MM-DD')`;
    case "week":
      return Prisma.sql`to_char(date_trunc('week', date), 'YYYY-MM-DD')`;
    case "month":
      return Prisma.sql`to_char(date_trunc('month', date), 'YYYY-MM-DD')`;
    case "campaign":
      return Prisma.sql`"campaignExternalId"`;
    case "adGroup":
      return Prisma.sql`"adGroupExternalId"`;
    case "ad":
      return levelAd ? Prisma.sql`"adExternalId"` : Prisma.sql`"campaignExternalId"`;
    case "platform":
      return Prisma.sql`platform::text`;
    default:
      return Prisma.sql`'total'`;
  }
}

/**
 * Consulta de métricas pagas.
 *  - Totais/séries usam SEMPRE o nível CAMPAIGN (fonte de verdade; inclui campanhas sem nível de anúncio, ex.: PMax).
 *  - groupBy "ad"/"adGroup" usa o nível AD.
 *  - Filtro de dispositivo/país usa a tabela de repartições (apenas métricas base).
 */
export async function queryPaid(q: PaidQuery, rates?: RateTable): Promise<PaidResult> {
  if (q.platforms.length === 0) return { rows: [], warnings: [], breakdownMode: false, excludedPlatforms: [] };
  const levelAd = q.groupBy === "ad" || q.groupBy === "adGroup";
  const bucket = bucketSql(q.groupBy, levelAd);
  const start = toDate(q.start);
  const end = toDate(q.end);
  const platforms = Prisma.join(q.platforms.map((p) => Prisma.sql`${p}::"Platform"`));
  const campFilter = q.campaignIds?.length ? Prisma.sql`AND "campaignExternalId" IN (${Prisma.join(q.campaignIds)})` : Prisma.empty;
  const breakdownMode = Boolean(q.device || q.country) && !levelAd;

  let raw: RawRow[];
  if (breakdownMode) {
    const dim = q.device ? "DEVICE" : "COUNTRY";
    const val = (q.device ?? q.country)!;
    raw = await prisma.$queryRaw<RawRow[]>`
      SELECT ${bucket} AS bucket, platform, MIN("campaignExternalId") AS campaign, '' AS adgroup, currency,
        SUM(impressions)::float8 AS impressions, SUM(clicks)::float8 AS clicks, SUM(cost)::float8 AS cost,
        NULL::float8 AS reach, 0 AS reach_rows, NULL::float8 AS link_clicks, NULL::float8 AS lpv,
        SUM(conversions)::float8 AS conversions, SUM("conversionValue")::float8 AS conversion_value,
        NULL::float8 AS all_conversions, NULL::float8 AS all_conversion_value,
        SUM(leads)::float8 AS leads, SUM(CASE WHEN leads IS NOT NULL THEN cost END)::float8 AS lead_cost,
        NULL::float8 AS purchases, NULL::float8 AS purchase_value, NULL::float8 AS interactions,
        NULL::float8 AS video_views, NULL::float8 AS thruplays, NULL::float8 AS engagements, NULL::float8 AS reactions,
        NULL::float8 AS comments, NULL::float8 AS shares, NULL::float8 AS is_w, NULL::float8 AS lost_b_w, NULL::float8 AS lost_r_w, NULL::float8 AS eligible
      FROM "CampaignBreakdownDaily"
      WHERE "clientId" = ${q.clientId} AND platform IN (${platforms}) AND date BETWEEN ${start} AND ${end}
        AND dimension = ${dim} AND value = ${val} ${campFilter}
      GROUP BY 1, platform, currency`;
  } else {
    const level = levelAd ? Prisma.sql`'AD'::"MetricLevel"` : Prisma.sql`'CAMPAIGN'::"MetricLevel"`;
    raw = await prisma.$queryRaw<RawRow[]>`
      SELECT ${bucket} AS bucket, platform, MIN("campaignExternalId") AS campaign, MIN("adGroupExternalId") AS adgroup, currency,
        SUM(impressions)::float8 AS impressions, SUM(clicks)::float8 AS clicks, SUM(cost)::float8 AS cost,
        SUM(reach)::float8 AS reach, COUNT(reach)::int AS reach_rows,
        SUM("linkClicks")::float8 AS link_clicks, SUM("landingPageViews")::float8 AS lpv,
        SUM(conversions)::float8 AS conversions, SUM("conversionValue")::float8 AS conversion_value,
        SUM("allConversions")::float8 AS all_conversions, SUM("allConversionValue")::float8 AS all_conversion_value,
        SUM(leads)::float8 AS leads, SUM(CASE WHEN leads IS NOT NULL THEN cost END)::float8 AS lead_cost,
        SUM(purchases)::float8 AS purchases, SUM("purchaseValue")::float8 AS purchase_value,
        SUM(interactions)::float8 AS interactions, SUM("videoViews")::float8 AS video_views, SUM(thruplays)::float8 AS thruplays,
        SUM(engagements)::float8 AS engagements, SUM(reactions)::float8 AS reactions, SUM(comments)::float8 AS comments, SUM(shares)::float8 AS shares,
        SUM("searchImpressionShare" * "eligibleImpressionsApprox")::float8 AS is_w,
        SUM("searchLostIsBudget" * "eligibleImpressionsApprox")::float8 AS lost_b_w,
        SUM("searchLostIsRank" * "eligibleImpressionsApprox")::float8 AS lost_r_w,
        SUM(CASE WHEN "searchImpressionShare" IS NOT NULL THEN "eligibleImpressionsApprox" END)::float8 AS eligible
      FROM "AdMetricDaily"
      WHERE "clientId" = ${q.clientId} AND platform IN (${platforms}) AND level = ${level}
        AND date BETWEEN ${start} AND ${end} ${campFilter}
      GROUP BY 1, platform, currency`;
  }

  const warnings: string[] = [];
  const excludedPlatforms = new Set<Platform>();
  const needsFx = raw.some((r) => r.currency !== q.clientCurrency);
  const fx = needsFx ? (rates ?? (await loadRates(q.end))) : null;
  const grouped = new Map<string, { row: RawRow; items: AdRow[]; reachRows: number }>();
  for (const r of raw) {
    let factor = 1;
    if (r.currency !== q.clientCurrency) {
      const conv = fx ? convertAmount(1, r.currency, q.clientCurrency, fx) : null;
      if (conv === null) {
        warnings.push(`Dados em ${r.currency} excluídos: não existe taxa de câmbio ${r.currency}→${q.clientCurrency} registada.`);
        excludedPlatforms.add(r.platform);
        continue;
      }
      factor = conv;
      warnings.push(`Valores em ${r.currency} convertidos para ${q.clientCurrency} com taxa registada (${fx!.date}).`);
    }
    const m = (v: number | null) => (v === null ? null : v * factor);
    const item: AdRow = {
      impressions: r.impressions,
      clicks: r.clicks,
      cost: r.cost * factor,
      reach: r.reach,
      linkClicks: r.link_clicks,
      landingPageViews: r.lpv,
      conversions: r.conversions,
      conversionValue: m(r.conversion_value),
      allConversions: r.all_conversions,
      allConversionValue: m(r.all_conversion_value),
      leads: r.leads,
      leadCost: m(r.lead_cost),
      purchases: r.purchases,
      purchaseValue: m(r.purchase_value),
      interactions: r.interactions,
      videoViews: r.video_views,
      thruplays: r.thruplays,
      engagements: r.engagements,
      reactions: r.reactions,
      comments: r.comments,
      shares: r.shares,
      searchImpressionShare: r.eligible ? (r.is_w ?? 0) / r.eligible : null,
      searchLostIsBudget: r.eligible ? (r.lost_b_w ?? 0) / r.eligible : null,
      searchLostIsRank: r.eligible ? (r.lost_r_w ?? 0) / r.eligible : null,
      eligibleImpressionsApprox: r.eligible,
    };
    const gkey = q.groupBy === "total" ? "total" : `${r.bucket}`;
    const g = grouped.get(gkey) ?? { row: r, items: [], reachRows: 0 };
    g.items.push(item);
    g.reachRows += r.reach_rows;
    grouped.set(gkey, g);
  }
  const rows: PaidResultRow[] = [...grouped.entries()].map(([key, g]) => {
    const totals = aggregateAdRows(g.items);
    // Cada linha SQL soma vários dias/entidades: o alcance só é exato com uma única linha diária.
    totals.reachIsApproximate = totals.reach !== null && g.reachRows > 1;
    return {
      key,
      platform: g.row.platform,
      campaignExternalId: g.row.campaign,
      adGroupExternalId: g.row.adgroup,
      totals,
      derived: deriveAd(totals),
    };
  });
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { rows, warnings: [...new Set(warnings)], breakdownMode, excludedPlatforms: [...excludedPlatforms] };
}

export function emptyTotals(): AdTotals {
  return aggregateAdRows([]);
}

export async function paidTotals(q: Omit<PaidQuery, "groupBy">) {
  const r = await queryPaid({ ...q, groupBy: "total" });
  const totals = r.rows[0]?.totals ?? emptyTotals();
  return { totals, derived: deriveAd(totals), warnings: r.warnings, breakdownMode: r.breakdownMode, excludedPlatforms: r.excludedPlatforms, hasData: r.rows.length > 0 };
}
