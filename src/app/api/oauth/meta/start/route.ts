import { NextResponse } from "next/server";
import { integrationStatus } from "@/server/config/settings";
import { metaAuthUrl } from "@/server/integrations/meta/graph";
import { beginOAuth, oauthActor, redirectWith } from "@/server/integrations/oauth-flow";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const actor = await oauthActor();
  if (!actor) return new Response("Sem permissão para gerir integrações", { status: 403 });
  if (!(await integrationStatus()).meta) return redirectWith("/integrations", { error: "Meta OAuth não configurado: preencha App ID e App secret em Integrações → Configuração." });
  const sp = new URL(req.url).searchParams;
  const state = await beginOAuth("meta", actor.organizationId, sp.get("returnTo") ?? "/integrations");
  return NextResponse.redirect(await metaAuthUrl(state, sp.get("mode") === "manage"));
}
