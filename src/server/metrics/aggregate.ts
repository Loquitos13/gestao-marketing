import { cpa, cpc, cpm, conversionRate, ctr, frequency, roas, safeDiv } from "./calc";

/** Linha base de métricas pagas já convertida para number (null = não disponível). */
export interface AdRow {
  impressions: number;
  clicks: number;
  cost: number;
  reach?: number | null;
  linkClicks?: number | null;
  landingPageViews?: number | null;
  conversions?: number | null;
  conversionValue?: number | null;
  allConversions?: number | null;
  allConversionValue?: number | null;
  leads?: number | null;
  /** Custo das linhas que reportam leads (omisso = custo da própria linha quando tem leads). */
  leadCost?: number | null;
  purchases?: number | null;
  purchaseValue?: number | null;
  interactions?: number | null;
  videoViews?: number | null;
  thruplays?: number | null;
  engagements?: number | null;
  reactions?: number | null;
  comments?: number | null;
  shares?: number | null;
  searchImpressionShare?: number | null;
  searchLostIsBudget?: number | null;
  searchLostIsRank?: number | null;
  eligibleImpressionsApprox?: number | null;
}

const NULLABLE_SUMS = [
  "linkClicks",
  "landingPageViews",
  "conversions",
  "conversionValue",
  "allConversions",
  "allConversionValue",
  "leads",
  "purchases",
  "purchaseValue",
  "interactions",
  "videoViews",
  "thruplays",
  "engagements",
  "reactions",
  "comments",
  "shares",
] as const;

export interface AdTotals {
  impressions: number;
  clicks: number;
  cost: number;
  /** Soma de alcances diários: limite superior do alcance real (não deduplicado). */
  reach: number | null;
  reachIsApproximate: boolean;
  linkClicks: number | null;
  landingPageViews: number | null;
  conversions: number | null;
  conversionValue: number | null;
  allConversions: number | null;
  allConversionValue: number | null;
  leads: number | null;
  /** Só o custo das linhas com leads: o CPL não deve dividir custo Google por leads Meta. */
  leadCost: number | null;
  purchases: number | null;
  purchaseValue: number | null;
  interactions: number | null;
  videoViews: number | null;
  thruplays: number | null;
  engagements: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  searchImpressionShare: number | null;
  searchLostIsBudget: number | null;
  searchLostIsRank: number | null;
  rows: number;
}

/**
 * Soma métricas aditivas. Uma métrica opcional só é somada se pelo menos uma linha a tiver;
 * caso contrário fica null. Quotas de impressões são médias ponderadas pelas impressões elegíveis.
 */
export function aggregateAdRows(rows: AdRow[]): AdTotals {
  const t: AdTotals = {
    impressions: 0,
    clicks: 0,
    cost: 0,
    reach: null,
    reachIsApproximate: false,
    linkClicks: null,
    landingPageViews: null,
    conversions: null,
    conversionValue: null,
    allConversions: null,
    allConversionValue: null,
    leads: null,
    leadCost: null,
    purchases: null,
    purchaseValue: null,
    interactions: null,
    videoViews: null,
    thruplays: null,
    engagements: null,
    reactions: null,
    comments: null,
    shares: null,
    searchImpressionShare: null,
    searchLostIsBudget: null,
    searchLostIsRank: null,
    rows: rows.length,
  };
  let eligible = 0;
  let isW = 0;
  let lostBW = 0;
  let lostRW = 0;
  let reachRows = 0;
  for (const r of rows) {
    t.impressions += r.impressions;
    t.clicks += r.clicks;
    t.cost += r.cost;
    if (r.reach !== null && r.reach !== undefined) {
      t.reach = (t.reach ?? 0) + r.reach;
      reachRows++;
    }
    for (const k of NULLABLE_SUMS) {
      const v = r[k];
      if (v !== null && v !== undefined) t[k] = (t[k] ?? 0) + v;
    }
    if (r.leads !== null && r.leads !== undefined) t.leadCost = (t.leadCost ?? 0) + (r.leadCost ?? r.cost);
    if (r.searchImpressionShare !== null && r.searchImpressionShare !== undefined && r.eligibleImpressionsApprox) {
      eligible += r.eligibleImpressionsApprox;
      isW += r.searchImpressionShare * r.eligibleImpressionsApprox;
      lostBW += (r.searchLostIsBudget ?? 0) * r.eligibleImpressionsApprox;
      lostRW += (r.searchLostIsRank ?? 0) * r.eligibleImpressionsApprox;
    }
  }
  t.reachIsApproximate = reachRows > 1;
  if (eligible > 0) {
    t.searchImpressionShare = isW / eligible;
    t.searchLostIsBudget = lostBW / eligible;
    t.searchLostIsRank = lostRW / eligible;
  }
  t.cost = Math.round(t.cost * 10000) / 10000;
  return t;
}

export interface DerivedAdMetrics {
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  conversionRate: number | null;
  cpa: number | null;
  cpl: number | null;
  roas: number | null;
  frequency: number | null;
  linkCtr: number | null;
  costPerPurchase: number | null;
  purchaseRoas: number | null;
}

export function deriveAd(t: AdTotals): DerivedAdMetrics {
  return {
    ctr: ctr(t.clicks, t.impressions),
    cpc: cpc(t.cost, t.clicks),
    cpm: cpm(t.cost, t.impressions),
    conversionRate: conversionRate(t.conversions, t.clicks),
    cpa: cpa(t.cost, t.conversions),
    cpl: safeDiv(t.leadCost, t.leads),
    roas: roas(t.conversionValue, t.cost),
    frequency: frequency(t.impressions, t.reach),
    linkCtr: ctr(t.linkClicks, t.impressions),
    costPerPurchase: safeDiv(t.cost, t.purchases),
    purchaseRoas: roas(t.purchaseValue, t.cost),
  };
}

/** Consolidação SEO: posição média ponderada por impressões. */
export interface SearchRow {
  clicks: number;
  impressions: number;
  positionSum: number;
}

export function aggregateSearch(rows: SearchRow[]) {
  let clicks = 0;
  let impressions = 0;
  let positionSum = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    positionSum += r.positionSum;
  }
  return { clicks, impressions, ctr: ctr(clicks, impressions), position: safeDiv(positionSum, impressions) };
}
