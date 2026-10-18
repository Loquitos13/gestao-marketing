import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/audit", () => ({ audit: async () => undefined }));

import type { DataSource } from "@prisma/client";
import { budgetBlockReason, checkBudgetChange, clampStep, nativeStatus, sameState } from "@/server/ads-write/guards";
import { allocateBudget, shrink, type AllocEntity } from "@/server/ads-write/allocation";
import { validateMetaAd, validateRsa, validPublicUrl, type MetaLinkAdSpec, type RsaSpec } from "@/server/ads-write/creative";
import { buildOperation, googleExecutor } from "@/server/ads-write/google";
import { buildFields } from "@/server/ads-write/meta";
import { metaCurrencyOffset } from "@/server/integrations/meta/ads";
import { confirmAndApply } from "@/server/ads-write/service";
import type { AdsExecutor, WriteContext } from "@/server/ads-write/types";

const ds = (over: Partial<DataSource> = {}) => ({ id: "ds1", externalId: "123-456-7890", currency: "EUR", platform: "GOOGLE_ADS", origin: "REAL", settings: {}, ...over }) as DataSource;
const ctx = (over: Partial<DataSource> = {}, fetchImpl?: typeof fetch): WriteContext => ({ ds: ds(over), token: "tok", loginCustomerId: null, fetchImpl });

describe("proteções de escrita", () => {
  const camp = { platform: "GOOGLE_ADS" as const, level: "CAMPAIGN" as const, dailyBudget: 100 };
  it("limita a variação ao passo máximo do cliente", () => {
    expect(checkBudgetChange(camp, 120, 0.2)).toBeNull();
    expect(checkBudgetChange(camp, 121, 0.2)).toMatch(/excede o limite de 20%/);
    expect(checkBudgetChange(camp, 79, 0.2)).toMatch(/excede/);
    expect(checkBudgetChange(camp, 150, 0.9)).toBeNull();
    expect(checkBudgetChange(camp, 160, 0.9)).toMatch(/limite de 50%/);
  });
  it("aceita o valor que clampStep produz (arredondamento a cêntimos)", () => {
    const e = { ...camp, dailyBudget: 10.03 };
    expect(clampStep(10.03, 999, 0.2)).toBe(12.04);
    expect(checkBudgetChange(e, clampStep(10.03, 999, 0.2), 0.2)).toBeNull();
    for (let cents = 1; cents < 100; cents++) {
      const cur = 10 + cents / 100;
      expect(checkBudgetChange({ ...camp, dailyBudget: cur }, clampStep(cur, 999, 0.2), 0.2)).toBeNull();
      expect(checkBudgetChange({ ...camp, dailyBudget: cur }, clampStep(cur, 1, 0.2), 0.2)).toBeNull();
    }
  });
  it("recusa orçamentos não editáveis", () => {
    expect(budgetBlockReason({ ...camp, shared: true })).toMatch(/partilhado/);
    expect(budgetBlockReason({ platform: "GOOGLE_ADS", level: "AD_GROUP", dailyBudget: 10 })).toMatch(/definido na campanha/);
    expect(budgetBlockReason({ platform: "META_ADS", level: "CAMPAIGN", dailyBudget: null, metaBudgetLevel: "ADSET" })).toMatch(/conjuntos/);
    expect(budgetBlockReason({ platform: "META_ADS", level: "AD_GROUP", dailyBudget: 20, lifetime: true })).toMatch(/vitalício/);
    expect(checkBudgetChange(camp, 0.5, 0.99)).toMatch(/mínimo/);
    expect(checkBudgetChange(camp, 100, 0.2)).toMatch(/igual/);
  });
  it("traduz estados e compara com tolerância", () => {
    expect(nativeStatus("GOOGLE_ADS", "ACTIVE")).toBe("ENABLED");
    expect(nativeStatus("META_ADS", "ACTIVE")).toBe("ACTIVE");
    expect(sameState({ dailyBudget: 40.001 }, { dailyBudget: 40 }, ["dailyBudget"])).toBe(true);
    expect(sameState({ status: "PAUSED" }, { status: "ENABLED" }, ["status"])).toBe(false);
    expect(clampStep(100, 200, 0.2)).toBe(120);
    expect(clampStep(100, 10, 0.2)).toBe(80);
  });
});

describe("pedidos às plataformas", () => {
  it("Google: orçamento em micros no recurso campaignBudgets e estado com updateMask", () => {
    const b = buildOperation(ctx(), { operation: "SET_DAILY_BUDGET", target: { level: "CAMPAIGN", externalId: "11", budgetResourceName: "customers/1234567890/campaignBudgets/77" }, after: { dailyBudget: 45.678 } });
    expect(b).toEqual({ service: "campaignBudgets", op: { update: { resourceName: "customers/1234567890/campaignBudgets/77", amountMicros: "45680000" }, updateMask: "amountMicros" } });
    const s = buildOperation(ctx(), { operation: "SET_STATUS", target: { level: "AD", externalId: "9", adGroupExternalId: "5" }, after: { status: "PAUSED" } });
    expect(s).toEqual({ service: "adGroupAds", op: { update: { resourceName: "customers/1234567890/adGroupAds/5~9", status: "PAUSED" }, updateMask: "status" } });
  });
  it("Google: recusa recursos de outra conta e IDs não numéricos (injeção GAQL)", () => {
    expect(() => buildOperation(ctx(), { operation: "SET_DAILY_BUDGET", target: { level: "CAMPAIGN", externalId: "1", budgetResourceName: "customers/999/campaignBudgets/1" }, after: { dailyBudget: 10 } })).toThrow(/não pertence/);
    expect(() => buildOperation(ctx(), { operation: "SET_STATUS", target: { level: "CAMPAIGN", externalId: "1 OR 1=1" }, after: { status: "PAUSED" } })).toThrow(/inválido/);
  });
  it("Google: validateOnly na pré-validação, sem repetições", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    await googleExecutor.validate(ctx({}, f), { operation: "SET_STATUS", target: { level: "CAMPAIGN", externalId: "42" }, after: { status: "PAUSED" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/customers\/1234567890\/campaigns:mutate$/);
    expect(calls[0]!.body).toMatchObject({ validateOnly: true, partialFailure: false });
  });
  it("Meta: orçamento em unidades mínimas da moeda", () => {
    expect(metaCurrencyOffset("EUR")).toBe(100);
    expect(metaCurrencyOffset("JPY")).toBe(1);
    expect(buildFields(ctx({ platform: "META_ADS", currency: "EUR" }), { operation: "SET_DAILY_BUDGET", target: { level: "AD_GROUP", externalId: "1" }, after: { dailyBudget: 12.5 } })).toEqual({ daily_budget: "1250" });
    expect(() => buildFields(ctx({ platform: "META_ADS" }), { operation: "SET_STATUS", target: { level: "AD", externalId: "1" }, after: { status: "DELETED" } })).toThrow();
  });
});

describe("validação de anúncios", () => {
  const rsa: RsaSpec = { kind: "GOOGLE_RSA", headlines: ["Título um", "Título dois", "Título três"], descriptions: ["Descrição um.", "Descrição dois."], finalUrl: "https://exemplo.pt/x" };
  it("RSA dentro dos limites é aceite; fora dos limites é recusado", () => {
    expect(validateRsa(rsa)).toEqual([]);
    expect(validateRsa({ ...rsa, headlines: ["a", "b"] }).join()).toMatch(/3 a 15 títulos/);
    expect(validateRsa({ ...rsa, headlines: [...rsa.headlines, "x".repeat(31)] }).join()).toMatch(/máximo 30/);
    expect(validateRsa({ ...rsa, headlines: ["Igual", "igual", "Outro"] }).join()).toMatch(/repetidos/);
    expect(validateRsa({ ...rsa, finalUrl: "http://exemplo.pt" }).join()).toMatch(/https/);
    expect(validateRsa({ ...rsa, path2: "b" }).join()).toMatch(/caminho 2 exige/);
  });
  it("Meta: página, URLs públicas e textos obrigatórios", () => {
    const m: MetaLinkAdSpec = { kind: "META_LINK", name: "Novo", pageId: "1234567890", link: "https://exemplo.pt", message: "Texto", headline: "Título", imageUrl: "https://cdn.exemplo.pt/a.jpg", callToAction: "SHOP_NOW" };
    expect(validateMetaAd(m)).toEqual([]);
    expect(validateMetaAd({ ...m, pageId: "abc", imageUrl: "https://localhost/a.jpg" })).toHaveLength(2);
    expect(validPublicUrl("https://10.0.0.1/x")).toBe(false);
    expect(validPublicUrl("https://user:pw@exemplo.pt")).toBe(false);
  });
});

describe("distribuição de orçamento", () => {
  const e = (over: Partial<AllocEntity>): AllocEntity => ({ key: over.name ?? "x", level: "CAMPAIGN", entityId: over.name ?? "x", name: "x", platform: "GOOGLE_ADS", dailyBudget: 100, adjustable: true, cost30: 3000, conversions30: 60, value30: 12000, cost14: 1400, conversions14: 28, value14: 5600, lostBudget: 0.3, ...over });
  it("favorece quem supera o objetivo e respeita o passo máximo", () => {
    const r = allocateBudget({
      monthlyTotal: 9000,
      spentToDate: 3000,
      daysLeft: 20,
      goal: { kind: "ROAS", target: 3 },
      maxStepPct: 0.2,
      entities: [e({ name: "boa", value30: 15000, value14: 7000 }), e({ name: "fraca", value30: 6000, value14: 2800, platform: "META_ADS", lostBudget: null })],
    });
    const boa = r.lines.find((l) => l.entity.name === "boa")!;
    const fraca = r.lines.find((l) => l.entity.name === "fraca")!;
    expect(r.dailyTarget).toBe(300);
    expect(boa.proposed).toBe(120);
    expect(boa.limitedByStep).toBe(true);
    expect(fraca.proposed).toBeLessThanOrEqual(100);
    expect(r.warnings[0]).toMatch(/atribui conversões/);
  });
  it("mantém entidades com pouca amostra e não dá mais orçamento a campanhas saturadas", () => {
    const r = allocateBudget({ monthlyTotal: 9000, spentToDate: 0, daysLeft: 30, goal: { kind: "CPA", target: 50 }, maxStepPct: 0.2, entities: [e({ name: "nova", conversions30: 3 }), e({ name: "saturada", lostBudget: 0.01 })] });
    expect(r.lines.find((l) => l.entity.name === "nova")!.change).toBe(0);
    expect(r.lines.find((l) => l.entity.name === "saturada")!.proposed).toBe(100);
  });
  it("reduz primeiro as menos eficientes quando é preciso cortar", () => {
    const r = allocateBudget({ monthlyTotal: 3000, spentToDate: 0, daysLeft: 20, goal: { kind: "ROAS", target: 3 }, maxStepPct: 0.5, entities: [e({ name: "boa", value30: 15000 }), e({ name: "fraca", value30: 6000 })] });
    const boa = r.lines.find((l) => l.entity.name === "boa")!;
    const fraca = r.lines.find((l) => l.entity.name === "fraca")!;
    expect(fraca.change).toBeLessThan(boa.change);
    expect(r.proposedDaily).toBeLessThan(200);
  });
  it("encolhe a eficiência para 1 com poucas conversões", () => {
    expect(shrink(3, 0)).toBe(1);
    expect(shrink(3, 1000)).toBeCloseTo(2.98, 2);
  });
});

/** Base de dados mínima em memória para o fluxo de confirmação. */
function fakeDb(opts: { enabled?: boolean; remote?: string }) {
  const change = { id: "ch1", clientId: "c1", dataSourceId: "ds1", platform: "GOOGLE_ADS", operation: "SET_STATUS", entityLevel: "CAMPAIGN", entityId: "camp1", entityName: "Camp", before: { status: "ENABLED" }, after: { status: "PAUSED" }, status: "DRAFT", simulated: false, validation: { target: { level: "CAMPAIGN", externalId: "11" } }, revertOfId: null, recommendationId: null, source: "MANUAL" } as Record<string, unknown>;
  const campaign = { id: "camp1", clientId: "c1", name: "Camp", platform: "GOOGLE_ADS", dataSourceId: "ds1", status: "ENABLED", dailyBudget: 50, externalId: "11", raw: null };
  const db = {
    client: { findFirstOrThrow: async () => ({ id: "c1", organizationId: "o1", adsManagementEnabled: opts.enabled ?? true, maxBudgetStepPct: 0.2 }) },
    adChange: {
      count: async () => 0,
      updateMany: async ({ where, data }: { where: { status: string }; data: object }) => (change.status === where.status ? (Object.assign(change, data), { count: 1 }) : { count: 0 }),
      findUniqueOrThrow: async () => ({ ...change }),
      update: async ({ data }: { data: object }) => Object.assign(change, data),
    },
    campaign: { findFirst: async () => campaign, update: async ({ data }: { data: object }) => Object.assign(campaign, data) },
    dataSource: { findUniqueOrThrow: async () => ds() },
    recommendation: { updateMany: async () => ({ count: 0 }) },
  };
  const applied: unknown[] = [];
  const executor: AdsExecutor = { read: async () => ({ status: opts.remote ?? "ENABLED" }), validate: async () => undefined, apply: async (_c, spec) => void applied.push(spec) };
  return { db: db as never, change, campaign, applied, deps: { db: db as never, executors: { GOOGLE_ADS: executor }, writeContext: async () => ctx() } };
}

describe("confirmação e aplicação", () => {
  const input = { changeId: "ch1", clientId: "c1", organizationId: "o1", userId: "u1", acknowledged: true };
  it("aplica após confirmação e reflete o estado localmente", async () => {
    const f = fakeDb({});
    const r = await confirmAndApply(input, f.deps);
    expect(r.status).toBe("APPLIED");
    expect(f.applied).toHaveLength(1);
    expect(f.campaign.status).toBe("PAUSED");
  });
  it("aborta sem enviar nada se o estado mudou fora do hub", async () => {
    const f = fakeDb({ remote: "REMOVED" });
    await expect(confirmAndApply(input, f.deps)).rejects.toThrow(/fora do hub/);
    expect(f.applied).toHaveLength(0);
    expect(f.change.status).toBe("FAILED");
  });
  it("é idempotente: uma segunda confirmação não volta a aplicar", async () => {
    const f = fakeDb({});
    await confirmAndApply(input, f.deps);
    await expect(confirmAndApply(input, f.deps)).rejects.toThrow(/já foi processada/);
    expect(f.applied).toHaveLength(1);
  });
  it("exige gestão ativa no cliente e confirmação explícita", async () => {
    await expect(confirmAndApply(input, fakeDb({ enabled: false }).deps)).rejects.toThrow(/desligada/);
    const f = fakeDb({});
    await expect(confirmAndApply({ ...input, acknowledged: false }, f.deps)).rejects.toThrow(/Confirme/);
    expect(f.change.status).toBe("DRAFT");
  });
});
