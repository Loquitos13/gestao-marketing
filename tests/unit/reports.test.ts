import { describe, expect, it } from "vitest";
import { comparisonWindow } from "@/server/reports/build";
import { toEntityRow } from "@/server/queries/ads";
import { aggregateAdRows, deriveAd } from "@/server/metrics/aggregate";

describe("comparação entre relatórios", () => {
  const reports = [
    { id: "set", start: "2026-09-01", end: "2026-09-30", generatedAt: 1 },
    { id: "out", start: "2026-10-01", end: "2026-10-31", generatedAt: 2 },
  ];

  it("o primeiro relatório não compara com nada", () => {
    expect(comparisonWindow("2026-09-01", reports)).toBeNull();
  });

  it("o relatório seguinte compara com o último que terminou antes", () => {
    expect(comparisonWindow("2026-10-01", reports)).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(comparisonWindow("2026-11-01", reports)).toEqual({ start: "2026-10-01", end: "2026-10-31" });
  });

  it("ao recalcular, o próprio relatório não serve de comparação", () => {
    expect(comparisonWindow("2026-11-01", reports, "out")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
  });

  it("só compara com relatórios de duração semelhante", () => {
    const mixed = [...reports, { id: "sem", start: "2026-11-02", end: "2026-11-08", generatedAt: 3 }];
    expect(comparisonWindow("2026-12-01", mixed, undefined, "2026-12-31")).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(comparisonWindow("2026-11-09", mixed, undefined, "2026-11-15")).toEqual({ start: "2026-11-02", end: "2026-11-08" });
    // Janeiro (31) e fevereiro (28) são ambos mensais.
    const jan = [{ id: "jan", start: "2026-01-01", end: "2026-01-31", generatedAt: 1 }];
    expect(comparisonWindow("2026-02-01", jan, undefined, "2026-02-28")).toEqual({ start: "2026-01-01", end: "2026-01-31" });
  });
});

describe("variações absolutas por entidade", () => {
  const row = (cost: number, conversions: number | null) => {
    const totals = aggregateAdRows([{ impressions: 10, clicks: 1, cost, conversions }]);
    return { key: "c1", totals, derived: deriveAd(totals) };
  };
  const info = { id: "c1", name: "C1", platform: "GOOGLE_ADS" as const, status: "ACTIVE" };

  it("conversões a cair para 0 e a subir de 0 têm variação absoluta (o pct não serve)", () => {
    expect(toEntityRow(row(100, 0), row(80, 5), info)).toMatchObject({ conversionsDeltaAbs: -5, conversionsDeltaPct: -1, costDeltaAbs: 20 });
    expect(toEntityRow(row(100, 5), row(80, 0), info)).toMatchObject({ conversionsDeltaAbs: 5, conversionsDeltaPct: null });
    expect(toEntityRow(row(100, 5), undefined, info)).toMatchObject({ conversionsDeltaAbs: null, costDeltaAbs: null });
  });
});
