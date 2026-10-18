import { addDays, dayCount, maxDate, minDate, type ISODate } from "@/lib/dates";
import { projectSpend, safeDiv } from "@/server/metrics/calc";

export type PacingStatus = "OVER" | "UNDER" | "ON_TRACK" | "NOT_STARTED" | "ENDED";

export interface PacingInput {
  amount: number;
  periodStart: ISODate;
  periodEnd: ISODate;
  /** Último dia com dados completos (normalmente ontem ou a data de disponibilidade da fonte). */
  asOf: ISODate;
  daily: { date: ISODate; cost: number }[];
}

export interface Pacing {
  amount: number;
  spent: number;
  remaining: number;
  pctConsumed: number | null;
  elapsedDays: number;
  totalDays: number;
  remainingDays: number;
  pctTimeElapsed: number;
  avgDaily: number | null;
  recentDaily: number | null;
  requiredDaily: number | null;
  projection: number;
  projectedVariance: number;
  projectedVariancePct: number | null;
  status: PacingStatus;
}

/**
 * Ritmo de investimento. A projeção usa a média dos últimos 7 dias com dados
 * (mais sensível a alterações recentes do que a média do período).
 */
export function computePacing(i: PacingInput, tolerance = { over: 0.05, under: 0.15 }): Pacing {
  const totalDays = dayCount(i.periodStart, i.periodEnd);
  // Dias depois de asOf não contam como gastos (seriam somados e projetados em duplicado).
  const inPeriod = i.daily.filter((d) => d.date >= i.periodStart && d.date <= minDate(i.asOf, i.periodEnd));
  const spent = Math.round(inPeriod.reduce((s, d) => s + d.cost, 0) * 100) / 100;
  if (i.asOf < i.periodStart) {
    return base(i, spent, 0, totalDays, null, null, "NOT_STARTED");
  }
  const last = minDate(i.asOf, i.periodEnd);
  const elapsedDays = dayCount(i.periodStart, last);
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  const avgDaily = safeDiv(spent, elapsedDays);
  const recentFrom = maxDate(i.periodStart, addDays(last, -6));
  const recent = inPeriod.filter((d) => d.date >= recentFrom && d.date <= last);
  const recentDaily = safeDiv(
    recent.reduce((s, d) => s + d.cost, 0),
    dayCount(recentFrom, last),
  );
  const projection = Math.round(projectSpend(spent, recentDaily ?? avgDaily ?? 0, remainingDays) * 100) / 100;
  const status: PacingStatus =
    i.asOf >= i.periodEnd
      ? "ENDED"
      : projection > i.amount * (1 + tolerance.over)
        ? "OVER"
        : projection < i.amount * (1 - tolerance.under)
          ? "UNDER"
          : "ON_TRACK";
  const p = base(i, spent, elapsedDays, totalDays, avgDaily, recentDaily, status);
  return {
    ...p,
    remainingDays,
    projection,
    projectedVariance: Math.round((projection - i.amount) * 100) / 100,
    projectedVariancePct: safeDiv(projection - i.amount, i.amount),
    requiredDaily: remainingDays > 0 ? Math.max(0, (i.amount - spent) / remainingDays) : null,
  };
}

function base(i: PacingInput, spent: number, elapsedDays: number, totalDays: number, avgDaily: number | null, recentDaily: number | null, status: PacingStatus): Pacing {
  return {
    amount: i.amount,
    spent,
    remaining: Math.round((i.amount - spent) * 100) / 100,
    pctConsumed: safeDiv(spent, i.amount),
    elapsedDays,
    totalDays,
    remainingDays: totalDays - elapsedDays,
    pctTimeElapsed: elapsedDays / totalDays,
    avgDaily,
    recentDaily,
    requiredDaily: null,
    projection: spent,
    projectedVariance: spent - i.amount,
    projectedVariancePct: safeDiv(spent - i.amount, i.amount),
    status,
  };
}
