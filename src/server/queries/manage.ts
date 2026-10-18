import type { Client, Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDays, todayInTz, type ISODate } from "@/lib/dates";
import { budgetBlockReason, type BudgetEntity } from "@/server/ads-write/guards";
import { queryPaid, type PaidResultRow } from "./paid";
import { dataUntil, type ClientContext } from "./context";

export const MANAGE_WINDOW_DAYS = 14;

export interface Perf {
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
  value: number | null;
  ctr: number | null;
  cpa: number | null;
  roas: number | null;
  frequency: number | null;
  lostBudget: number | null;
}

export interface ManagedAd {
  id: string;
  name: string;
  status: string;
  perf: Perf | null;
}

export interface ManagedGroup {
  id: string;
  name: string;
  status: string;
  dailyBudget: number | null;
  budgetBlock: string | null;
  ads: ManagedAd[];
}

export interface ManagedCampaign {
  id: string;
  externalId: string;
  name: string;
  platform: Platform;
  status: string;
  simulated: boolean;
  /** Google: só campanhas de Pesquisa aceitam RSA; Meta: anúncios de imagem + texto. */
  canCreateAds: boolean;
  dailyBudget: number | null;
  budgetBlock: string | null;
  perf: Perf | null;
  groups: ManagedGroup[];
}

type Raw = Record<string, unknown> | null;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const perfOf = (r: PaidResultRow | undefined): Perf | null =>
  r
    ? {
        cost: r.totals.cost,
        impressions: r.totals.impressions,
        clicks: r.totals.clicks,
        conversions: r.totals.conversions,
        value: r.totals.conversionValue,
        ctr: r.derived.ctr,
        cpa: r.derived.cpa,
        roas: r.derived.roas,
        frequency: r.derived.frequency,
        lostBudget: r.totals.searchLostIsBudget,
      }
    : null;

/** Janela de análise: últimos N dias até ao último dia com dados em TODAS as plataformas pagas. */
export function analysisWindow(ctx: ClientContext, days = MANAGE_WINDOW_DAYS, now = new Date()): { start: ISODate; end: ISODate } {
  const end = dataUntil(ctx, ["GOOGLE_ADS", "META_ADS"], addDays(todayInTz(ctx.client.timezone, now), -1));
  return { start: addDays(end, -(days - 1)), end };
}

export async function loadManagedCampaigns(client: Client, ctx: ClientContext): Promise<{ campaigns: ManagedCampaign[]; window: { start: ISODate; end: ISODate } }> {
  const platforms = (["GOOGLE_ADS", "META_ADS"] as const).filter((p) => ctx.has[p]);
  const window = analysisWindow(ctx);
  const q = { clientId: client.id, clientCurrency: client.currency, platforms: [...platforms], ...window };
  const [rows, byCampaign, byAd] = await Promise.all([
    prisma.campaign.findMany({
      where: { clientId: client.id, platform: { in: [...platforms] }, status: { not: "REMOVED" }, dataSource: { status: { not: "DISCONNECTED" } } },
      include: { dataSource: { select: { origin: true } }, adGroups: { orderBy: { name: "asc" }, include: { ads: { orderBy: { name: "asc" } } } } },
      orderBy: [{ platform: "asc" }, { name: "asc" }],
    }),
    platforms.length ? queryPaid({ ...q, groupBy: "campaign" }) : { rows: [] as PaidResultRow[] },
    platforms.length ? queryPaid({ ...q, groupBy: "ad" }) : { rows: [] as PaidResultRow[] },
  ]);
  const camp = new Map(byCampaign.rows.map((r) => [`${r.platform}|${r.key}`, r]));
  const ad = new Map(byAd.rows.map((r) => [`${r.platform}|${r.key}`, r]));
  const campaigns = rows.map((c): ManagedCampaign => {
    const raw = c.raw as Raw;
    const budget: BudgetEntity = { platform: c.platform, level: "CAMPAIGN", dailyBudget: num(c.dailyBudget), shared: Boolean(raw?.budgetShared), metaBudgetLevel: (raw?.budgetLevel as string) ?? null, lifetime: raw?.budgetLevel === "CAMPAIGN_LIFETIME" };
    return {
      id: c.id,
      externalId: c.externalId,
      name: c.name,
      platform: c.platform,
      status: c.status,
      simulated: c.dataSource.origin === "SIMULATED",
      canCreateAds: c.platform === "META_ADS" || !c.campaignType || /SEARCH/i.test(c.campaignType),
      dailyBudget: num(c.dailyBudget),
      budgetBlock: budgetBlockReason(budget),
      perf: perfOf(camp.get(`${c.platform}|${c.externalId}`)),
      groups: c.adGroups.map((g) => ({
        id: g.id,
        name: g.name,
        status: g.status,
        dailyBudget: num(g.dailyBudget),
        budgetBlock: budgetBlockReason({ platform: c.platform, level: "AD_GROUP", dailyBudget: num(g.dailyBudget), lifetime: Boolean((g.raw as Raw)?.lifetimeBudget) }),
        ads: g.ads.map((a) => ({ id: a.id, name: a.name ?? a.externalId, status: a.status, perf: perfOf(ad.get(`${c.platform}|${a.externalId}`)) })),
      })),
    };
  });
  return { campaigns, window };
}

export async function loadChanges(clientId: string) {
  const [pending, history] = await Promise.all([
    prisma.adChange.findMany({ where: { clientId, status: { in: ["DRAFT", "APPLYING"] } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.adChange.findMany({ where: { clientId, status: { in: ["APPLIED", "FAILED", "REVERTED", "CANCELLED"] } }, orderBy: { updatedAt: "desc" }, take: 100 }),
  ]);
  const userIds = [...new Set([...pending, ...history].flatMap((c) => [c.createdById, c.confirmedById]).filter(Boolean) as string[])];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } });
  const names = Object.fromEntries(users.map((u) => [u.id, u.name ?? u.email]));
  return { pending, history, names };
}
