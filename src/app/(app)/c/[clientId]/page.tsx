import { redirect } from "next/navigation";

export default async function ClientRoot(props: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await props.params;
  redirect(`/c/${clientId}/overview`);
}
