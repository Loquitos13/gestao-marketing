/**
 * Verificação de números: cada número citado na resposta tem de existir (com tolerância de arredondamento)
 * nos resultados das ferramentas consultadas. Os restantes ficam marcados como "não verificado".
 */

const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g;
// 1.234,56 | 1 234,56 | 1234.56 | 12,5 | 12 — com sinal, sufixo % ou x opcional.
const NUM_RE = /(?<![\w.,])[-+−]?\d{1,3}(?:[.\u00a0 ]\d{3})+(?:,\d+)?(?![\d])|(?<![\w.,])[-+−]?\d+(?:[.,]\d+)?(?![\d])/g;

/** Converte um número escrito em pt-PT (ou com ponto decimal) para number. */
export function parseNumber(raw: string): number | null {
  let s = raw.replace(/[−]/g, "-").replace(/[\u00a0 ]/g, "");
  if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(",", ".");
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

export interface CitedNumber {
  text: string;
  value: number;
}

/** Números citados, ignorando datas, anos e inteiros pequenos (contagens, numeração de listas). */
export function extractNumbers(text: string): CitedNumber[] {
  const clean = text.replace(DATE_RE, " ");
  const out: CitedNumber[] = [];
  for (const m of clean.matchAll(NUM_RE)) {
    const v = parseNumber(m[0]);
    if (v === null) continue;
    const abs = Math.abs(v);
    if (Number.isInteger(v) && abs <= 10) continue;
    if (Number.isInteger(v) && abs >= 1990 && abs <= 2100) continue;
    out.push({ text: m[0].trim(), value: v });
  }
  return out;
}

/** Todos os números presentes nos resultados (recursivo), com as variantes de percentagem. */
export function collectNumbers(data: unknown, acc: number[] = []): number[] {
  if (typeof data === "number" && Number.isFinite(data)) {
    acc.push(data, data * 100, data / 100);
  } else if (typeof data === "string") {
    for (const c of extractNumbers(data)) acc.push(c.value);
  } else if (Array.isArray(data)) {
    for (const x of data) collectNumbers(x, acc);
  } else if (data && typeof data === "object") {
    for (const v of Object.values(data)) collectNumbers(v, acc);
  }
  return acc;
}

/** O valor citado corresponde a uma fonte se coincidir com o arredondamento usado no texto (ou a 1,5%). */
export function matches(cited: CitedNumber, source: number): boolean {
  const decimals = (cited.text.split(/[,.]/).length > 1 && !/^\d{1,3}([.\u00a0 ]\d{3})+$/.test(cited.text) ? cited.text.split(/[,.]/).pop()!.length : 0);
  const step = Math.pow(10, -decimals);
  const tol = Math.max(step / 2 + 1e-9, Math.abs(source) * 0.015);
  return Math.abs(Math.abs(cited.value) - Math.abs(source)) <= tol;
}

export interface GroundingResult {
  cited: number;
  unverified: string[];
}

export function verifyNumbers(answer: string, toolResults: unknown[], extra: number[] = []): GroundingResult {
  const nums = extractNumbers(answer);
  const pool = [...collectNumbers(toolResults), ...extra];
  const unverified = nums.filter((c) => !pool.some((s) => matches(c, s))).map((c) => c.text);
  return { cited: nums.length, unverified: [...new Set(unverified)] };
}
