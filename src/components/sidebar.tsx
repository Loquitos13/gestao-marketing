"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, Home, ListTodo, LogOut, Menu, Moon, PlugZap, Plus, Settings, Sun, Users, X } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { Initials } from "./ui";

export interface SidebarClient {
  id: string;
  name: string;
  isDemo: boolean;
}

export interface SidebarStats {
  clients: number;
  openAlerts: number;
  sync: { label: string; tone: "on" | "off" | "err" };
}

export function Sidebar({
  orgName,
  clients,
  stats,
  user,
  canCreateClient,
  showJobs,
  logoutAction,
}: {
  orgName: string;
  clients: SidebarClient[];
  stats: SidebarStats;
  user: { name: string; email: string; role: string };
  canCreateClient: boolean;
  showJobs: boolean;
  logoutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const activeClient = pathname.match(/^\/c\/([^/]+)/)?.[1] ?? null;
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const nav = [
    { href: "/", label: "Início", icon: Home, active: pathname === "/" },
    { href: "/clients", label: "Clientes", icon: Users, active: pathname.startsWith("/clients"), count: stats.clients },
    { href: "/alerts", label: "Alertas", icon: AlertTriangle, active: pathname.startsWith("/alerts"), count: stats.openAlerts, alert: stats.openAlerts > 0 },
    ...(showJobs ? [{ href: "/jobs", label: "Tarefas", icon: ListTodo, active: pathname.startsWith("/jobs") }] : []),
    { href: "/integrations", label: "Integrações", icon: PlugZap, active: pathname.startsWith("/integrations") },
    { href: "/settings", label: "Definições", icon: Settings, active: pathname.startsWith("/settings") },
  ];

  const link = "flex h-[30px] items-center gap-2.5 rounded-md border border-transparent px-2 font-[450] text-fg-2 hover:bg-hover hover:text-fg";
  const on = "border-border bg-surface text-fg";

  return (
    <>
      <div className="no-print fixed inset-x-0 top-0 z-40 flex h-11 items-center gap-2 border-b bg-bg px-3 md:hidden">
        <button type="button" onClick={() => setOpen(!open)} className="grid size-8 place-items-center rounded-md hover:bg-hover" aria-label={open ? "Fechar menu" : "Abrir menu"} aria-expanded={open}>
          {open ? <X className="size-4" /> : <Menu className="size-4" />}
        </button>
        <span className="truncate text-[13px] font-semibold">{orgName}</span>
      </div>
      {open && <button type="button" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/30 md:hidden" aria-label="Fechar menu" />}
      <aside className={cn("no-print fixed inset-y-0 left-0 z-50 flex h-screen w-[236px] shrink-0 flex-col border-r bg-bg px-2 py-2.5 md:sticky md:top-0 md:flex", !open && "max-md:hidden")}>
        <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
          <span className="grid size-[22px] place-items-center rounded-[5px] bg-inverse text-[11px] font-semibold text-inverse-fg">M</span>
          <span className="truncate text-[13px] font-semibold" title={orgName}>
            {orgName}
          </span>
          <button type="button" onClick={() => setOpen(false)} className="ml-auto grid size-7 place-items-center rounded-md hover:bg-hover md:hidden" aria-label="Fechar menu">
            <X className="size-4" />
          </button>
        </div>

        <nav className="mt-3 flex flex-col gap-px" aria-label="Navegação principal">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={cn(link, n.active && on)} aria-current={n.active ? "page" : undefined}>
              <n.icon className="size-[15px] shrink-0" />
              <span className="truncate">{n.label}</span>
              {n.count !== undefined && n.count > 0 && <span className={cn("tabular ml-auto text-[11px]", n.alert ? "font-medium text-bad" : "text-muted")}>{n.count}</span>}
            </Link>
          ))}
        </nav>

        <h6 className="mx-2 mb-1.5 mt-5 text-[11px] font-medium text-muted">Workspaces de clientes</h6>
        <nav className="-mx-1 flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1" aria-label="Clientes">
          {clients.map((c) => {
            const active = c.id === activeClient;
            return (
              <Link key={c.id} href={`/c/${c.id}/overview`} className={cn(link, active && on)} aria-current={active ? "page" : undefined}>
                <Initials name={c.name} size="xs" inverse={active} />
                <span className="truncate">{c.name}</span>
                {c.isDemo && !/demo/i.test(c.name) && <span className="ml-auto text-[10.5px] text-faint">demo</span>}
              </Link>
            );
          })}
          {canCreateClient && (
            <Link href="/clients/new" className={cn(link, "text-muted")}>
              <Plus className="size-[15px]" />
              Novo cliente
            </Link>
          )}
        </nav>

        <div className="mt-2 flex flex-col gap-1.5 border-t px-2 pt-2.5 text-xs text-muted">
          <div className="flex items-center gap-2">
            <span className={cn("size-1.5 rounded-full", stats.sync.tone === "on" ? "bg-good" : stats.sync.tone === "err" ? "bg-bad" : "bg-faint")} />
            <span className="truncate">{stats.sync.label}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-hover text-[10px] font-semibold text-fg-2">
              {user.name
                .split(/\s+/)
                .slice(0, 2)
                .map((w) => w[0])
                .join("")
                .toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-fg-2" title={user.email}>
                {user.name}
              </div>
              <div className="truncate text-[11px]">{user.role}</div>
            </div>
            <button type="button" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} className="grid size-6 place-items-center rounded hover:bg-hover hover:text-fg" aria-label="Alternar tema" title="Alternar tema">
              <Sun className="hidden size-3.5 dark:block" />
              <Moon className="size-3.5 dark:hidden" />
            </button>
            <form action={logoutAction}>
              <button className="grid size-6 place-items-center rounded hover:bg-hover hover:text-fg" aria-label="Terminar sessão" title="Terminar sessão">
                <LogOut className="size-3.5" />
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}
