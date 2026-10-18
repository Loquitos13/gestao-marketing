import type { Platform } from "@prisma/client";
import type { EntityLevel, RemoteState } from "./types";

export const MAX_STEP_CAP = 0.5;
export const MIN_DAILY_BUDGET = 1;
export const MAX_APPLIED_PER_HOUR = 30;

export type Desired = "ACTIVE" | "PAUSED";

/** Estado nativo da plataforma para "ativo"/"pausado". */
export function nativeStatus(platform: Platform, desired: Desired): string {
  if (desired === "PAUSED") return "PAUSED";
  return platform === "GOOGLE_ADS" ? "ENABLED" : "ACTIVE";
}

export const isActive = (status: string | null | undefined) => status === "ENABLED" || status === "ACTIVE";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface BudgetEntity {
  platform: Platform;
  level: EntityLevel;
  dailyBudget: number | null;
  /** Google: orçamento partilhado entre campanhas. */
  shared?: boolean;
  /** Meta: orçamento vitalício definido (não suportado). */
  lifetime?: boolean;
  /** Meta: nível onde o orçamento está definido (CBO na campanha ou ABO nos conjuntos). */
  metaBudgetLevel?: string | null;
}

/** Motivo pelo qual o orçamento diário desta entidade não pode ser alterado pelo hub (ou null). */
export function budgetBlockReason(e: BudgetEntity): string | null {
  if (e.level === "AD") return "Os anúncios não têm orçamento próprio.";
  if (e.platform === "GOOGLE_ADS" && e.level !== "CAMPAIGN") return "No Google Ads o orçamento diário é definido na campanha.";
  if (e.shared) return "Orçamento partilhado por várias campanhas: altere-o diretamente no Google Ads.";
  if (e.lifetime) return "Orçamento vitalício: este tipo de orçamento não é alterado pelo hub.";
  if (e.platform === "META_ADS" && e.level === "CAMPAIGN" && e.metaBudgetLevel === "ADSET") return "Esta campanha tem o orçamento definido nos conjuntos de anúncios.";
  if (e.dailyBudget === null || e.dailyBudget <= 0) return "Esta entidade não tem orçamento diário próprio.";
  return null;
}

/** Valida uma alteração de orçamento diário. Devolve a mensagem de erro ou null. */
export function checkBudgetChange(e: BudgetEntity, newBudget: number, maxStepPct: number): string | null {
  if (!Number.isFinite(newBudget) || newBudget <= 0) return "O orçamento tem de ser um valor positivo.";
  const blocked = budgetBlockReason(e);
  if (blocked) return blocked;
  if (e.dailyBudget === null) return blocked;
  if (newBudget < MIN_DAILY_BUDGET) return `O orçamento diário mínimo é ${MIN_DAILY_BUDGET.toFixed(2)}.`;
  if (round2(newBudget) === round2(e.dailyBudget)) return "O novo orçamento é igual ao atual.";
  const step = Math.min(Math.max(maxStepPct, 0.01), MAX_STEP_CAP);
  const change = Math.abs(newBudget - e.dailyBudget) / e.dailyBudget;
  // Tolerância de meio cêntimo: clampStep arredonda a cêntimos e não pode ser recusado aqui.
  if (Math.abs(newBudget - e.dailyBudget) > e.dailyBudget * step + 0.005) return `Variação de ${(change * 100).toFixed(0)}% excede o limite de ${(step * 100).toFixed(0)}% por alteração definido para este cliente.`;
  return null;
}

/** Limita um orçamento pretendido ao passo máximo permitido (usado pelo motor de distribuição). */
export function clampStep(current: number, target: number, maxStepPct: number): number {
  const step = Math.min(Math.max(maxStepPct, 0.01), MAX_STEP_CAP);
  return round2(Math.min(current * (1 + step), Math.max(current * (1 - step), Math.max(target, MIN_DAILY_BUDGET))));
}

/** Compara o estado remoto com o estado esperado nos campos alterados. */
export function sameState(a: RemoteState, b: RemoteState, fields: (keyof RemoteState)[]): boolean {
  return fields.every((f) => {
    const x = a[f];
    const y = b[f];
    if (typeof x === "number" || typeof y === "number") return x !== null && y !== null && x !== undefined && y !== undefined && Math.abs(Number(x) - Number(y)) < 0.005;
    return (x ?? null) === (y ?? null);
  });
}

export const fieldsOf = (operation: string): (keyof RemoteState)[] => (operation === "SET_DAILY_BUDGET" ? ["dailyBudget"] : ["status"]);
