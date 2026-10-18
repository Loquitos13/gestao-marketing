import { Queue, type ConnectionOptions } from "bullmq";
import type { SyncKind } from "@prisma/client";
import { logger } from "@/lib/logger";
import { getConfig } from "@/server/config/settings";
import { runSync } from "./runner";

export const QUEUE_NAMES = { sync: "mih-sync", reports: "mih-reports", maintenance: "mih-maintenance", agent: "mih-agent", research: "mih-research" } as const;

export interface SyncJobData {
  dataSourceId: string;
  kind: SyncKind;
  start?: string;
  end?: string;
  historyDays?: number;
  requestedBy?: string;
}

export function redisConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

const g = globalThis as unknown as { __mihQueues?: Map<string, Queue> };
/** Filas em cache por URL: alterar o Redis na interface cria novas ligações sem reiniciar a aplicação. */
export function getQueue(name: (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES], redisUrl: string): Queue {
  g.__mihQueues ??= new Map();
  const key = `${name}|${redisUrl}`;
  let q = g.__mihQueues.get(key);
  if (!q) {
    for (const [k, old] of g.__mihQueues) if (k.startsWith(`${name}|`)) {
      g.__mihQueues.delete(k);
      void old.close().catch(() => undefined);
    }
    q = new Queue(name, { connection: redisConnection(redisUrl) });
    g.__mihQueues.set(key, q);
  }
  return q;
}

export const SYNC_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 30_000 },
  removeOnComplete: { age: 7 * 86_400, count: 1000 },
  removeOnFail: { age: 30 * 86_400 },
};

/**
 * Enfileira uma sincronização. Com Redis: job BullMQ com retries e backoff exponencial,
 * deduplicado por fonte+tipo. Sem Redis: executa inline (útil em desenvolvimento/uso individual).
 */
/** Sem `jobId` fixo: o BullMQ ignora adds cujo id ainda exista (concluídos 7d, falhados 30d) e saltaria as sincronizações diárias. */
export function syncJobOptions(data: SyncJobData) {
  const jobId = `sync-${data.dataSourceId}-${data.kind}${data.start ? `-${data.start}-${data.end}` : ""}`;
  return { jobId, options: { ...SYNC_JOB_OPTIONS, deduplication: { id: jobId } } };
}

export async function enqueueSync(data: SyncJobData): Promise<{ mode: "queued"; jobId: string } | { mode: "inline"; rows: number; simulated: boolean }> {
  const { REDIS_URL } = await getConfig();
  if (REDIS_URL) {
    const { jobId, options } = syncJobOptions(data);
    const job = await getQueue(QUEUE_NAMES.sync, REDIS_URL).add("sync", data, options);
    return { mode: "queued", jobId: job.id ?? jobId };
  }
  logger.info({ dataSourceId: data.dataSourceId }, "Redis não configurado: sincronização inline");
  const res = await runSync(data.dataSourceId, data);
  return { mode: "inline", rows: res.rows, simulated: res.simulated };
}
