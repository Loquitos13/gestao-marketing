import { prisma } from "@/lib/prisma";

const json = (data: unknown) => JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);

export function jsonDownload(data: unknown, filename: string) {
  return new Response(json(data), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

/** Exportação completa de um cliente. Credenciais e tokens nunca são incluídos. */
export async function exportClientData(clientId: string) {
  const where = { clientId };
  const [client, dataSources, campaigns, adMetrics, breakdowns, terms, search, web, seo, organic, budgets, goals, reports, schedules, recommendations, alertRules, alerts, auditLogs] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: clientId } }),
    prisma.dataSource.findMany({ where, include: { connectedAccount: { select: { platform: true, externalId: true, name: true } } } }),
    prisma.campaign.findMany({ where, include: { adGroups: { include: { ads: true } } } }),
    prisma.adMetricDaily.findMany({ where }),
    prisma.campaignBreakdownDaily.findMany({ where }),
    prisma.adsTermDaily.findMany({ where }),
    prisma.searchMetricDaily.findMany({ where }),
    prisma.webAnalyticsDaily.findMany({ where }),
    prisma.seoKeywordSnapshot.findMany({ where }),
    prisma.organicContent.findMany({ where }),
    prisma.budget.findMany({ where }),
    prisma.goal.findMany({ where }),
    prisma.report.findMany({ where, omit: { shareTokenHash: true }, include: { deliveries: true } }),
    prisma.reportSchedule.findMany({ where }),
    prisma.recommendation.findMany({ where }),
    prisma.alertRule.findMany({ where }),
    prisma.alert.findMany({ where }),
    prisma.auditLog.findMany({ where, omit: { ipHash: true } }),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    notice: client.isDemo ? "Cliente de demonstração: todos os dados são SIMULADOS." : undefined,
    client,
    dataSources,
    campaigns,
    metrics: { adMetrics, breakdowns, terms, search, web, seo },
    organicContent: organic,
    budgets,
    goals,
    reports,
    schedules,
    recommendations,
    alertRules,
    alerts,
    auditLogs,
  };
}

/** Dados pessoais do utilizador autenticado (direito de acesso). */
export async function exportUserData(userId: string) {
  const [user, sessions, memberships, clientAccess, auditLogs] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, omit: { passwordHash: true } }),
    prisma.session.findMany({ where: { userId }, omit: { tokenHash: true, ipHash: true } }),
    prisma.organizationMember.findMany({ where: { userId }, include: { organization: { select: { name: true } } } }),
    prisma.clientMember.findMany({ where: { userId }, include: { client: { select: { name: true } } } }),
    prisma.auditLog.findMany({ where: { userId }, omit: { ipHash: true }, orderBy: { createdAt: "desc" }, take: 5000 }),
  ]);
  return { exportedAt: new Date().toISOString(), user, sessions, memberships, clientAccess, auditLogs };
}
