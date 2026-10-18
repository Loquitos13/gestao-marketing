/**
 * Previsão Holt-Winters aditiva com tendência amortecida e sazonalidade semanal.
 * Parâmetros escolhidos por pesquisa em grelha (erro de previsão a 1 passo); erro avaliado
 * num período final guardado fora do treino (backtest).
 */

export const SEASON = 7;
const PHI = 0.9;
const ALPHAS = [0.1, 0.3, 0.5, 0.7, 0.9];
const BETAS = [0.01, 0.05, 0.1, 0.2];
const GAMMAS = [0.05, 0.1, 0.3, 0.5];

export interface HwModel {
  alpha: number;
  beta: number;
  gamma: number;
  phi: number;
  level: number;
  trend: number;
  /** Índices sazonais alinhados com o dia seguinte ao último ponto: season[0] = amanhã. */
  season: number[];
  sigma: number;
  n: number;
}

export interface ForecastPoint {
  step: number;
  value: number;
  lower: number;
  upper: number;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

function run(y: number[], alpha: number, beta: number, gamma: number) {
  const m = SEASON;
  let level = mean(y.slice(0, m));
  let trend = (mean(y.slice(m, 2 * m)) - level) / m;
  const season = y.slice(0, m).map((v) => v - level);
  let sse = 0;
  let count = 0;
  for (let t = m; t < y.length; t++) {
    const s = season[t % m]!;
    const f = level + PHI * trend + s;
    const e = y[t]! - f;
    sse += e * e;
    count++;
    const prev = level;
    level = alpha * (y[t]! - s) + (1 - alpha) * (prev + PHI * trend);
    trend = beta * (level - prev) + (1 - beta) * PHI * trend;
    season[t % m] = gamma * (y[t]! - level) + (1 - gamma) * s;
  }
  const n = y.length;
  const aligned = Array.from({ length: m }, (_, i) => season[(n + i) % m]!);
  return { level, trend, season: aligned, sigma: Math.sqrt(sse / Math.max(1, count)), sse };
}

/** Exige pelo menos 3 semanas de dados diários. */
export function fitHoltWinters(y: number[]): HwModel | null {
  if (y.length < 3 * SEASON || y.every((v) => v === 0)) return null;
  let best: (ReturnType<typeof run> & { alpha: number; beta: number; gamma: number }) | null = null;
  for (const alpha of ALPHAS)
    for (const beta of BETAS)
      for (const gamma of GAMMAS) {
        const r = run(y, alpha, beta, gamma);
        if (!best || r.sse < best.sse) best = { ...r, alpha, beta, gamma };
      }
  const b = best!;
  return { alpha: b.alpha, beta: b.beta, gamma: b.gamma, phi: PHI, level: b.level, trend: b.trend, season: b.season, sigma: b.sigma, n: y.length };
}

/** Previsão de h dias com intervalo de 95% (valores nunca negativos). */
export function forecast(model: HwModel, h: number): ForecastPoint[] {
  const out: ForecastPoint[] = [];
  let damp = 0;
  for (let step = 1; step <= h; step++) {
    damp += Math.pow(model.phi, step);
    const value = model.level + damp * model.trend + model.season[(step - 1) % SEASON]!;
    const width = 1.96 * model.sigma * Math.sqrt(1 + (step - 1) * model.alpha * model.alpha);
    out.push({ step, value: Math.max(0, value), lower: Math.max(0, value - width), upper: Math.max(0, value + width) });
  }
  return out;
}

/** Erro absoluto ponderado (WAPE): soma dos erros / soma dos valores reais. Robusto a dias com zero. */
export function wape(actual: number[], predicted: number[]): number | null {
  const total = actual.reduce((s, v) => s + Math.abs(v), 0);
  if (total === 0) return null;
  return actual.reduce((s, v, i) => s + Math.abs(v - (predicted[i] ?? 0)), 0) / total;
}

export interface Backtest {
  wape: number | null;
  holdoutDays: number;
}

/** Treina sem as últimas `holdout` observações e mede o erro nessas observações. */
export function backtestHoltWinters(y: number[], holdout = 28): Backtest {
  if (y.length < 3 * SEASON + holdout) return { wape: null, holdoutDays: 0 };
  const model = fitHoltWinters(y.slice(0, y.length - holdout));
  if (!model) return { wape: null, holdoutDays: 0 };
  const pred = forecast(model, holdout).map((p) => p.value);
  return { wape: wape(y.slice(-holdout), pred), holdoutDays: holdout };
}
