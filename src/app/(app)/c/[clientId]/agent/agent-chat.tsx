"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, User } from "lucide-react";
import { buttonClass, inputClass } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: { label: string; ok: boolean }[];
  unverified: string[];
  proposals: { kind: "recommendation" | "change"; id: string }[];
}

const SUGGESTIONS = ["Como correram as campanhas nos últimos 30 dias?", "Onde estou a desperdiçar orçamento?", "Vou cumprir o orçamento deste mês?", "Que anúncios devia pausar ou renovar?"];

/** Negrito (**texto**) e destaque de números não verificados. */
function inline(text: string, unverified: string[], key: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    const bold = p.startsWith("**") && p.endsWith("**");
    const body = bold ? p.slice(2, -2) : p;
    const nodes = unverified.length
      ? body.split(new RegExp(`(${unverified.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g")).map((s, j) =>
          unverified.includes(s) ? (
            <mark key={j} title="Número não encontrado nos dados consultados" className="rounded bg-warn-soft px-0.5 text-warn">
              {s}
            </mark>
          ) : (
            <Fragment key={j}>{s}</Fragment>
          ),
        )
      : body;
    return bold ? <strong key={`${key}-${i}`}>{nodes}</strong> : <Fragment key={`${key}-${i}`}>{nodes}</Fragment>;
  });
}

function Rich({ text, unverified }: { text: string; unverified: string[] }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed">
      {lines.map((l, i) => {
        const t = l.trim();
        if (!t) return null;
        const h = /^#{1,4}\s+(.*)$/.exec(t);
        if (h) return <p key={i} className="pt-1 font-semibold">{inline(h[1]!, unverified, String(i))}</p>;
        const li = /^([-*•]|\d+[.)])\s+(.*)$/.exec(t);
        if (li) return <p key={i} className="flex gap-2 pl-1"><span className="text-muted">{/^\d/.test(li[1]!) ? li[1] : "•"}</span><span>{inline(li[2]!, unverified, String(i))}</span></p>;
        return <p key={i}>{inline(t, unverified, String(i))}</p>;
      })}
    </div>
  );
}

function Message({ m, clientId }: { m: ChatMessage; clientId: string }) {
  const mine = m.role === "user";
  return (
    <li className={cn("flex gap-3", mine && "flex-row-reverse")}>
      <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full", mine ? "bg-hover" : "bg-accent-soft text-accent")}>{mine ? <User className="size-3.5" /> : <Bot className="size-3.5" />}</span>
      <div className={cn("max-w-[85%] rounded-lg px-3.5 py-2.5", mine ? "bg-hover" : "border bg-surface")}>
        {mine ? <p className="whitespace-pre-wrap text-[13px]">{m.content}</p> : <Rich text={m.content} unverified={m.unverified} />}
        {!mine && m.sources.length > 0 && <p className="mt-2 text-[11px] text-muted">Consultou: {m.sources.map((s) => s.label + (s.ok || s.label.endsWith("(não criada)") ? "" : " (falhou)")).join(" · ")}</p>}
        {!mine && m.unverified.length > 0 && <p className="mt-1 text-[11px] text-warn">Não verificado nos dados: {m.unverified.join(", ")}</p>}
        {m.proposals.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {m.proposals.some((p) => p.kind === "change") && (
              <Link href={`/c/${clientId}/manage?view=propostas`} className={buttonClass("primary", "sm")}>
                Rever e confirmar {m.proposals.filter((p) => p.kind === "change").length} proposta(s)
              </Link>
            )}
            {m.proposals.some((p) => p.kind === "recommendation") && (
              <Link href={`/c/${clientId}/recommendations`} className={buttonClass("secondary", "sm")}>
                Ver {m.proposals.filter((p) => p.kind === "recommendation").length} recomendação(ões)
              </Link>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function AgentChat({ clientId, conversationId, initial, available }: { clientId: string; conversationId: string | null; initial: ChatMessage[]; available: boolean }) {
  const router = useRouter();
  const [messages, setMessages] = useState(initial);
  const [conv, setConv] = useState(conversationId);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLLIElement>(null);

  useEffect(() => {
    setMessages(initial);
    setConv(conversationId);
  }, [initial, conversationId]);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [messages, tools]);

  async function send(q: string) {
    const message = q.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setTools([]);
    setText("");
    const draft: ChatMessage = { id: "pending", role: "assistant", content: "", sources: [], unverified: [], proposals: [] };
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: "user", content: message, sources: [], unverified: [], proposals: [] }, draft]);
    const patch = (fn: (d: ChatMessage) => ChatMessage) => setMessages((m) => m.map((x) => (x.id === "pending" ? fn(x) : x)));
    let newConv = conv;
    try {
      const res = await fetch("/api/agent/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, conversationId: conv, message }) });
      if (!res.ok || !res.body) throw new Error(res.status === 403 ? "Sem permissão para usar o agente." : `Erro ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "conversation") newConv = ev.id;
          else if (ev.type === "tool") {
            setTools((t) => [...t, ev.label]);
            patch((d) => ({ ...d, sources: [...d.sources, { label: ev.label, ok: ev.ok }] }));
          } else if (ev.type === "token") patch((d) => ({ ...d, content: d.content + ev.t }));
          else if (ev.type === "done") patch((d) => ({ ...d, id: ev.messageId, content: ev.content, unverified: ev.unverified, proposals: ev.proposals }));
          else if (ev.type === "error") throw new Error(ev.message);
        }
      }
    } catch (e) {
      setError((e as Error).message);
      setMessages((m) => m.filter((x) => x.id !== "pending"));
    } finally {
      setBusy(false);
      setTools([]);
      if (newConv && newConv !== conv) {
        setConv(newConv);
        router.replace(`/c/${clientId}/agent?c=${newConv}`, { scroll: false });
      }
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-[520px] flex-col">
      <ul className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
        {!messages.length && (
          <li className="py-8 text-center">
            <Bot className="mx-auto size-8 text-accent" />
            <p className="mt-2 text-sm font-medium">Pergunte sobre os dados deste cliente</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted">O agente corre neste computador e só consulta os dados guardados no hub. Pode sugerir alterações, mas nunca as aplica: tudo passa pela sua confirmação.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" disabled={!available || busy} onClick={() => send(s)} className="rounded-full border px-3 py-1 text-xs text-fg-2 hover:bg-hover disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          </li>
        )}
        {messages.map((m) => (m.id === "pending" && !m.content ? null : <Message key={m.id} m={m} clientId={clientId} />))}
        {busy && (
          <li className="flex items-center gap-2 pl-10 text-xs text-muted">
            <Loader2 className="size-3.5 animate-spin" />
            {tools.length ? `A consultar: ${tools[tools.length - 1]}…` : "A pensar…"}
          </li>
        )}
        <li ref={end} />
      </ul>
      {error && <p className="mx-4 mb-2 rounded-md bg-bad-soft px-3 py-2 text-xs text-bad">{error}</p>}
      <form
        className="flex gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
          rows={2}
          maxLength={2000}
          disabled={!available || busy}
          placeholder={available ? "Escreva a sua pergunta (Enter para enviar, Shift+Enter para nova linha)" : "Agente indisponível"}
          className={cn(inputClass, "h-auto flex-1 resize-none py-2")}
          aria-label="Pergunta ao agente"
        />
        <button type="submit" disabled={!available || busy || !text.trim()} className={cn(buttonClass("primary"), "self-end")}>
          <Send /> Enviar
        </button>
      </form>
    </div>
  );
}
