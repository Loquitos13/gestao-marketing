import { requestJson } from "../http";
import type { Connector, ConnectorContext, DiscoveredAccount, SyncResult, WebInput } from "../types";

const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
const DATA = "https://analyticsdata.googleapis.com/v1beta";
const PAGE = 100_000;

const METRICS = ["activeUsers", "newUsers", "sessions", "engagedSessions", "screenPageViews", "eventCount", "keyEvents", "ecommercePurchases", "purchaseRevenue", "bounceRate"];

const DIMENSIONS: { dimension: WebInput["dimension"]; ga: string | null }[] = [
  { dimension: "TOTAL", ga: null },
  { dimension: "CHANNEL", ga: "sessionDefaultChannelGroup" },
  { dimension: "SOURCE_MEDIUM", ga: "sessionSourceMedium" },
  { dimension: "CAMPAIGN", ga: "sessionCampaignName" },
  { dimension: "LANDING_PAGE", ga: "landingPage" },
  { dimension: "DEVICE", ga: "deviceCategory" },
  { dimension: "COUNTRY", ga: "countryId" },
];

type Ga4Row = { dimensionValues: { value: string }[]; metricValues: { value: string }[] };

export async function discoverGa4Properties(token: string): Promise<DiscoveredAccount[]> {
  const out: DiscoveredAccount[] = [];
  let pageToken: string | undefined;
  do {
    const res = await requestJson<{ accountSummaries?: { displayName: string; propertySummaries?: { property: string; displayName: string }[] }[]; nextPageToken?: string }>(
      `${ADMIN}/accountSummaries?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    for (const a of res.accountSummaries ?? []) {
      for (const p of a.propertySummaries ?? []) {
        const meta = await requestJson<{ currencyCode?: string; timeZone?: string }>(`${ADMIN}/${p.property}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({}) as { currencyCode?: string; timeZone?: string });
        out.push({ platform: "GA4", externalId: p.property, name: `${a.displayName} · ${p.displayName}`, currency: meta.currencyCode, timezone: meta.timeZone });
      }
    }
    pageToken = res.nextPageToken;
  } while (pageToken);
  return out;
}

export async function runReport(property: string, token: string, body: Record<string, unknown>, fetchImpl?: typeof fetch): Promise<Ga4Row[]> {
  const out: Ga4Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await requestJson<{ rows?: Ga4Row[]; rowCount?: number }>(`${DATA}/${property}:runReport`, {
      headers: { Authorization: `Bearer ${token}` },
      body: { ...body, limit: PAGE, offset },
      fetchImpl,
    });
    out.push(...(res.rows ?? []));
    if (!res.rowCount || offset + PAGE >= res.rowCount) break;
  }
  return out;
}

const gaDate = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const n = (v: string | undefined) => {
  if (v === undefined) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

export function mapGa4Row(r: Ga4Row, dimension: WebInput["dimension"], currency: string, hasKey: boolean): WebInput {
  const m = r.metricValues.map((x) => x.value);
  const key = hasKey ? r.dimensionValues[1]?.value ?? "" : "";
  return {
    dimension,
    key: dimension === "DEVICE" ? key.toUpperCase() : key,
    date: gaDate(r.dimensionValues[0].value),
    currency,
    users: n(m[0]),
    newUsers: n(m[1]),
    sessions: n(m[2]) ?? 0,
    engagedSessions: n(m[3]),
    views: n(m[4]),
    events: n(m[5]),
    keyEvents: n(m[6]),
    purchases: n(m[7]),
    revenue: n(m[8]),
    bounceRate: n(m[9]),
  };
}

export const ga4Connector: Connector = {
  platform: "GA4",
  async sync(ctx: ConnectorContext): Promise<SyncResult> {
    const token = await ctx.accessToken();
    const property = ctx.dataSource.externalId;
    const web: WebInput[] = [];
    for (const d of DIMENSIONS) {
      const rows = await runReport(property, token, {
        dateRanges: [{ startDate: ctx.range.start, endDate: ctx.range.end }],
        dimensions: [{ name: "date" }, ...(d.ga ? [{ name: d.ga }] : [])],
        metrics: METRICS.map((name) => ({ name })),
        keepEmptyRows: false,
      });
      web.push(...rows.map((r) => mapGa4Row(r, d.dimension, ctx.dataSource.currency, Boolean(d.ga))));
    }
    const last = web.filter((w) => w.dimension === "TOTAL").reduce<string | null>((a, w) => (!a || w.date > a ? w.date : a), null);
    await ctx.log.info("GA4: dados obtidos", { rows: web.length });
    return { web, dataAvailableUntil: last };
  },
};
