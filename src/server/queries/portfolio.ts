import type { Client, Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDays, toDate, todayInTz } from "@/lib/dates";
import { delta, type Delta } from "@/server/metrics/calc";
import { loadClientContext, type DataOriginLabel } from "./context";
import { loadBudgets } from "./budget";
import { paidTotals } from "./paid";
import { searchTotals } from "./seo";
import { webTotals } from "./web";

export interface PortfolioRow {
  client: Client;
  origin: DataOriginLabel;
  lastSync: Date | null;
  sourceErrors: number;
  period: { start: string; end: string };
  cost: Delta;
  conversions: Delta;
  conversionValue: Delta;
  roas: Delta;
  cpa: Delta;
  organicClicks: Delta;
  sessions: Delta;
  openAlerts: number;
  criticalAlerts: number;
  newRecommendations: number;
  budget: { amount: number; spent: number; projection: number; status: string } | null;
  hasPaid: boolean;
}

/** Últimos 30 dias completos (até ontem no fuso do cliente) vs 30 dias anteriores. */
export async function loadPortfolio(clients: Client[]): Promise<PortfolioRow[]> {
  return Promise.all(
    clients.map(async (client) => {
      const ctx = await loadClientContext(client);
      const today = todayInTz(client.timezone);
      const end = addDays(today, -1);
      const start = addDays(end, -29);
      const pEnd = addDays(start, -1);
      const pStart = addDays(pEnd, -29);
      const platforms = (["GOOGLE_ADS", "META_ADS"] as Platform[]).filter((p) => ctx.has[p]);
      const base = { clientId: client.id, clientCurrency: client.currency, platforms };
      const [pc, pp, sc, sp, wc, wp, openAlerts, criticalAlerts, newRecommendations, budgets] = await Promise.all([
        platforms.length ? paidTotals({ ...base, start, end }) : null,
        platforms.length ? paidTotals({ ...base, start: pStart, end: pEnd }) : null,
        ctx.has.SEARCH_CONSOLE ? searchTotals(client.id, start, end) : null,
        ctx.has.SEARCH_CONSOLE ? searchTotals(client.id, pStart, pEnd) : null,
        ctx.has.GA4 ? webTotals(client.id, start, end) : null,
        ctx.has.GA4 ? webTotals(client.id, pStart, pEnd) : null,
        prisma.alert.count({ where: { clientId: client.id, status: "OPEN" } }),
        prisma.alert.count({ where: { clientId: client.id, status: "OPEN", severity: "CRITICAL" } }),
        prisma.recommendation.count({ where: { clientId: client.id, status: "NEW" } }),
        // Só o orçamento total em vigor hoje (evita uma consulta por cada orçamento histórico).
        loadBudgets(ctx, undefined, { platform: null, campaignId: null, periodStart: { lte: toDate(today) }, periodEnd: { gte: toDate(today) } }),
      ]);
      const current = budgets.budgets[0];
      return {
        client,
        origin: ctx.origin,
        lastSync: ctx.lastSync,
        sourceErrors: ctx.sources.filter((s) => s.status === "ERROR" || s.lastError).length,
        period: { start, end },
        // Período sem dados → null ("Não disponível"), nunca 0.
        cost: delta(pc?.hasData ? pc.totals.cost : null, pp?.hasData ? pp.totals.cost : null),
        conversions: delta(pc?.hasData ? pc.totals.conversions : null, pp?.hasData ? pp.totals.conversions : null),
        conversionValue: delta(pc?.hasData ? pc.totals.conversionValue : null, pp?.hasData ? pp.totals.conversionValue : null),
        roas: delta(pc?.hasData ? pc.derived.roas : null, pp?.hasData ? pp.derived.roas : null),
        cpa: delta(pc?.hasData ? pc.derived.cpa : null, pp?.hasData ? pp.derived.cpa : null),
        organicClicks: delta(sc?.hasData ? sc.clicks : null, sp?.hasData ? sp.clicks : null),
        sessions: delta(wc?.hasData ? wc.sessions : null, wp?.hasData ? wp.sessions : null),
        openAlerts,
        criticalAlerts,
        newRecommendations,
        budget: current ? { amount: current.pacing.amount, spent: current.pacing.spent, projection: current.pacing.projection, status: current.pacing.status } : null,
        hasPaid: platforms.length > 0,
      };
    }),
  );
}

/** Totais por moeda: valores monetários de moedas diferentes nunca são somados. */
export function totalsByCurrency(rows: PortfolioRow[]) {
  const map = new Map<string, { currency: string; clients: number; cost: number; costPrev: number; value: number; valuePrev: number; conversions: number; conversionsPrev: number }>();
  for (const r of rows) {
    if (!r.hasPaid) continue;
    const t = map.get(r.client.currency) ?? { currency: r.client.currency, clients: 0, cost: 0, costPrev: 0, value: 0, valuePrev: 0, conversions: 0, conversionsPrev: 0 };
    t.clients++;
    t.cost += r.cost.current ?? 0;
    t.costPrev += r.cost.previous ?? 0;
    t.value += r.conversionValue.current ?? 0;
    t.valuePrev += r.conversionValue.previous ?? 0;
    t.conversions += r.conversions.current ?? 0;
    t.conversionsPrev += r.conversions.previous ?? 0;
    map.set(r.client.currency, t);
  }
  return [...map.values()];
}
