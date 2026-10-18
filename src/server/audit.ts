import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export interface AuditInput {
  organizationId?: string | null;
  clientId?: string | null;
  userId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
}

const SENSITIVE_KEYS = /token|secret|password|authorization/i;

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEYS.test(k) ? "[REDACTED]" : sanitize(v)]),
    );
  }
  return value;
}

/** Regista operações sensíveis. Nunca falha a operação principal. */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: input.organizationId ?? null,
        clientId: input.clientId ?? null,
        userId: input.userId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: input.metadata ? (sanitize(input.metadata) as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch {
    // auditoria não deve interromper a operação
  }
}
