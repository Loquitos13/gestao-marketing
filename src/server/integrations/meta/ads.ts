import { addDays, dayCount, minDate } from "@/lib/dates";
import { normalizeDevice } from "../google/ads";
import type { AdMetricInput, BreakdownInput, Connector, ConnectorContext, DiscoveredAccount, EntityBatch, SyncResult } from "../types";
import { graphPaginate } from "./graph";

type Action = { action_type: string; value: string };
type Insight = Record<string, unknown> & { actions?: Action[]; action_values?: Action[] };

const INSIGHT_FIELDS = [
  "campaign_id",
  "adset_id",
  "ad_id",
  "date_start",
  "account_currency",
  "impressions",
  "reach",
  "clicks",
  "inline_link_clicks",
  "outbound_clicks",
  "spend",
  "actions",
  "action_values",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p100_watched_actions",
  "video_thruplay_watched_actions",
].join(",");

const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/** Soma o valor do primeiro action_type existente na lista de preferência (evita contar duplicados como omni_* + pixel). */
export function pickAction(actions: Action[] | undefined, preference: string[]): number | null {
  if (!actions) return null;
  for (const t of preference) {
    const a = actions.find((x) => x.action_type === t);
    if (a) return num(a.value);
  }
  return null;
}

const firstVal = (v: unknown) => (Array.isArray(v) ? num((v as Action[])[0]?.value) : null);

const LEADS = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];
const PURCHASES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];

/**
 * Mapeia uma linha de Insights. "conversions" = resultado principal do objetivo
 * (vendas → compras; leads → leads; outros → compras ou leads se existirem).
 */
export function mapInsight(r: Insight, objective: string | null | undefined, level: "CAMPAIGN" | "AD"): AdMetricInput {
  const leads = pickAction(r.actions, LEADS);
  const purchases = pickAction(r.actions, PURCHASES);
  const purchaseValue = pickAction(r.action_values, PURCHASES);
  const conversions = objective === "OUTCOME_SALES" ? purchases : objective === "OUTCOME_LEADS" ? leads : (purchases ?? leads);
  const reactions = pickAction(r.actions, ["post_reaction"]);
  const comments = pickAction(r.actions, ["comment"]);
  const shares = pickAction(r.actions, ["post"]);
  return {
    level,
    campaignExternalId: String(r.campaign_id),
    adGroupExternalId: level === "AD" ? String(r.adset_id ?? "") : "",
    adExternalId: level === "AD" ? String(r.ad_id ?? "") : "",
    date: String(r.date_start),
    currency: String(r.account_currency ?? ""),
    impressions: num(r.impressions) ?? 0,
    clicks: num(r.clicks) ?? 0,
    cost: num(r.spend) ?? 0,
    reach: num(r.reach),
    linkClicks: num(r.inline_link_clicks),
    outboundClicks: firstVal(r.outbound_clicks),
    landingPageViews: pickAction(r.actions, ["landing_page_view", "omni_landing_page_view"]),
    conversions,
    conversionValue: objective === "OUTCOME_LEADS" ? null : purchaseValue,
    leads,
    purchases,
    purchaseValue,
    videoViews: pickAction(r.actions, ["video_view"]),
    thruplays: firstVal(r.video_thruplay_watched_actions),
    videoP25: firstVal(r.video_p25_watched_actions),
    videoP50: firstVal(r.video_p50_watched_actions),
    videoP75: firstVal(r.video_p75_watched_actions),
    videoP100: firstVal(r.video_p100_watched_actions),
    engagements: pickAction(r.actions, ["post_engagement"]),
    reactions,
    comments,
    shares,
    messages: pickAction(r.actions, ["onsite_conversion.messaging_conversation_started_7d"]),
  };
}

export async function discoverMetaAdAccounts(token: string): Promise<DiscoveredAccount[]> {
  const rows = await graphPaginate<{ id: string; name: string; currency: string; timezone_name: string; account_status: number }>("me/adaccounts", token, {
    fields: "id,name,currency,timezone_name,account_status",
    limit: "100",
  });
  return rows.map((a) => ({ platform: "META_ADS", externalId: a.id, name: a.name, currency: a.currency, timezone: a.timezone_name, metadata: { accountStatus: a.account_status } }));
}

/** Moedas sem subunidade na Graph API (orçamentos em unidades inteiras); as restantes usam fator 100. */
const OFFSET_1 = new Set(["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"]);
export const metaCurrencyOffset = (currency: string | null | undefined) => (OFFSET_1.has((currency ?? "").toUpperCase()) ? 1 : 100);

/** Divide intervalos longos em blocos de 30 dias (respostas síncronas mais fiáveis). */
export function chunks(start: string, end: string, size = 30): { since: string; until: string }[] {
  const out: { since: string; until: string }[] = [];
  for (let s = start; s <= end; s = addDays(s, size)) out.push({ since: s, until: minDate(addDays(s, size - 1), end) });
  return out;
}

export const metaAdsConnector: Connector = {
  platform: "META_ADS",
  async sync(ctx: ConnectorContext): Promise<SyncResult> {
    const token = await ctx.accessToken();
    const act = ctx.dataSource.externalId;
    const [camps, adsets, ads] = await Promise.all([
      graphPaginate<Record<string, string>>(`${act}/campaigns`, token, { fields: "id,name,status,objective,daily_budget,lifetime_budget,buying_type", limit: "200" }),
      graphPaginate<Record<string, string>>(`${act}/adsets`, token, { fields: "id,name,status,campaign_id,daily_budget,lifetime_budget", limit: "200" }),
      graphPaginate<Record<string, unknown>>(`${act}/ads`, token, {
        fields: "id,name,status,adset_id,created_time,creative{id,title,body,object_type,image_url,thumbnail_url,video_id,call_to_action_type,effective_object_story_id}",
        limit: "200",
      }),
    ]);
    const objective = new Map(camps.map((c) => [c.id, c.objective]));
    const offset = metaCurrencyOffset(ctx.dataSource.currency);
    const entities: EntityBatch = {
      // Orçamentos vêm em unidades mínimas da moeda (ex.: cêntimos)
      campaigns: camps.map((c) => ({
        externalId: c.id,
        name: c.name,
        status: c.status,
        objective: c.objective,
        campaignType: c.buying_type,
        dailyBudget: c.daily_budget ? Number(c.daily_budget) / offset : null,
        raw: { budgetLevel: c.daily_budget ? "CAMPAIGN" : c.lifetime_budget ? "CAMPAIGN_LIFETIME" : "ADSET", currencyOffset: offset },
      })),
      adGroups: adsets.map((s) => ({
        externalId: s.id,
        campaignExternalId: s.campaign_id,
        name: s.name,
        status: s.status,
        dailyBudget: s.daily_budget && Number(s.daily_budget) > 0 ? Number(s.daily_budget) / offset : null,
        raw: { lifetimeBudget: s.lifetime_budget && Number(s.lifetime_budget) > 0 ? Number(s.lifetime_budget) / offset : null, currencyOffset: offset },
      })),
      ads: ads.map((a) => {
        const cr = (a.creative ?? {}) as Record<string, string | undefined>;
        return {
          externalId: String(a.id),
          adGroupExternalId: String(a.adset_id),
          name: String(a.name),
          status: String(a.status),
          adType: cr.object_type ?? null,
          createdTime: a.created_time ? new Date(String(a.created_time)) : null,
          creative: cr.id
            ? {
                externalId: cr.id,
                format: cr.video_id ? "VIDEO" : (cr.object_type ?? null),
                primaryText: cr.body ?? null,
                title: cr.title ?? null,
                callToAction: cr.call_to_action_type ?? null,
                imageUrl: cr.image_url ?? null,
                thumbnailUrl: cr.thumbnail_url ?? null,
                videoId: cr.video_id ?? null,
                postId: cr.effective_object_story_id ?? null,
              }
            : null,
        };
      }),
    };

    const adMetrics: AdMetricInput[] = [];
    const breakdowns: BreakdownInput[] = [];
    for (const { since, until } of chunks(ctx.range.start, ctx.range.end)) {
      const common = { time_increment: "1", time_range: JSON.stringify({ since, until }), limit: "500" };
      const [adRows, campRows, devRows, geoRows] = await Promise.all([
        graphPaginate<Insight>(`${act}/insights`, token, { ...common, level: "ad", fields: INSIGHT_FIELDS }),
        graphPaginate<Insight>(`${act}/insights`, token, { ...common, level: "campaign", fields: INSIGHT_FIELDS }),
        graphPaginate<Insight>(`${act}/insights`, token, { ...common, level: "campaign", breakdowns: "impression_device", fields: "campaign_id,date_start,account_currency,impressions,clicks,spend,actions,action_values" }),
        graphPaginate<Insight>(`${act}/insights`, token, { ...common, level: "campaign", breakdowns: "country", fields: "campaign_id,date_start,account_currency,impressions,clicks,spend,actions,action_values" }),
      ]);
      adMetrics.push(...adRows.map((r) => mapInsight(r, objective.get(String(r.campaign_id)), "AD")));
      adMetrics.push(...campRows.map((r) => mapInsight(r, objective.get(String(r.campaign_id)), "CAMPAIGN")));
      const toBd = (r: Insight, dimension: "DEVICE" | "COUNTRY", value: string): BreakdownInput => {
        const m = mapInsight(r, objective.get(String(r.campaign_id)), "CAMPAIGN");
        return { campaignExternalId: m.campaignExternalId, date: m.date, dimension, value, currency: m.currency, impressions: m.impressions, clicks: m.clicks, cost: m.cost, conversions: m.conversions, conversionValue: m.conversionValue, leads: m.leads };
      };
      breakdowns.push(...devRows.map((r) => toBd(r, "DEVICE", normalizeDevice(String(r.impression_device ?? "")))));
      breakdowns.push(...geoRows.map((r) => toBd(r, "COUNTRY", String(r.country ?? "").toUpperCase())));
      await ctx.log.info(`Meta Insights ${since}→${until}`, { adRows: adRows.length, campaignRows: campRows.length, days: dayCount(since, until) });
    }
    // Agregar dispositivos normalizados (iphone + android_smartphone → MOBILE)
    const merged = new Map<string, BreakdownInput>();
    for (const b of breakdowns) {
      const k = `${b.campaignExternalId}|${b.date}|${b.dimension}|${b.value}`;
      const e = merged.get(k);
      if (!e) merged.set(k, { ...b });
      else {
        e.impressions += b.impressions;
        e.clicks += b.clicks;
        e.cost += b.cost;
        e.conversions = (e.conversions ?? 0) + (b.conversions ?? 0);
        e.leads = (e.leads ?? 0) + (b.leads ?? 0);
        e.conversionValue = e.conversionValue === null && b.conversionValue === null ? null : (e.conversionValue ?? 0) + (b.conversionValue ?? 0);
      }
    }
    const last = adMetrics.reduce<string | null>((a, m) => (!a || m.date > a ? m.date : a), null);
    return { entities, adMetrics, breakdowns: [...merged.values()], dataAvailableUntil: last };
  },
};
