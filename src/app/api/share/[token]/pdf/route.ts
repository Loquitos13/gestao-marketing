import { sha256 } from "@/lib/crypto";
import { clientIp } from "@/lib/utils";
import { limitRequest } from "@/server/security/limit";
import { findSharedReport } from "@/server/reports/service";
import { exportReport } from "@/server/reports/export";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Limite por IP e por token: um link partilhado não pode ser usado para gerar PDFs em massa a partir de muitos IPs.
  if (!(await limitRequest(`share:${sha256(clientIp(req.headers)).slice(0, 16)}`, 30, 60_000)).ok || !(await limitRequest(`share:${sha256(token).slice(0, 16)}`, 30, 60_000)).ok) {
    return new Response("Demasiados pedidos", { status: 429 });
  }
  const report = await findSharedReport(token);
  if (!report?.data) return new Response("Link inválido ou expirado", { status: 404 });
  return exportReport(report, "pdf");
}
