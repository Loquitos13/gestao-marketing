import Link from "next/link";
import { formatTimestamp, formatValue, type FormatContext } from "@/lib/format";
import type { CompetitorData } from "@/server/queries/competitors";
import { acceptSuggestionAction, deleteCompetitorAction, proposeKeywordsAction, saveCompetitorAction, suggestCompetitorsAction } from "@/server/actions/competitors";
import { MATCH_LABELS, MATCH_TYPES } from "@/server/ads-write/keywords";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, EmptyState, Field, Notice, inputClass } from "@/components/ui";
import { cn } from "@/lib/utils";

const th = "px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted";
const td = "px-3 py-2 align-top";

function CompetitorFields({ c }: { c?: CompetitorData["competitors"][number] }) {
  return (
    <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_1fr]">
      <Field label="Nome">
        <input name="name" required maxLength={120} defaultValue={c?.name} className={inputClass} />
      </Field>
      <Field label="Domínio" hint="Ex.: concorrente.pt. Usado no rastreio, Keyword Planner e PageSpeed.">
        <input name="domain" maxLength={253} defaultValue={c?.domain ?? ""} placeholder="concorrente.pt" className={inputClass} />
      </Field>
      <Field label="IDs de Página Meta" hint="Separados por vírgulas. Para os anúncios na Biblioteca da Meta.">
        <input name="metaPageIds" maxLength={300} defaultValue={c?.metaPageIds.join(", ")} inputMode="numeric" className={inputClass} />
      </Field>
      <div className="md:col-span-3">
        <Field label="Notas (opcional)">
          <input name="notes" maxLength={500} defaultValue={c?.notes ?? ""} className={inputClass} />
        </Field>
      </div>
    </div>
  );
}

export function CompetitorsTab({ d, clientId, canWrite, fmt }: { d: CompetitorData; clientId: string; canWrite: boolean; fmt: FormatContext }) {
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Concorrentes" description={`${d.active.length} de 10. Os dados são recolhidos semanalmente (palavras-chave: mensalmente) ou quando carrega em “Atualizar”.`} />
        {d.active.length ? (
          <ul className="divide-y">
            {d.active.map((c) => (
              <li key={c.id} className="px-4 py-3">
                <details>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-muted">{c.domain ?? "sem domínio"}</span>
                    {c.metaPageIds.length > 0 && <Badge variant="neutral">{c.metaPageIds.length} Página(s) Meta</Badge>}
                    <span className="ml-auto text-[11px] text-muted">
                      {d.compPages.filter((p) => p.competitorId === c.id).length} páginas · {d.ads.filter((a) => a.competitorId === c.id).length} anúncios ativos
                    </span>
                  </summary>
                  {c.notes && <p className="mt-1 text-xs text-muted">{c.notes}</p>}
                  {canWrite && (
                    <div className="mt-3 space-y-2 rounded-md bg-surface-2 p-3">
                      <ActionForm action={saveCompetitorAction} submitLabel="Guardar alterações" size="sm" variant="secondary" className="space-y-3">
                        <input type="hidden" name="clientId" value={clientId} />
                        <input type="hidden" name="competitorId" value={c.id} />
                        <CompetitorFields c={c} />
                      </ActionForm>
                      <ActionForm action={deleteCompetitorAction} submitLabel="Remover concorrente" size="sm" variant="ghost" inline confirm={`Remover ${c.name} e os dados recolhidos?`}>
                        <input type="hidden" name="clientId" value={clientId} />
                        <input type="hidden" name="competitorId" value={c.id} />
                      </ActionForm>
                    </div>
                  )}
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Ainda não há concorrentes" description="Adicione-os abaixo ou peça sugestões a partir da Biblioteca de Anúncios da Meta." />
        )}
      </Card>

      {canWrite && (
        <Card>
          <CardHeader title="Adicionar concorrente" />
          <ActionForm action={saveCompetitorAction} submitLabel="Adicionar" resetOnSuccess className="space-y-3 px-4 py-4">
            <input type="hidden" name="clientId" value={clientId} />
            <CompetitorFields />
          </ActionForm>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Sugeridos"
          description="Anunciantes que aparecem na Biblioteca de Anúncios da Meta para as pesquisas principais do cliente. Só contam como concorrentes depois de aceites."
          actions={
            canWrite ? (
              <ActionForm action={suggestCompetitorsAction} submitLabel="Procurar sugestões" size="sm" variant="secondary" inline>
                <input type="hidden" name="clientId" value={clientId} />
              </ActionForm>
            ) : undefined
          }
        />
        {d.suggested.length ? (
          <ul className="divide-y">
            {d.suggested.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-muted">
                    {c.domain ?? "domínio desconhecido"} · {c.notes} · {formatTimestamp(c.createdAt, fmt)}
                  </p>
                </div>
                {canWrite && (
                  <span className="ml-auto flex gap-2">
                    <ActionForm action={acceptSuggestionAction} submitLabel="Aceitar" size="sm" inline>
                      <input type="hidden" name="clientId" value={clientId} />
                      <input type="hidden" name="competitorId" value={c.id} />
                    </ActionForm>
                    <ActionForm action={deleteCompetitorAction} submitLabel="Ignorar" size="sm" variant="ghost" inline>
                      <input type="hidden" name="clientId" value={clientId} />
                      <input type="hidden" name="competitorId" value={c.id} />
                    </ActionForm>
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-xs text-muted">Sem sugestões pendentes.</p>
        )}
      </Card>
    </div>
  );
}

export function KeywordsTab({ d, clientId, canAds, showAll, groups, fmt, base }: { d: CompetitorData; clientId: string; canAds: boolean; showAll: boolean; groups: { id: string; label: string }[]; fmt: FormatContext; base: string }) {
  const rows = (showAll ? d.gaps.rows : d.gaps.rows.filter((r) => r.gap)).slice(0, 150);
  const src = d.keywordSource;
  const selectable = canAds && groups.length > 0;
  const table = (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead className="border-b bg-surface-2">
          <tr>
            {selectable && <th className={th} aria-label="Selecionar" />}
            <th className={th}>Palavra-chave</th>
            <th className={cn(th, "text-right")}>Pesquisas/mês</th>
            <th className={cn(th, "text-right")}>CPC (topo da página)</th>
            <th className={th}>Concorrência</th>
            <th className={th}>Origem</th>
            <th className={cn(th, "text-right")}>Search Console</th>
            <th className={th}>Google Ads</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.keyword}>
              {selectable && (
                <td className={td}>
                  <input type="checkbox" name="keyword[]" value={r.keyword} disabled={r.inAds} aria-label={`Selecionar ${r.keyword}`} className="size-3.5 accent-[var(--accent)]" />
                </td>
              )}
              <td className={td}>
                <span className="font-medium">{r.keyword}</span> {r.gap && <Badge variant="warn">Lacuna</Badge>} {r.brand && <Badge variant="neutral" title="Contém o nome de uma marca: não conta como lacuna.">Marca</Badge>}
              </td>
              <td className={cn(td, "tabular text-right")}>{formatValue(r.volume, "number", fmt)}</td>
              <td className={cn(td, "tabular text-right")}>{r.lowCpc === null && r.highCpc === null ? "—" : `${formatValue(r.lowCpc, "currency", fmt)} – ${formatValue(r.highCpc, "currency", fmt)}`}</td>
              <td className={td}>{r.competition ? { LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta" }[r.competition] ?? r.competition : "—"}</td>
              <td className={cn(td, "text-xs text-muted")}>{r.competitors.length ? r.competitors.join(", ") : "site do cliente"}</td>
              <td className={cn(td, "tabular text-right")}>{r.inSearchConsole ? `${formatValue(r.searchImpressions, "number", fmt)} impr.` : "—"}</td>
              <td className={td}>{r.inAds ? <Badge variant="good">Já existe</Badge> : <span className="text-xs text-muted">Não</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <Card>
      <CardHeader
        title="Palavras-chave"
        description={
          src
            ? `${src.source === "SIMULATED" ? "Dados simulados" : "Google Keyword Planner (Portugal, português)"} · ${formatTimestamp(src.fetchedAt, fmt)}. Volumes e CPC são estimativas da Google. Lacuna: com procura, sem impressões no Search Console (90 dias) e sem a palavra-chave na Google Ads.`
            : "Ainda sem ideias de palavras-chave. Use “Atualizar palavras-chave” (exige uma conta Google Ads ligada e developer token com acesso Básico)."
        }
        actions={
          <Link href={showAll ? base + "?tab=palavras" : base + "?tab=palavras&all=1"} className="text-xs text-accent underline">
            {showAll ? `Só lacunas (${d.gaps.gaps})` : `Mostrar todas (${d.gaps.total})`}
          </Link>
        }
      />
      {!rows.length ? (
        <EmptyState title={src ? "Sem lacunas encontradas" : "Sem dados"} description={src ? "O cliente já aparece ou anuncia nas palavras-chave com procura." : undefined} />
      ) : selectable ? (
        <ActionForm action={proposeKeywordsAction} submitLabel="Propor adicionar à Google Ads" className="space-y-0">
          <input type="hidden" name="clientId" value={clientId} />
          <div className="flex flex-wrap items-end gap-3 border-b px-4 py-3">
            <label className="min-w-[280px] flex-1 text-xs">
              <span className="mb-1 block font-medium text-fg-2">Grupo de anúncios de Pesquisa</span>
              <select name="adGroupId" required className={inputClass}>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-medium text-fg-2">Correspondência</span>
              <select name="matchType" defaultValue="PHRASE" className={inputClass}>
                {MATCH_TYPES.map((m) => (
                  <option key={m} value={m}>
                    {MATCH_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
            <p className="basis-full text-[11px] text-muted">Escolha até 20. É criada uma proposta em Gestão → Propostas; depois de confirmada, as palavras-chave são criadas em pausa.</p>
          </div>
          {table}
        </ActionForm>
      ) : (
        <>
          {canAds && <Notice variant="neutral">Sem grupos de anúncios de Pesquisa na Google Ads: não é possível propor palavras-chave.</Notice>}
          {table}
        </>
      )}
    </Card>
  );
}
