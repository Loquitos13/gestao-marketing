import type { Platform } from "@prisma/client";
import { autoGranularity } from "@/lib/dates";
import type { Unit } from "@/lib/format";
import { delta, roi, type Delta } from "@/server/metrics/calc";
import { METRICS } from "@/server/metrics/definitions";
import type { ClientContext, DataOriginLabel } from "./context";
import type { Filters } from "./filters";
import { paidTotals, queryPaid } from "./paid";
import { searchByKey, searchSeries, searchTotals } from "./seo";
import { webSeries, webTotals } from "./web";

export interface Kpi {
  key: string;
  label: string;
  unit: Unit;
  delta: Delta;
  higherIsBetter: boolean | null;
  series: { date: string; value: number | null }[];
  source: string;
  formula?: string;
  description: string;
  origin: DataOriginLabel;
  quality: "OK" | "APPROX" | "UNAVAILABLE";
  note?: string;
}

export function paidPlatforms(f: Filters, ctx: ClientContext): Platform[] {
  const p: Platform[] = [];
  if ((f.channel === "all" || f.channel === "google") && ctx.has.GOOGLE_ADS) p.push("GOOGLE_ADS");
  if ((f.channel === "all" || f.channel === "meta") && ctx.has.META_ADS) p.push("META_ADS");
  return p;
}

export function kpi(
  key: string,
  cur: number | null,
  prev: number | null,
  series: { date: string; value: number | null }[],
  origin: DataOriginLabel,
  extra: Partial<Kpi> = {},
): Kpi {
  const def = METRICS[key];
  return {
    key,
    label: def?.label ?? key,
    unit: def?.unit ?? "number",
    delta: delta(cur, prev),
    higherIsBetter: def?.higherIsBetter ?? null,
    series,
    source: def?.sources.join(" · ") ?? "",
    formula: def?.formula,
    description: def?.description ?? "",
    origin,
    quality: cur === null ? "UNAVAILABLE" : "OK",
    ...extra,
  };
}

export async function loadDashboard(ctx: ClientContext, f: Filters) {
  const { client } = ctx;
  const cur = f.period;
  const prev = f.compare;
  const g = autoGranularity(cur.start, cur.end);
  const platforms = paidPlatforms(f, ctx);
  const base = { clientId: client.id, clientCurrency: client.currency, campaignIds: f.campaign ? [f.campaign] : null, device: f.device, country: f.country };
  const showSeo = f.channel === "all" || f.channel === "seo";

  const [perPlatformSeries, campCur, campPrev] = await Promise.all([
    Promise.all(platforms.map((p) => queryPaid({ ...base, platforms: [p], start: cur.start, end: cur.end, groupBy: g }).then((r) => ({ p, rows: r.rows })))),
    queryPaid({ ...base, platforms, start: cur.start, end: cur.end, groupBy: "campaign" }),
    prev ? queryPaid({ ...base, platforms, start: prev.start, end: prev.end, groupBy: "campaign" }) : null,
  ]);
  const [pCur, pPrev, pSeries, byPlatformCur, byPlatformPrev, sCur, sPrev, sSeries, wCur, wPrev, wSeries, topAds, queries] = await Promise.all([
    paidTotals({ ...base, platforms, start: cur.start, end: cur.end }),
    prev ? paidTotals({ ...base, platforms, start: prev.start, end: prev.end }) : null,
    queryPaid({ ...base, platforms, start: cur.start, end: cur.end, groupBy: g }),
    queryPaid({ ...base, platforms, start: cur.start, end: cur.end, groupBy: "platform" }),
    prev ? queryPaid({ ...base, platforms, start: prev.start, end: prev.end, groupBy: "platform" }) : null,
    showSeo && ctx.has.SEARCH_CONSOLE ? searchTotals(client.id, cur.start, cur.end) : null,
    showSeo && ctx.has.SEARCH_CONSOLE && prev ? searchTotals(client.id, prev.start, prev.end) : null,
    showSeo && ctx.has.SEARCH_CONSOLE ? searchSeries(client.id, cur.start, cur.end, g) : [],
    ctx.has.GA4 ? webTotals(client.id, cur.start, cur.end) : null,
    ctx.has.GA4 && prev ? webTotals(client.id, prev.start, prev.end) : null,
    ctx.has.GA4 ? webSeries(client.id, cur.start, cur.end, g) : [],
    queryPaid({ ...base, device: null, country: null, platforms, start: cur.start, end: cur.end, groupBy: "ad" }),
    showSeo && ctx.has.SEARCH_CONSOLE ? searchByKey(client.id, "QUERY", cur, prev, 1000) : [],
  ]);

  const paidOrigin = ctx.originOf(platforms);
  const series = (fn: (r: (typeof pSeries.rows)[number]) => number | null) => pSeries.rows.map((r) => ({ date: r.key, value: fn(r) }));
  const t = pCur.totals;
  const d = pCur.derived;
  // Sem dados no período anterior, a comparação fica "Não disponível" (não 0).
  const pt = pPrev?.hasData ? pPrev.totals : null;
  const pd = pPrev?.hasData ? pPrev.derived : null;
  // Plataforma sem taxa de câmbio: custo "Não disponível" em vez de 0; o total também fica incompleto.
  const platformCost = (res: typeof byPlatformCur | null, p: Platform) => (res?.excludedPlatforms.includes(p) ? null : res?.rows.find((r) => r.key === p)?.totals.cost ?? null);
  const totalCost = (res: typeof pCur | null) => (!res || res.excludedPlatforms.length ? null : res.totals.cost);
  const margin = client.grossMargin === null ? null : Number(client.grossMargin);

  const paidKpis: Kpi[] = platforms.length
    ? [
        kpi("cost", totalCost(pCur), pt ? totalCost(pPrev) : null, series((r) => r.totals.cost), paidOrigin, { label: "Investimento total" }),
        ...(platforms.includes("GOOGLE_ADS")
          ? [kpi("cost", platformCost(byPlatformCur, "GOOGLE_ADS"), platformCost(byPlatformPrev, "GOOGLE_ADS"), [], ctx.originOf(["GOOGLE_ADS"]), { key: "costGoogle", label: "Investimento Google Ads", source: "Google Ads" })]
          : []),
        ...(platforms.includes("META_ADS")
          ? [kpi("cost", platformCost(byPlatformCur, "META_ADS"), platformCost(byPlatformPrev, "META_ADS"), [], ctx.originOf(["META_ADS"]), { key: "costMeta", label: "Investimento Meta Ads", source: "Meta Ads" })]
          : []),
        kpi("impressions", t.impressions, pt?.impressions ?? null, series((r) => r.totals.impressions), paidOrigin),
        kpi("reach", t.reach, pt?.reach ?? null, [], ctx.originOf(["META_ADS"]), {
          quality: t.reach === null ? "UNAVAILABLE" : t.reachIsApproximate ? "APPROX" : "OK",
          note: t.reachIsApproximate ? "Soma de alcances diários do Meta (limite superior). O Google Ads não disponibiliza alcance equivalente." : undefined,
        }),
        kpi("frequency", d.frequency, pd?.frequency ?? null, [], ctx.originOf(["META_ADS"]), { quality: d.frequency === null ? "UNAVAILABLE" : t.reachIsApproximate ? "APPROX" : "OK" }),
        kpi("clicks", t.clicks, pt?.clicks ?? null, series((r) => r.totals.clicks), paidOrigin),
        kpi("ctr", d.ctr, pd?.ctr ?? null, series((r) => r.derived.ctr), paidOrigin),
        kpi("cpc", d.cpc, pd?.cpc ?? null, series((r) => r.derived.cpc), paidOrigin),
        kpi("cpm", d.cpm, pd?.cpm ?? null, series((r) => r.derived.cpm), paidOrigin),
        kpi("conversions", t.conversions, pt?.conversions ?? null, series((r) => r.totals.conversions), paidOrigin, {
          note: platforms.length > 1 ? "Soma de conversões reportadas por cada plataforma com a sua própria atribuição; pode haver sobreposição." : undefined,
        }),
        kpi("conversionRate", d.conversionRate, pd?.conversionRate ?? null, series((r) => r.derived.conversionRate), paidOrigin),
        kpi("cpa", d.cpa, pd?.cpa ?? null, series((r) => r.derived.cpa), paidOrigin),
        kpi("leads", t.leads, pt?.leads ?? null, series((r) => r.totals.leads), paidOrigin),
        kpi("cpl", d.cpl, pd?.cpl ?? null, series((r) => r.derived.cpl), paidOrigin),
        kpi("conversionValue", t.conversionValue, pt?.conversionValue ?? null, series((r) => r.totals.conversionValue), paidOrigin),
        kpi("roas", d.roas, pd?.roas ?? null, series((r) => r.derived.roas), paidOrigin),
        kpi("roi", roi(t.conversionValue, t.cost, margin), pt ? roi(pt.conversionValue, pt.cost, margin) : null, [], paidOrigin, {
          note: margin === null ? "Defina a margem bruta do cliente para calcular o ROI." : `Margem bruta considerada: ${Math.round(margin * 100)}%.`,
        }),
      ]
    : [];

  const seoOrigin = ctx.originOf(["SEARCH_CONSOLE"]);
  const ss = (fn: (r: (typeof sSeries)[number]) => number | null) => sSeries.map((r) => ({ date: r.date, value: fn(r) }));
  const sp = sPrev?.hasData ? sPrev : null;
  const seoKpis: Kpi[] = sCur
    ? [
        kpi("organicClicks", sCur.clicks, sp?.clicks ?? null, ss((r) => r.clicks), seoOrigin),
        kpi("organicImpressions", sCur.impressions, sp?.impressions ?? null, ss((r) => r.impressions), seoOrigin),
        kpi("organicCtr", sCur.ctr, sp?.ctr ?? null, ss((r) => r.ctr), seoOrigin),
        kpi("position", sCur.position, sp?.position ?? null, ss((r) => r.position), seoOrigin),
        kpi("trackedQueries", queries.filter((q) => q.current.impressions > 0).length, prev ? queries.filter((q) => q.previous.impressions > 0).length : null, [], seoOrigin, {
          label: "Consultas com impressões",
          unit: "number",
          higherIsBetter: true,
          description: "Número de consultas (não anonimizadas) com pelo menos uma impressão no período.",
          source: "Google Search Console",
        }),
      ]
    : [];

  const gaOrigin = ctx.originOf(["GA4"]);
  const ws = (fn: (r: (typeof wSeries)[number]) => number | null) => wSeries.map((r) => ({ date: r.date, value: fn(r) }));
  const organicSessions = wCur ? await webTotals(client.id, cur.start, cur.end, "CHANNEL", "Organic Search") : null;
  const organicSessionsPrev = wPrev?.hasData && prev ? await webTotals(client.id, prev.start, prev.end, "CHANNEL", "Organic Search") : null;
  const wp = wPrev?.hasData ? wPrev : null;
  const webKpis: Kpi[] = wCur
    ? [
        kpi("sessions", wCur.sessions, wp?.sessions ?? null, ws((r) => r.sessions), gaOrigin),
        kpi("users", wCur.users, wp?.users ?? null, ws((r) => r.users), gaOrigin, {
          quality: wCur.usersApproximate ? "APPROX" : "OK",
          note: wCur.usersApproximate ? "Soma de utilizadores diários (aproximação; o mesmo utilizador pode repetir-se)." : undefined,
        }),
        kpi("sessions", organicSessions?.sessions ?? null, organicSessionsPrev?.sessions ?? null, [], gaOrigin, {
          key: "organicSessions",
          label: "Tráfego orgânico (sessões)",
          description: "Sessões do canal Organic Search no GA4.",
          source: "Google Analytics 4 (canal Organic Search)",
        }),
        kpi("engagementRate", wCur.engagementRate, wp?.engagementRate ?? null, ws((r) => r.engagementRate), gaOrigin),
      ]
    : [];

  const positionSeries = ss((r) => r.position);
  const top = topAds.rows
    .filter((r) => r.totals.impressions > 0)
    .sort((a, b) => (b.totals.conversions ?? 0) - (a.totals.conversions ?? 0) || b.totals.clicks - a.totals.clicks)
    .slice(0, 5);

  const platformCostOn = (p: Platform, date: string) => perPlatformSeries.find((s) => s.p === p)?.rows.find((r) => r.key === date)?.totals.cost ?? 0;
  const channels = byPlatformCur.rows.map((r) => {
    const pr = byPlatformPrev?.rows.find((x) => x.key === r.key) ?? null;
    return {
      platform: r.key as Platform,
      cost: r.totals.cost,
      share: t.cost ? r.totals.cost / t.cost : null,
      conversions: r.totals.conversions,
      cpa: r.derived.cpa,
      value: r.totals.conversionValue,
      roas: r.derived.roas,
      roasDelta: delta(r.derived.roas, pr?.derived.roas ?? null).pct,
      costDelta: delta(r.totals.cost, pr?.totals.cost ?? null).pct,
    };
  });
  const campaignMovers = campCur.rows
    .map((r) => {
      const pr = campPrev?.rows.find((x) => x.key === r.key) ?? null;
      return { id: r.key, platform: r.platform!, cost: r.totals.cost, conversions: r.totals.conversions, cpa: r.derived.cpa, roas: r.derived.roas, cpaDelta: delta(r.derived.cpa, pr?.derived.cpa ?? null).pct, lostIsBudget: r.totals.searchLostIsBudget, lostIsRank: r.totals.searchLostIsRank, frequency: r.derived.frequency };
    })
    .filter((c) => c.cost > 0 && c.cpaDelta !== null)
    .sort((a, b) => Math.abs(b.cpaDelta! * b.cost) - Math.abs(a.cpaDelta! * a.cost))
    .slice(0, 5);

  return {
    granularity: g,
    paidKpis,
    seoKpis,
    webKpis,
    channels,
    campaignMovers,
    spendSeries: pSeries.rows.map((r) => ({ date: r.key, cost: r.totals.cost, costGoogle: platformCostOn("GOOGLE_ADS", r.key), costMeta: platformCostOn("META_ADS", r.key), conversions: r.totals.conversions ?? 0, value: r.totals.conversionValue ?? 0 })),
    platformSplit: byPlatformCur.rows.map((r) => ({ platform: r.key, cost: r.totals.cost, conversions: r.totals.conversions ?? 0, clicks: r.totals.clicks })),
    organicSeries: sSeries.map((r) => ({ date: r.date, clicks: r.clicks, impressions: r.impressions })),
    positionSeries,
    topAdKeys: top.map((r) => ({ key: r.key, platform: r.platform!, campaign: r.campaignExternalId!, totals: r.totals, derived: r.derived })),
    topQueries: queries.slice(0, 8),
    // Plataformas sem taxa de câmbio: ausentes dos gráficos, da repartição por canal e das séries de investimento.
    excludedPlatforms: pCur.excludedPlatforms,
    warnings: [...pCur.warnings, ...(pCur.breakdownMode ? ["Filtro de dispositivo/país ativo: alcance, cliques no link e métricas de vídeo não estão disponíveis nesta repartição."] : [])],
    completeness: ctx.completenessWarning(showSeo ? [...platforms, "SEARCH_CONSOLE", "GA4"] : platforms, cur.end),
  };
}
