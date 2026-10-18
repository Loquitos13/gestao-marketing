import { prisma } from "@/lib/prisma";
import { todayInTz } from "@/lib/dates";
import { can } from "@/server/auth/rbac";
import { createTask } from "@/server/actions/workspace";
import { loadTasks } from "@/server/queries/workspace";
import { ActionForm } from "@/components/action-form";
import { TaskList } from "@/components/workspace-lists";
import { Card, CardHeader, Field, inputClass, PageHeader } from "@/components/ui";
import { clientContext } from "../page-context";

export const metadata = { title: "Tarefas" };

export default async function TasksPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const { client, ctx, tenant } = await clientContext(clientId);
  const canWrite = can(tenant.role, "workspace:write");
  const [tasks, members] = await Promise.all([
    loadTasks(client.id),
    canWrite ? prisma.organizationMember.findMany({ where: { organizationId: tenant.organizationId }, include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }) : [],
  ]);
  const open = tasks.filter((t) => t.status === "OPEN");
  const done = tasks.filter((t) => t.status === "DONE");
  const today = todayInTz(client.timezone);
  const late = open.filter((t) => t.dueDate && t.dueDate.toISOString().slice(0, 10) < today).length;

  return (
    <div>
      <PageHeader title="Tarefas" description="Trabalho interno da equipa para este cliente. As tarefas não alteram nada nas plataformas de publicidade." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Abertas" description={`${open.length}${late ? ` · ${late} em atraso` : ""}`} />
            <TaskList tasks={open} clientId={client.id} canWrite={canWrite} today={today} fmt={ctx.fmt} showActions empty="Nenhuma tarefa aberta." />
          </Card>
          <Card>
            <CardHeader title="Concluídas" description={String(done.length)} />
            <TaskList tasks={done.slice(0, 30)} clientId={client.id} canWrite={canWrite} today={today} fmt={ctx.fmt} showActions empty="Ainda nenhuma tarefa concluída." />
          </Card>
        </div>
        {canWrite && (
          <Card className="self-start">
            <CardHeader title="Nova tarefa" />
            <div className="p-4">
              <ActionForm action={createTask} submitLabel="Criar tarefa" resetOnSuccess>
                <input type="hidden" name="clientId" value={client.id} />
                <Field label="Título">
                  <input name="title" required maxLength={200} className={inputClass} placeholder="Ex.: Rever termos de pesquisa com CPA alto" />
                </Field>
                <Field label="Descrição">
                  <textarea name="description" maxLength={2000} rows={3} className={`${inputClass} h-auto py-1.5`} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Área">
                    <input name="area" maxLength={60} list="task-areas" className={inputClass} placeholder="Google Ads" />
                    <datalist id="task-areas">
                      {["Google Ads", "Meta Ads", "SEO", "Conteúdo", "Relatórios", "Orçamento", "Reunião"].map((a) => (
                        <option key={a} value={a} />
                      ))}
                    </datalist>
                  </Field>
                  <Field label="Prazo">
                    <input name="dueDate" type="date" className={inputClass} />
                  </Field>
                  <Field label="Prioridade">
                    <select name="priority" defaultValue="2" className={inputClass}>
                      <option value="1">Alta</option>
                      <option value="2">Normal</option>
                      <option value="3">Baixa</option>
                    </select>
                  </Field>
                  <Field label="Responsável">
                    <select name="assigneeId" defaultValue={tenant.userId} className={inputClass}>
                      <option value="">Ninguém</option>
                      {members.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.user.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </ActionForm>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
