"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireClient } from "@/server/auth/guard";
import { audit } from "@/server/audit";
import { checkbox, failure, formObject, id, isoDate, type ActionState } from "./util";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Extensões aceites e tipo MIME servido no download (o tipo enviado pelo browser não é confiável). */
const FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  csv: "text/csv",
  txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
};

const revalidate = (clientId: string) => revalidatePath(`/c/${clientId}`, "layout");

const task = z.object({
  clientId: id,
  title: z.string().trim().min(1, "obrigatório").max(200),
  description: z.string().trim().max(2000).optional(),
  area: z.string().trim().max(60).optional(),
  dueDate: isoDate.optional().or(z.literal("")),
  priority: z.coerce.number().int().min(1).max(3).default(2),
  assigneeId: id.optional().or(z.literal("")),
});

export async function createTask(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = task.parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "workspace:write");
    if (input.assigneeId) {
      const member = await prisma.organizationMember.findFirst({ where: { organizationId: ctx.organizationId, userId: input.assigneeId } });
      if (!member) return { ok: false, error: "Responsável não pertence à organização." };
    }
    const t = await prisma.clientTask.create({
      data: {
        clientId: client.id,
        title: input.title,
        description: input.description || null,
        area: input.area || null,
        dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null,
        priority: input.priority,
        assigneeId: input.assigneeId || null,
        createdById: ctx.userId,
      },
    });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "task.create", targetType: "ClientTask", targetId: t.id, metadata: { title: t.title } });
    revalidate(client.id);
    return { ok: true, message: "Tarefa criada." };
  } catch (e) {
    return failure(e);
  }
}

export async function toggleTask(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z.object({ clientId: id, taskId: id, done: checkbox }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "workspace:write");
    const t = await prisma.clientTask.findFirst({ where: { id: input.taskId, clientId: client.id } });
    if (!t) return { ok: false, error: "Tarefa não encontrada." };
    await prisma.clientTask.update({ where: { id: t.id }, data: input.done ? { status: "DONE", completedAt: new Date() } : { status: "OPEN", completedAt: null } });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: input.done ? "task.complete" : "task.reopen", targetType: "ClientTask", targetId: t.id, metadata: { title: t.title } });
    revalidate(client.id);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteTask(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z.object({ clientId: id, taskId: id }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "workspace:write");
    const t = await prisma.clientTask.findFirst({ where: { id: input.taskId, clientId: client.id } });
    if (!t) return { ok: false, error: "Tarefa não encontrada." };
    await prisma.clientTask.delete({ where: { id: t.id } });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "task.delete", targetId: t.id, metadata: { title: t.title } });
    revalidate(client.id);
    return { ok: true, message: "Tarefa eliminada." };
  } catch (e) {
    return failure(e);
  }
}

export async function createNote(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z.object({ clientId: id, body: z.string().trim().min(1, "obrigatório").max(5000), pinned: checkbox.optional() }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "workspace:write");
    const n = await prisma.clientNote.create({ data: { clientId: client.id, body: input.body, pinned: input.pinned ?? false, authorId: ctx.userId } });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "note.create", targetType: "ClientNote", targetId: n.id });
    revalidate(client.id);
    return { ok: true, message: "Nota guardada." };
  } catch (e) {
    return failure(e);
  }
}

export async function pinNote(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z.object({ clientId: id, noteId: id, pinned: checkbox }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "workspace:write");
    const r = await prisma.clientNote.updateMany({ where: { id: input.noteId, clientId: client.id }, data: { pinned: input.pinned } });
    if (!r.count) return { ok: false, error: "Nota não encontrada." };
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: input.pinned ? "note.pin" : "note.unpin", targetId: input.noteId });
    revalidate(client.id);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteNote(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z.object({ clientId: id, noteId: id }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "workspace:write");
    const r = await prisma.clientNote.deleteMany({ where: { id: input.noteId, clientId: client.id } });
    if (!r.count) return { ok: false, error: "Nota não encontrada." };
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "note.delete", targetId: input.noteId });
    revalidate(client.id);
    return { ok: true, message: "Nota eliminada." };
  } catch (e) {
    return failure(e);
  }
}

const safeName = (n: string) =>
  n
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .slice(-180);

export async function uploadFile(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z.object({ clientId: id, description: z.string().trim().max(300).optional() }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "workspace:write");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Escolha um ficheiro." };
    if (file.size > MAX_FILE_BYTES) return { ok: false, error: "O ficheiro excede 10 MB." };
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const mime = FILE_TYPES[ext];
    if (!mime) return { ok: false, error: `Tipo de ficheiro não permitido. Aceites: ${Object.keys(FILE_TYPES).join(", ")}.` };
    const buf = Buffer.from(await file.arrayBuffer());
    const f = await prisma.clientFile.create({
      data: {
        clientId: client.id,
        name: safeName(file.name),
        description: input.description || null,
        mimeType: mime,
        size: buf.length,
        sha256: createHash("sha256").update(buf).digest("hex"),
        data: buf,
        uploadedById: ctx.userId,
      },
      select: { id: true, name: true },
    });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "file.upload", targetType: "ClientFile", targetId: f.id, metadata: { name: f.name, size: buf.length } });
    revalidate(client.id);
    return { ok: true, message: "Ficheiro carregado." };
  } catch (e) {
    return failure(e);
  }
}

export async function addFileLink(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z
      .object({
        clientId: id,
        name: z.string().trim().min(1, "obrigatório").max(180),
        url: z
          .string()
          .trim()
          .url("URL inválido")
          .max(2000)
          .refine((u) => /^https?:\/\//i.test(u), "apenas ligações http(s)"),
        description: z.string().trim().max(300).optional(),
      })
      .parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "workspace:write");
    const f = await prisma.clientFile.create({ data: { clientId: client.id, name: input.name, url: input.url, description: input.description || null, uploadedById: ctx.userId }, select: { id: true } });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "file.link", targetType: "ClientFile", targetId: f.id, metadata: { name: input.name } });
    revalidate(client.id);
    return { ok: true, message: "Ligação adicionada." };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteFile(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = z.object({ clientId: id, fileId: id }).parse(formObject(fd));
    const { ctx, client } = await requireClient(input.clientId, "workspace:write");
    const f = await prisma.clientFile.findFirst({ where: { id: input.fileId, clientId: client.id }, select: { id: true, name: true } });
    if (!f) return { ok: false, error: "Ficheiro não encontrado." };
    await prisma.clientFile.delete({ where: { id: f.id } });
    await audit({ organizationId: ctx.organizationId, clientId: client.id, userId: ctx.userId, action: "file.delete", targetId: f.id, metadata: { name: f.name } });
    revalidate(client.id);
    return { ok: true, message: "Ficheiro removido." };
  } catch (e) {
    return failure(e);
  }
}
