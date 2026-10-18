/** Traduz uma falha técnica para uma frase que se pode mostrar ao utilizador, sem endereços nem segredos. */
export function describeFailure(message: string): { title: string; detail: string } {
  const m = message.toLowerCase();
  if (m.includes("redis") || m.includes(":6392")) {
    return {
      title: "Fila indisponível",
      detail: "O Redis não responde. Sincronizações, relatórios agendados e o agente ficam à espera até a fila voltar. Inicie-a com npm run dev:up.",
    };
  }
  if (m.includes("ollama") || m.includes("modelo local") || m.includes("modelo está ocupado")) {
    return {
      title: "Modelo indisponível",
      detail: "O Ollama não está a responder, ou está ocupado com outro pedido. O resto da aplicação continua disponível.",
    };
  }
  if (m.includes("database") || m.includes("prisma") || m.includes(":5442") || m.includes("postgres") || m.includes("p1001") || m.includes("can't reach")) {
    return {
      title: "Base de dados indisponível",
      detail: "O Postgres não responde. Inicie-o com npm run dev:up e volte a carregar a página.",
    };
  }
  return {
    title: "Serviço indisponível",
    detail: "Ocorreu um erro inesperado. Pode tentar outra vez. Se continuar, confirme que a base de dados e a fila estão a correr.",
  };
}
