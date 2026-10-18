/** Leitura de robots.txt (RFC 9309): grupo do nosso user-agent ou "*", regra mais longa vence, Allow vence empates. */
export interface RobotsRules {
  rules: { allow: boolean; pattern: string }[];
  crawlDelaySec: number | null;
  sitemaps: string[];
  /** robots.txt inacessível por erro do servidor: assume-se que nada pode ser rastreado. */
  disallowAll?: boolean;
}

export const ALLOW_ALL: RobotsRules = { rules: [], crawlDelaySec: null, sitemaps: [] };
export const DISALLOW_ALL: RobotsRules = { rules: [], crawlDelaySec: null, sitemaps: [], disallowAll: true };

export function parseRobots(txt: string, userAgentToken: string): RobotsRules {
  type Group = { agents: string[]; rules: RobotsRules["rules"]; delay: number | null };
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [], delay: null }));
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "allow" || key === "disallow") {
      if (value) cur.rules.push({ allow: key === "allow", pattern: value });
    } else if (key === "crawl-delay") {
      const d = Number(value);
      if (Number.isFinite(d) && d >= 0) cur.delay = d;
    }
  }
  const token = userAgentToken.toLowerCase();
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  return { rules: chosen.flatMap((g) => g.rules), crawlDelaySec: chosen.find((g) => g.delay !== null)?.delay ?? null, sitemaps };
}

function toRegex(pattern: string) {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

export function isAllowed(r: RobotsRules, pathWithQuery: string): boolean {
  if (r.disallowAll) return false;
  if (pathWithQuery === "/robots.txt") return true;
  let best: { allow: boolean; len: number } | null = null;
  for (const rule of r.rules) {
    if (!toRegex(rule.pattern).test(pathWithQuery)) continue;
    const len = rule.pattern.length;
    if (!best || len > best.len || (len === best.len && rule.allow)) best = { allow: rule.allow, len };
  }
  return best ? best.allow : true;
}
