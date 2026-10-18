import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { can } from "@/server/auth/rbac";
import { saveAdsSettingsAction } from "@/server/actions/ads";
import { loadChanges, loadManagedCampaigns } from "@/server/queries/manage";
import { ActionForm } from "@/components/action-form";
import { Card, CardHeader, EmptyState, LinkButton, Notice, PageHeader, inputClass } from "@/components/ui";
import { cn } from "@/lib/utils";
import { clientContext } from "../page-context";
import { loadAllocation } from "@/server/ads-write/allocation-data";
import { AllocationPanel } from "./allocation-view";
import { AdComposer } from "./ad-form";
import { CampaignsView } from "./campaigns-view";
import { HistoryRow, PendingChange } from "./parts";

const VIEWS = [
  { key: "propostas", label: "Propostas" },
  { key: "campanhas", label: "Campanhas e anúncios" },
  { key: "distribuicao", label: "Distribuição de budget" },
  { key: "anuncios", label: "Novo anúncio" },
  { key: "historico", label: "Histórico" },
] as const;
type View = (typeof VIEWS)[number]["key"];

export default async function ManagePage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ view?: string; done?: string; group?: string; from?: string; ref?: string }> }) {
  const { clientId } = await params;
  const sp = await searchParams;
  const { client, ctx, tenant } = await clientContext(clientId);
  const view: View = VIEWS.some((v) => v.key === sp.view) ? (sp.view as View) : "propostas";
  const canWrite = can(tenant.role, "ads:write");
  const hasAds = ctx.has.GOOGLE_ADS || ctx.has.META_ADS;
  const base = `/c/${client.id}/manage`;
  if (!hasAds) {
    return (
      <>
        <PageHeader title="Gestão de anúncios" />
        <Card>
          <EmptyState title="Sem contas de anúncios ligadas" description="Ligue uma conta Google Ads ou Meta Ads para gerir campanhas, orçamentos e anúncios." action={<LinkButton href={`/c/${client.id}/sources`} variant="primary">Ligar conta</LinkButton>} />
        </Card>
      </>
    );
  }

  const [{ pending, history, names }, managed, allocation, readOnlyMeta] = await Promise.all([
    loadChanges(client.id),
    view === "campanhas" ? loadManagedCampaigns(client, ctx) : null,
    view === "distribuicao" ? loadAllocation(client, ctx) : null,
    prisma.dataSource.count({ where: { clientId: client.id, platform: "META_ADS", origin: "REAL", connectedAccount: { credential: { NOT: { scopes: { has: "ads_management" } } } } } }),
  ]);
  const account = Object.fromEntries(ctx.sources.map((s) => [s.id, s.name]));
  const maxStep = Number(client.maxBudgetStepPct);
  const simulated = ctx.originOf(["GOOGLE_ADS", "META_ADS"]) === "SIMULATED";
  const justDone = sp.done ? history.find((c) => c.id === sp.done) : undefined;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Gestão de anúncios"
        description="O hub prepara propostas; nada é alterado nas plataformas sem a sua confirmação explícita, uma a uma. Antes de aplicar, o estado atual é relido e a alteração é abortada se tiver mudado fora do hub."
      />
      {simulated && <Notice>Este cliente usa dados de demonstração: as alterações só afetam os dados simulados no hub, nunca uma conta real.</Notice>}
      {readOnlyMeta > 0 && (
        <Notice>
          A ligação Meta deste cliente só tem permissão de leitura. Para aplicar alterações, use “Ligar com gestão de anúncios” em{" "}
          <Link href="/integrations" className="underline">
            Integrações
          </Link>
          .
        </Notice>
      )}

      <Card>
        <CardHeader title="Definições" description={client.adsManagementEnabled ? "Gestão ativa para este cliente." : "Gestão desligada: pode preparar propostas, mas não aplicá-las."} />
        {canWrite ? (
          <ActionForm action={saveAdsSettingsAction} submitLabel="Guardar" size="sm" variant="secondary" className="flex flex-wrap items-end gap-4 space-y-0 px-4 py-3">
            <input type="hidden" name="clientId" value={client.id} />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" name="enabled" defaultChecked={client.adsManagementEnabled} className="size-3.5 accent-[var(--accent)]" />
              Permitir aplicar alterações nas contas deste cliente
            </label>
            <label className="text-xs">
              <span className="mb-1 block font-medium text-fg-2">Variação máxima de orçamento por alteração (%)</span>
              <input name="maxStepPct" type="number" min={1} max={50} step={1} defaultValue={Math.round(maxStep * 100)} className={cn(inputClass, "w-24")} />
            </label>
          </ActionForm>
        ) : (
          <p className="px-4 py-3 text-xs text-muted">Só administradores e proprietários podem gerir anúncios.</p>
        )}
      </Card>

      <nav className="flex gap-1 border-b" aria-label="Vistas da gestão">
        {VIEWS.map((v) => (
          <Link key={v.key} href={`${base}?view=${v.key}`} aria-current={v.key === view ? "page" : undefined} className={cn("-mb-px border-b-2 px-3 py-2 text-xs font-medium", v.key === view ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg")}>
            {v.label}
            {v.key === "propostas" && pending.length > 0 && <span className="tabular ml-1.5 rounded-full bg-warn-soft px-1.5 text-[10.5px] text-warn">{pending.length}</span>}
          </Link>
        ))}
      </nav>

      {view === "propostas" && (
        <Card>
          <CardHeader title="Propostas por confirmar" description="Cada proposta é aplicada individualmente, depois de marcar a confirmação." />
          {pending.length ? (
            <ul className="divide-y">
              {pending.map((c) => (
                <PendingChange key={c.id} c={c} fmt={ctx.fmt} accountName={account[c.dataSourceId] ?? "conta"} canWrite={canWrite} enabled={client.adsManagementEnabled} />
              ))}
            </ul>
          ) : (
            <EmptyState title="Sem propostas pendentes" description="Crie propostas em “Campanhas e anúncios” ou a partir das recomendações." action={<LinkButton href={`${base}?view=campanhas`}>Ver campanhas</LinkButton>} />
          )}
        </Card>
      )}

      {view === "campanhas" && managed && (
        <Card>
          <CardHeader title="Campanhas, grupos e anúncios" description={`Desempenho dos últimos 14 dias (${managed.window.start} a ${managed.window.end}). “Pausar”, “Ativar” e “Propor” criam propostas; nada é aplicado neste passo.`} />
          {managed.campaigns.length ? <CampaignsView campaigns={managed.campaigns} clientId={client.id} fmt={ctx.fmt} canWrite={canWrite} maxStepPct={maxStep} /> : <EmptyState title="Sem campanhas sincronizadas" />}
        </Card>
      )}

      {view === "distribuicao" && allocation && <AllocationPanel view={allocation} clientId={client.id} fmt={ctx.fmt} canWrite={canWrite} />}

      {view === "anuncios" && <AdComposer clientId={client.id} groupId={sp.group} fromAdId={sp.from} refAdId={sp.ref} canWrite={canWrite} />}

      {view === "historico" && justDone && (
        <Notice variant={justDone.status === "APPLIED" ? "accent" : "bad"}>
          {justDone.status === "APPLIED"
            ? justDone.simulated
              ? `Aplicada nos dados de demonstração: ${justDone.entityName}. Nenhuma conta real foi alterada.`
              : `Aplicada na plataforma: ${justDone.entityName}. ${justDone.error ?? "O novo valor foi confirmado por releitura."}`
            : `Não aplicada: ${justDone.error ?? "erro desconhecido"}`}
        </Notice>
      )}

      {view === "historico" && (
        <Card>
          <CardHeader title="Histórico de alterações" description="Registo de tudo o que foi aplicado, falhado ou cancelado. Também consta da Atividade (auditoria)." />
          {history.length ? (
            <ul className="divide-y">
              {history.map((c) => (
                <HistoryRow key={c.id} c={c} fmt={ctx.fmt} accountName={account[c.dataSourceId] ?? "conta"} names={names} canWrite={canWrite} />
              ))}
            </ul>
          ) : (
            <EmptyState title="Ainda não há alterações" />
          )}
        </Card>
      )}
    </div>
  );
}
