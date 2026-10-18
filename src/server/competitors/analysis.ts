/** Análise determinística da concorrência (sem LLM): lacunas de palavras-chave e conteúdo, velocidade e mensagens. */

export const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9%€]+/g, " ")
    .trim();

const STOP = new Set(
  "a ao aos as com como da das de do dos e em entre era essa esse esta este eu foi ha isso ja la mais mas me na nas nem no nos o os ou para pela pelas pelo pelos por qual quando que se sem ser seu sua seus suas so tambem te tem ter um uma umas uns voce vos the and of for to in on with your our you new todos todas toda todo muito nosso nossa nossos nossas aqui sobre ate apos cada ainda".split(" "),
);
/** Palavras de navegação que não são temas de conteúdo. */
const NAV = new Set("home inicio pagina contactos contacto contacte login conta carrinho checkout pesquisa menu politica privacidade termos condicoes cookies faq ajuda blog loja categorias categoria produtos produto artigos artigo noticias ver mais ler".split(" "));

export const tokens = (s: string) => normalize(s).split(" ").filter((t) => t && !STOP.has(t));

// ───────── Palavras-chave ─────────

export interface IdeaInput {
  keyword: string;
  avgMonthlySearches: number | null;
  lowCpc: number | null;
  highCpc: number | null;
  competition: string | null;
  /** null: ideia gerada a partir do site do próprio cliente. */
  competitorName: string | null;
}

export interface KeywordGapRow {
  keyword: string;
  volume: number | null;
  lowCpc: number | null;
  highCpc: number | null;
  competition: string | null;
  competitors: string[];
  inSearchConsole: boolean;
  searchImpressions: number;
  inAds: boolean;
  brand: boolean;
  gap: boolean;
}

const stripMatch = (k: string) => k.replace(/^\[|\]$|^"|"$|\+/g, "");

export function keywordGaps(ideas: IdeaInput[], clientQueries: { query: string; impressions: number }[], adsKeywords: string[], opts: { minVolume?: number; brandTerms?: string[]; limit?: number } = {}) {
  const minVolume = opts.minVolume ?? 30;
  const brand = (opts.brandTerms ?? []).flatMap((b) => tokens(b)).filter((t) => t.length >= 4 && !NAV.has(t));
  const queries = clientQueries.filter((q) => q.impressions > 0).map((q) => ({ set: new Set(tokens(q.query)), impressions: q.impressions }));
  const ads = adsKeywords.map((k) => [...new Set(tokens(stripMatch(k)))].sort().join(" "));
  const grouped = new Map<string, KeywordGapRow>();
  for (const i of ideas) {
    const kwTokens = [...new Set(tokens(i.keyword))];
    if (!kwTokens.length) continue;
    const key = [...kwTokens].sort().join(" ");
    const row = grouped.get(key);
    if (row) {
      if ((i.avgMonthlySearches ?? 0) > (row.volume ?? 0)) Object.assign(row, { volume: i.avgMonthlySearches, lowCpc: i.lowCpc, highCpc: i.highCpc, competition: i.competition });
      if (i.competitorName && !row.competitors.includes(i.competitorName)) row.competitors.push(i.competitorName);
      continue;
    }
    const matches = queries.filter((q) => kwTokens.every((t) => q.set.has(t)));
    grouped.set(key, {
      keyword: i.keyword,
      volume: i.avgMonthlySearches,
      lowCpc: i.lowCpc,
      highCpc: i.highCpc,
      competition: i.competition,
      competitors: i.competitorName ? [i.competitorName] : [],
      inSearchConsole: matches.length > 0,
      searchImpressions: matches.reduce((s, q) => s + q.impressions, 0),
      inAds: ads.includes(key),
      brand: kwTokens.some((t) => brand.includes(t)),
      gap: false,
    });
  }
  const rows = [...grouped.values()].map((r) => ({ ...r, gap: !r.inSearchConsole && !r.inAds && !r.brand && (r.volume ?? 0) >= minVolume }));
  rows.sort((a, b) => Number(b.gap) - Number(a.gap) || (b.volume ?? 0) - (a.volume ?? 0));
  return { rows: rows.slice(0, opts.limit ?? 300), gaps: rows.filter((r) => r.gap).length, total: rows.length };
}

// ───────── Conteúdo ─────────

export interface PageInput {
  url: string;
  title: string | null;
  h1: string[];
  h2: string[];
}

function pageTopics(p: PageInput, exclude: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const heading of [p.title ?? "", ...p.h1, ...p.h2]) {
    const ts = tokens(heading).filter((t) => t.length >= 3 && !NAV.has(t) && !exclude.has(t) && !/^\d+$/.test(t));
    for (let i = 0; i < ts.length; i++) {
      if (ts[i]!.length >= 4 && !out.has(ts[i]!)) out.set(ts[i]!, heading);
      if (i + 1 < ts.length) {
        const bi = `${ts[i]} ${ts[i + 1]}`;
        if (!out.has(bi)) out.set(bi, heading);
      }
    }
  }
  return out;
}

export interface ContentGap {
  topic: string;
  competitors: string[];
  examples: { competitor: string; heading: string; url: string }[];
}

/** Temas nos títulos e cabeçalhos dos concorrentes que não aparecem em nenhuma página do cliente. */
export function contentGaps(competitorPages: (PageInput & { competitorName: string })[], clientPages: PageInput[], opts: { brandTerms?: string[]; limit?: number } = {}): ContentGap[] {
  const exclude = new Set((opts.brandTerms ?? []).flatMap((b) => tokens(b)));
  const clientTopics = new Set<string>();
  for (const p of clientPages) {
    for (const t of pageTopics(p, new Set()).keys()) clientTopics.add(t);
    for (const t of tokens(new URL(p.url).pathname.replace(/[-_/]/g, " "))) clientTopics.add(t);
  }
  const byTopic = new Map<string, ContentGap>();
  for (const p of competitorPages) {
    for (const [topic, heading] of pageTopics(p, exclude)) {
      if (clientTopics.has(topic) || topic.split(" ").every((t) => clientTopics.has(t))) continue;
      const g = byTopic.get(topic) ?? { topic, competitors: [], examples: [] };
      if (!g.competitors.includes(p.competitorName)) g.competitors.push(p.competitorName);
      if (g.examples.length < 3 && !g.examples.some((e) => e.url === p.url)) g.examples.push({ competitor: p.competitorName, heading: heading.slice(0, 160), url: p.url });
      byTopic.set(topic, g);
    }
  }
  const nCompetitors = new Set(competitorPages.map((p) => p.competitorName)).size;
  const minCompetitors = nCompetitors >= 2 ? 2 : 1;
  const minExamples = nCompetitors >= 2 ? 1 : 2;
  const ranked = [...byTopic.values()]
    .filter((g) => g.competitors.length >= minCompetitors && g.examples.length >= minExamples)
    .sort((a, b) => b.competitors.length - a.competitors.length || b.topic.split(" ").length - a.topic.split(" ").length || b.examples.length - a.examples.length);
  const chosen: ContentGap[] = [];
  for (const g of ranked) {
    if (g.topic.split(" ").length === 1 && chosen.some((c) => c.topic.split(" ").includes(g.topic))) continue;
    chosen.push(g);
    if (chosen.length >= (opts.limit ?? 30)) break;
  }
  return chosen;
}

// ───────── Velocidade ─────────

export interface SpeedInput {
  url: string;
  competitorName: string | null;
  score: number | null;
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
type Summary = { pages: number; score: number | null; lcpMs: number | null; inpMs: number | null; cls: number | null };
const summarize = (rows: SpeedInput[]): Summary => ({
  pages: rows.length,
  score: median(rows.flatMap((r) => (r.score === null ? [] : [r.score]))),
  lcpMs: median(rows.flatMap((r) => (r.lcpMs === null ? [] : [r.lcpMs]))),
  inpMs: median(rows.flatMap((r) => (r.inpMs === null ? [] : [r.inpMs]))),
  cls: median(rows.flatMap((r) => (r.cls === null ? [] : [r.cls]))),
});

export function speedComparison(rows: SpeedInput[]) {
  const client = summarize(rows.filter((r) => r.competitorName === null));
  const names = [...new Set(rows.flatMap((r) => (r.competitorName ? [r.competitorName] : [])))];
  const competitors = names.map((name) => ({ name, ...summarize(rows.filter((r) => r.competitorName === name)) }));
  const all = summarize(rows.filter((r) => r.competitorName !== null));
  const verdict = (metric: "lcpMs" | "inpMs" | "cls" | "score") => {
    const c = client[metric];
    const o = all[metric];
    if (c === null || o === null) return null;
    const better = metric === "score" ? c > o : c < o;
    const tolerance = metric === "cls" ? 0.02 : metric === "score" ? 3 : o * 0.1;
    return Math.abs(c - o) <= tolerance ? "igual" : better ? "melhor" : "pior";
  };
  const slowClientPages = rows.filter((r) => r.competitorName === null && ((r.lcpMs ?? 0) > 2500 || (r.score !== null && r.score < 50) || (r.cls ?? 0) > 0.1));
  return { client, competitorsMedian: all, competitors, verdicts: { score: verdict("score"), lcpMs: verdict("lcpMs"), inpMs: verdict("inpMs"), cls: verdict("cls") }, slowClientPages };
}

// ───────── Mensagens dos anúncios ─────────

export const ANGLES = [
  { key: "PRICE", label: "Preço e descontos", re: /\b(\d{1,2} ?%|desconto|promocao|promo|saldos?|outlet|preco|precos|barato|poupe?|oferta|black friday)\b/ },
  { key: "SHIPPING", label: "Envio e entrega", re: /\b(portes|envio|envios|entrega|entregas|recolha)\b/ },
  { key: "URGENCY", label: "Urgência", re: /\b(so hoje|ultim[oa]s?|termina|ate (domingo|amanha|dia|\d)|limitad[oa]s?|esgota|agora ou nunca|por pouco tempo)\b/ },
  { key: "QUALITY", label: "Qualidade e materiais", re: /\b(qualidade|premium|feito a mao|artesana(l|is)|algodao|linho|la merino|merino|materiais|duravel|duraveis)\b/ },
  { key: "ORIGIN", label: "Origem e sustentabilidade", re: /\b(portugues|portuguesa|portugal|nacional|sustentave(l|is)|ecologic[oa]s?|organic[oa]s?|reciclad[oa]s?)\b/ },
  { key: "TRUST", label: "Confiança e garantias", re: /\b(garantia|devolucao|devolucoes|trocas?|avaliacoes|estrelas|clientes|desde \d{4}|anos de)\b/ },
  { key: "NEW", label: "Novidade e coleção", re: /\b(novo|nova|novos|novas|novidades?|colecao|lancamento|chegou|chegaram)\b/ },
] as const;

const CTA = /\b(compre|compra|encomende|encomenda|descubra|descobre|aproveite|aproveita|visite|visita|experimente|experimenta|reserve|reserva|subscreva|saiba mais|ver colecao|ver mais|marque|marca ja)\b/g;

export function adMessaging(ads: { competitorName: string; bodies: string[]; titles: string[]; descriptions?: string[] }[]) {
  const total = ads.length;
  const angles = ANGLES.map((a) => {
    const hits = ads.filter((ad) => a.re.test(normalize([...ad.bodies, ...ad.titles, ...(ad.descriptions ?? [])].join(" "))));
    return { key: a.key, label: a.label, count: hits.length, share: total ? hits.length / total : 0, competitors: [...new Set(hits.map((h) => h.competitorName))] };
  }).sort((a, b) => b.count - a.count);
  const ctas = new Map<string, number>();
  const offers = new Map<string, number>();
  for (const ad of ads) {
    const text = normalize([...ad.bodies, ...ad.titles].join(" "));
    for (const m of new Set([...text.matchAll(CTA)].map((x) => x[1]!))) ctas.set(m, (ctas.get(m) ?? 0) + 1);
    for (const m of new Set([...text.matchAll(/\b(\d{1,2}) ?%/g)].map((x) => `${x[1]}%`))) offers.set(m, (offers.get(m) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([text, count]) => ({ text, count }));
  return { total, angles, ctas: top(ctas), offers: top(offers) };
}
