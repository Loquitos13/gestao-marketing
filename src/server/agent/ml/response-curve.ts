/**
 * Curva de rendimento decrescente: conversões = a × investimento^b (0 < b ≤ 1).
 * Ajustada em log-log sobre semanas, com encolhimento de b para a média da conta quando há poucos dados.
 */

export const B_MIN = 0.2;
export const B_MAX = 1;
const PRIOR_WEIGHT = 8;
export const DEFAULT_PRIOR_B = 0.7;

export interface CurvePoint {
  cost: number;
  conversions: number;
}

export interface ResponseCurve {
  a: number;
  b: number;
  /** b antes do encolhimento */
  rawB: number | null;
  r2: number | null;
  n: number;
  meanCost: number;
  meanConversions: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Pontos com investimento e conversões positivos. Sem pelo menos 3 pontos não há ajuste. */
export function fitResponseCurve(points: CurvePoint[], priorB = DEFAULT_PRIOR_B): ResponseCurve | null {
  const pts = points.filter((p) => p.cost > 0 && p.conversions > 0);
  if (pts.length < 3) return null;
  const xs = pts.map((p) => Math.log(p.cost));
  const ys = pts.map((p) => Math.log(p.conversions));
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
  const my = ys.reduce((s, y) => s + y, 0) / ys.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxx += (xs[i]! - mx) ** 2;
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    syy += (ys[i]! - my) ** 2;
  }
  // Sem variação de investimento não se consegue estimar a elasticidade: fica o valor da conta.
  const rawB = sxx > 1e-6 ? sxy / sxx : null;
  const w = rawB === null ? 0 : pts.length / (pts.length + PRIOR_WEIGHT);
  const b = clamp(w * (rawB ?? priorB) + (1 - w) * priorB, B_MIN, B_MAX);
  const a = Math.exp(my - b * mx);
  const r2 = rawB !== null && syy > 0 ? (sxy * sxy) / (sxx * syy) : null;
  return {
    a,
    b,
    rawB,
    r2,
    n: pts.length,
    meanCost: pts.reduce((s, p) => s + p.cost, 0) / pts.length,
    meanConversions: pts.reduce((s, p) => s + p.conversions, 0) / pts.length,
  };
}

export function predictConversions(c: ResponseCurve, cost: number): number {
  return cost > 0 ? c.a * Math.pow(cost, c.b) : 0;
}

/** Efeito de multiplicar o investimento: conversões e custo marginal por conversão adicional. */
export function whatIf(c: ResponseCurve, currentCost: number, factor: number) {
  const before = predictConversions(c, currentCost);
  const after = predictConversions(c, currentCost * factor);
  const extraCost = currentCost * (factor - 1);
  const extraConv = after - before;
  return {
    conversionsBefore: before,
    conversionsAfter: after,
    conversionChangePct: before > 0 ? after / before - 1 : null,
    marginalCpa: extraConv > 0 ? extraCost / extraConv : null,
  };
}

/** Média ponderada dos b das curvas com dados, para servir de valor de referência da conta. */
export function accountPriorB(curves: (ResponseCurve | null)[]): number {
  const ok = curves.filter((c): c is ResponseCurve => !!c && c.rawB !== null);
  if (!ok.length) return DEFAULT_PRIOR_B;
  const total = ok.reduce((s, c) => s + c.n, 0);
  return clamp(ok.reduce((s, c) => s + clamp(c.rawB!, B_MIN, B_MAX) * c.n, 0) / total, B_MIN, B_MAX);
}
