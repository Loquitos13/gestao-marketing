import type { Client, Platform, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDays, eachDay, fromDate, todayInTz, toDate, weekStart, type ISODate } from "@/lib/dates";
import { convertAmount, loadRates } from "@/server/queries/fx";
import { backtestHoltWinters, fitHoltWinters, forecast, wape, type HwModel } from "./ml/forecast";
import { accountPriorB, fitResponseCurve, predictConversions, type CurvePoint, type ResponseCurve } from "./ml/response-curve";

/** Limiares de fiabilidade (erro de backtest). Acima disto o modelo não entra em propostas. */
export const FORECAST_MAX_WAPE = 0.35;
export const CURVE_MAX_WAPE = 0.45;
export const CURVE_MIN_WEEKS = 8;
const HISTORY_DAYS = 180;

export type SeriesMetric = "cost" | "conversions" | "conversionValue" | "clicks";
export interface DailyRow {
  date: ISODate;
  platform: Platform;
  campaignExternalId: string;
  cost: number;
  conversions: number;
  conversionValue: number;
  clicks: number;
}

export async function loadDailyRows(clientId: string, currency: string, start: ISODate, end: ISODate): Promise<DailyRow[]> {
  const rows = await prisma.adMetricDaily.groupBy({
    by: ["date", "platform", "campaignExternalId", "currency"],
    where: { clientId, level: "CAMPAIGN", date: { gte: toDate(start), lte: toDate(end) } },
    _sum: { cost: true, conversions: true, conversionValue: true, clicks: true },
  });
  const fx = rows.some((r) => r.currency !== currency) ? await loadRates(end) : null;
  const out: DailyRow[] = [];
  for (const r of rows) {
    const factor = r.currency === currency ? 1 : convertAmount(1, r.currency, currency, fx!);
    if (factor === null) continue; // sem taxa registada para esta moeda: linha ignorada
    out.push({
      date: fromDate(r.date),
      platform: r.platform,
      campaignExternalId: r.campaignExternalId,
      cost: Number(r._sum.cost ?? 0) * factor,
      conversions: Number(r._sum.conversions ?? 0),
      conversionValue: Number(r._sum.conversionValue ?? 0) * factor,
      clicks: Number(r._sum.clicks ?? 0),
    });
  }
  return out;
}

/** Série diária contínua (dias sem dados = 0) desde o primeiro dia com dados. */
export function dailySeries(rows: DailyRow[], metric: SeriesMetric, end: ISODate, filter: (r: DailyRow) => boolean = () => true) {
  const sel = rows.filter(filter);
  if (!sel.length) return { dates: [] as ISODate[], values: [] as number[] };
  const first = sel.reduce((m, r) => (r.date < m ? r.date : m), end);
  const by = new Map<ISODate, number>();
  for (const r of sel) by.set(r.date, (by.get(r.date) ?? 0) + r[metric]);
  const dates = eachDay(first, end);
  return { dates, values: dates.map((d) => by.get(d) ?? 0) };
}

/** Pontos semanais (investimento, conversões) de uma campanha; semanas incompletas excluídas. */
export function weeklyPoints(rows: DailyRow[], end: ISODate): CurvePoint[] {
  const by = new Map<ISODate, CurvePoint & { days: number }>();
  for (const r of rows) {
    const w = weekStart(r.date);
    const p = by.get(w) ?? { cost: 0, conversions: 0, days: 0 };
    p.cost += r.cost;
    p.conversions += r.conversions;
    p.days++;
    by.set(w, p);
  }
  const current = weekStart(end);
  return [...by.entries()]
    .filter(([w, p]) => w !== current && p.days >= 6)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, p]) => ({ cost: p.cost, conversions: p.conversions }));
}

const SERIES: { scope: string; label: string; metric: SeriesMetric; platform?: Platform }[] = [
  { scope: "ALL:cost", label: "Investimento diário (todas as plataformas)", metric: "cost" },
  { scope: "ALL:conversions", label: "Conversões diárias (todas as plataformas)", metric: "conversions" },
  { scope: "ALL:conversionValue", label: "Valor de conversão diário", metric: "conversionValue" },
  { scope: "GOOGLE_ADS:cost", label: "Investimento diário Google Ads", metric: "cost", platform: "GOOGLE_ADS" },
  { scope: "GOOGLE_ADS:conversions", label: "Conversões diárias Google Ads", metric: "conversions", platform: "GOOGLE_ADS" },
  { scope: "META_ADS:cost", label: "Investimento diário Meta Ads", metric: "cost", platform: "META_ADS" },
  { scope: "META_ADS:conversions", label: "Conversões diárias Meta Ads", metric: "conversions", platform: "META_ADS" },
];

export interface ForecastParams extends HwModel {
  lastDate: ISODate;
}

/** Ajuste da curva sem as 4 últimas semanas e erro nessas semanas. */
function backtestCurve(points: CurvePoint[], priorB: number) {
  if (points.length < CURVE_MIN_WEEKS) return null;
  const train = fitResponseCurve(points.slice(0, -4), priorB);
  if (!train) return null;
  const test = points.slice(-4);
  return wape(
    test.map((p) => p.conversions),
    test.map((p) => predictConversions(train, p.cost)),
  );
}

export async function trainClientModels(client: Pick<Client, "id" | "timezone" | "currency">, now = new Date()) {
  const end = addDays(todayInTz(client.timezone, now), -1);
  const rows = await loadDailyRows(client.id, client.currency, addDays(end, -HISTORY_DAYS), end);
  const results: { scope: string; kind: string; reliable: boolean; wape: number | null }[] = [];

  const save = async (kind: string, scope: string, label: string, params: unknown, metrics: { wape: number | null; holdoutDays?: number; n: number }, reliable: boolean) => {
    const data = { label, params: params as Prisma.InputJsonValue, metrics: metrics as Prisma.InputJsonValue, reliable, trainedAt: now };
    await prisma.agentModel.upsert({ where: { clientId_kind_scope: { clientId: client.id, kind, scope } }, create: { clientId: client.id, kind, scope, ...data }, update: data });
    results.push({ scope, kind, reliable, wape: metrics.wape });
  };

  for (const s of SERIES) {
    const { values } = dailySeries(rows, s.metric, end, (r) => !s.platform || r.platform === s.platform);
    const model = fitHoltWinters(values);
    if (!model) continue;
    const bt = backtestHoltWinters(values);
    const params: ForecastParams = { ...model, lastDate: end };
    await save("FORECAST", s.scope, s.label, params, { wape: bt.wape, holdoutDays: bt.holdoutDays, n: values.length }, bt.wape !== null && bt.wape <= FORECAST_MAX_WAPE);
  }

  const campaigns = await prisma.campaign.findMany({ where: { clientId: client.id }, select: { id: true, name: true, platform: true, externalId: true } });
  const byCampaign = new Map<string, DailyRow[]>();
  for (const r of rows) {
    const k = `${r.platform}:${r.campaignExternalId}`;
    byCampaign.set(k, [...(byCampaign.get(k) ?? []), r]);
  }
  const prepared = campaigns
    .map((c) => ({ c, points: weeklyPoints(byCampaign.get(`${c.platform}:${c.externalId}`) ?? [], end) }))
    .filter((x) => x.points.length >= 3);
  const prior = accountPriorB(prepared.map((x) => fitResponseCurve(x.points)));
  for (const { c, points } of prepared) {
    const curve = fitResponseCurve(points, prior);
    if (!curve) continue;
    const bt = backtestCurve(points, prior);
    const params: ResponseCurve & { priorB: number; campaignName: string; platform: Platform } = { ...curve, priorB: prior, campaignName: c.name, platform: c.platform };
    await save("RESPONSE_CURVE", `campaign:${c.id}`, `Curva de resposta: ${c.name}`, params, { wape: bt, holdoutDays: bt === null ? 0 : 28, n: points.length }, bt !== null && bt <= CURVE_MAX_WAPE && points.length >= CURVE_MIN_WEEKS);
  }
  return results;
}

/** Previsão a partir de um modelo guardado; as datas começam no dia seguinte ao último treinado. */
export function forecastFromParams(p: ForecastParams, days: number) {
  return forecast(p, days).map((f) => ({ date: addDays(p.lastDate, f.step), value: f.value, lower: f.lower, upper: f.upper }));
}

export async function trainAllClients(now = new Date()) {
  const clients = await prisma.client.findMany({ where: { archivedAt: null }, select: { id: true, timezone: true, currency: true } });
  const out = [];
  for (const c of clients) out.push({ clientId: c.id, models: await trainClientModels(c, now) });
  return out;
}
