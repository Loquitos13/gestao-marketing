import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

/** Caminho interno seguro para redirecionar: rejeita `//x`, `/\x`, `/\t/x` e URLs absolutos (anti open-redirect). */
export function safeInternalPath(p: string | undefined, fallback: string): string {
  try {
    const u = new URL(p ?? "", "http://x");
    return u.origin === "http://x" && (p ?? "").startsWith("/") ? u.pathname + u.search + u.hash : fallback;
  } catch {
    return fallback;
  }
}

/** IP do cliente: último salto de X-Forwarded-For (o único escrito pelo nosso proxy; os anteriores são controláveis pelo cliente). */
export function clientIp(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",").pop()?.trim() || "local";
}
