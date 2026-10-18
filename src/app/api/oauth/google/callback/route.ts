import { logger } from "@/lib/logger";
import { audit } from "@/server/audit";
import { exchangeGoogleCode } from "@/server/integrations/google/oauth";
import { saveGoogleCredential } from "@/server/integrations/connect";
import { completeOAuth, oauthActor, redirectWith } from "@/server/integrations/oauth-flow";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const actor = await oauthActor();
  const flow = await completeOAuth("google", sp.get("state"));
  if (!actor || !flow || flow.organizationId !== actor.organizationId) return redirectWith("/integrations", { error: "Pedido OAuth inválido ou expirado. Tente novamente." });
  if (sp.get("error")) return redirectWith(flow.returnTo, { error: `Autorização Google recusada (${sp.get("error")}).` });
  const code = sp.get("code");
  if (!code) return redirectWith(flow.returnTo, { error: "Código de autorização em falta." });
  try {
    const tokens = await exchangeGoogleCode(code);
    if (!tokens.refresh_token) logger.warn("Google não devolveu refresh token (a autorização pode já existir).");
    const rep = await saveGoogleCredential(actor.organizationId, tokens);
    await audit({ organizationId: actor.organizationId, userId: actor.userId, action: "credential.connect", targetId: rep.credentialId, metadata: { provider: "GOOGLE", found: rep.found, errors: rep.errors.length } });
    return redirectWith(flow.returnTo, {
      connected: "google",
      found: Object.entries(rep.found).map(([p, n]) => `${p}:${n}`).join(","),
      ...(rep.errors.length ? { warn: rep.errors.map((e) => `${e.platform}: ${e.message}`).join(" | ").slice(0, 500) } : {}),
    });
  } catch (e) {
    logger.error({ error: e instanceof Error ? e.message : String(e) }, "Falha no callback Google");
    return redirectWith(flow.returnTo, { error: "Não foi possível concluir a ligação à Google. Verifique a configuração OAuth e tente novamente." });
  }
}
