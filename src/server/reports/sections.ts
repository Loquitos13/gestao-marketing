export const REPORT_SECTIONS = [
  { key: "cover", label: "Capa" },
  { key: "summary", label: "Resumo executivo" },
  { key: "highlights", label: "Principais resultados" },
  { key: "comparison", label: "Evolução face ao último relatório" },
  { key: "goals", label: "Objetivos e cumprimento" },
  { key: "overview", label: "Desempenho global" },
  { key: "google", label: "Resultados Google Ads" },
  { key: "googleMetrics", label: "Google Ads — todas as métricas" },
  { key: "meta", label: "Resultados Meta Ads" },
  { key: "metaMetrics", label: "Meta Ads — todas as métricas" },
  { key: "seo", label: "Resultados SEO" },
  { key: "ads", label: "Análise dos anúncios" },
  { key: "topContent", label: "Top 10 conteúdos com melhores resultados" },
  { key: "creatives", label: "Criativos e conteúdos" },
  { key: "topCampaigns", label: "Campanhas com melhor desempenho" },
  { key: "bottomCampaigns", label: "Campanhas com pior desempenho" },
  { key: "investment", label: "Investimento e eficiência" },
  { key: "conversions", label: "Leads, conversões e receitas" },
  { key: "trends", label: "Evolução dos principais KPIs" },
  { key: "opportunities", label: "Oportunidades identificadas" },
  { key: "problems", label: "Problemas detetados" },
  { key: "recommendations", label: "Recomendações para o período seguinte" },
  { key: "actionPlan", label: "Plano de ação prioritário" },
  { key: "methodology", label: "Metodologia e fontes de dados" },
  { key: "limitations", label: "Limitações e dados indisponíveis" },
] as const;

export type SectionKey = (typeof REPORT_SECTIONS)[number]["key"];
export const ALL_SECTION_KEYS = REPORT_SECTIONS.map((s) => s.key) as SectionKey[];
export const sectionLabel = (k: string) => REPORT_SECTIONS.find((s) => s.key === k)?.label ?? k;

export const REPORT_KINDS = {
  WEEKLY: "Semanal",
  MONTHLY: "Mensal",
  QUARTERLY: "Trimestral",
  YEARLY: "Anual",
  CUSTOM: "Personalizado",
} as const;
