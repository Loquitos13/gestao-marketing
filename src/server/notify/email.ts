import nodemailer from "nodemailer";
import { logger } from "@/lib/logger";
import { getConfig, type Config } from "@/server/config/settings";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

export type EmailResult = { status: "SENT" } | { status: "SKIPPED_NOT_CONFIGURED" } | { status: "FAILED"; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function smtpTransport(c: Pick<Config, "SMTP_HOST" | "SMTP_PORT" | "SMTP_USER" | "SMTP_PASSWORD">) {
  return nodemailer.createTransport({
    host: c.SMTP_HOST,
    port: c.SMTP_PORT,
    secure: c.SMTP_PORT === 465,
    auth: c.SMTP_USER ? { user: c.SMTP_USER, pass: c.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10_000,
  });
}

/**
 * Envia email apenas se o SMTP estiver configurado.
 * Sem SMTP devolve SKIPPED_NOT_CONFIGURED — nunca reporta envio que não ocorreu.
 */
export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const c = await getConfig();
  if (!c.SMTP_HOST || !c.SMTP_FROM) return { status: "SKIPPED_NOT_CONFIGURED" };
  if (!EMAIL_RE.test(msg.to) || /[\r\n]/.test(msg.to) || /[\r\n]/.test(msg.subject)) return { status: "FAILED", error: "Destinatário ou assunto inválido" };
  try {
    await smtpTransport(c).sendMail({ from: c.SMTP_FROM, ...msg });
    return { status: "SENT" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ to: msg.to.replace(/^(.).*@/, "$1***@"), error }, "Falha no envio de email");
    return { status: "FAILED", error };
  }
}

export function isValidEmail(v: string) {
  return EMAIL_RE.test(v) && v.length <= 254;
}
