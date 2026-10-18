import type { MetricDefinition } from "./definitions";

const DIMS = ["Conta", "Campanha", "Grupo/Conjunto", "Anúncio", "Dia"];
const META = ["Conta", "Campanha", "Conjunto", "Anúncio", "Dia"];
const calc = (key: string, label: string, description: string, unit: MetricDefinition["unit"], formula: string, higherIsBetter: boolean | null, dimensions = DIMS, limitations?: string): MetricDefinition => ({
  key,
  label,
  description,
  unit,
  kind: "CALCULATED",
  sources: ["Calculado"],
  formula,
  higherIsBetter,
  aggregation: "Recalculado a partir dos totais",
  dimensions,
  limitations,
});
const direct = (key: string, label: string, description: string, sources: string[], higherIsBetter: boolean | null, dimensions = DIMS, limitations?: string, unit: MetricDefinition["unit"] = "number"): MetricDefinition => ({
  key,
  label,
  description,
  unit,
  kind: "DIRECT",
  sources,
  higherIsBetter,
  aggregation: "Soma",
  dimensions,
  limitations,
});

/** Métricas específicas de plataforma (Google Ads / Meta Ads) usadas nas vistas detalhadas e relatórios. */
export const EXTRA_METRICS: Record<string, MetricDefinition> = {
  valuePerConversion: calc("valuePerConversion", "Valor por conversão", "Receita atribuída média por conversão.", "currency", "Receita atribuída ÷ Conversões", true),
  allConversions: direct("allConversions", "Todas as conversões", "Inclui conversões secundárias, entre dispositivos e de visualização, não usadas na licitação.", ["Google Ads (metrics.all_conversions)"], true, DIMS, "Não comparável com 'Conversões'; útil para medir micro-conversões."),
  allConversionValue: direct("allConversionValue", "Valor de todas as conversões", "Valor associado a todas as conversões.", ["Google Ads (metrics.all_conversions_value)"], true, DIMS, undefined, "currency"),
  interactions: direct("interactions", "Interações", "Principais interações com o anúncio: cliques em texto, visualizações em vídeo, etc.", ["Google Ads (metrics.interactions)"], true),
  interactionRate: calc("interactionRate", "Taxa de interação", "Interações por impressão.", "percent", "Interações ÷ Impressões", true),
  videoViews: direct("videoViews", "Visualizações de vídeo", "Google: visualizações (≥30 s ou interação); Meta: reproduções de 3 segundos.", ["Google Ads (metrics.video_views)", "Meta Ads (video_play_actions / 3-second plays)"], true, DIMS, "Definições diferentes entre plataformas — não comparar diretamente."),
  videoViewRate: calc("videoViewRate", "Taxa de visualização", "Visualizações de vídeo por impressão.", "percent", "Visualizações de vídeo ÷ Impressões", true),
  costPerView: calc("costPerView", "Custo por visualização", "Investimento médio por visualização de vídeo.", "currency", "Investimento ÷ Visualizações de vídeo", false, DIMS, "Inclui investimento de anúncios não vídeo da mesma seleção."),
  linkClicks: direct("linkClicks", "Cliques no link", "Cliques que levam a destinos fora do Meta (site, app, mensagens).", ["Meta Ads (inline_link_clicks)"], true, META),
  linkCtr: calc("linkCtr", "CTR do link", "Cliques no link por impressão.", "percent", "Cliques no link ÷ Impressões", true, META),
  costPerLinkClick: calc("costPerLinkClick", "Custo por clique no link", "Investimento médio por clique no link.", "currency", "Investimento ÷ Cliques no link", false, META),
  landingPageViews: direct("landingPageViews", "Visualizações da página de destino", "Cliques no link em que a página de destino carregou e o píxel disparou.", ["Meta Ads (actions: landing_page_view)"], true, META, "Requer o píxel Meta ou a Conversions API no site."),
  costPerLandingPageView: calc("costPerLandingPageView", "Custo por visualização da página", "Investimento médio por visualização da página de destino.", "currency", "Investimento ÷ Visualizações da página de destino", false, META),
  landingRate: calc("landingRate", "Taxa de chegada à página", "Percentagem de cliques no link que resultaram em carregamento da página.", "percent", "Visualizações da página de destino ÷ Cliques no link", true, META, "Valores baixos indicam páginas lentas ou cliques acidentais."),
  purchases: direct("purchases", "Compras", "Compras atribuídas pelo Meta.", ["Meta Ads (actions: purchase)"], true, META, "Janela de atribuição configurada na conta (por omissão 7 dias clique / 1 dia visualização)."),
  costPerPurchase: calc("costPerPurchase", "Custo por compra", "Investimento médio por compra.", "currency", "Investimento ÷ Compras", false, META),
  purchaseValue: direct("purchaseValue", "Valor das compras", "Valor de conversão das compras atribuídas.", ["Meta Ads (action_values: purchase)"], true, META, undefined, "currency"),
  purchaseRoas: calc("purchaseRoas", "ROAS de compras", "Valor das compras por euro investido.", "multiplier", "Valor das compras ÷ Investimento", true, META),
  thruplays: direct("thruplays", "ThruPlays", "Reproduções de vídeo até ao fim ou ≥15 segundos.", ["Meta Ads (video_thruplay_watched_actions)"], true, META),
  costPerThruplay: calc("costPerThruplay", "Custo por ThruPlay", "Investimento médio por ThruPlay.", "currency", "Investimento ÷ ThruPlays", false, META, "Inclui investimento de anúncios não vídeo da mesma seleção."),
  hookRate: calc("hookRate", "Taxa de retenção inicial (hook rate)", "Percentagem de impressões que geraram uma reprodução de 3 s.", "percent", "Reproduções de 3 s ÷ Impressões", true, META, "Indicador de mercado, não é uma métrica oficial do Meta."),
  holdRate: calc("holdRate", "Taxa de retenção (hold rate)", "Percentagem das reproduções de 3 s que chegaram a ThruPlay.", "percent", "ThruPlays ÷ Reproduções de 3 s", true, META, "Indicador de mercado, não é uma métrica oficial do Meta."),
  engagements: direct("engagements", "Interações com a publicação", "Reações, comentários, partilhas, guardados e cliques.", ["Meta Ads (actions: post_engagement)"], true, META),
  engagementRateAds: calc("engagementRateAds", "Taxa de interação", "Interações com a publicação por impressão.", "percent", "Interações com a publicação ÷ Impressões", true, META),
  reactions: direct("reactions", "Reações", "Gostos e outras reações às publicações dos anúncios.", ["Meta Ads (actions: post_reaction)"], true, META),
  comments: direct("comments", "Comentários", "Comentários às publicações dos anúncios.", ["Meta Ads (actions: comment)"], true, META),
  shares: direct("shares", "Partilhas", "Partilhas das publicações dos anúncios.", ["Meta Ads (actions: post)"], true, META),
};
