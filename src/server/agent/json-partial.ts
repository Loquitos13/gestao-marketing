/** Lê o texto de um valor string JSON a partir de `i`, mesmo que a string ainda não tenha fechado. */
function readJsonString(s: string, i: number): string {
  let out = "";
  for (; i < s.length; i++) {
    const c = s[i]!;
    if (c === '"') return out;
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = s[i + 1];
    if (n === undefined) return out;
    if (n === "n") out += "\n";
    else if (n === "t") out += "\t";
    else if (n === "r") out += "\r";
    else if (n === "u") {
      const hex = s.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return out;
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 5;
      continue;
    } else out += n;
    i++;
  }
  return out;
}

/** Extrai as strings já escritas (completas ou a meio) de um objeto JSON ainda em geração. */
export function partialJsonStrings(raw: string, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const m = new RegExp(`"${key}"\\s*:\\s*"`).exec(raw);
    if (!m) continue;
    out[key] = readJsonString(raw, m.index + m[0].length);
  }
  return out;
}
