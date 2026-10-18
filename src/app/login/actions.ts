"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { randomToken, sha256 } from "@/lib/crypto";
import { clientIp, safeInternalPath } from "@/lib/utils";
import { clearLimit, limitRequest } from "@/server/security/limit";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, destroySession, getSessionUser } from "@/server/auth/session";
import { audit } from "@/server/audit";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
  next: z.string().max(300).optional(),
});

// Hash de referência para igualar o tempo de resposta quando o utilizador não existe.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(randomToken(16)));

export type LoginState = { error?: string };

export async function login(_: LoginState, form: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ email: form.get("email"), password: form.get("password"), next: form.get("next") || undefined });
  if (!parsed.success) return { error: "Indique um email e uma password válidos." };
  const { email, password, next } = parsed.data;
  const key = `login:${sha256(clientIp(await headers())).slice(0, 16)}:${email}`;
  // Segundo limite só por email: o IP é contornável (proxies, botnets), a conta não.
  const rl = await limitRequest(key, 5, 15 * 60_000);
  const rlEmail = await limitRequest(`login:${email}`, 10, 15 * 60_000);
  if (!rl.ok || !rlEmail.ok) return { error: `Demasiadas tentativas. Tente novamente dentro de ${Math.ceil(Math.max(rl.retryAfterMs, rlEmail.retryAfterMs) / 60_000)} min.` };

  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok) {
    await audit({ action: "auth.login_failed", metadata: { email: email.replace(/^(.).*@/, "$1***@") } });
    return { error: "Credenciais inválidas." };
  }
  await Promise.all([clearLimit(key), clearLimit(`login:${email}`)]);
  await createSession(user.id);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const m = await prisma.organizationMember.findFirst({ where: { userId: user.id } });
  await audit({ organizationId: m?.organizationId, userId: user.id, action: "auth.login" });
  redirect(safeInternalPath(next, "/"));
}

export async function logout() {
  const user = await getSessionUser();
  await destroySession();
  if (user) await audit({ userId: user.id, action: "auth.logout" });
  redirect("/login");
}
