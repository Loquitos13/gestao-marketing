import { getSessionUser } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { exportUserData, jsonDownload } from "@/server/gdpr";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return new Response("Não autenticado", { status: 401 });
  const data = await exportUserData(user.id);
  await audit({ userId: user.id, action: "gdpr.export.self", targetId: user.id });
  return jsonDownload(data, `dados-pessoais-${new Date().toISOString().slice(0, 10)}.json`);
}
