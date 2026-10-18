"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/server/auth/guard";
import { audit } from "@/server/audit";
import { failure, formObject, id, isoDate, type ActionState } from "./util";

const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "código ISO de 3 letras");

const rateSchema = z
  .object({
    date: isoDate,
    base: currency,
    quote: currency,
    rate: z.coerce.number().finite().positive().max(1e6),
    source: z.string().trim().min(3, "indique a fonte da taxa").max(200),
  })
  .refine((v) => v.base !== v.quote, { message: "moedas iguais", path: ["quote"] });

/** Taxas de câmbio usadas na conversão de custos de contas noutra moeda. A fonte é obrigatória. */
export async function addExchangeRateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requirePermission("org:manage");
    const v = rateSchema.parse(formObject(fd));
    const date = new Date(`${v.date}T00:00:00Z`);
    await prisma.exchangeRate.upsert({
      where: { date_base_quote: { date, base: v.base, quote: v.quote } },
      create: { date, base: v.base, quote: v.quote, rate: v.rate, source: v.source },
      update: { rate: v.rate, source: v.source },
    });
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: "fx.upsert", metadata: { ...v } });
    revalidatePath("/", "layout");
    return { ok: true, message: `Taxa ${v.base}→${v.quote} de ${v.date} registada.` };
  } catch (e) {
    return failure(e);
  }
}

export async function deleteExchangeRateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requirePermission("org:manage");
    const rateId = id.parse(fd.get("id"));
    const r = await prisma.exchangeRate.delete({ where: { id: rateId } });
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: "fx.delete", metadata: { date: r.date.toISOString().slice(0, 10), base: r.base, quote: r.quote } });
    revalidatePath("/", "layout");
    return { ok: true, message: "Taxa removida." };
  } catch (e) {
    return failure(e);
  }
}
