/**
 * Rate limiter de janela deslizante em memória (adequado a uma instância).
 * Para várias instâncias, substituir por implementação em Redis com a mesma interface.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterMs: number } {
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { ok: false, retryAfterMs: windowMs - (now - hits[0]) };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
  }
  return { ok: true, retryAfterMs: 0 };
}

export function resetRateLimit(key: string) {
  buckets.delete(key);
}

/**
 * A mesma janela, no Redis, para várias instâncias e para sobreviver a um reinício.
 * Sem URL, ou se o Redis não responder, usa o balde em memória deste processo.
 */
export async function rateLimitShared(redisUrl: string | null | undefined, key: string, limit: number, windowMs: number, now = Date.now()): Promise<{ ok: boolean; retryAfterMs: number }> {
  if (!redisUrl) return rateLimit(key, limit, windowMs, now);
  const Redis = (await import("ioredis")).default;
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 800, enableOfflineQueue: false, lazyConnect: true });
  redis.on("error", () => undefined);
  const rkey = `mih:rl:${key}`;
  const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;
  try {
    await redis.connect();
    const res = await redis.multi().zremrangebyscore(rkey, 0, now - windowMs).zadd(rkey, now, member).zcard(rkey).pexpire(rkey, windowMs).exec();
    const count = Number(res?.[2]?.[1] ?? 0);
    if (count > limit) {
      await redis.zrem(rkey, member);
      const oldest = await redis.zrange(rkey, 0, 0, "WITHSCORES");
      const oldestAt = Number(oldest[1] ?? now);
      return { ok: false, retryAfterMs: Math.max(0, windowMs - (now - oldestAt)) };
    }
    return { ok: true, retryAfterMs: 0 };
  } catch {
    return rateLimit(key, limit, windowMs, now);
  } finally {
    redis.disconnect();
  }
}

export async function resetRateLimitShared(redisUrl: string | null | undefined, key: string) {
  resetRateLimit(key);
  if (!redisUrl) return;
  const Redis = (await import("ioredis")).default;
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 800, enableOfflineQueue: false, lazyConnect: true });
  redis.on("error", () => undefined);
  try {
    await redis.connect();
    await redis.del(`mih:rl:${key}`);
  } catch {
    // O balde em memória já foi limpo; o do Redis expira sozinho.
  } finally {
    redis.disconnect();
  }
}
