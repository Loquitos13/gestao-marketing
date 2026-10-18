import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "v1";

function key(raw = process.env.ENCRYPTION_KEY): Buffer {
  if (!raw) throw new Error("ENCRYPTION_KEY não configurada");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY deve ter 32 bytes em base64");
  return buf;
}

/** AES-256-GCM. Formato: v1:<iv>:<tag>:<ciphertext> (base64url). */
export function encrypt(plain: string, rawKey?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(rawKey), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(":");
}

export function decrypt(payload: string, rawKey?: string): string {
  const [version, iv, tag, data] = payload.split(":");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Formato de dados encriptados inválido");
  const decipher = createDecipheriv("aes-256-gcm", key(rawKey), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hmac(value: string, secret = process.env.SESSION_SECRET ?? ""): string {
  if (!secret) throw new Error("SESSION_SECRET não configurado");
  return createHmac("sha256", secret).update(value).digest("base64url");
}

/** Assina um valor: <valor>.<hmac>. */
export function sign(value: string, secret?: string): string {
  return `${value}.${hmac(value, secret)}`;
}

export function unsign(signed: string, secret?: string): string | null {
  const idx = signed.lastIndexOf(".");
  if (idx <= 0) return null;
  const value = signed.slice(0, idx);
  const expected = Buffer.from(hmac(value, secret));
  const given = Buffer.from(signed.slice(idx + 1));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return value;
}
