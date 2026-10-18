import type { Platform } from "@prisma/client";
import { clampStep } from "./guards";

export type GoalKind = "ROAS" | "CPA";

export interface AllocEntity {
  key: string;
  level: "CAMPAIGN" | "AD_GROUP";
  entityId: string;
  name: string;
  platform: Platform;
  dailyBudget: number;
  /** Ativo e com orçamento diário editável pelo hub. */
  adjustable: boolean;
  blockReason?: string | null;
  /** Métricas dos últimos 30 dias (sinal principal) e 14 dias (confirmação de tendência). */
  cost30: number;
  conversions30: number;
  value30: number;
  cost14: number;
  conversions14: number;
  value14: number;
  /** Google: parcela de impressões perdida por orçamento (0..1). */
  lostBudget?: number | null;
  /** Meta: frequência média no período. */
  frequency?: number | null;
}

export interface AllocInput {
  monthlyTotal: number;
  spentToDate: number;
  daysLeft: number;
  goal: { kind: GoalKind; target: number | null };
  maxStepPct: number;
  entities: AllocEntity[];
  minConversions?: number;
}

export interface AllocLine {
  entity: AllocEntity;
  current: number;
  proposed: number;
  change: number;
  changePct: number;
  /** Eficiência face ao objetivo (>1 melhor que o objetivo), com encolhimento para amostras pequenas. */
  score: number | null;
  reason: string;
  limitedByStep: boolean;
}

export interface AllocResult {
  dailyTarget: number;
  currentDaily: number;
  proposedDaily: number;
  goal: { kind: GoalKind; target: number | null; source: "GOAL" | "AVERAGE" };
  split: { before: Record<"GOOGLE_ADS" | "META_ADS", number>; after: Record<"GOOGLE_ADS" | "META_ADS", number> };
  lines: AllocLine[];
  warnings: string[];
}

const SHRINK_K = 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const fmtX = (n: number) => `${n.toFixed(2).replace(".", ",")}×`;
const fmtEur = (n: number) => `${n.toFixed(2).replace(".", ",")}`;

export const ATTRIBUTION_WARNING =
  "Cada plataforma atribui conversões com o seu próprio modelo (Google: modelo da conta; Meta: janela de clique/visualização). Comparar ROAS ou CPA entre plataformas tem enviesamento — confirme com o GA4 ou com as vendas reais antes de grandes mudanças.";

/** Eficiência relativa ao objetivo: ROAS/objetivo ou objetivo/CPA. */
function rawEfficiency(e: AllocEntity, kind: GoalKind, target: number): number | null {
  if (e.cost30 <= 0) return null;
  if (kind === "ROAS") return e.value30 / e.cost30 / target;
  if (e.conversions30 <= 0) return 0;
  return target / (e.cost30 / e.conversions30);
}

/** Encolhimento para 1 (neutro) quando há poucas conversões: evita reagir a ruído. */
export const shrink = (eff: number, conversions: number, k = SHRINK_K) => (conversions * eff + k) / (conversions + k);

function averageTarget(es: AllocEntity[], kind: GoalKind): number | null {
  const cost = es.reduce((s, e) => s + e.cost30, 0);
  const conv = es.reduce((s, e) => s + e.conversions30, 0);
  const value = es.reduce((s, e) => s + e.value30, 0);
  if (cost <= 0) return null;
  if (kind === "ROAS") return value > 0 ? value / cost : null;
  return conv > 0 ? cost / conv : null;
}

/**
 * Distribui o orçamento restante do mês pelas campanhas/conjuntos editáveis, favorecendo os que
 * superam o objetivo do cliente. Respeita o passo máximo por alteração; entidades com pouca amostra
 * ou não editáveis mantêm o orçamento. Resultado é uma proposta — nunca é aplicada sem confirmação.
 */
export function allocateBudget(i: AllocInput): AllocResult {
  const minConv = i.minConversions ?? 10;
  const remaining = Math.max(0, i.monthlyTotal - i.spentToDate);
  const dailyTarget = r2(remaining / Math.max(1, i.daysLeft));
  const warnings = [ATTRIBUTION_WARNING];
  const fallback = averageTarget(i.entities, i.goal.kind);
  const target = i.goal.target ?? fallback;
  const goal = { kind: i.goal.kind, target, source: i.goal.target ? ("GOAL" as const) : ("AVERAGE" as const) };
  if (!i.goal.target) warnings.push(`Sem objetivo de ${i.goal.kind === "ROAS" ? "ROAS mínimo" : "CPA/CPL máximo"} definido: usada a média da conta como referência. Defina o objetivo em Orçamento → Objetivos.`);

  const fixed: AllocLine[] = [];
  const flex: { e: AllocEntity; score: number; saturated: boolean; reason: string }[] = [];
  for (const e of i.entities) {
    const keep = (reason: string, score: number | null = null) => fixed.push({ entity: e, current: e.dailyBudget, proposed: e.dailyBudget, change: 0, changePct: 0, score, reason, limitedByStep: false });
    if (!e.adjustable) {
      keep(e.blockReason ?? "Não editável pelo hub.");
      continue;
    }
    if (!target) {
      keep("Sem dados suficientes para comparar com o objetivo.");
      continue;
    }
    const raw = rawEfficiency(e, i.goal.kind, target);
    if (raw === null || e.conversions30 < minConv) {
      keep(`Amostra pequena (${Math.round(e.conversions30)} conversões em 30 dias, mínimo ${minConv}): orçamento mantido.`, raw === null ? null : shrink(raw, e.conversions30));
      continue;
    }
    let score = shrink(raw, e.conversions30);
    // Tendência recente: se os últimos 14 dias contrariam o sinal de 30 dias, aproxima de neutro.
    const recent = rawEfficiency({ ...e, cost30: e.cost14, conversions30: e.conversions14, value30: e.value14 }, i.goal.kind, target);
    if (recent !== null && e.conversions14 >= minConv / 2 && (recent - 1) * (score - 1) < 0) score = (score + 1) / 2;
    const metric = i.goal.kind === "ROAS" ? `ROAS ${fmtX(e.value30 / e.cost30)} vs ${goal.source === "GOAL" ? "objetivo" : "média"} ${fmtX(target)}` : `CPA ${fmtEur(e.cost30 / e.conversions30)} vs ${goal.source === "GOAL" ? "máximo" : "média"} ${fmtEur(target)}`;
    const notes: string[] = [];
    let saturated = false;
    if (e.platform === "GOOGLE_ADS" && e.lostBudget !== null && e.lostBudget !== undefined && e.lostBudget < 0.05) {
      saturated = true;
      notes.push("quase não perde impressões por orçamento: mais orçamento não traria mais tráfego");
    }
    if (e.platform === "META_ADS" && (e.frequency ?? 0) > 3.5) {
      saturated = true;
      notes.push(`frequência ${(e.frequency ?? 0).toFixed(1)} (risco de saturação do público)`);
    }
    if (score > 1 && (e.lostBudget ?? 0) >= 0.2) notes.push(`perde ${Math.round((e.lostBudget ?? 0) * 100)}% das impressões por orçamento`);
    flex.push({ e, score, saturated, reason: `${metric} (${Math.round(e.conversions30)} conv. em 30 dias)${notes.length ? `; ${notes.join("; ")}` : ""}` });
  }

  const fixedDaily = fixed.reduce((s, l) => s + l.current, 0);
  const flexTarget = Math.max(0, dailyTarget - fixedDaily);
  const flexCurrent = flex.reduce((s, f) => s + f.e.dailyBudget, 0);
  if (flex.length && flexTarget === 0) warnings.push("O orçamento restante do mês já está comprometido pelas entidades não ajustáveis.");

  // Ajuste multiplicativo: orçamento atual × f(eficiência) × λ, com λ a normalizar para o ritmo necessário.
  // Limites por entidade: passo máximo; abaixo do objetivo nunca sobe; acima do objetivo só desce se for preciso cortar no total;
  // saturadas não sobem. A soma limitada é monótona em λ, por isso λ é encontrado por bisseção.
  const step = Math.min(Math.max(i.maxStepPct, 0.01), 0.5);
  const growing = flexTarget >= flexCurrent;
  const factor = (s: number) => Math.pow(Math.min(Math.max(s, 0.5), 2), 0.75);
  const bounds = new Map(
    flex.map((f) => {
      const cur = f.e.dailyBudget;
      let lo = Math.max(1, cur * (1 - step));
      let hi = cur * (1 + step);
      if (f.score < 1) hi = cur;
      if (f.score > 1 && growing) lo = cur;
      if (f.saturated) hi = Math.min(hi, cur);
      return [f.e.key, { lo, hi: Math.max(hi, lo) }];
    }),
  );
  const at = (lambda: number) => new Map(flex.map((f) => [f.e.key, Math.min(bounds.get(f.e.key)!.hi, Math.max(bounds.get(f.e.key)!.lo, f.e.dailyBudget * factor(f.score) * lambda))]));
  const sum = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);
  let [lo, hi] = [0, 100];
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (sum(at(mid)) < flexTarget) lo = mid;
    else hi = mid;
  }
  const proposed = at((lo + hi) / 2);

  const lines: AllocLine[] = [
    ...flex.map((f): AllocLine => {
      let p = r2(proposed.get(f.e.key) ?? f.e.dailyBudget);
      // Variações mínimas não justificam uma alteração na plataforma.
      if (Math.abs(p - f.e.dailyBudget) < Math.max(1, f.e.dailyBudget * 0.03)) p = f.e.dailyBudget;
      const change = r2(p - f.e.dailyBudget);
      const limited = change !== 0 && Math.abs(Math.abs(change) - f.e.dailyBudget * step) < 0.02;
      const dir = change > 0 ? "aumentar" : change < 0 ? "reduzir" : f.score < 1 && growing ? "manter (abaixo do objetivo: não recebe mais orçamento)" : "manter";
      return {
        entity: f.e,
        current: f.e.dailyBudget,
        proposed: p,
        change,
        changePct: f.e.dailyBudget ? change / f.e.dailyBudget : 0,
        score: f.score,
        reason: `${f.reason} → ${dir}${limited ? ` (limitado ao passo máximo de ${Math.round(step * 100)}%)` : ""}.`,
        limitedByStep: limited,
      };
    }),
    ...fixed,
  ].sort((a, b) => b.change - a.change || b.current - a.current);

  const proposedDaily = r2(lines.reduce((s, l) => s + l.proposed, 0));
  const currentDaily = r2(fixedDaily + flexCurrent);
  if (dailyTarget > 0 && Math.abs(proposedDaily - dailyTarget) / dailyTarget > 0.05 && flex.length) {
    warnings.push(`Com o passo máximo de ${Math.round(i.maxStepPct * 100)}% por alteração, o total proposto (${fmtEur(proposedDaily)}/dia) fica afastado do ritmo necessário (${fmtEur(dailyTarget)}/dia). Serão precisos vários ciclos.`);
  }
  const by = (k: "current" | "proposed") => ({
    GOOGLE_ADS: r2(lines.filter((l) => l.entity.platform === "GOOGLE_ADS").reduce((s, l) => s + l[k], 0)),
    META_ADS: r2(lines.filter((l) => l.entity.platform === "META_ADS").reduce((s, l) => s + l[k], 0)),
  });
  return { dailyTarget, currentDaily, proposedDaily, goal, split: { before: by("current"), after: by("proposed") }, lines, warnings };
}
