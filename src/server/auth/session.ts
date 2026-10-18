import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { randomToken, sha256 } from "@/lib/crypto";

export const SESSION_COOKIE = "mih_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 15 * 60 * 1000;

export async function createSession(userId: string): Promise<void> {
  const token = randomToken(32);
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: h.get("user-agent")?.slice(0, 200) ?? null,
      ipHash: ip ? sha256(ip).slice(0, 16) : null,
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export const getSessionUser = cache(async () => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { id: true, email: true, name: true, locale: true } } },
  });
  if (!session || session.expiresAt < new Date()) return null;
  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  return session.user;
});

/** Termina todas as sessões do utilizador exceto a atual. */
export async function destroyOtherSessions(userId: string): Promise<number> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const r = await prisma.session.deleteMany({ where: { userId, ...(token ? { NOT: { tokenHash: sha256(token) } } : {}) } });
  return r.count;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}
