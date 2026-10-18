/**
 * Smoke test local: cria uma sessão temporária para o administrador, percorre todas as páginas
 * e rotas de exportação e reporta códigos HTTP e erros. Uso: npm run smoke (servidor a correr).
 */
import { prisma } from "@/lib/prisma";
import { createHash, randomBytes } from "node:crypto";

const BASE = process.env.SMOKE_URL ?? "http://localhost:3100";

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const user = email ? await prisma.user.findUnique({ where: { email } }) : await prisma.user.findFirst();
  if (!user) throw new Error("Sem utilizador: execute npm run db:seed");
  const token = randomBytes(32).toString("base64url");
  const session = await prisma.session.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600_000), userAgent: "smoke" } });
  const cookie = `mih_session=${token}`;
  const failures: string[] = [];
  try {
    const clients = await prisma.client.findMany({ where: { archivedAt: null }, select: { id: true, name: true } });
    const report = await prisma.report.findFirst({ where: { status: "GENERATED" }, orderBy: { createdAt: "desc" } });
    const urls = ["/", "/clients", "/clients/new", "/integrations", "/alerts", "/jobs", "/settings", "/api/health", "/api/gdpr/me"];
    const sections = ["overview", "google-ads", "meta-ads", "seo", "content", "campaigns", "budget", "recommendations", "alerts", "reports", "reports/new", "history", "sources", "settings"];
    for (const c of clients) for (const s of sections) urls.push(`/c/${c.id}/${s}`);
    if (clients[0]) urls.push(`/c/${clients[0].id}/overview?period=last_90_days&compare=yoy`, `/c/${clients[0].id}/campaigns?channel=google`);
    if (report) {
      urls.push(`/c/${report.clientId}/reports/${report.id}`);
      for (const f of ["pdf", "xlsx", "csv"]) urls.push(`/api/reports/${report.id}/${f}`);
    }
    for (const u of urls) {
      const t0 = Date.now();
      const res = await fetch(BASE + u, { headers: { cookie }, redirect: "manual" });
      const body = await res.arrayBuffer();
      const ms = Date.now() - t0;
      const text = res.headers.get("content-type")?.includes("html") ? new TextDecoder().decode(body) : "";
      const bad = res.status >= 400 || /Application error|Unhandled Runtime Error|NEXT_NOT_FOUND/.test(text);
      console.log(`${bad ? "FAIL" : "ok  "} ${res.status} ${String(ms).padStart(5)}ms ${(body.byteLength / 1024).toFixed(0).padStart(5)}kB ${u}`);
      if (bad) failures.push(u);
    }
    const anon = await fetch(`${BASE}/api/reports/${report?.id ?? "x"}/pdf`, { redirect: "manual" });
    console.log(`${anon.status === 401 ? "ok  " : "FAIL"} ${anon.status} sem sessão → /api/reports (esperado 401)`);
    if (anon.status !== 401) failures.push("anon export");
    const cross = await fetch(`${BASE}/c/inexistente123/overview`, { headers: { cookie }, redirect: "manual" });
    console.log(`${cross.status === 404 ? "ok  " : "FAIL"} ${cross.status} cliente inexistente (esperado 404)`);
    if (cross.status !== 404) failures.push("cross tenant");
  } finally {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
  if (failures.length) {
    console.error(`\n${failures.length} falha(s)`);
    process.exit(1);
  }
  console.log("\nTodas as verificações passaram.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
