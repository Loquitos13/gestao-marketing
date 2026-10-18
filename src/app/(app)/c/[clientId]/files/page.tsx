import { ExternalLink, FileText } from "lucide-react";
import { formatTimestamp } from "@/lib/format";
import { can } from "@/server/auth/rbac";
import { addFileLink, deleteFile, uploadFile } from "@/server/actions/workspace";
import { loadFiles } from "@/server/queries/workspace";
import { ActionForm } from "@/components/action-form";
import { IconAction } from "@/components/workspace-controls";
import { Card, CardHeader, EmptyState, Field, inputClass, PageHeader } from "@/components/ui";
import { clientContext } from "../page-context";

export const metadata = { title: "Ficheiros" };

function size(n: number | null) {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export default async function FilesPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const { client, ctx, tenant } = await clientContext(clientId);
  const canWrite = can(tenant.role, "workspace:write");
  const files = await loadFiles(client.id);

  return (
    <div>
      <PageHeader title="Ficheiros" description="Briefings, criativos aprovados, contratos e ligações partilhadas. Acesso restrito a quem tem acesso ao cliente." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="self-start">
          {files.length ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11.5px] text-muted">
                    {["Nome", "Tamanho", "Adicionado por", "Data", ""].map((h, i) => (
                      <th key={i} className={`border-b bg-surface-2 px-3 py-2 font-medium first:pl-4 last:pr-4 ${i === 1 ? "text-right" : ""}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr key={f.id} className="group hover:bg-surface-2">
                      <td className="border-b py-2 pl-4 pr-3">
                        <a href={f.url && !f.mimeType ? f.url : `/api/files/${f.id}`} target={f.url ? "_blank" : undefined} rel="noopener noreferrer" className="flex items-center gap-2 font-medium hover:underline">
                          {f.url ? <ExternalLink className="size-3.5 text-muted" /> : <FileText className="size-3.5 text-muted" />}
                          {f.name}
                        </a>
                        {f.description && <div className="ml-[22px] text-[11.5px] text-muted">{f.description}</div>}
                      </td>
                      <td className="tabular border-b px-3 py-2 text-right text-fg-2">{f.url ? "Ligação" : size(f.size)}</td>
                      <td className="border-b px-3 py-2 text-fg-2">{f.uploadedBy?.name ?? "—"}</td>
                      <td className="tabular border-b px-3 py-2 text-fg-2">{formatTimestamp(f.createdAt, ctx.fmt)}</td>
                      <td className="w-8 border-b py-2 pl-2 pr-4 text-right">
                        {canWrite && <IconAction action={deleteFile} fields={{ clientId: client.id, fileId: f.id }} label={`Remover ${f.name}`} icon="trash" confirm={`Remover "${f.name}"?`} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Ainda não há ficheiros" description="Carregue documentos (até 10 MB) ou adicione ligações para pastas partilhadas." />
          )}
        </Card>
        {canWrite && (
          <div className="space-y-4">
            <Card>
              <CardHeader title="Carregar ficheiro" description="até 10 MB" />
              <div className="p-4">
                <ActionForm action={uploadFile} submitLabel="Carregar" resetOnSuccess>
                  <input type="hidden" name="clientId" value={client.id} />
                  <Field label="Ficheiro" hint="PDF, imagens, CSV, Excel, Word, PowerPoint, TXT ou ZIP.">
                    <input type="file" name="file" required accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.csv,.txt,.xlsx,.docx,.pptx,.zip" className="block w-full text-xs file:mr-3 file:h-[26px] file:rounded-md file:border file:border-border-strong file:bg-surface file:px-2 file:text-xs file:font-medium" />
                  </Field>
                  <Field label="Descrição">
                    <input name="description" maxLength={300} className={inputClass} />
                  </Field>
                </ActionForm>
              </div>
            </Card>
            <Card>
              <CardHeader title="Adicionar ligação" />
              <div className="p-4">
                <ActionForm action={addFileLink} submitLabel="Adicionar" variant="secondary" resetOnSuccess>
                  <input type="hidden" name="clientId" value={client.id} />
                  <Field label="Nome">
                    <input name="name" required maxLength={180} className={inputClass} placeholder="Pasta de criativos" />
                  </Field>
                  <Field label="URL">
                    <input name="url" type="url" required maxLength={2000} className={inputClass} placeholder="https://" />
                  </Field>
                </ActionForm>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
