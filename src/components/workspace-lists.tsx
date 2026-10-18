import { AlertTriangle, BarChart3, Check, Clock, FileText, Link2, Lightbulb, MessageSquare, PiggyBank, Plug, RefreshCw, Settings, XCircle } from "lucide-react";
import { formatRelative, type FormatContext } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ActivityItem, ActivityKind } from "@/server/queries/workspace";
import { deleteNote, deleteTask, pinNote, toggleTask } from "@/server/actions/workspace";
import { IconAction, TaskToggle } from "./workspace-controls";
import { Badge } from "./ui";

export interface TaskView {
  id: string;
  title: string;
  description: string | null;
  area: string | null;
  status: "OPEN" | "DONE";
  priority: number;
  dueDate: Date | null;
  assignee: { name: string } | null;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export function dueLabel(due: Date | null, today: string, fmt: FormatContext) {
  if (!due) return null;
  const k = dayKey(due);
  if (k === today) return { text: "Hoje", late: false };
  const text = new Intl.DateTimeFormat(fmt.locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(due).replace(".", "");
  return { text, late: k < today };
}

export function TaskList({ tasks, clientId, canWrite, today, fmt, showActions = false, empty = "Sem tarefas." }: { tasks: TaskView[]; clientId: string; canWrite: boolean; today: string; fmt: FormatContext; showActions?: boolean; empty?: string }) {
  if (!tasks.length) return <p className="px-4 py-6 text-center text-xs text-muted">{empty}</p>;
  return (
    <ul>
      {tasks.map((t) => {
        const done = t.status === "DONE";
        const due = dueLabel(t.dueDate, today, fmt);
        const sub = [t.area, t.assignee?.name].filter(Boolean).join(" · ");
        return (
          <li key={t.id} className="group flex items-start gap-2.5 border-b px-4 py-2.5 last:border-b-0">
            <TaskToggle action={toggleTask} clientId={clientId} taskId={t.id} done={done} disabled={!canWrite} label={t.title} />
            <div className="min-w-0 flex-1">
              <div className={cn("font-medium", done && "text-muted line-through")}>{t.title}</div>
              {(sub || (showActions && t.description)) && <div className="mt-px text-xs text-muted">{showActions && t.description ? t.description : sub}</div>}
              {showActions && t.description && sub && <div className="mt-px text-xs text-muted">{sub}</div>}
            </div>
            {t.priority === 1 && !done && <Badge variant="bad">Alta</Badge>}
            {due && <span className={cn("tabular whitespace-nowrap text-[11.5px]", due.late && !done ? "text-bad" : "text-muted")}>{due.text}</span>}
            {showActions && canWrite && (
              <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <IconAction action={deleteTask} fields={{ clientId, taskId: t.id }} label="Eliminar tarefa" icon="trash" confirm="Eliminar esta tarefa?" />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export interface NoteView {
  id: string;
  body: string;
  pinned: boolean;
  createdAt: Date;
  author: { name: string } | null;
}

export function NoteList({ notes, clientId, canWrite, fmt, showActions = false, clamp = false }: { notes: NoteView[]; clientId: string; canWrite: boolean; fmt: FormatContext; showActions?: boolean; clamp?: boolean }) {
  if (!notes.length) return <p className="px-4 py-6 text-center text-xs text-muted">Sem notas.</p>;
  return (
    <ul>
      {notes.map((n) => (
        <li key={n.id} className="group border-b px-4 py-3 last:border-b-0">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            {n.pinned && <Badge variant="accent">Fixada</Badge>}
            <span>{n.author?.name ?? "—"}</span>
            <span aria-hidden>·</span>
            <time dateTime={n.createdAt.toISOString()}>{formatRelative(n.createdAt, fmt)}</time>
            {showActions && canWrite && (
              <span className="ml-auto flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <IconAction action={pinNote} fields={{ clientId, noteId: n.id, pinned: n.pinned ? "false" : "true" }} label={n.pinned ? "Desafixar" : "Fixar"} icon={n.pinned ? "unpin" : "pin"} />
                <IconAction action={deleteNote} fields={{ clientId, noteId: n.id }} label="Eliminar nota" icon="trash" confirm="Eliminar esta nota?" />
              </span>
            )}
          </div>
          <p className={cn("mt-1 whitespace-pre-line text-fg-2", clamp && "line-clamp-3")}>{n.body}</p>
        </li>
      ))}
    </ul>
  );
}

const ACTIVITY_ICON: Record<ActivityKind, React.ComponentType<{ className?: string }>> = {
  sync: RefreshCw,
  sync_error: XCircle,
  alert: AlertTriangle,
  report: FileText,
  recommendation: Lightbulb,
  task: Check,
  note: MessageSquare,
  file: Link2,
  budget: PiggyBank,
  source: Plug,
  client: Settings,
  other: Clock,
};

export function ActivityList({ items, fmt, empty = "Sem atividade registada." }: { items: ActivityItem[]; fmt: FormatContext; empty?: string }) {
  if (!items.length) return <p className="px-4 py-6 text-center text-xs text-muted">{empty}</p>;
  return (
    <ul>
      {items.map((a) => {
        const Icon = ACTIVITY_ICON[a.kind] ?? BarChart3;
        return (
          <li key={a.id} className="flex items-start gap-2.5 border-b px-4 py-2.5 last:border-b-0">
            <span className={cn("grid size-[22px] shrink-0 place-items-center rounded-full border bg-surface", a.kind === "sync_error" || a.kind === "alert" ? "text-bad" : "text-muted")}>
              <Icon className="size-3" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{a.title}</div>
              <div className="mt-px truncate text-xs text-muted">{[a.detail, a.actor, formatRelative(a.at, fmt)].filter(Boolean).join(" · ")}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
