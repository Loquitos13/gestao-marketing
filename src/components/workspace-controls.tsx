"use client";

import { useActionState, useRef } from "react";
import { Check, Loader2, Pin, PinOff, Trash2 } from "lucide-react";
import type { ActionState } from "@/server/actions/util";
import { cn } from "@/lib/utils";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function TaskToggle({ action, clientId, taskId, done, disabled, label }: { action: Action; clientId: string; taskId: string; done: boolean; disabled?: boolean; label: string }) {
  const [state, run, pending] = useActionState<ActionState, FormData>(action, {});
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={run} className="contents">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="done" value={done ? "false" : "true"} />
      <button
        type="submit"
        disabled={disabled || pending}
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Reabrir: ${label}` : `Concluir: ${label}`}
        title={state.error}
        className={cn("mt-px grid size-[15px] shrink-0 place-items-center rounded border-[1.5px] disabled:cursor-default", done ? "border-inverse bg-inverse text-inverse-fg" : "border-border-strong hover:border-fg-2", state.error && "border-bad")}
      >
        {pending ? <Loader2 className="size-2.5 animate-spin" /> : done ? <Check className="size-2.5" strokeWidth={3} /> : null}
      </button>
    </form>
  );
}

export function IconAction({ action, fields, label, icon, confirm }: { action: Action; fields: Record<string, string>; label: string; icon: "trash" | "pin" | "unpin"; confirm?: string }) {
  const [state, run, pending] = useActionState<ActionState, FormData>(action, {});
  const Icon = icon === "trash" ? Trash2 : icon === "pin" ? Pin : PinOff;
  return (
    <form
      action={run}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="contents"
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button type="submit" disabled={pending} aria-label={label} title={state.error ?? label} className={cn("grid size-6 place-items-center rounded text-muted hover:bg-hover hover:text-fg", state.error && "text-bad")}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
      </button>
    </form>
  );
}
