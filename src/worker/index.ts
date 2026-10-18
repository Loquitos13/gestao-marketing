import { UnrecoverableError, Worker, type Job } from "bullmq";
import { logger } from "@/lib/logger";
import { getConfig } from "@/server/config/settings";
import { prisma } from "@/lib/prisma";
import { IntegrationError } from "@/server/integrations/http";
import { runSync } from "@/server/sync/runner";
import { getQueue, QUEUE_NAMES, redisConnection, type SyncJobData } from "@/server/sync/queue";
import { createServer, type Server } from "node:http";
import { alignReportComparisons, runDueSchedules } from "@/server/reports/service";
import { retentionCleanup, runIntelligence, scheduleDailySyncs } from "@/server/jobs";
import { trainAllClients } from "@/server/agent/train";
import { trainAllPreferences } from "@/server/agent/learning";
import { analyzeAllClients, analyzeClient, requestAnalysisAfterSync, type RunTrigger } from "@/server/agent/analyze";
import { refreshAllCompetitors, refreshAllKeywordIdeas, refreshCompetitors, refreshKeywordIdeas } from "@/server/competitors/refresh";
import { startWorkerPresence } from "@/server/sync/worker-presence";
import { importEcbRates } from "@/server/fx/ecb";

async function processSync(job: Job<SyncJobData>) {
  try {
    const res = await runSync(job.data.dataSourceId, job.data);
    const ds = await prisma.dataSource.findUnique({ where: { id: job.data.dataSourceId }, select: { clientId: true } });
    if (ds) await requestAnalysisAfterSync(ds.clientId).catch((e) => logger.warn({ error: (e as Error).message }, "Não foi possível agendar a análise do agente"));
    return res;
  } catch (e) {
    // Erros de autenticação, permissão ou configuração não se resolvem com novas tentativas.
    if (e instanceof IntegrationError && !e.retryable) throw new UnrecoverableError(e.message);
    throw e;
  }
}

async function processMaintenance(job: Job) {
  switch (job.name) {
    case "daily-sync":
      return scheduleDailySyncs();
    case "intelligence":
      return runIntelligence();
    case "retention":
      return retentionCleanup();
    case "report-schedules":
      return runDueSchedules();
    case "agent-train":
      return { models: await trainAllClients(), preferences: await trainAllPreferences() };
    case "align-reports":
      return alignReportComparisons();
    case "fx-ecb":
      // Lido a cada execução: desligar em Integrações → Configuração não exige reiniciar o worker.
      if ((await getConfig()).FX_AUTO_ECB === "false") return { skipped: "FX_AUTO_ECB=false" };
      return importEcbRates();
    default:
      throw new UnrecoverableError(`Tarefa desconhecida: ${job.name}`);
  }
}

/** Fila própria com concorrência 1: o modelo de linguagem local só atende um pedido de cada vez. */
async function processAgent(job: Job<{ clientId?: string; trigger?: RunTrigger }>) {
  if (job.name === "agent-analyze-all") return analyzeAllClients();
  if (job.name === "agent-analyze" && job.data.clientId) {
    const r = await analyzeClient(job.data.clientId, job.data.trigger ?? "SYNC");
    return { status: r.status, proposals: r.proposals };
  }
  throw new UnrecoverableError(`Tarefa desconhecida: ${job.name}`);
}

/** Pesquisa de concorrência: rastreio lento (1 pedido/s por domínio), por isso numa fila própria com concorrência 1. */
async function processResearch(job: Job<{ clientId?: string; force?: boolean }>) {
  switch (job.name) {
    case "competitors-refresh":
      return refreshAllCompetitors();
    case "keyword-ideas":
      return refreshAllKeywordIdeas();
    case "competitors-refresh-client":
      if (job.data.clientId) return refreshCompetitors(job.data.clientId);
      break;
    case "keyword-ideas-client":
      if (job.data.clientId) return refreshKeywordIdeas(job.data.clientId, { force: job.data.force });
      break;
  }
  throw new UnrecoverableError(`Tarefa desconhecida: ${job.name}`);
}

async function main() {
  const { REDIS_URL } = await getConfig();
  if (!REDIS_URL) {
    logger.error("Redis não configurado (variável REDIS_URL ou Integrações → Fila de tarefas): o worker requer Redis. Sem Redis, as sincronizações correm inline na aplicação.");
    process.exit(1);
  }
  const connection = redisConnection(REDIS_URL);
  const maintenance = getQueue(QUEUE_NAMES.maintenance, REDIS_URL);
  const repeatable: [string, string][] = [
    ["daily-sync", "0 5 * * *"],
    ["intelligence", "30 * * * *"],
    ["report-schedules", "*/15 * * * *"],
    ["retention", "0 3 * * *"],
    ["agent-train", "0 6 * * *"],
    ["align-reports", "20 4 * * *"],
    // BCE publica ~16:00 CET; 16:30 UTC cobre o horário de verão.
    ["fx-ecb", "30 16 * * *"],
  ];
  for (const [name, pattern] of repeatable) {
    await maintenance.upsertJobScheduler(name, { pattern, tz: "UTC" }, { name, opts: { removeOnComplete: 100, removeOnFail: 200 } });
  }
  const agent = getQueue(QUEUE_NAMES.agent, REDIS_URL);
  await agent.upsertJobScheduler("agent-analyze-all", { pattern: "30 6 * * *", tz: "UTC" }, { name: "agent-analyze-all", opts: { removeOnComplete: 50, removeOnFail: 100 } });
  const research = getQueue(QUEUE_NAMES.research, REDIS_URL);
  await research.upsertJobScheduler("competitors-refresh", { pattern: "0 2 * * 1", tz: "UTC" }, { name: "competitors-refresh", opts: { removeOnComplete: 20, removeOnFail: 50 } });
  await research.upsertJobScheduler("keyword-ideas", { pattern: "0 3 1 * *", tz: "UTC" }, { name: "keyword-ideas", opts: { removeOnComplete: 20, removeOnFail: 50 } });

  const workers = [
    new Worker(QUEUE_NAMES.sync, processSync, { connection, concurrency: 3, limiter: { max: 10, duration: 60_000 } }),
    new Worker(QUEUE_NAMES.maintenance, processMaintenance, { connection, concurrency: 1 }),
    new Worker(QUEUE_NAMES.agent, processAgent, { connection, concurrency: 1, lockDuration: 10 * 60_000 }),
    new Worker(QUEUE_NAMES.research, processResearch, { connection, concurrency: 1, lockDuration: 30 * 60_000 }),
  ];
  for (const w of workers) {
    w.on("completed", (job) => logger.info({ queue: w.name, job: job.name, id: job.id }, "Job concluído"));
    w.on("failed", (job, err) => logger.error({ queue: w.name, job: job?.name, id: job?.id, attempts: job?.attemptsMade, error: err.message }, "Job falhou"));
  }
  const stopPresence = startWorkerPresence(REDIS_URL);
  const health = startWorkerHealth();
  void alignReportComparisons()
    .then((r) => logger.info(r, "Comparação dos relatórios verificada"))
    .catch((e) => logger.error({ error: e instanceof Error ? e.message : String(e) }, "Falha ao alinhar relatórios"));
  logger.info("Worker iniciado");

  const shutdown = async () => {
    logger.info("A terminar worker…");
    await stopPresence();
    await health.close();
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all([maintenance.close(), agent.close(), research.close()]);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

function startWorkerHealth(): { close: () => Promise<void> } {
  const server: Server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on("error", (e) => logger.warn({ error: e.message }, "Health do worker não arrancou"));
  server.listen(3199, "127.0.0.1");
  server.unref();
  return { close: () => new Promise((resolve) => server.close(() => resolve())) };
}

main().catch((e) => {
  logger.error({ error: e instanceof Error ? e.message : String(e) }, "Worker falhou ao arrancar");
  process.exit(1);
});
