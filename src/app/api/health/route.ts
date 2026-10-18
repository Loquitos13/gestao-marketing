import { checkWorkerDown, serviceReport } from "@/server/health/status";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verificação de saúde para Docker e para o ecrã de falha. Não expõe endereços nem segredos. */
export async function GET() {
  const services = await serviceReport();
  // Não bloqueia a resposta: o marcador no Redis limita o aviso a um por paragem.
  void checkWorkerDown().catch((e) => logger.warn({ error: e instanceof Error ? e.message : String(e) }, "Falha ao verificar paragem do worker"));
  const error = services.database === "down";
  const degraded = !error && (services.redis === "down" || services.worker === "down" || services.model === "down");
  const status = error ? "error" : degraded ? "degraded" : "ok";
  return Response.json({ status, services }, { status: error ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
