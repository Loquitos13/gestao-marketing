import { can } from "@/server/auth/rbac";
import { loadActivity } from "@/server/queries/workspace";
import { ActivityList } from "@/components/workspace-lists";
import { Card, PageHeader } from "@/components/ui";
import { clientContext } from "../page-context";

export const metadata = { title: "Atividade" };

export default async function ActivityPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const { client, tenant, ctx } = await clientContext(clientId);
  const items = await loadActivity(client.id, 100, can(tenant.role, "audit:read"));
  return (
    <div>
      <PageHeader title="Atividade" description="Sincronizações, alertas, relatórios, decisões e alterações da equipa neste cliente (últimos 100 eventos)." />
      <Card className="max-w-4xl">
        <ActivityList items={items} fmt={ctx.fmt} />
      </Card>
    </div>
  );
}
