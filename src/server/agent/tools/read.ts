import type { Platform } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { addDays } from "@/lib/dates";
import { queryPaid, type PaidResultRow } from "@/server/queries/paid";
import { analysisWindow, loadManagedCampaigns } from "@/server/queries/manage";
import { loadBudgets } from "@/server/queries/budget";
import { searchByKey, searchTotals } from "@/server/queries/seo";
import { forecastFromParams, type ForecastParams } from "../train";
import { whatIf, type ResponseCurve } from "../ml/response-curve";
import { defineTool, daysParam, DAYS, n, pct, untrusted, type AgentCtx } from "./common";

// O modelo pede períodos como 28 ou 60 dias: aceita-se qualquer valor e ajusta-se à janela suportada mais próxima.
const days = z.coerce.number().int().min(1).max(365).default(30).transform((d) => DAYS.reduce((best, x) => (Math.abs(x - d) < Math.abs(best - d) ? x : best)));
const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
/** O modelo passa muitas vezes o nome em vez do id interno: aceitam-se ambos. */
function findCampaign<T extends { id: string; name: string }>(campaigns: T[], key: string): T | undefined {
  return campaigns.find((c) => c.id === key) ?? campaigns.find((c) => normalize(c.name) === normalize(key)) ?? campaigns.find((c) => normalize(c.name).includes(normalize(key)));
}
const platformArg = z.enum(["GOOGLE_ADS", "META_ADS"]).optional();
const PLATFORM_LABEL: Record<string, string> = { GOOGLE_ADS: "Google Ads", META_ADS: "Meta Ads" };

function windows(ctx: AgentCtx, d: number) {
  const cur = analysisWindow(ctx.cctx, d);
  return { cur, prev: { start: addDays(cur.start, -d), end: addDays(cur.start, -1) } };
}

function metrics(r: PaidResultRow | undefined) {
  if (!r) return null;
  return {
    investimento: n(r.totals.cost),
    impressoes: r.totals.impressions,
    cliques: r.totals.clicks,
    conversoes: n(r.totals.conversions),
    valor_conversao: n(r.totals.conversionValue),
    ctr_pct: n(r.derived.ctr === null ? null : r.derived.ctr * 100),
    cpc: n(r.derived.cpc),
    cpa: n(r.derived.cpa),
    roas: n(r.derived.roas),
  };
}

function paidPlatforms(ctx: AgentCtx, p?: Platform): Platform[] {
  const all = (["GOOGLE_ADS", "META_ADS"] as Platform[]).filter((x) => ctx.cctx.has[x]);
  return p ? all.filter((x) => x === p) : all;
}

export const getKpis = defineTool({
  name: "get_kpis",
  label: (a) => `KPIs pagos, ${a.days} dias`,
  description: "KPIs das campanhas pagas (investimento, conversões, CPA, ROAS, CTR) por plataforma e no total. variacao_pct compara com os `days` dias imediatamente anteriores ao período devolvido.",
  parameters: { type: "object", properties: { days: daysParam } },
  schema: z.object({ days }),
  kind: "read",
  async run(ctx, a) {
    const { cur, prev } = windows(ctx, a.days);
    const platforms = paidPlatforms(ctx);
    if (!platforms.length) return { sem_dados: "O cliente não tem fontes Google Ads ou Meta Ads." };
    const q = (w: { start: string; end: string }, groupBy: "platform" | "total") => queryPaid({ clientId: ctx.client.id, clientCurrency: ctx.client.currency, platforms, start: w.start, end: w.end, groupBy });
    const [c, p, ct, pt] = await Promise.all([q(cur, "platform"), q(prev, "platform"), q(cur, "total"), q(prev, "total")]);
    const row = (now: PaidResultRow | undefined, before: PaidResultRow | undefined) => {
      const m = metrics(now);
      const b = metrics(before);
      return m && { ...m, variacao_pct: { investimento: pct(m.investimento, b?.investimento ?? null), conversoes: pct(m.conversoes, b?.conversoes ?? null), cpa: pct(m.cpa, b?.cpa ?? null), roas: pct(m.roas, b?.roas ?? null) } };
    };
    return {
      periodo: cur,
      moeda: ctx.client.currency,
      total: row(ct.rows[0], pt.rows[0]),
      por_plataforma: Object.fromEntries(platforms.map((pl) => [PLATFORM_LABEL[pl], row(c.rows.find((r) => r.key === pl), p.rows.find((r) => r.key === pl))])),
      avisos: [...c.warnings, ctx.cctx.completenessWarning(platforms, cur.end)].filter(Boolean),
    };
  },
});

export const getCampaigns = defineTool({
  name: "get_campaigns",
  label: (a) => `campanhas ${a.platform ? PLATFORM_LABEL[a.platform] : "Google e Meta"}, 14 dias`,
  description: "Campanhas com estado, orçamento diário, se o orçamento é editável e desempenho dos últimos 14 dias. Devolve o id interno de cada campanha (use-o em propose_ad_change). Para alterar um conjunto/grupo ou propor palavras-chave peça incluirGrupos=true, que devolve os ids dos conjuntos/grupos.",
  parameters: { type: "object", properties: { platform: { type: "string", enum: ["GOOGLE_ADS", "META_ADS"] }, incluirGrupos: { type: "boolean", description: "Incluir os conjuntos/grupos de cada campanha com os seus ids. Por omissão false." } } },
  schema: z.object({ platform: platformArg, incluirGrupos: z.coerce.boolean().default(false) }),
  kind: "read",
  async run(ctx, a) {
    const { campaigns, window } = await loadManagedCampaigns(ctx.client, ctx.cctx);
    const list = campaigns
      .filter((c) => !a.platform || c.platform === a.platform)
      .sort((x, y) => (y.perf?.cost ?? 0) - (x.perf?.cost ?? 0))
      .slice(0, 25)
      .map((c) => ({
        id: c.id,
        nome: untrusted(c.name),
        plataforma: PLATFORM_LABEL[c.platform],
        estado: c.status,
        orcamento_diario: n(c.dailyBudget),
        orcamento_bloqueado: c.budgetBlock,
        investimento: n(c.perf?.cost),
        conversoes: n(c.perf?.conversions),
        cpa: n(c.perf?.cpa),
        roas: n(c.perf?.roas),
        ctr_pct: n(c.perf?.ctr === null || c.perf?.ctr === undefined ? null : c.perf.ctr * 100),
        perda_impr_orcamento_pct: n(c.perf?.lostBudget === null || c.perf?.lostBudget === undefined ? null : c.perf.lostBudget * 100),
        grupos: a.incluirGrupos ? c.groups.slice(0, 10).map((g) => ({ id: g.id, nome: untrusted(g.name), estado: g.status, orcamento_diario: n(g.dailyBudget), anuncios: g.ads.length })) : undefined,
      }));
    return { periodo: window, moeda: ctx.client.currency, campanhas: list };
  },
});

export const getAds = defineTool({
  name: "get_ads",
  label: () => "anúncios de uma campanha",
  description: "Anúncios de uma campanha (id interno de get_campaigns ou nome exato da campanha) com textos e desempenho de 14 dias.",
  parameters: { type: "object", properties: { campaignId: { type: "string", description: "id interno ou nome da campanha" } }, required: ["campaignId"] },
  schema: z.object({ campaignId: z.string().min(1).max(120) }),
  kind: "read",
  async run(ctx, a) {
    const { campaigns } = await loadManagedCampaigns(ctx.client, ctx.cctx);
    const c = findCampaign(campaigns, a.campaignId);
    if (!c) return { erro: "Campanha não encontrada neste cliente." };
    const ids = c.groups.flatMap((g) => g.ads.map((ad) => ad.id));
    const texts = await prisma.ad.findMany({ where: { id: { in: ids } }, select: { id: true, headlines: true, descriptions: true, finalUrl: true } });
    const tx = new Map(texts.map((t) => [t.id, t]));
    return {
      campanha: untrusted(c.name),
      anuncios: c.groups.flatMap((g) =>
        g.ads.map((ad) => ({
          id: ad.id,
          grupo_id: g.id,
          nome: untrusted(ad.name),
          estado: ad.status,
          titulos: (tx.get(ad.id)?.headlines ?? []).slice(0, 15).map((h) => untrusted(h, 40)),
          descricoes: (tx.get(ad.id)?.descriptions ?? []).slice(0, 4).map((d) => untrusted(d, 100)),
          investimento: n(ad.perf?.cost),
          ctr_pct: n(ad.perf?.ctr === null || ad.perf?.ctr === undefined ? null : ad.perf.ctr * 100),
          conversoes: n(ad.perf?.conversions),
          cpa: n(ad.perf?.cpa),
          frequencia: n(ad.perf?.frequency),
        })),
      ),
    };
  },
});

export const getBudgetPacing = defineTool({
  name: "get_budget_pacing",
  label: () => "orçamentos e ritmo de gasto",
  description: "Orçamentos definidos (mensais, por plataforma ou campanha), gasto até agora e previsão de gasto no fim do período.",
  parameters: { type: "object", properties: {} },
  schema: z.object({}),
  kind: "read",
  async run(ctx) {
    const { asOf, budgets } = await loadBudgets(ctx.cctx);
    return {
      dados_ate: asOf,
      moeda: ctx.client.currency,
      orcamento_mensal_cliente: n(ctx.client.monthlyBudget === null ? null : Number(ctx.client.monthlyBudget)),
      orcamentos: budgets
        .filter((b) => b.periodEnd >= asOf)
        .slice(0, 12)
        .map((b) => ({ ambito: untrusted(b.scope), inicio: b.periodStart, fim: b.periodEnd, valor: n(b.pacing.amount), gasto: n(b.pacing.spent), restante: n(b.pacing.remaining), dias_restantes: b.pacing.remainingDays, media_diaria: n(b.pacing.avgDaily), diario_necessario: n(b.pacing.requiredDaily), previsao_fim: n(b.pacing.projection), desvio_previsto_pct: n(b.pacing.projectedVariancePct === null ? null : b.pacing.projectedVariancePct * 100), estado: b.pacing.status })),
    };
  },
});

export const getSeo = defineTool({
  name: "get_seo",
  label: (a) => `Search Console, ${a.days} dias`,
  description: "Pesquisa orgânica (Google Search Console): cliques, impressões, CTR, posição média e principais consultas e páginas, com o período anterior.",
  parameters: { type: "object", properties: { days: daysParam } },
  schema: z.object({ days }),
  kind: "read",
  async run(ctx, a) {
    if (!ctx.cctx.has.SEARCH_CONSOLE) return { sem_dados: "O cliente não tem o Search Console ligado." };
    const { cur, prev } = windows(ctx, a.days);
    const [t, tp, queries, pages] = await Promise.all([searchTotals(ctx.client.id, cur.start, cur.end), searchTotals(ctx.client.id, prev.start, prev.end), searchByKey(ctx.client.id, "QUERY", cur, prev, 10), searchByKey(ctx.client.id, "PAGE", cur, prev, 8)]);
    const row = (k: (typeof queries)[number]) => ({ chave: untrusted(k.key, 120), cliques: k.current.clicks, impressoes: k.current.impressions, ctr_pct: n(k.current.ctr === null ? null : k.current.ctr * 100), posicao: n(k.current.position, 1), cliques_antes: k.previous.clicks });
    return {
      periodo: cur,
      total: { cliques: t.clicks, impressoes: t.impressions, ctr_pct: n(t.ctr === null ? null : t.ctr * 100), posicao: n(t.position, 1), variacao_cliques_pct: pct(t.clicks, tp.clicks) },
      consultas: queries.map(row),
      paginas: pages.map(row),
    };
  },
});

export const getForecast = defineTool({
  name: "get_forecast",
  label: (a) => `previsão ${a.scope}`,
  description: "Previsão diária (modelo Holt-Winters treinado nos dados do cliente) com intervalo de 95% e erro de backtest. scope: ALL:cost, ALL:conversions, ALL:conversionValue, GOOGLE_ADS:cost, GOOGLE_ADS:conversions, META_ADS:cost, META_ADS:conversions.",
  parameters: { type: "object", properties: { scope: { type: "string" }, days: { type: "integer", description: "1 a 30" } }, required: ["scope"] },
  schema: z.object({ scope: z.string().regex(/^(ALL|GOOGLE_ADS|META_ADS):(cost|conversions|conversionValue)$/), days: z.number().int().min(1).max(30).default(14) }),
  kind: "read",
  async run(ctx, a) {
    const m = await prisma.agentModel.findUnique({ where: { clientId_kind_scope: { clientId: ctx.client.id, kind: "FORECAST", scope: a.scope } } });
    if (!m) return { sem_modelo: "Ainda não há modelo treinado para esta série (dados insuficientes ou treino por correr)." };
    const pts = forecastFromParams(m.params as unknown as ForecastParams, a.days);
    const total = pts.reduce((s, p) => s + p.value, 0);
    const metrics = m.metrics as { wape: number | null };
    return {
      serie: m.label,
      fiavel: m.reliable,
      erro_backtest_pct: n(metrics.wape === null ? null : metrics.wape * 100),
      treinado_em: m.trainedAt.toISOString().slice(0, 10),
      total_previsto: n(total),
      dias: pts.map((p) => ({ data: p.date, valor: n(p.value), min: n(p.lower), max: n(p.upper) })),
    };
  },
});

export const getResponseCurve = defineTool({
  name: "get_response_curve",
  label: () => "curva de resposta ao orçamento",
  description: "Estimativa de quantas conversões uma campanha ganha ou perde se o investimento mudar X% (curva de rendimento decrescente ajustada aos dados semanais).",
  parameters: { type: "object", properties: { campaignId: { type: "string", description: "id interno ou nome da campanha" }, changePct: { type: "number", description: "Variação do investimento em %, de -50 a 50" } }, required: ["campaignId", "changePct"] },
  schema: z.object({ campaignId: z.string().min(1).max(120), changePct: z.coerce.number().min(-50).max(50) }),
  kind: "read",
  async run(ctx, a) {
    const { campaigns } = await loadManagedCampaigns(ctx.client, ctx.cctx);
    const c0 = findCampaign(campaigns, a.campaignId);
    if (!c0) return { erro: "Campanha não encontrada neste cliente." };
    const m = await prisma.agentModel.findUnique({ where: { clientId_kind_scope: { clientId: ctx.client.id, kind: "RESPONSE_CURVE", scope: `campaign:${c0.id}` } } });
    if (!m) return { sem_modelo: "Sem curva para esta campanha (menos de 3 semanas com investimento e conversões)." };
    const c = m.params as unknown as ResponseCurve & { campaignName: string };
    const w = whatIf(c, c.meanCost, 1 + a.changePct / 100);
    const metrics = m.metrics as { wape: number | null };
    return {
      campanha: untrusted(c.campaignName),
      fiavel: m.reliable,
      erro_backtest_pct: n(metrics.wape === null ? null : metrics.wape * 100),
      elasticidade: n(c.b, 3),
      semanas: c.n,
      investimento_semanal_medio: n(c.meanCost),
      conversoes_semanais_atuais: n(w.conversionsBefore),
      conversoes_semanais_previstas: n(w.conversionsAfter),
      variacao_conversoes_pct: n(w.conversionChangePct === null ? null : w.conversionChangePct * 100),
      cpa_marginal: n(w.marginalCpa),
    };
  },
});

export const getAlertsRecs = defineTool({
  name: "get_alerts_recommendations",
  label: () => "alertas e recomendações abertos",
  description: "Alertas abertos e recomendações pendentes (das regras, da estatística e do agente), incluindo as recusadas recentemente para não as repetir.",
  parameters: { type: "object", properties: {} },
  schema: z.object({}),
  kind: "read",
  async run(ctx) {
    const since = new Date(Date.now() - 60 * 86_400_000);
    const [alerts, recs, dismissed] = await Promise.all([
      prisma.alert.findMany({ where: { clientId: ctx.client.id, status: "OPEN" }, orderBy: { lastSeenAt: "desc" }, take: 15 }),
      prisma.recommendation.findMany({ where: { clientId: ctx.client.id, status: { in: ["NEW", "IN_REVIEW", "APPROVED"] } }, orderBy: [{ priority: "asc" }, { detectedAt: "desc" }], take: 20 }),
      prisma.recommendation.findMany({ where: { clientId: ctx.client.id, status: "DISMISSED", decidedAt: { gte: since } }, orderBy: { decidedAt: "desc" }, take: 10 }),
    ]);
    return {
      alertas: alerts.map((x) => ({ gravidade: x.severity, titulo: x.title, mensagem: x.message.slice(0, 240), desde: x.firstSeenAt.toISOString().slice(0, 10) })),
      recomendacoes: recs.map((r) => ({ tipo: r.type, origem: r.source, titulo: r.title, acao: r.suggestedAction.slice(0, 200), prioridade: r.priority, estado: r.status })),
      recusadas_recentemente: dismissed.map((r) => ({ tipo: r.type, titulo: r.title, nota: r.decisionNote?.slice(0, 160) ?? null })),
    };
  },
});

export const getNotesTasks = defineTool({
  name: "get_notes_tasks",
  label: () => "notas e tarefas do cliente",
  description: "Notas internas fixadas e recentes e tarefas abertas do cliente (contexto da equipa).",
  parameters: { type: "object", properties: {} },
  schema: z.object({}),
  kind: "read",
  async run(ctx) {
    const [notes, tasks] = await Promise.all([
      prisma.clientNote.findMany({ where: { clientId: ctx.client.id }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: 8 }),
      prisma.clientTask.findMany({ where: { clientId: ctx.client.id, status: "OPEN" }, orderBy: [{ priority: "asc" }, { dueDate: "asc" }], take: 10 }),
    ]);
    return {
      objetivos_cliente: untrusted(ctx.client.objectives, 400),
      notas: notes.map((x) => ({ fixada: x.pinned, texto: untrusted(x.body, 300), data: x.createdAt.toISOString().slice(0, 10) })),
      tarefas: tasks.map((t) => ({ titulo: untrusted(t.title), area: t.area, prazo: t.dueDate?.toISOString().slice(0, 10) ?? null, prioridade: t.priority })),
    };
  },
});

export const READ_TOOLS = [getKpis, getCampaigns, getAds, getBudgetPacing, getSeo, getForecast, getResponseCurve, getAlertsRecs, getNotesTasks];
