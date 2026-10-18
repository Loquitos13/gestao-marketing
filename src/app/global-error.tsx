"use client";

import { describeFailure } from "@/lib/failure";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const d = describeFailure(error.message ?? "");
  return (
    <html lang="pt-PT">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif", background: "#f6f5f3", color: "#1c1917" }}>
        <main style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>{d.title}</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: "#57534e" }}>{d.detail}</p>
          <button type="button" onClick={() => reset()} style={{ marginTop: 16, height: 32, padding: "0 12px", borderRadius: 6, border: "1px solid #1c1917", background: "#1c1917", color: "#fafaf9", cursor: "pointer" }}>
            Tentar outra vez
          </button>
        </main>
      </body>
    </html>
  );
}
