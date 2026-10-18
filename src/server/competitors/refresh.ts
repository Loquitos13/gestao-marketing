import type { Client, Competitor, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getConfig } from "@/server/config/settings";
import { IntegrationError } from "@/server/integrations/http";
import { getValidAccessToken } from "@/server/integrations/tokens";
import { defaultWriteContext } from "@/server/ads-write/service";
import { crawlSite, userAgent } from "./crawl";
import { runPagespeed } from "./pagespeed";
import { generateKeywordIdeas } from "./keyword-planner";
import { domainFromCaptions, searchAdLibrary, type LibraryAd } from "./ad-library";
import { demoKeywordIdeas, demoRefresh, demoSuggestions } from "./demo";
import { tokens } from "./analysis";

export type SourceKey = "crawl" | "pagespeed" | "adLibrary" | "keywordPlanner";
export interface SourceStatus {
  status: "ok" | "credentials" | "error" | "skipped";
  message: string;
  at: string;
}
export type SourceStatuses = Partial<Record<SourceKey, SourceStatus>>;

const KEYWORD_REFRESH_DAYS = 30;
const st = (status: SourceStatus["status"], message: string): SourceStatus => ({ status, message, at: new Date().toISOString() });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const siteOf = (domain: string) => (/^https?:\/\//i.test(domain) ? domain : `https://${domain}`).replace(/\/$/, "");

async function saveStatus(client: Client, s: SourceStatuses) {
  const current = (client.competitorStatus ?? {}) as SourceStatuses;
  await prisma.client.update({ where: { id: client.id }, data: { competitorStatus: { ...current, ...s } as Prisma.InputJsonValue } });
}

async function metaToken(clientId: string): Promise<string | null> {
  const ds = await prisma.dataSource.findFirst({ where: { clientId, platform: { in: ["META_ADS", "META_ORGANIC"] }, origin: "REAL", connectedAccount: { isNot: null } }, include: { connectedAccount: { include: { credential: true } } } });
  const cred = ds?.connectedAccount?.credential;
  return cred ? getValidAccessToken(cred, { db: prisma }) : null;
}

async function crawlTargets(client: Client, comps: Competitor[], maxPages: number): Promise<SourceStatus> {
  const ua = userAgent((await getConfig()).APP_URL);
  const targets = [...(client.website ? [{ competitorId: null as string | null, site: client.website, name: client.name }] : []), ...comps.filter((c) => c.domain).map((c) => ({ competitorId: c.id, site: siteOf(c.domain!), name: c.name }))];
  if (!targets.length) return st("skipped", "Sem site do cliente nem domínios de concorrentes.");
  let saved = 0;
  const problems: string[] = [];
  for (const t of targets) {
    try {
      const r = await crawlSite(t.site, { userAgent: ua, maxPages });
      for (const p of r.pages) {
        const data = { competitorId: t.competitorId, status: p.status, title: p.title, metaDescription: p.metaDescription, h1: p.h1, h2: p.h2, wordCount: p.wordCount, canonical: p.canonical, lang: p.lang, structuredData: p.structuredData, lastModified: p.lastModified, simulated: false, fetchedAt: new Date() };
        await prisma.competitorPage.upsert({ where: { clientId_url: { clientId: client.id, url: p.url } }, create: { clientId: client.id, url: p.url, ...data }, update: data });
      }
      if (r.pages.length) await prisma.competitorPage.deleteMany({ where: { clientId: client.id, competitorId: t.competitorId, url: { notIn: r.pages.map((p) => p.url) } } });
      saved += r.pages.length;
      if (!r.pages.length) problems.push(`${t.name}: ${r.errors[0] ?? "nenhuma página HTML acessível"}`);
      else if (r.skippedByRobots) problems.push(`${t.name}: ${r.skippedByRobots} páginas excluídas pelo robots.txt`);
    } catch (e) {
      problems.push(`${t.name}: ${errMsg(e)}`);
    }
  }
  return st(saved ? "ok" : "error", `${saved} páginas lidas em ${targets.length} sites.${problems.length ? ` ${problems.slice(0, 3).join(" · ")}` : ""}`);
}

async function adLibrary(client: Client, comps: Competitor[]): Promise<SourceStatus> {
  const withPages = comps.filter((c) => c.metaPageIds.length);
  if (!withPages.length) return st("skipped", "Indique o ID da Página Meta dos concorrentes para ver os anúncios.");
  const token = await metaToken(client.id);
  if (!token) return st("credentials", "Ligue uma conta Meta a este cliente para consultar a Biblioteca de Anúncios.");
  const owner = new Map(withPages.flatMap((c) => c.metaPageIds.map((p) => [p, c.id] as const)));
  const ids = [...owner.keys()];
  const found: LibraryAd[] = [];
  try {
    for (let i = 0; i < ids.length; i += 10) found.push(...(await searchAdLibrary(token, { pageIds: ids.slice(i, i + 10) })));
  } catch (e) {
    if (e instanceof IntegrationError && (e.kind === "PERMISSION" || e.kind === "AUTH")) return st("credentials", `A Meta recusou o acesso à Biblioteca de Anúncios (${e.message}). O utilizador da ligação tem de confirmar a identidade em facebook.com/ID e aceitar os termos da Biblioteca de Anúncios.`);
    return st("error", errMsg(e));
  }
  const now = new Date();
  for (const a of found) {
    const data = { competitorId: owner.get(a.pageId) ?? null, pageId: a.pageId, pageName: a.pageName, bodies: a.bodies, titles: a.titles, descriptions: a.descriptions, captions: a.captions, platforms: a.platforms, startDate: a.startDate, stopDate: a.stopDate, snapshotUrl: a.snapshotUrl, simulated: false, lastSeenAt: now };
    await prisma.competitorAd.upsert({ where: { clientId_source_externalId: { clientId: client.id, source: "META_AD_LIBRARY", externalId: a.externalId } }, create: { clientId: client.id, source: "META_AD_LIBRARY", externalId: a.externalId, ...data }, update: data });
  }
  return st("ok", `${found.length} anúncios ativos em Portugal de ${withPages.length} concorrentes.`);
}

async function pagespeed(client: Client, comps: Competitor[]): Promise<SourceStatus> {
  const key = (await getConfig()).PAGESPEED_API_KEY;
  const since = new Date(Date.now() - 28 * 86_400_000);
  const top = client.website
    ? await prisma.searchMetricDaily.groupBy({ by: ["key"], where: { clientId: client.id, dimension: "PAGE", date: { gte: since } }, _sum: { clicks: true }, orderBy: { _sum: { clicks: "desc" } }, take: key ? 5 : 1 })
    : [];
  const clientUrls = top.length ? top.map((t) => t.key) : client.website ? [`${siteOf(client.website)}/`] : [];
  const firstSeg = (u: string) => new URL(u).pathname.split("/").filter(Boolean)[0] ?? "";
  const segs = new Set(clientUrls.map(firstSeg).filter(Boolean));
  const targets: { url: string; competitorId: string | null }[] = clientUrls.map((url) => ({ url, competitorId: null }));
  for (const c of comps.filter((x) => x.domain)) {
    targets.push({ url: `${siteOf(c.domain!)}/`, competitorId: c.id });
    if (!key) continue;
    const pages = await prisma.competitorPage.findMany({ where: { clientId: client.id, competitorId: c.id }, select: { url: true }, take: 100 });
    for (const p of pages.filter((p) => segs.has(firstSeg(p.url))).slice(0, 2)) targets.push({ url: p.url, competitorId: c.id });
  }
  if (!targets.length) return st("skipped", "Sem páginas para medir.");
  let ok = 0;
  let lastError = "";
  for (const t of targets.slice(0, key ? 25 : 6)) {
    try {
      const m = await runPagespeed(t.url, key);
      await prisma.pageSpeedResult.create({ data: { clientId: client.id, competitorId: t.competitorId, url: m.url, score: m.score, lcpMs: m.lcpMs, inpMs: m.inpMs, cls: m.cls, fieldData: m.fieldData } });
      ok++;
    } catch (e) {
      lastError = errMsg(e);
      if (e instanceof IntegrationError && e.kind === "RATE_LIMIT") break;
    }
  }
  await prisma.pageSpeedResult.deleteMany({ where: { clientId: client.id, fetchedAt: { lt: new Date(Date.now() - 180 * 86_400_000) } } });
  const quota = key ? "" : " Sem API key a quota é baixa: só as páginas iniciais foram medidas.";
  return st(ok ? "ok" : "error", `${ok} de ${Math.min(targets.length, key ? 25 : 6)} páginas medidas.${quota}${lastError ? ` Último erro: ${lastError}` : ""}`);
}

/** Recolha semanal: páginas públicas, anúncios ativos e velocidade. Cada fonte falha de forma independente. */
export async function refreshCompetitors(clientId: string, opts: { maxPages?: number } = {}): Promise<SourceStatuses> {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  if (client.isDemo) {
    await demoRefresh(prisma, client);
    const s: SourceStatuses = { crawl: st("ok", "Dados de demonstração (sites fictícios, nada foi rastreado)."), adLibrary: st("ok", "Anúncios de demonstração."), pagespeed: st("ok", "Medições de demonstração.") };
    await saveStatus(client, s);
    return s;
  }
  const comps = await prisma.competitor.findMany({ where: { clientId, suggested: false } });
  const s: SourceStatuses = {};
  s.crawl = await crawlTargets(client, comps, opts.maxPages ?? 50).catch((e) => st("error", errMsg(e)));
  s.adLibrary = await adLibrary(client, comps).catch((e) => st("error", errMsg(e)));
  s.pagespeed = await pagespeed(client, comps).catch((e) => st("error", errMsg(e)));
  await saveStatus(client, s);
  return s;
}

/** Ideias do Keyword Planner por domínio (cliente e concorrentes), no máximo uma vez por mês por domínio. */
export async function refreshKeywordIdeas(clientId: string, opts: { force?: boolean } = {}): Promise<SourceStatus> {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  const save = async (s: SourceStatus) => (await saveStatus(client, { keywordPlanner: s }), s);
  if (client.isDemo) {
    await demoKeywordIdeas(prisma, client);
    return save(st("ok", "Ideias de demonstração (volumes fictícios)."));
  }
  const ds = await prisma.dataSource.findFirst({ where: { clientId, platform: "GOOGLE_ADS", origin: "REAL", status: { not: "DISCONNECTED" }, connectedAccount: { isNot: null } } });
  if (!ds) return save(st("credentials", "Ligue uma conta Google Ads a este cliente para usar o Keyword Planner."));
  const comps = await prisma.competitor.findMany({ where: { clientId, suggested: false, domain: { not: null } } });
  const seeds = [...(client.website ? [{ seed: client.website.replace(/^https?:\/\//, "").replace(/\/.*$/, ""), competitorId: null as string | null }] : []), ...comps.map((c) => ({ seed: c.domain!.replace(/^https?:\/\//, "").replace(/\/.*$/, ""), competitorId: c.id }))];
  if (!seeds.length) return save(st("skipped", "Sem domínios para analisar."));
  let ctx;
  try {
    ctx = await defaultWriteContext(ds);
  } catch (e) {
    return save(st("credentials", errMsg(e)));
  }
  let done = 0;
  let skipped = 0;
  for (const s of seeds) {
    const recent = await prisma.keywordIdea.findFirst({ where: { clientId, seed: s.seed, fetchedAt: { gte: new Date(Date.now() - KEYWORD_REFRESH_DAYS * 86_400_000) } } });
    if (recent && !opts.force) {
      skipped++;
      continue;
    }
    try {
      const ideas = await generateKeywordIdeas({ customerId: ds.externalId, token: ctx.token, loginCustomerId: ctx.loginCustomerId }, { site: s.seed });
      await prisma.$transaction([
        prisma.keywordIdea.deleteMany({ where: { clientId, seed: s.seed } }),
        prisma.keywordIdea.createMany({ data: ideas.map((i) => ({ clientId, competitorId: s.competitorId, source: "GOOGLE_KEYWORD_PLANNER", seed: s.seed, ...i, currency: ds.currency })), skipDuplicates: true }),
      ]);
      done++;
    } catch (e) {
      if (e instanceof IntegrationError && e.kind === "PERMISSION") return save(st("credentials", `A Google recusou o pedido (${e.message}). O Keyword Planner exige um developer token com acesso Básico.`));
      return save(st("error", errMsg(e)));
    }
  }
  return save(st("ok", `${done} domínios atualizados${skipped ? `, ${skipped} já atualizados este mês` : ""}.`));
}

/** Sugere concorrentes: anunciantes da Biblioteca da Meta nas palavras-chave principais do cliente. Ficam por aceitar. */
export async function suggestCompetitors(clientId: string): Promise<number> {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  if (client.isDemo) return demoSuggestions(prisma, client);
  const token = await metaToken(clientId);
  if (!token) throw new IntegrationError("Ligue uma conta Meta a este cliente para obter sugestões.", "CONFIG");
  const brand = new Set(tokens(client.name).filter((t) => t.length >= 4));
  const since = new Date(Date.now() - 90 * 86_400_000);
  const q = await prisma.searchMetricDaily.groupBy({ by: ["key"], where: { clientId, dimension: "QUERY", date: { gte: since } }, _sum: { clicks: true }, orderBy: { _sum: { clicks: "desc" } }, take: 30 });
  const k = q.length ? [] : await prisma.adsTermDaily.groupBy({ by: ["text"], where: { clientId, kind: "KEYWORD", date: { gte: since } }, _sum: { clicks: true }, orderBy: { _sum: { clicks: "desc" } }, take: 30 });
  const terms = [...q.map((x) => x.key), ...k.map((x) => x.text)].filter((t) => !tokens(t).some((w) => brand.has(w))).slice(0, 3);
  if (!terms.length) return 0;
  const existing = await prisma.competitor.findMany({ where: { clientId }, select: { metaPageIds: true, name: true } });
  const own = await prisma.dataSource.findMany({ where: { clientId, platform: "META_ORGANIC" }, select: { externalId: true } });
  const exclude = new Set([...existing.flatMap((c) => c.metaPageIds), ...own.map((o) => o.externalId)]);
  const pages = new Map<string, { name: string; count: number; term: string; captions: string[] }>();
  for (const term of terms) {
    for (const a of await searchAdLibrary(token, { terms: term }, { maxPages: 1 })) {
      if (exclude.has(a.pageId)) continue;
      const p = pages.get(a.pageId) ?? { name: a.pageName, count: 0, term, captions: [] };
      p.count++;
      p.captions.push(...a.captions);
      pages.set(a.pageId, p);
    }
  }
  const top = [...pages.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);
  for (const [pageId, p] of top) {
    await prisma.competitor.create({ data: { clientId, name: p.name.slice(0, 120) || `Página ${pageId}`, domain: domainFromCaptions(p.captions), metaPageIds: [pageId], suggested: true, notes: `Anuncia em “${p.term}” (${p.count} anúncios ativos).` } });
  }
  return top.length;
}

const activeClients = () => prisma.client.findMany({ where: { archivedAt: null, contractStatus: "ACTIVE", OR: [{ website: { not: null } }, { competitors: { some: { suggested: false } } }] }, select: { id: true } });

export async function refreshAllCompetitors() {
  let n = 0;
  for (const c of await activeClients()) {
    await refreshCompetitors(c.id).catch((e) => logger.warn({ clientId: c.id, error: errMsg(e) }, "Recolha de concorrência falhou"));
    n++;
  }
  return { clients: n };
}

export async function refreshAllKeywordIdeas() {
  let n = 0;
  for (const c of await activeClients()) {
    await refreshKeywordIdeas(c.id).catch((e) => logger.warn({ clientId: c.id, error: errMsg(e) }, "Keyword Planner falhou"));
    n++;
  }
  return { clients: n };
}
