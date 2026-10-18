import type { Report } from "@prisma/client";
import { slugify } from "@/lib/utils";
import type { ReportData } from "./build";
import { toCsv } from "./csv";
import { renderReportPdf } from "./pdf";
import { reportTables } from "./tables";
import { toXlsx } from "./xlsx";
import { formatRange } from "@/lib/format";

export type ExportFormat = "pdf" | "csv" | "xlsx";

const TYPES: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Gera o ficheiro de exportação a partir do retrato guardado no relatório. */
export async function exportReport(report: Report, format: ExportFormat, table?: string | null): Promise<Response> {
  const d = report.data as unknown as ReportData;
  const base = slugify(`${d.client.name}-${report.title}`).slice(0, 80) || "relatorio";
  let body: Buffer | string;
  let filename = `${base}.${format}`;
  if (format === "pdf") {
    body = await renderReportPdf(d, report.title);
  } else {
    const tables = reportTables(d);
    if (format === "xlsx") {
      body = await toXlsx(tables, { title: `${d.client.name} — ${report.title}`, subtitle: formatRange(d.period.start, d.period.end, d.fmt), simulated: d.origin === "SIMULATED" || d.origin === "MIXED" });
    } else {
      const t = table ? tables.find((x) => slugify(x.name) === table) : null;
      if (t) {
        body = toCsv(t.headers, t.rows);
        filename = `${base}-${slugify(t.name)}.csv`;
      } else {
        // Todas as tabelas num único ficheiro, separadas por uma linha com o nome da tabela.
        body = tables.map((x) => toCsv([`# ${x.name}`], []) + toCsv(x.headers, x.rows).replace(/^\uFEFF/, "")).join("\r\n");
      }
    }
  }
  return new Response(new Uint8Array(typeof body === "string" ? Buffer.from(body, "utf8") : body), {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
