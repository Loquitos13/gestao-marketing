import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatTimestamp } from "@/lib/format";
import { requireOrg } from "@/server/auth/guard";
import { can, ROLE_LABELS } from "@/server/auth/rbac";
import { addMemberAction, changePasswordAction, changeRoleAction, removeMemberAction, revokeSessionsAction, updateOrgAction } from "@/server/actions/org";
import { addExchangeRateAction, deleteExchangeRateAction } from "@/server/actions/fx";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, EmptyState, Field, inputClass, PageHeader } from "@/components/ui";

export const metadata = { title: "Definições" };

const PAGE = 50;

export default async function SettingsPage(props: { searchParams: Promise<{ page?: string; action?: string }> }) {
  const sp = await props.searchParams;
  const ctx = await requireOrg();
  const org = ctx.organization;
  const fmt = { locale: "pt-PT", currency: org.defaultCurrency, timezone: org.defaultTimezone };
  const manageOrg = can(ctx.role, "org:manage");
  const manageMembers = can(ctx.role, "member:manage");
  const readAudit = can(ctx.role, "audit:read");
  const page = Math.max(1, Math.min(1000, Number(sp.page) || 1));
  const actionFilter = sp.action && /^[a-z.]{1,60}$/.test(sp.action) ? sp.action : undefined;
  const auditWhere = { organizationId: org.id, ...(actionFilter ? { action: { startsWith: actionFilter } } : {}) };
  const [members, sessions, audits, auditCount, rates] = await Promise.all([
    prisma.organizationMember.findMany({ where: { organizationId: org.id }, include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.session.count({ where: { userId: ctx.userId, expiresAt: { gt: new Date() } } }),
    readAudit ? prisma.auditLog.findMany({ where: auditWhere, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { user: { select: { name: true } }, client: { select: { name: true } } } }) : Promise.resolve([]),
    readAudit ? prisma.auditLog.count({ where: auditWhere }) : Promise.resolve(0),
    prisma.exchangeRate.findMany({ orderBy: [{ date: "desc" }, { base: "asc" }], take: 30 }),
  ]);
  const pages = Math.max(1, Math.ceil(auditCount / PAGE));
  const qs = (p: number) => `/settings?page=${p}${actionFilter ? `&action=${actionFilter}` : ""}#auditoria`;

  return (
    <div className="w-full max-w-[1480px] space-y-5 px-6 pb-6 pt-5">
      <PageHeader title="Definições" description="Organização, utilizadores e permissões, conta pessoal e registo de auditoria." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Organização" description="A cor e o logótipo são usados nos relatórios." />
          <div className="p-4">
            {manageOrg ? (
              <ActionForm action={updateOrgAction} submitLabel="Guardar">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Nome">
                    <input name="name" required defaultValue={org.name} className={inputClass} />
                  </Field>
                  <Field label="Cor da marca (#RRGGBB)">
                    <input name="brandColor" required pattern="#[0-9a-fA-F]{6}" defaultValue={org.brandColor} className={inputClass} />
                  </Field>
                  <Field label="Logótipo (URL https)">
                    <input name="logoUrl" type="url" defaultValue={org.logoUrl ?? ""} className={inputClass} />
                  </Field>
                  <Field label="Moeda por omissão">
                    <input name="defaultCurrency" required pattern="[A-Z]{3}" defaultValue={org.defaultCurrency} className={inputClass} />
                  </Field>
                  <Field label="Fuso horário por omissão">
                    <input name="defaultTimezone" required defaultValue={org.defaultTimezone} className={inputClass} />
                  </Field>
                  <Field label="Retenção de métricas (dias)" hint="Métricas diárias mais antigas são eliminadas diariamente.">
                    <input name="dataRetentionDays" type="number" min={90} max={3650} required defaultValue={org.dataRetentionDays} className={inputClass} />
                  </Field>
                </div>
              </ActionForm>
            ) : (
              <p className="text-xs text-muted">Só o proprietário pode alterar a organização.</p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="A minha conta" description={`${ctx.userName} · ${ctx.userEmail} · ${ROLE_LABELS[ctx.role]}`} />
          <div className="space-y-4 p-4">
            <ActionForm action={changePasswordAction} submitLabel="Alterar password" resetOnSuccess>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Password atual">
                  <input name="current" type="password" required autoComplete="current-password" className={inputClass} />
                </Field>
                <Field label="Nova password" hint="Mín. 10 caracteres, letras e números.">
                  <input name="next" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
                </Field>
                <Field label="Confirmar">
                  <input name="confirm" type="password" required autoComplete="new-password" className={inputClass} />
                </Field>
              </div>
            </ActionForm>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-xs">
              <span>{sessions} sessão(ões) ativa(s).</span>
              <ActionForm action={revokeSessionsAction} submitLabel="Terminar outras sessões" size="sm" variant="secondary" inline />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-xs">
              <span>Exportar os meus dados pessoais (RGPD).</span>
              <a href="/api/gdpr/me" className="rounded-md border px-3 py-1.5 hover:bg-surface-2">
                Exportar JSON
              </a>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Utilizadores e permissões" description="Proprietário: tudo · Administrador: tudo exceto organização · Analista: análise, relatórios, orçamentos e decisões · Leitor: apenas clientes atribuídos, só leitura." />
        <ul className="divide-y">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-xs">
              <div className="min-w-0 flex-1">
                <span className="font-medium">{m.user.name}</span> <span className="text-muted">{m.user.email}</span> {m.userId === ctx.userId && <Badge>Eu</Badge>}
                <div className="text-[11px] text-muted">Último acesso: {m.user.lastLoginAt ? formatTimestamp(m.user.lastLoginAt, fmt) : "nunca"}</div>
              </div>
              {manageMembers && m.userId !== ctx.userId ? (
                <>
                  <ActionForm action={changeRoleAction} submitLabel="Aplicar" size="sm" variant="secondary" inline>
                    <input type="hidden" name="userId" value={m.userId} />
                    <select name="role" defaultValue={m.role} className={`${inputClass} h-7 w-40`}>
                      {(["OWNER", "ADMIN", "ANALYST", "VIEWER"] as const).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </ActionForm>
                  <ActionForm action={removeMemberAction} submitLabel="Remover" size="sm" variant="ghost" inline confirm={`Remover ${m.user.name} da organização?`}>
                    <input type="hidden" name="userId" value={m.userId} />
                  </ActionForm>
                </>
              ) : (
                <Badge variant="accent">{ROLE_LABELS[m.role]}</Badge>
              )}
            </li>
          ))}
        </ul>
        {manageMembers && (
          <div className="border-t p-4">
            <ActionForm action={addMemberAction} submitLabel="Adicionar membro" resetOnSuccess>
              <div className="grid gap-3 md:grid-cols-4">
                <Field label="Nome">
                  <input name="name" required className={inputClass} />
                </Field>
                <Field label="Email">
                  <input name="email" type="email" required className={inputClass} />
                </Field>
                <Field label="Papel">
                  <select name="role" defaultValue="ANALYST" className={inputClass}>
                    <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>
                    <option value="ANALYST">{ROLE_LABELS.ANALYST}</option>
                    <option value="VIEWER">{ROLE_LABELS.VIEWER}</option>
                  </select>
                </Field>
                <Field label="Password inicial" hint="Comunique por canal seguro.">
                  <input name="password" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
                </Field>
              </div>
            </ActionForm>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Taxas de câmbio"
          description="Usadas apenas quando uma conta de anúncios reporta numa moeda diferente da do cliente. Sem taxa registada até à data do período, o valor não é convertido e aparece como «Não disponível». É usada a taxa mais recente até ao fim do período."
        />
        {!rates.length ? (
          <EmptyState title="Sem taxas registadas" description="Não é feita nenhuma conversão de moeda enquanto não existirem taxas documentadas." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead className="text-left text-muted">
                <tr className="border-b">
                  <th className="px-4 py-2 font-medium">Data</th>
                  <th className="px-3 py-2 font-medium">Par</th>
                  <th className="px-3 py-2 text-right font-medium">Taxa</th>
                  <th className="px-3 py-2 font-medium">Fonte</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rates.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-1.5 tabular">{r.date.toISOString().slice(0, 10)}</td>
                    <td className="px-3 py-1.5 font-mono">
                      1 {r.base} = {r.quote}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular">{Number(r.rate)}</td>
                    <td className="max-w-xs truncate px-3 py-1.5 text-muted" title={r.source}>
                      {r.source}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {manageOrg && (
                        <ActionForm action={deleteExchangeRateAction} submitLabel="Remover" size="sm" variant="ghost" inline confirm="Remover esta taxa?">
                          <input type="hidden" name="id" value={r.id} />
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {manageOrg && (
          <div className="border-t p-4">
            <ActionForm action={addExchangeRateAction} submitLabel="Registar taxa" resetOnSuccess>
              <div className="grid gap-3 md:grid-cols-5">
                <Field label="Data">
                  <input name="date" type="date" required className={inputClass} />
                </Field>
                <Field label="Moeda base">
                  <input name="base" required pattern="[A-Za-z]{3}" placeholder="USD" className={inputClass} />
                </Field>
                <Field label="Moeda destino">
                  <input name="quote" required pattern="[A-Za-z]{3}" placeholder="EUR" className={inputClass} />
                </Field>
                <Field label="Taxa (1 base = x destino)">
                  <input name="rate" type="number" step="any" min="0" required className={inputClass} />
                </Field>
                <Field label="Fonte" hint="Ex.: BCE, taxa de referência">
                  <input name="source" required minLength={3} className={inputClass} />
                </Field>
              </div>
            </ActionForm>
          </div>
        )}
      </Card>

      {readAudit && (
        <Card>
          <div id="auditoria" />
          <CardHeader
            title="Registo de auditoria"
            description={`${auditCount} registo(s). Ações de utilizadores e processos automáticos; IPs guardados apenas como hash.`}
            actions={
              <form className="flex gap-2" action="/settings">
                <input name="action" placeholder="Filtrar ação (ex.: report)" defaultValue={actionFilter ?? ""} className={`${inputClass} h-7 w-48`} />
              </form>
            }
          />
          {!audits.length ? (
            <EmptyState title="Sem registos" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-xs">
                <thead className="text-left text-muted">
                  <tr className="border-b">
                    <th className="px-4 py-2 font-medium">Quando</th>
                    <th className="px-3 py-2 font-medium">Quem</th>
                    <th className="px-3 py-2 font-medium">Cliente</th>
                    <th className="px-3 py-2 font-medium">Ação</th>
                    <th className="px-3 py-2 font-medium">Detalhe</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {audits.map((a) => (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap px-4 py-1.5 tabular">{formatTimestamp(a.createdAt, fmt)}</td>
                      <td className="px-3 py-1.5">{a.user?.name ?? "Sistema"}</td>
                      <td className="px-3 py-1.5">{a.client?.name ?? "—"}</td>
                      <td className="px-3 py-1.5 font-mono text-[11px]">{a.action}</td>
                      <td className="max-w-sm truncate px-3 py-1.5 font-mono text-[11px] text-muted" title={a.metadata ? JSON.stringify(a.metadata) : undefined}>
                        {a.metadata ? JSON.stringify(a.metadata) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-end gap-3 border-t px-4 py-2 text-xs">
              {page > 1 && <Link href={qs(page - 1)}>← Anterior</Link>}
              <span className="text-muted">
                Página {page} de {pages}
              </span>
              {page < pages && <Link href={qs(page + 1)}>Seguinte →</Link>}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
