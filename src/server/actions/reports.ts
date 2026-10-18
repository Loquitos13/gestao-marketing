"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getConfig, integrationStatus } from "@/server/config/settings";
import { requireClient } from "@/server/auth/guard";
import { TenantError } from "@/server/auth/tenant";
import { audit } from "@/server/audit";
import { createShareLink, deliverReport, generateReport, regenerateReport, retryDelivery, revokeShareLink } from "@/server/reports/service";
import { nextRunAt } from "@/server/reports/schedule";
import { ALL_SECTION_KEYS, REPORT_KINDS, type SectionKey } from "@/server/reports/sections";
import { emails, failure, formObject, id, isoDate, type ActionState } from "./util";

const sectionList = z.array(z.enum(ALL_SECTION_KEYS as [SectionKey, ...SectionKey[]])).max(ALL_SECTION_KEYS.length);

async function reportFor(reportId: string, clientId: string, permission: "report:read" | "report:write" | "report:share") {
  const { ctx, client } = await requireClient(clientId, permission);
  const report = await prisma.report.findFirst({ where: { id: reportId, clientId: client.id } });
  if (!report) throw new TenantError("Relatório não encontrado", 404);
  return { ctx, client, report };
}

const createSchema = z
  .object({
    clientId: id,
    title: z.string().trim().max(160).optional(),
    kind: z.enum(Object.keys(REPORT_KINDS) as [keyof typeof REPORT_KINDS, ...(keyof typeof REPORT_KINDS)[]]),
    start: isoDate,
    end: isoDate,
    templateId: id.optional().or(z.literal("")),
    sections: sectionList.optional(),
  })
  .refine((v) => v.end >= v.start, { message: "a data final deve ser posterior à inicial", path: ["end"] });

export async function createReportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const input = createSchema.parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "report:write");
    let sections = input.sections;
    if (!sections?.length && input.templateId) {
      const t = await prisma.reportTemplate.findFirst({ where: { id: input.templateId, organizationId: ctx.organizationId } });
      sections = (t?.sections as SectionKey[]) ?? undefined;
    }
    const r = await generateReport({ clientId: client.id, title: input.title, kind: input.kind, start: input.start, end: input.end, sections, templateId: input.templateId || null, createdById: ctx.userId });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "report.create", targetType: "Report", targetId: r.id });
    target = `/c/${client.id}/reports/${r.id}`;
  } catch (e) {
    return failure(e);
  }
  redirect(target);
}

export async function saveReportComments(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const o = formObject(fd);
    const { clientId, reportId } = z.object({ clientId: id, reportId: id }).parse(o);
    const { ctx, client, report } = await reportFor(reportId, clientId, "report:write");
    const comments: Record<string, string> = {};
    for (const k of ALL_SECTION_KEYS) {
      const v = typeof o[`comment_${k}`] === "string" ? (o[`comment_${k}`] as string).trim().slice(0, 2000) : "";
      if (v) comments[k] = v;
    }
    const title = z.string().trim().min(3).max(160).parse(o.title ?? report.title);
    await regenerateReport(report.id, { comments, title });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "report.update", targetId: report.id });
    revalidatePath(`/c/${client.id}/reports/${report.id}`);
    return { ok: true, message: "Comentários guardados e relatório recalculado." };
  } catch (e) {
    return failure(e);
  }
}

export async function shareReportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z.object({ clientId: id, reportId: id, days: z.coerce.number().int().min(1).max(365) }).parse(formObject(fd));
    const { ctx, client, report } = await reportFor(input.reportId, input.clientId, "report:share");
    const token = await createShareLink(report.id, input.days);
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "report.share", targetId: report.id, metadata: { days: input.days } });
    revalidatePath(`/c/${client.id}/reports/${report.id}`);
    return { ok: true, message: "Link criado. Copie-o agora — por segurança não volta a ser mostrado.", data: { url: `${(await getConfig()).APP_URL}/share/${token}` } };
  } catch (e) {
    return failure(e);
  }
}

export async function revokeShareAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z.object({ clientId: id, reportId: id }).parse(formObject(fd));
    const { ctx, client, report } = await reportFor(input.reportId, input.clientId, "report:share");
    await revokeShareLink(report.id);
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "report.share_revoke", targetId: report.id });
    revalidatePath(`/c/${client.id}/reports/${report.id}`);
    return { ok: true, message: "Link revogado." };
  } catch (e) {
    return failure(e);
  }
}

export async function sendReportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z.object({ clientId: id, reportId: id, recipients: emails }).parse(formObject(fd));
    if (!input.recipients.length) return { ok: false, error: "Indique pelo menos um destinatário." };
    const { ctx, client, report } = await reportFor(input.reportId, input.clientId, "report:share");
    const results = await deliverReport(report.id, input.recipients);
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "report.send", targetId: report.id, metadata: { count: results.length, statuses: results.map((r) => r.status) } });
    revalidatePath(`/c/${client.id}/reports/${report.id}`);
    const sent = results.filter((r) => r.status === "SENT").length;
    if (!(await integrationStatus()).smtp) return { ok: false, error: "Não enviado: o serviço de email (SMTP) não está configurado. A tentativa ficou registada no histórico de envios." };
    if (sent < results.length) return { ok: false, error: `${sent} de ${results.length} enviados. Consulte o histórico de envios para ver as falhas.` };
    return { ok: true, message: `Enviado para ${sent} destinatário(s).` };
  } catch (e) {
    return failure(e);
  }
}

export async function retryDeliveryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z.object({ clientId: id, reportId: id, deliveryId: id }).parse(formObject(fd));
    const { client, report } = await reportFor(input.reportId, input.clientId, "report:share");
    const d = await prisma.reportDelivery.findFirst({ where: { id: input.deliveryId, reportId: report.id } });
    if (!d) return { ok: false, error: "Envio não encontrado." };
    const r = await retryDelivery(d.id);
    revalidatePath(`/c/${client.id}/reports/${report.id}`);
    return r.status === "SENT" ? { ok: true, message: "Reenviado." } : { ok: false, error: r.status === "SKIPPED_NOT_CONFIGURED" ? "SMTP não configurado." : `Falhou: ${r.error ?? ""}` };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteReportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const input = z.object({ clientId: id, reportId: id }).parse(formObject(fd));
    const { ctx, client, report } = await reportFor(input.reportId, input.clientId, "report:write");
    await prisma.report.delete({ where: { id: report.id } });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "report.delete", targetId: report.id });
    target = `/c/${client.id}/reports`;
  } catch (e) {
    return failure(e);
  }
  redirect(target);
}

const scheduleSchema = z.object({
  clientId: id,
  name: z.string().trim().min(2).max(120),
  frequency: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY"]),
  dayOfWeek: z.coerce.number().int().min(1).max(7).optional(),
  hour: z.coerce.number().int().min(0).max(23),
  recipients: emails,
  templateId: id.optional().or(z.literal("")),
});

export async function createScheduleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = scheduleSchema.parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "report:write");
    if (input.templateId && !(await prisma.reportTemplate.findFirst({ where: { id: input.templateId, organizationId: ctx.organizationId } }))) return { ok: false, error: "Modelo inválido." };
    const next = nextRunAt(input.frequency, client.timezone, input.hour, new Date(), input.dayOfWeek ?? 1);
    await prisma.reportSchedule.create({
      data: { clientId: client.id, name: input.name, frequency: input.frequency, dayOfWeek: input.frequency === "WEEKLY" ? (input.dayOfWeek ?? 1) : null, hour: input.hour, recipients: input.recipients, templateId: input.templateId || null, nextRunAt: next },
    });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "report_schedule.create", metadata: { frequency: input.frequency } });
    revalidatePath(`/c/${client.id}/reports`);
    return { ok: true, message: "Agendamento criado." };
  } catch (e) {
    return failure(e);
  }
}

export async function toggleScheduleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z.object({ clientId: id, scheduleId: id, remove: z.string().optional() }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "report:write");
    const s = await prisma.reportSchedule.findFirst({ where: { id: input.scheduleId, clientId: client.id } });
    if (!s) return { ok: false, error: "Agendamento não encontrado." };
    if (input.remove) await prisma.reportSchedule.delete({ where: { id: s.id } });
    else await prisma.reportSchedule.update({ where: { id: s.id }, data: { enabled: !s.enabled, ...(!s.enabled ? { nextRunAt: nextRunAt(s.frequency as "WEEKLY", client.timezone, s.hour, new Date(), s.dayOfWeek ?? 1) } : {}) } });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: input.remove ? "report_schedule.delete" : "report_schedule.toggle", targetId: s.id });
    revalidatePath(`/c/${client.id}/reports`);
    return { ok: true, message: input.remove ? "Removido." : s.enabled ? "Pausado." : "Ativado." };
  } catch (e) {
    return failure(e);
  }
}
