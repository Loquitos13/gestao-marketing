/** Ruído determinístico: o mesmo texto produz sempre o mesmo valor em [0, 1). */
export function hash01(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // mistura final (mulberry32)
  let t = (h + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Fator multiplicativo 1 ± amp. */
export function noise(key: string, amp: number): number {
  return 1 + (hash01(key) * 2 - 1) * amp;
}

/** Arredondamento estocástico determinístico (preserva médias em contagens pequenas). */
export function stochasticRound(value: number, key: string): number {
  const floor = Math.floor(value);
  return floor + (hash01(key) < value - floor ? 1 : 0);
}

/** Reparte um inteiro por pesos de forma exata (soma das partes = total). */
export function splitInt(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map(Math.floor);
  let rest = total - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) parts[order[k][1]]++;
  return parts;
}

/** Reparte um valor decimal com 2 casas de forma exata. */
export function splitMoney(total: number, weights: number[]): number[] {
  const cents = splitInt(Math.round(total * 100), weights);
  return cents.map((c) => c / 100);
}
