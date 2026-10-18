import type { Platform } from "@prisma/client";
import { formatValue, type FormatContext } from "@/lib/format";
import { delta, expectedOrganicCtr, safeDiv } from "@/server/metrics/calc";

export interface RecommendationDraft {
  fingerprint: string;
  type: string;
  source: "RULE" | "STATISTICAL" | "AI";
  platform: Platform | null;
  entityLevel: string | null;
  entityId: string | null;
  entityName: string | null;
  title: string;
  explanation: string;
  suggestedAction: string;
  priority: 1 | 2 | 3;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  impactEstimate: string | null;
  evidence: Record<string, unknown>;
}

export interface PerfWindow {
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number | null;
  conversionValue: number | null;
  reach?: number | null;
  lostIsBudget?: number | null;
  impressionShare?: number | null;
}

export interface EntityPerf {
  id: string;
  name: string;
  platform: Platform;
  campaignName?: string;
  dailyBudget?: number | null;
  cur: PerfWindow;
  prev: PerfWindow;
}

export interface RuleInput {
  fmt: FormatContext;
  windowLabel: string;
  goals: { cpaMax?: number; cplMax?: number; roasMin?: number; ctrMin?: number };
  campaigns: EntityPerf[];
  ads: EntityPerf[];
  landingPages: { key: string; sessions: number; keyEvents: number | null }[];
  siteKeyEventRate: number | null;
  queries: { key: string; cur: { clicks: number; impressions: number; position: number | null }; prev: { clicks: number; impressions: number; position: number | null } }[];
  pages: { key: string; curClicks: number; prevClicks: number }[];
  pacing: { scope: string; platform: Platform | null; amount: number; projection: number; spent: number; remainingDays: number }[];
}

const pct = (v: number | null, fmt: FormatContext) => formatValue(v, "percent", fmt);
const money = (v: number | null, fmt: FormatContext) => formatValue(v, "currency", fmt);
const roasOf = (w: PerfWindow) => safeDiv(w.conversionValue, w.cost);
const cpaOf = (w: PerfWindow) => safeDiv(w.cost, w.conversions);
const ctrOf = (w: PerfWindow) => safeDiv(w.clicks, w.impressions);
const cvrOf = (w: PerfWindow) => safeDiv(w.conversions, w.clicks);
const cpcOf = (w: PerfWindow) => safeDiv(w.cost, w.clicks);

/** Confiança em função da amostra (nº de conversões/cliques no menor dos períodos). */
export function confidenceFromSample(n: number, high = 30, medium = 10): "HIGH" | "MEDIUM" | "LOW" {
  return n >= high ? "HIGH" : n >= medium ? "MEDIUM" : "LOW";
}

export function ruleCpaIncrease(i: RuleInput): RecommendationDraft[] {
  const out: RecommendationDraft[] = [];
  for (const c of i.campaigns) {
    const cc = c.cur.conversions ?? 0;
    const pc = c.prev.conversions ?? 0;
    if (pc < 5 || cc < 3 || c.cur.cost < 50) continue;
    const d = delta(cpaOf(c.cur), cpaOf(c.prev));
    if (d.pct === null || d.pct < 0.25) continue;
    const cvr = delta(cvrOf(c.cur), cvrOf(c.prev));
    const cpc = delta(cpcOf(c.cur), cpcOf(c.prev));
    const driver =
      Math.abs(cvr.pct ?? 0) > Math.abs(cpc.pct ?? 0)
        ? `a taxa de conversão variou ${pct(cvr.pct, i.fmt)} e o CPC ${pct(cpc.pct, i.fmt)}`
        : `o CPC variou ${pct(cpc.pct, i.fmt)} e a taxa de conversão ${pct(cvr.pct, i.fmt)}`;
    out.push({
      fingerprint: `cpa_increase:${c.id}`,
      type: "CPA_INCREASE",
      source: "RULE",
      platform: c.platform,
      entityLevel: "CAMPAIGN",
      entityId: c.id,
      entityName: c.name,
      title: `Custo por conversão subiu ${pct(d.pct, i.fmt)} em “${c.name}”`,
      explanation: `O CPA passou de ${money(d.previous, i.fmt)} para ${money(d.current, i.fmt)} (${i.windowLabel}). Decomposição matemática (CPA = CPC ÷ taxa de conversão): ${driver}. Esta decomposição descreve a variação, não estabelece a causa.`,
      suggestedAction:
        "Rever termos de pesquisa/públicos recentes, alterações na landing page e no acompanhamento de conversões; considerar ajustar licitações ou objetivo de CPA.",
      priority: d.pct >= 0.5 ? 1 : 2,
      confidence: confidenceFromSample(Math.min(cc, pc), 30, 10),
      impactEstimate: `Se o CPA regressar ao nível anterior, as mesmas ${Math.round(cc)} conversões custariam cerca de ${money((d.previous ?? 0) * cc, i.fmt)} (vs ${money(c.cur.cost, i.fmt)}).`,
      evidence: { cpaCur: d.current, cpaPrev: d.previous, cpaDeltaPct: d.pct, cvrDeltaPct: cvr.pct, cpcDeltaPct: cpc.pct, conversionsCur: cc, conversionsPrev: pc },
    });
  }
  return out;
}

export function ruleLowCtrAds(i: RuleInput): RecommendationDraft[] {
  const out: RecommendationDraft[] = [];
  // Chave com plataforma: campanhas Google e Meta homónimas não se misturam.
  const byCampaign = new Map<string, EntityPerf[]>();
  for (const a of i.ads) {
    const k = `${a.platform}|${a.campaignName ?? ""}`;
    byCampaign.set(k, [...(byCampaign.get(k) ?? []), a]);
  }
  for (const [, ads] of byCampaign) {
    const tot = ads.reduce((s, a) => ({ c: s.c + a.cur.clicks, i: s.i + a.cur.impressions }), { c: 0, i: 0 });
    const campCtr = safeDiv(tot.c, tot.i);
    for (const a of ads) {
      if (a.cur.impressions < 2000 || ads.length < 2) continue;
      const adCtr = ctrOf(a.cur);
      const target = i.goals.ctrMin ?? (campCtr === null ? null : campCtr * 0.6);
      if (adCtr === null || target === null || adCtr >= target) continue;
      out.push({
        fingerprint: `low_ctr:${a.id}`,
        type: "LOW_CTR_AD",
        source: "RULE",
        platform: a.platform,
        entityLevel: "AD",
        entityId: a.id,
        entityName: a.name,
        title: `Anúncio “${a.name}” com CTR abaixo da referência`,
        explanation: `CTR de ${pct(adCtr, i.fmt)} com ${formatValue(a.cur.impressions, "number", i.fmt)} impressões, face a uma referência de ${pct(target, i.fmt)} (${i.goals.ctrMin ? "objetivo definido" : "60% do CTR médio da campanha"}).`,
        suggestedAction: "Testar nova mensagem/criativo ou redistribuir impressões para variantes com melhor CTR.",
        priority: 3,
        confidence: confidenceFromSample(a.cur.clicks, 100, 30),
        impactEstimate: null,
        evidence: { ctr: adCtr, reference: target, impressions: a.cur.impressions, campaignCtr: campCtr },
      });
    }
  }
  return out;
}

export function ruleScaleBudget(i: RuleInput): RecommendationDraft[] {
  const out: RecommendationDraft[] = [];
  const all = i.campaigns.reduce((s, c) => ({ v: s.v + (c.cur.conversionValue ?? 0), c: s.c + c.cur.cost }), { v: 0, c: 0 });
  const accountRoas = safeDiv(all.v, all.c);
  for (const c of i.campaigns) {
    const lost = c.cur.lostIsBudget ?? null;
    if (lost === null || lost < 0.2 || (c.cur.conversions ?? 0) < 10) continue;
    const r = roasOf(c.cur);
    const cpa = cpaOf(c.cur);
    const roasTarget = i.goals.roasMin ?? (accountRoas ? accountRoas * 1.2 : null);
    const goodRoas = r !== null && roasTarget !== null && r >= roasTarget;
    const goodCpa = cpa !== null && (i.goals.cpaMax ?? i.goals.cplMax) !== undefined && cpa <= (i.goals.cpaMax ?? i.goals.cplMax)!;
    if (!goodRoas && !goodCpa) continue;
    const is = c.cur.impressionShare ?? null;
    const extra = is ? Math.round(((c.cur.conversions ?? 0) * (lost / is)) * 0.5) : null;
    out.push({
      fingerprint: `scale_budget:${c.id}`,
      type: "SCALE_BUDGET",
      source: "RULE",
      platform: c.platform,
      entityLevel: "CAMPAIGN",
      entityId: c.id,
      entityName: c.name,
      title: `“${c.name}” tem bom desempenho mas está limitada pelo orçamento`,
      explanation: `${goodRoas ? `ROAS de ${formatValue(r, "multiplier", i.fmt)} (referência ${formatValue(roasTarget, "multiplier", i.fmt)})` : `CPA de ${money(cpa, i.fmt)} dentro do objetivo`} e ${pct(lost, i.fmt)} das impressões elegíveis perdidas por orçamento (${i.windowLabel}).`,
      suggestedAction: `Avaliar aumento gradual do orçamento diário${c.dailyBudget ? ` (atual: ${money(c.dailyBudget, i.fmt)}/dia)` : ""} em 15–20% e monitorizar o CPA marginal.`,
      priority: 1,
      confidence: confidenceFromSample(c.cur.conversions ?? 0, 40, 15),
      impactEstimate: extra
        ? `Estimativa grosseira: até ~${extra} conversões adicionais no mesmo período, assumindo retornos decrescentes de 50%. Não é garantido.`
        : null,
      evidence: { roas: r, roasTarget, cpa, lostIsBudget: lost, impressionShare: is },
    });
  }
  return out;
}

export function ruleReallocate(i: RuleInput): RecommendationDraft[] {
  const target = i.goals.roasMin;
  if (!target) return [];
  const donors = i.campaigns.filter((c) => c.cur.cost > 200 && (roasOf(c.cur) ?? Infinity) < target * 0.6 && (c.dailyBudget ?? 0) > 0);
  const receivers = i.campaigns.filter((c) => (roasOf(c.cur) ?? 0) >= target && (c.cur.lostIsBudget ?? 0) >= 0.15);
  if (!donors.length || !receivers.length) return [];
  const d = donors.sort((a, b) => (roasOf(a.cur) ?? 0) - (roasOf(b.cur) ?? 0))[0];
  const r = receivers.sort((a, b) => (roasOf(b.cur) ?? 0) - (roasOf(a.cur) ?? 0))[0];
  const move = Math.round((d.dailyBudget ?? 0) * 0.2 * 100) / 100;
  return [
    {
      fingerprint: `reallocate:${d.id}:${r.id}`,
      type: "BUDGET_REALLOCATION",
      source: "RULE",
      platform: null,
      entityLevel: "CAMPAIGN",
      entityId: d.id,
      entityName: `${d.name} → ${r.name}`,
      title: `Proposta: transferir ${money(move, i.fmt)}/dia de “${d.name}” para “${r.name}”`,
      explanation: `“${d.name}” tem ROAS ${formatValue(roasOf(d.cur), "multiplier", i.fmt)} (abaixo de 60% do mínimo ${formatValue(target, "multiplier", i.fmt)}); “${r.name}” tem ROAS ${formatValue(roasOf(r.cur), "multiplier", i.fmt)} e perde ${pct(r.cur.lostIsBudget ?? null, i.fmt)} das impressões por orçamento. Atribuição e papel de cada campanha no funil (ex.: remarketing vs. prospeção) devem ser considerados.`,
      suggestedAction: "Preparar a redistribuição em Gestão → Distribuição: cada alteração de orçamento é proposta individualmente e só é aplicada depois de confirmada.",
      priority: 2,
      confidence: confidenceFromSample(Math.min(d.cur.conversions ?? 0, r.cur.conversions ?? 0), 30, 8),
      impactEstimate: null,
      evidence: { donorRoas: roasOf(d.cur), receiverRoas: roasOf(r.cur), moveDaily: move, roasMin: target },
    },
  ];
}

export function ruleLandingLowConversion(i: RuleInput): RecommendationDraft[] {
  if (i.siteKeyEventRate === null) return [];
  return i.landingPages
    .filter((p) => p.sessions >= 300 && p.keyEvents !== null)
    .filter((p) => (safeDiv(p.keyEvents, p.sessions) ?? 0) < i.siteKeyEventRate! * 0.4)
    .map((p) => {
      const rate = safeDiv(p.keyEvents, p.sessions);
      return {
        fingerprint: `landing_low_cv:${p.key}`,
        type: "LANDING_LOW_CONVERSION",
        source: "RULE" as const,
        platform: "GA4" as Platform,
        entityLevel: "PAGE",
        entityId: p.key,
        entityName: p.key,
        title: `Página com tráfego relevante mas baixa conversão`,
        explanation: `${p.key} recebeu ${formatValue(p.sessions, "number", i.fmt)} sessões com taxa de eventos-chave de ${pct(rate, i.fmt)}, face a ${pct(i.siteKeyEventRate, i.fmt)} no site (${i.windowLabel}). Páginas informativas (ex.: blog) têm naturalmente taxas mais baixas.`,
        suggestedAction: "Rever intenção da página, chamadas à ação, velocidade e formulário; considerar ligações internas para páginas de conversão.",
        priority: 2 as const,
        confidence: confidenceFromSample(p.sessions, 2000, 500),
        impactEstimate: null,
        evidence: { sessions: p.sessions, keyEvents: p.keyEvents, rate, siteRate: i.siteKeyEventRate },
      };
    });
}

export function ruleQueryLowCtr(i: RuleInput): RecommendationDraft[] {
  return i.queries
    .filter((q) => q.cur.impressions >= 1000 && q.cur.position !== null && q.cur.position <= 10)
    .filter((q) => (safeDiv(q.cur.clicks, q.cur.impressions) ?? 0) < expectedOrganicCtr(q.cur.position!) * 0.5)
    .slice(0, 10)
    .map((q) => {
      const ctr = safeDiv(q.cur.clicks, q.cur.impressions);
      const exp = expectedOrganicCtr(q.cur.position!);
      return {
        fingerprint: `query_low_ctr:${q.key}`,
        type: "QUERY_LOW_CTR",
        source: "RULE" as const,
        platform: "SEARCH_CONSOLE" as Platform,
        entityLevel: "QUERY",
        entityId: q.key,
        entityName: q.key,
        title: `Consulta “${q.key}”: muitas impressões e CTR reduzido`,
        explanation: `${formatValue(q.cur.impressions, "number", i.fmt)} impressões na posição média ${formatValue(q.cur.position, "position", i.fmt)} com CTR de ${pct(ctr, i.fmt)}, abaixo de uma referência indicativa de ${pct(exp, i.fmt)} para esta posição. A referência é uma curva genérica; resultados enriquecidos e anúncios afetam o CTR.`,
        suggestedAction: "Sugestão: testar título e meta description mais alinhados com a intenção da consulta. Não há garantia de melhoria.",
        priority: 2 as const,
        confidence: confidenceFromSample(q.cur.impressions, 5000, 1500),
        impactEstimate: `Se o CTR atingir ${pct(exp * 0.75, i.fmt)}: ~${Math.round(q.cur.impressions * exp * 0.75 - q.cur.clicks)} cliques adicionais no período (estimativa).`,
        evidence: { ...q.cur, ctr, expectedCtr: exp },
      };
    });
}

export function rulePageDecline(i: RuleInput): RecommendationDraft[] {
  return i.pages
    .filter((p) => p.prevClicks >= 100 && p.curClicks < p.prevClicks * 0.7)
    .map((p) => {
      const d = delta(p.curClicks, p.prevClicks);
      return {
        fingerprint: `page_decline:${p.key}`,
        type: "PAGE_TRAFFIC_DECLINE",
        source: "RULE" as const,
        platform: "SEARCH_CONSOLE" as Platform,
        entityLevel: "PAGE",
        entityId: p.key,
        entityName: p.key,
        title: `Página a perder tráfego orgânico (${pct(d.pct, i.fmt)})`,
        explanation: `${p.key} passou de ${p.prevClicks} para ${p.curClicks} cliques orgânicos (${i.windowLabel}). Pode refletir sazonalidade, alterações de posição ou de SERP.`,
        suggestedAction: "Verificar consultas que perderam posição nesta página, atualizar conteúdo e confirmar indexação no Search Console.",
        priority: (d.pct ?? 0) <= -0.5 ? (1 as const) : (2 as const),
        confidence: confidenceFromSample(p.prevClicks, 500, 150),
        impactEstimate: null,
        evidence: { curClicks: p.curClicks, prevClicks: p.prevClicks, deltaPct: d.pct },
      };
    });
}

export function ruleCreativeFatigue(i: RuleInput): RecommendationDraft[] {
  return i.ads
    .filter((a) => a.platform === "META_ADS" && a.cur.impressions >= 5000 && a.cur.reach && a.prev.reach)
    .filter((a) => {
      const f = delta(safeDiv(a.cur.impressions, a.cur.reach ?? null), safeDiv(a.prev.impressions, a.prev.reach ?? null));
      const c = delta(ctrOf(a.cur), ctrOf(a.prev));
      return (f.pct ?? 0) > 0.08 && (c.pct ?? 0) < -0.15;
    })
    .map((a) => {
      const f = delta(safeDiv(a.cur.impressions, a.cur.reach ?? null), safeDiv(a.prev.impressions, a.prev.reach ?? null));
      const c = delta(ctrOf(a.cur), ctrOf(a.prev));
      return {
        fingerprint: `fatigue:${a.id}`,
        type: "CREATIVE_FATIGUE",
        source: "RULE" as const,
        platform: a.platform,
        entityLevel: "AD",
        entityId: a.id,
        entityName: a.name,
        title: `Possível fadiga do criativo “${a.name}”`,
        explanation: `A frequência média subiu ${pct(f.pct, i.fmt)} e o CTR caiu ${pct(c.pct, i.fmt)} (${i.windowLabel}). O padrão é compatível com fadiga, mas pode também resultar de alterações de público ou leilão.`,
        suggestedAction: "Preparar variações do criativo (novo gancho, formato ou imagem) e alargar o público.",
        priority: 2 as const,
        confidence: confidenceFromSample(a.cur.clicks, 200, 60),
        impactEstimate: null,
        evidence: { frequencyCur: f.current, frequencyPrev: f.previous, ctrCur: c.current, ctrPrev: c.previous },
      };
    });
}

export function ruleBudgetOverrun(i: RuleInput): RecommendationDraft[] {
  return i.pacing
    .filter((p) => p.remainingDays > 0 && p.projection > p.amount * 1.05)
    .map((p) => ({
      fingerprint: `budget_overrun:${p.scope}`,
      type: "BUDGET_OVERRUN",
      source: "STATISTICAL" as const,
      platform: p.platform,
      entityLevel: "BUDGET",
      entityId: p.scope,
      entityName: p.scope,
      title: `Orçamento “${p.scope}” projetado acima do definido`,
      explanation: `Investido ${money(p.spent, i.fmt)} de ${money(p.amount, i.fmt)}. Ao ritmo dos últimos 7 dias, a projeção linear é ${money(p.projection, i.fmt)} até ao fim do período (${p.remainingDays} dias restantes).`,
      suggestedAction: "Reduzir orçamentos diários das campanhas com pior eficiência ou confirmar com o cliente o reforço do orçamento.",
      priority: p.projection > p.amount * 1.2 ? (1 as const) : (2 as const),
      confidence: "MEDIUM" as const,
      impactEstimate: `Excesso projetado: ${money(p.projection - p.amount, i.fmt)}.`,
      evidence: p,
    }));
}

export function ruleChannelEfficiency(i: RuleInput): RecommendationDraft[] {
  const sum = (p: Platform) =>
    i.campaigns.filter((c) => c.platform === p).reduce((s, c) => ({ cost: s.cost + c.cur.cost, conv: s.conv + (c.cur.conversions ?? 0) }), { cost: 0, conv: 0 });
  const g = sum("GOOGLE_ADS");
  const m = sum("META_ADS");
  if (g.conv < 10 || m.conv < 10) return [];
  const cg = safeDiv(g.cost, g.conv)!;
  const cm = safeDiv(m.cost, m.conv)!;
  const better = cg <= cm * 0.7 ? "Google Ads" : cm <= cg * 0.7 ? "Meta Ads" : null;
  if (!better) return [];
  return [
    {
      fingerprint: `channel_efficiency:${better}`,
      type: "CHANNEL_EFFICIENCY",
      source: "RULE",
      platform: better === "Google Ads" ? "GOOGLE_ADS" : "META_ADS",
      entityLevel: "CHANNEL",
      entityId: better,
      entityName: better,
      title: `${better} apresenta custo por conversão inferior (${i.windowLabel})`,
      explanation: `CPA Google Ads: ${money(cg, i.fmt)} · CPA Meta Ads: ${money(cm, i.fmt)}. Cada plataforma usa a sua própria atribuição (ex.: Meta inclui conversões pós-visualização), pelo que a comparação é indicativa.`,
      suggestedAction: "Validar com dados do GA4/CRM antes de redistribuir investimento entre canais.",
      priority: 3,
      confidence: "LOW",
      impactEstimate: null,
      evidence: { cpaGoogle: cg, cpaMeta: cm, convGoogle: g.conv, convMeta: m.conv },
    },
  ];
}

export function ruleQueryNearTop(i: RuleInput): RecommendationDraft[] {
  return i.queries
    .filter((q) => q.cur.position !== null && q.cur.position > 8 && q.cur.position <= 20 && q.cur.impressions >= 800)
    .sort((a, b) => b.cur.impressions - a.cur.impressions)
    .slice(0, 5)
    .map((q) => ({
      fingerprint: `near_top:${q.key}`,
      type: "QUERY_NEAR_TOP",
      source: "RULE" as const,
      platform: "SEARCH_CONSOLE" as Platform,
      entityLevel: "QUERY",
      entityId: q.key,
      entityName: q.key,
      title: `“${q.key}” perto do topo (posição ${formatValue(q.cur.position, "position", i.fmt)})`,
      explanation: `${formatValue(q.cur.impressions, "number", i.fmt)} impressões em posição média ${formatValue(q.cur.position, "position", i.fmt)}. Consultas entre as posições 8 e 20 costumam ser candidatas a otimização de conteúdo.`,
      suggestedAction: "Reforçar o conteúdo da página associada, ligações internas e correspondência com a intenção de pesquisa.",
      priority: 3 as const,
      confidence: confidenceFromSample(q.cur.impressions, 5000, 1500),
      impactEstimate: null,
      evidence: q.cur,
    }));
}

export const ALL_RULES = [
  ruleCpaIncrease,
  ruleLowCtrAds,
  ruleScaleBudget,
  ruleReallocate,
  ruleLandingLowConversion,
  ruleQueryLowCtr,
  rulePageDecline,
  ruleCreativeFatigue,
  ruleBudgetOverrun,
  ruleChannelEfficiency,
  ruleQueryNearTop,
];

export function runRules(i: RuleInput): RecommendationDraft[] {
  return ALL_RULES.flatMap((r) => r(i));
}
