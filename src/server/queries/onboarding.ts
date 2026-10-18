import { prisma } from "@/lib/prisma";
import { todayInTz } from "@/lib/dates";
import type { Permission } from "@/server/auth/rbac";
import type { ClientContext } from "@/server/queries/context";

export interface OnboardingInput {
  clientId: string;
  hasSources: boolean;
  hasSync: boolean;
  hasPaidSources: boolean;
  hasBudget: boolean;
  hasGoals: boolean;
  hasReport: boolean;
  adsManagementEnabled: boolean;
}

export interface OnboardingStep {
  key: string;
  label: string;
  done: boolean;
  href: string;
  /** Permissão necessária para agir na página de destino. */
  permission: Permission;
}

export function onboardingSteps(i: OnboardingInput) {
  const base = `/c/${i.clientId}`;
  const steps: OnboardingStep[] = [
    { key: "sources", label: "Ligar pelo menos uma conta", done: i.hasSources, href: `${base}/sources`, permission: "integration:manage" },
    { key: "sync", label: "Primeira sincronização concluída", done: i.hasSync, href: `${base}/sources`, permission: "sync:run" },
    { key: "budget", label: "Orçamento mensal definido", done: i.hasBudget, href: `${base}/budget`, permission: "budget:write" },
    { key: "goals", label: "Objetivos definidos", done: i.hasGoals, href: `${base}/settings`, permission: "budget:write" },
    { key: "report", label: "Pelo menos um relatório gerado", done: i.hasReport, href: `${base}/reports/new`, permission: "report:write" },
  ];
  if (i.hasPaidSources) steps.push({ key: "ads", label: "Gestão de anúncios ativada", done: i.adsManagementEnabled, href: `${base}/manage`, permission: "ads:write" });
  return { steps, done: steps.filter((s) => s.done).length, total: steps.length };
}

export async function loadOnboarding(ctx: ClientContext) {
  const { client, sources } = ctx;
  const today = new Date(todayInTz(client.timezone));
  const [budget, goals, reports] = await Promise.all([
    Number(client.monthlyBudget) > 0 ? 1 : prisma.budget.count({ where: { clientId: client.id, platform: null, campaignId: null, periodStart: { lte: today }, periodEnd: { gte: today } }, take: 1 }),
    prisma.goal.count({ where: { clientId: client.id }, take: 1 }),
    prisma.report.count({ where: { clientId: client.id, status: "GENERATED" }, take: 1 }),
  ]);
  return onboardingSteps({
    clientId: client.id,
    hasSources: sources.length > 0,
    hasSync: sources.some((s) => s.lastSuccessfulSyncAt),
    hasPaidSources: sources.some((s) => s.platform === "GOOGLE_ADS" || s.platform === "META_ADS"),
    hasBudget: budget > 0,
    hasGoals: goals > 0,
    hasReport: reports > 0,
    adsManagementEnabled: client.adsManagementEnabled,
  });
}
