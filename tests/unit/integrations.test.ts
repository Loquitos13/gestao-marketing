import { describe, expect, it, vi } from "vitest";
import type { OAuthCredential } from "@prisma/client";
import { backoffDelay, classifyStatus, IntegrationError, requestJson } from "@/server/integrations/http";
import { gscQuery } from "@/server/integrations/google/search-console";
import { classifyGoogleAds, gaqlSearch, mapMetrics, normalizeDevice } from "@/server/integrations/google/ads";
import { chunks, mapInsight, pickAction } from "@/server/integrations/meta/ads";
import { classifyMeta, graphPaginate } from "@/server/integrations/meta/graph";
import { parseSemrushCsv } from "@/server/integrations/semrush";
import { getValidAccessToken } from "@/server/integrations/tokens";
import { dedupe } from "@/server/sync/writer";
import { decrypt, encrypt } from "@/lib/crypto";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const noSleep = async () => {};

describe("cliente HTTP", () => {
  it("classifica estados HTTP", () => {
    expect(classifyStatus(401)).toBe("AUTH");
    expect(classifyStatus(403)).toBe("PERMISSION");
    expect(classifyStatus(429)).toBe("RATE_LIMIT");
    expect(classifyStatus(503)).toBe("TRANSIENT");
    expect(classifyStatus(400)).toBe("INVALID_REQUEST");
  });

  it("backoff exponencial com teto e respeito por Retry-After", () => {
    expect(backoffDelay(0, 1000, null, () => 0)).toBe(1000);
    expect(backoffDelay(3, 1000, null, () => 0)).toBe(8000);
    expect(backoffDelay(20, 1000, null, () => 0)).toBe(60000);
    expect(backoffDelay(0, 1000, 7)).toBe(7000);
  });

  it("repete em 429/5xx e acaba por ter sucesso", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ error: "rate" }, 429, { "retry-after": "1" })).mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json({ ok: 1 }));
    const sleep = vi.fn(noSleep);
    await expect(requestJson("https://x", { fetchImpl: f, sleep })).resolves.toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
  });

  it("não repete erros de autorização", async () => {
    const f = vi.fn().mockResolvedValue(json({ error: "invalid_grant", error_description: "Token expired" }, 401));
    await expect(requestJson("https://x", { fetchImpl: f, sleep: noSleep })).rejects.toMatchObject({ kind: "AUTH", status: 401 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("falhas de rede são transitórias e limitadas por maxRetries", async () => {
    const f = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    await expect(requestJson("https://x", { fetchImpl: f, sleep: noSleep, maxRetries: 2 })).rejects.toMatchObject({ kind: "TRANSIENT" });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("mensagens de erro não expõem tokens", () => {
    const e = new IntegrationError("falhou https://graph/x?access_token=EAAB123&x=1", "UNKNOWN");
    expect(e.message).not.toContain("EAAB123");
  });
});

describe("conectores (fetch simulado)", () => {
  it("Search Console: pagina por startRow até receber menos de 25 000 linhas", async () => {
    const row = { keys: ["2026-10-01", "q"], clicks: 1, impressions: 10, ctr: 0.1, position: 3 };
    const f = vi.fn().mockResolvedValueOnce(json({ rows: Array(25000).fill(row) })).mockResolvedValueOnce(json({ rows: [row, row] }));
    const rows = await gscQuery("https://site/", "tok", { startDate: "2026-10-01", endDate: "2026-10-01", dimensions: ["date", "query"] }, f);
    expect(rows).toHaveLength(25002);
    const second = JSON.parse(f.mock.calls[1][1].body);
    expect(second.startRow).toBe(25000);
    expect(f.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  });

  it("Google Ads: segue nextPageToken e envia developer-token/login-customer-id", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ results: [{ campaign: { id: "1" } }], nextPageToken: "p2" })).mockResolvedValueOnce(json({ results: [{ campaign: { id: "2" } }] }));
    const rows = await gaqlSearch("123-456-7890", "SELECT campaign.id FROM campaign", "tok", "999-000-1111", f);
    expect(rows).toHaveLength(2);
    expect(String(f.mock.calls[0][0])).toContain("/customers/1234567890/googleAds:search");
    expect(f.mock.calls[0][1].headers["developer-token"]).toBeTruthy();
    expect(f.mock.calls[0][1].headers["login-customer-id"]).toBe("9990001111");
    expect(JSON.parse(f.mock.calls[1][1].body).pageToken).toBe("p2");
  });

  it("Google Ads: micros, conversões ausentes e classificação de erros", () => {
    const m = mapMetrics({ metrics: { impressions: "1000", clicks: "50", costMicros: "12345678" } }, "EUR", false);
    expect(m.cost).toBe(12.35);
    expect(m.conversions).toBeNull();
    expect(m.leads).toBeNull();
    expect(classifyGoogleAds(429, { error: { status: "RESOURCE_EXHAUSTED" } })).toBe("RATE_LIMIT");
    expect(classifyGoogleAds(403, { error: { details: "DEVELOPER_TOKEN_NOT_APPROVED" } })).toBe("PERMISSION");
    expect(normalizeDevice("MOBILE")).toBeTruthy();
  });

  it("Meta: paginação por cursor e códigos de erro", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ data: [{ id: 1 }], paging: { next: "https://graph.facebook.com/v25.0/next?after=x" } })).mockResolvedValueOnce(json({ data: [{ id: 2 }] }));
    const rows = await graphPaginate<{ id: number }>("me/adaccounts", "tok", { fields: "id" }, f);
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
    expect(classifyMeta(400, { error: { code: 190 } })).toBe("AUTH");
    expect(classifyMeta(400, { error: { code: 17 } })).toBe("RATE_LIMIT");
    expect(classifyMeta(400, { error: { code: 200 } })).toBe("PERMISSION");
    expect(classifyMeta(200, { data: [] })).toBeNull();
  });

  it("Meta: escolhe a primeira ação preferida (evita contar omni + pixel em duplicado)", () => {
    const actions = [
      { action_type: "omni_purchase", value: "5" },
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "5" },
      { action_type: "lead", value: "2" },
    ];
    expect(pickAction(actions, ["omni_purchase", "offsite_conversion.fb_pixel_purchase"])).toBe(5);
    const sales = mapInsight({ campaign_id: "c", date_start: "2026-10-01", spend: "10.5", impressions: "100", clicks: "4", actions, action_values: [{ action_type: "omni_purchase", value: "250" }] }, "OUTCOME_SALES", "CAMPAIGN");
    expect(sales).toMatchObject({ conversions: 5, conversionValue: 250, leads: 2, cost: 10.5 });
    const leads = mapInsight({ campaign_id: "c", date_start: "2026-10-01", actions }, "OUTCOME_LEADS", "CAMPAIGN");
    expect(leads).toMatchObject({ conversions: 2, conversionValue: null });
  });

  it("Meta: divide intervalos longos em blocos", () => {
    const c = chunks("2026-01-01", "2026-03-15", 30);
    expect(c[0]).toEqual({ since: "2026-01-01", until: "2026-01-30" });
    expect(c.at(-1)!.until).toBe("2026-03-15");
  });

  it("Semrush: CSV e erros", () => {
    expect(parseSemrushCsv("Keyword;Position\nsapatos;3\nbotas;12")).toEqual([
      { Keyword: "sapatos", Position: "3" },
      { Keyword: "botas", Position: "12" },
    ]);
    expect(() => parseSemrushCsv("ERROR 50 :: NOTHING FOUND")).toThrowError(IntegrationError);
    expect(() => parseSemrushCsv("ERROR 132 :: API UNITS BALANCE IS ZERO")).toThrow(/Semrush/);
  });

  it("deduplicação pela chave natural (a última prevalece)", () => {
    const r = dedupe([{ k: "a", v: 1 }, { k: "b", v: 2 }, { k: "a", v: 3 }], (x) => x.k);
    expect(r).toEqual([{ k: "a", v: 3 }, { k: "b", v: 2 }]);
  });
});

describe("tokens OAuth", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  const cred = (over: Partial<OAuthCredential>): OAuthCredential =>
    ({ id: "cr1", organizationId: "o", provider: "GOOGLE", externalUserId: null, externalUserName: null, scopes: [], accessTokenEnc: null, refreshTokenEnc: null, accessTokenExpiresAt: null, status: "ACTIVE", lastRefreshedAt: null, lastError: null, createdAt: now, updatedAt: now, ...over }) as OAuthCredential;
  const fakeDb = () => {
    const update = vi.fn(async (a: unknown) => a);
    return { db: { oAuthCredential: { update } } as never, update };
  };

  it("devolve o token válido sem renovar", async () => {
    const { db, update } = fakeDb();
    const t = await getValidAccessToken(cred({ accessTokenEnc: encrypt("AT"), accessTokenExpiresAt: new Date(now.getTime() + 3600_000) }), { db, now: () => now });
    expect(t).toBe("AT");
    expect(update).not.toHaveBeenCalled();
  });

  it("renova token Google expirado e guarda-o encriptado", async () => {
    const { db, update } = fakeDb();
    const refreshGoogle = vi.fn(async () => ({ access_token: "NEW", expires_in: 3600, scope: "", token_type: "Bearer" }));
    const t = await getValidAccessToken(cred({ accessTokenEnc: encrypt("OLD"), accessTokenExpiresAt: new Date(now.getTime() - 1000), refreshTokenEnc: encrypt("RT") }), { db, now: () => now, refreshGoogle });
    expect(t).toBe("NEW");
    expect(refreshGoogle).toHaveBeenCalledWith("RT");
    const data = (update.mock.calls[0][0] as { data: { accessTokenEnc: string; status: string } }).data;
    expect(data.accessTokenEnc).not.toContain("NEW");
    expect(decrypt(data.accessTokenEnc)).toBe("NEW");
    expect(data.status).toBe("ACTIVE");
  });

  it("invalid_grant marca a credencial como EXPIRED", async () => {
    const { db, update } = fakeDb();
    const refreshGoogle = vi.fn(async () => {
      throw new IntegrationError("invalid_grant", "INVALID_REQUEST", 400);
    });
    await expect(getValidAccessToken(cred({ refreshTokenEnc: encrypt("RT") }), { db, now: () => now, refreshGoogle })).rejects.toBeInstanceOf(IntegrationError);
    expect((update.mock.calls[0][0] as { data: { status: string } }).data.status).toBe("EXPIRED");
  });

  it("credencial revogada e token Meta expirado exigem reautorização", async () => {
    const { db } = fakeDb();
    await expect(getValidAccessToken(cred({ status: "REVOKED" }), { db, now: () => now })).rejects.toMatchObject({ kind: "AUTH" });
    await expect(getValidAccessToken(cred({ provider: "META", accessTokenEnc: encrypt("x"), accessTokenExpiresAt: new Date(now.getTime() - 1) }), { db, now: () => now })).rejects.toMatchObject({ kind: "AUTH" });
  });
});
