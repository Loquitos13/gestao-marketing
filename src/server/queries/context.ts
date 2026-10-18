import type { Client, DataSource, Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fromDate, minDate, type ISODate } from "@/lib/dates";
import type { FormatContext } from "@/lib/format";

export type DataOriginLabel = "REAL" | "SIMULATED" | "MIXED" | "NONE";

export interface SourceInfo {
  id: string;
  platform: Platform;
  name: string;
  origin: "REAL" | "SIMULATED";
  status: string;
  lastSuccessfulSyncAt: Date | null;
  dataAvailableUntil: ISODate | null;
  lastError: string | null;
  currency: string;
}

export interface ClientContext {
  client: Client;
  fmt: FormatContext;
  sources: SourceInfo[];
  has: Record<Platform, boolean>;
  origin: DataOriginLabel;
  originOf: (platforms: Platform[]) => DataOriginLabel;
  completenessWarning: (platforms: Platform[], end: ISODate) => string | null;
  lastSync: Date | null;
}

/**
 * Último dia com dados em TODAS as fontes indicadas (a mais atrasada manda), limitado a `yesterday`.
 * Regra única para janelas de análise: evita comparar dias completos com dias ainda por sincronizar.
 */
export function dataUntil(ctx: ClientContext, platforms: Platform[], yesterday: ISODate): ISODate {
  const earliest = ctx.sources.filter((s) => platforms.includes(s.platform)).map((s) => s.dataAvailableUntil).filter(Boolean).sort()[0] as ISODate | undefined;
  return earliest ? minDate(earliest, yesterday) : yesterday;
}

export async function loadClientContext(client: Client): Promise<ClientContext> {
  const ds: DataSource[] = await prisma.dataSource.findMany({ where: { clientId: client.id, status: { not: "DISCONNECTED" } } });
  const sources: SourceInfo[] = ds.map((d) => ({
    id: d.id,
    platform: d.platform,
    name: d.name,
    origin: d.origin,
    status: d.status,
    lastSuccessfulSyncAt: d.lastSuccessfulSyncAt,
    dataAvailableUntil: d.dataAvailableUntil ? fromDate(d.dataAvailableUntil) : null,
    lastError: d.lastError,
    currency: d.currency,
  }));
  const platforms: Platform[] = ["GOOGLE_ADS", "META_ADS", "SEARCH_CONSOLE", "GA4", "META_ORGANIC", "SEMRUSH"];
  const has = Object.fromEntries(platforms.map((p) => [p, sources.some((s) => s.platform === p)])) as Record<Platform, boolean>;
  const originOf = (ps: Platform[]): DataOriginLabel => {
    const rel = sources.filter((s) => ps.includes(s.platform));
    if (!rel.length) return "NONE";
    const sim = rel.some((s) => s.origin === "SIMULATED");
    const real = rel.some((s) => s.origin === "REAL");
    return sim && real ? "MIXED" : sim ? "SIMULATED" : "REAL";
  };
  const completenessWarning = (ps: Platform[], end: ISODate) => {
    const late = sources.filter((s) => ps.includes(s.platform) && (!s.dataAvailableUntil || s.dataAvailableUntil < end));
    if (!late.length) return null;
    return late
      .map((s) => `${s.name}: dados disponíveis até ${s.dataAvailableUntil ?? "—"}`)
      .join(" · ");
  };
  const lastSync = sources.reduce<Date | null>((acc, s) => (s.lastSuccessfulSyncAt && (!acc || s.lastSuccessfulSyncAt > acc) ? s.lastSuccessfulSyncAt : acc), null);
  return {
    client,
    fmt: { locale: client.locale, currency: client.currency, timezone: client.timezone },
    sources,
    has,
    origin: originOf(platforms),
    originOf,
    completenessWarning,
    lastSync,
  };
}
