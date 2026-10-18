import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { can } from "@/server/auth/rbac";
import { agentConfig, ollamaStatus } from "@/server/agent/llm";
import { getConfig } from "@/server/config/settings";
import { workerIsRunning } from "@/server/sync/worker-presence";
import { deleteConversationAction } from "@/server/actions/agent";
import { ActionForm } from "@/components/action-form";
import { Card, Notice, PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";
import { clientContext } from "../page-context";
import { AgentChat, type ChatMessage } from "./agent-chat";
import { LearningPanel, MemoryPanel, ModelsPanel, RunsPanel, StatusPanel } from "./panels";

export const metadata = { title: "Agente IA" };

export default async function AgentPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ c?: string }> }) {
  const { clientId } = await params;
  const sp = await searchParams;
  const { client, ctx, tenant } = await clientContext(clientId);
  const canUse = can(tenant.role, "agent:use");
  const redisUrl = (await getConfig()).REDIS_URL;
  const [status, cfg, conversations, memories, models, runs, pref, workerUp] = await Promise.all([
    ollamaStatus(),
    agentConfig().catch(() => ({ model: "—" })),
    prisma.agentConversation.findMany({ where: { clientId: client.id, userId: tenant.userId }, orderBy: { updatedAt: "desc" }, take: 12, select: { id: true, title: true, updatedAt: true } }),
    prisma.agentMemory.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "asc" } }),
    prisma.agentModel.findMany({ where: { clientId: client.id }, orderBy: [{ kind: "asc" }, { scope: "asc" }] }),
    prisma.agentRun.findMany({ where: { clientId: client.id }, orderBy: { startedAt: "desc" }, take: 20 }),
    prisma.agentPreference.findUnique({ where: { organizationId: tenant.organizationId } }),
    redisUrl ? workerIsRunning(redisUrl) : Promise.resolve(false),
  ]);
  const worker = redisUrl ? (workerUp ? "on" : "off") : "inline";
  const active = sp.c ? conversations.find((c) => c.id === sp.c) : undefined;
  const rows = active ? await prisma.agentMessage.findMany({ where: { conversationId: active.id }, orderBy: { createdAt: "asc" }, take: 200 }) : [];
  const messages: ChatMessage[] = rows.map((m) => ({
    id: m.id,
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
    sources: ((m.sources as { label: string; ok: boolean }[] | null) ?? []).map((s) => ({ label: s.label, ok: s.ok })),
    unverified: (m.unverified as string[] | null) ?? [],
    proposals: (m.proposals as ChatMessage["proposals"] | null) ?? [],
  }));
  const base = `/c/${client.id}/agent`;

  return (
    <div className="space-y-5">
      <PageHeader title="Agente IA" description="Analista local treinado nos dados deste cliente. Interpreta a informação guardada no hub e sugere decisões; o utilizador aprova sempre." />
      {ctx.origin === "SIMULATED" && <Notice>Este cliente usa dados de demonstração: as respostas e sugestões do agente baseiam-se em dados simulados.</Notice>}
      {!canUse && <Notice>O seu perfil só permite consultar: conversar com o agente requer o perfil Analista ou superior.</Notice>}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
            <Link href={base} className={cn("inline-flex h-[26px] items-center gap-1 rounded-md px-2 text-xs font-medium", !active ? "bg-hover text-fg" : "text-muted hover:text-fg")}>
              <Plus className="size-3.5" /> Nova conversa
            </Link>
            {conversations.map((c) => (
              <Link key={c.id} href={`${base}?c=${c.id}`} title={c.title} className={cn("h-[26px] max-w-[200px] truncate rounded-md px-2 text-xs leading-[26px]", active?.id === c.id ? "bg-hover text-fg" : "text-muted hover:text-fg")}>
                {c.title}
              </Link>
            ))}
            {active && canUse && (
              <ActionForm action={deleteConversationAction} submitLabel="Apagar conversa" size="sm" variant="ghost" inline confirm="Apagar esta conversa?" className="ml-auto">
                <input type="hidden" name="clientId" value={client.id} />
                <input type="hidden" name="conversationId" value={active.id} />
              </ActionForm>
            )}
          </div>
          <AgentChat clientId={client.id} conversationId={active?.id ?? null} initial={messages} available={status.ok && canUse} />
        </Card>
        <div className="space-y-5">
          <StatusPanel clientId={client.id} ok={status.ok} message={status.message} model={cfg.model} canUse={canUse} worker={worker} />
          <MemoryPanel clientId={client.id} memories={memories} canUse={canUse} fmt={ctx.fmt} />
          <ModelsPanel models={models} />
          <LearningPanel pref={pref} />
          <RunsPanel runs={runs} fmt={ctx.fmt} />
        </div>
      </div>
    </div>
  );
}
