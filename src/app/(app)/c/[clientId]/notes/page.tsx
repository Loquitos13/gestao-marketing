import { can } from "@/server/auth/rbac";
import { createNote } from "@/server/actions/workspace";
import { loadNotes } from "@/server/queries/workspace";
import { ActionForm } from "@/components/action-form";
import { NoteList } from "@/components/workspace-lists";
import { Card, CardHeader, inputClass, PageHeader } from "@/components/ui";
import { clientContext } from "../page-context";

export const metadata = { title: "Notas" };

export default async function NotesPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const { client, ctx, tenant } = await clientContext(clientId);
  const canWrite = can(tenant.role, "workspace:write");
  const notes = await loadNotes(client.id);
  const pinned = notes.filter((n) => n.pinned);
  const rest = notes.filter((n) => !n.pinned);

  return (
    <div>
      <PageHeader title="Notas" description="Contexto do cliente, decisões e pedidos. As notas fixadas aparecem na visão geral do workspace." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {pinned.length > 0 && (
            <Card>
              <CardHeader title="Fixadas" description={String(pinned.length)} />
              <NoteList notes={pinned} clientId={client.id} canWrite={canWrite} fmt={ctx.fmt} showActions />
            </Card>
          )}
          <Card>
            <CardHeader title="Todas as notas" description={String(rest.length)} />
            <NoteList notes={rest} clientId={client.id} canWrite={canWrite} fmt={ctx.fmt} showActions />
          </Card>
        </div>
        {canWrite && (
          <Card className="self-start">
            <CardHeader title="Nova nota" />
            <div className="p-4">
              <ActionForm action={createNote} submitLabel="Guardar nota" resetOnSuccess>
                <input type="hidden" name="clientId" value={client.id} />
                <label className="block">
                  <span className="sr-only">Texto da nota</span>
                  <textarea name="body" required maxLength={5000} rows={6} className={`${inputClass} h-auto py-1.5`} placeholder="Ex.: Cliente pediu para separar no relatório as vendas da coleção de linho." />
                </label>
                <label className="flex items-center gap-2 text-xs text-fg-2">
                  <input type="checkbox" name="pinned" className="size-3.5 accent-[var(--accent)]" /> Fixar na visão geral
                </label>
              </ActionForm>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
