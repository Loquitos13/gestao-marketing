import { formatValue, type FormatContext } from "@/lib/format";
import { draftAllocationAction } from "@/server/actions/ads";
import type { AllocationView } from "@/server/ads-write/allocation-data";
import { ActionForm } from "@/components/action-form";
import { Card, CardHeader, Dot, EmptyState, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-[140px]">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="tabular text-[15px] font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function SplitBar({ google, meta, fmt, label }: { google: number; meta: number; fmt: FormatContext; label: string }) {
  const total = google + meta || 1;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-muted">
        <span>{label}</span>
        <span className="tabular">
          Google {formatValue(google, "currency", fmt)} · Meta {formatValue(meta, "currency", fmt)}
        </span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-hover">
        <div className="bg-google" style={{ width: `${(google / total) * 100}%` }} />
        <div className="bg-meta" style={{ width: `${(meta / total) * 100}%` }} />
      </div>
    </div>
  );
}

export function AllocationPanel({ view, clientId, fmt, canWrite }: { view: AllocationView; clientId: string; fmt: FormatContext; canWrite: boolean }) {
  if (!view.ok)
    return (
      <Card>
        <EmptyState title="Distribuição indisponível" description={view.reason} />
      </Card>
    );
  const { result: r, period: p } = view;
  const money = (n: number | null) => formatValue(n, "currency", fmt);
  const goalLabel = r.goal.kind === "ROAS" ? `ROAS mínimo ${r.goal.target ? formatValue(r.goal.target, "multiplier", fmt) : "—"}` : `CPA máximo ${money(r.goal.target)}`;
  const changes = r.lines.filter((l) => l.change !== 0);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Orçamento do mês" description={`${p.start} a ${p.end} · ${p.source === "BUDGET" ? "orçamento “Total” definido em Orçamento" : "orçamento mensal das definições do cliente"} · dados até ${view.asOf}`} />
        <div className="flex flex-wrap gap-x-8 gap-y-3 px-4 py-3">
          <Stat label="Orçamento total" value={money(p.amount)} />
          <Stat label="Investido" value={money(p.spent)} sub={`${p.daysLeft} dias restantes`} />
          <Stat label="Ritmo necessário" value={`${money(r.dailyTarget)}/dia`} />
          <Stat label="Orçamentos atuais" value={`${money(r.currentDaily)}/dia`} />
          <Stat label="Proposto" value={`${money(r.proposedDaily)}/dia`} />
          <Stat label="Critério" value={goalLabel} sub={r.goal.source === "GOAL" ? "objetivo do cliente" : "média da conta (sem objetivo definido)"} />
        </div>
        <div className="grid gap-3 border-t px-4 py-3 md:grid-cols-2">
          <SplitBar label="Antes" google={r.split.before.GOOGLE_ADS} meta={r.split.before.META_ADS} fmt={fmt} />
          <SplitBar label="Depois" google={r.split.after.GOOGLE_ADS} meta={r.split.after.META_ADS} fmt={fmt} />
        </div>
      </Card>
      {r.warnings.map((w) => (
        <Notice key={w}>{w}</Notice>
      ))}
      <Card>
        <CardHeader title="Distribuição proposta" description="Favorece as campanhas que superam o objetivo, dentro do passo máximo por alteração. Gerar as propostas não aplica nada: cada uma é confirmada individualmente." />
        <ActionForm action={draftAllocationAction} submitLabel={`Criar ${changes.length} propostas selecionadas`} className="space-y-0 [&>div:last-child]:border-t [&>div:last-child]:px-4 [&>div:last-child]:py-3">
          <input type="hidden" name="clientId" value={clientId} />
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b text-muted">
                <tr>
                  <th className="w-8 px-4 py-2" />
                  <th className="px-2 py-2 text-left font-medium">Campanha / conjunto</th>
                  <th className="px-2 py-2 text-right font-medium">Atual</th>
                  <th className="px-2 py-2 text-right font-medium">Proposto</th>
                  <th className="px-2 py-2 text-right font-medium">Variação</th>
                  <th className="px-4 py-2 text-left font-medium">Justificação</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {r.lines.map((l) => (
                  <tr key={l.entity.key} className={cn(l.change === 0 && "text-muted")}>
                    <td className="px-4 py-2">{l.change !== 0 && l.entity.adjustable && canWrite && <input type="checkbox" name="keys[]" value={l.entity.key} defaultChecked aria-label={`Incluir ${l.entity.name}`} className="size-3.5 accent-[var(--accent)]" />}</td>
                    <td className="px-2 py-2">
                      <span className="flex items-center gap-2 font-medium text-fg">
                        <Dot tone={l.entity.platform === "GOOGLE_ADS" ? "google" : "meta"} />
                        {l.entity.name}
                      </span>
                    </td>
                    <td className="tabular px-2 py-2 text-right">{money(l.current)}</td>
                    <td className="tabular px-2 py-2 text-right font-semibold text-fg">{money(l.proposed)}</td>
                    <td className={cn("tabular px-2 py-2 text-right", l.change > 0 ? "text-good" : l.change < 0 ? "text-bad" : "")}>{l.change === 0 ? "—" : `${l.change > 0 ? "+" : ""}${Math.round(l.changePct * 100)}%`}</td>
                    <td className="max-w-[520px] px-4 py-2 text-fg-2">{l.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
