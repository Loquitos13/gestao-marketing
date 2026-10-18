import { logger } from "@/lib/logger";
import { audit } from "@/server/audit";
import { exchangeMetaCode } from "@/server/integrations/meta/graph";
import { saveMetaCredential } from "@/server/integrations/connect";
import { completeOAuth, oauthActor, redirectWith } from "@/server/integrations/oauth-flow";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const actor = await oauthActor();
  const flow = await completeOAuth("meta", sp.get("state"));
  if (!actor || !flow || flow.organizationId !== actor.organizationId) return redirectWith("/integrations", { error: "Pedido OAuth inválido ou expirado. Tente novamente." });
  if (sp.get("error")) return redirectWith(flow.returnTo, { error: `Autorização Meta recusada (${sp.get("error_reason") ?? sp.get("error")}).` });
  const code = sp.get("code");
  if (!code) return redirectWith(flow.returnTo, { error: "Código de autorização em falta." });
  try {
    const token = await exchangeMetaCode(code);
    const rep = await saveMetaCredential(actor.organizationId, token);
    await audit({ organizationId: actor.organizationId, userId: actor.userId, action: "credential.connect", targetId: rep.credentialId, metadata: { provider: "META", found: rep.found, errors: rep.errors.length } });
    return redirectWith(flow.returnTo, {
      connected: "meta",
      found: Object.entries(rep.found).map(([p, n]) => `${p}:${n}`).join(","),
      ...(rep.errors.length ? { warn: rep.errors.map((e) => `${e.platform}: ${e.message}`).join(" | ").slice(0, 500) } : {}),
    });
  } catch (e) {
    logger.error({ error: e instanceof Error ? e.message : String(e) }, "Falha no callback Meta");
    return redirectWith(flow.returnTo, { error: "Não foi possível concluir a ligação à Meta. Verifique a configuração da app e tente novamente." });
  }
}
