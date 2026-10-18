import type { OrganicContent } from "@prisma/client";
import type { EntityRow } from "@/server/queries/ads";

export const TOP_N = 10;
/** Abaixo disto, CTR e CPA de um anúncio não são representativos. */
export const MIN_AD_IMPRESSIONS = 100;

export interface TopAd {
  rank: number;
  name: string;
  platform: "GOOGLE_ADS" | "META_ADS";
  campaign: string | null;
  headline: string | null;
  impressions: number;
  clicks: number;
  ctr: number | null;
  conversions: number | null;
  cpa: number | null;
  cost: number;
  roas: number | null;
}

export interface TopPost {
  rank: number;
  title: string;
  platform: string;
  type: string | null;
  publishedAt: string | null;
  url: string | null;
  impressions: number | null;
  reach: number | null;
  engagements: number;
  engagementRate: number | null;
  linkClicks: number | null;
}

export interface TopPage {
  rank: number;
  url: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  clicksDeltaPct: number | null;
}

export interface TopContent {
  ads: TopAd[];
  posts: TopPost[];
  pages: TopPage[];
  criteria: { ads: string; posts: string; pages: string };
}

type Creative = { primaryText: string | null; title: string | null } | null | undefined;

export function rankAds(ads: EntityRow[], creative: (id: string) => Creative): TopAd[] {
  return ads
    .filter((a) => a.impressions >= MIN_AD_IMPRESSIONS && (a.platform === "GOOGLE_ADS" || a.platform === "META_ADS"))
    .sort((a, b) => (b.conversions ?? 0) - (a.conversions ?? 0) || b.clicks - a.clicks || (b.ctr ?? 0) - (a.ctr ?? 0))
    .slice(0, TOP_N)
    .map((a, i) => {
      const c = creative(a.id);
      return {
        rank: i + 1,
        name: a.name,
        platform: a.platform as TopAd["platform"],
        campaign: a.campaignName ?? null,
        headline: c?.title ?? c?.primaryText?.slice(0, 140) ?? null,
        impressions: a.impressions,
        clicks: a.clicks,
        ctr: a.ctr,
        conversions: a.conversions,
        cpa: a.cpa,
        cost: a.cost,
        roas: a.roas,
      };
    });
}

export const engagementsOf = (o: Pick<OrganicContent, "reactions" | "comments" | "shares" | "saves" | "linkClicks">) =>
  (o.reactions ?? 0) + (o.comments ?? 0) + (o.shares ?? 0) + (o.saves ?? 0) + (o.linkClicks ?? 0);

export function rankPosts(posts: OrganicContent[]): TopPost[] {
  return posts
    .map((o) => ({ o, eng: engagementsOf(o) }))
    .filter((x) => x.eng > 0)
    .sort((a, b) => b.eng - a.eng || (b.o.impressions ?? 0) - (a.o.impressions ?? 0))
    .slice(0, TOP_N)
    .map(({ o, eng }, i) => ({
      rank: i + 1,
      title: o.title || o.text?.slice(0, 120) || "(sem título)",
      platform: o.platform,
      type: o.contentType,
      publishedAt: o.publishedAt ? o.publishedAt.toISOString().slice(0, 10) : null,
      url: o.url,
      impressions: o.impressions,
      reach: o.reach,
      engagements: eng,
      engagementRate: o.impressions ? eng / o.impressions : null,
      linkClicks: o.linkClicks,
    }));
}

export function rankPages(pages: { key: string; clicks: number; impressions: number; ctr: number | null; position: number | null; clicksDeltaPct: number | null }[]): TopPage[] {
  return [...pages]
    .filter((p) => p.clicks > 0)
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, TOP_N)
    .map((p, i) => ({ rank: i + 1, url: p.key, clicks: p.clicks, impressions: p.impressions, ctr: p.ctr, position: p.position, clicksDeltaPct: p.clicksDeltaPct }));
}

export const TOP_CRITERIA: TopContent["criteria"] = {
  ads: `Ordenados por conversões, depois cliques e CTR. Só anúncios com pelo menos ${MIN_AD_IMPRESSIONS} impressões no período.`,
  posts: "Publicações orgânicas do período ordenadas por interações (reações + comentários + partilhas + guardados + cliques em links).",
  pages: "Páginas ordenadas por cliques orgânicos no Search Console.",
};
