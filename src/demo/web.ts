import { addDays, type ISODate } from "@/lib/dates";
import { expectedOrganicCtr } from "@/server/metrics/calc";
import { hash01, noise, splitInt, splitMoney, stochasticRound } from "./rng";
import { dayFactor } from "./paid";
import type { DemoClientSpec } from "./specs";

export interface SearchRowOut {
  dimension: "TOTAL" | "QUERY" | "PAGE" | "DEVICE" | "COUNTRY";
  key: string;
  date: ISODate;
  clicks: number;
  impressions: number;
  positionSum: number;
}

export interface WebRowOut {
  dimension: "TOTAL" | "CHANNEL" | "SOURCE_MEDIUM" | "LANDING_PAGE" | "DEVICE" | "COUNTRY";
  key: string;
  date: ISODate;
  currency: string;
  users: number;
  newUsers: number;
  sessions: number;
  engagedSessions: number;
  views: number;
  events: number;
  keyEvents: number;
  purchases: number | null;
  revenue: number | null;
}

export function generateSearchDay(spec: DemoClientSpec, date: ISODate, ago: number): SearchRowOut[] {
  const f = Math.pow(dayFactor(spec, date, ago), 0.6);
  const rows: SearchRowOut[] = [];
  const pages = new Map<string, { clicks: number; impressions: number; positionSum: number }>();
  for (const q of spec.queries) {
    const k = `${spec.key}|gsc|${q.q}|${date}`;
    const trend = Math.max(0.3, 1 - (q.growth ?? 0.05) * (ago / 100));
    let scen = 1;
    let posDelta = 0;
    if (q.scenario === "rising" && ago <= 45) {
      const p = (45 - ago) / 45;
      scen = 1 + 0.6 * p;
      posDelta = -Math.min(3, q.pos - 1) * p;
    }
    if (q.scenario === "decline" && ago <= 35) {
      const p = (35 - ago) / 35;
      scen = 1 - 0.2 * p;
      posDelta = 2.5 * p;
    }
    const pos = Math.max(1, (q.pos + posDelta) * noise(`${k}|p`, 0.06));
    const impressions = Math.round(q.impr * f * trend * scen * noise(`${k}|i`, 0.15));
    const ctr = expectedOrganicCtr(pos) * (q.ctrMul ?? 1) * noise(`${k}|c`, 0.15);
    const clicks = Math.min(impressions, stochasticRound(impressions * ctr, `${k}|cr`));
    rows.push({ dimension: "QUERY", key: q.q, date, clicks, impressions, positionSum: pos * impressions });
    const pg = pages.get(q.page) ?? { clicks: 0, impressions: 0, positionSum: 0 };
    pg.clicks += clicks;
    pg.impressions += impressions;
    pg.positionSum += pos * impressions;
    pages.set(q.page, pg);
  }
  const total = { clicks: 0, impressions: 0, positionSum: 0 };
  for (const [page, pg] of pages) {
    // Consultas anonimizadas: a página recebe tráfego adicional não atribuível a consultas visíveis.
    const extraImpr = Math.round(pg.impressions * 0.35);
    const avgPos = pg.impressions ? pg.positionSum / pg.impressions : 10;
    const row = {
      dimension: "PAGE" as const,
      key: `${spec.website}${page}`,
      date,
      clicks: pg.clicks + Math.round(pg.clicks * 0.25),
      impressions: pg.impressions + extraImpr,
      positionSum: pg.positionSum + extraImpr * (avgPos + 2),
    };
    rows.push(row);
    total.clicks += row.clicks;
    total.impressions += row.impressions;
    total.positionSum += row.positionSum;
  }
  rows.push({ dimension: "TOTAL", key: "", date, ...total });
  const avg = total.impressions ? total.positionSum / total.impressions : 0;
  const dev = [
    { key: "MOBILE", w: 0.58, p: 1.05 },
    { key: "DESKTOP", w: 0.38, p: 0.93 },
    { key: "TABLET", w: 0.04, p: 1 },
  ];
  const dc = splitInt(total.clicks, dev.map((d) => d.w));
  const di = splitInt(total.impressions, dev.map((d) => d.w));
  dev.forEach((d, i) => rows.push({ dimension: "DEVICE", key: d.key, date, clicks: dc[i], impressions: di[i], positionSum: di[i] * avg * d.p }));
  const cw = spec.countries.map((c) => c.weight);
  const cc = splitInt(total.clicks, cw);
  const ci = splitInt(total.impressions, cw);
  spec.countries.forEach((c, i) => rows.push({ dimension: "COUNTRY", key: c.code, date, clicks: cc[i], impressions: ci[i], positionSum: ci[i] * avg }));
  return rows;
}

export interface DailyPaidTotals {
  googleSearchClicks: number;
  googleOtherClicks: number;
  metaLinkClicks: number;
}

const CHANNELS = [
  { key: "Organic Search", sm: "google / organic", eng: 0.62, cr: 1.0 },
  { key: "Paid Search", sm: "google / cpc", eng: 0.58, cr: 1.4 },
  { key: "Display", sm: "google / display", eng: 0.32, cr: 0.3 },
  { key: "Paid Social", sm: "facebook / paid", eng: 0.45, cr: 0.8 },
  { key: "Direct", sm: "(direct) / (none)", eng: 0.55, cr: 1.3 },
  { key: "Referral", sm: "parceiro.example / referral", eng: 0.6, cr: 0.9 },
  { key: "Email", sm: "newsletter / email", eng: 0.7, cr: 1.8 },
  { key: "Organic Social", sm: "instagram.com / referral", eng: 0.5, cr: 0.5 },
];

export function generateWebDay(spec: DemoClientSpec, date: ISODate, gscClicks: number, paid: DailyPaidTotals): WebRowOut[] {
  const k = `${spec.key}|ga4|${date}`;
  const base: Record<string, number> = {
    "Organic Search": gscClicks * 1.12,
    "Paid Search": paid.googleSearchClicks * 0.86,
    Display: paid.googleOtherClicks * 0.6,
    "Paid Social": paid.metaLinkClicks * 0.75,
    Direct: gscClicks * 0.45,
    Referral: gscClicks * 0.1,
    Email: spec.ecommerce ? gscClicks * 0.12 : gscClicks * 0.03,
    "Organic Social": gscClicks * 0.06,
  };
  const baseCr = spec.ecommerce ? 0.019 : 0.028;
  const aov = 74;
  const rows: WebRowOut[] = [];
  const tot = { users: 0, newUsers: 0, sessions: 0, engagedSessions: 0, views: 0, events: 0, keyEvents: 0, purchases: 0, revenue: 0 };
  for (const ch of CHANNELS) {
    const sessions = Math.round(base[ch.key] * noise(`${k}|${ch.key}|s`, 0.06));
    if (sessions <= 0) continue;
    const users = Math.round(sessions * 0.8);
    const newUsers = Math.round(users * 0.56);
    const engagedSessions = Math.round(sessions * ch.eng * noise(`${k}|${ch.key}|e`, 0.05));
    const views = Math.round(sessions * 2.4 * noise(`${k}|${ch.key}|v`, 0.08));
    const events = Math.round(views * 3.1);
    const keyEvents = stochasticRound(sessions * baseCr * ch.cr * noise(`${k}|${ch.key}|k`, 0.25), `${k}|${ch.key}|kr`);
    const purchases = spec.ecommerce ? keyEvents : null;
    const revenue = spec.ecommerce ? Math.round(keyEvents * aov * noise(`${k}|${ch.key}|r`, 0.15) * 100) / 100 : null;
    const r = { users, newUsers, sessions, engagedSessions, views, events, keyEvents, purchases, revenue };
    rows.push({ dimension: "CHANNEL", key: ch.key, date, currency: spec.currency, ...r });
    rows.push({ dimension: "SOURCE_MEDIUM", key: ch.sm, date, currency: spec.currency, ...r });
    tot.users += users;
    tot.newUsers += newUsers;
    tot.sessions += sessions;
    tot.engagedSessions += engagedSessions;
    tot.views += views;
    tot.events += events;
    tot.keyEvents += keyEvents;
    tot.purchases += purchases ?? 0;
    tot.revenue += revenue ?? 0;
  }
  const total: WebRowOut = {
    dimension: "TOTAL",
    key: "",
    date,
    currency: spec.currency,
    ...tot,
    // utilizadores entre canais sobrepõem-se no mesmo dia
    users: Math.round(tot.users * 0.95),
    newUsers: Math.round(tot.newUsers * 0.95),
    purchases: spec.ecommerce ? tot.purchases : null,
    revenue: spec.ecommerce ? Math.round(tot.revenue * 100) / 100 : null,
  };
  rows.push(total);
  rows.push(...splitWeb(total, "LANDING_PAGE", spec.landingWeights.map((l) => ({ key: `${spec.website}${l.page}`, w: l.weight, cv: l.weight * l.cvMul }))));
  rows.push(
    ...splitWeb(total, "DEVICE", [
      { key: "MOBILE", w: 0.63, cv: 0.5 },
      { key: "DESKTOP", w: 0.33, cv: 0.45 },
      { key: "TABLET", w: 0.04, cv: 0.05 },
    ]),
  );
  rows.push(...splitWeb(total, "COUNTRY", spec.countries.map((c) => ({ key: c.code, w: c.weight, cv: c.weight }))));
  return rows;
}

function splitWeb(total: WebRowOut, dimension: WebRowOut["dimension"], parts: { key: string; w: number; cv: number }[]): WebRowOut[] {
  const w = parts.map((p) => p.w);
  const cv = parts.map((p) => p.cv);
  const s = splitInt(total.sessions, w);
  const u = splitInt(total.users, w);
  const nu = splitInt(total.newUsers, w);
  const e = splitInt(total.engagedSessions, w);
  const v = splitInt(total.views, w);
  const ev = splitInt(total.events, w);
  const ke = splitInt(total.keyEvents, cv);
  const pu = total.purchases === null ? null : splitInt(total.purchases, cv);
  const re = total.revenue === null ? null : splitMoney(total.revenue, cv);
  return parts.map((p, i) => ({
    dimension,
    key: p.key,
    date: total.date,
    currency: total.currency,
    users: u[i],
    newUsers: nu[i],
    sessions: s[i],
    engagedSessions: Math.min(e[i], s[i]),
    views: v[i],
    events: ev[i],
    keyEvents: ke[i],
    purchases: pu ? pu[i] : null,
    revenue: re ? re[i] : null,
  }));
}

const POST_TEXTS = [
  "Bastidores: como nasce cada peça da nova coleção.",
  "5 dicas rápidas que os nossos clientes adoram.",
  "Conheça a equipa por trás do projeto.",
  "Pergunta da semana: qual prefere?",
  "Novidade! Já disponível no site.",
  "O que mudou este ano — explicamos em 60 segundos.",
  "Testemunho real de quem já experimentou.",
  "Guia prático: passo a passo.",
];
const TYPES = ["IMAGE", "VIDEO", "CAROUSEL", "REEL"] as const;

export interface OrganicPostOut {
  platform: "FACEBOOK" | "INSTAGRAM";
  externalId: string;
  url: string;
  contentType: string;
  title: string;
  text: string;
  publishedAt: Date;
  impressions: number;
  reach: number;
  clicks: number | null;
  reactions: number;
  comments: number;
  shares: number;
  saves: number | null;
  videoViews: number | null;
  watchTimeSec: number | null;
  linkClicks: number | null;
  conversions: null;
  unavailable: string[];
}

export function generateOrganicPosts(spec: DemoClientSpec, anchor: ISODate): OrganicPostOut[] {
  const out: OrganicPostOut[] = [];
  const baseImpr = spec.ecommerce ? 4200 : 1600;
  for (let i = 0; i < spec.organicPosts; i++) {
    const k = `${spec.key}|post|${i}`;
    const platform = hash01(`${k}|pl`) < 0.5 ? "FACEBOOK" : "INSTAGRAM";
    const type = TYPES[Math.floor(hash01(`${k}|ty`) * TYPES.length)];
    const typeMul = type === "REEL" ? 2.4 : type === "VIDEO" ? 1.5 : type === "CAROUSEL" ? 1.2 : 1;
    const day = addDays(anchor, -Math.round((i * 120) / spec.organicPosts) - 1);
    const impressions = Math.round(baseImpr * typeMul * noise(`${k}|i`, 0.6));
    const reactions = Math.round(impressions * 0.03 * noise(`${k}|r`, 0.5));
    const isVideo = type === "VIDEO" || type === "REEL";
    const linkClicks = platform === "FACEBOOK" ? Math.round(impressions * 0.006 * noise(`${k}|l`, 0.5)) : null;
    const unavailable = ["conversions"];
    if (platform === "FACEBOOK") unavailable.push("saves");
    else unavailable.push("linkClicks");
    if (!isVideo) unavailable.push("videoViews", "watchTimeSec");
    const id = `${platform === "FACEBOOK" ? "fb" : "ig"}_${spec.key}_${1000 + i}`;
    out.push({
      platform,
      externalId: id,
      url: `https://${platform === "FACEBOOK" ? "facebook.com" : "instagram.com"}/p/${id}`,
      contentType: type,
      title: POST_TEXTS[i % POST_TEXTS.length].split(":")[0],
      text: POST_TEXTS[i % POST_TEXTS.length],
      publishedAt: new Date(`${day}T18:00:00Z`),
      impressions,
      reach: Math.round(impressions * 0.78),
      clicks: linkClicks,
      reactions,
      comments: Math.round(impressions * 0.003 * noise(`${k}|c`, 0.6)),
      shares: Math.round(impressions * 0.002 * noise(`${k}|s`, 0.6)),
      saves: platform === "INSTAGRAM" ? Math.round(impressions * 0.004 * noise(`${k}|sv`, 0.6)) : null,
      videoViews: isVideo ? Math.round(impressions * 0.55) : null,
      watchTimeSec: isVideo ? Math.round(impressions * 0.55 * 9) : null,
      linkClicks,
      conversions: null,
      unavailable,
    });
  }
  return out;
}
