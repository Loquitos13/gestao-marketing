export interface SkipCounts {
  duplicate: number;
  suppressed: number;
  refused: number;
}

const n = (v: number | undefined) => (typeof v === "number" && v > 0 ? v : 0);

export function skipCounts(raw: unknown): SkipCounts {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { skipped?: Partial<SkipCounts> }).skipped : undefined;
  return { duplicate: n(o?.duplicate), suppressed: n(o?.suppressed), refused: n(o?.refused) };
}

/** Frase para a interface: o que foi criado e o que ficou de fora, com plural correto. */
export function suggestionOutcome(created: number, skipped: SkipCounts): string {
  const parts = [created === 1 ? "1 sugestão criada" : `${created} sugestões criadas`];
  if (skipped.duplicate === 1) parts.push("1 já existia e não foi repetida");
  else if (skipped.duplicate > 1) parts.push(`${skipped.duplicate} já existiam e não foram repetidas`);
  if (skipped.suppressed === 1) parts.push("1 suprimida pelas suas decisões anteriores");
  else if (skipped.suppressed > 1) parts.push(`${skipped.suppressed} suprimidas pelas suas decisões anteriores`);
  if (skipped.refused === 1) parts.push("1 não repetida porque foi recusada este mês");
  else if (skipped.refused > 1) parts.push(`${skipped.refused} não repetidas porque foram recusadas este mês`);
  return `${parts.join(". ")}.`;
}
