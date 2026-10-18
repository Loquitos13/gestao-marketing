"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TabDef {
  seg: string;
  label: string;
  count?: number;
  dot?: "google" | "meta";
  alert?: boolean;
}

const FILTER_KEYS = ["period", "start", "end", "compare", "channel", "device", "country"];
const DOT = { google: "bg-google", meta: "bg-meta" };

export function ClientTabs({ clientId, primary, workspace, more }: { clientId: string; primary: TabDef[]; workspace: TabDef[]; more: TabDef[] }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const seg = pathname.split("/")[3] ?? "overview";
  const keep = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = sp.get(k);
    if (v) keep.set(k, v);
  }
  const qs = keep.toString() ? `?${keep}` : "";
  const moreActive = more.find((t) => t.seg === seg);

  const tab = (t: TabDef, withQs: boolean) => {
    const active = t.seg === seg;
    return (
      <Link
        key={t.seg}
        href={`/c/${clientId}/${t.seg}${withQs ? qs : ""}`}
        aria-current={active ? "page" : undefined}
        className={cn("flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 font-medium", active ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg")}
      >
        {t.dot && <span aria-hidden className={cn("size-[7px] rounded-full", DOT[t.dot])} />}
        {t.label}
        {t.count !== undefined && t.count > 0 && <span className={cn("tabular rounded-full px-1.5 text-[10.5px] leading-4", t.alert ? "bg-bad-soft text-bad" : "bg-hover text-fg-2")}>{t.count}</span>}
      </Link>
    );
  };

  return (
    <nav className="mt-3 flex items-center gap-0.5 overflow-x-auto px-5" aria-label="Secções do cliente">
      {primary.map((t) => tab(t, true))}
      <span aria-hidden className="mx-1.5 h-4 w-px shrink-0 bg-border-strong" />
      {workspace.map((t) => tab(t, false))}
      <details className="group relative">
        <summary className={cn("flex h-9 cursor-pointer list-none items-center gap-1 border-b-2 px-2.5 font-medium [&::-webkit-details-marker]:hidden", moreActive ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg")}>
          {moreActive ? moreActive.label : "Mais"}
          <ChevronDown className="size-3.5" />
        </summary>
        <div className="fixed z-30 mt-1 w-56 rounded-lg border bg-surface p-1 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
          {more.map((t) => (
            <Link
              key={t.seg}
              href={`/c/${clientId}/${t.seg}${qs}`}
              aria-current={t.seg === seg ? "page" : undefined}
              className={cn("flex h-8 items-center gap-2 rounded-md px-2 text-[13px] hover:bg-hover", t.seg === seg ? "font-medium text-fg" : "text-fg-2")}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && <span className={cn("tabular ml-auto text-[11px]", t.alert ? "font-medium text-bad" : "text-muted")}>{t.count}</span>}
            </Link>
          ))}
        </div>
      </details>
    </nav>
  );
}
