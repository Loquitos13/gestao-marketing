/**
 * Avaliação do agente com o Ollama e a BD reais sobre o cliente demo "Loja Atlântico (DEMO)".
 * Corre só com `npm run agent:eval` (fora do `npm test`). Ignorado se o Ollama ou a BD não responderem.
 * Cada caso verifica frases obrigatórias/proibidas na resposta e a ferramenta consultada; passa com >= 80%.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { chatTurn } from "@/server/agent/chat";
import { ollamaStatus } from "@/server/agent/llm";
import cases from "./cases.json";

interface Case {
  question: string;
  mustInclude: string[];
  mustNotInclude: string[];
  tool: string;
}

const MIN_PASS_RATE = 0.8;
let skipReason = "";
let client: { id: string; organizationId: string } | null = null;
let userId = "";
const conversations: string[] = [];

/** "a|b" = qualquer das alternativas; comparação sem distinguir maiúsculas. */
const has = (text: string, needle: string) => needle.split("|").some((n) => text.toLowerCase().includes(n.toLowerCase()));

beforeAll(async () => {
  const ollama = await ollamaStatus();
  if (!ollama.ok) {
    skipReason = ollama.message;
    return;
  }
  try {
    const c = await prisma.client.findFirst({ where: { name: "Loja Atlântico (DEMO)", archivedAt: null } });
    if (!c) {
      skipReason = "Cliente demo 'Loja Atlântico (DEMO)' não existe na BD (npm run db:seed).";
      return;
    }
    const member = await prisma.organizationMember.findFirst({ where: { organizationId: c.organizationId }, orderBy: { createdAt: "asc" } });
    if (!member) {
      skipReason = "A organização do cliente demo não tem membros.";
      return;
    }
    client = c;
    userId = member.userId;
  } catch (e) {
    skipReason = `BD não acessível: ${(e as Error).message.trim().split("\n")[0]}`;
  }
});

afterAll(async () => {
  if (conversations.length) await prisma.agentConversation.deleteMany({ where: { id: { in: conversations } } });
  await prisma.$disconnect();
});

describe("avaliação do agente (Ollama + BD reais)", () => {
  it(`responde corretamente a pelo menos ${MIN_PASS_RATE * 100}% dos casos`, async ({ skip }) => {
    if (skipReason || !client) skip(`Ignorado: ${skipReason}`);
    const full = await prisma.client.findUniqueOrThrow({ where: { id: client!.id } });
    let passed = 0;
    for (const [i, c] of (cases as Case[]).entries()) {
      const r = await chatTurn({ client: full, organizationId: full.organizationId, userId, canAds: false, message: c.question, onConversation: (id) => conversations.push(id) });
      const problems = [
        ...c.mustInclude.filter((n) => !has(r.content, n)).map((n) => `falta "${n}"`),
        ...c.mustNotInclude.filter((n) => has(r.content, n)).map((n) => `contém "${n}"`),
        ...(r.sources.some((s) => s.name === c.tool && s.ok) ? [] : [`não usou ${c.tool} (usou: ${r.sources.map((s) => s.name).join(", ") || "nenhuma"})`]),
      ];
      if (!problems.length) passed++;
      console.log(`${problems.length ? "FAIL" : "ok  "} ${String(i + 1).padStart(2)}/${cases.length} ${c.question}${problems.length ? `\n       → ${problems.join("; ")}\n       resposta: ${r.content.replace(/\s+/g, " ").slice(0, 300)}` : ""}`);
    }
    const rate = passed / cases.length;
    console.log(`\nResumo: ${passed}/${cases.length} casos (${Math.round(rate * 100)}%) · mínimo ${MIN_PASS_RATE * 100}%`);
    expect(rate).toBeGreaterThanOrEqual(MIN_PASS_RATE);
  });
});
