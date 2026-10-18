/**
 * Sobe Postgres e Redis e diz se o Ollama responde.
 * Uso: npm run dev:up
 * A ENCRYPTION_KEY não é lida nem impressa.
 */
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

function docker(args: string[], quiet = false) {
  const r = spawnSync("docker", args, { stdio: quiet ? "ignore" : "inherit" });
  return r.status === 0;
}

async function main() {
  console.log("A iniciar Postgres e Redis…");
  if (!docker(["compose", "up", "-d", "postgres", "redis"])) {
    console.error("O Docker não está a correr. Abra o Docker Desktop e volte a executar npm run dev:up.");
    process.exit(1);
  }
  const deadline = Date.now() + 60_000;
  let pg = false;
  let redis = false;
  while (Date.now() < deadline && (!pg || !redis)) {
    if (!pg) pg = docker(["compose", "exec", "-T", "postgres", "pg_isready", "-U", "mih", "-d", "mih"], true);
    if (!redis) redis = docker(["compose", "exec", "-T", "redis", "redis-cli", "ping"], true);
    if (!pg || !redis) await delay(1_000);
  }
  console.log(pg ? "Postgres: ok" : "Postgres: não ficou pronto.");
  console.log(redis ? "Redis: ok" : "Redis: não ficou pronto.");

  const raw = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
  let shown = "o endereço configurado";
  try {
    shown = new URL(raw).origin;
  } catch {
    shown = "o endereço configurado";
  }
  let model = false;
  try {
    const res = await fetch(`${raw.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(3_000) });
    model = res.ok;
  } catch {
    model = false;
  }
  console.log(model ? `Ollama: ok (${shown})` : `Ollama: não responde em ${shown}. O agente fica indisponível até correr ollama serve.`);
  console.log("Fila de tarefas: npm run worker");
  if (!pg || !redis) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
