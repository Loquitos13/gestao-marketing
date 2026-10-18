import { describe, expect, it } from "vitest";
import { cpa, cpm, ctr, delta, expectedOrganicCtr, projectSpend, roas, roi, safeDiv } from "@/server/metrics/calc";
import { aggregateAdRows, aggregateSearch, deriveAd } from "@/server/metrics/aggregate";
import { convertAmount } from "@/server/queries/fx";

describe("conversão de moeda", () => {
  const table = { date: "2026-10-01", rates: new Map([["USD>EUR", 0.9], ["EUR>GBP", 0.85]]) };
  it("usa taxa direta, inversa ou cruzada via EUR", () => {
    expect(convertAmount(100, "EUR", "EUR", table)).toBe(100);
    expect(convertAmount(100, "USD", "EUR", table)).toBeCloseTo(90);
    expect(convertAmount(90, "EUR", "USD", table)).toBeCloseTo(100);
    expect(convertAmount(100, "USD", "GBP", table)).toBeCloseTo(76.5);
  });
  it("sem taxa registada devolve null em vez de assumir 1:1", () => {
    expect(convertAmount(100, "BRL", "EUR", table)).toBeNull();
    expect(convertAmount(100, "BRL", "USD", table)).toBeNull();
  });
});

describe("calc", () => {
  it("divisão por zero ou valores ausentes devolve null, nunca 0 nem Infinity", () => {
    expect(safeDiv(10, 0)).toBeNull();
    expect(safeDiv(null, 5)).toBeNull();
    expect(safeDiv(5, undefined)).toBeNull();
    expect(safeDiv(Infinity, 2)).toBeNull();
    expect(ctr(0, 0)).toBeNull();
    expect(cpa(100, 0)).toBeNull();
    expect(roas(null, 100)).toBeNull();
  });

  it("calcula métricas derivadas", () => {
    expect(ctr(50, 1000)).toBeCloseTo(0.05);
    expect(cpm(25, 10000)).toBeCloseTo(2.5);
    expect(cpa(200, 8)).toBe(25);
    expect(roas(500, 100)).toBe(5);
  });

  it("ROI exige margem bruta válida", () => {
    expect(roi(1000, 200, null)).toBeNull();
    expect(roi(1000, 200, 0)).toBeNull();
    expect(roi(1000, 200, 1.5)).toBeNull();
    expect(roi(1000, 200, 0.4)).toBeCloseTo(1);
  });

  it("delta trata zeros e ausências explicitamente", () => {
    expect(delta(null, 10)).toMatchObject({ pct: null, status: "unavailable" });
    expect(delta(0, 0)).toMatchObject({ pct: 0, status: "flat" });
    expect(delta(5, 0)).toMatchObject({ pct: null, status: "new", abs: 5 });
    expect(delta(110, 100)).toMatchObject({ status: "up" });
    expect(delta(110, 100).pct).toBeCloseTo(0.1);
    expect(delta(90, 100).status).toBe("down");
    expect(delta(100.2, 100).status).toBe("flat");
    expect(delta(-50, -100).pct).toBeCloseTo(0.5);
  });

  it("projeção ignora ritmos negativos e dias restantes negativos", () => {
    expect(projectSpend(100, 10, 5)).toBe(150);
    expect(projectSpend(100, -10, 5)).toBe(100);
    expect(projectSpend(100, 10, -2)).toBe(100);
  });

  it("curva de CTR orgânico esperado é decrescente", () => {
    let prev = 1;
    for (const p of [1, 1.5, 2, 3, 5, 8, 10, 15, 30]) {
      const v = expectedOrganicCtr(p);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("aggregate", () => {
  it("métricas opcionais ficam null se nenhuma linha as tiver (não são somadas como 0)", () => {
    const t = aggregateAdRows([
      { impressions: 100, clicks: 10, cost: 5 },
      { impressions: 200, clicks: 20, cost: 10 },
    ]);
    expect(t.conversions).toBeNull();
    expect(t.conversionValue).toBeNull();
    expect(t.impressions).toBe(300);
    expect(deriveAd(t).cpa).toBeNull();
    expect(deriveAd(t).roas).toBeNull();
  });

  it("soma métricas opcionais apenas das linhas que as têm", () => {
    const t = aggregateAdRows([
      { impressions: 100, clicks: 10, cost: 5, conversions: 2 },
      { impressions: 100, clicks: 10, cost: 5, conversions: null },
    ]);
    expect(t.conversions).toBe(2);
  });

  it("alcance somado de vários dias é assinalado como aproximado", () => {
    expect(aggregateAdRows([{ impressions: 1, clicks: 0, cost: 0, reach: 100 }]).reachIsApproximate).toBe(false);
    const t = aggregateAdRows([
      { impressions: 1, clicks: 0, cost: 0, reach: 100 },
      { impressions: 1, clicks: 0, cost: 0, reach: 80 },
    ]);
    expect(t.reach).toBe(180);
    expect(t.reachIsApproximate).toBe(true);
  });

  it("quota de impressões é média ponderada pelas impressões elegíveis", () => {
    const t = aggregateAdRows([
      { impressions: 50, clicks: 0, cost: 0, searchImpressionShare: 0.5, eligibleImpressionsApprox: 100 },
      { impressions: 90, clicks: 0, cost: 0, searchImpressionShare: 0.9, eligibleImpressionsApprox: 100 },
    ]);
    expect(t.searchImpressionShare).toBeCloseTo(0.7);
  });

  it("posição média SEO é ponderada por impressões", () => {
    const s = aggregateSearch([
      { clicks: 10, impressions: 100, positionSum: 100 * 2 },
      { clicks: 1, impressions: 900, positionSum: 900 * 12 },
    ]);
    expect(s.position).toBeCloseTo(11);
    expect(s.ctr).toBeCloseTo(0.011);
    expect(aggregateSearch([]).position).toBeNull();
  });

  it("CPL divide só o custo das linhas que reportam leads", () => {
    const t = aggregateAdRows([
      { impressions: 1, clicks: 0, cost: 2000, leads: null },
      { impressions: 1, clicks: 0, cost: 1000, leads: 50 },
    ]);
    expect(t.leadCost).toBe(1000);
    expect(deriveAd(t).cpl).toBe(20);
    expect(deriveAd(aggregateAdRows([{ impressions: 1, clicks: 0, cost: 500, leads: null }])).cpl).toBeNull();
  });
});
