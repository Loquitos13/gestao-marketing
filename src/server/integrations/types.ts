import type { DataSource, Platform } from "@prisma/client";
import type { ISODate } from "@/lib/dates";

export interface DiscoveredAccount {
  platform: Platform;
  externalId: string;
  name: string;
  currency?: string | null;
  timezone?: string | null;
  managerId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SyncLogger {
  info(message: string, context?: Record<string, unknown>): Promise<void>;
  warn(message: string, context?: Record<string, unknown>): Promise<void>;
}

export interface ConnectorContext {
  dataSource: DataSource;
  accessToken: () => Promise<string>;
  range: { start: ISODate; end: ISODate };
  log: SyncLogger;
}

/** Entidades normalizadas. Cada conector mapeia o modelo do fornecedor para estas formas, preservando a origem. */
export interface CampaignUpsert {
  externalId: string;
  name: string;
  status: string;
  objective?: string | null;
  campaignType?: string | null;
  biddingStrategy?: string | null;
  dailyBudget?: number | null;
  raw?: Record<string, unknown>;
}

export interface AdGroupUpsert {
  externalId: string;
  campaignExternalId: string;
  name: string;
  status: string;
  dailyBudget?: number | null;
  raw?: Record<string, unknown>;
}

export interface AdUpsert {
  externalId: string;
  adGroupExternalId: string;
  name: string;
  status: string;
  adType?: string | null;
  finalUrl?: string | null;
  headlines?: string[];
  descriptions?: string[];
  createdTime?: Date | null;
  creative?: {
    externalId: string;
    format?: string | null;
    primaryText?: string | null;
    title?: string | null;
    description?: string | null;
    callToAction?: string | null;
    imageUrl?: string | null;
    thumbnailUrl?: string | null;
    videoId?: string | null;
    postId?: string | null;
  } | null;
}

export interface EntityBatch {
  campaigns: CampaignUpsert[];
  adGroups: AdGroupUpsert[];
  ads: AdUpsert[];
}

export type Num = number | null;

export interface AdMetricInput {
  level: "CAMPAIGN" | "AD";
  campaignExternalId: string;
  adGroupExternalId?: string;
  adExternalId?: string;
  date: ISODate;
  currency: string;
  impressions: number;
  clicks: number;
  cost: number;
  interactions?: Num;
  reach?: Num;
  linkClicks?: Num;
  outboundClicks?: Num;
  landingPageViews?: Num;
  conversions?: Num;
  allConversions?: Num;
  conversionValue?: Num;
  allConversionValue?: Num;
  leads?: Num;
  purchases?: Num;
  purchaseValue?: Num;
  videoViews?: Num;
  thruplays?: Num;
  videoP25?: Num;
  videoP50?: Num;
  videoP75?: Num;
  videoP100?: Num;
  engagements?: Num;
  reactions?: Num;
  comments?: Num;
  shares?: Num;
  messages?: Num;
  calls?: Num;
  searchImpressionShare?: Num;
  searchLostIsBudget?: Num;
  searchLostIsRank?: Num;
  eligibleImpressionsApprox?: Num;
}

export interface BreakdownInput {
  campaignExternalId: string;
  date: ISODate;
  dimension: "DEVICE" | "COUNTRY";
  value: string;
  currency: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions?: Num;
  conversionValue?: Num;
  leads?: Num;
}

export interface TermInput {
  kind: "KEYWORD" | "SEARCH_TERM";
  campaignExternalId: string;
  adGroupExternalId: string;
  text: string;
  matchType?: string;
  date: ISODate;
  currency: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions?: Num;
  conversionValue?: Num;
}

export interface SearchInput {
  dimension: "TOTAL" | "QUERY" | "PAGE" | "DEVICE" | "COUNTRY";
  key: string;
  date: ISODate;
  clicks: number;
  impressions: number;
  positionSum: number;
}

export interface WebInput {
  dimension: "TOTAL" | "CHANNEL" | "SOURCE_MEDIUM" | "CAMPAIGN" | "LANDING_PAGE" | "DEVICE" | "COUNTRY";
  key: string;
  date: ISODate;
  currency: string;
  users: Num;
  newUsers: Num;
  sessions: number;
  engagedSessions: Num;
  views: Num;
  events: Num;
  keyEvents: Num;
  purchases: Num;
  revenue: Num;
  bounceRate: Num;
}

export interface OrganicInput {
  platform: string;
  externalId: string;
  url?: string | null;
  contentType?: string | null;
  title?: string | null;
  text?: string | null;
  mediaUrl?: string | null;
  publishedAt?: Date | null;
  impressions?: Num;
  reach?: Num;
  clicks?: Num;
  reactions?: Num;
  comments?: Num;
  shares?: Num;
  saves?: Num;
  videoViews?: Num;
  watchTimeSec?: Num;
  linkClicks?: Num;
  unavailable: string[];
}

export interface SeoSnapshotInput {
  provider: string;
  snapshotDate: ISODate;
  keyword?: string | null;
  position?: Num;
  searchVolume?: Num;
  url?: string | null;
  estTraffic?: Num;
  metricKey?: string | null;
  metricValue?: Num;
}

/** Resultado de uma sincronização: dados normalizados para o intervalo pedido. */
export interface SyncResult {
  entities?: EntityBatch;
  adMetrics?: AdMetricInput[];
  breakdowns?: BreakdownInput[];
  terms?: TermInput[];
  search?: SearchInput[];
  web?: WebInput[];
  organic?: OrganicInput[];
  seoSnapshots?: SeoSnapshotInput[];
  /** Último dia efetivamente com dados devolvidos pela fonte. */
  dataAvailableUntil?: ISODate | null;
}

export interface Connector {
  platform: Platform;
  sync(ctx: ConnectorContext): Promise<SyncResult>;
}
