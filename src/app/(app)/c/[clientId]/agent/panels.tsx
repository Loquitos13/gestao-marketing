import type { AgentMemory, AgentModel, AgentPreference, AgentRun } from "@prisma/client";
import { formatTimestamp, type FormatContext } from "@/lib/format";
import { addMemoryAction, analyzeNowAction, deleteMemoryAction, trainModelsAction } from "@/server/actions/agent";
import { MIN_EXAMPLES } from "@/server/agent/ml/preference";
import { skipCounts, suggestionOutcome } from "@/server/agent/outcomes";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, Dot, inputClass, Notice } from "@/components/ui";

const RUN_STATUS: Record<string, { label: string; v: "good" | "warn" | "bad" | "neutral" | "accent" }> = {
  RUNNING: { label: "A correr", v: "accent" },
  SUCCESS: { label: "Concluída", v: "good" },
  UNAVAILABLE: { label: "Agente indisponível", v: "warn" },
  FAILED: { label: "Falhou", v: "bad" },
};
const TRIGGER: Record<string, string> = { SCHEDULE: "Diária", SYNC: "Após sincronização", MANUAL: "Pedida" };

export function StatusPanel({ clientId, ok, message, model, canUse, worker }: { clientId: string; ok: boolean; message: string; model: string; canUse: boolean; worker: "on" | "off" | "inline" }) {
  return (
    <Card>
      <CardHeader title="Estado do agente" description={`Modelo local: ${model}. Nenhum dado sai deste servidor. O modelo liberta a memória cerca de 30 minutos depois do último pedido. Chat, relatórios e o worker usam-no um de cada vez.`} />
      <div className="space-y-3 px-4 py-3 text-xs">
        <p className="flex items-start gap-2">
          <Dot tone={ok ? "on" : "warn"} className="mt-1" />
          <span>{message}</span>
        </p>
        {worker === "off" && <Notice>O worker não está a correr. Análises pedidas, sincronizações e relatórios agendados ficam na fila até iniciar <span className="font-mono">npm run worker</span>.</Notice>}
        {canUse && (
          <div className="flex flex-wrap gap-2">
            <ActionForm action={analyzeNowAction} submitLabel="Analisar agora" size="sm" variant="primary" inline>
              <input type="hidden" name="clientId" value={clientId} />
            </ActionForm>
            <ActionForm action={trainModelsAction} submitLabel="Treinar modelos" size="sm" variant="secondary" inline>
              <input type="hidden" name="clientId" value={clientId} />
            </ActionForm>
          </div>
        )}
        <p className="text-muted">
          {worker === "on" && "O worker está a correr: a análise diária e a análise após cada sincronização são feitas por ele. "}
          {worker === "inline" && "Sem Redis, a análise pedida corre neste pedido. Com Redis, o worker trata das análises e dos agendamentos. "}
          O agente só cria recomendações e propostas; aplicar exige sempre a sua confirmação.
        </p>
      </div>
    </Card>
  );
}

export function MemoryPanel({ clientId, memories, canUse, fmt }: { clientId: string; memories: AgentMemory[]; canUse: boolean; fmt: FormatContext }) {
  return (
    <Card>
      <CardHeader title="Memória do cliente" description="Factos confirmados pela equipa, sempre respeitados pelo agente." />
      <ul className="divide-y text-xs">
        {memories.map((m) => (
          <li key={m.id} className="flex items-start gap-2 px-4 py-2">
            <span className="flex-1">{m.fact}</span>
            <span className="shrink-0 text-faint" title={formatTimestamp(m.createdAt, fmt)}>
              {m.createdAt.toISOString().slice(0, 10)}
            </span>
            {canUse && (
              <ActionForm action={deleteMemoryAction} submitLabel="Remover" size="sm" variant="ghost" inline>
                <input type="hidden" name="clientId" value={clientId} />
                <input type="hidden" name="memoryId" value={m.id} />
              </ActionForm>
            )}
          </li>
        ))}
        {!memories.length && <li className="px-4 py-3 text-muted">Ainda sem factos. Ex.: “A campanha de marca nunca desce de 20 €/dia.”</li>}
      </ul>
      {canUse && (
        <ActionForm action={addMemoryAction} submitLabel="Adicionar" size="sm" variant="secondary" resetOnSuccess className="flex items-end gap-2 space-y-0 border-t px-4 py-3">
          <input type="hidden" name="clientId" value={clientId} />
          <input name="fact" maxLength={300} required placeholder="Novo facto sobre este cliente" className={inputClass} aria-label="Novo facto" />
        </ActionForm>
      )}
    </Card>
  );
}

export function ModelsPanel({ models }: { models: AgentModel[] }) {
  const forecasts = models.filter((m) => m.kind === "FORECAST");
  const curves = models.filter((m) => m.kind === "RESPONSE_CURVE");
  const row = (m: AgentModel) => {
    const w = (m.metrics as { wape: number | null; n: number }).wape;
    return (
      <tr key={m.id} className="border-t">
        <td className="py-1.5 pl-4 pr-2">{m.label.replace(/^Curva de resposta: /, "")}</td>
        <td className="tabular px-2 text-right">{w === null ? "—" : `${(w * 100).toFixed(1).replace(".", ",")}%`}</td>
        <td className="pr-4 text-right">{m.reliable ? <Badge variant="good">Fiável</Badge> : <Badge variant="warn">Pouco fiável</Badge>}</td>
      </tr>
    );
  };
  return (
    <Card>
      <CardHeader title="Modelos treinados" description={models.length ? `Treino: ${models[0]!.trainedAt.toISOString().slice(0, 16).replace("T", " ")} UTC. Erro medido nas últimas 4 semanas, fora do treino.` : "Ainda não foram treinados modelos para este cliente."} />
      {models.length > 0 && (
        <table className="w-full text-xs">
          <thead className="text-[11px] text-muted">
            <tr>
              <th className="py-1.5 pl-4 text-left font-medium">Previsões (Holt-Winters)</th>
              <th className="px-2 text-right font-medium">Erro</th>
              <th className="pr-4" />
            </tr>
          </thead>
          <tbody>{forecasts.map(row)}</tbody>
          {curves.length > 0 && (
            <>
              <thead className="text-[11px] text-muted">
                <tr className="border-t">
                  <th className="py-1.5 pl-4 text-left font-medium">Curvas de resposta ao orçamento</th>
                  <th />
                  <th />
                </tr>
              </thead>
              <tbody>{curves.map(row)}</tbody>
            </>
          )}
        </table>
      )}
    </Card>
  );
}

export function LearningPanel({ pref }: { pref: AgentPreference | null }) {
  return (
    <Card>
      <CardHeader title="Aprendizagem" description="Com as suas aprovações e recusas, o agente aprende a ordenar e a suprimir sugestões." />
      <p className="px-4 py-3 text-xs text-fg-2">
        {pref
          ? `Modelo de preferência treinado com ${pref.n} decisões (acerto ${pref.accuracy === null ? "—" : `${Math.round(pref.accuracy * 100)}%`}) em ${pref.trainedAt.toISOString().slice(0, 10)}.`
          : `Ainda sem modelo de preferência: são precisas pelo menos ${MIN_EXAMPLES} decisões (recomendações aprovadas ou recusadas, propostas aplicadas ou canceladas).`}
      </p>
    </Card>
  );
}

const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

/** Recebe até 20 execuções: a média usa todas, a lista mostra as 8 mais recentes. */
export function RunsPanel({ runs, fmt }: { runs: AgentRun[]; fmt: FormatContext }) {
  const avgIn = avg(runs.map((r) => r.promptTokens));
  const avgMs = avg(runs.map((r) => r.durationMs));
  return (
    <Card>
      <CardHeader title="Execuções" description={avgMs != null ? `Últimas ${runs.length}: ${avgIn ?? "—"} tokens de entrada e ${Math.round(avgMs / 1000)} s em média.` : "Análises autónomas e pedidas."} />
      <ul className="divide-y text-xs">
        {runs.slice(0, 8).map((r) => {
          const s = RUN_STATUS[r.status] ?? RUN_STATUS.FAILED!;
          return (
            <li key={r.id} className="space-y-1 px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={s.v}>{s.label}</Badge>
                <span className="text-muted">{TRIGGER[r.trigger] ?? r.trigger}</span>
                <span className="ml-auto text-faint">{formatTimestamp(r.startedAt, fmt)}</span>
              </div>
              {r.status === "SUCCESS" && (
                <p className="text-muted">
                  {suggestionOutcome(r.proposals, skipCounts(r.toolCalls))} {r.durationMs ? `${Math.round(r.durationMs / 1000)} s` : "—"}
                  {r.promptTokens != null && ` · ${r.promptTokens} tokens de entrada, ${r.evalTokens ?? 0} de saída`}
                </p>
              )}
              {r.summary && <p className="line-clamp-4 whitespace-pre-wrap text-fg-2">{r.summary}</p>}
              {r.error && <p className="text-warn">{r.error}</p>}
            </li>
          );
        })}
        {!runs.length && <li className="px-4 py-3 text-muted">Ainda não houve execuções.</li>}
      </ul>
    </Card>
  );
}
