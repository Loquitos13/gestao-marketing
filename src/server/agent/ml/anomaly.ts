/** Deteção de anomalias por z-score robusto (mediana e desvio absoluto mediano) sobre resíduos. */

export const Z_THRESHOLD = 3.5;

export function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** z-scores robustos: 0,6745 × (x − mediana) / MAD. Com MAD nulo devolve 0 para todos. */
export function robustZ(values: number[]): number[] {
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med)));
  if (mad === 0) return values.map(() => 0);
  return values.map((v) => (0.6745 * (v - med)) / mad);
}

export interface Anomaly {
  index: number;
  value: number;
  expected: number;
  z: number;
  direction: "UP" | "DOWN";
}

/**
 * Compara valores reais com os esperados (por exemplo, a previsão) e assinala os resíduos extremos.
 * Só considera os últimos `recent` pontos, usando o histórico completo para estimar a dispersão.
 */
export function detectAnomalies(actual: number[], expected: number[], recent = 7, threshold = Z_THRESHOLD): Anomaly[] {
  const residuals = actual.map((v, i) => v - (expected[i] ?? v));
  const z = robustZ(residuals);
  const out: Anomaly[] = [];
  for (let i = Math.max(0, actual.length - recent); i < actual.length; i++) {
    if (Math.abs(z[i]!) >= threshold) out.push({ index: i, value: actual[i]!, expected: expected[i]!, z: z[i]!, direction: z[i]! > 0 ? "UP" : "DOWN" });
  }
  return out;
}

/** Valores esperados por média dos mesmos dias da semana nas 4 semanas anteriores (sem modelo). */
export function seasonalNaive(y: number[], season = 7, weeks = 4): number[] {
  return y.map((v, i) => {
    const prev: number[] = [];
    for (let k = 1; k <= weeks && i - k * season >= 0; k++) prev.push(y[i - k * season]!);
    return prev.length ? prev.reduce((s, x) => s + x, 0) / prev.length : v;
  });
}
