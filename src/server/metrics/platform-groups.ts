import type { AdTotals, DerivedAdMetrics } from "./aggregate";
import { safeDiv } from "./calc";

export type AdPlatform = "GOOGLE_ADS" | "META_ADS";
type Snapshot = { totals: AdTotals; derived: DerivedAdMetrics };
type Getter = (s: Snapshot) => number | null;

export interface MetricSpec {
  key: string;
  get: Getter;
  /** Chave da série diária em loadPlatformAnalytics, se existir. */
  series?: "cost" | "clicks" | "impressions" | "conversions" | "value" | "ctr" | "cpa" | "frequency";
}
export interface MetricGroupSpec {
  label: string;
  metrics: MetricSpec[];
}

const t = (k: keyof AdTotals): Getter => (s) => s.totals[k] as number | null;
const d = (k: keyof DerivedAdMetrics): Getter => (s) => s.derived[k];
const ratio = (a: keyof AdTotals, b: keyof AdTotals): Getter => (s) => safeDiv(s.totals[a] as number | null, s.totals[b] as number | null);

const CORE_TRAFFIC: MetricSpec[] = [
  { key: "cost", get: t("cost"), series: "cost" },
  { key: "impressions", get: t("impressions"), series: "impressions" },
  { key: "clicks", get: t("clicks"), series: "clicks" },
  { key: "ctr", get: d("ctr"), series: "ctr" },
  { key: "cpc", get: d("cpc") },
  { key: "cpm", get: d("cpm") },
];

/** Grupos de métricas por plataforma — fonte única para a vista da plataforma e para os relatórios. */
export const PLATFORM_METRIC_GROUPS: Record<AdPlatform, MetricGroupSpec[]> = {
  GOOGLE_ADS: [
    { label: "Investimento e tráfego", metrics: CORE_TRAFFIC },
    {
      label: "Conversão",
      metrics: [
        { key: "conversions", get: t("conversions"), series: "conversions" },
        { key: "conversionRate", get: d("conversionRate") },
        { key: "cpa", get: d("cpa"), series: "cpa" },
        { key: "conversionValue", get: t("conversionValue"), series: "value" },
        { key: "roas", get: d("roas") },
        { key: "valuePerConversion", get: ratio("conversionValue", "conversions") },
        { key: "allConversions", get: t("allConversions") },
        { key: "allConversionValue", get: t("allConversionValue") },
        { key: "leads", get: t("leads") },
        { key: "cpl", get: d("cpl") },
      ],
    },
    {
      label: "Competitividade (Pesquisa)",
      metrics: [
        { key: "searchImpressionShare", get: t("searchImpressionShare") },
        { key: "searchLostIsBudget", get: t("searchLostIsBudget") },
        { key: "searchLostIsRank", get: t("searchLostIsRank") },
      ],
    },
    {
      label: "Interações e vídeo",
      metrics: [
        { key: "interactions", get: t("interactions") },
        { key: "interactionRate", get: ratio("interactions", "impressions") },
        { key: "videoViews", get: t("videoViews") },
        { key: "videoViewRate", get: ratio("videoViews", "impressions") },
        { key: "costPerView", get: ratio("cost", "videoViews") },
      ],
    },
  ],
  META_ADS: [
    {
      label: "Distribuição",
      metrics: [
        { key: "cost", get: t("cost"), series: "cost" },
        { key: "impressions", get: t("impressions"), series: "impressions" },
        { key: "reach", get: t("reach") },
        { key: "frequency", get: d("frequency"), series: "frequency" },
        { key: "cpm", get: d("cpm") },
      ],
    },
    {
      label: "Tráfego",
      metrics: [
        { key: "clicks", get: t("clicks"), series: "clicks" },
        { key: "ctr", get: d("ctr"), series: "ctr" },
        { key: "cpc", get: d("cpc") },
        { key: "linkClicks", get: t("linkClicks") },
        { key: "linkCtr", get: d("linkCtr") },
        { key: "costPerLinkClick", get: ratio("cost", "linkClicks") },
        { key: "landingPageViews", get: t("landingPageViews") },
        { key: "costPerLandingPageView", get: ratio("cost", "landingPageViews") },
        { key: "landingRate", get: ratio("landingPageViews", "linkClicks") },
      ],
    },
    {
      label: "Conversão",
      metrics: [
        { key: "conversions", get: t("conversions"), series: "conversions" },
        { key: "cpa", get: d("cpa"), series: "cpa" },
        { key: "conversionValue", get: t("conversionValue"), series: "value" },
        { key: "roas", get: d("roas") },
        { key: "purchases", get: t("purchases") },
        { key: "costPerPurchase", get: d("costPerPurchase") },
        { key: "purchaseValue", get: t("purchaseValue") },
        { key: "purchaseRoas", get: d("purchaseRoas") },
        { key: "leads", get: t("leads") },
        { key: "cpl", get: d("cpl") },
      ],
    },
    {
      label: "Criativo e vídeo",
      metrics: [
        { key: "videoViews", get: t("videoViews") },
        { key: "hookRate", get: ratio("videoViews", "impressions") },
        { key: "thruplays", get: t("thruplays") },
        { key: "holdRate", get: ratio("thruplays", "videoViews") },
        { key: "costPerThruplay", get: ratio("cost", "thruplays") },
        { key: "engagements", get: t("engagements") },
        { key: "engagementRateAds", get: ratio("engagements", "impressions") },
        { key: "reactions", get: t("reactions") },
        { key: "comments", get: t("comments") },
        { key: "shares", get: t("shares") },
      ],
    },
  ],
};

export interface ResolvedMetric {
  key: string;
  current: number | null;
  previous: number | null;
  series?: MetricSpec["series"];
}
export interface ResolvedGroup {
  label: string;
  metrics: ResolvedMetric[];
}

/**
 * Resolve os grupos para um par atual/anterior. Grupos sem qualquer valor no período atual nem no anterior são
 * omitidos (a conta não reporta essas métricas) e listados em `unavailable`.
 */
export function resolveMetricGroups(platform: AdPlatform, cur: Snapshot, prev: Snapshot | null) {
  const groups: ResolvedGroup[] = [];
  const unavailable: string[] = [];
  for (const g of PLATFORM_METRIC_GROUPS[platform]) {
    const metrics = g.metrics.map((m) => ({ key: m.key, current: m.get(cur), previous: prev ? m.get(prev) : null, series: m.series }));
    if (metrics.every((m) => m.current === null && m.previous === null)) unavailable.push(g.label);
    else groups.push({ label: g.label, metrics });
  }
  return { groups, unavailable };
}
