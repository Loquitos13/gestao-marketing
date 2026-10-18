/**
 * Exporta pares instrução → resposta aprovada (JSONL no formato de chat) para afinar o modelo local com LoRA.
 *
 *   npm run agent:export -- [--client <id>] [--out exports/agent-dataset.jsonl]
 *
 * Só entram respostas que o utilizador aprovou: recomendações de IA aprovadas ou concluídas e respostas do chat
 * cujas propostas foram todas aprovadas ou aplicadas. O ficheiro contém dados dos clientes: não o partilhe nem o
 * coloque no repositório (a pasta exports/ está no .gitignore).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { prisma } from "@/lib/prisma";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const SYSTEM = "És o analista de marketing digital do hub. Respondes em português de Portugal, usas só os números dos dados e nunca aplicas alterações: só sugeres.";

async function main() {
  const clientId = arg("client");
  const out = resolve(arg("out") ?? "exports/agent-dataset.jsonl");
  const lines: string[] = [];

  const recs = await prisma.recommendation.findMany({ where: { source: "AI", status: { in: ["APPROVED", "DONE"] }, agentRunId: { not: null }, ...(clientId ? { clientId } : {}) } });
  const runs = new Map((await prisma.agentRun.findMany({ where: { id: { in: recs.map((r) => r.agentRunId!) } }, select: { id: true, summary: true } })).map((r) => [r.id, r.summary]));
  for (const r of recs) {
    const analysis = runs.get(r.agentRunId!);
    if (!analysis) continue;
    lines.push(
      JSON.stringify({
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Com base nesta análise, propõe uma recomendação.\n\n${analysis}` },
          { role: "assistant", content: JSON.stringify({ title: r.title, explanation: r.explanation, suggestedAction: r.suggestedAction, priority: r.priority, confidence: r.confidence }) },
        ],
      }),
    );
  }

  const msgs = await prisma.agentMessage.findMany({
    where: { role: "assistant", proposals: { not: [] }, conversation: clientId ? { clientId } : undefined },
    include: { conversation: { select: { id: true } } },
    orderBy: { createdAt: "asc" },
  });
  for (const m of msgs) {
    const proposals = (m.proposals as { kind: string; id: string }[] | null) ?? [];
    if (!proposals.length) continue;
    const recIds = proposals.filter((p) => p.kind === "recommendation").map((p) => p.id);
    const chIds = proposals.filter((p) => p.kind === "change").map((p) => p.id);
    const [okRecs, okChanges] = await Promise.all([
      prisma.recommendation.count({ where: { id: { in: recIds }, status: { in: ["APPROVED", "DONE"] } } }),
      prisma.adChange.count({ where: { id: { in: chIds }, status: { in: ["APPLIED", "REVERTED"] } } }),
    ]);
    if (okRecs !== recIds.length || okChanges !== chIds.length) continue;
    const question = await prisma.agentMessage.findFirst({ where: { conversationId: m.conversationId, role: "user", createdAt: { lt: m.createdAt } }, orderBy: { createdAt: "desc" } });
    if (!question) continue;
    lines.push(JSON.stringify({ messages: [{ role: "system", content: SYSTEM }, { role: "user", content: question.content }, { role: "assistant", content: m.content }] }));
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, lines.length ? `${lines.join("\n")}\n` : "");
  console.log(`${lines.length} exemplos exportados para ${out}`);
  if (lines.length < 200) console.log("Aviso: para uma afinação LoRA útil são recomendados pelo menos algumas centenas de exemplos aprovados.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
