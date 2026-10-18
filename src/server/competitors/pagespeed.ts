import { requestJson } from "@/server/integrations/http";
import { checkUrl } from "./safe-fetch";

export interface PageSpeedMetrics {
  url: string;
  score: number | null;
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  /** true: métricas reais de utilizadores (CrUX); false: medição de laboratório (Lighthouse). */
  fieldData: boolean;
}

type Psi = {
  id?: string;
  loadingExperience?: { metrics?: Record<string, { percentile?: number }> };
  lighthouseResult?: { finalUrl?: string; categories?: { performance?: { score?: number | null } }; audits?: Record<string, { numericValue?: number }> };
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Prefere dados reais (CrUX) quando existem; caso contrário usa o laboratório. O INP só existe em dados reais. */
export function parsePagespeed(r: Psi, url: string): PageSpeedMetrics {
  const field = r.loadingExperience?.metrics ?? {};
  const lab = r.lighthouseResult?.audits ?? {};
  const fLcp = num(field.LARGEST_CONTENTFUL_PAINT_MS?.percentile);
  const fInp = num(field.INTERACTION_TO_NEXT_PAINT?.percentile);
  const fCls = num(field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile);
  const fieldData = fLcp !== null || fInp !== null;
  const score = num(r.lighthouseResult?.categories?.performance?.score);
  return {
    url: r.lighthouseResult?.finalUrl ?? r.id ?? url,
    score: score === null ? null : Math.round(score * 100),
    lcpMs: fieldData ? fLcp : num(lab["largest-contentful-paint"]?.numericValue),
    inpMs: fInp,
    cls: fieldData && fCls !== null ? fCls / 100 : num(lab["cumulative-layout-shift"]?.numericValue),
    fieldData,
  };
}

export async function runPagespeed(url: string, key: string | undefined, fetchImpl?: typeof fetch): Promise<PageSpeedMetrics> {
  const target = checkUrl(url).toString();
  const qs = new URLSearchParams({ url: target, strategy: "mobile", category: "performance" });
  if (key) qs.set("key", key);
  const r = await requestJson<Psi>(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`, { timeoutMs: 120_000, maxRetries: 1, baseDelayMs: 5000, fetchImpl });
  return parsePagespeed(r, target);
}

export const VITALS = {
  lcpMs: { good: 2500, poor: 4000, label: "LCP" },
  inpMs: { good: 200, poor: 500, label: "INP" },
  cls: { good: 0.1, poor: 0.25, label: "CLS" },
} as const;

export function vitalRating(metric: keyof typeof VITALS, v: number | null): "good" | "needs-improvement" | "poor" | null {
  if (v === null) return null;
  const t = VITALS[metric];
  return v <= t.good ? "good" : v <= t.poor ? "needs-improvement" : "poor";
}
