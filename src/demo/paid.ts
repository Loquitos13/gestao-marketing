import { toDate, type ISODate } from "@/lib/dates";
import { hash01, noise, splitInt, splitMoney, stochasticRound } from "./rng";
import type { DemoAd, DemoCampaign, DemoClientSpec } from "./specs";

export interface MetricRow {
  platform: "GOOGLE_ADS" | "META_ADS";
  level: "CAMPAIGN" | "AD";
  campaignExternalId: string;
  adGroupExternalId: string;
  adExternalId: string;
  date: ISODate;
  currency: string;
  impressions: number;
  clicks: number;
  cost: number;
  interactions: number | null;
  reach: number | null;
  linkClicks: number | null;
  outboundClicks: number | null;
  landingPageViews: number | null;
  conversions: number;
  allConversions: number | null;
  conversionValue: number | null;
  allConversionValue: number | null;
  leads: number;
  purchases: number;
  purchaseValue: number | null;
  videoViews: number | null;
  thruplays: number | null;
  videoP25: number | null;
  videoP50: number | null;
  videoP75: number | null;
  videoP100: number | null;
  engagements: number | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  searchImpressionShare: number | null;
  searchLostIsBudget: number | null;
  searchLostIsRank: number | null;
  eligibleImpressionsApprox: number | null;
}

export interface BreakdownRow {
  platform: "GOOGLE_ADS" | "META_ADS";
  campaignExternalId: string;
  date: ISODate;
  dimension: "DEVICE" | "COUNTRY";
  value: string;
  currency: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionValue: number | null;
  leads: number;
}

export interface TermRow {
  kind: "KEYWORD" | "SEARCH_TERM";
  campaignExternalId: string;
  adGroupExternalId: string;
  text: string;
  matchType: string;
  date: ISODate;
  currency: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionValue: number | null;
}

const WEEKDAY: Record<"b2c" | "b2b", number[]> = {
  b2c: [1.15, 0.92, 0.95, 0.97, 1.0, 1.03, 1.12],
  b2b: [0.55, 1.12, 1.15, 1.12, 1.08, 0.95, 0.55],
};

export function dayFactor(spec: DemoClientSpec, date: ISODate, ago: number): number {
  const d = toDate(date);
  const month = d.getUTCMonth() + 1;
  let season = 1;
  if (spec.ecommerce) season = month === 11 ? 1.35 : month === 12 ? 1.3 : month === 1 ? 1.1 : month === 8 ? 0.9 : 1;
  else season = month === 8 ? 0.7 : month === 12 ? 0.82 : month === 1 ? 1.12 : 1;
  const trend = 1 + 0.12 * (1 - Math.min(ago, 400) / 400);
  return WEEKDAY[spec.profile][d.getUTCDay()] * season * trend;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

interface AdCtx {
  ad: DemoAd;
  adGroupId: string;
  wNorm: number;
}

function adList(c: DemoCampaign): AdCtx[] {
  if (!c.adLevel) return [{ ad: { id: "", name: c.name, weight: 1, ctrMul: 1, cvrMul: 1, finalUrl: "" }, adGroupId: "", wNorm: 1 }];
  const all = c.adGroups.flatMap((g) => g.ads.map((ad) => ({ ad, adGroupId: g.id })));
  const total = all.reduce((s, a) => s + a.ad.weight, 0) || 1;
  return all.map((a) => ({ ...a, wNorm: a.ad.weight / total }));
}

function emptyRow(c: DemoCampaign, level: "CAMPAIGN" | "AD", date: ISODate, currency: string): MetricRow {
  return {
    platform: c.platform,
    level,
    campaignExternalId: c.id,
    adGroupExternalId: "",
    adExternalId: "",
    date,
    currency,
    impressions: 0,
    clicks: 0,
    cost: 0,
    interactions: null,
    reach: null,
    linkClicks: null,
    outboundClicks: null,
    landingPageViews: null,
    conversions: 0,
    allConversions: null,
    conversionValue: null,
    allConversionValue: null,
    leads: 0,
    purchases: 0,
    purchaseValue: null,
    videoViews: null,
    thruplays: null,
    videoP25: null,
    videoP50: null,
    videoP75: null,
    videoP100: null,
    engagements: null,
    reactions: null,
    comments: null,
    shares: null,
    searchImpressionShare: null,
    searchLostIsBudget: null,
    searchLostIsRank: null,
    eligibleImpressionsApprox: null,
  };
}

const SUM_KEYS = [
  "impressions",
  "clicks",
  "cost",
  "interactions",
  "reach",
  "linkClicks",
  "outboundClicks",
  "landingPageViews",
  "conversions",
  "allConversions",
  "conversionValue",
  "allConversionValue",
  "leads",
  "purchases",
  "purchaseValue",
  "videoViews",
  "thruplays",
  "videoP25",
  "videoP50",
  "videoP75",
  "videoP100",
  "engagements",
  "reactions",
  "comments",
  "shares",
] as const;

/** Gera as linhas de um dia para uma campanha. Função pura de (spec, campanha, data, ago). */
export function generateCampaignDay(spec: DemoClientSpec, c: DemoCampaign, date: ISODate, ago: number) {
  const out = { adRows: [] as MetricRow[], campaignRow: null as MetricRow | null, breakdowns: [] as BreakdownRow[], terms: [] as TermRow[] };
  if (ago > c.startDaysAgo) return out;
  const k = `${spec.key}|${c.id}|${date}`;
  const sc = c.scenario;
  const scenarioOn = sc && ago <= sc.fromDaysAgo;
  let spend = c.dailyBudget * dayFactor(spec, date, ago) * noise(`${k}|spend`, 0.12);
  if (scenarioOn && sc.kind === "budgetLimited") spend = c.dailyBudget * 0.98 * noise(`${k}|cap`, 0.02);
  if (scenarioOn && sc.kind === "overspend") spend *= sc.factor;
  const cvrMul = scenarioOn && sc.kind === "cpaSpike" ? sc.factor : 1;
  const cpcMul = scenarioOn && sc.kind === "cpaSpike" ? 1.18 : 1;
  const isMeta = c.platform === "META_ADS";

  for (const { ad, adGroupId, wNorm } of adList(c)) {
    const ak = `${k}|${ad.id}`;
    let ctrFatigue = 1;
    let freq = 1.12 * noise(`${ak}|f`, 0.05);
    if (ad.createdDaysAgo !== undefined) {
      const age = ad.createdDaysAgo - ago;
      if (age < 0) continue;
      if (ad.fatigue) {
        ctrFatigue = Math.max(0.4, 1 - age / 100);
        freq = 1.05 + age * 0.012;
      }
    }
    const spendAd = spend * wNorm * noise(`${ak}|s`, 0.1);
    const cpcAd = c.cpc * cpcMul * noise(`${ak}|c`, 0.1);
    const ctrAd = c.ctr * ad.ctrMul * ctrFatigue * noise(`${ak}|t`, 0.1);
    const clicks = stochasticRound(spendAd / cpcAd, `${ak}|cr`);
    const impressions = Math.max(clicks, Math.round(spendAd / cpcAd / ctrAd));
    const cost = r2(clicks > 0 ? clicks * cpcAd : isMeta ? spendAd * 0.2 : 0);
    const rawConv = clicks * c.cvr * ad.cvrMul * cvrMul * noise(`${ak}|v`, 0.3);
    const conversions = isMeta ? stochasticRound(rawConv, `${ak}|vr`) : r2(rawConv);
    const value = c.purchaseShare > 0 ? r2(conversions * c.aov * noise(`${ak}|aov`, 0.15)) : null;
    const isVideo = ad.format === "VIDEO" || c.type === "VIDEO";
    const row = emptyRow(c, "AD", date, spec.currency);
    Object.assign(row, {
      adGroupExternalId: adGroupId,
      adExternalId: ad.id,
      level: c.adLevel ? "AD" : "CAMPAIGN",
      impressions,
      clicks,
      cost,
      conversions,
      conversionValue: value,
      leads: r2(conversions * c.leadShare),
      purchases: r2(conversions * c.purchaseShare),
    });
    if (isMeta) {
      const linkClicks = Math.round(clicks * 0.7);
      const reactions = Math.round(impressions * 0.0035 * noise(`${ak}|re`, 0.3));
      const comments = Math.round(impressions * 0.0004 * noise(`${ak}|co`, 0.4));
      const shares = Math.round(impressions * 0.0003 * noise(`${ak}|sh`, 0.4));
      Object.assign(row, {
        reach: Math.round(impressions / freq),
        linkClicks,
        outboundClicks: Math.round(linkClicks * 0.95),
        landingPageViews: Math.round(linkClicks * 0.78),
        purchaseValue: value,
        reactions,
        comments,
        shares,
        engagements: reactions + comments + shares + linkClicks,
      });
      if (isVideo) {
        const views = Math.round(impressions * 0.28);
        Object.assign(row, {
          videoViews: views,
          thruplays: Math.round(impressions * 0.07),
          videoP25: Math.round(views * 0.6),
          videoP50: Math.round(views * 0.38),
          videoP75: Math.round(views * 0.24),
          videoP100: Math.round(views * 0.15),
        });
      }
    } else {
      Object.assign(row, {
        interactions: isVideo ? Math.round(impressions * 0.3) : clicks,
        allConversions: r2(conversions * 1.15),
        allConversionValue: value === null ? null : r2(value * 1.1),
        videoViews: isVideo ? Math.round(impressions * 0.3) : null,
      });
    }
    if (c.adLevel) out.adRows.push(row);
    else out.campaignRow = row;
  }

  if (c.adLevel) {
    if (out.adRows.length === 0) return out;
    const camp = emptyRow(c, "CAMPAIGN", date, spec.currency);
    for (const r of out.adRows) {
      for (const key of SUM_KEYS) {
        const v = r[key];
        if (v !== null) (camp as unknown as Record<string, number | null>)[key] = ((camp[key] as number | null) ?? 0) + v;
      }
    }
    camp.cost = r2(camp.cost);
    camp.conversions = r2(camp.conversions);
    camp.leads = r2(camp.leads);
    camp.purchases = r2(camp.purchases);
    if (camp.conversionValue !== null) camp.conversionValue = r2(camp.conversionValue);
    if (camp.purchaseValue !== null) camp.purchaseValue = r2(camp.purchaseValue);
    if (camp.allConversions !== null) camp.allConversions = r2(camp.allConversions);
    if (camp.allConversionValue !== null) camp.allConversionValue = r2(camp.allConversionValue);
    // Alcance da campanha é deduplicado entre anúncios: inferior à soma.
    if (camp.reach !== null) camp.reach = Math.round(camp.reach * 0.88);
    out.campaignRow = camp;
  }

  const camp = out.campaignRow!;
  if (c.type === "SEARCH" && camp.impressions > 0) {
    const is = Math.min(0.98, (c.baseImpressionShare ?? 0.6) * noise(`${k}|is`, 0.05));
    const lostB = scenarioOn && sc.kind === "budgetLimited" ? sc.factor * noise(`${k}|lb`, 0.08) : 0.03 * hash01(`${k}|lb`);
    camp.searchImpressionShare = r6(is);
    camp.searchLostIsBudget = r6(Math.min(lostB, 1 - is));
    camp.searchLostIsRank = r6(Math.max(0, 1 - is - camp.searchLostIsBudget));
    camp.eligibleImpressionsApprox = Math.round(camp.impressions / is);
  }

  out.breakdowns.push(...breakdown(c, camp, "DEVICE", deviceWeights(c), date, spec.currency));
  out.breakdowns.push(
    ...breakdown(
      c,
      camp,
      "COUNTRY",
      spec.countries.map((x) => ({ value: x.code, w: x.weight, cw: x.weight })),
      date,
      spec.currency,
    ),
  );

  if (c.type === "SEARCH") out.terms.push(...terms(spec, c, out.adRows, date));
  return out;
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

function deviceWeights(c: DemoCampaign) {
  if (c.platform === "META_ADS")
    return [
      { value: "MOBILE", w: 0.9, cw: 0.86 },
      { value: "DESKTOP", w: 0.08, cw: 0.12 },
      { value: "TABLET", w: 0.02, cw: 0.02 },
    ];
  return [
    { value: "MOBILE", w: 0.6, cw: 0.5 },
    { value: "DESKTOP", w: 0.35, cw: 0.45 },
    { value: "TABLET", w: 0.05, cw: 0.05 },
  ];
}

function breakdown(
  c: DemoCampaign,
  camp: MetricRow,
  dimension: "DEVICE" | "COUNTRY",
  weights: { value: string; w: number; cw: number }[],
  date: ISODate,
  currency: string,
): BreakdownRow[] {
  const w = weights.map((x) => x.w);
  const cw = weights.map((x) => x.cw);
  const imp = splitInt(camp.impressions, w);
  const clk = splitInt(camp.clicks, w);
  const cost = splitMoney(camp.cost, w);
  const conv = splitMoney(camp.conversions, cw);
  const leads = splitMoney(camp.leads, cw);
  const val = camp.conversionValue === null ? null : splitMoney(camp.conversionValue, cw);
  return weights.map((x, i) => ({
    platform: c.platform,
    campaignExternalId: c.id,
    date,
    dimension,
    value: x.value,
    currency,
    impressions: imp[i],
    clicks: clk[i],
    cost: cost[i],
    conversions: conv[i],
    conversionValue: val ? val[i] : null,
    leads: leads[i],
  }));
}

const VARIANTS = ["preço", "online", "perto de mim", "melhor"];

function terms(spec: DemoClientSpec, c: DemoCampaign, adRows: MetricRow[], date: ISODate): TermRow[] {
  const out: TermRow[] = [];
  for (const g of c.adGroups) {
    if (!g.keywords?.length) continue;
    const rows = adRows.filter((r) => r.adGroupExternalId === g.id);
    const tot = rows.reduce(
      (a, r) => ({
        impressions: a.impressions + r.impressions,
        clicks: a.clicks + r.clicks,
        cost: a.cost + r.cost,
        conv: a.conv + r.conversions,
        value: a.value + (r.conversionValue ?? 0),
      }),
      { impressions: 0, clicks: 0, cost: 0, conv: 0, value: 0 },
    );
    const w = g.keywords.map((kw) => kw.weight * noise(`${spec.key}|${g.id}|${kw.text}|${date}`, 0.15));
    const imp = splitInt(tot.impressions, w);
    const clk = splitInt(tot.clicks, w);
    const cost = splitMoney(tot.cost, w);
    const conv = splitMoney(tot.conv, w);
    const val = splitMoney(tot.value, w);
    g.keywords.forEach((kw, i) => {
      const base = {
        campaignExternalId: c.id,
        adGroupExternalId: g.id,
        date,
        currency: spec.currency,
      };
      const hasValue = c.purchaseShare > 0;
      out.push({ ...base, kind: "KEYWORD", text: kw.text, matchType: kw.match, impressions: imp[i], clicks: clk[i], cost: cost[i], conversions: conv[i], conversionValue: hasValue ? val[i] : null });
      // Termos de pesquisa: ~90% do tráfego da palavra-chave é reportado (limiares de privacidade).
      const variant = VARIANTS[Math.floor(hash01(kw.text) * VARIANTS.length)];
      const tw = [0.62, 0.28];
      const ti = splitInt(Math.round(imp[i] * 0.9), tw);
      const tc = splitInt(Math.round(clk[i] * 0.9), tw);
      const tco = splitMoney(cost[i] * 0.9, tw);
      const tcv = splitMoney(conv[i] * 0.9, tw);
      const tva = splitMoney(val[i] * 0.9, tw);
      [kw.text, `${kw.text} ${variant}`].forEach((text, j) =>
        out.push({ ...base, kind: "SEARCH_TERM", text, matchType: "", impressions: ti[j], clicks: tc[j], cost: tco[j], conversions: tcv[j], conversionValue: hasValue ? tva[j] : null }),
      );
    });
  }
  return out;
}
