import { getConfig } from "@/server/config/settings";
import { IntegrationError, requestJson } from "../http";
import type { AdMetricInput, BreakdownInput, Connector, ConnectorContext, DiscoveredAccount, EntityBatch, SyncResult, TermInput } from "../types";

type Row = Record<string, Record<string, unknown>>;

export const base = async () => `https://googleads.googleapis.com/${(await getConfig()).GOOGLE_ADS_API_VERSION}`;

export async function headers(token: string, loginCustomerId?: string | null): Promise<Record<string, string>> {
  const c = await getConfig();
  const dev = c.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!dev) throw new IntegrationError("GOOGLE_ADS_DEVELOPER_TOKEN não configurado", "CONFIG");
  const h: Record<string, string> = { Authorization: `Bearer ${token}`, "developer-token": dev };
  const login = loginCustomerId ?? c.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  if (login) h["login-customer-id"] = login.replace(/-/g, "");
  return h;
}

export const classifyGoogleAds = (status: number, body: unknown) => {
  if (status < 400) return null;
  const s = JSON.stringify(body ?? "");
  if (/RESOURCE_EXHAUSTED|RESOURCE_TEMPORARILY_EXHAUSTED/.test(s)) return "RATE_LIMIT" as const;
  if (/USER_PERMISSION_DENIED|DEVELOPER_TOKEN_NOT_APPROVED|CUSTOMER_NOT_ENABLED/.test(s)) return "PERMISSION" as const;
  if (/QUERY_ERROR|PROHIBITED_.*_IN_SELECT|UNRECOGNIZED_FIELD/.test(s)) return "INVALID_REQUEST" as const;
  return null;
};

/** Executa uma consulta GAQL e percorre todas as páginas (nextPageToken). */
export async function gaqlSearch(customerId: string, query: string, token: string, loginCustomerId?: string | null, fetchImpl?: typeof fetch): Promise<Row[]> {
  const out: Row[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  const [url, h] = [`${await base()}/customers/${customerId.replace(/-/g, "")}/googleAds:search`, await headers(token, loginCustomerId)];
  do {
    const res = await requestJson<{ results?: Row[]; nextPageToken?: string }>(url, {
      headers: h,
      body: { query, ...(pageToken ? { pageToken } : {}) },
      classify: classifyGoogleAds,
      fetchImpl,
    });
    out.push(...(res.results ?? []));
    pageToken = res.nextPageToken;
    if (++pages > 500) throw new IntegrationError("Demasiadas páginas na resposta GAQL", "INVALID_REQUEST");
  } while (pageToken);
  return out;
}

export async function discoverGoogleAdsAccounts(token: string): Promise<DiscoveredAccount[]> {
  const res = await requestJson<{ resourceNames?: string[] }>(`${await base()}/customers:listAccessibleCustomers`, { headers: await headers(token, null), classify: classifyGoogleAds });
  const out: DiscoveredAccount[] = [];
  for (const rn of res.resourceNames ?? []) {
    const id = rn.split("/")[1];
    try {
      const [c] = await gaqlSearch(id, "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer", token, id);
      const cust = c?.customer ?? {};
      if (cust.manager) {
        const children = await gaqlSearch(
          id,
          "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager FROM customer_client WHERE customer_client.level = 1",
          token,
          id,
        );
        for (const ch of children) {
          const cc = ch.customer_client ?? ch.customerClient ?? {};
          if (cc.manager) continue;
          out.push({ platform: "GOOGLE_ADS", externalId: String(cc.id), name: String(cc.descriptiveName ?? cc.id), currency: String(cc.currencyCode ?? ""), timezone: String(cc.timeZone ?? ""), managerId: id });
        }
      } else {
        out.push({ platform: "GOOGLE_ADS", externalId: id, name: String(cust.descriptiveName ?? id), currency: String(cust.currencyCode ?? ""), timezone: String(cust.timeZone ?? ""), managerId: null });
      }
    } catch (e) {
      if (e instanceof IntegrationError && e.kind === "PERMISSION") continue;
      throw e;
    }
  }
  return out;
}

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
const nn = (v: unknown): number | null => (v === undefined || v === null ? null : n(v));
const micros = (v: unknown) => Math.round(n(v) / 10_000) / 100;
const ga = (r: Row, obj: string) => (r[obj] ?? {}) as Record<string, unknown>;

/** Valores "< 10%" são reportados pela API como 0.0999; mantemos o valor tal como devolvido. */
const share = (v: unknown) => (v === undefined || v === null ? null : n(v));

const METRIC_FIELDS = "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.interactions, metrics.conversions, metrics.conversions_value, metrics.all_conversions, metrics.all_conversions_value";

export function mapMetrics(r: Row, currency: string, leadsFromConversions: boolean) {
  const m = ga(r, "metrics");
  const conv = nn(m.conversions);
  return {
    impressions: n(m.impressions),
    clicks: n(m.clicks),
    cost: micros(m.costMicros),
    interactions: nn(m.interactions),
    conversions: conv,
    conversionValue: nn(m.conversionsValue),
    allConversions: nn(m.allConversions),
    allConversionValue: nn(m.allConversionsValue),
    leads: leadsFromConversions ? conv : null,
    currency,
  };
}

export const googleAdsConnector: Connector = {
  platform: "GOOGLE_ADS",
  async sync(ctx: ConnectorContext): Promise<SyncResult> {
    const ds = ctx.dataSource;
    const token = await ctx.accessToken();
    const settings = (ds.settings ?? {}) as { managerId?: string; leadsFromConversions?: boolean };
    const cid = ds.externalId;
    const login = settings.managerId ?? null;
    const q = (query: string) => gaqlSearch(cid, query, token, login);
    const { start, end } = ctx.range;
    const during = `segments.date BETWEEN '${start}' AND '${end}'`;
    const cur = ds.currency;
    const leads = Boolean(settings.leadsFromConversions);

    const [camps, groups, ads] = await Promise.all([
      q("SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign_budget.amount_micros, campaign_budget.resource_name, campaign_budget.explicitly_shared FROM campaign WHERE campaign.status != 'REMOVED'"),
      q("SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id FROM ad_group WHERE ad_group.status != 'REMOVED'"),
      q(
        "SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ad_group_ad.ad.type, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group.id FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'",
      ),
    ]);
    const entities: EntityBatch = {
      campaigns: camps.map((r) => {
        const c = ga(r, "campaign");
        return {
          externalId: String(c.id),
          name: String(c.name),
          status: String(c.status),
          campaignType: String(c.advertisingChannelType ?? ""),
          objective: String(c.advertisingChannelType ?? ""),
          biddingStrategy: String(c.biddingStrategyType ?? ""),
          dailyBudget: ga(r, "campaignBudget").amountMicros ? micros(ga(r, "campaignBudget").amountMicros) : null,
          raw: { budgetResourceName: ga(r, "campaignBudget").resourceName ?? null, budgetShared: Boolean(ga(r, "campaignBudget").explicitlyShared) },
        };
      }),
      adGroups: groups.map((r) => ({ externalId: String(ga(r, "adGroup").id), campaignExternalId: String(ga(r, "campaign").id), name: String(ga(r, "adGroup").name), status: String(ga(r, "adGroup").status) })),
      ads: ads.map((r) => {
        const aga = ga(r, "adGroupAd");
        const ad = (aga.ad ?? {}) as Record<string, unknown>;
        const rsa = (ad.responsiveSearchAd ?? {}) as { headlines?: { text: string }[]; descriptions?: { text: string }[] };
        return {
          externalId: String(ad.id),
          adGroupExternalId: String(ga(r, "adGroup").id),
          name: String(ad.name ?? `Anúncio ${ad.id}`),
          status: String(aga.status),
          adType: String(ad.type ?? ""),
          finalUrl: Array.isArray(ad.finalUrls) ? String(ad.finalUrls[0] ?? "") : null,
          headlines: (rsa.headlines ?? []).map((h) => h.text),
          descriptions: (rsa.descriptions ?? []).map((d) => d.text),
        };
      }),
    };

    const [campDaily, isDaily, adDaily, device, geo, kw, st] = await Promise.all([
      q(`SELECT campaign.id, segments.date, ${METRIC_FIELDS} FROM campaign WHERE ${during}`),
      q(`SELECT campaign.id, segments.date, metrics.impressions, metrics.search_impression_share, metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share FROM campaign WHERE ${during} AND campaign.advertising_channel_type IN ('SEARCH', 'SHOPPING')`),
      q(`SELECT campaign.id, ad_group.id, ad_group_ad.ad.id, segments.date, ${METRIC_FIELDS} FROM ad_group_ad WHERE ${during}`),
      q(`SELECT campaign.id, segments.date, segments.device, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE ${during}`),
      q(`SELECT campaign.id, segments.date, geographic_view.country_criterion_id, geographic_view.location_type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM geographic_view WHERE ${during} AND geographic_view.location_type = 'LOCATION_OF_PRESENCE'`),
      q(`SELECT campaign.id, ad_group.id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM keyword_view WHERE ${during}`),
      q(`SELECT campaign.id, ad_group.id, search_term_view.search_term, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM search_term_view WHERE ${during}`),
    ]);

    const isMap = new Map(isDaily.map((r) => [`${ga(r, "campaign").id}|${ga(r, "segments").date}`, ga(r, "metrics")]));
    const adMetrics: AdMetricInput[] = campDaily.map((r) => {
      const key = `${ga(r, "campaign").id}|${ga(r, "segments").date}`;
      const m = isMap.get(key);
      const is = share(m?.searchImpressionShare);
      const base = mapMetrics(r, cur, leads);
      return {
        level: "CAMPAIGN",
        campaignExternalId: String(ga(r, "campaign").id),
        date: String(ga(r, "segments").date),
        ...base,
        searchImpressionShare: is,
        searchLostIsBudget: share(m?.searchBudgetLostImpressionShare),
        searchLostIsRank: share(m?.searchRankLostImpressionShare),
        eligibleImpressionsApprox: is && is > 0 ? Math.round(base.impressions / is) : null,
      };
    });
    for (const r of adDaily) {
      adMetrics.push({
        level: "AD",
        campaignExternalId: String(ga(r, "campaign").id),
        adGroupExternalId: String(ga(r, "adGroup").id),
        adExternalId: String((ga(r, "adGroupAd").ad as Record<string, unknown>)?.id ?? ""),
        date: String(ga(r, "segments").date),
        ...mapMetrics(r, cur, leads),
      });
    }
    const bd = (r: Row, dimension: "DEVICE" | "COUNTRY", value: string): BreakdownInput => {
      const m = mapMetrics(r, cur, leads);
      return { campaignExternalId: String(ga(r, "campaign").id), date: String(ga(r, "segments").date), dimension, value, currency: cur, impressions: m.impressions, clicks: m.clicks, cost: m.cost, conversions: m.conversions, conversionValue: m.conversionValue, leads: m.leads };
    };
    const breakdowns = [
      ...mergeBreakdowns(device.map((r) => bd(r, "DEVICE", normalizeDevice(String(ga(r, "segments").device))))),
      ...mergeBreakdowns(geo.map((r) => bd(r, "COUNTRY", countryFromCriterion(String(ga(r, "geographicView").countryCriterionId))))),
    ];
    const term = (r: Row, kind: TermInput["kind"], text: string, matchType = ""): TermInput => {
      const m = mapMetrics(r, cur, leads);
      return { kind, campaignExternalId: String(ga(r, "campaign").id), adGroupExternalId: String(ga(r, "adGroup").id), text, matchType, date: String(ga(r, "segments").date), currency: cur, impressions: m.impressions, clicks: m.clicks, cost: m.cost, conversions: m.conversions, conversionValue: m.conversionValue };
    };
    const terms = [
      ...kw.map((r) => {
        const k = (ga(r, "adGroupCriterion").keyword ?? {}) as Record<string, unknown>;
        return term(r, "KEYWORD", String(k.text ?? ""), String(k.matchType ?? ""));
      }),
      ...st.map((r) => term(r, "SEARCH_TERM", String(ga(r, "searchTermView").searchTerm ?? ""))),
    ];
    const last = adMetrics.reduce<string | null>((a, m) => (!a || m.date > a ? m.date : a), null);
    await ctx.log.info("Google Ads: dados obtidos", { campaigns: entities.campaigns.length, metricRows: adMetrics.length, terms: terms.length });
    return { entities, adMetrics, breakdowns, terms, dataAvailableUntil: last };
  },
};

export function normalizeDevice(v: string): string {
  const s = v.toUpperCase();
  if (s.includes("MOBILE") || s === "IPHONE" || s === "ANDROID_SMARTPHONE") return "MOBILE";
  if (s.includes("TABLET") || s === "IPAD") return "TABLET";
  if (s.includes("DESKTOP")) return "DESKTOP";
  return "OTHER";
}

/** Principais IDs de geo_target_constant (país). Desconhecidos ficam como "GEO:<id>". */
const GEO: Record<string, string> = { "2620": "PT", "2724": "ES", "2250": "FR", "2076": "BR", "2826": "GB", "2276": "DE", "2840": "US", "2380": "IT", "2756": "CH", "2528": "NL", "2056": "BE", "2024": "AO", "2508": "MZ", "2442": "LU" };

export function countryFromCriterion(id: string): string {
  const k = id.replace("geoTargetConstants/", "");
  return GEO[k] ?? `GEO:${k}`;
}

function mergeBreakdowns(rows: BreakdownInput[]): BreakdownInput[] {
  const m = new Map<string, BreakdownInput>();
  for (const r of rows) {
    const k = `${r.campaignExternalId}|${r.date}|${r.dimension}|${r.value}`;
    const e = m.get(k);
    if (!e) m.set(k, { ...r });
    else {
      e.impressions += r.impressions;
      e.clicks += r.clicks;
      e.cost += r.cost;
      e.conversions = (e.conversions ?? 0) + (r.conversions ?? 0);
      e.conversionValue = (e.conversionValue ?? 0) + (r.conversionValue ?? 0);
    }
  }
  return [...m.values()];
}
