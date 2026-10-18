import type { Platform, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDays, fromDate, todayInTz, type ISODate } from "@/lib/dates";
import { computePacing } from "@/server/budget/pacing";
import { dataUntil, type ClientContext } from "./context";
import { queryPaid } from "./paid";

/** `where` restringe os orçamentos carregados (cada orçamento custa uma consulta de métricas). */
export async function loadBudgets(ctx: ClientContext, refDate?: ISODate, where?: Prisma.BudgetWhereInput) {
  const { client } = ctx;
  const today = refDate ?? todayInTz(client.timezone);
  const yesterday = addDays(today, -1);
  const budgets = await prisma.budget.findMany({
    where: { ...where, clientId: client.id },
    include: { campaign: { select: { name: true, externalId: true, platform: true } } },
    orderBy: [{ periodStart: "desc" }, { platform: "asc" }],
  });
  const asOf = dataUntil(ctx, ["GOOGLE_ADS", "META_ADS"], yesterday);

  const result = [];
  for (const b of budgets) {
    const start = fromDate(b.periodStart);
    const end = fromDate(b.periodEnd);
    const platforms: Platform[] = b.campaign ? [b.campaign.platform] : b.platform ? [b.platform] : ["GOOGLE_ADS", "META_ADS"];
    const daily = await queryPaid({
      clientId: client.id,
      clientCurrency: client.currency,
      platforms,
      start,
      end,
      groupBy: "day",
      campaignIds: b.campaign ? [b.campaign.externalId] : null,
    });
    const pacing = computePacing({
      amount: Number(b.amount),
      periodStart: start,
      periodEnd: end,
      asOf,
      daily: daily.rows.map((r) => ({ date: r.key, cost: r.totals.cost })),
    });
    result.push({
      id: b.id,
      scope: b.campaign ? `Campanha: ${b.campaign.name}` : b.platform ? (b.platform === "GOOGLE_ADS" ? "Google Ads" : "Meta Ads") : "Total",
      platform: b.platform,
      campaignId: b.campaignId,
      periodStart: start,
      periodEnd: end,
      currency: b.currency,
      notes: b.notes,
      pacing,
      daily: daily.rows.map((r) => ({ date: r.key, cost: r.totals.cost })),
    });
  }
  return { asOf, budgets: result };
}

export async function loadCampaignDailyBudgetUsage(ctx: ClientContext, start: ISODate, end: ISODate) {
  const campaigns = await prisma.campaign.findMany({ where: { clientId: ctx.client.id, dailyBudget: { not: null } } });
  const res = await queryPaid({
    clientId: ctx.client.id,
    clientCurrency: ctx.client.currency,
    platforms: ["GOOGLE_ADS", "META_ADS"],
    start,
    end,
    groupBy: "campaign",
  });
  const days = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1);
  return campaigns.map((c) => {
    const row = res.rows.find((r) => r.key === c.externalId);
    const spent = row?.totals.cost ?? 0;
    const cap = Number(c.dailyBudget) * days;
    return {
      id: c.externalId,
      name: c.name,
      platform: c.platform,
      dailyBudget: Number(c.dailyBudget),
      spent,
      utilization: cap > 0 ? spent / cap : null,
      roas: row?.derived.roas ?? null,
      cpa: row?.derived.cpa ?? null,
      lostIsBudget: row?.totals.searchLostIsBudget ?? null,
    };
  });
}
