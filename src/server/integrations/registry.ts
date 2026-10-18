import type { Platform } from "@prisma/client";
import type { Connector } from "./types";
import { googleAdsConnector } from "./google/ads";
import { searchConsoleConnector } from "./google/search-console";
import { ga4Connector } from "./google/ga4";
import { metaAdsConnector } from "./meta/ads";
import { metaOrganicConnector } from "./meta/organic";
import { semrushConnector } from "./semrush";

export const CONNECTORS: Record<Platform, Connector> = {
  GOOGLE_ADS: googleAdsConnector,
  META_ADS: metaAdsConnector,
  SEARCH_CONSOLE: searchConsoleConnector,
  GA4: ga4Connector,
  META_ORGANIC: metaOrganicConnector,
  SEMRUSH: semrushConnector,
};

/** Atraso típico de processamento e janela de revisão por plataforma (dias). */
export const PLATFORM_SYNC = {
  GOOGLE_ADS: { lookbackDays: 7, maxHistoryDays: 730 },
  META_ADS: { lookbackDays: 7, maxHistoryDays: 730 },
  SEARCH_CONSOLE: { lookbackDays: 5, maxHistoryDays: 480 },
  GA4: { lookbackDays: 4, maxHistoryDays: 730 },
  META_ORGANIC: { lookbackDays: 30, maxHistoryDays: 365 },
  SEMRUSH: { lookbackDays: 0, maxHistoryDays: 0 },
} satisfies Record<Platform, { lookbackDays: number; maxHistoryDays: number }>;

export const PLATFORM_LABELS: Record<Platform, string> = {
  GOOGLE_ADS: "Google Ads",
  META_ADS: "Meta Ads",
  SEARCH_CONSOLE: "Google Search Console",
  GA4: "Google Analytics 4",
  META_ORGANIC: "Facebook/Instagram orgânico",
  SEMRUSH: "Semrush (estimativas)",
};
