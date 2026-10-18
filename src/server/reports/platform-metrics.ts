import { formatDelta, formatPp, type FormatContext, type Unit } from "@/lib/format";
import { delta } from "@/server/metrics/calc";
import { METRICS } from "@/server/metrics/definitions";
import { resolveMetricGroups, type AdPlatform } from "@/server/metrics/platform-groups";
import type { EntityRow, loadPlatformAnalytics } from "@/server/queries/ads";

export interface MetricRow {
  key: string;
  label: string;
  unit: Unit;
  current: number | null;
  previous: number | null;
  abs: number | null;
  pct: number | null;
  higherIsBetter: boolean | null;
  /** Fórmula (métricas calculadas) ou campo da API (métricas diretas). */
  source: string;
  note: string | null;
}

export interface PlatformMetrics {
  platform: AdPlatform;
  label: string;
  attribution: string;
  groups: { label: string; rows: MetricRow[] }[];
  unavailable: string[];
  campaigns: EntityRow[];
}

const ATTRIBUTION: Record<AdPlatform, string> = {
  GOOGLE_ADS: "Conversões segundo o modelo de atribuição configurado na conta Google Ads (data-driven por omissão).",
  META_ADS: "Conversões segundo a janela de atribuição do Meta (por omissão 7 dias após clique / 1 dia após visualização).",
};

type Analytics = Awaited<ReturnType<typeof loadPlatformAnalytics>>;

const sourcesFor = (sources: string[], platform: AdPlatform) => {
  const prefix = platform === "GOOGLE_ADS" ? "Google Ads" : "Meta Ads";
  const own = sources.filter((s) => s.startsWith(prefix));
  return (own.length ? own : sources).join(" · ");
};

export function platformMetrics(platform: AdPlatform, a: Analytics): PlatformMetrics {
  const { groups, unavailable } = resolveMetricGroups(platform, a.totals, a.previous);
  const t = a.totals.totals;
  return {
    platform,
    label: platform === "GOOGLE_ADS" ? "Google Ads" : "Meta Ads",
    attribution: ATTRIBUTION[platform],
    groups: groups.map((g) => ({
      label: g.label,
      rows: g.metrics.map((m) => {
        const def = METRICS[m.key];
        const dl = delta(m.current, m.previous);
        return {
          key: m.key,
          label: def?.label ?? m.key,
          unit: def?.unit ?? "number",
          current: m.current,
          previous: m.previous,
          abs: dl.abs,
          pct: dl.pct,
          higherIsBetter: def?.higherIsBetter ?? null,
          source: def?.formula ?? sourcesFor(def?.sources ?? [], platform),
          note: m.key === "reach" && t.reachIsApproximate ? "Aproximado: soma de alcances diários (limite superior)." : (def?.kind === "ESTIMATE" ? "Estimativa da plataforma." : null),
        };
      }),
    })),
    unavailable,
    campaigns: [...a.campaigns].filter((c) => c.cost > 0).sort((x, y) => y.cost - x.cost).slice(0, 25),
  };
}

/** Variação apresentável: pontos percentuais para taxas, percentagem para o resto. */
export function metricChange(r: Pick<MetricRow, "unit" | "current" | "previous" | "pct">, fmt: FormatContext): string {
  if (r.unit === "percent") return formatPp(r.current, r.previous, fmt);
  return formatDelta(r.pct, fmt);
}

/** Tom da variação: bom, mau ou neutro (métricas sem direção, como o investimento). */
export function metricTone(r: Pick<MetricRow, "higherIsBetter" | "current" | "previous" | "abs">): "good" | "bad" | "neutral" {
  if (r.higherIsBetter === null || r.abs === null || r.current === null || r.previous === null) return "neutral";
  const eps = Math.max(Math.abs(r.previous), 1e-9) * 0.0005;
  if (Math.abs(r.abs) < eps) return "neutral";
  return r.abs > 0 === r.higherIsBetter ? "good" : "bad";
}
