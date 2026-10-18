/** Tipos da especificação dos clientes de demonstração (dados SIMULADOS). */
export type DemoPlatform = "GOOGLE_ADS" | "META_ADS";

export interface DemoAd {
  id: string;
  name: string;
  weight: number;
  ctrMul: number;
  cvrMul: number;
  fatigue?: boolean;
  createdDaysAgo?: number;
  headlines?: string[];
  descriptions?: string[];
  finalUrl: string;
  format?: "IMAGE" | "VIDEO" | "CAROUSEL" | "TEXT";
  primaryText?: string;
  title?: string;
  description?: string;
  cta?: string;
}

export interface DemoAdGroup {
  id: string;
  name: string;
  keywords?: { text: string; match: "EXACT" | "PHRASE" | "BROAD"; weight: number }[];
  ads: DemoAd[];
}

export interface DemoScenario {
  kind: "budgetLimited" | "cpaSpike" | "overspend";
  fromDaysAgo: number;
  factor: number;
}

export interface DemoCampaign {
  id: string;
  name: string;
  platform: DemoPlatform;
  type: string;
  objective: string;
  bidding?: string;
  dailyBudget: number;
  cpc: number;
  ctr: number;
  cvr: number;
  aov: number;
  leadShare: number;
  purchaseShare: number;
  startDaysAgo: number;
  adLevel: boolean;
  baseImpressionShare?: number;
  scenario?: DemoScenario;
  adGroups: DemoAdGroup[];
}

export interface DemoQuery {
  q: string;
  page: string;
  impr: number;
  pos: number;
  ctrMul?: number;
  growth?: number; // variação relativa por 100 dias
  scenario?: "decline" | "rising";
}

export interface DemoClientSpec {
  key: string;
  name: string;
  industry: string;
  website: string;
  currency: string;
  timezone: string;
  monthlyBudget: number;
  grossMargin: number | null;
  objectives: string;
  contactName: string;
  contactEmail: string;
  profile: "b2c" | "b2b";
  ecommerce: boolean;
  campaigns: DemoCampaign[];
  queries: DemoQuery[];
  landingWeights: { page: string; weight: number; cvMul: number }[];
  organicPosts: number;
  countries: { code: string; weight: number }[];
}

export const ad = (id: string, name: string, extra: Partial<DemoAd> & { finalUrl: string }): DemoAd => ({
  id,
  name,
  weight: 1,
  ctrMul: 1,
  cvrMul: 1,
  ...extra,
});
