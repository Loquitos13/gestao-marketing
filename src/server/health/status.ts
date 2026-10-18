import { prisma } from "@/lib/prisma";
import { getConfig } from "@/server/config/settings";
import { ollamaReachableUrl } from "@/server/agent/llm";
import { workerIsRunning } from "@/server/sync/worker-presence";

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
