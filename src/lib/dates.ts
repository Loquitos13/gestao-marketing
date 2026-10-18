/**
 * Datas de calendário como strings "YYYY-MM-DD" (sem hora, sem fuso).
 * O "hoje" é sempre calculado no fuso horário do cliente.
 */
export type ISODate = string;

export const PERIOD_PRESETS = [
  "last7",
  "last14",
  "last30",
  "last90",
  "thisMonth",
  "lastMonth",
  "lastQuarter",
  "thisYear",
  "last365",
  "custom",
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export type CompareMode = "previous" | "yoy" | "none";

export interface Period {
  start: ISODate;
  end: ISODate;
  preset: PeriodPreset;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(v: unknown): v is ISODate {
  if (typeof v !== "string" || !ISO_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function toDate(d: ISODate): Date {
  return new Date(`${d}T00:00:00Z`);
}

export function fromDate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function todayInTz(tz: string, now: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(d: ISODate, n: number): ISODate {
  const dt = toDate(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fromDate(dt);
}

export function addMonths(d: ISODate, n: number): ISODate {
  const dt = toDate(d);
  const day = dt.getUTCDate();
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() + n);
  const last = daysInMonth(fromDate(dt));
  dt.setUTCDate(Math.min(day, last));
  return fromDate(dt);
}

/** Número de dias inclusivo entre a e b. */
export function dayCount(a: ISODate, b: ISODate): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000) + 1;
}

export function startOfMonth(d: ISODate): ISODate {
  return `${d.slice(0, 7)}-01`;
}

export function daysInMonth(d: ISODate): number {
  const dt = toDate(startOfMonth(d));
  dt.setUTCMonth(dt.getUTCMonth() + 1);
  dt.setUTCDate(0);
  return dt.getUTCDate();
}

export function endOfMonth(d: ISODate): ISODate {
  return `${d.slice(0, 7)}-${String(daysInMonth(d)).padStart(2, "0")}`;
}

export function startOfQuarter(d: ISODate): ISODate {
  const m = Number(d.slice(5, 7));
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  return `${d.slice(0, 4)}-${String(qm).padStart(2, "0")}-01`;
}

export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

/**
 * Resolve um preset em datas. Os presets "últimos N dias" terminam ontem
 * (dia completo), à semelhança das plataformas de anúncios.
 */
export function resolvePeriod(preset: PeriodPreset, today: ISODate, custom?: { start?: string; end?: string }): Period {
  const yesterday = addDays(today, -1);
  switch (preset) {
    case "last7":
    case "last14":
    case "last30":
    case "last90":
    case "last365": {
      const n = Number(preset.replace("last", ""));
      return { preset, start: addDays(yesterday, -(n - 1)), end: yesterday };
    }
    case "thisMonth": {
      const start = startOfMonth(today);
      return { preset, start, end: yesterday < start ? today : yesterday };
    }
    case "lastMonth": {
      const start = addMonths(startOfMonth(today), -1);
      return { preset, start, end: endOfMonth(start) };
    }
    case "lastQuarter": {
      const start = addMonths(startOfQuarter(today), -3);
      return { preset, start, end: addDays(startOfQuarter(today), -1) };
    }
    case "thisYear": {
      const start = `${today.slice(0, 4)}-01-01`;
      return { preset, start, end: yesterday < start ? today : yesterday };
    }
    case "custom": {
      const s = custom?.start;
      const e = custom?.end;
      if (isISODate(s) && isISODate(e) && s <= e && dayCount(s, e) <= 1100) return { preset, start: s, end: e };
      return resolvePeriod("last30", today);
    }
  }
}

/**
 * Período de comparação equivalente:
 *  - Meses/trimestres completos → mês/trimestre anterior completo.
 *  - Mês/ano até à data → mesmo nº de dias no período anterior.
 *  - Restantes → mesmo nº de dias imediatamente antes.
 *  - yoy → mesmas datas no ano anterior.
 */
export function comparePeriod(p: Period, mode: CompareMode): { start: ISODate; end: ISODate } | null {
  if (mode === "none") return null;
  if (mode === "yoy") return { start: addMonths(p.start, -12), end: addMonths(p.end, -12) };
  if (p.preset === "lastMonth") {
    const start = addMonths(p.start, -1);
    return { start, end: endOfMonth(start) };
  }
  if (p.preset === "lastQuarter") {
    const start = addMonths(p.start, -3);
    return { start, end: addDays(p.start, -1) };
  }
  if (p.preset === "thisMonth") {
    const start = addMonths(p.start, -1);
    const len = dayCount(p.start, p.end);
    return { start, end: minDate(addDays(start, len - 1), endOfMonth(start)) };
  }
  const len = dayCount(p.start, p.end);
  const end = addDays(p.start, -1);
  return { start: addDays(end, -(len - 1)), end };
}

/** Rótulos de semana ISO (segunda-feira) e mês para agregação temporal. */
export function weekStart(d: ISODate): ISODate {
  const dow = toDate(d).getUTCDay() || 7;
  return addDays(d, 1 - dow);
}

export function autoGranularity(start: ISODate, end: ISODate): "day" | "week" | "month" {
  const n = dayCount(start, end);
  if (n <= 62) return "day";
  if (n <= 200) return "week";
  return "month";
}
