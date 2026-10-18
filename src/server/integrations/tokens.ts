import type { OAuthCredential, PrismaClient } from "@prisma/client";
import { decrypt, encrypt } from "@/lib/crypto";
import { IntegrationError } from "./http";
import { refreshGoogleToken, revokeGoogleToken, type GoogleTokenResponse } from "./google/oauth";
import { revokeMeta } from "./meta/graph";

const REFRESH_MARGIN_MS = 30 * 60 * 1000;

export interface TokenDeps {
  db: Pick<PrismaClient, "oAuthCredential">;
  refreshGoogle?: (refreshToken: string) => Promise<GoogleTokenResponse>;
  now?: () => Date;
}

/**
 * Devolve um access token válido. Google: renova com refresh token quando expira (margem de 30 min, sincronizações longas).
 * invalid_grant → credencial EXPIRED (exige nova autorização). Meta: sem renovação; expirado → EXPIRED.
 */
export async function getValidAccessToken(cred: OAuthCredential, deps: TokenDeps): Promise<string> {
  const now = deps.now?.() ?? new Date();
  if (cred.status === "REVOKED") throw new IntegrationError("Credencial revogada", "AUTH");
  const valid = cred.accessTokenEnc && cred.accessTokenExpiresAt && cred.accessTokenExpiresAt.getTime() - REFRESH_MARGIN_MS > now.getTime();
  if (valid) return decrypt(cred.accessTokenEnc!);

  if (cred.provider === "GOOGLE") {
    if (!cred.refreshTokenEnc) {
      await deps.db.oAuthCredential.update({ where: { id: cred.id }, data: { status: "EXPIRED", lastError: "Sem refresh token" } });
      throw new IntegrationError("Sem refresh token: reautorize a conta Google", "AUTH");
    }
    try {
      const t = await (deps.refreshGoogle ?? refreshGoogleToken)(decrypt(cred.refreshTokenEnc));
      await deps.db.oAuthCredential.update({
        where: { id: cred.id },
        data: {
          accessTokenEnc: encrypt(t.access_token),
          accessTokenExpiresAt: new Date(now.getTime() + t.expires_in * 1000),
          ...(t.refresh_token ? { refreshTokenEnc: encrypt(t.refresh_token) } : {}),
          status: "ACTIVE",
          lastRefreshedAt: now,
          lastError: null,
        },
      });
      return t.access_token;
    } catch (e) {
      const auth = e instanceof IntegrationError && (e.kind === "AUTH" || e.kind === "INVALID_REQUEST");
      // Falhas não-auth (rede, 5xx) não alteram o estado: evita alertas falsos de "requer nova autorização".
      await deps.db.oAuthCredential.update({
        where: { id: cred.id },
        data: { ...(auth ? { status: "EXPIRED" } : {}), lastError: e instanceof Error ? e.message.slice(0, 500) : "Erro na renovação" },
      });
      throw e instanceof IntegrationError ? e : new IntegrationError("Falha na renovação do token", "TRANSIENT");
    }
  }

  if (cred.accessTokenEnc && !cred.accessTokenExpiresAt) return decrypt(cred.accessTokenEnc);
  await deps.db.oAuthCredential.update({ where: { id: cred.id }, data: { status: "EXPIRED", lastError: "Token expirado" } });
  throw new IntegrationError("Token expirado: reautorize a conta", "AUTH");
}

/** Revoga no fornecedor (best effort) e apaga os tokens localmente. */
export async function revokeCredential(cred: OAuthCredential, db: Pick<PrismaClient, "oAuthCredential">) {
  try {
    const token = cred.refreshTokenEnc ? decrypt(cred.refreshTokenEnc) : cred.accessTokenEnc ? decrypt(cred.accessTokenEnc) : null;
    if (token && cred.provider === "GOOGLE") await revokeGoogleToken(token);
    if (token && cred.provider === "META") await revokeMeta(token);
  } finally {
    await db.oAuthCredential.update({
      where: { id: cred.id },
      data: { status: "REVOKED", accessTokenEnc: null, refreshTokenEnc: null, accessTokenExpiresAt: null },
    });
  }
}
