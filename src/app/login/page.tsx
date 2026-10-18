import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Iniciar sessão" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  if (await getSessionUser()) redirect("/");
  const sp = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="grid size-7 place-items-center rounded-md bg-inverse text-[13px] font-semibold text-inverse-fg">M</div>
          <div>
            <div className="text-[13px] font-semibold">Marketing Intelligence Hub</div>
            <div className="text-xs text-muted">Gestão e análise de marketing multi-cliente</div>
          </div>
        </div>
        <div className="rounded-lg border bg-surface p-5">
          <h1 className="mb-4 text-[15px] font-semibold">Iniciar sessão</h1>
          {sp.error === "no-org" && <p className="mb-3 text-xs text-bad">Utilizador sem organização associada.</p>}
          <LoginForm next={sp.next} />
        </div>
      </div>
    </main>
  );
}
