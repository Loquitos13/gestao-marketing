import Link from "next/link";
import { formatValue, type FormatContext } from "@/lib/format";
import { draftBudgetAction, draftStatusAction } from "@/server/actions/ads";
import type { ManagedCampaign, Perf } from "@/server/queries/manage";
import { ActionForm } from "@/components/action-form";
import { Dot, inputClass } from "@/components/ui";
import { cn } from "@/lib/utils";
import { EntityStatus } from "./parts";

const isOn = (s: string) => s === "ENABLED" || s === "ACTIVE";

function StatusAction({ clientId, level, id, status }: { clientId: string; level: string; id: string; status: string }) {
  if (!isOn(status) && status !== "PAUSED") return null;
  return (
    <ActionForm action={draftStatusAction} submitLabel={isOn(status) ? "Pausar" : "Ativar"} size="sm" variant="secondary" inline>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="level" value={level} />
      <input type="hidden" name="entityId" value={id} />
      <input type="hidden" name="desired" value={isOn(status) ? "PAUSED" : "ACTIVE"} />
    </ActionForm>
  );
}

function BudgetAction({ clientId, level, id, budget, block, maxStepPct, fmt }: { clientId: string; level: string; id: string; budget: number | null; block: string | null; maxStepPct: number; fmt: FormatContext }) {
  if (block || budget === null) return <span className="text-[11px] text-muted" title={block ?? undefined}>{budget === null ? "—" : `${formatValue(budget, "currency", fmt)}/dia`}</span>;
  const lo = Math.max(1, budget * (1 - maxStepPct));
  const hi = budget * (1 + maxStepPct);
  return (
    <ActionForm action={draftBudgetAction} submitLabel="Propor" size="sm" variant="secondary" inline>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="level" value={level} />
      <input type="hidden" name="entityId" value={id} />
      <input
        name="dailyBudget"
        type="number"
        step="0.01"
        min={lo.toFixed(2)}
        max={hi.toFixed(2)}
        defaultValue={budget.toFixed(2)}
        aria-label="Orçamento diário"
        title={`Entre ${formatValue(lo, "currency", fmt)} e ${formatValue(hi, "currency", fmt)} (limite de ±${Math.round(maxStepPct * 100)}% por alteração)`}
        className={cn(inputClass, "h-[26px] w-24 text-right")}
      />
    </ActionForm>
  );
}

function PerfCells({ p, fmt }: { p: Perf | null; fmt: FormatContext }) {
  return (
    <>
      <td className="tabular px-2 py-2 text-right">{formatValue(p?.cost ?? null, "currency", fmt)}</td>
      <td className="tabular px-2 py-2 text-right">{formatValue(p?.conversions ?? null, "number", fmt)}</td>
      <td className="tabular px-2 py-2 text-right">{formatValue(p?.cpa ?? null, "currency", fmt)}</td>
      <td className="tabular px-2 py-2 text-right">{formatValue(p?.roas ?? null, "multiplier", fmt)}</td>
    </>
  );
}

export function CampaignsView({ campaigns, clientId, fmt, canWrite, maxStepPct }: { campaigns: ManagedCampaign[]; clientId: string; fmt: FormatContext; canWrite: boolean; maxStepPct: number }) {
  const head = "px-2 py-2 text-right font-medium";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="border-b text-muted">
          <tr>
            <th className="px-4 py-2 text-left font-medium">Campanha › grupo/conjunto › anúncio</th>
            <th className="px-2 py-2 text-left font-medium">Estado</th>
            <th className={head}>Invest.</th>
            <th className={head}>Conv.</th>
            <th className={head}>CPA</th>
            <th className={head}>ROAS</th>
            <th className="px-2 py-2 text-left font-medium">Orçamento diário</th>
            <th className="px-4 py-2 text-right font-medium">Ação</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {campaigns.flatMap((c) => [
            <tr key={c.id} className="bg-surface-2/60">
              <td className="px-4 py-2">
                <span className="flex items-center gap-2 font-medium">
                  <Dot tone={c.platform === "GOOGLE_ADS" ? "google" : "meta"} />
                  {c.name}
                </span>
              </td>
              <td className="px-2 py-2">
                <EntityStatus status={c.status} />
              </td>
              <PerfCells p={c.perf} fmt={fmt} />
              <td className="px-2 py-2">{canWrite ? <BudgetAction clientId={clientId} level="CAMPAIGN" id={c.id} budget={c.dailyBudget} block={c.budgetBlock} maxStepPct={maxStepPct} fmt={fmt} /> : c.dailyBudget !== null ? `${formatValue(c.dailyBudget, "currency", fmt)}/dia` : "—"}</td>
              <td className="px-4 py-2 text-right">{canWrite && <StatusAction clientId={clientId} level="CAMPAIGN" id={c.id} status={c.status} />}</td>
            </tr>,
            ...c.groups.flatMap((g) => [
              <tr key={g.id}>
                <td className="py-1.5 pl-9 pr-2 text-fg-2">{g.name}</td>
                <td className="px-2 py-1.5">
                  <EntityStatus status={g.status} />
                </td>
                <td colSpan={4} />
                <td className="px-2 py-1.5">{canWrite && g.dailyBudget !== null ? <BudgetAction clientId={clientId} level="AD_GROUP" id={g.id} budget={g.dailyBudget} block={g.budgetBlock} maxStepPct={maxStepPct} fmt={fmt} /> : null}</td>
                <td className="px-4 py-1.5 text-right">
                  {canWrite && (
                    <span className="inline-flex items-center gap-2">
                      {c.canCreateAds && (
                        <Link href={`?view=anuncios&group=${g.id}`} className="text-accent hover:underline">
                          Novo anúncio
                        </Link>
                      )}
                      <StatusAction clientId={clientId} level="AD_GROUP" id={g.id} status={g.status} />
                    </span>
                  )}
                </td>
              </tr>,
              ...g.ads.map((a) => (
                <tr key={a.id}>
                  <td className="py-1.5 pl-14 pr-2 text-muted">{a.name}</td>
                  <td className="px-2 py-1.5">
                    <EntityStatus status={a.status} />
                  </td>
                  <PerfCells p={a.perf} fmt={fmt} />
                  <td />
                  <td className="px-4 py-1.5 text-right">
                    {canWrite && (
                      <span className="inline-flex items-center gap-2">
                        {c.canCreateAds && (
                          <Link href={`?view=anuncios&group=${g.id}&from=${a.id}`} className="text-accent hover:underline">
                            Editar
                          </Link>
                        )}
                        <StatusAction clientId={clientId} level="AD" id={a.id} status={a.status} />
                      </span>
                    )}
                  </td>
                </tr>
              )),
            ]),
          ])}
        </tbody>
      </table>
    </div>
  );
}
