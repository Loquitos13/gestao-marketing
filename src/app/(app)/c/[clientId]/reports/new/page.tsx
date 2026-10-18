import { prisma } from "@/lib/prisma";
import { addDays, addMonths, endOfMonth, startOfMonth, todayInTz } from "@/lib/dates";
import { REPORT_KINDS, REPORT_SECTIONS } from "@/server/reports/sections";
import { createReportAction } from "@/server/actions/reports";
import { ActionForm } from "@/components/action-form";
import { Card, Field, inputClass, PageHeader } from "@/components/ui";
import { clientContext } from "../../page-context";

export const metadata = { title: "Novo relatório" };

export default async function NewReportPage(props: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await props.params;
  const { client, tenant } = await clientContext(clientId, "report:write");
  const templates = await prisma.reportTemplate.findMany({ where: { organizationId: tenant.organizationId }, orderBy: { name: "asc" } });
  const today = todayInTz(client.timezone);
  const lastMonth = addMonths(startOfMonth(today), -1);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Novo relatório" description="Os dados são calculados no momento da geração e ficam guardados no relatório. Pode recalcular depois de adicionar comentários." />
      <Card className="p-5">
        <ActionForm action={createReportAction} submitLabel="Gerar relatório">
          <input type="hidden" name="clientId" value={client.id} />
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Título (opcional)">
              <input name="title" maxLength={160} className={inputClass} placeholder="Gerado automaticamente se vazio" />
            </Field>
            <Field label="Tipo">
              <select name="kind" className={inputClass} defaultValue="MONTHLY">
                {Object.entries(REPORT_KINDS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Início">
              <input name="start" type="date" required defaultValue={lastMonth} max={addDays(today, -1)} className={inputClass} />
            </Field>
            <Field label="Fim">
              <input name="end" type="date" required defaultValue={endOfMonth(lastMonth)} max={addDays(today, -1)} className={inputClass} />
            </Field>
            <Field label="Modelo" hint="Usado apenas se não selecionar secções abaixo">
              <select name="templateId" className={inputClass} defaultValue={templates.find((t) => t.isDefault)?.id ?? ""}>
                <option value="">—</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <fieldset className="rounded-lg border p-3">
            <legend className="px-1 text-[11px] font-medium text-muted">Secções (opcional)</legend>
            <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
              {REPORT_SECTIONS.map((s) => (
                <label key={s.key} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" name="sections[]" value={s.key} /> {s.label}
                </label>
              ))}
            </div>
          </fieldset>
        </ActionForm>
      </Card>
    </div>
  );
}
