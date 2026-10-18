import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/server/auth/guard";
import { can } from "@/server/auth/rbac";
import { listQueueJobs, STATE_LABEL } from "@/server/sync/job-board";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui";

export const metadata = { title: "Tarefas" };

export default async function JobsPage() {
  const ctx = await requireOrg();
  if (!can(ctx.role, "sync:run")) notFound();
  const board = await listQueueJobs();

  return (
    <div className="w-full max-w-[1480px] space-y-5 px-6 pb-6 pt-5">
      <PageHeader title="Tarefas" description="Fila de sincronizações, manutenção, agente e pesquisa de concorrência. O worker trata destas tarefas; sem ele, ficam à espera." />
      {!board.redis ? (
        <Notice>Sem Redis configurado. As sincronizações correm no próprio pedido e não há fila para mostrar.</Notice>
      ) : (
        <>
          {!board.worker && (
            <Notice variant="bad">
              O worker não está a correr. Inicie-o com <span className="font-mono">npm run worker</span>. Enquanto estiver parado, estas tarefas não avançam.
            </Notice>
          )}
          <Card>
            {!board.jobs.length ? (
              <EmptyState title="Sem tarefas à espera ou falhadas" />
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-muted">
                    <th className="px-4 py-2 font-medium">Estado</th>
                    <th className="px-4 py-2 font-medium">Fila</th>
                    <th className="px-4 py-2 font-medium">Tarefa</th>
                    <th className="px-4 py-2 font-medium">Tentativas</th>
                    <th className="px-4 py-2 font-medium">Quando</th>
                    <th className="px-4 py-2 font-medium">Erro</th>
                  </tr>
                </thead>
                <tbody>
                  {board.jobs.map((job) => (
                    <tr key={`${job.queue}:${job.id}:${job.state}`} className="border-b last:border-0">
                      <td className="px-4 py-2">{STATE_LABEL[job.state]}</td>
                      <td className="px-4 py-2">{job.queueLabel}</td>
                      <td className="px-4 py-2 font-mono">{job.name}</td>
                      <td className="tabular px-4 py-2">
                        {job.attemptsMade}/{job.attempts}
                      </td>
                      <td className="px-4 py-2 text-muted">{new Date(job.at).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" })}</td>
                      <td className="max-w-[360px] px-4 py-2 text-bad">{job.failedReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <p className="text-xs text-muted">
            <Link href="/integrations" className="underline">
              Integrações
            </Link>{" "}
            mostra o estado das contas. Esta página mostra só o que está na fila.
          </p>
        </>
      )}
    </div>
  );
}
