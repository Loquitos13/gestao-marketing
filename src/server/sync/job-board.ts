import { getQueue, QUEUE_NAMES } from "@/server/sync/queue";
import { getConfig } from "@/server/config/settings";
import { workerIsRunning } from "@/server/sync/worker-presence";

const QUEUES = [QUEUE_NAMES.sync, QUEUE_NAMES.maintenance, QUEUE_NAMES.agent, QUEUE_NAMES.research] as const;
const STATES = ["failed", "active", "waiting", "delayed"] as const;

export const QUEUE_LABEL: Record<(typeof QUEUES)[number], string> = {
  "mih-sync": "Sincronização",
  "mih-maintenance": "Manutenção",
  "mih-agent": "Agente",
  "mih-research": "Concorrência",
};

export const STATE_LABEL: Record<(typeof STATES)[number], string> = {
  failed: "Falhou",
  active: "A correr",
  waiting: "À espera",
  delayed: "Adiada",
};

export interface QueueJobRow {
  id: string;
  queue: string;
  queueLabel: string;
  name: string;
  state: (typeof STATES)[number];
  attemptsMade: number;
  attempts: number;
  failedReason: string | null;
  at: number;
}

export async function listQueueJobs(): Promise<{ redis: false } | { redis: true; worker: boolean; jobs: QueueJobRow[] }> {
  const { REDIS_URL } = await getConfig();
  if (!REDIS_URL) return { redis: false };
  const jobs: QueueJobRow[] = [];
  for (const name of QUEUES) {
    const queue = getQueue(name, REDIS_URL);
    for (const state of STATES) {
      const found = await queue.getJobs([state], 0, 40);
      for (const job of found) {
        jobs.push({
          id: job.id ?? "—",
          queue: name,
          queueLabel: QUEUE_LABEL[name],
          name: job.name,
          state,
          attemptsMade: job.attemptsMade,
          attempts: job.opts.attempts ?? 1,
          failedReason: job.failedReason ? job.failedReason.slice(0, 400) : null,
          at: job.finishedOn ?? job.processedOn ?? job.timestamp,
        });
      }
    }
  }
  const order = { failed: 0, active: 1, waiting: 2, delayed: 3 };
  jobs.sort((a, b) => order[a.state] - order[b.state] || b.at - a.at);
  return { redis: true, worker: await workerIsRunning(REDIS_URL), jobs };
}
