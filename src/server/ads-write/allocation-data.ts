import type { Client, Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDays, dayCount, fromDate, minDate, todayInTz, type ISODate } from "@/lib/dates";
import { computePacing } from "@/server/budget/pacing";
import { queryPaid, type PaidResultRow } from "@/server/queries/paid";
import { dataUntil, type ClientContext } from "@/server/queries/context";
import { allocateBudget, type AllocEntity, type AllocResult, type GoalKind } from "./allocation";
import { budgetBlockReason, isActive } from "./guards";

export type AllocationView =
  | { ok: false; reason: string }
  | { ok: true; result: AllocResult; period: { start: ISODate; end: ISODate; amount: number; spent: number; daysLeft: number; source: "BUDGET" | "CLIENT" }; asOf: ISODate };

type Raw = Record<string, unknown> | null;
const PAID: Platform[] = ["GOOGLE_ADS", "META_ADS"];

function monthBounds(today: ISODate): { start: ISODate; end: ISODate } {
  const [y, m] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { start: `${today.slice(0, 7)}-01`, end: `${today.slice(0, 7)}-${String(last).padStart(2, "0")}` };
}

/** Constrói a proposta de distribuição a partir do orçamento total do mês e do objetivo do cliente. */
export async function loadAllocation(client: Client, ctx: ClientContext, now = new Date()): Promise<AllocationView> {
  const today = todayInTz(client.timezone, now);
  const platforms = PAID.filter((p) => ctx.has[p]);
  if (!platforms.length) return { ok: false, reason: "Sem contas de anúncios ligadas." };
  const budget = await prisma.budget.findFirst({ where: { clientId: client.id, platform: null, campaignId: null, periodStart: { lte: new Date(`${today}T00:00:00Z`) }, periodEnd: { gte: new Date(`${today}T00:00:00Z`) } }, orderBy: { periodStart: "desc" } });
  const period = budget ? { start: fromDate(budget.periodStart), end: fromDate(budget.periodEnd), amount: Number(budget.amount), source: "BUDGET" as const } : client.monthlyBudget ? { ...monthBounds(today), amount: Number(client.monthlyBudget), source: "CLIENT" as const } : null;
  if (!period) return { ok: false, reason: "Defina o orçamento total do mês (Orçamento → novo orçamento “Total”, ou o orçamento mensal nas definições do cliente)." };

  // Campaign.dailyBudget está na moeda da conta de anúncios; a distribuição soma-o como moeda do cliente.
  const foreign = ctx.sources.filter((s) => PAID.includes(s.platform) && s.currency !== client.currency);
  if (foreign.length) return { ok: false, reason: `Conta(s) de anúncios noutra moeda (${[...new Set(foreign.map((s) => s.currency))].join(", ")}): a distribuição exige a mesma moeda do cliente (${client.currency}).` };

  const asOf = dataUntil(ctx, platforms, addDays(today, -1));
  const base = { clientId: client.id, clientCurrency: client.currency, platforms };
  const w30 = { start: addDays(asOf, -29), end: asOf };
  const w14 = { start: addDays(asOf, -13), end: asOf };
  const [daily, c30, c14, g30, g14, goals, campaigns] = await Promise.all([
    queryPaid({ ...base, start: period.start, end: minDate(period.end, asOf), groupBy: "day" }),
    queryPaid({ ...base, ...w30, groupBy: "campaign" }),
    queryPaid({ ...base, ...w14, groupBy: "campaign" }),
    queryPaid({ ...base, ...w30, groupBy: "adGroup" }),
    queryPaid({ ...base, ...w14, groupBy: "adGroup" }),
    prisma.goal.findMany({ where: { clientId: client.id, platform: null, periodStart: { lte: new Date(`${today}T00:00:00Z`) }, periodEnd: { gte: new Date(`${today}T00:00:00Z`) } } }),
    prisma.campaign.findMany({ where: { clientId: client.id, platform: { in: platforms }, dataSource: { status: { not: "DISCONNECTED" } } }, include: { adGroups: true } }),
  ]);
  const warnings = [...new Set([...daily.warnings, ...c30.warnings, ...c14.warnings])];
  if (warnings.length) return { ok: false, reason: warnings.join(" · ") };
  const pacing = computePacing({ amount: period.amount, periodStart: period.start, periodEnd: period.end, asOf, daily: daily.rows.map((r) => ({ date: r.key, cost: r.totals.cost })) });
  // Dias por gastar contados a partir do dia seguinte aos dados (o gasto só é conhecido até asOf).
  const daysLeft = Math.max(1, dayCount(addDays(asOf, 1), period.end));

  const roasGoal = goals.find((g) => g.metric === "ROAS_MIN");
  const cpaGoal = goals.find((g) => g.metric === "CPA_MAX" || g.metric === "CPL_MAX");
  const totalValue = c30.rows.reduce((s, r) => s + (r.totals.conversionValue ?? 0), 0);
  const kind: GoalKind = roasGoal ? "ROAS" : cpaGoal ? "CPA" : totalValue > 0 ? "ROAS" : "CPA";
  const goalTarget = kind === "ROAS" ? (roasGoal ? Number(roasGoal.target) : null) : cpaGoal ? Number(cpaGoal.target) : null;

  const index = (rows: PaidResultRow[]) => new Map(rows.map((r) => [`${r.platform}|${r.key}`, r]));
  const [m30, m14, a30, a14] = [index(c30.rows), index(c14.rows), index(g30.rows), index(g14.rows)];
  const metrics = (r30: PaidResultRow | undefined, r14: PaidResultRow | undefined) => ({
    cost30: r30?.totals.cost ?? 0,
    conversions30: r30?.totals.conversions ?? 0,
    value30: r30?.totals.conversionValue ?? 0,
    cost14: r14?.totals.cost ?? 0,
    conversions14: r14?.totals.conversions ?? 0,
    value14: r14?.totals.conversionValue ?? 0,
    lostBudget: r14?.totals.searchLostIsBudget ?? null,
    frequency: r14?.derived.frequency ?? null,
  });

  const entities: AllocEntity[] = [];
  for (const c of campaigns.filter((x) => isActive(x.status))) {
    const raw = c.raw as Raw;
    const budgetEntity = { platform: c.platform, level: "CAMPAIGN" as const, dailyBudget: c.dailyBudget === null ? null : Number(c.dailyBudget), shared: Boolean(raw?.budgetShared), metaBudgetLevel: (raw?.budgetLevel as string) ?? null, lifetime: raw?.budgetLevel === "CAMPAIGN_LIFETIME" };
    const block = budgetBlockReason(budgetEntity);
    const key = `${c.platform}|${c.externalId}`;
    if (!block) {
      entities.push({ key: `C:${c.id}`, level: "CAMPAIGN", entityId: c.id, name: c.name, platform: c.platform, dailyBudget: budgetEntity.dailyBudget!, adjustable: true, ...metrics(m30.get(key), m14.get(key)) });
      continue;
    }
    const adsets = c.platform === "META_ADS" && budgetEntity.metaBudgetLevel === "ADSET" ? c.adGroups.filter((g) => isActive(g.status) && g.dailyBudget !== null && Number(g.dailyBudget) > 0) : [];
    for (const g of adsets) {
      const gk = `${c.platform}|${g.externalId}`;
      const gb = budgetBlockReason({ platform: c.platform, level: "AD_GROUP", dailyBudget: Number(g.dailyBudget), lifetime: Boolean((g.raw as Raw)?.lifetimeBudget) });
      entities.push({ key: `G:${g.id}`, level: "AD_GROUP", entityId: g.id, name: `${c.name} › ${g.name}`, platform: c.platform, dailyBudget: Number(g.dailyBudget), adjustable: !gb, blockReason: gb, ...metrics(a30.get(gk), a14.get(gk)) });
    }
    if (!adsets.length && budgetEntity.dailyBudget) entities.push({ key: `C:${c.id}`, level: "CAMPAIGN", entityId: c.id, name: c.name, platform: c.platform, dailyBudget: budgetEntity.dailyBudget, adjustable: false, blockReason: block, ...metrics(m30.get(key), m14.get(key)) });
  }
  if (!entities.length) return { ok: false, reason: "Nenhuma campanha ativa com orçamento diário." };

  const result = allocateBudget({ monthlyTotal: period.amount, spentToDate: pacing.spent, daysLeft, goal: { kind, target: goalTarget }, maxStepPct: Number(client.maxBudgetStepPct), entities });
  return { ok: true, result, period: { ...period, spent: pacing.spent, daysLeft }, asOf };
}
