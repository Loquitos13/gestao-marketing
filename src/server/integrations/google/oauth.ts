import { getConfig } from "@/server/config/settings";
import { IntegrationError, requestJson } from "../http";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/adwords",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
];

export async function googleRedirectUri() {
  return `${(await getConfig()).APP_URL}/api/oauth/google/callback`;
}

export async function googleAuthUrl(state: string): Promise<string> {
  const c = await getConfig();
  if (!c.GOOGLE_CLIENT_ID) throw new IntegrationError("GOOGLE_CLIENT_ID não configurado", "CONFIG");
  const p = new URLSearchParams({
    client_id: c.GOOGLE_CLIENT_ID,
    redirect_uri: await googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token?: string;
}

const classifyOAuth = (_status: number, body: unknown) => ((body as { error?: string } | null)?.error === "invalid_grant" ? ("AUTH" as const) : null);

export async function exchangeGoogleCode(code: string): Promise<GoogleTokenResponse> {
  const c = await getConfig();
  return requestJson<GoogleTokenResponse>("https://oauth2.googleapis.com/token", {
    form: {
      code,
      client_id: c.GOOGLE_CLIENT_ID ?? "",
      client_secret: c.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: await googleRedirectUri(),
      grant_type: "authorization_code",
    },
    maxRetries: 1,
  });
}

export async function refreshGoogleToken(refreshToken: string, fetchImpl?: typeof fetch): Promise<GoogleTokenResponse> {
  const c = await getConfig();
  return requestJson<GoogleTokenResponse>("https://oauth2.googleapis.com/token", {
    form: {
      refresh_token: refreshToken,
      client_id: c.GOOGLE_CLIENT_ID ?? "",
      client_secret: c.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    },
    classify: classifyOAuth,
    maxRetries: 2,
    fetchImpl,
  });
}

export async function revokeGoogleToken(token: string): Promise<void> {
  await requestJson("https://oauth2.googleapis.com/revoke", { form: { token }, maxRetries: 1 }).catch(() => undefined);
}

/** Lê o email do id_token (sem validar assinatura: apenas informativo, nunca usado para autenticação). */
export function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}
