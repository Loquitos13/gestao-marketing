import type { ReportData } from "./build";
import type { Table } from "./csv";

/** Tabelas exportáveis de um relatório (CSV/Excel). Valores numéricos sem formatação. */
export function reportTables(d: ReportData): Table[] {
  const tables: Table[] = [];
  tables.push({
    name: "KPIs",
    headers: ["Métrica", "Atual", "Último relatório", "Variação absoluta", "Variação %", "Qualidade", "Origem", "Fonte"],
    rows: [...d.kpis.paid, ...d.kpis.seo, ...d.kpis.web].map((k) => [k.label, k.delta.current, k.delta.previous, k.delta.abs, k.delta.pct, k.quality, k.origin, k.source]),
  });
  tables.push({
    name: "Canais",
    headers: ["Canal", "Investimento", "Impressões", "Cliques", "Conversões", "Receita atribuída", "CPA", "ROAS", "Nota metodológica"],
    rows: d.channels.map((c) => [c.label, c.cost, c.impressions, c.clicks, c.conversions, c.value, c.cpa, c.roas, c.note]),
  });
  const ent = (name: string, rows: ReportData["topCampaigns"]): Table => ({
    name,
    headers: ["ID", "Nome", "Plataforma", "Campanha", "Impressões", "Cliques", "CTR", "CPC", "Investimento", "Conversões", "CPA", "Receita", "ROAS", "Δ investimento %", "Δ conversões %"],
    rows: rows.map((r) => [r.id, r.name, r.platform, r.campaignName ?? "", r.impressions, r.clicks, r.ctr, r.cpc, r.cost, r.conversions, r.cpa, r.conversionValue, r.roas, r.costDeltaPct, r.conversionsDeltaPct]),
  });
  for (const p of d.platformMetrics ?? []) {
    tables.push({
      name: `${p.label} — métricas`,
      headers: ["Grupo", "Métrica", "Atual", "Último relatório", "Variação absoluta", "Variação %", "Unidade", "Fonte / fórmula", "Nota"],
      rows: p.groups.flatMap((g) => g.rows.map((r) => [g.label, r.label, r.current, r.previous, r.abs, r.pct, r.unit, r.source, r.note ?? ""])),
    });
    tables.push({
      name: `${p.label} — campanhas`,
      headers: ["ID", "Campanha", "Estado", "Tipo", "Investimento", "Impressões", "Cliques", "CTR", "CPC", "CPM", "Conversões", "CPA", "Receita", "ROAS", "Leads", "Alcance", "Frequência", "Cliques no link", "Parcela impr.", "Perdida (orç.)", "Perdida (class.)", "Δ investimento %", "Δ conversões %", "Δ CPA %"],
      rows: p.campaigns.map((c) => [c.id, c.name, c.status, c.type ?? c.objective ?? "", c.cost, c.impressions, c.clicks, c.ctr, c.cpc, c.cpm, c.conversions, c.cpa, c.conversionValue, c.roas, c.leads, c.reach, c.frequency, c.linkClicks, c.searchImpressionShare, c.searchLostIsBudget, c.searchLostIsRank, c.costDeltaPct, c.conversionsDeltaPct, c.cpaDeltaPct]),
    });
  }
  if (d.topContent) {
    const t = d.topContent;
    tables.push(
      { name: "Top 10 anúncios", headers: ["Posição", "Anúncio", "Plataforma", "Campanha", "Título / texto", "Impressões", "Cliques", "CTR", "Conversões", "CPA", "Investimento", "ROAS"], rows: t.ads.map((a) => [a.rank, a.name, a.platform, a.campaign ?? "", a.headline ?? "", a.impressions, a.clicks, a.ctr, a.conversions, a.cpa, a.cost, a.roas]) },
      { name: "Top 10 publicações", headers: ["Posição", "Publicação", "Plataforma", "Tipo", "Publicado em", "URL", "Impressões", "Alcance", "Interações", "Taxa de interação", "Cliques no link"], rows: t.posts.map((p) => [p.rank, p.title, p.platform, p.type ?? "", p.publishedAt ?? "", p.url ?? "", p.impressions, p.reach, p.engagements, p.engagementRate, p.linkClicks]) },
      { name: "Top 10 páginas", headers: ["Posição", "Página", "Cliques", "Impressões", "CTR", "Posição média", "Δ cliques %"], rows: t.pages.map((p) => [p.rank, p.url, p.clicks, p.impressions, p.ctr, p.position, p.clicksDeltaPct]) },
    );
  }
  tables.push(ent("Melhores campanhas", d.topCampaigns), ent("Piores campanhas", d.bottomCampaigns), ent("Melhores anúncios", d.topAds), ent("Anúncios a rever", d.bottomAds));
  if (d.seo) {
    const s = (name: string, rows: NonNullable<ReportData["seo"]>["topQueries"]): Table => ({
      name,
      headers: ["Chave", "Cliques", "Impressões", "CTR", "Posição média", "Δ cliques %"],
      rows: rows.map((r) => [r.key, r.clicks, r.impressions, r.ctr, r.position, r.clicksDeltaPct]),
    });
    tables.push(s("Consultas", d.seo.topQueries), s("Páginas", d.seo.topPages));
  }
  tables.push({ name: "Objetivos", headers: ["Objetivo", "Meta", "Resultado", "Cumprido"], rows: d.goals.map((g) => [g.label, g.target, g.actual, g.achieved]) });
  tables.push({
    name: "Recomendações",
    headers: ["Prioridade", "Título", "Explicação", "Ação sugerida", "Confiança", "Tipo", "Estado"],
    rows: d.recommendations.map((r) => [r.priority, r.title, r.explanation, r.action, r.confidence, r.source, r.status]),
  });
  tables.push({ name: "Série temporal", headers: ["Data", "Investimento", "Conversões", "Receita atribuída"], rows: d.spendSeries.map((s) => [s.date, s.cost, s.conversions, s.value]) });
  return tables;
}
