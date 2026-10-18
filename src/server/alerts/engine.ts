import type { AlertRule, Client, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDays, dayCount, todayInTz } from "@/lib/dates";
import { formatValue } from "@/lib/format";
import { delta } from "@/server/metrics/calc";
import { dataUntil, loadClientContext, type ClientContext } from "@/server/queries/context";
import { paidTotals, queryPaid } from "@/server/queries/paid";
import { searchTotals } from "@/server/queries/seo";
import { loadBudgets } from "@/server/queries/budget";
import { sendEmail } from "@/server/notify/email";
import { ALERT_TYPES, exceeds, severityFor, shouldNotify, type AlertFinding, type AlertType } from "./evaluate";

async function evaluateRule(rule: AlertRule, ctx: ClientContext, now: Date): Promise<AlertFinding[]> {
  const c = ctx.client;
  const fmt = ctx.fmt;
  const yesterday = addDays(todayInTz(c.timezone, now), -1);
  const end = dataUntil(ctx, ctx.sources.map((s) => s.platform), yesterday);
  const w = rule.windowDays;
  const cur = { start: addDays(end, -(w - 1)), end };
  const prev = { start: addDays(cur.start, -w), end: addDays(cur.start, -1) };
  const platforms = rule.platform === "GOOGLE_ADS" || rule.platform === "META_ADS" ? [rule.platform] : (["GOOGLE_ADS", "META_ADS"] as const).filter((p) => ctx.has[p]);
  const base = { clientId: c.id, clientCurrency: c.currency, platforms: [...platforms] };
  const t = rule.threshold;
  const pctT = t / 100;
  const label = `${w} dias`;

  switch (rule.type as AlertType) {
    case "CPA_INCREASE":
    case "CONVERSIONS_DROP":
    case "KPI_CHANGE": {
      if (!platforms.length) return [];
      const [a, b] = await Promise.all([paidTotals({ ...base, ...cur }), paidTotals({ ...base, ...prev })]);
      if (rule.type === "CPA_INCREASE" && exceeds(a.derived.cpa, b.derived.cpa, pctT, "up") && (b.totals.conversions ?? 0) >= 5) {
        const d = delta(a.derived.cpa, b.derived.cpa);
        return [{ fingerprint: `cpa:${platforms.join("+")}`, severity: severityFor(d.pct, pctT), title: `CPA subiu ${formatValue(d.pct, "percent", fmt)}`, message: `CPA ${formatValue(d.current, "currency", fmt)} vs ${formatValue(d.previous, "currency", fmt)} (últimos ${label} vs anteriores).`, context: d as unknown as Record<string, unknown> }];
      }
      if (rule.type === "CONVERSIONS_DROP" && exceeds(a.totals.conversions, b.totals.conversions, pctT, "down", 5)) {
        const d = delta(a.totals.conversions, b.totals.conversions);
        return [{ fingerprint: `conv_drop:${platforms.join("+")}`, severity: severityFor(d.pct, pctT), title: `Conversões caíram ${formatValue(d.pct, "percent", fmt)}`, message: `${formatValue(d.current, "number", fmt)} vs ${formatValue(d.previous, "number", fmt)} conversões (últimos ${label}).`, context: d as unknown as Record<string, unknown> }];
      }
      if (rule.type === "KPI_CHANGE") {
        const out: AlertFinding[] = [];
        for (const [k, l, cv, pv] of [
          ["cost", "Investimento", a.totals.cost, b.totals.cost],
          ["clicks", "Cliques", a.totals.clicks, b.totals.clicks],
          ["conversions", "Conversões", a.totals.conversions, b.totals.conversions],
        ] as const) {
          if (exceeds(cv, pv, pctT, "both", 10)) {
            const d = delta(cv, pv);
            out.push({ fingerprint: `kpi:${k}`, severity: "INFO", title: `${l} variou ${formatValue(d.pct, "percent", fmt)}`, message: `Últimos ${label} vs ${label} anteriores.`, context: d as unknown as Record<string, unknown> });
          }
        }
        return out;
      }
      return [];
    }
    case "ORGANIC_DROP":
    case "POSITION_DROP": {
      if (!ctx.has.SEARCH_CONSOLE) return [];
      const [a, b] = await Promise.all([searchTotals(c.id, cur.start, cur.end), searchTotals(c.id, prev.start, prev.end)]);
      if (rule.type === "ORGANIC_DROP" && exceeds(a.clicks, b.clicks, pctT, "down", 50)) {
        const d = delta(a.clicks, b.clicks);
        return [{ fingerprint: "organic_drop", severity: severityFor(d.pct, pctT), title: `Cliques orgânicos caíram ${formatValue(d.pct, "percent", fmt)}`, message: `${d.current} vs ${d.previous} cliques (Search Console, últimos ${label}).` }];
      }
      if (rule.type === "POSITION_DROP" && a.position !== null && b.position !== null && a.position - b.position >= t) {
        return [{ fingerprint: "position_drop", severity: "WARNING", title: `Posição média piorou ${formatValue(a.position - b.position, "position", fmt)} posições`, message: `${formatValue(a.position, "position", fmt)} vs ${formatValue(b.position, "position", fmt)} (últimos ${label}).` }];
      }
      return [];
    }
    case "BUDGET_DEVIATION": {
      const { budgets, asOf } = await loadBudgets(ctx, todayInTz(c.timezone, now));
      return budgets
        .filter((b) => b.periodStart <= asOf && b.periodEnd > asOf && b.pacing.projectedVariancePct !== null && Math.abs(b.pacing.projectedVariancePct) >= pctT)
        .map((b) => ({
          fingerprint: `budget:${b.id}`,
          severity: Math.abs(b.pacing.projectedVariancePct!) >= pctT * 2 ? ("CRITICAL" as const) : ("WARNING" as const),
          title: `Orçamento ${b.scope}: projeção ${formatValue(b.pacing.projectedVariancePct, "percent", fmt)} face ao definido`,
          message: `Projeção ${formatValue(b.pacing.projection, "currency", fmt)} para orçamento de ${formatValue(b.pacing.amount, "currency", fmt)}.`,
        }));
    }
    case "SYNC_FAILURE":
      return ctx.sources
        .filter((s) => s.status === "ERROR")
        .map((s) => ({ fingerprint: `sync:${s.id}`, severity: "CRITICAL" as const, title: `Falha de sincronização: ${s.name}`, message: s.lastError ?? "Erro desconhecido" }));
    case "STALE_DATA":
      return ctx.sources
        .filter((s) => s.platform !== "META_ORGANIC" && (!s.dataAvailableUntil || dayCount(s.dataAvailableUntil, yesterday) - 1 > t))
        .map((s) => ({ fingerprint: `stale:${s.id}`, severity: "WARNING" as const, title: `Sem dados recentes: ${s.name}`, message: `Última data disponível: ${s.dataAvailableUntil ?? "nenhuma"}.` }));
    case "TOKEN_EXPIRED": {
      const ids = ctx.sources.map((s) => s.id);
      const creds = await prisma.oAuthCredential.findMany({
        where: { connectedAccounts: { some: { dataSources: { some: { id: { in: ids } } } } } },
      });
      const limit = now.getTime() + t * 86_400_000;
      return creds
        .filter((cr) => cr.status !== "ACTIVE" || (cr.provider === "META" && cr.accessTokenExpiresAt && cr.accessTokenExpiresAt.getTime() < limit))
        .map((cr) => ({ fingerprint: `token:${cr.id}`, severity: "CRITICAL" as const, title: `Credencial ${cr.provider} requer nova autorização`, message: cr.status !== "ACTIVE" ? `Estado: ${cr.status}. ${cr.lastError ?? ""}` : `Expira em ${cr.accessTokenExpiresAt?.toISOString().slice(0, 10)}.` }));
    }
    case "CAMPAIGN_INACTIVE": {
      if (!platforms.length) return [];
      const rows = await queryPaid({ ...base, start: addDays(end, -(t - 1)), end, groupBy: "campaign" });
      const active = await prisma.campaign.findMany({ where: { clientId: c.id, status: { in: ["ENABLED", "ACTIVE"] }, platform: { in: [...platforms] } } });
      return active
        .filter((camp) => !rows.rows.some((r) => r.key === camp.externalId && r.totals.impressions > 0))
        .map((camp) => ({ fingerprint: `inactive:${camp.externalId}`, severity: "WARNING" as const, title: `Campanha ativa sem impressões: ${camp.name}`, message: `Sem impressões nos últimos ${t} dias.` }));
    }
    default:
      return [];
  }
}

/** Por regra (não por tipo): duas regras do mesmo tipo (ex.: KPI Google vs Meta) não partilham nem resolvem o alerta uma da outra. */
export const alertFingerprint = (rule: Pick<AlertRule, "id">, f: Pick<AlertFinding, "fingerprint">) => `${rule.id}:${f.fingerprint}`;

/**
 * Avalia regras de alerta com deduplicação (fingerprint por cliente), contagem de ocorrências,
 * período de silêncio (cooldown) e resolução automática quando a condição deixa de se verificar.
 */
export async function evaluateAlerts(client: Client, now = new Date()) {
  const ctx = await loadClientContext(client);
  const rules = await prisma.alertRule.findMany({ where: { clientId: client.id, enabled: true } });
  let opened = 0;
  let notified = 0;
  for (const rule of rules) {
    const findings = await evaluateRule(rule, ctx, now);
    const fps = new Set(findings.map((f) => alertFingerprint(rule, f)));
    for (const f of findings) {
      const fingerprint = alertFingerprint(rule, f);
      const existing = await prisma.alert.findUnique({ where: { clientId_fingerprint: { clientId: client.id, fingerprint } } });
      let alertId: string;
      let lastNotifiedAt: Date | null = null;
      if (existing && existing.status !== "RESOLVED") {
        await prisma.alert.update({ where: { id: existing.id }, data: { lastSeenAt: now, occurrences: { increment: 1 }, title: f.title, message: f.message, severity: f.severity, context: (f.context ?? undefined) as Prisma.InputJsonValue | undefined } });
        alertId = existing.id;
        lastNotifiedAt = existing.lastNotifiedAt;
      } else if (existing) {
        await prisma.alert.update({ where: { id: existing.id }, data: { status: "OPEN", resolvedAt: null, lastSeenAt: now, firstSeenAt: now, occurrences: 1, title: f.title, message: f.message, severity: f.severity } });
        alertId = existing.id;
        lastNotifiedAt = existing.lastNotifiedAt;
        opened++;
      } else {
        const a = await prisma.alert.create({
          data: { clientId: client.id, ruleId: rule.id, type: rule.type, fingerprint, severity: f.severity, title: f.title, message: f.message, context: (f.context ?? undefined) as Prisma.InputJsonValue | undefined, firstSeenAt: now, lastSeenAt: now },
        });
        alertId = a.id;
        opened++;
      }
      if (rule.recipients.length && shouldNotify(lastNotifiedAt, rule.cooldownHours, now)) {
        let anySent = false;
        for (const to of rule.recipients) {
          const r = await sendEmail({ to, subject: `[${client.name}] ${f.title}`, text: `${f.message}\n\nRegra: ${rule.name} (${ALERT_TYPES[rule.type as AlertType]?.label ?? rule.type})` });
          if (r.status === "SENT") anySent = true;
        }
        if (anySent) {
          await prisma.alert.update({ where: { id: alertId }, data: { lastNotifiedAt: now } });
          notified++;
        }
      }
    }
    // Resolução automática de alertas desta regra que já não se verificam
    await prisma.alert.updateMany({
      where: { clientId: client.id, ruleId: rule.id, status: { in: ["OPEN", "ACKNOWLEDGED"] }, fingerprint: { notIn: [...fps] } },
      data: { status: "RESOLVED", resolvedAt: now },
    });
  }
  return { rules: rules.length, opened, notified };
}
