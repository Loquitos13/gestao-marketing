/* Protótipo: shell partilhado, ícones (Lucide), formatação e gráficos SVG. Dados fictícios. */

const ICONS = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  chevRight: '<path d="m9 18 6-6-6-6"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  share: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  note: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v6h6"/>',
  sparkle: '<path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="m5.6 5.6 2.1 2.1"/><path d="m16.3 16.3 2.1 2.1"/><path d="m5.6 18.4 2.1-2.1"/><path d="m16.3 7.7 2.1-2.1"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  link: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  grip: '<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
};

function icon(name, size = 15, extra = "") {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ${extra}>${ICONS[name] ?? ""}</svg>`;
}

/* ── Formatação pt-PT ─────────────────────────────── */
const nf = (d = 0) => new Intl.NumberFormat("pt-PT", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: "always" });
const eur = (v, d = 0) => `${nf(d).format(v)} €`;
const num = (v, d = 0) => nf(d).format(v);
const pct = (v, d = 1) => `${nf(d).format(v * 100)}%`;
const x = (v) => `${nf(2).format(v)}×`;
function deltaHtml(cur, prev, { invert = false, unit = "pct", neutral = false } = {}) {
  if (prev == null || prev === 0) return '<span class="delta flat">—</span>';
  const ch = unit === "pp" ? (cur - prev) * 100 : (cur - prev) / Math.abs(prev);
  const good = invert ? ch < 0 : ch > 0;
  const cls = neutral || Math.abs(ch) < (unit === "pp" ? 0.05 : 0.005) ? "flat" : good ? "up" : "down";
  const tiny = Math.abs(ch) < (unit === "pp" ? 0.05 : 0.0005);
  const sign = tiny ? "" : ch > 0 ? "+" : "−";
  const txt = unit === "pp" ? `${sign}${nf(1).format(Math.abs(ch))} p.p.` : `${sign}${nf(1).format(Math.abs(ch) * 100)}%`;
  return `<span class="delta ${cls}">${txt}</span>`;
}

/* ── Dados determinísticos ────────────────────────── */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function series(seed, n, base, vol = 0.18, trend = 0) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const dow = [0.86, 1.02, 1.05, 1.04, 1.0, 0.94, 0.82][i % 7];
    return Math.max(0, base * dow * (1 + trend * (i / n)) * (1 + (r() - 0.5) * vol));
  });
}
const DAYS = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 8, 1 + i)));
const dayLbl = (d) => `${d.getUTCDate()} set`;

/* ── Shell ─────────────────────────────────────────── */
const CLIENTS = [
  { k: "LA", name: "Loja Atlântico", on: true },
  { k: "CS", name: "Clínica Sorriso Porto" },
  { k: "HS", name: "Horizonte Software" },
];
const TABS = [
  ["index.html", "Visão geral"],
  ["google-ads.html", "Google Ads", '<span class="dot g"></span>'],
  ["meta-ads.html", "Meta Ads", '<span class="dot m"></span>'],
  ["#", "SEO", '<span class="dot s"></span>'],
  ["#", "Conteúdo"],
  ["#", "Orçamento"],
  ["divider"],
  ["relatorio.html", "Relatórios", "", "4"],
  ["#", "Tarefas", "", "7"],
  ["#", "Notas"],
  ["#", "Ficheiros"],
  ["#", "Atividade"],
];

function renderShell(active, { actions = "" } = {}) {
  const side = `
  <aside class="side">
    <div class="org"><div class="logo">M</div><b>Marketing Hub</b><span class="muted" style="margin-left:auto">${icon("chevDown", 14)}</span></div>
    <div class="search">${icon("search", 14)}<span>Procurar</span><kbd>Ctrl K</kbd></div>
    <nav class="nav">
      <a href="#">${icon("home")}Início</a>
      <a href="#">${icon("users")}Clientes<span class="count">3</span></a>
      <a href="#">${icon("bell")}Alertas<span class="count alert">5</span></a>
      <a href="#">${icon("file")}Relatórios</a>
      <a href="#">${icon("plug")}Integrações</a>
      <a href="#">${icon("settings")}Definições</a>
    </nav>
    <h6>Workspaces de clientes</h6>
    <nav class="nav">
      ${CLIENTS.map((c) => `<a href="index.html" class="${c.on ? "on" : ""}"><span class="cl-dot">${c.k}</span>${c.name}</a>`).join("")}
      <a href="#" class="muted">${icon("plus", 14)}Novo cliente</a>
    </nav>
    <div class="side-foot">
      <div class="row"><span class="pulse"></span>Sincronização ativa · há 4 min</div>
      <div class="row"><span class="avatar">DP</span><span class="fg2">Diogo Pinto</span><span style="margin-left:auto">Proprietário</span></div>
    </div>
  </aside>`;

  const tabs = TABS.map(([href, label, pre = "", badge]) =>
    href === "divider" ? '<span class="divider"></span>' : `<a href="${href}" class="${label === active ? "on" : ""}">${pre}${label}${badge ? `<span class="badge">${badge}</span>` : ""}</a>`,
  ).join("");

  const head = `
  <header class="client-head">
    <div class="crumbs">Clientes ${icon("chevRight", 12)} <span class="fg2">Loja Atlântico</span></div>
    <div class="head-row">
      <div class="c-avatar">LA</div>
      <div>
        <h1>Loja Atlântico</h1>
        <div class="head-meta"><span>E-commerce · Moda</span><span class="sep"></span><span>EUR</span><span class="sep"></span><span>Europe/Lisbon</span><span class="sep"></span><span>Gestor: Diogo Pinto</span><span class="pill sim">Dados simulados</span></div>
      </div>
      <div class="head-actions">
        ${actions}
      </div>
    </div>
    <nav class="tabs">${tabs}</nav>
  </header>`;

  document.body.insertAdjacentHTML("afterbegin", `<div class="app">${side}<main class="main">${head}<div class="page" id="page"></div></main></div>`);
  return document.getElementById("page");
}

const periodControls = `
  <button class="btn">${icon("calendar", 14)}1 – 30 set 2026<span class="cap">vs 2 – 31 ago</span>${icon("chevDown", 13)}</button>
  <div class="seg"><button class="on">Período anterior</button><button>Ano anterior</button></div>`;

/* ── Gráficos SVG ──────────────────────────────────── */
function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / p / 2) * 2 * p;
}
function spark(values, prev, { w = 160, h = 26, color = "var(--fg)" } = {}) {
  const all = values.concat(prev || []);
  const max = Math.max(...all), min = Math.min(...all);
  const pt = (arr) => arr.map((v, i) => `${(i / (arr.length - 1)) * w},${h - 2 - ((v - min) / (max - min || 1)) * (h - 4)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="100%" height="${h}">
    ${prev ? `<polyline points="${pt(prev)}" fill="none" stroke="var(--fg-4)" stroke-width="1" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>` : ""}
    <polyline points="${pt(values)}" fill="none" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}

/** Barras empilhadas por dia + linha opcional (eixo direito). */
function comboChart({ labels, bars, line, h = 220, yFmt = (v) => v, y2Fmt = (v) => v }) {
  const W = 900, H = h, L = 48, R = line ? 52 : 12, T = 10, B = 24;
  const iw = W - L - R, ih = H - T - B;
  const totals = labels.map((_, i) => bars.reduce((s, b) => s + b.values[i], 0));
  const yMax = niceMax(Math.max(...totals));
  const y2Max = line ? niceMax(Math.max(...line.values)) : 1;
  const bw = (iw / labels.length) * 0.5;
  let out = "";
  for (let g = 0; g <= 4; g++) {
    const y = T + ih - (g / 4) * ih;
    out += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--border)" stroke-width="1"/>`;
    out += `<text x="${L - 8}" y="${y + 3.5}" text-anchor="end">${yFmt((yMax * g) / 4)}</text>`;
    if (line) out += `<text x="${W - R + 8}" y="${y + 3.5}">${y2Fmt((y2Max * g) / 4)}</text>`;
  }
  labels.forEach((lb, i) => {
    const cx = L + (i + 0.5) * (iw / labels.length);
    let acc = 0;
    bars.forEach((b) => {
      const v = b.values[i], bh = (v / yMax) * ih;
      out += `<rect x="${cx - bw / 2}" y="${T + ih - acc - bh}" width="${bw}" height="${Math.max(0, bh - 1)}" fill="${b.color}" rx="1"/>`;
      acc += bh;
    });
    if (i % 5 === 0 || i === labels.length - 1) out += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${lb}</text>`;
  });
  if (line) {
    const pts = line.values.map((v, i) => `${L + (i + 0.5) * (iw / labels.length)},${T + ih - (v / y2Max) * ih}`).join(" ");
    out += `<polyline points="${pts}" fill="none" stroke="${line.color}" stroke-width="1.75"/>`;
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" height="${H}">${out}</svg>`;
}

/** Linhas simples (atual vs anterior). */
function lineChart({ labels, lines, h = 200, yFmt = (v) => v }) {
  const W = 900, H = h, L = 48, R = 12, T = 10, B = 24, iw = W - L - R, ih = H - T - B;
  const yMax = niceMax(Math.max(...lines.flatMap((l) => l.values)));
  let out = "";
  for (let g = 0; g <= 4; g++) {
    const y = T + ih - (g / 4) * ih;
    out += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--border)"/><text x="${L - 8}" y="${y + 3.5}" text-anchor="end">${yFmt((yMax * g) / 4)}</text>`;
  }
  labels.forEach((lb, i) => {
    if (i % 5 === 0 || i === labels.length - 1) out += `<text x="${L + (i / (labels.length - 1)) * iw}" y="${H - 6}" text-anchor="middle">${lb}</text>`;
  });
  lines.forEach((l) => {
    const pts = l.values.map((v, i) => `${L + (i / (l.values.length - 1)) * iw},${T + ih - (v / yMax) * ih}`).join(" ");
    out += `<polyline points="${pts}" fill="none" stroke="${l.color}" stroke-width="${l.dash ? 1.25 : 1.75}" ${l.dash ? 'stroke-dasharray="4 3"' : ""}/>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" height="${H}">${out}</svg>`;
}

function hbars(rows, { fmt = (v) => v, color = "var(--fg-2)" } = {}) {
  const max = Math.max(...rows.map((r) => r.v));
  return rows.map((r) => `
    <div style="display:grid;grid-template-columns:110px 1fr 70px;gap:10px;align-items:center;padding:5px 0">
      <span class="fg2">${r.l}</span>
      <span style="height:8px;background:var(--hover);border-radius:2px;overflow:hidden"><i style="display:block;height:100%;width:${(r.v / max) * 100}%;background:${r.c || color}"></i></span>
      <span class="num" style="text-align:right">${fmt(r.v)}</span>
    </div>`).join("");
}

const infoTip = (t) => `<span class="info" title="${t}">${icon("info", 12)}</span>`;
function kpiTile({ label, value, unit = "", prev, delta, formula, sparkCur, sparkPrev, na }) {
  if (na) return `<div class="kpi na"><div class="lbl">${label}${infoTip(formula || "")}</div><div class="val">Não disponível</div><div class="cmp">${na}</div></div>`;
  return `<div class="kpi"><div class="lbl">${label}${infoTip(formula || "")}</div>
    <div class="val">${value}${unit ? `<small>${unit}</small>` : ""}</div>
    <div class="cmp">${delta}<span>vs ${prev}</span></div>
    ${sparkCur ? `<div class="spark">${spark(sparkCur, sparkPrev)}</div>` : ""}</div>`;
}
