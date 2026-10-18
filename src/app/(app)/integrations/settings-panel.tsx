import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, inputClass, labelClass, type BadgeVariant } from "@/components/ui";
import { saveSettingsAction, testSettingsAction } from "@/server/actions/settings";
import type { SettingField, SettingGroup, SettingKey } from "@/server/config/definitions";
import type { FieldState, SettingSource } from "@/server/config/settings";
import { cn } from "@/lib/utils";

const SOURCE: Record<SettingSource, { label: string; v: BadgeVariant; title: string }> = {
  db: { label: "Interface", v: "accent", title: "Valor guardado nesta página (encriptado na base de dados). Sobrepõe-se à variável de ambiente." },
  env: { label: "Variável de ambiente", v: "neutral", title: "Valor lido do ficheiro .env / ambiente do servidor." },
  default: { label: "Predefinição", v: "neutral", title: "Valor por omissão da aplicação." },
  missing: { label: "Em falta", v: "warn", title: "Sem valor definido." },
};

function groupStatus(g: SettingGroup, s: Record<SettingKey, FieldState>) {
  const req = g.fields.filter((f) => f.required);
  const set = req.filter((f) => s[f.key].source !== "missing").length;
  if (set === req.length) return { label: "Configurado", v: "good" as const };
  return set ? { label: "Incompleto", v: "warn" as const } : { label: "Não configurado", v: "neutral" as const };
}

function FieldInput({ f, s, locked }: { f: SettingField; s: FieldState; locked: boolean }) {
  const src = s.source === "missing" && !f.required ? { label: "Não definido", v: "neutral" as const, title: "Opcional." } : SOURCE[s.source];
  const id = `cfg-${f.key}`;
  return (
    <div className={f.key === "APP_URL" || f.key === "REDIS_URL" ? "sm:col-span-2" : undefined}>
      <div className="mb-1 flex items-center gap-1.5">
        <label htmlFor={id} className={labelClass + " mb-0"}>
          {f.label}
          {f.required && <span className="text-faint"> *</span>}
        </label>
        <Badge variant={src.v} title={src.title} className="ml-auto h-[18px] px-1 text-[10.5px]">
          {src.label}
        </Badge>
      </div>
      {f.secret ? (
        <input
          id={id}
          name={f.key}
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          disabled={locked}
          className={inputClass + " font-mono"}
          placeholder={s.hint ? `Definido (${s.hint}) — deixe vazio para manter` : f.placeholder ?? "Não definido"}
        />
      ) : (
        <input
          id={id}
          name={f.key}
          type={f.type === "number" ? "text" : f.type ?? "text"}
          inputMode={f.type === "number" ? "numeric" : undefined}
          autoComplete="off"
          spellCheck={false}
          disabled={locked}
          defaultValue={s.source === "db" || s.source === "env" ? s.value : ""}
          className={inputClass + " font-mono"}
          placeholder={s.source === "default" ? s.value : f.placeholder}
        />
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-muted">
        {f.hint && <span>{f.hint}</span>}
        {f.secret && s.source === "db" && !locked && (
          <label className="inline-flex items-center gap-1">
            <input type="checkbox" name={`clear_${f.key}`} className="size-3" /> Remover valor guardado
          </label>
        )}
        {!f.secret && s.source === "db" && <span>Deixe vazio para voltar à variável de ambiente ou à predefinição.</span>}
      </div>
    </div>
  );
}

export function SettingsPanel({ group, state, locked, extra }: { group: SettingGroup; state: Record<SettingKey, FieldState>; locked: boolean; extra?: React.ReactNode }) {
  const st = groupStatus(group, state);
  const wide = group.fields.length === 1;
  return (
    <Card id={`cfg-${group.key}`} className={cn("flex scroll-mt-4 flex-col", wide && "xl:col-span-2")}>
      <CardHeader
        title={group.label}
        actions={
          <Badge variant={st.v} title="Com base nos campos obrigatórios (*)">
            {st.label}
          </Badge>
        }
      />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <p className="text-xs text-muted">{group.description}</p>
        {extra}
        <ActionForm action={saveSettingsAction} submitLabel="Guardar" size="sm" className={cn("space-y-3", wide && "max-w-xl")}>
          <input type="hidden" name="group" value={group.key} />
          <div className="grid gap-3 sm:grid-cols-2">
            {group.fields.map((f) => (
              <FieldInput key={f.key} f={f} s={state[f.key]} locked={locked} />
            ))}
          </div>
        </ActionForm>
      </div>
      {group.testable && (
        <div className="flex items-center gap-2 border-t px-4 py-2.5">
          <ActionForm action={testSettingsAction} submitLabel="Testar ligação" size="sm" variant="secondary" inline>
            <input type="hidden" name="group" value={group.key} />
          </ActionForm>
          <span className="text-[11px] text-faint">Usa a configuração guardada. Só leitura: nada é alterado nas plataformas.</span>
        </div>
      )}
    </Card>
  );
}
