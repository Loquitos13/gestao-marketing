import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatRelative, formatTimestamp } from "@/lib/format";
import { requireOrg } from "@/server/auth/guard";
import { accessibleClientsWhere } from "@/server/auth/tenant";
import { can } from "@/server/auth/rbac";
import { setAlertStatus } from "@/server/actions/intelligence";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Alertas" };

const SEV = { CRITICAL: ["Crítico", "bad", 0], WARNING: ["Aviso", "warn", 1], INFO: ["Info", "neutral", 2] } as const;
const TABS = [
  ["OPEN", "Abertos"],
  ["ACKNOWLEDGED", "Reconhecidos"],
  ["RESOLVED", "Resolvidos"],
] as const;

export default async function GlobalAlertsPage(props: { searchParams: Promise<{ status?: string }> }) {
  const { status: raw } = await props.searchParams;
  const status = TABS.some(([k]) => k === raw) ? raw! : "OPEN";
  const ctx = await requireOrg();
  const manage = can(ctx.role, "alert:manage");
  const [alerts, counts] = await Promise.all([
    prisma.alert.findMany({ where: { status, client: accessibleClientsWhere(ctx) }, orderBy: { lastSeenAt: "desc" }, take: 200, include: { client: { select: { id: true, name: true, isDemo: true, timezone: true, locale: true, currency: true } } } }),
    prisma.alert.groupBy({ by: ["status"], where: { client: accessibleClientsWhere(ctx) }, _count: true }),
  ]);
  alerts.sort((a, b) => (SEV[a.severity as keyof typeof SEV]?.[2] ?? 3) - (SEV[b.severity as keyof typeof SEV]?.[2] ?? 3));
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;

  return (
    <div className="w-full max-w-[1480px] space-y-5 px-6 pb-6 pt-5">
      <PageHeader title="Alertas de todos os clientes" description="Alertas deduplicados: uma ocorrência repetida incrementa o contador em vez de criar um novo alerta. Regras configuráveis em cada cliente." />
      <nav className="flex gap-1 text-xs">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/alerts?status=${k}`} className={`rounded-md px-3 py-1.5 ${k === status ? "bg-surface-2 font-medium" : "text-muted hover:text-fg"}`}>
            {label} ({count(k)})
          </Link>
        ))}
      </nav>
      <Card>
        {!alerts.length ? (
          <EmptyState title="Sem alertas" />
        ) : (
          <ul className="divide-y">
            {alerts.map((a) => {
              const sev = SEV[a.severity as keyof typeof SEV] ?? SEV.INFO;
              const fmt = { locale: a.client.locale, currency: a.client.currency, timezone: a.client.timezone };
              return (
                <li key={a.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-xs">
                  <Badge variant={sev[1]}>{sev[0]}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/c/${a.client.id}/alerts`} className="font-medium hover:underline">
                        {a.client.name}
                      </Link>
                      {a.client.isDemo && <Badge variant="warn">Simulado</Badge>}
                      <span>{a.title}</span>
                    </div>
                    <p className="mt-0.5 text-muted">{a.message}</p>
                    <p className="mt-0.5 text-[11px] text-muted" title={`Primeira deteção: ${formatTimestamp(a.firstSeenAt, fmt)}`}>
                      {a.occurrences}× · última {formatRelative(a.lastSeenAt, fmt)}
                    </p>
                  </div>
                  {manage && a.status !== "RESOLVED" && (
                    <div className="flex gap-2">
                      {a.status === "OPEN" && (
                        <ActionForm action={setAlertStatus} submitLabel="Reconhecer" size="sm" variant="secondary" inline>
                          <input type="hidden" name="clientId" value={a.client.id} />
                          <input type="hidden" name="alertId" value={a.id} />
                          <input type="hidden" name="status" value="ACKNOWLEDGED" />
                        </ActionForm>
                      )}
                      <ActionForm action={setAlertStatus} submitLabel="Resolver" size="sm" variant="ghost" inline>
                        <input type="hidden" name="clientId" value={a.client.id} />
                        <input type="hidden" name="alertId" value={a.id} />
                        <input type="hidden" name="status" value="RESOLVED" />
                      </ActionForm>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
