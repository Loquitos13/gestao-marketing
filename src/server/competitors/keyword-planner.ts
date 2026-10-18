import { IntegrationError, requestJson } from "@/server/integrations/http";
import { base, classifyGoogleAds, headers } from "@/server/integrations/google/ads";

/** Portugal e português (constantes oficiais da Google Ads API). */
export const GEO_PT = "geoTargetConstants/2620";
export const LANG_PT = "languageConstants/1014";
export const MAX_IDEAS_PER_SEED = 500;

export type Seed = { site: string } | { url: string } | { keywords: string[] };

export interface KeywordIdeaRow {
  keyword: string;
  avgMonthlySearches: number | null;
  competition: string | null;
  competitionIndex: number | null;
  lowCpc: number | null;
  highCpc: number | null;
}

export function buildIdeasRequest(seed: Seed, pageToken?: string) {
  const body: Record<string, unknown> = { language: LANG_PT, geoTargetConstants: [GEO_PT], keywordPlanNetwork: "GOOGLE_SEARCH", includeAdultKeywords: false, pageSize: 500 };
  if ("site" in seed) body.siteSeed = { site: seed.site.replace(/^https?:\/\//, "").replace(/\/.*$/, "") };
  else if ("url" in seed) body.urlSeed = { url: seed.url };
  else body.keywordSeed = { keywords: seed.keywords.slice(0, 20) };
  if (pageToken) body.pageToken = pageToken;
  return body;
}

type Raw = { text?: string; keywordIdeaMetrics?: { avgMonthlySearches?: string | number; competition?: string; competitionIndex?: string | number; lowTopOfPageBidMicros?: string | number; highTopOfPageBidMicros?: string | number } };

const int = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
const micros = (v: unknown) => (v === undefined || v === null ? null : Math.round(Number(v) / 10_000) / 100);

export function parseIdeas(results: Raw[]): KeywordIdeaRow[] {
  const out = new Map<string, KeywordIdeaRow>();
  for (const r of results) {
    const keyword = (r.text ?? "").trim().toLowerCase();
    if (!keyword || keyword.length > 80 || out.has(keyword)) continue;
    const m = r.keywordIdeaMetrics ?? {};
    out.set(keyword, {
      keyword,
      avgMonthlySearches: int(m.avgMonthlySearches),
      competition: m.competition && m.competition !== "UNSPECIFIED" && m.competition !== "UNKNOWN" ? m.competition : null,
      competitionIndex: int(m.competitionIndex),
      lowCpc: micros(m.lowTopOfPageBidMicros),
      highCpc: micros(m.highTopOfPageBidMicros),
    });
  }
  return [...out.values()];
}

export interface PlannerCtx {
  customerId: string;
  token: string;
  loginCustomerId?: string | null;
  fetchImpl?: typeof fetch;
}

/** KeywordPlanIdeaService.GenerateKeywordIdeas. Exige developer token com acesso Básico (o de teste só funciona em contas de teste). */
export async function generateKeywordIdeas(ctx: PlannerCtx, seed: Seed, limit = MAX_IDEAS_PER_SEED): Promise<KeywordIdeaRow[]> {
  const cid = ctx.customerId.replace(/-/g, "");
  if (!/^\d+$/.test(cid)) throw new IntegrationError("Conta Google Ads inválida", "INVALID_REQUEST");
  const url = `${await base()}/customers/${cid}:generateKeywordIdeas`;
  const h = await headers(ctx.token, ctx.loginCustomerId);
  const raw: Raw[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5 && raw.length < limit; page++) {
    const r = await requestJson<{ results?: Raw[]; nextPageToken?: string }>(url, { headers: h, body: buildIdeasRequest(seed, pageToken), classify: classifyGoogleAds, maxRetries: 2, baseDelayMs: 5000, fetchImpl: ctx.fetchImpl });
    raw.push(...(r.results ?? []));
    pageToken = r.nextPageToken;
    if (!pageToken) break;
  }
  return parseIdeas(raw)
    .sort((a, b) => (b.avgMonthlySearches ?? 0) - (a.avgMonthlySearches ?? 0))
    .slice(0, limit);
}
