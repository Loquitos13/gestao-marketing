import { requirePermission } from "@/server/auth/guard";
import { createClientAction } from "@/server/actions/clients";
import { ActionForm } from "@/components/action-form";
import { ClientFields } from "@/components/client-fields";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Novo cliente" };

export default async function NewClientPage() {
  await requirePermission("client:write");
  return (
    <div className="w-full max-w-3xl space-y-5 px-6 pb-6 pt-5">
      <PageHeader title="Novo cliente" description="Depois de criar, associe as contas Google Ads, Meta, Search Console e GA4 na página de fontes de dados." />
      <Card className="p-4">
        <ActionForm action={createClientAction} submitLabel="Criar cliente">
          <ClientFields />
        </ActionForm>
      </Card>
    </div>
  );
}
