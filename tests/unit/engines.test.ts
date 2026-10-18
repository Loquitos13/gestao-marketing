import { describe, expect, it } from "vitest";
import { exceeds, severityFor, shouldNotify } from "@/server/alerts/evaluate";
import { ruleBudgetOverrun, ruleCpaIncrease, runRules, type RuleInput } from "@/server/intelligence/rules";
import { sanitizeCell, toCsv } from "@/server/reports/csv";
import { pdfSafe } from "@/server/reports/pdf-parts";
import { generateDemo } from "@/demo/persist";
import { DEMO_CLIENTS } from "@/demo/specs";

const fmt = { locale: "pt-PT", currency: "EUR", timezone: "Europe/Lisbon" };
const baseInput = (over: Partial<RuleInput> = {}): RuleInput => ({ fmt, windowLabel: "últimos 14 dias", goals: {}, campaigns: [], ads: [], landingPages: [], siteKeyEventRate: null, queries: [], pages: [], pacing: [], ...over });

describe("alertas", () => {
  it("limiar por direção e amostra mínima", () => {
    expect(exceeds(130, 100, 0.25, "up")).toBe(true);
    expect(exceeds(120, 100, 0.25, "up")).toBe(false);
    expect(exceeds(70, 100, 0.25, "down")).toBe(true);
    expect(exceeds(70, 4, 0.25, "down", 5)).toBe(false);
    expect(exceeds(null, 100, 0.1, "both")).toBe(false);
    expect(exceeds(5, 0, 0.1, "up")).toBe(false);
  });

  it("período de silêncio controla a frequência de notificações", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    expect(shouldNotify(null, 24, now)).toBe(true);
    expect(shouldNotify(new Date("2026-10-14T00:00:00Z"), 24, now)).toBe(false);
    expect(shouldNotify(new Date("2026-10-13T11:00:00Z"), 24, now)).toBe(true);
  });

  it("severidade crítica quando a variação é o dobro do limiar", () => {
    expect(severityFor(0.5, 0.25)).toBe("CRITICAL");
    expect(severityFor(0.3, 0.25)).toBe("WARNING");
    expect(severityFor(null, 0.25)).toBe("WARNING");
  });
});

describe("recomendações", () => {
  const camp = (cur: { cost: number; conv: number }, prev: { cost: number; conv: number }) => ({
    id: "c1",
    name: "Pesquisa | Marca",
    platform: "GOOGLE_ADS" as const,
    cur: { impressions: 10000, clicks: 500, cost: cur.cost, conversions: cur.conv, conversionValue: null },
    prev: { impressions: 10000, clicks: 500, cost: prev.cost, conversions: prev.conv, conversionValue: null },
  });

  it("CPA a subir gera proposta com evidência, sem ação automática", () => {
    const r = ruleCpaIncrease(baseInput({ campaigns: [camp({ cost: 1000, conv: 20 }, { cost: 600, conv: 20 })] }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ type: "CPA_INCREASE", source: "RULE", entityId: "c1", priority: 1 });
    expect(r[0].evidence.cpaDeltaPct).toBeCloseTo(0.6667, 3);
    expect(r[0].explanation).toMatch(/não estabelece a causa/);
  });

  it("amostra insuficiente não gera recomendação", () => {
    expect(ruleCpaIncrease(baseInput({ campaigns: [camp({ cost: 1000, conv: 4 }, { cost: 100, conv: 4 })] }))).toHaveLength(0);
  });

  it("projeção acima do orçamento é marcada como estatística", () => {
    const r = ruleBudgetOverrun(baseInput({ pacing: [{ scope: "Total", platform: null, amount: 1000, projection: 1300, spent: 600, remainingDays: 10 }] }));
    expect(r[0]).toMatchObject({ type: "BUDGET_OVERRUN", source: "STATISTICAL", priority: 1 });
    expect(runRules(baseInput())).toEqual([]);
  });

  it("fingerprints são estáveis (deduplicação entre execuções)", () => {
    const i = baseInput({ campaigns: [camp({ cost: 1000, conv: 20 }, { cost: 600, conv: 20 })] });
    expect(runRules(i).map((r) => r.fingerprint)).toEqual(runRules(i).map((r) => r.fingerprint));
  });
});

describe("exportações", () => {
  it("CSV protege contra injeção de fórmulas e escapa separadores", () => {
    expect(sanitizeCell("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(sanitizeCell("+351 912")).toBe("'+351 912");
    expect(sanitizeCell("@cmd")).toBe("'@cmd");
    expect(sanitizeCell(-5)).toBe("-5");
    expect(sanitizeCell(null)).toBe("");
    expect(sanitizeCell(Infinity)).toBe("");
    const csv = toCsv(["Nome", "Valor"], [["a;b", 1.5], ['diz "olá"', null]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"a;b";1.5');
    expect(csv).toContain('"diz ""olá""";');
  });

  it("texto para PDF sem caracteres fora de WinAnsi", () => {
    expect(pdfSafe("CPA ≤ 40 € → ok")).toBe("CPA <= 40 € -> ok");
    expect(pdfSafe("1\u202F234 Δ")).toBe("1 234 Var. ");
    expect(pdfSafe("Ótimo 🚀 ação")).toBe("Ótimo  ação");
    expect(pdfSafe(null)).toBe("");
  });
});

describe("dados de demonstração", () => {
  const spec = DEMO_CLIENTS[0];
  const a = generateDemo(spec, "2026-10-13", 21);

  it("são determinísticos", () => {
    const b = generateDemo(spec, "2026-10-13", 21);
    expect(b.metrics.length).toBe(a.metrics.length);
    expect(b.metrics.slice(0, 50)).toEqual(a.metrics.slice(0, 50));
    expect(b.search.slice(0, 50)).toEqual(a.search.slice(0, 50));
  });

  it("são internamente consistentes", () => {
    expect(a.metrics.length).toBeGreaterThan(0);
    for (const m of a.metrics) {
      expect(m.cost).toBeGreaterThanOrEqual(0);
      expect(m.clicks).toBeLessThanOrEqual(m.impressions);
      expect(m.conversions).toBeLessThanOrEqual(m.clicks + (m.interactions ?? 0) + 1e-9);
      expect(m.date >= "2026-09-23" && m.date <= "2026-10-13").toBe(true);
    }
    for (const s of a.search) {
      expect(s.clicks).toBeLessThanOrEqual(s.impressions);
      if (s.impressions > 0) expect(s.positionSum / s.impressions).toBeGreaterThanOrEqual(1);
    }
    for (const w of a.web) expect(w.engagedSessions).toBeLessThanOrEqual(w.sessions);
  });

  it("o total diário de cliques orgânicos coincide com a soma das consultas por dispositivo", () => {
    const day = "2026-10-10";
    const total = a.search.find((s) => s.dimension === "TOTAL" && s.date === day)!;
    const byDevice = a.search.filter((s) => s.dimension === "DEVICE" && s.date === day).reduce((x, s) => x + s.clicks, 0);
    expect(byDevice).toBe(total.clicks);
  });

  it("existem 3 clientes fictícios com nomes assinalados como demonstração", () => {
    expect(DEMO_CLIENTS).toHaveLength(3);
    for (const c of DEMO_CLIENTS) expect(c.name).toMatch(/DEMO/);
  });
});
