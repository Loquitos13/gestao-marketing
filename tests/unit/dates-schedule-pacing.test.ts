import { describe, expect, it } from "vitest";
import { addDays, addMonths, dayCount, eachDay, endOfMonth, startOfQuarter, todayInTz } from "@/lib/dates";
import { nextRunAt, periodForRun, zonedTimeToUtc } from "@/server/reports/schedule";
import { computePacing } from "@/server/budget/pacing";

describe("datas de calendário", () => {
  it("aritmética independente de mudanças de hora", () => {
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 3)).toBe("2026-10-27");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(dayCount("2026-03-01", "2026-03-31")).toBe(31);
    expect(eachDay("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
  });

  it("fim de mês, anos bissextos e trimestres", () => {
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 1)).toMatch(/^2026-0[23]-/);
    expect(startOfQuarter("2026-08-15")).toBe("2026-07-01");
  });

  it("'hoje' depende do fuso do cliente", () => {
    const instant = new Date("2026-10-14T23:30:00Z");
    expect(todayInTz("Europe/Lisbon", instant)).toBe("2026-10-15");
    expect(todayInTz("America/Sao_Paulo", instant)).toBe("2026-10-14");
    expect(todayInTz("UTC", instant)).toBe("2026-10-14");
  });
});

describe("agendamento de relatórios", () => {
  it("converte hora local para UTC respeitando horário de verão", () => {
    expect(zonedTimeToUtc("2026-07-01", 8, "Europe/Lisbon").toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(zonedTimeToUtc("2026-12-01", 8, "Europe/Lisbon").toISOString()).toBe("2026-12-01T08:00:00.000Z");
  });

  it("próxima execução mensal é no dia 1, estritamente depois do instante dado", () => {
    const r = nextRunAt("MONTHLY", "Europe/Lisbon", 8, new Date("2026-10-14T10:00:00Z"));
    expect(r.toISOString()).toBe("2026-11-01T08:00:00.000Z");
    const same = nextRunAt("MONTHLY", "Europe/Lisbon", 8, new Date("2026-11-01T08:00:00Z"));
    expect(same.toISOString()).toBe("2026-12-01T08:00:00.000Z");
  });

  it("execução semanal no dia da semana indicado", () => {
    const r = nextRunAt("WEEKLY", "Europe/Lisbon", 9, new Date("2026-10-14T10:00:00Z"), 1);
    expect(new Date(r).getUTCDay()).toBe(1);
    expect(r.toISOString().slice(0, 10)).toBe("2026-10-19");
  });

  it("período coberto por cada execução", () => {
    expect(periodForRun("MONTHLY", "2026-11-01")).toEqual({ start: "2026-10-01", end: "2026-10-31", kind: "MONTHLY" });
    expect(periodForRun("WEEKLY", "2026-10-19")).toEqual({ start: "2026-10-12", end: "2026-10-18", kind: "WEEKLY" });
    expect(periodForRun("QUARTERLY", "2026-10-01")).toEqual({ start: "2026-07-01", end: "2026-09-30", kind: "QUARTERLY" });
  });
});

describe("ritmo de investimento", () => {
  const daily = (from: string, n: number, cost: number) => Array.from({ length: n }, (_, i) => ({ date: addDays(from, i), cost }));

  it("no ritmo quando a projeção está dentro da tolerância", () => {
    const p = computePacing({ amount: 3100, periodStart: "2026-10-01", periodEnd: "2026-10-31", asOf: "2026-10-14", daily: daily("2026-10-01", 14, 100) });
    expect(p.spent).toBe(1400);
    expect(p.projection).toBe(3100);
    expect(p.status).toBe("ON_TRACK");
    expect(p.requiredDaily).toBeCloseTo(100);
  });

  it("acima do orçamento quando o ritmo recente acelera", () => {
    const d = [...daily("2026-10-01", 7, 100), ...daily("2026-10-08", 7, 200)];
    const p = computePacing({ amount: 3100, periodStart: "2026-10-01", periodEnd: "2026-10-31", asOf: "2026-10-14", daily: d });
    expect(p.recentDaily).toBe(200);
    expect(p.status).toBe("OVER");
  });

  it("abaixo, por iniciar e terminado", () => {
    expect(computePacing({ amount: 3100, periodStart: "2026-10-01", periodEnd: "2026-10-31", asOf: "2026-10-14", daily: daily("2026-10-01", 14, 50) }).status).toBe("UNDER");
    expect(computePacing({ amount: 1000, periodStart: "2026-11-01", periodEnd: "2026-11-30", asOf: "2026-10-14", daily: [] }).status).toBe("NOT_STARTED");
    expect(computePacing({ amount: 1000, periodStart: "2026-09-01", periodEnd: "2026-09-30", asOf: "2026-10-14", daily: daily("2026-09-01", 30, 30) }).status).toBe("ENDED");
  });

  it("ignora gastos fora do período", () => {
    const p = computePacing({ amount: 1000, periodStart: "2026-10-01", periodEnd: "2026-10-31", asOf: "2026-10-05", daily: daily("2026-09-25", 11, 10) });
    expect(p.spent).toBe(50);
  });

  it("dias depois de asOf não contam como gastos nem entram em duplicado na projeção", () => {
    const p = computePacing({ amount: 3100, periodStart: "2026-10-01", periodEnd: "2026-10-31", asOf: "2026-10-14", daily: daily("2026-10-01", 16, 100) });
    expect(p.spent).toBe(1400);
    expect(p.projection).toBe(3100);
  });
});
