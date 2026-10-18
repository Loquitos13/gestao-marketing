import Redis from "ioredis";

/** Chave com expiração curta: se o worker parar sem se despedir, o aviso aparece sozinho. */
export const WORKER_PRESENCE_KEY = "mih:worker:alive";
/** Último batimento (ms desde a época), sem expiração: permite medir há quanto tempo o worker parou. */
export const WORKER_LAST_SEEN_KEY = "mih:worker:lastseen";
/** Marcador de "já avisámos que o worker parou"; apagado quando o worker volta. */
export const WORKER_DOWN_NOTIFIED_KEY = "mih:worker:down-notified";
export const WORKER_DOWN_AFTER_MS = 15 * 60_000;
const TTL_SEC = 25;
const REFRESH_MS = 8_000;

let cache: { url: string; at: number; up: boolean } | null = null;

export function startWorkerPresence(redisUrl: string) {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
  const beat = () => redis.multi().set(WORKER_PRESENCE_KEY, "1", "EX", TTL_SEC).set(WORKER_LAST_SEEN_KEY, String(Date.now())).exec();
  const timer = setInterval(() => void beat().catch(() => undefined), REFRESH_MS);
  timer.unref?.();
  void beat().catch(() => undefined);
  return async () => {
    clearInterval(timer);
    await redis.del(WORKER_PRESENCE_KEY).catch(() => undefined);
    redis.disconnect();
  };
}

/** Ligação curta e descartável, usada pela app (não pelo worker). */
async function withRedis<T>(redisUrl: string, fn: (redis: Redis) => Promise<T>): Promise<T> {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 1_500, enableOfflineQueue: false, lazyConnect: true });
  redis.on("error", () => undefined);
  try {
    await redis.connect();
    return await fn(redis);
  } finally {
    redis.disconnect();
  }
}

/** Verdadeiro quando um worker renovou a presença nos últimos segundos. */
export async function workerIsRunning(redisUrl: string): Promise<boolean> {
  if (cache && cache.url === redisUrl && Date.now() - cache.at < 5_000) return cache.up;
  const up = await withRedis(redisUrl, async (r) => (await r.get(WORKER_PRESENCE_KEY)) !== null).catch(() => false);
  cache = { url: redisUrl, at: Date.now(), up };
  return up;
}

export async function withWorkerWarning(redisUrl: string, okText: string): Promise<string> {
  const up = await workerIsRunning(redisUrl);
  return up ? okText : `${okText} O worker não está a correr: inicie-o com npm run worker, senão o pedido fica à espera.`;
}

export type WorkerDownDecision = "notify" | "clear" | "none";

/** Decisão pura: avisar uma vez quando o worker está parado há 15 min; limpar o marcador quando volta. */
export function workerDownDecision(s: { up: boolean; lastSeenAt: number | null; notified: boolean; now: number }): WorkerDownDecision {
  if (s.up) return s.notified ? "clear" : "none";
  // Sem registo de batimento, o worker nunca correu: nada a avisar.
  if (s.lastSeenAt === null || s.notified) return "none";
  return s.now - s.lastSeenAt >= WORKER_DOWN_AFTER_MS ? "notify" : "none";
}

/**
 * Lê o estado no Redis e aplica a decisão. Devolve "notify" apenas para quem ganhou a corrida
 * (SET NX), para que apenas um pedido de /api/health envie o aviso.
 */
export async function claimWorkerDownNotice(redisUrl: string, now = Date.now()): Promise<WorkerDownDecision> {
  return withRedis(redisUrl, async (r) => {
    const [alive, lastSeen, notified] = await r.mget(WORKER_PRESENCE_KEY, WORKER_LAST_SEEN_KEY, WORKER_DOWN_NOTIFIED_KEY);
    const decision = workerDownDecision({ up: alive !== null, lastSeenAt: lastSeen ? Number(lastSeen) : null, notified: notified !== null, now });
    if (decision === "clear") await r.del(WORKER_DOWN_NOTIFIED_KEY);
    if (decision === "notify" && (await r.set(WORKER_DOWN_NOTIFIED_KEY, String(now), "NX")) === null) return "none";
    return decision;
  });
}
