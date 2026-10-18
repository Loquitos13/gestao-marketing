import { integrationStatus } from "@/server/config/settings";
import { googleAuthUrl } from "@/server/integrations/google/oauth";
import { beginOAuth, oauthActor, redirectWith } from "@/server/integrations/oauth-flow";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const actor = await oauthActor();
  if (!actor) return new Response("Sem permissão para gerir integrações", { status: 403 });
  if (!(await integrationStatus()).google) return redirectWith("/integrations", { error: "Google OAuth não configurado: preencha Client ID e Client secret em Integrações → Configuração." });
  const state = await beginOAuth("google", actor.organizationId, new URL(req.url).searchParams.get("returnTo") ?? "/integrations");
  return NextResponse.redirect(await googleAuthUrl(state));
}
