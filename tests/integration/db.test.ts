/**
 * Testes de integração contra a base de dados configurada em DATABASE_URL.
 * Criam organizações/clientes temporários e removem-nos no fim. São ignorados se a BD não estiver acessível.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { addDays, todayInTz } from "@/lib/dates";
import { resolveClientAccess, accessibleClientsWhere } from "@/server/auth/tenant";

const prisma = new PrismaClient();
const tag = `it-${Date.now()}`;
let dbOk = false;
const ids = { orgA: "", orgB: "", clientA: "", clientB: "", viewer: "", owner: "" };

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    return;
  }
  const [orgA, orgB] = await Promise.all([prisma.organization.create({ data: { name: "Org A", slug: `${tag}-a` } }), prisma.organization.create({ data: { name: "Org B", slug: `${tag}-b` } })]);
  const [owner, viewer] = await Promise.all([
    prisma.user.create({ data: { email: `${tag}-owner@test.local`, name: "Owner", passwordHash: "x" } }),
    prisma.user.create({ data: { email: `${tag}-viewer@test.local`, name: "Viewer", passwordHash: "x" } }),
  ]);
  await prisma.organizationMember.createMany({ data: [{ organizationId: orgA.id, userId: owner.id, role: "OWNER" }, { organizationId: orgA.id, userId: viewer.id, role: "VIEWER" }] });
  const clientA = await prisma.client.create({ data: { organizationId: orgA.id, name: "Cliente A", slug: "a" } });
  const clientB = await prisma.client.create({ data: { organizationId: orgB.id, name: "Cliente B", slug: "b" } });
  Object.assign(ids, { orgA: orgA.id, orgB: orgB.id, clientA: clientA.id, clientB: clientB.id, owner: owner.id, viewer: viewer.id });
});

afterAll(async () => {
  if (dbOk) {
    await prisma.organization.deleteMany({ where: { slug: { startsWith: tag } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: tag } } });
  }
  await prisma.$disconnect();
});

describe.runIf(process.env.DATABASE_URL)("isolamento entre organizações (BD)", () => {
  it("um proprietário da organização A não acede a clientes da organização B", async ({ skip }) => {
    if (!dbOk) skip();
    const ctx = { organizationId: ids.orgA, role: "OWNER" as const, userId: ids.owner };
    await expect(resolveClientAccess(prisma, ctx, ids.clientA)).resolves.toMatchObject({ id: ids.clientA });
    await expect(resolveClientAccess(prisma, ctx, ids.clientB)).rejects.toMatchObject({ status: 404 });
    const listed = await prisma.client.findMany({ where: accessibleClientsWhere(ctx) });
    expect(listed.map((c) => c.id)).toEqual([ids.clientA]);
  });

  it("um leitor só vê clientes atribuídos explicitamente", async ({ skip }) => {
    if (!dbOk) skip();
    const ctx = { organizationId: ids.orgA, role: "VIEWER" as const, userId: ids.viewer };
    expect(await prisma.client.count({ where: accessibleClientsWhere(ctx) })).toBe(0);
    await expect(resolveClientAccess(prisma, ctx, ids.clientA)).rejects.toMatchObject({ status: 404 });
    await prisma.clientMember.create({ data: { clientId: ids.clientA, userId: ids.viewer } });
    await expect(resolveClientAccess(prisma, ctx, ids.clientA)).resolves.toMatchObject({ id: ids.clientA });
    expect(await prisma.client.count({ where: accessibleClientsWhere(ctx) })).toBe(1);
  });

  it("clientes arquivados ficam inacessíveis", async ({ skip }) => {
    if (!dbOk) skip();
    await prisma.client.update({ where: { id: ids.clientA }, data: { archivedAt: new Date() } });
    await expect(resolveClientAccess(prisma, { organizationId: ids.orgA, role: "OWNER", userId: ids.owner }, ids.clientA)).rejects.toMatchObject({ status: 404 });
    await prisma.client.update({ where: { id: ids.clientA }, data: { archivedAt: null } });
  });
});

describe.runIf(process.env.DATABASE_URL)("relatórios (BD)", () => {
  it("gera relatório com snapshot, partilha por token com hash e entrega honesta sem SMTP", async ({ skip }) => {
    if (!dbOk) skip();
    const demo = await prisma.client.findFirst({ where: { isDemo: true, archivedAt: null } });
    if (!demo) skip();
    const { generateReport, createShareLink, findSharedReport, revokeShareLink, deliverReport } = await import("@/server/reports/service");
    const end = addDays(todayInTz(demo!.timezone), -1);
    const report = await generateReport({ clientId: demo!.id, kind: "CUSTOM", start: addDays(end, -13), end, title: `${tag} teste` });
    try {
      expect(report.status).toBe("GENERATED");
      expect(report.containsSimulated).toBe(true);
      const data = report.data as { origin: string; client: { name: string } };
      expect(data.origin).toBe("SIMULATED");
      expect(JSON.stringify(report.data)).not.toMatch(/accessToken|refreshToken|ya29\.|EAAB/);

      const token = await createShareLink(report.id, 1);
      const stored = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
      expect(stored.shareTokenHash).not.toBe(token);
      expect((await findSharedReport(token))?.id).toBe(report.id);
      expect(await findSharedReport("x".repeat(32))).toBeNull();
      expect(await findSharedReport("../../etc")).toBeNull();
      await prisma.report.update({ where: { id: report.id }, data: { shareExpiresAt: new Date(Date.now() - 1000) } });
      expect(await findSharedReport(token)).toBeNull();
      await revokeShareLink(report.id);

      if (!process.env.SMTP_HOST) {
        const res = await deliverReport(report.id, ["destino@test.local"]);
        expect(res).toEqual([{ to: "destino@test.local", status: "SKIPPED_NOT_CONFIGURED" }]);
        const d = await prisma.reportDelivery.findFirstOrThrow({ where: { reportId: report.id } });
        expect(d.status).toBe("SKIPPED_NOT_CONFIGURED");
        expect(d.sentAt).toBeNull();
      }
    } finally {
      await prisma.report.delete({ where: { id: report.id } });
    }
  }, 120_000);

  it("o primeiro relatório não compara e o seguinte usa o período desse relatório", async ({ skip }) => {
    if (!dbOk) skip();
    const { generateReport, alignReportComparisons } = await import("@/server/reports/service");
    const first = await generateReport({ clientId: ids.clientA, kind: "CUSTOM", start: "2026-01-01", end: "2026-01-31", title: `${tag} jan` });
    const second = await generateReport({ clientId: ids.clientA, kind: "CUSTOM", start: "2026-02-01", end: "2026-02-28", title: `${tag} fev` });
    try {
      expect(first.compareStart).toBeNull();
      expect(first.compareEnd).toBeNull();
      expect((first.data as { compare: unknown }).compare).toBeNull();
      expect(second.compareStart?.toISOString().slice(0, 10)).toBe("2026-01-01");
      expect(second.compareEnd?.toISOString().slice(0, 10)).toBe("2026-01-31");
      await prisma.report.update({ where: { id: first.id }, data: { compareStart: new Date("2025-12-01T00:00:00Z"), compareEnd: new Date("2025-12-31T00:00:00Z") } });
      const aligned = await alignReportComparisons(ids.clientA);
      expect(aligned.updated).toBe(1);
      const again = await prisma.report.findUniqueOrThrow({ where: { id: first.id } });
      expect(again.compareStart).toBeNull();
      expect(again.compareEnd).toBeNull();
    } finally {
      await prisma.report.deleteMany({ where: { id: { in: [first.id, second.id] } } });
    }
  }, 120_000);
});
