"use client";

import { useActionState } from "react";
import { shareReportAction } from "@/server/actions/reports";
import type { ActionState } from "@/server/actions/util";
import { buttonClass, inputClass } from "@/components/ui";

export function ShareForm({ clientId, reportId }: { clientId: string; reportId: string }) {
  const [state, run, pending] = useActionState<ActionState, FormData>(shareReportAction, {});
  const url = state.data?.url as string | undefined;
  return (
    <form action={run} className="space-y-2">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="reportId" value={reportId} />
      <div className="flex items-center gap-2">
        <select name="days" defaultValue="30" className={`${inputClass} w-32`} aria-label="Validade">
          <option value="7">7 dias</option>
          <option value="30">30 dias</option>
          <option value="90">90 dias</option>
        </select>
        <button disabled={pending} className={buttonClass("secondary")}>
          Criar link
        </button>
      </div>
      {state.error && <p className="text-xs text-bad">{state.error}</p>}
      {url && (
        <div className="space-y-1">
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className={inputClass} />
          <p className="text-[11px] text-muted">{state.message}</p>
        </div>
      )}
    </form>
  );
}
