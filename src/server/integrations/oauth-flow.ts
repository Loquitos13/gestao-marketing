import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { getConfig } from "@/server/config/settings";
import { randomToken, sign, unsign } from "@/lib/crypto";
import { safeInternalPath } from "@/lib/utils";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/auth/rbac";

const COOKIE = "mih_oauth";
const TTL_MS = 10 * 60_000;

export async function oauthActor() {
  const user = await getSessionUser();
  if (!user) return null;
  const m = await prisma.organizationMember.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  if (!m || !can(m.role, "integration:manage")) return null;
  return { userId: user.id, organizationId: m.organizationId };
}

/** Gera o parâmetro `state` e guarda-o num cookie assinado e de curta duração (proteção CSRF). */
export async function beginOAuth(provider: "google" | "meta", organizationId: string, returnTo: string) {
  const state = randomToken(24);
  const safeReturn = safeInternalPath(returnTo, "/integrations");
  const payload = Buffer.from(JSON.stringify({ s: state, p: provider, o: organizationId, r: safeReturn, e: Date.now() + TTL_MS })).toString("base64url");
  (await cookies()).set(COOKIE, sign(payload), { httpOnly: true, sameSite: "lax", secure: env().NODE_ENV === "production", path: "/api/oauth", maxAge: TTL_MS / 1000 });
  return state;
}

export async function completeOAuth(provider: "google" | "meta", state: string | null) {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  jar.delete({ name: COOKIE, path: "/api/oauth" });
  if (!raw || !state) return null;
  const payload = unsign(raw);
  if (!payload) return null;
  try {
    const v = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { s: string; p: string; o: string; r: string; e: number };
    if (v.s !== state || v.p !== provider || v.e < Date.now()) return null;
    return { organizationId: v.o, returnTo: v.r };
  } catch {
    return null;
  }
}

export async function redirectWith(path: string, params: Record<string, string>) {
  const url = new URL(path, (await getConfig()).APP_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}
