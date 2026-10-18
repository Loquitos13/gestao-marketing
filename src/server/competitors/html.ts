/** Extração de sinais SEO de uma página HTML, sem executar scripts nem descarregar recursos. */
export interface ExtractedPage {
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  h2: string[];
  wordCount: number;
  canonical: string | null;
  lang: string | null;
  structuredData: string[];
  robotsNoindex: boolean;
  links: string[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", ndash: "–", mdash: "—", hellip: "…", euro: "€", ccedil: "ç", atilde: "ã", otilde: "õ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", acirc: "â", ecirc: "ê", ocirc: "ô", agrave: "à" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const clean = (s: string, max = 300) =>
  decodeEntities(s.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1]!.toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? "");
  return out;
}

function ldTypes(v: unknown, out: Set<string>, depth = 0) {
  if (!v || typeof v !== "object" || depth > 4) return;
  if (Array.isArray(v)) return v.forEach((x) => ldTypes(x, out, depth + 1));
  const o = v as Record<string, unknown>;
  const t = o["@type"];
  for (const x of Array.isArray(t) ? t : [t]) if (typeof x === "string" && x.length < 60) out.add(x);
  if (o["@graph"]) ldTypes(o["@graph"], out, depth + 1);
}

export function extractPage(html: string, pageUrl: string): ExtractedPage {
  const head = html.slice(0, 300_000);
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const linkTags = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const canonicalHref = linkTags.find((l) => l.rel?.toLowerCase().split(/\s+/).includes("canonical"))?.href;
  const robots = metas.find((m) => m.name?.toLowerCase() === "robots")?.content ?? "";
  const types = new Set<string>();
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      ldTypes(JSON.parse(m[1]!), types);
    } catch {
      /* JSON-LD inválido: ignorado */
    }
  }
  const heading = (n: 1 | 2) => [...html.matchAll(new RegExp(`<h${n}\\b[^>]*>([\\s\\S]*?)</h${n}>`, "gi"))].map((m) => clean(m[1]!, 200)).filter(Boolean).slice(0, 30);
  const text = clean(html.replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " "), 2_000_000);
  const base = new URL(pageUrl);
  const links = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    try {
      const u = new URL(decodeEntities(m[2] ?? m[3] ?? ""), base);
      u.hash = "";
      if (u.host === base.host && (u.protocol === "http:" || u.protocol === "https:")) links.add(u.toString());
    } catch {
      /* link inválido */
    }
    if (links.size >= 300) break;
  }
  let canonical: string | null = null;
  try {
    canonical = canonicalHref ? new URL(canonicalHref, base).toString() : null;
  } catch {
    canonical = null;
  }
  return {
    title: (() => {
      const t = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
      return t ? clean(t, 300) || null : null;
    })(),
    metaDescription: metas.find((m) => m.name?.toLowerCase() === "description")?.content?.trim().slice(0, 500) || null,
    h1: heading(1),
    h2: heading(2),
    wordCount: (text.match(/[\p{L}\p{N}]+/gu) ?? []).length,
    canonical,
    lang: head.match(/<html\b[^>]*\blang\s*=\s*["']?([\w-]+)/i)?.[1] ?? null,
    structuredData: [...types].slice(0, 20),
    robotsNoindex: /noindex/i.test(robots),
    links: [...links],
  };
}

export interface SitemapEntry {
  loc: string;
  lastmod: string | null;
}

/** urlset ou sitemapindex. */
export function parseSitemap(xml: string): { urls: SitemapEntry[]; sitemaps: string[] } {
  const blocks = (tag: string) => [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi"))].map((m) => m[1]!);
  const val = (b: string, t: string) => {
    const v = b.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)</${t}>`, "i"))?.[1];
    return v ? decodeEntities(v.replace(/<!\[CDATA\[|\]\]>/g, "")).trim() : null;
  };
  if (/<sitemapindex\b/i.test(xml)) return { urls: [], sitemaps: blocks("sitemap").map((b) => val(b, "loc")).filter((x): x is string => !!x) };
  return { urls: blocks("url").map((b) => ({ loc: val(b, "loc") ?? "", lastmod: val(b, "lastmod") })).filter((u) => u.loc), sitemaps: [] };
}
