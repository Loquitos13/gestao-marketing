import { extractPage, parseSitemap, type ExtractedPage } from "./html";
import { ALLOW_ALL, DISALLOW_ALL, isAllowed, parseRobots, type RobotsRules } from "./robots";
import { CrawlError, checkUrl, safeFetch, type FetchLike, type Resolver } from "./safe-fetch";

export const MAX_PAGES_PER_DOMAIN = 50;
export const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 10_000;
const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|mp4|mp3|zip|rar|docx?|xlsx?|pptx?|css|js|json|xml|txt|woff2?)$/i;

export const userAgent = (appUrl: string) => `MarketingIntelligenceHub/1.0 (+${appUrl})`;

export interface CrawledPage extends ExtractedPage {
  url: string;
  status: number;
  lastModified: Date | null;
}

export interface CrawlOptions {
  userAgent: string;
  maxPages?: number;
  minDelayMs?: number;
  fetchImpl?: FetchLike;
  resolve?: Resolver;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface CrawlResult {
  origin: string;
  pages: CrawledPage[];
  skippedByRobots: number;
  errors: string[];
  delayMs: number;
}

/** Garante pelo menos `delayMs` entre o início de pedidos consecutivos ao mesmo domínio. */
export function throttle(delayMs: number, sleep: (ms: number) => Promise<void>, now: () => number) {
  let last = -Infinity;
  const tick = async () => {
    const wait = last + tick.delayMs - now();
    if (wait > 0) await sleep(wait);
    last = now();
  };
  tick.delayMs = delayMs;
  return tick;
}

const sameSite = (a: URL, b: URL) => a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "");
const depth = (u: string) => new URL(u).pathname.split("/").filter(Boolean).length;
const parseDate = (s: string | null | undefined) => {
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/**
 * Rastreio educado de um site público: respeita robots.txt, descobre páginas pelo sitemap (ou links da página inicial),
 * no máximo `maxPages` páginas HTML, um pedido por segundo (ou o crawl-delay indicado) e 2 MB por página.
 */
export async function crawlSite(site: string, opts: CrawlOptions): Promise<CrawlResult> {
  const start = checkUrl(/^https?:\/\//i.test(site) ? site : `https://${site}`);
  const origin = start.origin;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const fetchOpts = { userAgent: opts.userAgent, fetchImpl: opts.fetchImpl, resolve: opts.resolve };
  const errors: string[] = [];
  const tick = throttle(opts.minDelayMs ?? MIN_DELAY_MS, sleep, now);

  let robots: RobotsRules = ALLOW_ALL;
  await tick();
  try {
    const r = await safeFetch(`${origin}/robots.txt`, { ...fetchOpts, accept: "text/plain", maxBytes: 500_000 });
    if (r.status >= 200 && r.status < 300) robots = parseRobots(r.body, opts.userAgent);
    else if (r.status >= 500 || r.status === 429) robots = DISALLOW_ALL;
  } catch (e) {
    if (e instanceof CrawlError && e.kind === "BLOCKED") throw e;
    robots = DISALLOW_ALL;
    errors.push(`robots.txt inacessível: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (robots.disallowAll) return { origin, pages: [], skippedByRobots: 0, errors: [...errors, "robots.txt indisponível: por precaução, nada foi rastreado."], delayMs: 0 };

  const delayMs = Math.max(opts.minDelayMs ?? MIN_DELAY_MS, Math.min((robots.crawlDelaySec ?? 0) * 1000, 60_000));
  let maxPages = Math.min(opts.maxPages ?? MAX_PAGES_PER_DOMAIN, MAX_PAGES_PER_DOMAIN);
  if (delayMs > MAX_DELAY_MS) maxPages = Math.min(maxPages, 10);
  tick.delayMs = delayMs;

  const candidates = new Map<string, Date | null>();
  const add = (loc: string, lastmod: string | null = null) => {
    try {
      const u = new URL(loc, origin);
      u.hash = "";
      if (!sameSite(u, start) || SKIP_EXT.test(u.pathname)) return;
      if (!candidates.has(u.toString())) candidates.set(u.toString(), parseDate(lastmod));
    } catch {
      /* ignorado */
    }
  };
  const sitemapQueue = robots.sitemaps.length ? robots.sitemaps.slice(0, 3) : [`${origin}/sitemap.xml`];
  for (let i = 0; i < sitemapQueue.length && i < 4; i++) {
    const sm = sitemapQueue[i]!;
    try {
      const smUrl = new URL(sm, origin);
      if (!sameSite(smUrl, start) || !isAllowed(robots, smUrl.pathname + smUrl.search)) continue;
      await tick();
      const r = await safeFetch(smUrl.toString(), { ...fetchOpts, accept: "application/xml,text/xml", maxBytes: 5_000_000 });
      if (r.status !== 200) continue;
      const parsed = parseSitemap(r.body);
      parsed.urls.slice(0, 5000).forEach((u) => add(u.loc, u.lastmod));
      for (const child of parsed.sitemaps.slice(0, 3)) if (sitemapQueue.length < 4) sitemapQueue.push(child);
    } catch (e) {
      errors.push(`Sitemap ${sm}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const home = `${origin}/`;
  const ordered = [home, ...[...candidates.entries()].filter(([u]) => u !== home).sort((a, b) => depth(a[0]) - depth(b[0]) || (b[1]?.getTime() ?? 0) - (a[1]?.getTime() ?? 0)).map(([u]) => u)];
  const queue = [...new Set(ordered)];
  const seen = new Set<string>();
  const pages: CrawledPage[] = [];
  let skippedByRobots = 0;
  while (queue.length && pages.length < maxPages) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const u = new URL(next);
    if (!isAllowed(robots, u.pathname + u.search)) {
      skippedByRobots++;
      continue;
    }
    await tick();
    try {
      const r = await safeFetch(next, fetchOpts);
      const finalUrl = new URL(r.url);
      if (!sameSite(finalUrl, start)) continue;
      if (r.status !== 200) {
        errors.push(`${next}: HTTP ${r.status}`);
        continue;
      }
      if (!/text\/html|application\/xhtml\+xml/i.test(r.contentType)) continue;
      const ex = extractPage(r.body, r.url);
      if (ex.robotsNoindex) continue;
      pages.push({ ...ex, url: r.url, status: r.status, lastModified: parseDate(r.lastModified) ?? candidates.get(next) ?? null });
      if (next === home && candidates.size === 0) for (const l of ex.links) if (!SKIP_EXT.test(new URL(l).pathname)) queue.push(l);
    } catch (e) {
      if (e instanceof CrawlError && e.kind === "BLOCKED") errors.push(`${next}: bloqueado (${e.message})`);
      else errors.push(`${next}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { origin, pages, skippedByRobots, errors: errors.slice(0, 20), delayMs };
}
