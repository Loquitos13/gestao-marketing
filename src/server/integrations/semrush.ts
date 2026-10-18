import { getConfig } from "@/server/config/settings";
import { IntegrationError } from "./http";
import type { Connector, ConnectorContext, SeoSnapshotInput, SyncResult } from "./types";

/** Respostas da Semrush API são CSV com separador ';'. Erros chegam como texto "ERROR NN :: ...". */
export function parseSemrushCsv(text: string): Record<string, string>[] {
  if (text.startsWith("ERROR")) {
    const kind = /ERROR 50 ::/.test(text) ? "NOT_FOUND" : /ERROR 13[0-9]|ERROR 120/.test(text) ? "AUTH" : "INVALID_REQUEST";
    throw new IntegrationError(`Semrush: ${text.trim()}`, kind);
  }
  const [header, ...lines] = text.trim().split(/\r?\n/);
  if (!header) return [];
  const cols = header.split(";");
  return lines.filter(Boolean).map((l) => Object.fromEntries(l.split(";").map((v, i) => [cols[i], v])));
}

async function call(params: Record<string, string>, path = "", fetchImpl: typeof fetch = fetch) {
  const key = (await getConfig()).SEMRUSH_API_KEY;
  if (!key) throw new IntegrationError("SEMRUSH_API_KEY não configurada", "CONFIG");
  const url = `https://api.semrush.com/${path}?${new URLSearchParams({ ...params, key })}`;
  const res = await fetchImpl(url);
  const text = await res.text();
  if (!res.ok) throw new IntegrationError(`Semrush HTTP ${res.status}`, res.status === 429 ? "RATE_LIMIT" : "UNKNOWN", res.status);
  return parseSemrushCsv(text);
}

/** Dados de fornecedor externo: SEMPRE marcados como estimativas (isEstimate = true). */
export const semrushConnector: Connector = {
  platform: "SEMRUSH",
  async sync(ctx: ConnectorContext): Promise<SyncResult> {
    const domain = ctx.dataSource.externalId.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const database = (await getConfig()).SEMRUSH_DATABASE;
    const today = ctx.range.end;
    const snapshots: SeoSnapshotInput[] = [];
    const [rank] = await call({ type: "domain_rank", domain, database, export_columns: "Dn,Rk,Or,Ot,Oc" });
    if (rank) {
      snapshots.push({ provider: "SEMRUSH", snapshotDate: today, metricKey: "organic_keywords", metricValue: Number(rank["Organic Keywords"] ?? rank.Or) || null });
      snapshots.push({ provider: "SEMRUSH", snapshotDate: today, metricKey: "organic_traffic_est", metricValue: Number(rank["Organic Traffic"] ?? rank.Ot) || null });
    }
    const kws = await call({ type: "domain_organic", domain, database, display_limit: "200", export_columns: "Ph,Po,Nq,Ur,Tr" });
    for (const k of kws) {
      snapshots.push({ provider: "SEMRUSH", snapshotDate: today, keyword: k.Keyword ?? k.Ph, position: Number(k.Position ?? k.Po) || null, searchVolume: Number(k["Search Volume"] ?? k.Nq) || null, url: k.Url ?? k.Ur ?? null, estTraffic: Number(k["Traffic (%)"] ?? k.Tr) || null });
    }
    try {
      const [bl] = await call({ type: "backlinks_overview", target: domain, target_type: "root_domain", export_columns: "total,domains_num" }, "analytics/v1/");
      if (bl) {
        snapshots.push({ provider: "SEMRUSH", snapshotDate: today, metricKey: "backlinks", metricValue: Number(bl.total) || null });
        snapshots.push({ provider: "SEMRUSH", snapshotDate: today, metricKey: "referring_domains", metricValue: Number(bl.domains_num) || null });
      }
    } catch (e) {
      await ctx.log.warn("Semrush backlinks indisponíveis no plano atual", { error: e instanceof Error ? e.message : String(e) });
    }
    return { seoSnapshots: snapshots, dataAvailableUntil: today };
  },
};
