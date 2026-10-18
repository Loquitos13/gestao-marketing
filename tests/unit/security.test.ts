import { describe, expect, it } from "vitest";
import { decrypt, encrypt, hmac, sign, unsign } from "@/lib/crypto";
import { rateLimit, rateLimitShared } from "@/lib/rate-limit";
import { describeFailure } from "@/lib/failure";
import { scrubSecrets } from "@/lib/logger";
import { can, PERMISSIONS, requiresExplicitClientAccess } from "@/server/auth/rbac";
import { accessibleClientsWhere, assertCan, resolveClientAccess, TenantError } from "@/server/auth/tenant";
import { passwordPolicyError } from "@/server/auth/password";
import { clientIp, safeInternalPath } from "@/lib/utils";
import { isBlockedIp } from "@/server/competitors/safe-fetch";

const KEY = Buffer.alloc(32, 1).toString("base64");

describe("encriptação de tokens", () => {
  it("encripta e desencripta; o texto cifrado não contém o original", () => {
    const token = "ya29.a0AfH6SMB-secret-token";
    const enc = encrypt(token, KEY);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain(token);
    expect(decrypt(enc, KEY)).toBe(token);
  });

  it("IV aleatório: duas encriptações do mesmo valor diferem", () => {
    expect(encrypt("x", KEY)).not.toBe(encrypt("x", KEY));
  });

  it("deteta adulteração e chave errada (GCM)", () => {
    const enc = encrypt("segredo", KEY);
    const parts = enc.split(":");
    const tampered = [...parts.slice(0, 3), Buffer.from("outro").toString("base64url")].join(":");
    expect(() => decrypt(tampered, KEY)).toThrow();
    expect(() => decrypt(enc, Buffer.alloc(32, 2).toString("base64"))).toThrow();
    expect(() => decrypt("lixo", KEY)).toThrow();
  });

  it("rejeita chaves com tamanho inválido", () => {
    expect(() => encrypt("x", Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
  });

  it("assinatura HMAC detecta alterações", () => {
    const s = sign("payload", "s".repeat(40));
    expect(unsign(s, "s".repeat(40))).toBe("payload");
    expect(unsign(s.replace("payload", "payloae"), "s".repeat(40))).toBeNull();
    expect(unsign(s, "t".repeat(40))).toBeNull();
    expect(unsign("semponto", "s".repeat(40))).toBeNull();
    expect(hmac("a", "k".repeat(40))).not.toBe(hmac("b", "k".repeat(40)));
  });
});

describe("limitação de pedidos e logs", () => {
  it("janela deslizante", () => {
    const k = `t-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(rateLimit(k, 3, 1000, 1000 + i).ok).toBe(true);
    const blocked = rateLimit(k, 3, 1000, 1500);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(rateLimit(k, 3, 1000, 2500).ok).toBe(true);
  });

  it("sem Redis usa o mesmo balde em memória", async () => {
    const k = `shared-${Math.random()}`;
    expect((await rateLimitShared(null, k, 1, 1000, 5_000)).ok).toBe(true);
    expect((await rateLimitShared(null, k, 1, 1000, 5_100)).ok).toBe(false);
  });

  it("diz qual serviço falhou, sem repetir o erro técnico", () => {
    expect(describeFailure("Can't reach database server at localhost:5442").title).toBe("Base de dados indisponível");
    expect(describeFailure("Redis connection refused :6392").title).toBe("Fila indisponível");
    expect(describeFailure("O Ollama não responde").title).toBe("Modelo indisponível");
    expect(describeFailure("Can't reach database server at localhost:5442").detail).not.toContain("5442");
  });

  it("remove segredos de mensagens", () => {
    const s = scrubSecrets("GET https://x/?access_token=abc123&fields=id Authorization: Bearer ya29.xyz key=SEMRUSHKEY");
    expect(s).not.toMatch(/abc123|ya29\.xyz|SEMRUSHKEY/);
    expect(s).toContain("[REDACTED]");
  });

  it("redirecionamento só para caminhos internos", () => {
    for (const p of ["/\\evil.com", "/\t/evil.com", "//evil.com", "https://evil.com", "evil.com", "", undefined]) expect(safeInternalPath(p, "/"), String(p)).toBe("/");
    expect(safeInternalPath("/clients?x=1", "/")).toBe("/clients?x=1");
    expect(safeInternalPath("/c/abc#top", "/")).toBe("/c/abc#top");
  });

  it("IP do cliente vem do último salto de X-Forwarded-For", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" }))).toBe("3.3.3.3");
    expect(clientIp(new Headers())).toBe("local");
  });

  it("SSRF: bloqueia NAT64 em hexadecimal e 6to4; deixa passar IPv6 público", () => {
    expect(isBlockedIp("64:ff9b::a9fe:a9fe")).toBe(true);
    expect(isBlockedIp("2002:a9fe:a9fe::")).toBe(true);
    expect(isBlockedIp("2606:4700::1111")).toBe(false);
  });

  it("política de password", () => {
    expect(passwordPolicyError("curta1")).not.toBeNull();
    expect(passwordPolicyError("semnumerosaqui")).not.toBeNull();
    expect(passwordPolicyError("Valida12345")).toBeNull();
  });
});

describe("RBAC", () => {
  it("proprietário tem todas as permissões; leitor só leitura", () => {
    for (const p of PERMISSIONS) expect(can("OWNER", p)).toBe(true);
    expect(can("VIEWER", "client:read")).toBe(true);
    expect(can("VIEWER", "report:read")).toBe(true);
    expect(can("VIEWER", "integration:manage")).toBe(false);
    expect(can("VIEWER", "recommendation:decide")).toBe(false);
    expect(can("ANALYST", "integration:manage")).toBe(false);
    expect(can("ANALYST", "client:delete")).toBe(false);
    expect(can("ADMIN", "org:manage")).toBe(false);
    expect(can("ADMIN", "member:manage")).toBe(true);
    expect(can("ANALYST", "workspace:write")).toBe(true);
    expect(can("VIEWER", "workspace:write")).toBe(false);
  });

  it("assertCan lança 403", () => {
    expect(() => assertCan({ role: "VIEWER" }, "client:write")).toThrowError(TenantError);
    try {
      assertCan({ role: "VIEWER" }, "client:write");
    } catch (e) {
      expect((e as TenantError).status).toBe(403);
    }
  });
});

describe("isolamento multi-tenant", () => {
  const client = { id: "c1", organizationId: "orgA", archivedAt: null };
  const db = {
    client: { findFirst: async ({ where }: { where: { id: string; organizationId: string } }) => (where.id === client.id && where.organizationId === client.organizationId ? client : null) },
    clientMember: { findUnique: async ({ where }: { where: { clientId_userId: { userId: string } } }) => (where.clientId_userId.userId === "viewerWithAccess" ? { id: "m" } : null) },
  } as never;

  it("cliente de outra organização devolve 404 (não revela existência)", async () => {
    await expect(resolveClientAccess(db, { organizationId: "orgB", role: "OWNER", userId: "u" }, "c1")).rejects.toMatchObject({ status: 404 });
  });

  it("leitor sem atribuição explícita não acede", async () => {
    await expect(resolveClientAccess(db, { organizationId: "orgA", role: "VIEWER", userId: "outro" }, "c1")).rejects.toMatchObject({ status: 404 });
    await expect(resolveClientAccess(db, { organizationId: "orgA", role: "VIEWER", userId: "viewerWithAccess" }, "c1")).resolves.toMatchObject({ id: "c1" });
    await expect(resolveClientAccess(db, { organizationId: "orgA", role: "ANALYST", userId: "x" }, "c1")).resolves.toMatchObject({ id: "c1" });
  });

  it("filtro de listagem inclui sempre a organização", () => {
    expect(accessibleClientsWhere({ organizationId: "orgA", role: "ADMIN", userId: "u" })).toEqual({ organizationId: "orgA", archivedAt: null });
    expect(requiresExplicitClientAccess("VIEWER")).toBe(true);
    expect(accessibleClientsWhere({ organizationId: "orgA", role: "VIEWER", userId: "u" })).toMatchObject({ organizationId: "orgA", members: { some: { userId: "u" } } });
  });
});
