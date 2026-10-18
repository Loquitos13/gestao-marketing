"use client";

import { useActionState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import type { ActionState } from "@/server/actions/util";
import { buttonClass } from "./ui";
import { cn } from "@/lib/utils";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function ActionForm({
  action,
  children,
  submitLabel,
  confirm,
  variant = "primary",
  className,
  resetOnSuccess = false,
  inline = false,
  size = "md",
}: {
  action: Action;
  children?: React.ReactNode;
  submitLabel: string;
  confirm?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  className?: string;
  resetOnSuccess?: boolean;
  inline?: boolean;
  size?: "sm" | "md";
}) {
  const [state, run, pending] = useActionState<ActionState, FormData>(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={run}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={cn(inline ? "inline-flex items-center gap-2" : "space-y-3", className)}
    >
      {children}
      <div className={cn("flex items-center gap-2", inline && "contents")}>
        <button type="submit" disabled={pending} className={buttonClass(variant, size)}>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          {submitLabel}
        </button>
        {state.error && (
          <span role="alert" className="text-xs text-bad">
            {state.error}
          </span>
        )}
        {state.ok && state.message && <span className="text-xs text-good">{state.message}</span>}
      </div>
    </form>
  );
}
