import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { integrationStatus } from "@/server/config/settings";
import { formatRange, formatRelative, formatTimestamp } from "@/lib/format";
import { can } from "@/server/auth/rbac";
import { PLATFORM_LABELS } from "@/server/integrations/registry";
import { disconnectSourceAction, linkAccountAction, linkSemrushAction, syncNowAction } from "@/server/actions/sources";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, Dot, EmptyState, Field, inputClass, LinkButton, Notice, OriginBadge, PageHeader } from "@/components/ui";
import { clientContext } from "../page-context";

export const metadata = { title: "Fontes de dados" };

const STATUS_VARIANT = { ACTIVE: "good", PAUSED: "neutral", ERROR: "bad", DISCONNECTED: "warn" } as const;
const STATUS_LABEL = { ACTIVE: "Ativa", PAUSED: "Pausada", ERROR: "Erro", DISCONNECTED: "Desligada" } as const;

export default async function SourcesPage(props: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await props.params;
  const { client, tenant, ctx } = await clientContext(clientId);
  const fmt = ctx.fmt;
  const cfg = await integrationStatus();
  const manage = can(tenant.role, "integration:manage");
  const sync = can(tenant.role, "sync:run");
  const [sources, accounts] = await Promise.all([
    prisma.dataSource.findMany({
      where: { clientId: client.id },
      orderBy: [{ platform: "asc" }, { name: "asc" }],
      include: { syncJobs: { orderBy: { queuedAt: "desc" }, take: 1 }, connectedAccount: { include: { credential: { select: { status: true, externalUserName: true } } } } },
    }),
    manage
      ? prisma.connectedAccount.findMany({
          where: { credential: { organizationId: tenant.organizationId, status: "ACTIVE" } },
          orderBy: [{ platform: "asc" }, { name: "asc" }],
          include: { credential: { select: { externalUserName: true, provider: true } }, dataSources: { select: { clientId: true } } },
        })
      : Promise.resolve([]),
  ]);
  const linked = new Set(sources.filter((s) => s.status !== "DISCONNECTED").map((s) => `${s.platform}:${s.externalId}`));
  const available = accounts.filter((a) => !linked.has(`${a.platform}:${a.externalId}`));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fontes de dados"
        description="Contas externas ligadas a este cliente. Os dados só são considerados reais depois de uma sincronização concluída com sucesso."
        actions={manage ? <LinkButton href="/integrations" variant="secondary">Gerir integrações</LinkButton> : undefined}
      />
      {client.isDemo && (
        <Notice variant="warn">
          Cliente de demonstração: todas as fontes são <strong>simuladas</strong>. “Sincronizar” regenera dados fictícios determinísticos; nenhuma API externa é contactada.
        </Notice>
      )}
      {!sources.length ? (
        <Card>
          <EmptyState title="Sem fontes ligadas" description="Ligue uma conta Google ou Meta em Integrações e associe-a a este cliente abaixo." />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sources.map((s) => {
            const job = s.syncJobs[0];
            const credStatus = s.connectedAccount?.credential.status;
            return (
              <Card key={s.id}>
                <CardHeader
                  title={
                    <span className="inline-flex items-center gap-2">
                      <Dot tone={s.platform === "GOOGLE_ADS" ? "google" : s.platform === "META_ADS" ? "meta" : "seo"} />
                      {PLATFORM_LABELS[s.platform]}
                    </span>
                  }
                  description={`${s.name} · ID ${s.externalId} · ${s.currency} · ${s.timezone}`}
                  actions={
                    <div className="flex gap-1.5">
                      <OriginBadge origin={s.origin} />
                      <Badge variant={STATUS_VARIANT[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                    </div>
                  }
                />
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-xs">
                  <dt className="text-muted">Última sincronização</dt>
                  <dd title={formatTimestamp(s.lastSyncAt, fmt)}>{s.lastSyncAt ? formatRelative(s.lastSyncAt, fmt) : "Nunca"}</dd>
                  <dt className="text-muted">Último sucesso</dt>
                  <dd>{s.lastSuccessfulSyncAt ? formatTimestamp(s.lastSuccessfulSyncAt, fmt) : "Nunca"}</dd>
                  <dt className="text-muted">Dados disponíveis</dt>
                  <dd>{s.historyStartDate && s.dataAvailableUntil ? formatRange(s.historyStartDate.toISOString().slice(0, 10), s.dataAvailableUntil.toISOString().slice(0, 10), fmt) : "Não disponível"}</dd>
                  <dt className="text-muted">Último job</dt>
                  <dd>{job ? `${job.kind === "HISTORICAL" ? "Histórico" : "Incremental"} · ${job.status} · ${job.rowsUpserted} linhas` : "—"}</dd>
                  {s.connectedAccount && (
                    <>
                      <dt className="text-muted">Credencial</dt>
                      <dd>
                        {s.connectedAccount.credential.externalUserName ?? "—"} {credStatus !== "ACTIVE" && <Badge variant="bad">{credStatus}</Badge>}
                      </dd>
                    </>
                  )}
                </dl>
                {s.lastError && <p className="mx-4 mb-3 rounded-md bg-bad/10 px-3 py-2 text-xs text-bad">{s.lastError}</p>}
                {(sync || manage) && s.status !== "DISCONNECTED" && (
                  <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
                    {sync && (
                      <ActionForm action={syncNowAction} submitLabel="Sincronizar agora" size="sm" inline>
                        <input type="hidden" name="clientId" value={client.id} />
                        <input type="hidden" name="dataSourceId" value={s.id} />
                      </ActionForm>
                    )}
                    {sync && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted hover:text-fg">Histórico / reprocessar período</summary>
                        <ActionForm action={syncNowAction} submitLabel="Reprocessar" size="sm" variant="secondary" className="mt-2">
                          <input type="hidden" name="clientId" value={client.id} />
                          <input type="hidden" name="dataSourceId" value={s.id} />
                          <input type="hidden" name="kind" value="HISTORICAL" />
                          <input type="hidden" name="historyDays" value="365" />
                          <div className="grid grid-cols-2 gap-2">
                            <Field label="Início">
                              <input type="date" name="start" className={inputClass} />
                            </Field>
                            <Field label="Fim">
                              <input type="date" name="end" className={inputClass} />
                            </Field>
                          </div>
                          <p className="text-[11px] text-muted">Sem datas: últimos 365 dias (limitado ao histórico máximo da plataforma). Os dados existentes no período são substituídos (sem duplicados).</p>
                        </ActionForm>
                      </details>
                    )}
                    {manage && (
                      <div className="ml-auto flex gap-2">
                        <ActionForm action={disconnectSourceAction} submitLabel="Desligar" size="sm" variant="ghost" inline confirm="Desligar esta fonte? Os dados históricos são mantidos.">
                          <input type="hidden" name="clientId" value={client.id} />
                          <input type="hidden" name="dataSourceId" value={s.id} />
                        </ActionForm>
                        <ActionForm action={disconnectSourceAction} submitLabel="Eliminar dados" size="sm" variant="danger" inline confirm="Eliminar esta fonte e TODOS os dados importados dela? Esta ação não pode ser anulada.">
                          <input type="hidden" name="clientId" value={client.id} />
                          <input type="hidden" name="dataSourceId" value={s.id} />
                          <input type="hidden" name="purge" value="1" />
                        </ActionForm>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {manage && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Associar conta descoberta" description="Contas acessíveis através das credenciais OAuth da organização." />
            {!available.length ? (
              <EmptyState
                title="Sem contas disponíveis"
                description={cfg.google || cfg.meta ? "Ligue uma conta em Integrações ou volte a listar as contas de uma credencial existente." : "Nenhum fornecedor OAuth está configurado. Preencha as credenciais Google ou Meta em Integrações → Configuração."}
              />
            ) : (
              <div className="p-4">
                <ActionForm action={linkAccountAction} submitLabel="Associar e importar histórico">
                  <input type="hidden" name="clientId" value={client.id} />
                  <Field label="Conta">
                    <select name="accountId" required className={inputClass}>
                      {available.map((a) => (
                        <option key={a.id} value={a.id}>
                          {PLATFORM_LABELS[a.platform]} · {a.name} ({a.externalId}){a.dataSources.some((d) => d.clientId !== client.id) ? " · já usada noutro cliente" : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Histórico a importar (dias)">
                    <input type="number" name="historyDays" min={7} max={1100} defaultValue={365} className={inputClass} />
                  </Field>
                </ActionForm>
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Semrush (opcional)" description="Posições orgânicas por domínio. A chave da API fica apenas no servidor." />
            <div className="p-4">
              {cfg.semrush ? (
                <ActionForm action={linkSemrushAction} submitLabel="Ligar domínio">
                  <input type="hidden" name="clientId" value={client.id} />
                  <Field label="Domínio">
                    <input name="domain" required placeholder="exemplo.pt" defaultValue={client.website?.replace(/^https?:\/\//, "").replace(/\/.*$/, "") ?? ""} className={inputClass} />
                  </Field>
                </ActionForm>
              ) : (
                <p className="text-xs text-muted">
                  Não configurado: defina <code>SEMRUSH_API_KEY</code> no servidor. Consulte <Link className="underline" href="/integrations">Integrações</Link>.
                </p>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
