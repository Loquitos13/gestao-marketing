import type { GoalMetric, Platform } from "@prisma/client";
import { prisma as db } from "@/lib/prisma";
import { addDays, addMonths, endOfMonth, startOfMonth, todayInTz } from "@/lib/dates";
import { slugify } from "@/lib/utils";
import { hashPassword, passwordPolicyError } from "@/server/auth/password";
import { DEMO_CLIENTS } from "@/demo/specs";
import { writeDemoClient } from "@/demo/persist";
import { writeDemoWorkspace } from "@/demo/workspace";
import { refreshRecommendations } from "@/server/intelligence/engine";
import { evaluateAlerts } from "@/server/alerts/engine";
import { ALL_SECTION_KEYS } from "@/server/reports/sections";
import { generateReport } from "@/server/reports/service";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

const DEFAULT_ALERTS: { type: string; name: string; threshold: number; windowDays?: number; cooldownHours?: number }[] = [
  { type: "CPA_INCREASE", name: "CPA +30% (7 dias)", threshold: 30 },
  { type: "CONVERSIONS_DROP", name: "Conversões −30% (7 dias)", threshold: 30 },
  { type: "ORGANIC_DROP", name: "Cliques orgânicos −25% (14 dias)", threshold: 25, windowDays: 14 },
  { type: "POSITION_DROP", name: "Posição média piora 3 posições", threshold: 3, windowDays: 14 },
  { type: "BUDGET_DEVIATION", name: "Desvio de orçamento > 15%", threshold: 15 },
  { type: "SYNC_FAILURE", name: "Falha de sincronização", threshold: 0, cooldownHours: 12 },
  { type: "TOKEN_EXPIRED", name: "Token a expirar em 7 dias", threshold: 7 },
  { type: "STALE_DATA", name: "Sem dados há mais de 4 dias", threshold: 4 },
  { type: "CAMPAIGN_INACTIVE", name: "Campanha ativa sem impressões (3 dias)", threshold: 3 },
];

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "admin@example.com").toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD ?? "";
  const policy = passwordPolicyError(password);
  if (policy) throw new Error(`ADMIN_PASSWORD inválida: ${policy}`);

  const org = await db.organization.upsert({
    where: { slug: "agencia" },
    update: {},
    create: { name: "A minha agência", slug: "agencia", brandColor: "#4f46e5" },
  });
  const existing = await db.user.findUnique({ where: { email } });
  const user = existing ?? (await db.user.create({ data: { email, name: process.env.ADMIN_NAME ?? "Administrador", passwordHash: await hashPassword(password) } }));
  await db.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
    update: {},
    create: { organizationId: org.id, userId: user.id, role: "OWNER" },
  });

  if (!(await db.reportTemplate.count({ where: { organizationId: org.id } }))) {
    await db.reportTemplate.createMany({
      data: [
        { organizationId: org.id, name: "Relatório completo", description: "Todas as secções", sections: ALL_SECTION_KEYS, isDefault: true },
        { organizationId: org.id, name: "Resumo executivo", description: "Para direção/cliente final", sections: ["cover", "summary", "highlights", "comparison", "goals", "overview", "trends", "recommendations", "limitations"] },
        { organizationId: org.id, name: "Performance paga", description: "Google Ads e Meta Ads", sections: ["cover", "summary", "highlights", "google", "googleMetrics", "meta", "metaMetrics", "ads", "topContent", "creatives", "topCampaigns", "bottomCampaigns", "investment", "conversions", "recommendations", "methodology", "limitations"] },
      ],
    });
  }

  if (process.env.SEED_DEMO === "false") {
    console.log(`Seed concluído (sem demonstração). Utilizador: ${email}`);
    return;
  }

  for (const spec of DEMO_CLIENTS) {
    const client = await db.client.upsert({
      where: { organizationId_slug: { organizationId: org.id, slug: slugify(spec.name) } },
      update: { monthlyBudget: spec.monthlyBudget, grossMargin: spec.grossMargin, objectives: spec.objectives },
      create: {
        organizationId: org.id,
        name: spec.name,
        slug: slugify(spec.name),
        website: spec.website,
        industry: spec.industry,
        contactName: spec.contactName,
        contactEmail: spec.contactEmail,
        objectives: spec.objectives,
        monthlyBudget: spec.monthlyBudget,
        grossMargin: spec.grossMargin,
        currency: spec.currency,
        timezone: spec.timezone,
        isDemo: true,
        internalNotes: "Cliente fictício de demonstração. Todos os dados são SIMULADOS.",
      },
    });
    const anchor = addDays(todayInTz(spec.timezone), -1);
    const res = await writeDemoClient(db, client.id, spec, anchor);
    console.log(`${spec.name}: ${res.rows} linhas simuladas`);

    await db.budget.deleteMany({ where: { clientId: client.id } });
    await db.goal.deleteMany({ where: { clientId: client.id } });
    const googleShare = spec.campaigns.filter((c) => c.platform === "GOOGLE_ADS").reduce((a, c) => a + c.dailyBudget, 0) / spec.campaigns.reduce((a, c) => a + c.dailyBudget, 0);
    for (let m = -3; m <= 0; m++) {
      const start = addMonths(startOfMonth(anchor), m);
      const end = endOfMonth(start);
      const budgets: { platform: Platform | null; amount: number }[] = [
        { platform: null, amount: spec.monthlyBudget },
        { platform: "GOOGLE_ADS", amount: Math.round(spec.monthlyBudget * googleShare) },
        { platform: "META_ADS", amount: Math.round(spec.monthlyBudget * (1 - googleShare)) },
      ];
      await db.budget.createMany({ data: budgets.map((b) => ({ clientId: client.id, platform: b.platform, amount: b.amount, currency: spec.currency, periodStart: d(start), periodEnd: d(end), notes: "Orçamento de demonstração" })) });
      const goals: { metric: GoalMetric; target: number }[] = spec.ecommerce
        ? [{ metric: "REVENUE", target: spec.monthlyBudget * 4 }, { metric: "ROAS_MIN", target: 4 }, { metric: "ORGANIC_CLICKS", target: 4000 }]
        : spec.profile === "b2b"
          ? [{ metric: "LEADS", target: 120 }, { metric: "CPL_MAX", target: 70 }, { metric: "SESSIONS", target: 9000 }]
          : [{ metric: "LEADS", target: 90 }, { metric: "CPA_MAX", target: 45 }, { metric: "AVG_POSITION_MAX", target: 8 }];
      await db.goal.createMany({ data: goals.map((g) => ({ clientId: client.id, metric: g.metric, target: g.target, periodStart: d(start), periodEnd: d(end) })) });
    }

    if (!(await db.alertRule.count({ where: { clientId: client.id } }))) {
      await db.alertRule.createMany({ data: DEFAULT_ALERTS.map((a) => ({ clientId: client.id, type: a.type, name: a.name, threshold: a.threshold, windowDays: a.windowDays ?? 7, cooldownHours: a.cooldownHours ?? 24, recipients: [] })) });
    }
    // Dados de demonstração são regenerados: recomendações e alertas anteriores deixam de ser válidos.
    await db.recommendation.deleteMany({ where: { clientId: client.id } });
    await db.alert.deleteMany({ where: { clientId: client.id } });
    const recs = await refreshRecommendations(client);
    const alerts = await evaluateAlerts(client);
    console.log(`  recomendações: ${JSON.stringify(recs)} · alertas: ${JSON.stringify(alerts)}`);
    await writeDemoWorkspace(db, client.id, spec.key, anchor, user.id);

    if (!(await db.report.count({ where: { clientId: client.id } }))) {
      const lastMonth = addMonths(startOfMonth(anchor), -1);
      await generateReport({ clientId: client.id, kind: "MONTHLY", start: lastMonth, end: endOfMonth(lastMonth), createdById: user.id });
    }
  }
  console.log(`Seed concluído. Inicie sessão com ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
