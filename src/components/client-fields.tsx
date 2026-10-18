import type { Client } from "@prisma/client";
import { Field, inputClass } from "./ui";

const TIMEZONES = ["Europe/Lisbon", "Atlantic/Azores", "Atlantic/Madeira", "Europe/Madrid", "Europe/London", "Europe/Paris", "America/Sao_Paulo", "America/New_York", "Africa/Luanda", "Africa/Maputo", "UTC"];
const CURRENCIES = ["EUR", "USD", "GBP", "BRL", "AOA", "MZN", "CHF"];

/** Campos do formulário de cliente (criação e edição). */
export function ClientFields({ client }: { client?: Client }) {
  const tz = client?.timezone ?? "Europe/Lisbon";
  const cur = client?.currency ?? "EUR";
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label="Nome *">
        <input name="name" required minLength={2} maxLength={120} defaultValue={client?.name} className={inputClass} />
      </Field>
      <Field label="Website">
        <input name="website" type="url" placeholder="https://" defaultValue={client?.website ?? ""} className={inputClass} />
      </Field>
      <Field label="Setor">
        <input name="industry" maxLength={120} defaultValue={client?.industry ?? ""} className={inputClass} />
      </Field>
      <Field label="Logótipo (URL https)">
        <input name="logoUrl" type="url" placeholder="https://" defaultValue={client?.logoUrl ?? ""} className={inputClass} />
      </Field>
      <Field label="Contacto">
        <input name="contactName" maxLength={120} defaultValue={client?.contactName ?? ""} className={inputClass} />
      </Field>
      <Field label="Email do contacto">
        <input name="contactEmail" type="email" defaultValue={client?.contactEmail ?? ""} className={inputClass} />
      </Field>
      <Field label="Telefone">
        <input name="contactPhone" maxLength={40} defaultValue={client?.contactPhone ?? ""} className={inputClass} />
      </Field>
      <Field label="Estado do contrato">
        <select name="contractStatus" defaultValue={client?.contractStatus ?? "ACTIVE"} className={inputClass}>
          <option value="PROSPECT">Prospeção</option>
          <option value="ACTIVE">Ativo</option>
          <option value="PAUSED">Pausado</option>
          <option value="ENDED">Terminado</option>
        </select>
      </Field>
      <Field label="Orçamento mensal de referência" hint="Usado no ritmo de investimento quando não há orçamento específico.">
        <input name="monthlyBudget" type="number" step="0.01" min="0" defaultValue={client?.monthlyBudget?.toString() ?? ""} className={inputClass} />
      </Field>
      <Field label="Margem bruta média (%)" hint="Sem margem, o ROI não é calculado (só o ROAS).">
        <input name="grossMargin" type="number" step="0.1" min="0" max="100" defaultValue={client?.grossMargin ? (Number(client.grossMargin) * 100).toString() : ""} className={inputClass} />
      </Field>
      <Field label="Moeda de apresentação" hint="Valores noutras moedas só são convertidos com taxa de câmbio registada.">
        <select name="currency" defaultValue={cur} className={inputClass}>
          {(CURRENCIES.includes(cur) ? CURRENCIES : [cur, ...CURRENCIES]).map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Field>
      <Field label="Fuso horário" hint="Datas guardadas em UTC e apresentadas neste fuso.">
        <select name="timezone" defaultValue={tz} className={inputClass}>
          {(TIMEZONES.includes(tz) ? TIMEZONES : [tz, ...TIMEZONES]).map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </Field>
      <input type="hidden" name="locale" value={client?.locale ?? "pt-PT"} />
      <div className="md:col-span-2">
        <Field label="Objetivos de negócio">
          <textarea name="objectives" rows={3} maxLength={2000} defaultValue={client?.objectives ?? ""} className={`${inputClass} h-auto py-2`} />
        </Field>
      </div>
      <div className="md:col-span-2">
        <Field label="Notas internas" hint="Nunca incluídas em relatórios.">
          <textarea name="internalNotes" rows={3} maxLength={5000} defaultValue={client?.internalNotes ?? ""} className={`${inputClass} h-auto py-2`} />
        </Field>
      </div>
    </div>
  );
}
