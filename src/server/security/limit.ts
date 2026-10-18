import { rateLimitShared, resetRateLimitShared } from "@/lib/rate-limit";
import { getConfig } from "@/server/config/settings";

async function redisUrl(): Promise<string | null> {
  try {
    return (await getConfig()).REDIS_URL ?? null;
  } catch {
    return process.env.REDIS_URL || null;
  }
}

/** Limite partilhado entre instâncias quando há Redis; caso contrário, o balde em memória deste processo. */
export async function limitRequest(key: string, limit: number, windowMs: number) {
  return rateLimitShared(await redisUrl(), key, limit, windowMs);
}

export async function clearLimit(key: string) {
  await resetRateLimitShared(await redisUrl(), key);
}
