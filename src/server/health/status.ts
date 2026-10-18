import { prisma } from "@/lib/prisma";
import { getConfig } from "@/server/config/settings";
import { ollamaReachableUrl } from "@/server/agent/llm";
import { claimWorkerDownNotice, workerIsRunning } from "@/server/sync/worker-presence";
import { sendEmail } from "@/server/notify/email";
import { logger } from "@/lib/logger";

export type ServiceState = "ok" | "down" | "off";

export interface ServiceReport {
  database: ServiceState;
  redis: ServiceState;
  worker: ServiceState;
  model: ServiceState;
}

async function configured(): Promise<{ redisUrl: string | null; ollamaUrl: string }> {
  try {
    const c = await getConfig();
    return { redisUrl: c.REDIS_URL ?? null, ollamaUrl: c.OLLAMA_URL };
  } catch {
    return { redisUrl: process.env.REDIS_URL || null, ollamaUrl: process.env.OLLAMA_URL || "http://127.0.0.1:11434" };
  }
}

async function pingRedis(url: string): Promise<boolean> {
  const { default: Redis } = await import("ioredis");
  const redis = new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 1_500, enableOfflineQueue: false, lazyConnect: true });
  redis.on("error", () => undefined);
  try {
    await redis.connect();
    return (await redis.ping()) === "PONG";
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}

async function pingModel(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${ollamaReachableUrl(url).replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(2_000), cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Estado dos serviços de que a app depende. Não inclui endereços nem configuração. */
export async function serviceReport(): Promise<ServiceReport> {
  const cfg = await configured();
  const [database, redisUp, model] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => true as const).catch(() => false as const),
    cfg.redisUrl ? pingRedis(cfg.redisUrl) : Promise.resolve(null),
    pingModel(cfg.ollamaUrl),
  ]);
  const redis: ServiceState = redisUp === null ? "off" : redisUp ? "ok" : "down";
  let worker: ServiceState = "off";
  if (cfg.redisUrl && redisUp) worker = (await workerIsRunning(cfg.redisUrl)) ? "ok" : "down";
  else if (cfg.redisUrl) worker = "down";
  return { database: database ? "ok" : "down", redis, worker, model: model ? "ok" : "down" };
}

let warnedNoSmtp = false;

/**
 * Avisa proprietários e administradores por email quando o worker está parado há 15 min.
 * Chamado a cada /api/health (Docker, ~30 s); o marcador no Redis garante um único aviso por paragem.
 */
export async function checkWorkerDown(): Promise<void> {
  const { redisUrl } = await configured();
  if (!redisUrl) return;
  if ((await claimWorkerDownNotice(redisUrl)) !== "notify") return;
  const members = await prisma.organizationMember.findMany({ where: { role: { in: ["OWNER", "ADMIN"] } }, select: { user: { select: { email: true } } } });
  const text = "O worker da aplicação não renova a presença há mais de 15 minutos. As sincronizações, relatórios agendados e alertas ficam parados até ser reiniciado (npm run worker ou o contentor do worker). Este aviso só se repete se o worker voltar e parar de novo.";
  for (const to of new Set(members.map((m) => m.user.email))) {
    const r = await sendEmail({ to, subject: "[Marketing Intelligence Hub] Worker parado", text });
    if (r.status === "SKIPPED_NOT_CONFIGURED") {
      if (!warnedNoSmtp) logger.warn("Worker parado há mais de 15 minutos; sem SMTP configurado, o aviso por email não foi enviado");
      warnedNoSmtp = true;
      return;
    }
  }
  logger.warn({ recipients: members.length }, "Worker parado: aviso enviado aos proprietários e administradores");
}
