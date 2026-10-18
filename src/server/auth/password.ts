import bcrypt from "bcryptjs";

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Política mínima: 10+ caracteres, com letras e números. */
export function passwordPolicyError(plain: string): string | null {
  if (plain.length < 10) return "A password deve ter pelo menos 10 caracteres.";
  if (!/[A-Za-z]/.test(plain) || !/\d/.test(plain)) return "A password deve conter letras e números.";
  return null;
}
