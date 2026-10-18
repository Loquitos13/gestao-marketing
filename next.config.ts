import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

// O Next.js injeta scripts inline de hidratação; sem nonces é necessário 'unsafe-inline' em script-src.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Uploads de ficheiros do workspace (limite de 10 MB validado na action).
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
  serverExternalPackages: ["@react-pdf/renderer", "exceljs", "pino", "bullmq", "ioredis"],
  // O tracing do build standalone não segue a condição de export "module-sync" (dependências transitivas do exceljs)
  // nem os ficheiros de fontes carregados dinamicamente pelo pdfkit.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/generator-function/**", "./node_modules/async-function/**", "./node_modules/pdfkit/js/standard-fonts/**", "./node_modules/pdfkit/js/data/**"],
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      { source: "/share/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
