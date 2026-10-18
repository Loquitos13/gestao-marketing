import { cn } from "@/lib/utils";

/** Tabela estática (sem ordenação) com o mesmo estilo da DataTable. */
export function Tbl({ head, children, foot, className }: { head: { label: React.ReactNode; num?: boolean; className?: string }[]; children: React.ReactNode; foot?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className={cn("whitespace-nowrap border-b bg-surface-2 px-3 py-2 text-[11.5px] font-medium text-muted first:pl-4 last:pr-4", h.num ? "text-right" : "text-left", h.className)}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:hover>td]:bg-surface-2 [&>tr:last-child>td]:border-b-0">{children}</tbody>
        {foot && <tfoot className="[&_td]:border-t [&_td]:border-border-strong [&_td]:bg-surface-2 [&_td]:font-semibold">{foot}</tfoot>}
      </table>
    </div>
  );
}

export function Td({ children, num, className, colSpan }: { children?: React.ReactNode; num?: boolean; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn("whitespace-nowrap border-b px-3 py-2 first:pl-4 last:pr-4", num && "tabular text-right", className)}>
      {children}
    </td>
  );
}

export function ShareBar({ value, className }: { value: number | null; className?: string }) {
  return (
    <span className={cn("inline-block h-1 w-14 overflow-hidden rounded-full bg-hover align-middle", className)}>
      <i className="block h-full bg-fg-2" style={{ width: `${Math.max(0, Math.min(1, value ?? 0)) * 100}%` }} />
    </span>
  );
}
