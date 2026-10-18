"use client";

import { useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { buttonClass } from "@/components/ui";

interface SectionEvent {
  type: "section";
  key: string;
  label: string;
  text: string;
}
interface DoneEvent {
  type: "done";
  comments: Record<string, string>;
  unverified?: string[];
}
interface ErrorEvent {
  type: "error";
  message: string;
}

function apply(form: HTMLFormElement, key: string, text: string) {
  const t = form.querySelector<HTMLTextAreaElement>(`textarea[name="comment_${key}"]`);
  if (t) t.value = text;
  return Boolean(t);
}

/** Preenche os campos de comentário com um rascunho do agente local, à medida que o texto sai. Nada é guardado até clicar em "Guardar". */
export function AiWriter({ reportId }: { reportId: string }) {
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<{ label: string; text: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  async function run() {
    const form = ref.current?.closest("form");
    if (!form) return;
    const filled = [...form.querySelectorAll<HTMLTextAreaElement>("textarea[name^=comment_]")].some((t) => t.value.trim());
    if (filled && !window.confirm("Substituir os comentários já escritos pelo rascunho do agente?")) return;
    setBusy(true);
    setMsg(null);
    setLive(null);
    try {
      const res = await fetch("/api/agent/report-draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reportId }) });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.includes("ndjson") || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Erro ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let n = 0;
      let unverified: string[] = [];
      let failed: string | null = null;
      const take = (line: string) => {
        if (!line.trim()) return;
        const ev = JSON.parse(line) as SectionEvent | DoneEvent | ErrorEvent;
        if (ev.type === "section") {
          apply(form, ev.key, ev.text);
          setLive({ label: ev.label, text: ev.text });
        } else if (ev.type === "done") {
          n = 0;
          for (const [k, v] of Object.entries(ev.comments)) if (apply(form, k, v)) n++;
          unverified = ev.unverified ?? [];
        } else failed = ev.message;
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          take(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
      }
      take(buf);
      if (failed) throw new Error(failed);
      const unv = unverified.length ? ` Confirme estes números, não encontrados nos dados: ${unverified.join(", ")}.` : "";
      setMsg({ ok: true, text: n ? `Rascunho preenchido em ${n} secções. Reveja e clique em “Guardar e recalcular”.${unv}` : "O agente não devolveu texto utilizável." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className="mb-3 space-y-1.5">
      <button type="button" onClick={run} disabled={busy} className={buttonClass("secondary", "sm")}>
        {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy ? "A escrever…" : "Escrever com IA"}
      </button>
      {live && (
        <div className="max-h-40 overflow-auto rounded-md border bg-hover px-3 py-2 text-[12px] leading-relaxed">
          <p className="mb-1 font-medium text-fg">{busy ? `A escrever: ${live.label}` : live.label}</p>
          <p className="whitespace-pre-wrap text-fg-2">{live.text}</p>
        </div>
      )}
      {msg && <p className={msg.ok ? "text-[11.5px] text-fg-2" : "text-[11.5px] text-bad"}>{msg.text}</p>}
    </div>
  );
}
