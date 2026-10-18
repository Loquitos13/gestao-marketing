import type { AdChange } from "@prisma/client";
import { formatTimestamp, formatValue, type FormatContext } from "@/lib/format";
import { cancelChangeAction, confirmChangeAction, previewChangeAction, revertChangeAction } from "@/server/actions/ads";
import { ActionForm } from "@/components/action-form";
import { Badge, Dot, type BadgeVariant } from "@/components/ui";

export const STATUS_LABEL: Record<string, string> = { ENABLED: "Ativo", ACTIVE: "Ativo", PAUSED: "Pausado", REMOVED: "Removido", ARCHIVED: "Arquivado", DELETED: "Eliminado" };

export function EntityStatus({ status }: { status: string }) {
  const on = status === "ENABLED" || status === "ACTIVE";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <Dot tone={on ? "on" : "off"} />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

const CHANGE_STATUS: Record<string, { label: string; v: BadgeVariant }> = {
  DRAFT: { label: "Por confirmar", v: "warn" },
  CONFIRMED: { label: "Confirmada", v: "accent" },
  APPLYING: { label: "A aplicar", v: "accent" },
  APPLIED: { label: "Aplicada", v: "good" },
  FAILED: { label: "Falhou", v: "bad" },
  REVERTED: { label: "Revertida", v: "neutral" },
  CANCELLED: { label: "Cancelada", v: "neutral" },
};

export const OPERATION_LABEL: Record<string, string> = {
  SET_STATUS: "Estado",
  SET_DAILY_BUDGET: "Orçamento diário",
  CREATE_AD: "Novo anúncio",
  UPDATE_AD: "Editar anúncio",
  ADD_KEYWORDS: "Palavras-chave",
};

const LEVEL_LABEL: Record<string, string> = { CAMPAIGN: "Campanha", AD_GROUP: "Grupo / conjunto", AD: "Anúncio" };

type State = { status?: string | null; dailyBudget?: number | null; [k: string]: unknown };

/** “antes → depois” legível. */
export function describeChange(c: Pick<AdChange, "operation" | "before" | "after">, fmt: FormatContext): { before: string; after: string; delta: string | null } {
  const b = (c.before ?? {}) as State;
  const a = (c.after ?? {}) as State;
  if (c.operation === "SET_DAILY_BUDGET") {
    const pct = b.dailyBudget && a.dailyBudget ? (a.dailyBudget - b.dailyBudget) / b.dailyBudget : null;
    return { before: `${formatValue(b.dailyBudget ?? null, "currency", fmt)}/dia`, after: `${formatValue(a.dailyBudget ?? null, "currency", fmt)}/dia`, delta: pct === null ? null : `${pct > 0 ? "+" : ""}${(pct * 100).toFixed(0)}%` };
  }
  if (c.operation === "SET_STATUS") return { before: STATUS_LABEL[String(b.status)] ?? String(b.status ?? "—"), after: STATUS_LABEL[String(a.status)] ?? String(a.status ?? "—"), delta: null };
  return { before: String((b as { summary?: string }).summary ?? "—"), after: String((a as { summary?: string }).summary ?? "—"), delta: null };
}

export function ChangeStatusBadge({ status }: { status: string }) {
  const s = CHANGE_STATUS[status] ?? { label: status, v: "neutral" as const };
  return <Badge variant={s.v}>{s.label}</Badge>;
}

export function ChangeHead({ c, fmt, accountName }: { c: AdChange; fmt: FormatContext; accountName: string }) {
  const d = describeChange(c, fmt);
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Dot tone={c.platform === "GOOGLE_ADS" ? "google" : "meta"} />
        <span className="font-medium">{c.entityName}</span>
        <span className="text-muted">
          {LEVEL_LABEL[c.entityLevel] ?? c.entityLevel} · {OPERATION_LABEL[c.operation]} · {accountName}
        </span>
        {c.simulated && <Badge variant="warn">Simulado</Badge>}
        {c.revertOfId && <Badge variant="neutral">Reversão</Badge>}
        {c.source !== "MANUAL" && <Badge variant="accent">{c.source === "RULE" ? "Recomendação" : c.source === "ALLOCATION" ? "Distribuição" : "Agente"}</Badge>}
      </div>
      <p className="tabular text-[13px]">
        <span className="text-muted line-through decoration-faint">{d.before}</span> <span className="text-muted">→</span> <span className="font-semibold">{d.after}</span>
        {d.delta && <span className="ml-1.5 text-xs text-muted">({d.delta})</span>}
      </p>
      {c.reason && <p className="text-xs text-muted">{c.reason}</p>}
    </div>
  );
}

/** Proposta pendente: pré-validação, confirmação explícita (checkbox) e cancelamento. */
export function PendingChange({ c, fmt, accountName, canWrite, enabled }: { c: AdChange; fmt: FormatContext; accountName: string; canWrite: boolean; enabled: boolean }) {
  const preview = (c.validation as { preview?: { ok: boolean; message?: string } } | null)?.preview;
  return (
    <li className="space-y-2.5 px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <ChangeHead c={c} fmt={fmt} accountName={accountName} />
        <span className="ml-auto text-[11px] text-muted">Proposta {formatTimestamp(c.createdAt, fmt)}</span>
      </div>
      {preview && <p className={preview.ok ? "text-xs text-good" : "text-xs text-bad"}>{preview.ok ? "Validado pela plataforma (sem aplicar)." : `Validação recusada: ${preview.message}`}</p>}
      {c.status === "APPLYING" && <p className="text-xs text-accent">A aplicar…</p>}
      {canWrite && c.status === "DRAFT" && (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-surface-2 px-3 py-2">
          {enabled ? (
            <ActionForm action={confirmChangeAction} submitLabel={c.simulated ? "Aplicar (demonstração)" : "Aplicar na plataforma"} size="sm" inline>
              <input type="hidden" name="clientId" value={c.clientId} />
              <input type="hidden" name="changeId" value={c.id} />
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" name="acknowledged" required className="size-3.5 accent-[var(--accent)]" />
                Confirmo aplicar esta alteração na conta <span className="font-medium">{accountName}</span>
              </label>
            </ActionForm>
          ) : (
            <span className="text-xs text-muted">Ative a gestão de anúncios para este cliente para poder aplicar.</span>
          )}
          <span className="ml-auto flex gap-2">
            {!c.simulated && (
              <ActionForm action={previewChangeAction} submitLabel="Validar sem aplicar" size="sm" variant="secondary" inline>
                <input type="hidden" name="clientId" value={c.clientId} />
                <input type="hidden" name="changeId" value={c.id} />
              </ActionForm>
            )}
            <ActionForm action={cancelChangeAction} submitLabel="Cancelar" size="sm" variant="ghost" inline>
              <input type="hidden" name="clientId" value={c.clientId} />
              <input type="hidden" name="changeId" value={c.id} />
            </ActionForm>
          </span>
        </div>
      )}
    </li>
  );
}

export function HistoryRow({ c, fmt, accountName, names, canWrite }: { c: AdChange; fmt: FormatContext; accountName: string; names: Record<string, string>; canWrite: boolean }) {
  const who = c.confirmedById ? names[c.confirmedById] : c.createdById ? names[c.createdById] : null;
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <ChangeHead c={c} fmt={fmt} accountName={accountName} />
      <div className="ml-auto flex flex-col items-end gap-1 text-[11px] text-muted">
        <ChangeStatusBadge status={c.status} />
        <span>
          {formatTimestamp(c.appliedAt ?? c.updatedAt, fmt)}
          {who ? ` · ${who}` : ""}
        </span>
        {c.error && <span className={c.status === "FAILED" ? "max-w-md text-right text-bad" : "max-w-md text-right"}>{c.error}</span>}
        {canWrite && c.status === "APPLIED" && (c.operation === "SET_STATUS" || c.operation === "SET_DAILY_BUDGET") && (
          <ActionForm action={revertChangeAction} submitLabel="Reverter" size="sm" variant="secondary" inline>
            <input type="hidden" name="clientId" value={c.clientId} />
            <input type="hidden" name="changeId" value={c.id} />
          </ActionForm>
        )}
      </div>
    </li>
  );
}
