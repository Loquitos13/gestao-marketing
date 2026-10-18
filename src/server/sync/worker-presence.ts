import Redis from "ioredis";

/** Chave com expiração curta: se o worker parar sem se despedir, o aviso aparece sozinho. */
export const WORKER_PRESENCE_KEY = "mih:worker:alive";
const TTL_SEC = 25;
const REFRESH_MS = 8_000;

let cache: { url: string; at: number; up: boolean } | null = null;

export function startWorkerPresence(redisUrl: string) {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
  const beat = () => redis.set(WORKER_PRESENCE_KEY, "1", "EX", TTL_SEC);
  const timer = setInterval(() => void beat().catch(() => undefined), REFRESH_MS);
  timer.unref?.();
  void beat().catch(() => undefined);
  return async () => {
    clearInterval(timer);
    await redis.del(WORKER_PRESENCE_KEY).catch(() => undefined);
    redis.disconnect();
  };
}

/** Verdadeiro quando um worker renovou a presença nos últimos segundos. */
export async function workerIsRunning(redisUrl: string): Promise<boolean> {
  if (cache && cache.url === redisUrl && Date.now() - cache.at < 5_000) return cache.up;
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 1_500, enableOfflineQueue: false, lazyConnect: true });
  let up = false;
  try {
    await redis.connect();
    up = (await redis.get(WORKER_PRESENCE_KEY)) !== null;
  } catch {
    up = false;
  } finally {
    redis.disconnect();
  }
  cache = { url: redisUrl, at: Date.now(), up };
  return up;
}

export async function withWorkerWarning(redisUrl: string, okText: string): Promise<string> {
  const up = await workerIsRunning(redisUrl);
  return up ? okText : `${okText} O worker não está a correr: inicie-o com npm run worker, senão o pedido fica à espera.`;
}
