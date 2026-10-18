"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { limitRequest } from "@/server/security/limit";
import { requirePermission } from "@/server/auth/guard";
import { audit } from "@/server/audit";
import { checkGroup } from "@/server/config/checks";
import { settingGroup, type SettingGroupKey, type SettingKey } from "@/server/config/definitions";
import { settingsLocked, settingsOverview, writeSettings } from "@/server/config/settings";
import { failure, formObject, type ActionState } from "./util";

const groupKey = z.enum(["app", "google", "meta", "semrush", "smtp", "redis", "agent", "pagespeed"]);

export async function saveSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requirePermission("org:manage");
    if (settingsLocked()) return { ok: false, error: "Configuração bloqueada no servidor (SETTINGS_ENV_ONLY=1): altere as variáveis de ambiente." };
    const raw = formObject(fd);
    const group = settingGroup(groupKey.parse(raw.group))!;
    const current = await settingsOverview();
    const set: Partial<Record<SettingKey, string>> = {};
    const clear: SettingKey[] = [];
    const errors: string[] = [];

    for (const f of group.fields) {
      const value = typeof raw[f.key] === "string" ? (raw[f.key] as string).trim() : "";
      const state = current[f.key];
      if (f.secret) {
        if (raw[`clear_${f.key}`] === "on") {
          if (state.source === "db") clear.push(f.key);
          continue;
        }
        if (!value) continue;
      } else if (!value || (state.source !== "db" && value === state.value)) {
        if (state.source === "db" && !value) clear.push(f.key);
        continue;
      }
      const parsed = f.schema.safeParse(value);
      if (!parsed.success) errors.push(`${f.label}: ${parsed.error.issues[0]?.message ?? "valor inválido"}`);
      else set[f.key] = parsed.data;
    }
    if (errors.length) return { ok: false, error: errors.join("; ") };
    if (!Object.keys(set).length && !clear.length) return { ok: true, message: "Sem alterações." };

    await writeSettings({ set, clear }, ctx.userId);
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: "settings.update", targetType: "AppSetting", targetId: group.key, metadata: { set: Object.keys(set), cleared: clear } });
    revalidatePath("/", "layout");

    const after = await settingsOverview();
    const missing = group.fields.filter((f) => f.required && after[f.key].source === "missing").map((f) => f.label);
    const restart = group.key === "redis" && set.REDIS_URL ? " Reinicie o worker para aplicar." : "";
    return { ok: true, message: missing.length ? `Guardado. Ainda em falta: ${missing.join(", ")}.` : `Guardado.${restart}` };
  } catch (e) {
    return failure(e);
  }
}

export async function testSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requirePermission("org:manage");
    const group = groupKey.parse(formObject(fd).group) as SettingGroupKey;
    if (!(await limitRequest(`settings-test:${ctx.userId}`, 20, 10 * 60_000)).ok) return { ok: false, error: "Demasiados testes seguidos. Aguarde alguns minutos." };
    const r = await checkGroup(group);
    await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: "settings.test", targetType: "AppSetting", targetId: group, metadata: { ok: r.ok } });
    return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.message };
  } catch (e) {
    return failure(e);
  }
}
