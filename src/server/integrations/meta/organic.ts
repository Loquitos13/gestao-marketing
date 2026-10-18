import { IntegrationError } from "../http";
import type { Connector, ConnectorContext, DiscoveredAccount, OrganicInput, SyncResult } from "../types";
import { graphGet, graphPaginate } from "./graph";

/**
 * Conteúdo orgânico de Páginas Facebook e contas Instagram Business associadas.
 * Os nomes de métricas de insights mudam com frequência (ex.: retirada de "impressions"/"reach" em 2026);
 * por isso usamos apenas campos estáveis + insights opcionais, e marcamos o resto como indisponível.
 */
export async function discoverMetaPages(token: string): Promise<DiscoveredAccount[]> {
  const pages = await graphPaginate<{ id: string; name: string; instagram_business_account?: { id: string } }>("me/accounts", token, { fields: "id,name,instagram_business_account", limit: "100" });
  return pages.map((p) => ({ platform: "META_ORGANIC" as const, externalId: p.id, name: p.name, metadata: { instagramId: p.instagram_business_account?.id ?? null } }));
}

async function pageToken(userToken: string, pageId: string): Promise<string> {
  const r = await graphGet<{ access_token?: string }>(pageId, userToken, { fields: "access_token" });
  if (!r.access_token) throw new IntegrationError("Sem token de página (permissão pages_read_engagement em falta?)", "PERMISSION");
  return r.access_token;
}

export const metaOrganicConnector: Connector = {
  platform: "META_ORGANIC",
  async sync(ctx: ConnectorContext): Promise<SyncResult> {
    const userToken = await ctx.accessToken();
    const pageId = ctx.dataSource.externalId;
    const igId = ((ctx.dataSource.settings ?? {}) as { instagramId?: string }).instagramId;
    const since = Math.floor(new Date(`${ctx.range.start}T00:00:00Z`).getTime() / 1000).toString();
    const until = Math.floor(new Date(`${ctx.range.end}T23:59:59Z`).getTime() / 1000).toString();
    const pt = await pageToken(userToken, pageId);
    const organic: OrganicInput[] = [];

    const posts = await graphPaginate<Record<string, unknown>>(`${pageId}/posts`, pt, {
      fields: "id,message,created_time,permalink_url,shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)",
      since,
      until,
      limit: "50",
    });
    for (const p of posts) {
      organic.push({
        platform: "FACEBOOK",
        externalId: String(p.id),
        url: (p.permalink_url as string) ?? null,
        text: (p.message as string) ?? null,
        title: ((p.message as string) ?? "").slice(0, 80) || null,
        publishedAt: p.created_time ? new Date(String(p.created_time)) : null,
        reactions: (p.reactions as { summary?: { total_count?: number } })?.summary?.total_count ?? null,
        comments: (p.comments as { summary?: { total_count?: number } })?.summary?.total_count ?? null,
        shares: (p.shares as { count?: number })?.count ?? 0,
        unavailable: ["impressions", "reach", "saves", "clicks", "conversions", "videoViews", "watchTimeSec"],
      });
    }

    if (igId) {
      const media = await graphPaginate<Record<string, unknown>>(`${igId}/media`, pt, {
        fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,thumbnail_url,media_url",
        since,
        until,
        limit: "50",
      });
      const insightMetrics = process.env.META_IG_INSIGHT_METRICS || "reach,saved,shares,views";
      for (const m of media) {
        const item: OrganicInput = {
          platform: "INSTAGRAM",
          externalId: String(m.id),
          url: (m.permalink as string) ?? null,
          text: (m.caption as string) ?? null,
          title: ((m.caption as string) ?? "").slice(0, 80) || null,
          contentType: String(m.media_product_type === "REELS" ? "REEL" : (m.media_type ?? "")),
          mediaUrl: (m.thumbnail_url as string) ?? (m.media_url as string) ?? null,
          publishedAt: m.timestamp ? new Date(String(m.timestamp)) : null,
          reactions: (m.like_count as number) ?? null,
          comments: (m.comments_count as number) ?? null,
          unavailable: ["clicks", "linkClicks", "conversions", "impressions"],
        };
        try {
          const ins = await graphGet<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(`${m.id}/insights`, pt, { metric: insightMetrics });
          const v = (name: string) => {
            const d = ins.data.find((x) => x.name === name);
            return d ? (d.total_value?.value ?? d.values?.[0]?.value ?? null) : null;
          };
          item.reach = v("reach");
          item.saves = v("saved");
          item.shares = v("shares");
          item.videoViews = v("views");
        } catch {
          item.unavailable.push("reach", "saves", "shares", "videoViews");
        }
        organic.push(item);
      }
    }
    await ctx.log.info("Meta orgânico: publicações obtidas", { count: organic.length });
    return { organic };
  },
};
