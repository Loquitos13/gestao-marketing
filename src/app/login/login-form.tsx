"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next ?? ""} />
      <label className="block">
        <span className="mb-1 block text-xs text-muted">Email</span>
        <input name="email" type="email" required autoComplete="email" className="w-full rounded-md border px-3 py-2 outline-none focus:ring-2 focus:ring-accent/40" />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-muted">Password</span>
        <input name="password" type="password" required autoComplete="current-password" className="w-full rounded-md border px-3 py-2 outline-none focus:ring-2 focus:ring-accent/40" />
      </label>
      {state.error && (
        <p role="alert" className="text-xs text-bad">
          {state.error}
        </p>
      )}
      <button disabled={pending} className="w-full rounded-md bg-accent px-3 py-2 font-medium text-accent-fg disabled:opacity-60">
        {pending ? "A entrar…" : "Entrar"}
      </button>
    </form>
  );
}
