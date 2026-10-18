"use client";

import { describeFailure } from "@/lib/failure";
import { buttonClass } from "@/components/ui";

export function FailureScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const d = describeFailure(error.message ?? "");
  return (
    <main className="grid min-h-[70vh] place-items-center px-6">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-lg font-semibold">{d.title}</h1>
        <p className="text-sm text-muted">{d.detail}</p>
        <button type="button" onClick={() => reset()} className={buttonClass("primary")}>
          Tentar outra vez
        </button>
      </div>
    </main>
  );
}
