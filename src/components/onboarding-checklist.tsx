import type { OrgRole } from "@prisma/client";
import { can } from "@/server/auth/rbac";
import type { OnboardingStep } from "@/server/queries/onboarding";
import { Card, CardHeader, Dot, LinkButton } from "@/components/ui";

export function OnboardingChecklist({ steps, done, total, role }: { steps: OnboardingStep[]; done: number; total: number; role: OrgRole }) {
  if (done === total) return null;
  return (
    <Card className="mb-4">
      <CardHeader title="Primeiros passos" description={`${done} de ${total} passos`} />
      <ul className="divide-y">
        {steps.map((s) => (
          <li key={s.key} className="flex items-center gap-2.5 px-4 py-2 text-xs">
            <Dot tone={s.done ? "on" : "off"} />
            <span className={s.done ? "text-muted line-through" : "font-medium"}>{s.label}</span>
            {!s.done && can(role, s.permission) && (
              <span className="ml-auto">
                <LinkButton href={s.href} size="sm" variant="ghost">
                  Configurar
                </LinkButton>
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
