import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { refreshRecommendations } from "@/server/intelligence/engine";
import { evaluateAlerts } from "@/server/alerts/engine";
import { enqueueSync } from "@/server/sync/queue";

/** Sincronização diária: incremental para fontes REAIS ativas; regenera clientes de demonstração uma vez. */
export async function scheduleDailySyncs() {
  const sources = await prisma.dataSource.findMany({
    where: { status: { in: ["ACTIVE", "ERROR"] }, client: { archivedAt: null, contractStatus: { in: ["ACTIVE", "PROSPECT"] } } },
    select: { id: true, origin: true, clientId: true },
  });
  const demoDone = new Set<string>();
  let queued = 0;
  for (const s of sources) {
    if (s.origin === "SIMULATED") {
      if (demoDone.has(s.clientId)) continue;
      demoDone.add(s.clientId);
    }
    try {
      await enqueueSync({ dataSourceId: s.id, kind: "INCREMENTAL", requestedBy: "scheduler" });
      queued++;
    } catch (e) {
      logger.warn({ dataSourceId: s.id, error: e instanceof Error ? e.message : String(e) }, "Falha ao agendar sincronização");
    }
  }
  return { queued };
}

/** Recalcula recomendações e alertas para todos os clientes ativos. */
export async function runIntelligence(now = new Date()) {
  const clients = await prisma.client.findMany({ where: { archivedAt: null } });
  const out = [];
  for (const c of clients) {
    try {
      const recs = await refreshRecommendations(c, now);
      const alerts = await evaluateAlerts(c, now);
      out.push({ clientId: c.id, recs, alerts });
    } catch (e) {
      logger.error({ clientId: c.id, error: e instanceof Error ? e.message : String(e) }, "Falha ao processar inteligência");
    }
  }
  return out;
}

/** Limpeza: sessões expiradas, logs de sincronização antigos e métricas fora do período de retenção. */
export async function retentionCleanup(now = new Date()) {
  const sessions = await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  const logs = await prisma.syncLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * 86_400_000) } } });
  const orgs = await prisma.organization.findMany({ select: { id: true, dataRetentionDays: true } });
  let metrics = 0;
  for (const o of orgs) {
    const cutoff = new Date(now.getTime() - o.dataRetentionDays * 86_400_000);
    const where = { date: { lt: cutoff }, dataSource: { client: { organizationId: o.id } } };
    const r = await Promise.all([
      prisma.adMetricDaily.deleteMany({ where }),
      prisma.campaignBreakdownDaily.deleteMany({ where }),
      prisma.adsTermDaily.deleteMany({ where }),
      prisma.searchMetricDaily.deleteMany({ where }),
      prisma.webAnalyticsDaily.deleteMany({ where }),
    ]);
    metrics += r.reduce((a, x) => a + x.count, 0);
  }
  return { sessions: sessions.count, logs: logs.count, metrics };
}
