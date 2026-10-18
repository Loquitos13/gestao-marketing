export type Cell = string | number | boolean | null | undefined;

/** Evita injeção de fórmulas em folhas de cálculo (=, +, -, @, tab, CR no início). */
export function sanitizeCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return s;
}

function quote(s: string, sep: string): string {
  return /["\r\n]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV UTF-8 com BOM e separador ";" (compatível com Excel em pt-PT). Números com ponto decimal. */
export function toCsv(headers: string[], rows: Cell[][], sep = ";"): string {
  const lines = [headers.map((h) => quote(sanitizeCell(h), sep)).join(sep), ...rows.map((r) => r.map((c) => quote(sanitizeCell(c), sep)).join(sep))];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export interface Table {
  name: string;
  headers: string[];
  rows: Cell[][];
}
