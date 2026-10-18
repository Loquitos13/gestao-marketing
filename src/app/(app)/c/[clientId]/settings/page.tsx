import { prisma } from "@/lib/prisma";
import { formatValue } from "@/lib/format";
import { can, ROLE_LABELS } from "@/server/auth/rbac";
import { archiveClientAction, deleteClientAction, grantClientAccessAction, updateClientAction } from "@/server/actions/clients";
import { createGoal, deleteGoal } from "@/server/actions/budget";
import { ActionForm } from "@/components/action-form";
import { ClientFields } from "@/components/client-fields";
import { Badge, Card, CardHeader, EmptyState, Field, inputClass, PageHeader } from "@/components/ui";
import { endOfMonth, startOfMonth, todayInTz } from "@/lib/dates";
import type { Unit } from "@/lib/format";
import { clientContext } from "../page-context";

export const metadata = { title: "Definições do cliente" };

const GOALS: Record<string, { label: string; unit: Unit }> = {
  LEADS: { label: "Leads (mínimo)", unit: "number" },
  CONVERSIONS: { label: "Conversões (mínimo)", unit: "number" },
  REVENUE: { label: "Receita (mínimo)", unit: "currency" },
  CPA_MAX: { label: "CPA máximo", unit: "currency" },
  CPL_MAX: { label: "Custo por lead máximo", unit: "currency" },
  ROAS_MIN: { label: "ROAS mínimo", unit: "multiplier" },
  CTR_MIN: { label: "CTR mínimo (fração, ex.: 0.02)", unit: "percent" },
  SESSIONS: { label: "Sessões (mínimo)", unit: "number" },
  ORGANIC_CLICKS: { label: "Cliques orgânicos (mínimo)", unit: "number" },
  AVG_POSITION_MAX: { label: "Posição média máxima", unit: "position" },
};

export default async function ClientSettingsPage(props: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await props.params;
  const { client, tenant, ctx } = await clientContext(clientId);
  const fmt = ctx.fmt;
  const write = can(tenant.role, "client:write");
  const goalsWrite = can(tenant.role, "budget:write");
  const members = can(tenant.role, "member:manage");
  const today = todayInTz(client.timezone);
  const [goals, viewers, access] = await Promise.all([
    prisma.goal.findMany({ where: { clientId: client.id }, orderBy: { periodStart: "desc" }, take: 40 }),
    members ? prisma.organizationMember.findMany({ where: { organizationId: tenant.organizationId, role: "VIEWER" }, include: { user: { select: { id: true, name: true, email: true } } } }) : Promise.resolve([]),
    members ? prisma.clientMember.findMany({ where: { clientId: client.id }, select: { userId: true } }) : Promise.resolve([]),
  ]);
  const granted = new Set(access.map((a) => a.userId));

  return (
    <div className="space-y-5">
      <PageHeader title="Definições do cliente" description="Dados do cliente, objetivos, acessos e privacidade." />
      <Card>
        <CardHeader title="Dados do cliente" />
        <div className="p-4">
          {write ? (
            <ActionForm action={updateClientAction} submitLabel="Guardar alterações">
              <input type="hidden" name="clientId" value={client.id} />
              <ClientFields client={client} />
            </ActionForm>
          ) : (
            <p className="text-xs text-muted">Sem permissão para editar.</p>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Objetivos" description="Usados na comparação com os resultados, nas recomendações e nos alertas." />
          {!goals.length ? (
            <EmptyState title="Sem objetivos definidos" />
          ) : (
            <ul className="divide-y">
              {goals.map((g) => {
                const def = GOALS[g.metric];
                return (
                  <li key={g.id} className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
                    <span>
                      <strong>{def?.label ?? g.metric}</strong>: {formatValue(Number(g.target), def?.unit ?? "number", fmt)} · {g.periodStart.toISOString().slice(0, 10)} – {g.periodEnd.toISOString().slice(0, 10)}
                    </span>
                    {goalsWrite && (
                      <ActionForm action={deleteGoal} submitLabel="Remover" size="sm" variant="ghost" inline confirm="Remover este objetivo?">
                        <input type="hidden" name="clientId" value={client.id} />
                        <input type="hidden" name="goalId" value={g.id} />
                      </ActionForm>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {goalsWrite && (
            <div className="border-t p-4">
              <ActionForm action={createGoal} submitLabel="Adicionar objetivo" resetOnSuccess>
                <input type="hidden" name="clientId" value={client.id} />
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Métrica">
                    <select name="metric" className={inputClass}>
                      {Object.entries(GOALS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Meta">
                    <input name="target" type="number" step="any" min="0" required className={inputClass} />
                  </Field>
                  <Field label="Início">
                    <input name="periodStart" type="date" required defaultValue={startOfMonth(today)} className={inputClass} />
                  </Field>
                  <Field label="Fim">
                    <input name="periodEnd" type="date" required defaultValue={endOfMonth(today)} className={inputClass} />
                  </Field>
                </div>
              </ActionForm>
            </div>
          )}
        </Card>

        {members && (
          <Card>
            <CardHeader title="Acesso de leitores" description={`Membros com papel “${ROLE_LABELS.VIEWER}” só veem os clientes atribuídos aqui.`} />
            {!viewers.length ? (
              <EmptyState title="Sem leitores na organização" description="Convide utilizadores com papel de leitor nas definições da organização." />
            ) : (
              <ul className="divide-y">
                {viewers.map((v) => {
                  const has = granted.has(v.userId);
                  return (
                    <li key={v.id} className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
                      <span>
                        {v.user.name} <span className="text-muted">({v.user.email})</span> {has && <Badge variant="good">Com acesso</Badge>}
                      </span>
                      <ActionForm action={grantClientAccessAction} submitLabel={has ? "Remover acesso" : "Dar acesso"} size="sm" variant={has ? "ghost" : "secondary"} inline>
                        <input type="hidden" name="clientId" value={client.id} />
                        <input type="hidden" name="userId" value={v.userId} />
                        {has && <input type="hidden" name="remove" value="1" />}
                      </ActionForm>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}
      </div>

      <Card>
        <CardHeader title="Privacidade e dados (RGPD)" />
        <div className="space-y-4 p-4 text-xs">
          {can(tenant.role, "data:export") && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>Exportar todos os dados deste cliente (perfil, fontes sem tokens, métricas, relatórios, recomendações, alertas) em JSON.</p>
              <a href={`/api/gdpr/client/${client.id}`} className="rounded-md border px-3 py-1.5 hover:bg-surface-2">
                Exportar JSON
              </a>
            </div>
          )}
          {write && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
              <p>Arquivar: o cliente deixa de aparecer e os agendamentos são desativados. Os dados mantêm-se e pode ser reativado.</p>
              <ActionForm action={archiveClientAction} submitLabel="Arquivar cliente" variant="secondary" size="sm" inline confirm="Arquivar este cliente?">
                <input type="hidden" name="clientId" value={client.id} />
              </ActionForm>
            </div>
          )}
          {can(tenant.role, "client:delete") && (
            <div className="space-y-2 border-t pt-4">
              <p className="text-bad">Eliminação definitiva: apaga o cliente e todos os dados associados. Não pode ser anulada.</p>
              <ActionForm action={deleteClientAction} submitLabel="Eliminar definitivamente" variant="danger" size="sm" confirm="Tem a certeza? Todos os dados deste cliente serão eliminados.">
                <input type="hidden" name="clientId" value={client.id} />
                <Field label={`Escreva “${client.name}” para confirmar`}>
                  <input name="confirmName" required autoComplete="off" className={inputClass} />
                </Field>
              </ActionForm>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
