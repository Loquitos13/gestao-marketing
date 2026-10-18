import { comparePeriod, isISODate, PERIOD_PRESETS, resolvePeriod, todayInTz, type CompareMode, type ISODate, type Period, type PeriodPreset } from "@/lib/dates";

export type Channel = "all" | "google" | "meta" | "seo";

export interface Filters {
  period: Period;
  compare: { start: ISODate; end: ISODate } | null;
  compareMode: CompareMode;
  channel: Channel;
  campaign: string | null;
  device: string | null;
  country: string | null;
}

export type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const SAFE_ID = /^[A-Za-z0-9_\-.:/]{1,80}$/;

/** Validação estrita dos filtros vindos do URL (valores inválidos são ignorados). */
export function parseFilters(sp: SearchParams, timezone: string, now = new Date()): Filters {
  const presetRaw = first(sp.period);
  const preset: PeriodPreset = (PERIOD_PRESETS as readonly string[]).includes(presetRaw ?? "") ? (presetRaw as PeriodPreset) : "last30";
  const today = todayInTz(timezone, now);
  const start = first(sp.start);
  const end = first(sp.end);
  const period = resolvePeriod(preset, today, { start: isISODate(start) ? start : undefined, end: isISODate(end) ? end : undefined });
  const cmpRaw = first(sp.compare);
  const compareMode: CompareMode = cmpRaw === "yoy" || cmpRaw === "none" ? cmpRaw : "previous";
  const channelRaw = first(sp.channel);
  const channel: Channel = channelRaw === "google" || channelRaw === "meta" || channelRaw === "seo" ? channelRaw : "all";
  const pick = (v: string | undefined) => (v && SAFE_ID.test(v) ? v : null);
  const device = pick(first(sp.device)?.toUpperCase());
  return {
    period,
    compare: comparePeriod(period, compareMode),
    compareMode,
    channel,
    campaign: pick(first(sp.campaign)),
    device: device && ["MOBILE", "DESKTOP", "TABLET"].includes(device) ? device : null,
    country: pick(first(sp.country)?.toUpperCase()),
  };
}

export function filtersToQuery(f: Partial<Filters> & { period: Period }): string {
  const q = new URLSearchParams();
  q.set("period", f.period.preset);
  if (f.period.preset === "custom") {
    q.set("start", f.period.start);
    q.set("end", f.period.end);
  }
  if (f.compareMode && f.compareMode !== "previous") q.set("compare", f.compareMode);
  if (f.channel && f.channel !== "all") q.set("channel", f.channel);
  if (f.campaign) q.set("campaign", f.campaign);
  if (f.device) q.set("device", f.device);
  if (f.country) q.set("country", f.country);
  return q.toString();
}
