import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

export class CrawlError extends Error {
  constructor(
    message: string,
    public kind: "BLOCKED" | "ROBOTS" | "TOO_LARGE" | "NOT_HTML" | "HTTP" | "NETWORK" | "INVALID",
    public status?: number,
  ) {
    super(message);
    this.name = "CrawlError";
  }
}

const v4 = (ip: string) => ip.split(".").map(Number);
const inV4 = (ip: number[], base: string, bits: number) => {
  const b = v4(base);
  const toInt = (p: number[]) => ((p[0]! << 24) >>> 0) + (p[1]! << 16) + (p[2]! << 8) + p[3]!;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) >>> 0 === (toInt(b) & mask) >>> 0;
};
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

/** IPs privados, locais, reservados ou de documentação (não acessíveis a partir de um rastreio público). */
export function isBlockedIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return BLOCKED_V4.some(([b, bits]) => inV4(v4(ip), b, bits));
  if (fam !== 6) return true;
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = s.match(/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? s.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIp(mapped[1]!);
  // ::ffff:a.b.c.d e NAT64 64:ff9b::a.b.c.d em forma hexadecimal
  const hexMapped = s.match(/^(?:::ffff|64:ff9b:):([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1]!, 16);
    const lo = parseInt(hexMapped[2]!, 16);
    return isBlockedIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (s === "::" || s === "::1") return true;
  const first = parseInt(s.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 (ULA)
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (s.startsWith("2001:db8:") || s.startsWith("2001:0db8:")) return true;
  if (s.startsWith("2002:")) return true; // 6to4: encapsula um IPv4 arbitrário
  return false;
}

/** Só http/https, portas normais, sem credenciais e sem nomes locais ou IPs internos. */
export function checkUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new CrawlError("URL inválido", "INVALID");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new CrawlError(`Esquema não permitido: ${u.protocol}`, "BLOCKED");
  if (u.username || u.password) throw new CrawlError("URLs com credenciais não são permitidos", "BLOCKED");
  if (u.port && u.port !== "80" && u.port !== "443") throw new CrawlError("Só são permitidas as portas 80 e 443", "BLOCKED");
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || /\.(localhost|local|internal|lan|home|corp)$/.test(host) || !host.includes(".") && !isIP(host)) throw new CrawlError("Endereço local não permitido", "BLOCKED");
  if (isIP(host) && isBlockedIp(host)) throw new CrawlError("Endereço IP privado ou reservado", "BLOCKED");
  u.hash = "";
  return u;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** Resolução DNS que recusa endereços internos: aplicada no momento da ligação (impede DNS rebinding). */
export function safeLookup(hostname: string, options: { all?: boolean; family?: number } | number, cb: LookupCb) {
  const opts = typeof options === "number" ? { family: options } : (options ?? {});
  dnsLookup(hostname, { family: opts.family ?? 0, all: true }, (err, addrs) => {
    if (err) return cb(err, []);
    const bad = addrs.find((a) => isBlockedIp(a.address));
    if (bad || !addrs.length) return cb(Object.assign(new Error(`Endereço bloqueado para ${hostname}`), { code: "EBLOCKED" }), []);
    if (opts.all) cb(null, addrs);
    else cb(null, addrs[0]!.address, addrs[0]!.family);
  });
}

export type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = (host) => new Promise((res, rej) => dnsLookup(host, { all: true }, (e, a) => (e ? rej(e) : res(a.map((x) => x.address)))));

export async function assertPublicHost(u: URL, resolve: Resolver = defaultResolver) {
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return;
  let addrs: string[];
  try {
    addrs = await resolve(host);
  } catch {
    throw new CrawlError(`Não foi possível resolver ${host}`, "NETWORK");
  }
  if (!addrs.length || addrs.some(isBlockedIp)) throw new CrawlError(`${host} resolve para um endereço privado ou reservado`, "BLOCKED");
}

let agent: Agent | null = null;
const dispatcher = () => (agent ??= new Agent({ connect: { lookup: safeLookup as never, timeout: 10_000 }, headersTimeout: 15_000, bodyTimeout: 20_000 }));

export type FetchLike = (url: string, init: { redirect: "manual"; headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;
const realFetch: FetchLike = (url, init) => undiciFetch(url, { ...init, dispatcher: dispatcher() }) as unknown as Promise<Response>;

export interface SafeFetchOptions {
  userAgent: string;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  accept?: string;
  fetchImpl?: FetchLike;
  resolve?: Resolver;
}

export interface FetchedDoc {
  url: string;
  status: number;
  contentType: string;
  body: string;
  lastModified: string | null;
}

export const MAX_PAGE_BYTES = 2 * 1024 * 1024;

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const len = Number(res.headers.get("content-length"));
  if (Number.isFinite(len) && len > maxBytes) throw new CrawlError("Página demasiado grande", "TOO_LARGE");
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      void reader.cancel().catch(() => undefined);
      throw new CrawlError("Página demasiado grande", "TOO_LARGE");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function decode(bytes: Uint8Array, contentType: string) {
  const cs = contentType.match(/charset=([\w-]+)/i)?.[1]?.toLowerCase();
  try {
    return new TextDecoder(cs && cs !== "utf8" ? cs : "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** GET com proteção SSRF em cada salto de redirecionamento, limite de tamanho e timeout. */
export async function safeFetch(raw: string, opts: SafeFetchOptions): Promise<FetchedDoc> {
  const f = opts.fetchImpl ?? realFetch;
  let url = checkUrl(raw);
  for (let hop = 0; hop <= (opts.maxRedirects ?? 5); hop++) {
    await assertPublicHost(url, opts.resolve);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
    try {
      let res: Response;
      try {
        res = await f(url.toString(), { redirect: "manual", headers: { "User-Agent": opts.userAgent, Accept: opts.accept ?? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1", "Accept-Language": "pt-PT,pt;q=0.9" }, signal: controller.signal });
      } catch (e) {
        const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
        if (cause?.code === "EBLOCKED") throw new CrawlError(cause.message ?? "Endereço bloqueado", "BLOCKED");
        throw new CrawlError(`Falha de rede: ${e instanceof Error ? e.message : String(e)}`, "NETWORK");
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        void res.body?.cancel().catch(() => undefined);
        url = checkUrl(new URL(res.headers.get("location")!, url).toString());
        continue;
      }
      const contentType = res.headers.get("content-type") ?? "";
      const body = res.ok ? decode(await readCapped(res, opts.maxBytes ?? MAX_PAGE_BYTES), contentType) : "";
      if (!res.ok) void res.body?.cancel().catch(() => undefined);
      return { url: url.toString(), status: res.status, contentType, body, lastModified: res.headers.get("last-modified") };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new CrawlError("Demasiados redirecionamentos", "HTTP");
}
