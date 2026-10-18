import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { randomToken, sha256 } from "@/lib/crypto";
import { todayInTz } from "@/lib/dates";
import { formatRange } from "@/lib/format";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/server/notify/email";
import { buildReportData, comparisonWindow, type ReportData } from "./build";
import { renderReportPdf } from "./pdf";
import { nextRunAt, periodForRun, type Frequency } from "./schedule";
import { ALL_SECTION_KEYS, REPORT_KINDS, type SectionKey } from "./sections";

export interface CreateReportInput {
  clientId: string;
  title?: string;
  kind: keyof typeof REPORT_KINDS;
  start: string;
  end: string;
  sections?: SectionKey[];
  comments?: Record<string, string>;
  templateId?: string | null;
  scheduleId?: string | null;
  createdById?: string | null;
}

export async function generateReport(input: CreateReportInput) {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: input.clientId }, include: { organization: true } });
  const sections = input.sections?.length ? input.sections : ALL_SECTION_KEYS;
  const data = await buildReportData(client.organization, client, { start: input.start, end: input.end }, sections, input.comments ?? {});
  const title = input.title?.trim() || `Relatório ${REPORT_KINDS[input.kind].toLowerCase()} · ${formatRange(input.start, input.end, data.fmt)}`;
  return prisma.report.create({
    data: {
      clientId: client.id,
      templateId: input.templateId ?? null,
      scheduleId: input.scheduleId ?? null,
      title,
      kind: input.kind,
      periodStart: new Date(`${input.start}T00:00:00Z`),
      periodEnd: new Date(`${input.end}T00:00:00Z`),
      compareStart: data.compare ? new Date(`${data.compare.start}T00:00:00Z`) : null,
      compareEnd: data.compare ? new Date(`${data.compare.end}T00:00:00Z`) : null,
      sections,
      comments: input.comments ?? {},
      status: "GENERATED",
      data: data as unknown as Prisma.InputJsonValue,
      containsSimulated: data.origin === "SIMULATED" || data.origin === "MIXED",
      generatedAt: new Date(),
      createdById: input.createdById ?? null,
    },
  });
}

/** Recalcula o snapshot (ex.: após editar comentários ou secções) mantendo o mesmo relatório. */
export async function regenerateReport(reportId: string, patch: { sections?: SectionKey[]; comments?: Record<string, string>; title?: string }) {
  const r = await prisma.report.findUniqueOrThrow({ where: { id: reportId }, include: { client: { include: { organization: true } } } });
  const sections = patch.sections ?? (r.sections as SectionKey[]);
  const comments = patch.comments ?? ((r.comments as Record<string, string>) || {});
  const data = await buildReportData(r.client.organization, r.client, { start: r.periodStart.toISOString().slice(0, 10), end: r.periodEnd.toISOString().slice(0, 10) }, sections, comments, reportId);
  return prisma.report.update({
    where: { id: reportId },
    data: {
      sections,
      comments,
      title: patch.title ?? r.title,
      compareStart: data.compare ? new Date(`${data.compare.start}T00:00:00Z`) : null,
      compareEnd: data.compare ? new Date(`${data.compare.end}T00:00:00Z`) : null,
      data: data as unknown as Prisma.InputJsonValue,
      generatedAt: new Date(),
      status: "GENERATED",
      containsSimulated: data.origin !== "REAL" && data.origin !== "NONE",
    },
  });
}

/** Cria um link partilhável. Apenas o hash do token é guardado. */
export async function createShareLink(reportId: string, days = 30) {
  const token = randomToken(24);
  await prisma.report.update({ where: { id: reportId }, data: { shareTokenHash: sha256(token), shareExpiresAt: new Date(Date.now() + days * 86_400_000) } });
  return token;
}

export async function revokeShareLink(reportId: string) {
  await prisma.report.update({ where: { id: reportId }, data: { shareTokenHash: null, shareExpiresAt: null } });
}

export async function findSharedReport(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const r = await prisma.report.findFirst({ where: { shareTokenHash: sha256(token), client: { archivedAt: null } } });
  if (!r || !r.shareExpiresAt || r.shareExpiresAt < new Date()) return null;
  return r;
}

export async function reportPdfBuffer(reportId: string) {
  const r = await prisma.report.findUniqueOrThrow({ where: { id: reportId } });
  if (!r.data) throw new Error("Relatório sem dados gerados");
  return { buffer: await renderReportPdf(r.data as unknown as ReportData, r.title), report: r };
}

/**
 * Entrega por email. Cada destinatário tem um registo ReportDelivery com estado real:
 * SENT apenas após confirmação do servidor SMTP; SKIPPED_NOT_CONFIGURED se não houver SMTP.
 */
export async function deliverReport(reportId: string, recipients: string[]) {
  const { buffer, report } = await reportPdfBuffer(reportId);
  const results = [];
  for (const to of recipients) {
    const delivery = await prisma.reportDelivery.create({ data: { reportId, recipient: to, status: "PENDING", attempts: 0 } });
    const res = await sendEmail({
      to,
      subject: report.title,
      text: `Segue em anexo o relatório "${report.title}".${report.containsSimulated ? "\n\nATENÇÃO: contém dados simulados." : ""}`,
      attachments: [{ filename: `${report.title.replace(/[^\w\-]+/g, "_").slice(0, 80)}.pdf`, content: buffer, contentType: "application/pdf" }],
    });
    await prisma.reportDelivery.update({
      where: { id: delivery.id },
      data: { status: res.status, attempts: { increment: 1 }, error: res.status === "FAILED" ? res.error.slice(0, 500) : null, sentAt: res.status === "SENT" ? new Date() : null },
    });
    results.push({ to, status: res.status });
  }
  return results;
}

export async function retryDelivery(deliveryId: string) {
  const d = await prisma.reportDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  const { buffer, report } = await reportPdfBuffer(d.reportId);
  const res = await sendEmail({ to: d.recipient, subject: report.title, text: `Segue em anexo o relatório "${report.title}".`, attachments: [{ filename: "relatorio.pdf", content: buffer, contentType: "application/pdf" }] });
  return prisma.reportDelivery.update({
    where: { id: deliveryId },
    data: { status: res.status, attempts: { increment: 1 }, error: res.status === "FAILED" ? res.error.slice(0, 500) : null, sentAt: res.status === "SENT" ? new Date() : null },
  });
}

/** Executa agendamentos vencidos. Idempotente: nextRunAt avança antes da geração. */
export async function runDueSchedules(now = new Date()) {
  const due = await prisma.reportSchedule.findMany({ where: { enabled: true, nextRunAt: { lte: now } }, include: { client: true } });
  const out = [];
  for (const sch of due) {
    const freq = sch.frequency as Frequency;
    const dueAt = sch.nextRunAt;
    await prisma.reportSchedule.update({ where: { id: sch.id }, data: { lastRunAt: now, nextRunAt: nextRunAt(freq, sch.client.timezone, sch.hour, now, sch.dayOfWeek ?? 1) } });
    try {
      // Período a partir da hora prevista: uma execução atrasada continua a cobrir a semana/mês certos.
      const period = periodForRun(freq, todayInTz(sch.client.timezone, dueAt));
      const template = sch.templateId ? await prisma.reportTemplate.findUnique({ where: { id: sch.templateId } }) : null;
      const report = await generateReport({ clientId: sch.clientId, kind: period.kind as CreateReportInput["kind"], start: period.start, end: period.end, sections: (template?.sections as SectionKey[]) ?? undefined, templateId: sch.templateId, scheduleId: sch.id });
      const deliveries = sch.recipients.length ? await deliverReport(report.id, sch.recipients) : [];
      out.push({ scheduleId: sch.id, reportId: report.id, deliveries });
    } catch (e) {
      logger.error({ scheduleId: sch.id, error: e instanceof Error ? e.message : String(e) }, "Falha no relatório agendado");
      // Nova tentativa em 30 min em vez de perder a execução até ao próximo ciclo.
      await prisma.reportSchedule.update({ where: { id: sch.id }, data: { nextRunAt: new Date(now.getTime() + 30 * 60_000) } }).catch(() => undefined);
      out.push({ scheduleId: sch.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Recalcula só os relatórios cuja comparação gravada não é o período do último relatório anterior.
 * O primeiro de cada cliente fica sem comparação. A ordem é do período mais antigo para o mais recente.
 */
export async function alignReportComparisons(clientId?: string) {
  const rows = await prisma.report.findMany({
    where: { status: "GENERATED", ...(clientId ? { clientId } : {}) },
    select: { id: true, clientId: true, periodStart: true, periodEnd: true, compareStart: true, compareEnd: true, generatedAt: true },
    orderBy: [{ periodStart: "asc" }, { generatedAt: "asc" }],
  });
  const byClient = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byClient.get(r.clientId) ?? [];
    list.push(r);
    byClient.set(r.clientId, list);
  }
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  for (const list of byClient.values()) {
    for (const r of list) {
      const expected = comparisonWindow(
        r.periodStart.toISOString().slice(0, 10),
        list.map((x) => ({ id: x.id, start: x.periodStart.toISOString().slice(0, 10), end: x.periodEnd.toISOString().slice(0, 10), generatedAt: x.generatedAt?.getTime() ?? 0 })),
        r.id,
        r.periodEnd.toISOString().slice(0, 10),
      );
      const same = day(r.compareStart) === (expected?.start ?? null) && day(r.compareEnd) === (expected?.end ?? null);
      if (same) {
        unchanged++;
        continue;
      }
      try {
        await regenerateReport(r.id, {});
        updated++;
      } catch (e) {
        failed++;
        logger.error({ reportId: r.id, error: e instanceof Error ? e.message : String(e) }, "Falha ao alinhar a comparação do relatório");
      }
    }
  }
  return { updated, unchanged, failed };
}
