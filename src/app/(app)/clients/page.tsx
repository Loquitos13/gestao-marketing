import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatRelative, formatValue } from "@/lib/format";
import { requireOrg } from "@/server/auth/guard";
import { accessibleClientsWhere } from "@/server/auth/tenant";
import { can } from "@/server/auth/rbac";
import { PLATFORM_LABELS } from "@/server/integrations/registry";
import { restoreClientAction } from "@/server/actions/clients";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, Dot, EmptyState, Initials, LinkButton, PageHeader } from "@/components/ui";
import { Tbl, Td } from "@/components/simple-table";

export const metadata = { title: "Clientes" };

const CONTRACT = { PROSPECT: ["Prospeção", "neutral"], ACTIVE: ["Ativo", "good"], PAUSED: ["Pausado", "warn"], ENDED: ["Terminado", "neutral"] } as const;

const sourceTone = (p: string) => (p === "GOOGLE_ADS" ? "google" : p === "META_ADS" ? "meta" : "seo");

export default async function ClientsPage() {
  const ctx = await requireOrg();
  const where = accessibleClientsWhere(ctx);
  const [clients, archived] = await Promise.all([
    prisma.client.findMany({
      where,
      orderBy: [{ isDemo: "asc" }, { name: "asc" }],
      include: { dataSources: { where: { status: { not: "DISCONNECTED" } }, select: { platform: true, origin: true, status: true, lastSuccessfulSyncAt: true } } },
    }),
    can(ctx.role, "client:write") ? prisma.client.findMany({ where: { organizationId: ctx.organizationId, archivedAt: { not: null } }, orderBy: { archivedAt: "desc" } }) : Promise.resolve([]),
  ]);

  return (
    <div className="w-full max-w-[1480px] space-y-5 px-6 pb-6 pt-5">
      <PageHeader title="Clientes" description={`${clients.length} cliente(s) ativos.`} actions={can(ctx.role, "client:write") ? <LinkButton href="/clients/new" variant="primary">Novo cliente</LinkButton> : undefined} />
      <Card>
        {!clients.length ? (
          <EmptyState title="Sem clientes" description="Crie um cliente para começar." />
        ) : (
          <Tbl head={[{ label: "Cliente" }, { label: "Contrato" }, { label: "Fontes ligadas" }, { label: "Orç. mensal", num: true }, { label: "Última sincronização" }, { label: "" }]}>
            {clients.map((c) => {
              const fmt = { locale: c.locale, currency: c.currency, timezone: c.timezone };
              const last = c.dataSources.reduce<Date | null>((a, s) => (s.lastSuccessfulSyncAt && (!a || s.lastSuccessfulSyncAt > a) ? s.lastSuccessfulSyncAt : a), null);
              const [label, v] = CONTRACT[c.contractStatus];
              return (
                <tr key={c.id}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <Initials name={c.name} />
                      <div className="min-w-0">
                        <Link href={`/c/${c.id}/overview`} className="font-medium hover:underline">
                          {c.name}
                        </Link>
                        <div className="text-[11.5px] text-muted">{[c.industry, c.website?.replace(/^https?:\/\//, "")].filter(Boolean).join(" · ") || "—"}</div>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <div className="flex gap-1">
                      <Badge variant={v}>{label}</Badge>
                      {c.isDemo && <Badge variant="warn">Simulado</Badge>}
                    </div>
                  </Td>
                  <Td className="whitespace-normal">
                    {c.dataSources.length ? (
                      <div className="flex max-w-[420px] flex-wrap gap-x-3 gap-y-1 text-fg-2">
                        {c.dataSources.map((s, i) => (
                          <span key={i} className="inline-flex items-center gap-1.5" title={s.status === "ERROR" ? "Erro na última sincronização" : undefined}>
                            <Dot tone={s.status === "ERROR" ? "err" : sourceTone(s.platform)} />
                            {PLATFORM_LABELS[s.platform]}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted">Nenhuma</span>
                    )}
                  </Td>
                  <Td num>{c.monthlyBudget === null ? "—" : formatValue(Number(c.monthlyBudget), "currency", fmt)}</Td>
                  <Td className="text-muted">{last ? formatRelative(last, fmt) : "Nunca"}</Td>
                  <Td className="text-right">
                    <Link href={`/c/${c.id}/settings`} className="text-muted hover:text-fg">
                      Editar
                    </Link>
                  </Td>
                </tr>
              );
            })}
          </Tbl>
        )}
      </Card>
      {archived.length > 0 && (
        <Card>
          <CardHeader title="Arquivados" description="Clientes ocultos; os dados mantêm-se até serem eliminados." />
          <ul className="divide-y">
            {archived.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-4 py-2 text-xs">
                <span>{c.name}</span>
                <ActionForm action={restoreClientAction} submitLabel="Reativar" size="sm" variant="secondary" inline>
                  <input type="hidden" name="clientId" value={c.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
