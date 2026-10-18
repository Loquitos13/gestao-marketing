import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/audit", () => ({ audit: async () => undefined }));

import { CrawlError, checkUrl, isBlockedIp, safeFetch, type FetchLike } from "@/server/competitors/safe-fetch";
import { isAllowed, parseRobots } from "@/server/competitors/robots";
import { extractPage, parseSitemap } from "@/server/competitors/html";
import { crawlSite, throttle } from "@/server/competitors/crawl";
import { parsePagespeed, vitalRating } from "@/server/competitors/pagespeed";
import { buildIdeasRequest, generateKeywordIdeas } from "@/server/competitors/keyword-planner";
import { domainFromCaptions, libraryParams, mapLibraryAd, searchAdLibrary } from "@/server/competitors/ad-library";
import { adMessaging, contentGaps, keywordGaps, speedComparison } from "@/server/competitors/analysis";
import { createKeywordsDraft, keywordOperations, normalizeKeywords, validateKeywords } from "@/server/ads-write/keywords";
import { confirmAndApply } from "@/server/ads-write/service";
import type { WriteContext } from "@/server/ads-write/types";

const UA = "MarketingIntelligenceHub/1.0 (+https://hub.exemplo.pt)";
const publicDns = async () => ["93.184.216.34"];

describe("proteção SSRF", () => {
  it("bloqueia IPs privados, locais e reservados (IPv4 e IPv6)", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::10.0.0.1"]) expect(isBlockedIp(ip), ip).toBe(true);
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111", "172.32.0.1"]) expect(isBlockedIp(ip), ip).toBe(false);
  });
  it("só aceita http/https em portas normais, sem credenciais nem nomes locais", () => {
    expect(checkUrl("https://concorrente.pt/x").hostname).toBe("concorrente.pt");
    for (const u of ["file:///etc/passwd", "ftp://x.pt", "http://localhost/", "http://127.0.0.1/", "http://[::1]/", "http://10.0.0.5/", "https://x.pt:8443/", "https://user:pw@x.pt/", "http://intranet/", "http://nas.local/"]) {
      expect(() => checkUrl(u), u).toThrow(CrawlError);
    }
  });
  it("recusa domínios que resolvem para IPs internos e redirecionamentos para eles", async () => {
    const ok: FetchLike = async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
    await expect(safeFetch("https://rebind.exemplo.pt/", { userAgent: UA, fetchImpl: ok, resolve: async () => ["10.0.0.7"] })).rejects.toMatchObject({ kind: "BLOCKED" });
    const redirect: FetchLike = async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
    await expect(safeFetch("https://x.pt/", { userAgent: UA, fetchImpl: redirect, resolve: publicDns })).rejects.toMatchObject({ kind: "BLOCKED" });
    const toFile: FetchLike = async () => new Response(null, { status: 301, headers: { location: "file:///etc/passwd" } });
    await expect(safeFetch("https://x.pt/", { userAgent: UA, fetchImpl: toFile, resolve: publicDns })).rejects.toMatchObject({ kind: "BLOCKED" });
  });
  it("limita o tamanho da resposta, mesmo sem content-length", async () => {
    const declared: FetchLike = async () => new Response("x", { status: 200, headers: { "content-type": "text/html", "content-length": String(10_000_000) } });
    await expect(safeFetch("https://x.pt/", { userAgent: UA, fetchImpl: declared, resolve: publicDns })).rejects.toMatchObject({ kind: "TOO_LARGE" });
    const big = new Uint8Array(300_000).fill(97);
    const streamed: FetchLike = async () =>
      new Response(new ReadableStream({ start: (c) => (c.enqueue(big), c.enqueue(big), c.close()) }), { status: 200, headers: { "content-type": "text/html" } });
    await expect(safeFetch("https://x.pt/", { userAgent: UA, fetchImpl: streamed, resolve: publicDns, maxBytes: 500_000 })).rejects.toMatchObject({ kind: "TOO_LARGE" });
  });
  it("segue redirecionamentos públicos e identifica-se com o user-agent", async () => {
    const seen: string[] = [];
    const f: FetchLike = async (url, init) => {
      seen.push(`${url}|${init.headers["User-Agent"]}`);
      return url.endsWith("/a") ? new Response(null, { status: 301, headers: { location: "/b" } }) : new Response("<title>B</title>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    };
    const r = await safeFetch("https://x.pt/a", { userAgent: UA, fetchImpl: f, resolve: publicDns });
    expect(r.url).toBe("https://x.pt/b");
    expect(r.body).toContain("B");
    expect(seen[0]).toContain(UA);
  });
});

describe("robots.txt", () => {
  const txt = `User-agent: *\nDisallow: /privado\nAllow: /privado/publico\nDisallow: /*.pdf$\nCrawl-delay: 2\n\nUser-agent: OutroBot\nDisallow: /\n\nSitemap: https://x.pt/sitemap.xml`;
  it("aplica a regra mais específica e os padrões * e $", () => {
    const r = parseRobots(txt, UA);
    expect(isAllowed(r, "/")).toBe(true);
    expect(isAllowed(r, "/privado/x")).toBe(false);
    expect(isAllowed(r, "/privado/publico/y")).toBe(true);
    expect(isAllowed(r, "/doc.pdf")).toBe(false);
    expect(isAllowed(r, "/doc.pdf?x=1")).toBe(true);
    expect(r.crawlDelaySec).toBe(2);
    expect(r.sitemaps).toEqual(["https://x.pt/sitemap.xml"]);
  });
  it("usa o grupo do nosso user-agent quando existe", () => {
    const r = parseRobots("User-agent: *\nAllow: /\n\nUser-agent: MarketingIntelligenceHub\nDisallow: /", UA);
    expect(isAllowed(r, "/qualquer")).toBe(false);
  });
});

describe("extração de HTML", () => {
  const html = `<!doctype html><html lang="pt-PT"><head><title>Vestidos &amp; Casacos | Loja</title>
    <meta content="Roupa em linho." name="description"><link rel="canonical" href="/vestidos">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":["Product","Thing"]}]}</script>
    <script>var ignorar = "muitas palavras aqui";</script></head>
    <body><h1>Vestidos <span>de linho</span></h1><h2>Guia de tamanhos</h2><h2>Envio grátis</h2><p>Três palavras aqui.</p><a href="/casacos#top">c</a><a href="https://outro.pt/">x</a></body></html>`;
  it("lê título, meta descrição, cabeçalhos, canonical, dados estruturados e links internos", () => {
    const p = extractPage(html, "https://loja.pt/vestidos?utm=1");
    expect(p.title).toBe("Vestidos & Casacos | Loja");
    expect(p.metaDescription).toBe("Roupa em linho.");
    expect(p.h1).toEqual(["Vestidos de linho"]);
    expect(p.h2).toEqual(["Guia de tamanhos", "Envio grátis"]);
    expect(p.canonical).toBe("https://loja.pt/vestidos");
    expect(p.lang).toBe("pt-PT");
    expect(p.structuredData).toEqual(["Organization", "Product", "Thing"]);
    expect(p.links).toEqual(["https://loja.pt/casacos"]);
    expect(p.wordCount).toBeLessThan(25);
    expect(p.robotsNoindex).toBe(false);
  });
  it("lê sitemaps e índices de sitemaps", () => {
    expect(parseSitemap(`<urlset><url><loc>https://x.pt/a</loc><lastmod>2026-09-01</lastmod></url><url><loc><![CDATA[https://x.pt/b?x=1&amp;y=2]]></loc></url></urlset>`).urls).toEqual([
      { loc: "https://x.pt/a", lastmod: "2026-09-01" },
      { loc: "https://x.pt/b?x=1&y=2", lastmod: null },
    ]);
    expect(parseSitemap(`<sitemapindex><sitemap><loc>https://x.pt/s1.xml</loc></sitemap></sitemapindex>`).sitemaps).toEqual(["https://x.pt/s1.xml"]);
  });
});

describe("rastreio", () => {
  const page = (title: string) => new Response(`<html><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`, { status: 200, headers: { "content-type": "text/html" } });
  function site(robots: Response | (() => Response)) {
    const hits: string[] = [];
    const f: FetchLike = async (url) => {
      hits.push(url);
      const p = new URL(url).pathname;
      if (p === "/robots.txt") return typeof robots === "function" ? robots() : robots.clone();
      if (p === "/sitemap.xml") return new Response(`<urlset>${["/", "/a", "/b/c", "/privado/x", "/f.pdf", "/img"].map((u) => `<url><loc>https://x.pt${u}</loc></url>`).join("")}</urlset>`, { status: 200 });
      if (p === "/img") return new Response("png", { status: 200, headers: { "content-type": "image/png" } });
      return page(p);
    };
    return { f, hits };
  }
  it("respeita robots.txt, ignora não-HTML e espaça os pedidos", async () => {
    const { f, hits } = site(new Response("User-agent: *\nDisallow: /privado", { status: 200 }));
    let now = 0;
    const waits: number[] = [];
    const r = await crawlSite("x.pt", { userAgent: UA, fetchImpl: f, resolve: publicDns, now: () => now, sleep: async (ms) => void (waits.push(ms), (now += ms)) });
    expect(r.pages.map((p) => new URL(p.url).pathname).sort()).toEqual(["/", "/a", "/b/c"]);
    expect(r.skippedByRobots).toBe(1);
    expect(hits.some((h) => h.includes("/privado") || h.endsWith(".pdf"))).toBe(false);
    expect(waits.every((w) => w >= 1000 - 1e-9)).toBe(true);
    expect(waits.length).toBe(hits.length - 1);
  });
  it("não rastreia nada se o robots.txt der erro do servidor", async () => {
    const { f, hits } = site(() => new Response("", { status: 503 }));
    const r = await crawlSite("https://x.pt", { userAgent: UA, fetchImpl: f, resolve: publicDns, sleep: async () => undefined });
    expect(r.pages).toHaveLength(0);
    expect(hits).toHaveLength(1);
  });
  it("respeita o limite de páginas", async () => {
    const { f } = site(new Response("", { status: 404 }));
    const r = await crawlSite("x.pt", { userAgent: UA, fetchImpl: f, resolve: publicDns, sleep: async () => undefined, maxPages: 2 });
    expect(r.pages).toHaveLength(2);
  });
  it("throttle espera o intervalo mínimo entre pedidos", async () => {
    let now = 0;
    const waits: number[] = [];
    const t = throttle(1000, async (ms) => void (waits.push(ms), (now += ms)), () => now);
    await t();
    now += 300;
    await t();
    expect(waits).toEqual([700]);
  });
});

describe("PageSpeed Insights", () => {
  it("prefere dados reais (CrUX) e usa o laboratório quando não existem", () => {
    const field = parsePagespeed({ loadingExperience: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2300 }, INTERACTION_TO_NEXT_PAINT: { percentile: 180 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5 } } }, lighthouseResult: { categories: { performance: { score: 0.87 } }, audits: { "largest-contentful-paint": { numericValue: 3900 } } } }, "https://x.pt/");
    expect(field).toMatchObject({ score: 87, lcpMs: 2300, inpMs: 180, cls: 0.05, fieldData: true });
    const lab = parsePagespeed({ lighthouseResult: { finalUrl: "https://x.pt/", categories: { performance: { score: 0.42 } }, audits: { "largest-contentful-paint": { numericValue: 4200 }, "cumulative-layout-shift": { numericValue: 0.3 } } } }, "https://x.pt/");
    expect(lab).toMatchObject({ score: 42, lcpMs: 4200, inpMs: null, cls: 0.3, fieldData: false });
    expect(vitalRating("lcpMs", 2500)).toBe("good");
    expect(vitalRating("cls", 0.3)).toBe("poor");
  });
});

describe("Keyword Planner", () => {
  it("pede ideias para Portugal/português, pagina e converte micros", async () => {
    const bodies: Record<string, unknown>[] = [];
    let headers: Record<string, string> = {};
    const f = (async (url: string, init: RequestInit) => {
      expect(url).toMatch(/\/customers\/1234567890:generateKeywordIdeas$/);
      headers = init.headers as Record<string, string>;
      const b = JSON.parse(String(init.body));
      bodies.push(b);
      const page = b.pageToken
        ? { results: [{ text: "Casaco Lã", keywordIdeaMetrics: { avgMonthlySearches: "720", competition: "MEDIUM", competitionIndex: "50", lowTopOfPageBidMicros: "350000", highTopOfPageBidMicros: "1300000" } }] }
        : { results: [{ text: "vestidos de linho", keywordIdeaMetrics: { avgMonthlySearches: "2400", competition: "HIGH" } }, { text: "vestidos de linho" }], nextPageToken: "p2" };
      return new Response(JSON.stringify(page), { status: 200 });
    }) as unknown as typeof fetch;
    const ideas = await generateKeywordIdeas({ customerId: "123-456-7890", token: "tok", fetchImpl: f }, { site: "https://www.concorrente.pt/loja" });
    expect(bodies[0]).toMatchObject({ language: "languageConstants/1014", geoTargetConstants: ["geoTargetConstants/2620"], siteSeed: { site: "www.concorrente.pt" }, keywordPlanNetwork: "GOOGLE_SEARCH" });
    expect(bodies[1]!.pageToken).toBe("p2");
    expect(headers["developer-token"]).toBe("test-dev-token");
    expect(ideas).toEqual([
      { keyword: "vestidos de linho", avgMonthlySearches: 2400, competition: "HIGH", competitionIndex: null, lowCpc: null, highCpc: null },
      { keyword: "casaco lã", avgMonthlySearches: 720, competition: "MEDIUM", competitionIndex: 50, lowCpc: 0.35, highCpc: 1.3 },
    ]);
    expect(buildIdeasRequest({ keywords: ["a"] })).toMatchObject({ keywordSeed: { keywords: ["a"] } });
  });
});

describe("Biblioteca de Anúncios da Meta", () => {
  it("consulta anúncios ativos em Portugal, pagina com limite e não guarda o link com token", async () => {
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(url);
      const n = urls.length;
      return new Response(JSON.stringify({ data: [{ id: `${n}00`, page_id: "555", page_name: "Concorrente", ad_creative_bodies: ["Texto", "Texto"], publisher_platforms: ["facebook"], ad_delivery_start_time: "2026-09-01", ad_snapshot_url: "https://www.facebook.com/ads/archive/render_ad/?id=1&access_token=SEGREDO" }], paging: { next: `https://graph.facebook.com/v23.0/ads_archive?after=${n}&access_token=tok` } }), { status: 200 });
    }) as unknown as typeof fetch;
    const ads = await searchAdLibrary("tok", { pageIds: ["555", "abc"] }, { fetchImpl: f, maxPages: 2 });
    expect(urls).toHaveLength(2);
    const first = new URL(urls[0]!);
    expect(first.pathname).toMatch(/ads_archive$/);
    expect(first.searchParams.get("ad_reached_countries")).toBe('["PT"]');
    expect(first.searchParams.get("search_page_ids")).toBe("555");
    expect(first.searchParams.get("ad_active_status")).toBe("ACTIVE");
    expect(first.searchParams.get("fields")).not.toContain("ad_snapshot_url");
    expect(ads[0]).toMatchObject({ externalId: "100", bodies: ["Texto"], platforms: ["FACEBOOK"], snapshotUrl: "https://www.facebook.com/ads/library/?id=100" });
    expect(JSON.stringify(ads)).not.toContain("SEGREDO");
    expect(libraryParams({ terms: "vestidos" }).search_terms).toBe("vestidos");
    expect(mapLibraryAd({ page_id: "1" })).toBeNull();
    expect(domainFromCaptions(["FACEBOOK.COM", "WWW.LOJA-EXEMPLO.PT"])).toBe("loja-exemplo.pt");
  });
});

describe("análise", () => {
  it("lacunas de palavras-chave: sem impressões orgânicas, fora da Google Ads e sem marcas", () => {
    const idea = (keyword: string, v: number, competitorName: string | null = "Rival") => ({ keyword, avgMonthlySearches: v, lowCpc: 0.2, highCpc: 1, competition: "HIGH", competitorName });
    const r = keywordGaps([idea("vestidos de cerimónia", 6600), idea("vestidos linho", 2400), idea("casaco lã mulher", 900), idea("rival loja", 500), idea("meias", 10), idea("Vestidos de Cerimonia", 100, "Outro")], [{ query: "vestidos de linho baratos", impressions: 40 }], ["[casaco lã mulher]"], { brandTerms: ["Rival"] });
    const by = Object.fromEntries(r.rows.map((x) => [x.keyword, x]));
    expect(by["vestidos de cerimónia"]).toMatchObject({ gap: true, competitors: ["Rival", "Outro"] });
    expect(by["vestidos linho"]).toMatchObject({ gap: false, inSearchConsole: true, searchImpressions: 40 });
    expect(by["casaco lã mulher"]).toMatchObject({ gap: false, inAds: true });
    expect(by["rival loja"]).toMatchObject({ gap: false, brand: true });
    expect(by["meias"]!.gap).toBe(false);
    expect(r.gaps).toBe(1);
  });
  it("lacunas de conteúdo: temas de vários concorrentes que o cliente não cobre", () => {
    const comp = (competitorName: string, url: string, title: string, h2: string[] = []) => ({ competitorName, url, title, h1: [], h2 });
    const gaps = contentGaps(
      [comp("A", "https://a.pt/1", "Guia de cuidados com linho"), comp("B", "https://b.pt/1", "Cuidados com linho e lã"), comp("A", "https://a.pt/2", "Vestidos de linho"), comp("B", "https://b.pt/2", "Vestidos de linho"), comp("A", "https://a.pt/3", "Só a marca A")],
      [{ url: "https://cliente.pt/vestidos", title: "Vestidos de linho", h1: [], h2: [] }],
    );
    expect(gaps.map((g) => g.topic)).toContain("cuidados linho");
    expect(gaps.some((g) => g.topic.includes("vestidos"))).toBe(false);
    expect(gaps.find((g) => g.topic === "cuidados linho")!.competitors).toEqual(["A", "B"]);
  });
  it("velocidade: compara medianas e lista páginas lentas do cliente", () => {
    const s = speedComparison([
      { url: "https://c.pt/", competitorName: null, score: 45, lcpMs: 4000, inpMs: 300, cls: 0.2 },
      { url: "https://a.pt/", competitorName: "A", score: 80, lcpMs: 2000, inpMs: 150, cls: 0.02 },
    ]);
    expect(s.verdicts).toEqual({ score: "pior", lcpMs: "pior", inpMs: "pior", cls: "pior" });
    expect(s.slowClientPages).toHaveLength(1);
  });
  it("mensagens: conta ângulos, chamadas para a ação e descontos por anúncio", () => {
    const m = adMessaging([
      { competitorName: "A", bodies: ["Só hoje: 20% de desconto. Compre já!"], titles: ["Saldos"] },
      { competitorName: "B", bodies: ["Linho português de qualidade. Envio grátis."], titles: ["Descubra"] },
    ]);
    const angle = Object.fromEntries(m.angles.map((a) => [a.key, a.count]));
    expect(angle).toMatchObject({ PRICE: 1, URGENCY: 1, QUALITY: 1, ORIGIN: 1, SHIPPING: 1 });
    expect(m.offers).toEqual([{ text: "20%", count: 1 }]);
    expect(m.ctas.map((c) => c.text).sort()).toEqual(["compre", "descubra"]);
  });
});

describe("ADD_KEYWORDS", () => {
  const ctx = { ds: { externalId: "123-456-7890", currency: "EUR" }, token: "t" } as unknown as WriteContext;
  it("cria as palavras-chave sempre em pausa no grupo certo", () => {
    expect(keywordOperations(ctx, "77", [{ text: "vestidos de cerimonia", matchType: "PHRASE" }])).toEqual([{ create: { adGroup: "customers/1234567890/adGroups/77", status: "PAUSED", keyword: { text: "vestidos de cerimonia", matchType: "PHRASE" } } }]);
    expect(() => keywordOperations(ctx, "77; DROP", [{ text: "x", matchType: "EXACT" }])).toThrow();
  });
  it("valida e normaliza", () => {
    expect(validateKeywords([{ text: "a!", matchType: "EXACT" }])[0]).toMatch(/não permitidos/);
    expect(validateKeywords([{ text: Array(11).fill("p").join(" "), matchType: "EXACT" }])[0]).toMatch(/10 palavras/);
    expect(validateKeywords(Array.from({ length: 21 }, (_, i) => ({ text: `k${i}`, matchType: "BROAD" as const })))[0]).toMatch(/Máximo/);
    expect(normalizeKeywords([{ text: " Vestidos  Linho ", matchType: "EXACT" }, { text: "vestidos linho", matchType: "EXACT" }])).toEqual([{ text: "vestidos linho", matchType: "EXACT" }]);
  });

  function draftDb(campaignType: string | null, platform = "GOOGLE_ADS") {
    const created: Record<string, unknown>[] = [];
    const db = {
      adGroup: { findFirst: async () => ({ id: "g1", externalId: "77", name: "Vestidos", campaign: { name: "Pesquisa", platform, campaignType, dataSourceId: "ds1" } }) },
      adsTermDaily: { findMany: async () => [{ text: "vestidos linho", matchType: "PHRASE" }] },
      dataSource: { findUniqueOrThrow: async () => ({ id: "ds1", origin: "REAL" }) },
      adChange: { create: async ({ data }: { data: Record<string, unknown> }) => (created.push(data), { id: "ch1", ...data }) },
    };
    return { db: db as never, created };
  }
  const input = { clientId: "c1", organizationId: "o1", userId: "u1", adGroupId: "g1" };
  it("a proposta fica em rascunho, retira as que já existem e só aceita Pesquisa na Google", async () => {
    const f = draftDb("SEARCH");
    const c = await createKeywordsDraft({ ...input, keywords: [{ text: "vestidos linho", matchType: "PHRASE" }, { text: "vestidos cerimonia", matchType: "PHRASE" }] }, f.db);
    expect(f.created[0]).toMatchObject({ operation: "ADD_KEYWORDS", platform: "GOOGLE_ADS", after: { keywords: [{ text: "vestidos cerimonia", matchType: "PHRASE" }] } });
    expect(f.created[0]!.status).toBeUndefined();
    expect(String(c.reason)).toMatch(/1 já existiam/);
    await expect(createKeywordsDraft({ ...input, keywords: [{ text: "x", matchType: "EXACT" }] }, draftDb("DISPLAY").db)).rejects.toThrow(/Pesquisa/);
    await expect(createKeywordsDraft({ ...input, keywords: [{ text: "x", matchType: "EXACT" }] }, draftDb(null, "META_ADS").db)).rejects.toThrow(/Google Ads/);
  });
  it("só é aplicada depois da confirmação, uma única vez", async () => {
    const change = { id: "ch1", clientId: "c1", dataSourceId: "ds1", platform: "GOOGLE_ADS", operation: "ADD_KEYWORDS", entityLevel: "AD_GROUP", entityId: "g1", externalId: "77", entityName: "P › V", before: {}, after: { keywords: [{ text: "vestidos cerimonia", matchType: "PHRASE" }] }, status: "DRAFT", simulated: false, validation: {}, source: "AGENT" } as Record<string, unknown>;
    const db = {
      client: { findFirstOrThrow: async () => ({ id: "c1", adsManagementEnabled: true }) },
      adChange: { count: async () => 0, updateMany: async ({ where, data }: { where: { status: string }; data: object }) => (change.status === where.status ? (Object.assign(change, data), { count: 1 }) : { count: 0 }), findUniqueOrThrow: async () => ({ ...change }), update: async ({ data }: { data: object }) => Object.assign(change, data) },
      dataSource: { findUniqueOrThrow: async () => ({ id: "ds1" }) },
    };
    const calls: unknown[] = [];
    const deps = { db: db as never, writeContext: async () => ctx, addKeywords: async (_c: WriteContext, g: string, k: unknown) => (calls.push([g, k]), 1) };
    const args = { changeId: "ch1", clientId: "c1", organizationId: "o1", userId: "u1", acknowledged: true };
    const r = await confirmAndApply(args, deps);
    expect(r.status).toBe("APPLIED");
    expect(String(r.error)).toMatch(/em pausa/);
    expect(calls).toEqual([["77", [{ text: "vestidos cerimonia", matchType: "PHRASE" }]]]);
    await expect(confirmAndApply(args, deps)).rejects.toThrow(/já foi processada/);
    expect(calls).toHaveLength(1);
  });
});
