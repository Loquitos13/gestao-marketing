import ExcelJS from "exceljs";
import type { Table } from "./csv";

export async function toXlsx(tables: Table[], meta: { title: string; subtitle: string; simulated: boolean }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Marketing Intelligence Hub";
  wb.created = new Date();
  const info = wb.addWorksheet("Info");
  info.addRow([meta.title]).font = { bold: true, size: 14 };
  info.addRow([meta.subtitle]);
  info.addRow([`Gerado em ${new Date().toISOString()}`]);
  if (meta.simulated) info.addRow(["ATENÇÃO: contém DADOS SIMULADOS (modo de demonstração)."]).font = { bold: true, color: { argb: "FFB45309" } };
  info.getColumn(1).width = 90;
  for (const t of tables) {
    const ws = wb.addWorksheet(t.name.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
    const header = ws.addRow(t.headers);
    header.font = { bold: true };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2FF" } };
    // ExcelJS escreve strings como texto (nunca fórmulas): sem sanitizeCell, que acrescentaria um apóstrofo visível.
    for (const r of t.rows) ws.addRow(r.map((c) => c ?? null));
    ws.columns.forEach((col, i) => {
      col.width = Math.min(60, Math.max(12, t.headers[i]?.length ?? 12));
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
