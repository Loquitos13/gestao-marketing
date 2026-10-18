import { z } from "zod";

export type SettingKey =
  | "APP_URL"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "GOOGLE_ADS_DEVELOPER_TOKEN"
  | "GOOGLE_ADS_LOGIN_CUSTOMER_ID"
  | "GOOGLE_ADS_API_VERSION"
  | "META_APP_ID"
  | "META_APP_SECRET"
  | "META_GRAPH_VERSION"
  | "SEMRUSH_API_KEY"
  | "SEMRUSH_DATABASE"
  | "SMTP_HOST"
  | "SMTP_PORT"
  | "SMTP_USER"
  | "SMTP_PASSWORD"
  | "SMTP_FROM"
  | "REDIS_URL"
  | "OLLAMA_URL"
  | "AGENT_MODEL"
  | "AGENT_CONTEXT_TOKENS"
  | "PAGESPEED_API_KEY"
  | "FX_AUTO_ECB"
  | "BACKUP_COPY_DIR";

export type SettingGroupKey = "app" | "google" | "meta" | "semrush" | "smtp" | "redis" | "agent" | "pagespeed" | "fx" | "backup";

/** O modelo de linguagem tem de correr nesta máquina ou na rede local: nenhum dado sai do servidor. */
export function isLocalUrl(v: string): boolean {
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const h = u.hostname.replace(/^\[|\]$/g, "");
    if (["localhost", "127.0.0.1", "::1", "host.docker.internal", "ollama"].includes(h)) return true;
    return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)\d{1,3}\.\d{1,3}(\.\d{1,3})?$/.test(h);
  } catch {
    return false;
  }
}

export interface SettingField {
  key: SettingKey;
  label: string;
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  type?: "text" | "url" | "number" | "email";
  schema: z.ZodType<string>;
}

export interface SettingGroup {
  key: SettingGroupKey;
  label: string;
  description: string;
  /** Pode ser testado sem efeitos colaterais (nenhum dado é alterado nas plataformas). */
  testable: boolean;
  fields: SettingField[];
}

const text = (max = 500) => z.string().trim().min(1).max(max).refine((v) => !/[\r\n]/.test(v), "Não pode conter quebras de linha");

export const SETTING_GROUPS: SettingGroup[] = [
  {
    key: "app",
    label: "Aplicação",
    description: "URL público usado nos URIs de redirecionamento OAuth e nos links de partilha de relatórios.",
    testable: false,
    fields: [{ key: "APP_URL", label: "URL público da aplicação", type: "url", required: true, placeholder: "https://hub.agencia.pt", schema: z.string().trim().url().max(200).transform((v) => v.replace(/\/+$/, "")) }],
  },
  {
    key: "google",
    label: "Google — Ads, Search Console e GA4",
    description: "Credenciais OAuth de um projeto Google Cloud (tipo “Aplicação Web”) e developer token da Google Ads API.",
    testable: true,
    fields: [
      { key: "GOOGLE_CLIENT_ID", label: "Client ID", required: true, placeholder: "123…apps.googleusercontent.com", schema: text().refine((v) => /\.apps\.googleusercontent\.com$/.test(v), "Deve terminar em .apps.googleusercontent.com") },
      { key: "GOOGLE_CLIENT_SECRET", label: "Client secret", secret: true, required: true, schema: text(200) },
      { key: "GOOGLE_ADS_DEVELOPER_TOKEN", label: "Developer token (Google Ads)", secret: true, hint: "Necessário para listar e sincronizar contas Google Ads. Requer acesso básico ou standard aprovado.", schema: text(100) },
      { key: "GOOGLE_ADS_LOGIN_CUSTOMER_ID", label: "Login customer ID (MCC)", placeholder: "123-456-7890", hint: "ID da conta gestora, se aceder às contas através de uma MCC.", schema: text(20).refine((v) => /^\d{3}-?\d{3}-?\d{4}$/.test(v), "Formato 123-456-7890") },
      { key: "GOOGLE_ADS_API_VERSION", label: "Versão da Google Ads API", placeholder: "v26", schema: text(10).refine((v) => /^v\d{2}$/.test(v), "Formato vNN") },
    ],
  },
  {
    key: "meta",
    label: "Meta — Ads, Facebook e Instagram",
    description: "App da Meta for Developers com o produto “Facebook Login para empresas” e a Marketing API.",
    testable: true,
    fields: [
      { key: "META_APP_ID", label: "App ID", required: true, schema: text(30).refine((v) => /^\d{6,20}$/.test(v), "Apenas dígitos") },
      { key: "META_APP_SECRET", label: "App secret", secret: true, required: true, schema: text(100).refine((v) => /^[a-f0-9]{32}$/i.test(v), "32 caracteres hexadecimais") },
      { key: "META_GRAPH_VERSION", label: "Versão da Graph API", placeholder: "v25.0", schema: text(10).refine((v) => /^v\d{2}\.\d$/.test(v), "Formato vNN.N") },
    ],
  },
  {
    key: "semrush",
    label: "Semrush (opcional)",
    description: "Posições orgânicas e backlinks por domínio. Os dados são sempre marcados como estimativas.",
    testable: true,
    fields: [
      { key: "SEMRUSH_API_KEY", label: "API key", secret: true, required: true, schema: text(100) },
      { key: "SEMRUSH_DATABASE", label: "Base de dados (país)", placeholder: "pt", schema: text(5).refine((v) => /^[a-z]{2}(-[a-z]{2})?$/.test(v), "Código de país, ex.: pt") },
    ],
  },
  {
    key: "smtp",
    label: "Email (SMTP)",
    description: "Envio de relatórios agendados e alertas. Sem SMTP, nenhum envio é feito e cada tentativa fica registada como “não enviado”.",
    testable: true,
    fields: [
      { key: "SMTP_HOST", label: "Servidor", required: true, placeholder: "smtp.exemplo.pt", schema: text(253).refine((v) => /^[a-z0-9.-]+$/i.test(v), "Nome de servidor inválido") },
      { key: "SMTP_PORT", label: "Porta", type: "number", placeholder: "587", hint: "465 usa TLS direto; 587 usa STARTTLS.", schema: text(5).refine((v) => /^\d+$/.test(v) && Number(v) > 0 && Number(v) < 65536, "Porta inválida") },
      { key: "SMTP_USER", label: "Utilizador", schema: text(254) },
      { key: "SMTP_PASSWORD", label: "Password", secret: true, schema: text(500) },
      { key: "SMTP_FROM", label: "Remetente", required: true, placeholder: "Relatórios <relatorios@agencia.pt>", schema: text(254).refine((v) => /[^\s@]+@[^\s@]+\.[^\s@>]+/.test(v), "Deve conter um email") },
    ],
  },
  {
    key: "redis",
    label: "Fila de tarefas (Redis)",
    description: "Sincronizações em segundo plano, agendamentos diários e relatórios recorrentes. Sem Redis, as sincronizações correm no pedido.",
    testable: true,
    fields: [{ key: "REDIS_URL", label: "URL do Redis", secret: true, required: true, placeholder: "redis://:password@host:6379/0", hint: "Depois de alterar, reinicie o worker (npm run worker).", schema: text(500).refine((v) => /^rediss?:\/\//.test(v), "Deve começar por redis:// ou rediss://") }],
  },
  {
    key: "agent",
    label: "Agente IA (local, Ollama)",
    description: "Modelo de linguagem open-source a correr neste computador através do Ollama. Só são aceites endereços locais: nenhum dado sai do servidor.",
    testable: true,
    fields: [
      { key: "OLLAMA_URL", label: "URL do Ollama", type: "url", placeholder: "http://127.0.0.1:11434", schema: text(200).refine(isLocalUrl, "Só endereços locais (localhost, 127.0.0.1, rede privada)").transform((v) => v.replace(/\/+$/, "")) },
      { key: "AGENT_MODEL", label: "Modelo", placeholder: "qwen2.5:7b-instruct", hint: "Tem de suportar chamadas de ferramentas. Descarregue-o antes com: ollama pull <modelo>.", schema: text(100).refine((v) => /^[a-z0-9._:/-]+$/i.test(v), "Nome de modelo inválido") },
      { key: "AGENT_CONTEXT_TOKENS", label: "Janela de contexto (tokens)", type: "number", placeholder: "8192", hint: "8192 cabe em 8 GB de VRAM com um modelo 7B Q4; valores maiores aumentam a latência.", schema: text(5).refine((v) => /^\d+$/.test(v) && Number(v) >= 2048 && Number(v) <= 32768, "Entre 2048 e 32768") },
    ],
  },
  {
    key: "pagespeed",
    label: "PageSpeed Insights (opcional)",
    description: "Velocidade das páginas do cliente e dos concorrentes (API gratuita da Google). Sem chave a quota é muito baixa.",
    testable: true,
    fields: [{ key: "PAGESPEED_API_KEY", label: "API key", secret: true, required: true, hint: "Google Cloud → APIs e serviços → ativar PageSpeed Insights API → Credenciais.", schema: text(100) }],
  },
  {
    key: "fx",
    label: "Taxas de câmbio (BCE)",
    description: "Importação diária (16:30 UTC) das taxas de referência do Banco Central Europeu, sem chave. As taxas registadas manualmente em Definições prevalecem.",
    testable: true,
    fields: [{ key: "FX_AUTO_ECB", label: "Importação automática", placeholder: "true", hint: "true liga, false desliga. Precisa do worker a correr.", schema: text(5).transform((v) => v.toLowerCase()).pipe(z.enum(["true", "false"])) }],
  },
  {
    key: "backup",
    label: "Cópia de segurança",
    description: "Segunda localização para as cópias do Postgres criadas por npm run db:backup (outro disco ou unidade de rede). Nessa pasta, as cópias com mais de 30 dias são apagadas.",
    testable: true,
    fields: [{ key: "BACKUP_COPY_DIR", label: "Pasta da segunda cópia", placeholder: "D:\\backups\\mih", hint: "Pasta local ou unidade de rede montada, vista pelo computador que corre db:backup. Vazio desliga.", schema: text(260).refine((v) => !v.split(/[\\/]/).includes(".."), "Não pode conter segmentos ..") }],
  },
];

export const SETTING_FIELDS: SettingField[] = SETTING_GROUPS.flatMap((g) => g.fields);
export const SETTING_KEYS = new Set<string>(SETTING_FIELDS.map((f) => f.key));
export const settingGroup = (k: string) => SETTING_GROUPS.find((g) => g.key === k);
