import { requestJson } from "../http";
import type { Connector, ConnectorContext, DiscoveredAccount, SearchInput, SyncResult } from "../types";

const BASE = "https://www.googleapis.com/webmasters/v3";
const ROW_LIMIT = 25000;

type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };

export async function discoverSearchConsoleSites(token: string): Promise<DiscoveredAccount[]> {
  const res = await requestJson<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>(`${BASE}/sites`, { headers: { Authorization: `Bearer ${token}` } });
  return (res.siteEntry ?? [])
    .filter((s) => s.permissionLevel !== "siteUnverifiedUser")
    .map((s) => ({ platform: "SEARCH_CONSOLE" as const, externalId: s.siteUrl, name: s.siteUrl, metadata: { permissionLevel: s.permissionLevel } }));
}

/** searchAnalytics.query com paginação por startRow (máx. 25 000 linhas por pedido). */
export async function gscQuery(siteUrl: string, token: string, body: Record<string, unknown>, fetchImpl?: typeof fetch, maxRows = 200_000): Promise<GscRow[]> {
  const out: GscRow[] = [];
  for (let startRow = 0; startRow < maxRows; startRow += ROW_LIMIT) {
    const res = await requestJson<{ rows?: GscRow[] }>(`${BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
      headers: { Authorization: `Bearer ${token}` },
      body: { ...body, rowLimit: ROW_LIMIT, startRow },
      fetchImpl,
    });
    const rows = res.rows ?? [];
    out.push(...rows);
    if (rows.length < ROW_LIMIT) break;
  }
  return out;
}

const A3: Record<string, string> = { prt: "PT", esp: "ES", fra: "FR", bra: "BR", gbr: "GB", deu: "DE", usa: "US", ita: "IT", che: "CH", nld: "NL", bel: "BE", ago: "AO", moz: "MZ", lux: "LU", irl: "IE", can: "CA" };
export const countryA3 = (c: string) => A3[c.toLowerCase()] ?? c.toUpperCase();

export const searchConsoleConnector: Connector = {
  platform: "SEARCH_CONSOLE",
  async sync(ctx: ConnectorContext): Promise<SyncResult> {
    const token = await ctx.accessToken();
    const site = ctx.dataSource.externalId;
    const { start, end } = ctx.range;
    const q = (dimensions: string[]) => gscQuery(site, token, { startDate: start, endDate: end, dimensions, type: "web", dataState: "final" });
    const [total, query, page, device, country] = await Promise.all([q(["date"]), q(["date", "query"]), q(["date", "page"]), q(["date", "device"]), q(["date", "country"])]);
    const map = (rows: GscRow[], dimension: SearchInput["dimension"], keyFn: (k: string) => string = (k) => k): SearchInput[] =>
      rows.map((r) => ({ dimension, key: dimension === "TOTAL" ? "" : keyFn(r.keys[1]), date: r.keys[0], clicks: r.clicks, impressions: r.impressions, positionSum: r.position * r.impressions }));
    const search = [...map(total, "TOTAL"), ...map(query, "QUERY"), ...map(page, "PAGE"), ...map(device, "DEVICE", (k) => k.toUpperCase()), ...map(country, "COUNTRY", countryA3)];
    const last = total.reduce<string | null>((a, r) => (!a || r.keys[0] > a ? r.keys[0] : a), null);
    await ctx.log.info("Search Console: dados obtidos", { rows: search.length, lastDate: last });
    if (query.length === ROW_LIMIT * 8) await ctx.log.warn("Limite de linhas de consultas atingido; dados de cauda longa podem estar incompletos.");
    return { search, dataAvailableUntil: last };
  },
};
