import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganicContent } from "@prisma/client";
import { encrypt } from "@/lib/crypto";
import type { EntityRow } from "@/server/queries/ads";

const rows: { key: string; valueEnc: string }[] = [];
vi.mock("@/lib/prisma", () => ({ prisma: { appSetting: { findMany: async () => rows } } }));

const { getConfig, integrationStatus, invalidateConfig, settingsOverview } = await import("@/server/config/settings");
const { SETTING_FIELDS, settingGroup } = await import("@/server/config/definitions");
const { rankAds, rankPages, rankPosts, MIN_AD_IMPRESSIONS } = await import("@/server/reports/top-content");

describe("configuração editável", () => {
  beforeEach(() => {
    rows.length = 0;
    delete process.env.SETTINGS_ENV_ONLY;
    invalidateConfig();
  });
  afterEach(() => {
    process.env.SETTINGS_ENV_ONLY = "1";
    invalidateConfig();
  });

  it("valores guardados sobrepõem-se ao ambiente e são desencriptados", async () => {
    rows.push({ key: "META_APP_ID", valueEnc: encrypt("123456789") }, { key: "META_APP_SECRET", valueEnc: encrypt("a".repeat(32)) }, { key: "SEMRUSH_DATABASE", valueEnc: encrypt("es") });
    const c = await getConfig();
    expect(c.META_APP_ID).toBe("123456789");
    expect(c.SEMRUSH_DATABASE).toBe("es");
    expect((await integrationStatus()).meta).toBe(true);
  });

  it("segredos nunca são devolvidos na vista geral, só os últimos 4 caracteres", async () => {
    rows.push({ key: "META_APP_SECRET", valueEnc: encrypt("0123456789abcdef0123456789abcdef") });
    const o = await settingsOverview();
    expect(o.META_APP_SECRET).toEqual({ key: "META_APP_SECRET", source: "db", hint: "…cdef" });
    expect(JSON.stringify(o)).not.toContain("0123456789abcdef0123456789abcdef");
  });

  it("usa predefinições e ignora chaves desconhecidas", async () => {
    rows.push({ key: "DATABASE_URL", valueEnc: encrypt("postgres://x") });
    const o = await settingsOverview();
    expect(o.META_GRAPH_VERSION.source === "default" || o.META_GRAPH_VERSION.source === "env").toBe(true);
    expect(Object.keys(o)).not.toContain("DATABASE_URL");
  });

  it("SETTINGS_ENV_ONLY=1 ignora a base de dados", async () => {
    process.env.SETTINGS_ENV_ONLY = "1";
    rows.push({ key: "SEMRUSH_DATABASE", valueEnc: encrypt("es") });
    expect((await getConfig()).SEMRUSH_DATABASE).not.toBe("es");
  });

  it("valida formatos à entrada", () => {
    const f = (k: string) => SETTING_FIELDS.find((x) => x.key === k)!.schema;
    expect(f("GOOGLE_CLIENT_ID").safeParse("abc").success).toBe(false);
    expect(f("GOOGLE_CLIENT_ID").safeParse("1-x.apps.googleusercontent.com").success).toBe(true);
    expect(f("META_APP_SECRET").safeParse("curto").success).toBe(false);
    expect(f("REDIS_URL").safeParse("http://x").success).toBe(false);
    expect(f("SMTP_FROM").safeParse("Relatórios <r@agencia.pt>").success).toBe(true);
    expect(f("SMTP_HOST").safeParse("smtp.x.pt\r\nRCPT").success).toBe(false);
    expect(f("APP_URL").parse("https://hub.agencia.pt/")).toBe("https://hub.agencia.pt");
    expect(f("BACKUP_COPY_DIR").safeParse("D:\\backups\\mih").success).toBe(true);
    expect(f("BACKUP_COPY_DIR").safeParse("D:\\backups\\..\\mih").success).toBe(false);
    expect(f("BACKUP_COPY_DIR").safeParse("D:\\backups\nX").success).toBe(false);
    expect(settingGroup("google")?.fields.filter((x) => x.secret).map((x) => x.key)).toEqual(["GOOGLE_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN"]);
  });
});

const ad = (id: string, o: Partial<EntityRow>): EntityRow => ({ id, name: id, platform: "META_ADS", status: "ACTIVE", impressions: 1000, clicks: 10, cost: 50, ctr: 0.01, cpc: 5, cpm: 50, conversions: 0, cpa: null, conversionValue: null, roas: null, leads: null, cpl: null, reach: null, frequency: null, linkClicks: null, linkCtr: null, videoViews: null, ...o }) as EntityRow;

describe("top 10 conteúdos", () => {
  it("ordena anúncios por conversões, depois cliques, com mínimo de impressões e no máximo 10", () => {
    const ads = [ad("a", { conversions: 5 }), ad("b", { conversions: 9 }), ad("c", { conversions: 5, clicks: 40 }), ad("tiny", { conversions: 50, impressions: MIN_AD_IMPRESSIONS - 1 }), ...Array.from({ length: 12 }, (_, i) => ad(`x${i}`, { conversions: 0, clicks: i }))];
    const r = rankAds(ads, (id) => (id === "b" ? { title: "Título B", primaryText: null } : null));
    expect(r).toHaveLength(10);
    expect(r.slice(0, 3).map((x) => x.name)).toEqual(["b", "c", "a"]);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r[0]!.headline).toBe("Título B");
    expect(r.some((x) => x.name === "tiny")).toBe(false);
  });

  it("ordena publicações por interações e exclui as sem interações", () => {
    const post = (id: string, o: Partial<OrganicContent>) => ({ id, title: id, text: null, platform: "INSTAGRAM", contentType: "IMAGE", url: null, publishedAt: new Date("2026-09-01T10:00:00Z"), impressions: 1000, reach: 800, reactions: 0, comments: 0, shares: 0, saves: 0, linkClicks: 0, ...o }) as OrganicContent;
    const r = rankPosts([post("p1", { reactions: 10 }), post("p2", { reactions: 30, comments: 5 }), post("zero", {}), post("p3", { saves: 10, impressions: 5000 })]);
    expect(r.map((x) => x.title)).toEqual(["p2", "p3", "p1"]);
    expect(r[0]).toMatchObject({ rank: 1, engagements: 35, engagementRate: 0.035, publishedAt: "2026-09-01" });
  });

  it("ordena páginas por cliques orgânicos", () => {
    const r = rankPages([{ key: "/a", clicks: 5, impressions: 10, ctr: 0.5, position: 3, clicksDeltaPct: null }, { key: "/b", clicks: 50, impressions: 900, ctr: 0.05, position: 2, clicksDeltaPct: 0.1 }, { key: "/c", clicks: 0, impressions: 100, ctr: 0, position: 9, clicksDeltaPct: null }]);
    expect(r.map((x) => [x.rank, x.url])).toEqual([[1, "/b"], [2, "/a"]]);
  });
});
