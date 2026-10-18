import { serviceReport } from "@/server/health/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verificação de saúde para Docker e para o ecrã de falha. Não expõe endereços nem segredos. */
export async function GET() {
  const services = await serviceReport();
  const error = services.database === "down";
  const degraded = !error && (services.redis === "down" || services.worker === "down" || services.model === "down");
  const status = error ? "error" : degraded ? "degraded" : "ok";
  return Response.json({ status, services }, { status: error ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
