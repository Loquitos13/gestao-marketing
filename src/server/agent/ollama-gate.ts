import { randomBytes } from "node:crypto";
import Redis from "ioredis";
import { logger } from "@/lib/logger";

/** O modelo local só atende um pedido de cada vez (chat, relatório e worker partilham a mesma GPU). */
export class LlmBusyError extends Error {
  constructor() {
    super("O modelo local está ocupado com outro pedido. Espere que termine e tente outra vez.");
    this.name = "LlmBusyError";
  }
}

const KEY = "mih:ollama:lock";
const TTL_MS = 180_000;

type Release = () => void;

let current: object | null = null;
const queue: { settle: (release: Release) => void; cancel: () => void }[] = [];

function handoff() {
  const next = queue.shift();
  if (!next) {
    current = null;
    return;
  }
  const token = {};
  current = token;
  next.cancel();
  next.settle(() => {
    if (current !== token) return;
    handoff();
  });
}

/** Fila dentro deste processo, usada quando não há Redis ou a ligação à fila falha. */
export function acquireLocal(waitMs: number): Promise<Release> {
  return new Promise((resolve, reject) => {
    const grant = () => {
      const token = {};
      current = token;
      resolve(() => {
        if (current !== token) return;
        handoff();
      });
    };
    if (!current && queue.length === 0) {
      grant();
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    let settled = false;
    const entry = {
      settle: (release: Release) => {
        if (settled) return;
        settled = true;
        resolve(release);
      },
      cancel: () => clearTimeout(timer),
    };
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const i = queue.indexOf(entry);
      if (i >= 0) queue.splice(i, 1);
      reject(new LlmBusyError());
    }, waitMs);
    queue.push(entry);
  });
}

async function acquireRedis(redisUrl: string, waitMs: number): Promise<Release> {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 1_500, enableOfflineQueue: false, lazyConnect: true });
  redis.on("error", () => undefined);
  const token = randomBytes(8).toString("hex");
  const deadline = Date.now() + waitMs;
  try {
    await redis.connect();
    while (Date.now() < deadline) {
      const ok = await redis.set(KEY, token, "PX", TTL_MS, "NX");
      if (ok === "OK") {
        const timer = setInterval(() => void redis.pexpire(KEY, TTL_MS).catch(() => undefined), Math.floor(TTL_MS / 3));
        timer.unref?.();
        let released = false;
        return () => {
          if (released) return;
          released = true;
          clearInterval(timer);
          void redis
            .eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, KEY, token)
            .catch(() => undefined)
            .finally(() => redis.disconnect());
        };
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch (e) {
    redis.disconnect();
    logger.warn({ error: e instanceof Error ? e.message : String(e) }, "Lock do Ollama no Redis indisponível; a serializar só neste processo");
    return acquireLocal(waitMs);
  }
  redis.disconnect();
  throw new LlmBusyError();
}

export async function withOllamaLock<T>(redisUrl: string | null, fn: () => Promise<T>, waitMs: number): Promise<T> {
  const release = redisUrl ? await acquireRedis(redisUrl, waitMs) : await acquireLocal(waitMs);
  try {
    return await fn();
  } finally {
    release();
  }
}
