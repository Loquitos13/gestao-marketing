"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Download, Search } from "lucide-react";
import { formatDelta, formatValue, type FormatContext, type Unit } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Dot } from "@/components/ui";

const STATUS: Record<string, [string, "on" | "off" | "warn" | "err"]> = {
  ENABLED: ["Ativa", "on"],
  ACTIVE: ["Ativa", "on"],
  PAUSED: ["Pausada", "off"],
  REMOVED: ["Removida", "off"],
  DELETED: ["Eliminada", "off"],
  ARCHIVED: ["Arquivada", "off"],
  IN_PROCESS: ["Em processamento", "warn"],
  WITH_ISSUES: ["Com problemas", "err"],
  DISAPPROVED: ["Reprovada", "err"],
};

const isTextual = (c: Col) => !c.kind || c.kind === "text" || c.kind === "badge" || c.kind === "status" || c.kind === "platform";

export interface Col {
  key: string;
  label: string;
  unit?: Unit;
  kind?: "text" | "metric" | "delta" | "badge" | "status" | "platform";
  /** Para colunas delta: se subir é positivo. */
  higherIsBetter?: boolean;
  /** Chave da linha com o URL para tornar a célula um link. */
  hrefKey?: string;
  /** Chave secundária mostrada por baixo do texto. */
  subKey?: string;
  /** Chave com o tom do ponto colorido antes do texto (google | meta | seo). */
  dotKey?: string;
  hint?: string;
  width?: number;
}

export type Row = Record<string, string | number | null | undefined | boolean>;

function sanitizeCsv(v: string) {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

const DOT: Record<string, string> = { GOOGLE_ADS: "bg-google", META_ADS: "bg-meta", google: "bg-google", meta: "bg-meta", seo: "bg-seo" };

export function DataTable({
  columns,
  rows,
  fmt,
  pageSize = 15,
  searchable = true,
  exportName,
  empty = "Sem dados para os filtros selecionados.",
  initialSort,
  totals,
  stickyFirst = true,
}: {
  columns: Col[];
  rows: Row[];
  fmt: FormatContext;
  pageSize?: number;
  searchable?: boolean;
  exportName?: string;
  empty?: string;
  initialSort?: { key: string; desc?: boolean };
  /** Linha de total (valores já calculados a partir dos totais, nunca média de médias). */
  totals?: Row;
  stickyFirst?: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSort ? [{ id: initialSort.key, desc: initialSort.desc ?? true }] : []);
  const [filter, setFilter] = useState("");

  const renderCell = useMemo(
    () => (c: Col, row: Row) => {
      const v = row[c.key];
      if (c.kind === "metric") return v === null || v === undefined ? <span className="text-faint">—</span> : <span className="tabular">{formatValue(v as number, c.unit ?? "number", fmt, { compact: true })}</span>;
      if (c.kind === "delta") {
        const n = v as number | null;
        const good = n === null || Math.abs(n ?? 0) < 0.0005 || c.higherIsBetter === undefined ? null : n > 0 === c.higherIsBetter;
        return <span className={cn("tabular font-medium", good === null ? "text-muted" : good ? "text-good" : "text-bad")}>{formatDelta(n, fmt)}</span>;
      }
      if (c.kind === "badge") return v ? <span className="inline-flex h-5 items-center rounded bg-hover px-1.5 text-[11px] font-medium text-fg-2">{String(v)}</span> : null;
      if (c.kind === "status") {
        if (!v) return <span className="text-muted">—</span>;
        const s = STATUS[String(v)];
        return (
          <span className="inline-flex items-center gap-1.5 text-fg-2">
            <Dot tone={s?.[1] ?? "off"} />
            {s?.[0] ?? String(v)}
          </span>
        );
      }
      if (c.kind === "platform") {
        if (!v) return <span className="text-muted">—</span>;
        const label = String(v);
        return (
          <span className="inline-flex items-center gap-1.5 text-fg-2">
            <Dot tone={/^Google Ads/.test(label) ? "google" : /^Meta/.test(label) ? "meta" : "seo"} />
            {label}
          </span>
        );
      }
      const text = v === null || v === undefined ? "—" : String(v);
      const href = c.hrefKey ? (row[c.hrefKey] as string | undefined) : undefined;
      const sub = c.subKey ? row[c.subKey] : null;
      const dot = c.dotKey ? DOT[String(row[c.dotKey] ?? "")] : undefined;
      return (
        <div className="flex min-w-0 items-center gap-2">
          {dot && <span aria-hidden className={cn("size-[7px] shrink-0 rounded-full", dot)} />}
          <div className="min-w-0">
            {href ? (
              <Link href={href} className="font-medium hover:underline">
                {text}
              </Link>
            ) : (
              <span className="font-medium">{text}</span>
            )}
            {sub ? <div className="truncate text-[11.5px] text-muted">{String(sub)}</div> : null}
          </div>
        </div>
      );
    },
    [fmt],
  );

  const defs = useMemo<ColumnDef<Row>[]>(
    () =>
      columns.map((c) => ({
        id: c.key,
        accessorFn: (r) => r[c.key] ?? null,
        header: c.label,
        sortingFn: isTextual(c) ? "alphanumeric" : "basic",
        sortUndefined: "last",
        cell: ({ row }) => renderCell(c, row.original),
      })),
    [columns, renderCell],
  );

  const table = useReactTable({
    data: rows,
    columns: defs,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    globalFilterFn: (row, _id, value) => {
      const q = String(value).toLowerCase();
      return columns.some((c) => isTextual(c) && String(row.original[c.key] ?? "").toLowerCase().includes(q));
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const exportCsv = () => {
    const data = table.getSortedRowModel().rows.map((r) => r.original);
    const lines = [columns.map((c) => c.label), ...data.map((r) => columns.map((c) => (r[c.key] === null || r[c.key] === undefined ? "" : String(r[c.key]))))];
    const csv = "\uFEFF" + lines.map((l) => l.map((v) => `"${sanitizeCsv(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName ?? "dados"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const numeric = (c: Col) => c.kind === "metric" || c.kind === "delta";
  const sticky = (i: number, head = false) => stickyFirst && i === 0 && cn("sticky left-0 z-[1] shadow-[inset_-1px_0_0_var(--border)]", head ? "bg-surface-2" : "bg-surface group-hover:bg-surface-2");
  const pageCount = table.getPageCount();
  const showToolbar = (searchable && rows.length > 8) || exportName;
  return (
    <div>
      {showToolbar && (
        <div className="no-print flex items-center justify-between gap-2 border-b px-4 py-2">
          {searchable && rows.length > 8 ? (
            <label className="flex h-[26px] w-60 items-center gap-1.5 rounded-md border border-border-strong px-2 text-muted focus-within:border-accent">
              <Search className="size-3.5" />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar…" className="h-full w-full bg-transparent text-xs text-fg outline-none placeholder:text-faint" aria-label="Pesquisar na tabela" />
            </label>
          ) : (
            <span />
          )}
          {exportName && (
            <button type="button" onClick={exportCsv} className="inline-flex h-[26px] items-center gap-1 rounded-md px-2 text-xs font-medium text-fg-2 hover:bg-hover">
              <Download className="size-3.5" /> CSV
            </button>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h, i) => {
                  const col = columns[i];
                  const s = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      title={col.hint}
                      style={col.width ? { width: col.width } : undefined}
                      className={cn("whitespace-nowrap border-b bg-surface-2 px-3 py-2 text-[11.5px] font-medium text-muted first:pl-4 last:pr-4", numeric(col) ? "text-right" : "text-left", sticky(i, true))}
                    >
                      <button type="button" onClick={h.column.getToggleSortingHandler()} className={cn("inline-flex items-center gap-1 hover:text-fg", numeric(col) && "flex-row-reverse", s && "text-fg")}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {s === "asc" ? <ArrowUp className="size-3" /> : s === "desc" ? <ArrowDown className="size-3" /> : null}
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => (
              <tr key={r.id} className="group">
                {r.getVisibleCells().map((cell, i) => (
                  <td key={cell.id} className={cn("border-b px-3 py-2 align-middle first:pl-4 last:pr-4 group-hover:bg-surface-2", numeric(columns[i]) ? "whitespace-nowrap text-right" : "max-w-[360px]", sticky(i))}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {!table.getRowModel().rows.length && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-muted">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
          {totals && rows.length > 0 && (
            <tfoot>
              <tr>
                {columns.map((c, i) => (
                  <td key={c.key} className={cn("border-t border-border-strong bg-surface-2 px-3 py-2 font-semibold first:pl-4 last:pr-4", numeric(c) ? "whitespace-nowrap text-right" : "", stickyFirst && i === 0 && "sticky left-0 z-[1] bg-surface-2 shadow-[inset_-1px_0_0_var(--border)]")}>
                    {i === 0 ? String(totals[c.key] ?? "Total") : totals[c.key] === undefined ? null : renderCell({ ...c, subKey: undefined, dotKey: undefined, hrefKey: undefined }, totals)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {pageCount > 1 && (
        <div className="no-print flex items-center justify-between border-t px-4 py-2 text-xs text-muted">
          <span className="tabular">
            {table.getFilteredRowModel().rows.length} linhas · página {table.getState().pagination.pageIndex + 1} de {pageCount}
          </span>
          <div className="flex gap-1">
            <button type="button" className="h-[26px] rounded-md border border-border-strong bg-surface px-2 font-medium text-fg-2 hover:bg-surface-2 disabled:opacity-40" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              Anterior
            </button>
            <button type="button" className="h-[26px] rounded-md border border-border-strong bg-surface px-2 font-medium text-fg-2 hover:bg-surface-2 disabled:opacity-40" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              Seguinte
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
