import type { Client, Organization } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dayCount, fromDate, toDate, type ISODate } from "@/lib/dates";
import { formatDelta, formatValue, type FormatContext } from "@/lib/format";
import { delta } from "@/server/metrics/calc";
import { METRICS } from "@/server/metrics/definitions";
import { loadClientContext, type DataOriginLabel } from "@/server/queries/context";
import { loadDashboard, type Kpi } from "@/server/queries/dashboard";
import { loadPlatformAnalytics, type EntityRow } from "@/server/queries/ads";
import { searchByKey, searchTotals } from "@/server/queries/seo";
import { loadBudgets } from "@/server/queries/budget";
import { paidTotals } from "@/server/queries/paid";
import { webTotals } from "@/server/queries/web";
import type { Filters } from "@/server/queries/filters";
import type { SectionKey } from "./sections";
import { platformMetrics, type PlatformMetrics } from "./platform-metrics";
import { engagementsOf, rankAds, rankPages, rankPosts, TOP_CRITERIA, type TopContent } from "./top-content";

export interface ReportData {
  version: 1;
  generatedAt: string;
  agency: { name: string; brandColor: string; logoUrl: string | null };
  client: { name: string; logoUrl: string | null; website: string | null; industry: string | null; objectives: string | null };
  fmt: FormatContext;
  period: { start: ISODate; end: ISODate };
  compare: { start: ISODate; end: ISODate } | null;
  origin: DataOriginLabel;
  sections: SectionKey[];
  comments: Record<string, string>;
  executiveSummary: string[];
  kpis: { paid: Kpi[]; seo: Kpi[]; web: Kpi[] };
  goals: { label: string; unit: string; target: number; actual: number | null; achieved: boolean | null; lowerIsBetter: boolean }[];
  channels: { key: string; label: string; cost: number | null; clicks: number | null; impressions: number | null; conversions: number | null; value: number | null; cpa: number | null; roas: number | null; conversionsDeltaPct: number | null; costDeltaPct: number | null; note: string }[];
  spendSeries: { date: string; cost: number; conversions: number; value: number }[];
  organicSeries: { date: string; clicks: number; impressions: number }[];
  /** Ausente em relatórios gerados antes da secção de métricas completas. */
  platformMetrics?: PlatformMetrics[];
  topCampaigns: EntityRow[];
  bottomCampaigns: EntityRow[];
  topAds: (EntityRow & { creative?: { primaryText: string | null; title: string | null; format: string | null } | null })[];
  bottomAds: EntityRow[];
  movers: { name: string; platform: string; conversionsDelta: number | null; costDelta: number | null }[];
  seo: { topQueries: Row[]; rising: Row[]; declining: Row[]; topPages: Row[] } | null;
  /** Ausente em relatórios gerados antes da secção Top 10. */
  topContent?: TopContent;
  organicContent: { title: string | null; platform: string; type: string | null; impressions: number | null; engagements: number | null; engagementRate: number | null }[];
  budgets: { scope: string; amount: number; spent: number; projection: number; status: string; pctConsumed: number | null }[];
  opportunities: Rec[];
  problems: Rec[];
  recommendations: Rec[];
  actionPlan: Rec[];
  methodology: { label: string; formula: string | null; source: string; limitation: string | null }[];
  limitations: string[];
}

type Row = { key: string; clicks: number; impressions: number; ctr: number | null; position: number | null; clicksDeltaPct: number | null };
type Rec = { title: string; explanation: string; action: string; priority: number; confidence: string; source: string; status: string };

/**
 * Período do último relatório que terminou antes deste. O primeiro relatório,
 * e um relatório sem nenhum anterior, não tem comparação.
 * Com `currentEnd`, só relatórios de duração semelhante (±15%: janeiro vs fevereiro
 * conta, semanal vs mensal não) servem de comparação.
 */
export function comparisonWindow(currentStart: string, reports: { id: string; start: string; end: string; generatedAt: number }[], excludeId?: string, currentEnd?: string): { start: ISODate; end: ISODate } | null {
  const len = currentEnd ? dayCount(currentStart, currentEnd) : null;
  const similar = (r: { start: string; end: string }) => len === null || Math.abs(dayCount(r.start, r.end) - len) <= Math.max(len, dayCount(r.start, r.end)) * 0.15;
  const best = reports
    .filter((r) => r.id !== excludeId && r.end < currentStart && similar(r))
    .sort((a, b) => (a.end === b.end ? b.generatedAt - a.generatedAt : a.end < b.end ? 1 : -1))[0];
  return best ? { start: best.start, end: best.end } : null;
}

const OPPORTUNITY_TYPES = ["SCALE_BUDGET", "QUERY_NEAR_TOP", "QUERY_LOW_CTR", "BUDGET_REALLOCATION", "CHANNEL_EFFICIENCY"];
const PROBLEM_TYPES = ["CPA_INCREASE", "LOW_CTR_AD", "CREATIVE_FATIGUE", "PAGE_TRAFFIC_DECLINE", "BUDGET_OVERRUN", "LANDING_LOW_CONVERSION"];

export async function buildReportData(org: Organization, client: Client, period: { start: ISODate; end: ISODate }, sections: SectionKey[], comments: Record<string, string> = {}, excludeReportId?: string): Promise<ReportData> {
  const ctx = await loadClientContext(client);
  const p = { preset: "custom" as const, ...period };
  const earlier = await prisma.report.findMany({ where: { clientId: client.id, status: "GENERATED" }, select: { id: true, periodStart: true, periodEnd: true, generatedAt: true } });
  const compare = comparisonWindow(
    period.start,
    earlier.map((r) => ({ id: r.id, start: fromDate(r.periodStart), end: fromDate(r.periodEnd), generatedAt: r.generatedAt?.getTime() ?? 0 })),
    excludeReportId,
    period.end,
  );
  const filters: Filters = { period: p, compare, compareMode: compare ? "previous" : "none", channel: "all", campaign: null, device: null, country: null };
  const fmt = ctx.fmt;
  const [dash, google, meta, budgets, recs, organic] = await Promise.all([
    loadDashboard(ctx, filters),
    ctx.has.GOOGLE_ADS ? loadPlatformAnalytics(ctx, filters, ["GOOGLE_ADS"]) : null,
    ctx.has.META_ADS ? loadPlatformAnalytics(ctx, filters, ["META_ADS"]) : null,
    loadBudgets(ctx, undefined, { periodStart: { lte: toDate(period.end) }, periodEnd: { gte: toDate(period.start) } }),
    prisma.recommendation.findMany({ where: { clientId: client.id, status: { in: ["NEW", "IN_REVIEW", "APPROVED"] } }, orderBy: [{ priority: "asc" }, { detectedAt: "desc" }], take: 30 }),
    prisma.organicContent.findMany({ where: { clientId: client.id, publishedAt: { gte: new Date(`${period.start}T00:00:00Z`), lte: new Date(`${period.end}T23:59:59Z`) } }, orderBy: { publishedAt: "desc" }, take: 2000 }),
  ]);

  const campaigns = [...(google?.campaigns ?? []), ...(meta?.campaigns ?? [])].filter((c) => c.cost > 0);
  const ads = [...(google?.ads ?? []), ...(meta?.ads ?? [])].filter((a) => a.impressions > 0);
  const score = (r: EntityRow) => (r.roas !== null && r.roas > 0 ? r.roas : r.cpa !== null ? 1 / r.cpa : 0);
  const byScore = [...campaigns].filter((c) => (c.conversions ?? 0) > 0 || c.cost > 50).sort((a, b) => score(b) - score(a));
  const adInfo = { ...(google?.adInfo ?? {}), ...(meta?.adInfo ?? {}) };

  const movers = campaigns
    .map((c) => ({
      name: c.name,
      platform: c.platform === "GOOGLE_ADS" ? "Google Ads" : "Meta Ads",
      conversionsDelta: c.conversionsDeltaAbs,
      costDelta: c.costDeltaAbs,
    }))
    .sort((a, b) => Math.abs(b.conversionsDelta ?? 0) - Math.abs(a.conversionsDelta ?? 0))
    .slice(0, 5);

  // SEO
  let seo: ReportData["seo"] = null;
  let pageRows: Row[] = [];
  if (ctx.has.SEARCH_CONSOLE) {
    const [qs, pages] = await Promise.all([searchByKey(client.id, "QUERY", period, compare, 500), searchByKey(client.id, "PAGE", period, compare, 200)]);
    const row = (r: (typeof qs)[number]): Row => ({ key: r.key, clicks: r.current.clicks, impressions: r.current.impressions, ctr: r.current.ctr, position: r.current.position, clicksDeltaPct: delta(r.current.clicks, r.previous.clicks).pct });
    const withPrev = qs.filter((q) => q.previous.clicks >= 10);
    pageRows = pages.map(row);
    seo = {
      topQueries: qs.slice(0, 10).map(row),
      rising: [...withPrev].sort((a, b) => b.current.clicks - b.previous.clicks - (a.current.clicks - a.previous.clicks)).slice(0, 5).map(row),
      declining: [...withPrev].sort((a, b) => a.current.clicks - a.previous.clicks - (b.current.clicks - b.previous.clicks)).slice(0, 5).filter((r) => r.current.clicks < r.previous.clicks).map(row),
      topPages: pageRows.slice(0, 10),
    };
  }

  // Objetivos
  const goalsDb = await prisma.goal.findMany({ where: { clientId: client.id, periodStart: { lte: new Date(`${period.end}T00:00:00Z`) }, periodEnd: { gte: new Date(`${period.start}T00:00:00Z`) } } });
  const paidAll = await paidTotals({ clientId: client.id, clientCurrency: client.currency, platforms: (["GOOGLE_ADS", "META_ADS"] as const).filter((x) => ctx.has[x]), start: period.start, end: period.end });
  const sTot = ctx.has.SEARCH_CONSOLE ? await searchTotals(client.id, period.start, period.end) : null;
  const wTot = ctx.has.GA4 ? await webTotals(client.id, period.start, period.end) : null;
  const goals = goalsDb.map((g) => {
    const target = Number(g.target);
    const map: Record<string, { label: string; unit: string; actual: number | null; lower: boolean }> = {
      LEADS: { label: "Leads", unit: "number", actual: paidAll.totals.leads, lower: false },
      CONVERSIONS: { label: "Conversões", unit: "number", actual: paidAll.totals.conversions, lower: false },
      REVENUE: { label: "Receita atribuída", unit: "currency", actual: paidAll.totals.conversionValue, lower: false },
      CPA_MAX: { label: "CPA máximo", unit: "currency", actual: paidAll.derived.cpa, lower: true },
      CPL_MAX: { label: "Custo por lead máximo", unit: "currency", actual: paidAll.derived.cpl, lower: true },
      ROAS_MIN: { label: "ROAS mínimo", unit: "multiplier", actual: paidAll.derived.roas, lower: false },
      CTR_MIN: { label: "CTR mínimo", unit: "percent", actual: paidAll.derived.ctr, lower: false },
      SESSIONS: { label: "Sessões no website", unit: "number", actual: wTot?.sessions ?? null, lower: false },
      ORGANIC_CLICKS: { label: "Cliques orgânicos", unit: "number", actual: sTot?.clicks ?? null, lower: false },
      AVG_POSITION_MAX: { label: "Posição média máxima", unit: "position", actual: sTot?.position ?? null, lower: true },
    };
    const m = map[g.metric];
    const achieved = m.actual === null ? null : m.lower ? m.actual <= target : m.actual >= target;
    return { label: m.label, unit: m.unit, target, actual: m.actual, achieved, lowerIsBetter: m.lower };
  });

  const ch = (key: string, label: string, a: Awaited<ReturnType<typeof loadPlatformAnalytics>> | null, note: string) =>
    a
      ? {
          key,
          label,
          cost: a.totals.totals.cost,
          clicks: a.totals.totals.clicks,
          impressions: a.totals.totals.impressions,
          conversions: a.totals.totals.conversions,
          value: a.totals.totals.conversionValue,
          cpa: a.totals.derived.cpa,
          roas: a.totals.derived.roas,
          conversionsDeltaPct: delta(a.totals.totals.conversions, a.previous?.totals.conversions ?? null).pct,
          costDeltaPct: delta(a.totals.totals.cost, a.previous?.totals.cost ?? null).pct,
          note,
        }
      : null;
  const channels = [
    ch("google", "Google Ads", google, "Atribuição Google Ads (modelo configurado na conta)"),
    ch("meta", "Meta Ads", meta, "Atribuição Meta (janela por omissão 7 dias clique / 1 dia visualização)"),
    sTot
      ? { key: "seo", label: "SEO (Search Console)", cost: null, clicks: sTot.clicks, impressions: sTot.impressions, conversions: null, value: null, cpa: null, roas: null, conversionsDeltaPct: null, costDeltaPct: null, note: "Tráfego orgânico; conversões orgânicas no GA4 (canal Organic Search)" }
      : null,
  ].filter(Boolean) as ReportData["channels"];

  const toRec = (r: (typeof recs)[number]): Rec => ({ title: r.title, explanation: r.explanation, action: r.suggestedAction, priority: r.priority, confidence: r.confidence, source: r.source, status: r.status });
  const limitations = [
    ...dash.warnings,
    ...(dash.completeness ? [`Dados incompletos no fim do período — ${dash.completeness}`] : []),
    "Conversões e receitas são as reportadas por cada plataforma, com modelos de atribuição diferentes; não devem ser somadas como vendas reais únicas.",
    "O alcance (Meta) e os utilizadores (GA4) não são aditivos entre dias; quando apresentados para períodos, são aproximações.",
    ...(ctx.has.SEARCH_CONSOLE ? ["O Search Console anonimiza consultas raras e tem 2–3 dias de atraso; a soma por consulta é inferior ao total."] : ["Search Console não ligado: sem dados de pesquisa orgânica."]),
    ...(ctx.has.GA4 ? [] : ["GA4 não ligado: sem dados de comportamento no website."]),
    ...(client.grossMargin === null ? ["ROI não calculado: margem bruta do cliente não definida."] : []),
    ...(ctx.origin === "SIMULATED" || ctx.origin === "MIXED" ? ["ATENÇÃO: este relatório contém DADOS SIMULADOS (modo de demonstração)."] : []),
  ];

  const pm = [google && platformMetrics("GOOGLE_ADS", google), meta && platformMetrics("META_ADS", meta)].filter((x): x is PlatformMetrics => Boolean(x));
  const usedMetrics = [
    ...new Set([
      ...["cost", "impressions", "clicks", "ctr", "cpc", "cpm", "conversions", "conversionRate", "cpa", "cpl", "conversionValue", "roas", "roi", "reach", "frequency"],
      ...pm.flatMap((p) => p.groups.flatMap((g) => g.rows.map((r) => r.key))),
      ...["organicClicks", "organicCtr", "position", "sessions", "users"],
    ]),
  ];
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    agency: { name: org.name, brandColor: org.brandColor, logoUrl: org.logoUrl },
    client: { name: client.name, logoUrl: client.logoUrl, website: client.website, industry: client.industry, objectives: client.objectives },
    fmt,
    period,
    compare,
    origin: ctx.origin,
    sections,
    comments,
    executiveSummary: summarize(fmt, dash.paidKpis, dash.seoKpis, campaigns, movers, goals),
    kpis: { paid: dash.paidKpis, seo: dash.seoKpis, web: dash.webKpis },
    goals,
    channels,
    spendSeries: dash.spendSeries,
    organicSeries: dash.organicSeries,
    platformMetrics: pm,
    topCampaigns: byScore.slice(0, 5),
    bottomCampaigns: [...byScore].reverse().slice(0, 5),
    topAds: [...ads].sort((a, b) => (b.conversions ?? 0) - (a.conversions ?? 0) || b.clicks - a.clicks).slice(0, 8).map((a) => ({ ...a, creative: adInfo[a.id]?.creative ? { primaryText: adInfo[a.id]!.creative!.primaryText, title: adInfo[a.id]!.creative!.title, format: adInfo[a.id]!.creative!.format } : null })),
    bottomAds: ads.filter((a) => a.cost > 30).sort((a, b) => (b.cpa ?? b.cost * 10) - (a.cpa ?? a.cost * 10)).slice(0, 5),
    movers,
    seo,
    topContent: { ads: rankAds(ads, (id) => adInfo[id]?.creative), posts: rankPosts(organic), pages: rankPages(pageRows), criteria: TOP_CRITERIA },
    organicContent: organic
      .map((o) => {
        const eng = engagementsOf(o);
        return { title: o.title, platform: o.platform, type: o.contentType, impressions: o.impressions, engagements: eng, engagementRate: o.impressions ? eng / o.impressions : null };
      })
      .sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0))
      .slice(0, 8),
    budgets: budgets.budgets.map((b) => ({ scope: b.scope, amount: b.pacing.amount, spent: b.pacing.spent, projection: b.pacing.projection, status: b.pacing.status, pctConsumed: b.pacing.pctConsumed })),
    opportunities: recs.filter((r) => OPPORTUNITY_TYPES.includes(r.type)).map(toRec),
    problems: recs.filter((r) => PROBLEM_TYPES.includes(r.type)).map(toRec),
    recommendations: recs.slice(0, 12).map(toRec),
    actionPlan: recs.filter((r) => r.priority === 1 || r.status === "APPROVED").slice(0, 6).map(toRec),
    methodology: usedMetrics.map((k) => METRICS[k]).filter(Boolean).map((m) => ({ label: m.label, formula: m.formula ?? null, source: m.sources.join(" · "), limitation: m.limitations ?? null })),
    limitations,
  };
}

/** Resumo executivo determinístico a partir dos números (sem IA, sem afirmações causais). */
export function summarize(fmt: FormatContext, paid: Kpi[], seo: Kpi[], campaigns: EntityRow[], movers: ReportData["movers"], goals: ReportData["goals"]): string[] {
  const k = (key: string) => paid.find((x) => x.key === key) ?? seo.find((x) => x.key === key);
  const v = (key: string, unit?: Parameters<typeof formatValue>[1]) => {
    const x = k(key);
    return x ? formatValue(x.delta.current, unit ?? x.unit, fmt) : null;
  };
  const d = (key: string) => {
    const x = k(key);
    if (!x || x.delta.pct === null) return "";
    return ` (${formatDelta(x.delta.pct, fmt)} vs. o último relatório)`;
  };
  const out: string[] = [];
  if (k("cost")) out.push(`Investimento publicitário de ${v("cost")}${d("cost")}, com ${v("conversions")} conversões${d("conversions")} e custo por conversão de ${v("cpa")}${d("cpa")}.`);
  if (k("roas") && k("roas")!.delta.current !== null) out.push(`Receita atribuída pelas plataformas de ${v("conversionValue")}, correspondendo a um ROAS de ${v("roas")}${d("roas")}.`);
  const best = [...campaigns].sort((a, b) => (b.conversions ?? 0) - (a.conversions ?? 0))[0];
  if (best && (best.conversions ?? 0) > 0) out.push(`A campanha com mais conversões foi “${best.name}” (${formatValue(best.conversions, "number", fmt)} conversões, CPA ${formatValue(best.cpa, "currency", fmt)}).`);
  const up = movers.find((m) => (m.conversionsDelta ?? 0) > 0);
  const down = movers.find((m) => (m.conversionsDelta ?? 0) < 0);
  if (up || down)
    out.push(
      `Maiores variações de conversões: ${[up && `“${up.name}” (+${formatValue(up.conversionsDelta, "number", fmt)})`, down && `“${down.name}” (${formatValue(down.conversionsDelta, "number", fmt)})`].filter(Boolean).join(" e ")}.`,
    );
  if (k("organicClicks")) out.push(`No SEO, ${v("organicClicks")} cliques orgânicos${d("organicClicks")} e posição média de ${v("position")}.`);
  const met = goals.filter((g) => g.achieved === true).length;
  if (goals.length) out.push(`${met} de ${goals.length} objetivos definidos foram cumpridos no período.`);
  return out;
}
