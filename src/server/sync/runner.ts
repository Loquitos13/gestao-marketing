import type { Prisma, SyncKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger, scrubSecrets } from "@/lib/logger";
import { addDays, fromDate, maxDate, todayInTz } from "@/lib/dates";
import { CONNECTORS, PLATFORM_SYNC } from "@/server/integrations/registry";
import { IntegrationError } from "@/server/integrations/http";
import { getValidAccessToken } from "@/server/integrations/tokens";
import { writeSyncResult } from "./writer";
import { writeDemoClient } from "@/demo/persist";
import { DEMO_CLIENTS } from "@/demo/specs";

export interface RunSyncOptions {
  kind?: SyncKind;
  start?: string;
  end?: string;
  requestedBy?: string;
  historyDays?: number;
}

/** Calcula o intervalo: incremental = desde a última data disponível menos a janela de revisão; histórico = N dias. */
export function computeRange(
  platform: keyof typeof PLATFORM_SYNC,
  timezone: string,
  dataAvailableUntil: string | null,
  kind: SyncKind,
  historyDays = 90,
  now = new Date(),
): { start: string; end: string } {
  const end = addDays(todayInTz(timezone, now), -1);
  const cfg = PLATFORM_SYNC[platform];
  if (kind === "HISTORICAL" || !dataAvailableUntil) {
    const days = Math.min(historyDays, cfg.maxHistoryDays || historyDays);
    return { start: addDays(end, -(days - 1)), end };
  }
  const start = maxDate(addDays(dataAvailableUntil, -cfg.lookbackDays), addDays(end, -(cfg.maxHistoryDays || 30)));
  return { start: start > end ? end : start, end };
}

export async function runSync(dataSourceId: string, opts: RunSyncOptions = {}) {
  const ds = await prisma.dataSource.findUniqueOrThrow({
    where: { id: dataSourceId },
    include: { connectedAccount: { include: { credential: true } }, client: true },
  });
  const kind = opts.kind ?? "INCREMENTAL";

  if (ds.origin === "SIMULATED") {
    const spec = DEMO_CLIENTS.find((s) => s.key === (ds.settings as { demoKey?: string } | null)?.demoKey);
    if (!spec) throw new Error("Fonte simulada sem especificação de demonstração");
    const job = await prisma.syncJob.create({ data: { dataSourceId, kind, status: "RUNNING", attempts: 1, startedAt: new Date(), requestedBy: opts.requestedBy } });
    const anchor = addDays(todayInTz(ds.client.timezone), -1);
    const res = await writeDemoClient(prisma, ds.clientId, spec, anchor);
    await prisma.syncLog.create({ data: { syncJobId: job.id, level: "info", message: "Dados SIMULADOS regenerados (modo de demonstração).", context: { rows: res.rows, anchor } } });
    await prisma.syncJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), rowsUpserted: res.rows } });
    return { jobId: job.id, rows: res.rows, simulated: true };
  }

  const range =
    opts.start && opts.end ? { start: opts.start, end: opts.end } : computeRange(ds.platform, ds.timezone, ds.dataAvailableUntil ? fromDate(ds.dataAvailableUntil) : null, kind, opts.historyDays);
  const job = await prisma.syncJob.create({
    data: { dataSourceId, kind, status: "RUNNING", attempts: 1, startedAt: new Date(), requestedBy: opts.requestedBy, rangeStart: new Date(`${range.start}T00:00:00Z`), rangeEnd: new Date(`${range.end}T00:00:00Z`) },
  });
  const log = (level: "info" | "warn" | "error") => async (message: string, context?: Record<string, unknown>) => {
    await prisma.syncLog.create({ data: { syncJobId: job.id, level, message: scrubSecrets(message), context: context as Prisma.InputJsonValue | undefined } });
  };

  try {
    const cred = ds.connectedAccount?.credential;
    const connector = CONNECTORS[ds.platform];
    const result = await connector.sync({
      dataSource: ds,
      range,
      log: { info: log("info"), warn: log("warn") },
      accessToken: async () => {
        if (ds.platform === "SEMRUSH") return "";
        if (!cred) throw new IntegrationError("Fonte sem credencial OAuth associada", "CONFIG");
        const fresh = await prisma.oAuthCredential.findUniqueOrThrow({ where: { id: cred.id } });
        return getValidAccessToken(fresh, { db: prisma });
      },
    });
    const rows = await writeSyncResult(prisma, ds, range, result);
    // Google/Meta devolvem null em dias sem entrega: contas pausadas avançam até ao fim do intervalo pedido.
    const until = result.dataAvailableUntil ?? (ds.platform === "GOOGLE_ADS" || ds.platform === "META_ADS" ? range.end : null);
    await prisma.dataSource.update({
      where: { id: ds.id },
      data: {
        status: "ACTIVE",
        lastSyncAt: new Date(),
        lastSuccessfulSyncAt: new Date(),
        lastError: null,
        ...(until && (!ds.dataAvailableUntil || until > fromDate(ds.dataAvailableUntil)) ? { dataAvailableUntil: new Date(`${until}T00:00:00Z`) } : {}),
        ...(kind === "HISTORICAL" ? { historyStartDate: new Date(`${range.start}T00:00:00Z`) } : {}),
      },
    });
    await prisma.syncJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), rowsUpserted: rows } });
    logger.info({ dataSourceId, platform: ds.platform, rows, range }, "Sincronização concluída");
    return { jobId: job.id, rows, simulated: false };
  } catch (e) {
    const err = e instanceof IntegrationError ? e : new IntegrationError(e instanceof Error ? e.message : String(e), "UNKNOWN");
    const msg = `[${err.kind}] ${err.message}`.slice(0, 1000);
    await log("error")(msg, { status: err.status });
    await prisma.syncJob.update({ where: { id: job.id }, data: { status: "FAILED", finishedAt: new Date(), error: msg } });
    await prisma.dataSource.update({ where: { id: ds.id }, data: { status: "ERROR", lastSyncAt: new Date(), lastError: msg } });
    logger.error({ dataSourceId, platform: ds.platform, kind: err.kind, error: err.message }, "Sincronização falhou");
    // Relança o erro original: embrulhar como UNKNOWN faria o worker tratar erros transitórios (P2024, P2002) como irrecuperáveis.
    throw e;
  }
}
