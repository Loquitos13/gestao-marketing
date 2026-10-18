import type { PrismaClient } from "@prisma/client";
import { addDays, toDate, type ISODate } from "@/lib/dates";

/** Conteúdo fictício do workspace (tarefas e notas) para os clientes de demonstração. */
interface DemoWorkspace {
  tasks: { title: string; area: string; dueIn: number; priority?: number; done?: boolean; description?: string }[];
  notes: { body: string; pinned?: boolean; daysAgo: number }[];
}

const WORKSPACES: Record<string, DemoWorkspace> = {
  atlantico: {
    tasks: [
      { title: "Enviar relatório mensal ao cliente", area: "Relatórios", dueIn: -1, priority: 1 },
      { title: "Rever termos de pesquisa com custo por conversão acima de 25 €", area: "Google Ads", dueIn: 0 },
      { title: "Preparar 3 criativos Reels para a campanha de outono", area: "Meta Ads", dueIn: 2, description: "O criativo de vídeo principal mostra sinais de fadiga (frequência > 4)." },
      { title: "Validar objetivo de ROAS para o próximo trimestre", area: "Reunião", dueIn: 7 },
      { title: "Atualizar feed do Merchant Center", area: "Google Ads", dueIn: -5, done: true },
    ],
    notes: [
      { body: "Margem bruta 48%. Objetivo ROAS ≥ 5× por canal. Campanha de outono de 1 de outubro a 15 de novembro; saldos a partir de 26 de dezembro.", pinned: true, daysAgo: 40 },
      { body: "Cliente pediu para separar no relatório as vendas da coleção de linho.", daysAgo: 6 },
    ],
  },
  sorriso: {
    tasks: [
      { title: "Confirmar com a clínica a qualidade das leads de implantes", area: "Reunião", dueIn: 1, priority: 1 },
      { title: "Testar nova landing page de ortodontia invisível", area: "Conteúdo", dueIn: 4 },
      { title: "Excluir pesquisas de emprego («dentista vagas»)", area: "Google Ads", dueIn: -2 },
      { title: "Publicar artigo sobre branqueamento", area: "SEO", dueIn: -8, done: true },
    ],
    notes: [
      { body: "Capacidade da clínica: máx. 25 primeiras consultas por semana. Evitar escalar orçamento sem confirmar agenda.", pinned: true, daysAgo: 30 },
      { body: "Leads por telefone são registadas manualmente pela receção; não aparecem nas plataformas.", daysAgo: 12 },
    ],
  },
  horizonte: {
    tasks: [
      { title: "Rever públicos semelhantes de decisores de TI", area: "Meta Ads", dueIn: 3 },
      { title: "Preparar relatório trimestral para a direção", area: "Relatórios", dueIn: 10, priority: 1 },
      { title: "Corrigir canonical das páginas de preços", area: "SEO", dueIn: -1 },
    ],
    notes: [{ body: "Ciclo de venda de 45–90 dias: avaliar campanhas por leads qualificadas (MQL), não por demos agendadas no próprio dia.", pinned: true, daysAgo: 20 }],
  },
};

export async function writeDemoWorkspace(db: PrismaClient, clientId: string, key: string, anchor: ISODate, userId: string) {
  const ws = WORKSPACES[key];
  if (!ws || (await db.clientTask.count({ where: { clientId } }))) return;
  const at = (days: number) => new Date(Date.now() - days * 86_400_000);
  await db.clientTask.createMany({
    data: ws.tasks.map((t) => ({
      clientId,
      title: t.title,
      area: t.area,
      description: t.description ?? null,
      priority: t.priority ?? 2,
      dueDate: toDate(addDays(anchor, t.dueIn + 1)),
      status: t.done ? "DONE" : "OPEN",
      completedAt: t.done ? at(2) : null,
      assigneeId: userId,
      createdById: userId,
    })),
  });
  await db.clientNote.createMany({ data: ws.notes.map((n) => ({ clientId, body: n.body, pinned: n.pinned ?? false, authorId: userId, createdAt: at(n.daysAgo) })) });
}
