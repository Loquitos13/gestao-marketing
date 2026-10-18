/**
 * Cálculos de métricas derivadas. Regras:
 *  - Divisão por zero ou por valor ausente → null ("Não disponível"), nunca 0 nem Infinity.
 *  - Valores ausentes (null) não são tratados como 0.
 */
export function safeDiv(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return a / b;
}

export const ctr = (clicks: number | null, impressions: number | null) => safeDiv(clicks, impressions);
export const cpc = (cost: number | null, clicks: number | null) => safeDiv(cost, clicks);
export const cpm = (cost: number | null, impressions: number | null) => {
  const v = safeDiv(cost, impressions);
  return v === null ? null : v * 1000;
};
export const conversionRate = (conversions: number | null, clicks: number | null) => safeDiv(conversions, clicks);
export const cpa = (cost: number | null, conversions: number | null) => safeDiv(cost, conversions);
export const roas = (value: number | null, cost: number | null) => safeDiv(value, cost);
export const frequency = (impressions: number | null, reach: number | null) => safeDiv(impressions, reach);
/** Taxa de engagement = interações (reações + comentários + partilhas + guardados + cliques) / impressões. */
export const engagementRate = (engagements: number | null, impressions: number | null) => safeDiv(engagements, impressions);

/**
 * ROI de marketing = (receita atribuída × margem bruta − investimento) / investimento.
 * Sem margem bruta definida não é possível calcular ROI (devolve null).
 */
export function roi(revenue: number | null, cost: number | null, grossMargin: number | null): number | null {
  if (revenue === null || cost === null || grossMargin === null || grossMargin <= 0 || grossMargin > 1) return null;
  return safeDiv(revenue * grossMargin - cost, cost);
}

export type DeltaStatus = "up" | "down" | "flat" | "new" | "unavailable";

export interface Delta {
  current: number | null;
  previous: number | null;
  abs: number | null;
  pct: number | null;
  status: DeltaStatus;
}

/** Variação entre períodos com tratamento explícito de zeros e ausências. */
export function delta(current: number | null | undefined, previous: number | null | undefined, epsilon = 1e-9): Delta {
  const c = current ?? null;
  const p = previous ?? null;
  if (c === null || p === null) return { current: c, previous: p, abs: null, pct: null, status: "unavailable" };
  const abs = c - p;
  if (Math.abs(p) < epsilon) {
    if (Math.abs(c) < epsilon) return { current: c, previous: p, abs: 0, pct: 0, status: "flat" };
    return { current: c, previous: p, abs, pct: null, status: "new" };
  }
  const pct = abs / Math.abs(p);
  const status: DeltaStatus = Math.abs(pct) < 0.005 ? "flat" : pct > 0 ? "up" : "down";
  return { current: c, previous: p, abs, pct, status };
}

/** Projeção linear de investimento até ao fim do período, com base no ritmo médio recente. */
export function projectSpend(spentToDate: number, recentDailyAvg: number, remainingDays: number): number {
  return spentToDate + Math.max(0, recentDailyAvg) * Math.max(0, remainingDays);
}

/** CTR esperado aproximado por posição orgânica (curva conservadora, apenas para priorização). */
export function expectedOrganicCtr(position: number): number {
  const curve = [0.28, 0.16, 0.11, 0.08, 0.065, 0.05, 0.04, 0.032, 0.027, 0.022];
  if (position < 1) return curve[0];
  if (position <= 10) {
    const lo = Math.floor(position) - 1;
    const hi = Math.min(lo + 1, 9);
    const t = position - Math.floor(position);
    return curve[lo] + (curve[hi] - curve[lo]) * t;
  }
  if (position <= 20) return 0.01;
  return 0.004;
}
