import { addDays, addMonths, endOfMonth, startOfMonth, startOfQuarter, todayInTz, type ISODate } from "@/lib/dates";

export type Frequency = "WEEKLY" | "MONTHLY" | "QUARTERLY";

/** Converte "data local + hora" num fuso para instante UTC (iterativo, robusto a mudanças de hora). */
export function zonedTimeToUtc(date: ISODate, hour: number, tz: string): Date {
  let guess = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(guess);
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const local = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"));
    const target = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hour);
    const diff = target - local;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

/**
 * Próxima execução (UTC) estritamente depois de `after`:
 *  WEEKLY → dia da semana indicado (1 = segunda); MONTHLY → dia 1; QUARTERLY → 1.º dia do trimestre seguinte (relatório do trimestre que terminou).
 */
export function nextRunAt(freq: Frequency, tz: string, hour: number, after: Date, dayOfWeek = 1): Date {
  let d = todayInTz(tz, after);
  for (let i = 0; i < 400; i++) {
    const dt = new Date(`${d}T12:00:00Z`);
    const dow = dt.getUTCDay() || 7;
    const ok = freq === "WEEKLY" ? dow === dayOfWeek : freq === "MONTHLY" ? d.endsWith("-01") : d === startOfQuarter(d) && d.endsWith("-01");
    if (ok) {
      const at = zonedTimeToUtc(d, hour, tz);
      if (at > after) return at;
    }
    d = addDays(d, 1);
  }
  throw new Error("Não foi possível calcular a próxima execução");
}

/** Período coberto por um relatório executado na data local `runDate`. */
export function periodForRun(freq: Frequency, runDate: ISODate): { start: ISODate; end: ISODate; kind: string } {
  if (freq === "WEEKLY") return { start: addDays(runDate, -7), end: addDays(runDate, -1), kind: "WEEKLY" };
  if (freq === "MONTHLY") {
    const start = addMonths(startOfMonth(runDate), -1);
    return { start, end: endOfMonth(start), kind: "MONTHLY" };
  }
  const start = addMonths(startOfQuarter(runDate), -3);
  return { start, end: addDays(startOfQuarter(runDate), -1), kind: "QUARTERLY" };
}
