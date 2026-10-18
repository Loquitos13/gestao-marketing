import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toDate, type ISODate } from "@/lib/dates";
import { ctr, safeDiv } from "@/server/metrics/calc";

export interface SearchAgg {
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
}

export interface SearchKeyRow {
  key: string;
  current: SearchAgg;
  previous: SearchAgg;
}

const agg = (clicks: number, impressions: number, posSum: number): SearchAgg => ({
  clicks,
  impressions,
  ctr: ctr(clicks, impressions),
  position: safeDiv(posSum, impressions),
});

function bucket(g: "day" | "week" | "month") {
  if (g === "week") return Prisma.sql`to_char(date_trunc('week', date), 'YYYY-MM-DD')`;
  if (g === "month") return Prisma.sql`to_char(date_trunc('month', date), 'YYYY-MM-DD')`;
  return Prisma.sql`to_char(date, 'YYYY-MM-DD')`;
}

export async function searchTotals(clientId: string, start: ISODate, end: ISODate, dimension = "TOTAL", key?: string): Promise<SearchAgg & { hasData: boolean }> {
  const rows = await prisma.$queryRaw<{ c: number | null; i: number | null; p: number | null; n: number }[]>`
    SELECT SUM(clicks)::float8 c, SUM(impressions)::float8 i, SUM("positionSum")::float8 p, COUNT(*)::int n
    FROM "SearchMetricDaily"
    WHERE "clientId" = ${clientId} AND dimension = ${dimension} ${key !== undefined ? Prisma.sql`AND key = ${key}` : Prisma.empty}
      AND date BETWEEN ${toDate(start)} AND ${toDate(end)}`;
  const r = rows[0];
  return { ...agg(r?.c ?? 0, r?.i ?? 0, r?.p ?? 0), hasData: (r?.n ?? 0) > 0 };
}

export async function searchSeries(clientId: string, start: ISODate, end: ISODate, g: "day" | "week" | "month") {
  const rows = await prisma.$queryRaw<{ b: string; c: number; i: number; p: number }[]>`
    SELECT ${bucket(g)} b, SUM(clicks)::float8 c, SUM(impressions)::float8 i, SUM("positionSum")::float8 p
    FROM "SearchMetricDaily"
    WHERE "clientId" = ${clientId} AND dimension = 'TOTAL' AND date BETWEEN ${toDate(start)} AND ${toDate(end)}
    GROUP BY 1 ORDER BY 1`;
  return rows.map((r) => ({ date: r.b, ...agg(r.c, r.i, r.p) }));
}

/** Agregação por chave (consulta, página, dispositivo, país) no período atual e no período de comparação. */
export async function searchByKey(
  clientId: string,
  dimension: "QUERY" | "PAGE" | "DEVICE" | "COUNTRY",
  cur: { start: ISODate; end: ISODate },
  prev: { start: ISODate; end: ISODate } | null,
  limit = 500,
): Promise<SearchKeyRow[]> {
  const cs = toDate(cur.start);
  const ce = toDate(cur.end);
  const ps = prev ? toDate(prev.start) : cs;
  const pe = prev ? toDate(prev.end) : cs;
  const lo = prev && ps < cs ? ps : cs;
  const rows = await prisma.$queryRaw<{ key: string; c: number; i: number; p: number; pc: number; pi: number; pp: number }[]>`
    SELECT key,
      COALESCE(SUM(clicks) FILTER (WHERE date BETWEEN ${cs} AND ${ce}), 0)::float8 c,
      COALESCE(SUM(impressions) FILTER (WHERE date BETWEEN ${cs} AND ${ce}), 0)::float8 i,
      COALESCE(SUM("positionSum") FILTER (WHERE date BETWEEN ${cs} AND ${ce}), 0)::float8 p,
      COALESCE(SUM(clicks) FILTER (WHERE ${prev !== null} AND date BETWEEN ${ps} AND ${pe}), 0)::float8 pc,
      COALESCE(SUM(impressions) FILTER (WHERE ${prev !== null} AND date BETWEEN ${ps} AND ${pe}), 0)::float8 pi,
      COALESCE(SUM("positionSum") FILTER (WHERE ${prev !== null} AND date BETWEEN ${ps} AND ${pe}), 0)::float8 pp
    FROM "SearchMetricDaily"
    WHERE "clientId" = ${clientId} AND dimension = ${dimension} AND date BETWEEN ${lo} AND ${ce}
    GROUP BY key
    ORDER BY 2 DESC, 3 DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({ key: r.key, current: agg(r.c, r.i, r.p), previous: agg(r.pc, r.pi, r.pp) }));
}

export async function seoProviderSnapshots(clientId: string) {
  return prisma.seoKeywordSnapshot.findMany({ where: { clientId }, orderBy: { snapshotDate: "desc" }, take: 200 });
}
