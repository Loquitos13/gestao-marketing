import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toDate, type ISODate } from "@/lib/dates";
import { safeDiv } from "@/server/metrics/calc";

export interface WebAgg {
  sessions: number;
  users: number | null;
  newUsers: number | null;
  engagedSessions: number | null;
  views: number | null;
  events: number | null;
  keyEvents: number | null;
  purchases: number | null;
  revenue: number | null;
  engagementRate: number | null;
  keyEventRate: number | null;
  /** Utilizadores somados entre dias: aproximação (limite superior). */
  usersApproximate: boolean;
}

type Raw = {
  key?: string;
  b?: string;
  s: number | null;
  u: number | null;
  nu: number | null;
  e: number | null;
  v: number | null;
  ev: number | null;
  k: number | null;
  pu: number | null;
  r: number | null;
  days: number;
};

function toAgg(r: Raw | undefined): WebAgg {
  const sessions = r?.s ?? 0;
  return {
    sessions,
    users: r?.u ?? null,
    newUsers: r?.nu ?? null,
    engagedSessions: r?.e ?? null,
    views: r?.v ?? null,
    events: r?.ev ?? null,
    keyEvents: r?.k ?? null,
    purchases: r?.pu ?? null,
    revenue: r?.r ?? null,
    engagementRate: safeDiv(r?.e ?? null, sessions),
    keyEventRate: safeDiv(r?.k ?? null, sessions),
    usersApproximate: (r?.days ?? 0) > 1,
  };
}

const COLS = Prisma.sql`SUM(sessions)::float8 s, SUM(users)::float8 u, SUM("newUsers")::float8 nu, SUM("engagedSessions")::float8 e,
  SUM(views)::float8 v, SUM(events)::float8 ev, SUM("keyEvents")::float8 k, SUM(purchases)::float8 pu, SUM(revenue)::float8 r,
  COUNT(DISTINCT date)::int days`;

export async function webTotals(clientId: string, start: ISODate, end: ISODate, dimension = "TOTAL", key?: string) {
  const rows = await prisma.$queryRaw<Raw[]>`
    SELECT ${COLS} FROM "WebAnalyticsDaily"
    WHERE "clientId" = ${clientId} AND dimension = ${dimension} ${key !== undefined ? Prisma.sql`AND key = ${key}` : Prisma.empty}
      AND date BETWEEN ${toDate(start)} AND ${toDate(end)}`;
  return { ...toAgg(rows[0]), hasData: (rows[0]?.days ?? 0) > 0 };
}

export async function webSeries(clientId: string, start: ISODate, end: ISODate, g: "day" | "week" | "month") {
  const b =
    g === "week"
      ? Prisma.sql`to_char(date_trunc('week', date), 'YYYY-MM-DD')`
      : g === "month"
        ? Prisma.sql`to_char(date_trunc('month', date), 'YYYY-MM-DD')`
        : Prisma.sql`to_char(date, 'YYYY-MM-DD')`;
  const rows = await prisma.$queryRaw<Raw[]>`
    SELECT ${b} b, ${COLS} FROM "WebAnalyticsDaily"
    WHERE "clientId" = ${clientId} AND dimension = 'TOTAL' AND date BETWEEN ${toDate(start)} AND ${toDate(end)}
    GROUP BY 1 ORDER BY 1`;
  return rows.map((r) => ({ date: r.b!, ...toAgg(r) }));
}

export async function webByKey(clientId: string, dimension: string, start: ISODate, end: ISODate, limit = 200) {
  const rows = await prisma.$queryRaw<Raw[]>`
    SELECT key, ${COLS} FROM "WebAnalyticsDaily"
    WHERE "clientId" = ${clientId} AND dimension = ${dimension} AND date BETWEEN ${toDate(start)} AND ${toDate(end)}
    GROUP BY key ORDER BY 2 DESC LIMIT ${limit}`;
  return rows.map((r) => ({ key: r.key!, ...toAgg(r) }));
}
