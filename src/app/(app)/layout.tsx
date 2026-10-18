import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatRelative } from "@/lib/format";
import { requireOrg } from "@/server/auth/guard";
import { accessibleClientsWhere } from "@/server/auth/tenant";
import { can, ROLE_LABELS } from "@/server/auth/rbac";
import { getConfig } from "@/server/config/settings";
import { workerIsRunning } from "@/server/sync/worker-presence";
import { Sidebar, type SidebarStats } from "@/components/sidebar";
import { logout } from "@/app/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrg();
  const where = { ...accessibleClientsWhere(ctx), archivedAt: null };
  const [clients, openAlerts, lastSync, errors] = await Promise.all([
    prisma.client.findMany({ where, select: { id: true, name: true, isDemo: true }, orderBy: [{ isDemo: "asc" }, { name: "asc" }] }),
    prisma.alert.count({ where: { status: "OPEN", client: where } }),
    prisma.dataSource.aggregate({ where: { client: where, status: { not: "DISCONNECTED" } }, _max: { lastSuccessfulSyncAt: true } }),
    prisma.dataSource.count({ where: { client: where, status: "ERROR" } }),
  ]);
  const last = lastSync._max.lastSuccessfulSyncAt;
  const sync: SidebarStats["sync"] = errors
    ? { label: `${errors} fonte(s) com erro`, tone: "err" }
    : last
      ? { label: `Sincronizado ${formatRelative(last)}`, tone: "on" }
      : { label: "Sem sincronizações", tone: "off" };
  const redisUrl = (await getConfig()).REDIS_URL;
  const workerDown = redisUrl ? !(await workerIsRunning(redisUrl)) : false;
  const showJobs = can(ctx.role, "sync:run");
  return (
    <div className="flex min-h-screen">
      <Sidebar
        orgName={ctx.organization.name}
        clients={clients}
        stats={{ clients: clients.length, openAlerts, sync }}
        user={{ name: ctx.userName, email: ctx.userEmail, role: ROLE_LABELS[ctx.role] }}
        canCreateClient={can(ctx.role, "client:write")}
        showJobs={showJobs}
        logoutAction={logout}
      />
      <main className="min-w-0 flex-1">
        {workerDown && (
          <div className="border-b bg-warn-soft px-6 py-2 text-xs text-warn">
            O worker não está a correr. Sincronizações, relatórios agendados e análises ficam na fila até iniciar <span className="font-mono">npm run worker</span>.
            {showJobs && (
              <>
                {" "}
                <Link href="/jobs" className="underline">
                  Ver tarefas
                </Link>
                .
              </>
            )}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
