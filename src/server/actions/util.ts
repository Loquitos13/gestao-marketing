import { z, ZodError } from "zod";
import { logger } from "@/lib/logger";
import { TenantError } from "@/server/auth/tenant";
import { IntegrationError } from "@/server/integrations/http";
import { AdsWriteError } from "@/server/ads-write/entities";

export type ActionState = { ok?: boolean; message?: string; error?: string; data?: Record<string, unknown> };

export const formObject = (fd: FormData) => {
  const o: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string") continue;
    if (k.endsWith("[]")) ((o[k.slice(0, -2)] ??= []) as string[]).push(v);
    else o[k] = v;
  }
  return o;
};

/** Converte erros em mensagens seguras (sem detalhes internos). */
export function failure(e: unknown): ActionState {
  if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
  if (e instanceof ZodError) return { ok: false, error: e.issues.map((i) => `${i.path.join(".") || "campo"}: ${i.message}`).join("; ") };
  if (e instanceof TenantError) return { ok: false, error: e.status === 403 ? "Não tem permissão para esta operação." : "Recurso não encontrado." };
  if (e instanceof IntegrationError) return { ok: false, error: `${e.kind}: ${e.message}` };
  if (e instanceof AdsWriteError) return { ok: false, error: e.message };
  logger.error({ error: e instanceof Error ? e.message : String(e) }, "Erro em ação");
  return { ok: false, error: "Ocorreu um erro inesperado. Verifique os registos do servidor." };
}

export const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida");
export const money = z.coerce.number().finite().min(0).max(1e9);
export const emails = z
  .string()
  .max(2000)
  .transform((s) => s.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))
  .pipe(z.array(z.string().email("email inválido")).max(30));
export const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
