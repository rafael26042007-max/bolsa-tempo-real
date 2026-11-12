/* =========================================================
   MINHA CARTEIRA
   ---------------------------------------------------------
   Você informa quantas ações tem e o preço médio que pagou.
   O app mostra:
   • no card: quantidade e quanto está ganhando/perdendo;
   • no painel: valor atual, resultado total e resultado do dia;
   • no topo da lista: o resumo da carteira inteira, somando
     ações dos EUA, da B3 e cripto na mesma moeda.
   O preço médio fica guardado na moeda ORIGINAL do ativo
   (US$ para EUA e cripto, R$ para B3).
   Usa os ganchos: init, price, cardCreated, card, detailOpen,
   detail e listChanged.
   ========================================================= */
"use strict";

/* ---------- 1. Dados ---------- */
const STORAGE_PORTFOLIO = "pregao.portfolio";
let portfolio = load(STORAGE_PORTFOLIO, {}); // symbol → { qty, avg }

function savePortfolio() { save(STORAGE_PORTFOLIO, portfolio); }
function positionOf(symbol) {
  const p = portfolio[symbol];
  return p && p.qty > 0 ? p : null;
}

/* ---------- 2. Contas ---------- */
// Resultado de uma posição, na moeda original do ativo
function calcPosition(symbol) {
  const p = positionOf(symbol);
  const r = state.data[symbol];
  if (!p || !r || r.price == null) return null;
  const value = p.qty * r.price;
  const cost = p.qty * p.avg;
  const day = r.prevClose ? p.qty * (r.price - r.prevClose) : 0;
  return {
    value, cost, day,
    total: value - cost,
    totalPct: cost ? ((value - cost) / cost) * 100 : 0,
    dayPct: r.prevClose ? ((r.price - r.prevClose) / r.prevClose) * 100 : 0,
  };
}

// Converte entre duas moedas usando o câmbio carregado em app.js (state.fx)
function convertBetween(v, from, to) {
  if (from === to) return v;
  if (!state.fx[from] || !state.fx[to]) return null;
  return (v / state.fx[from]) * state.fx[to];
}
function fmtIn(v, currency) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);
}
function signed(v, currency) {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtIn(Math.abs(v), currency)}`;
}
function signedPct(v) {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtNum(Math.abs(v))}%`;
}
const cls = (v) => (v > 0 ? "txt-up" : v < 0 ? "txt-down" : "muted");
function fmtQty(q, symbol) {
  const unit = providerOf(symbol) === "crypto" ? displaySymbol(symbol).split("/")[0] : (q === 1 ? "ação" : "ações");
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 8 }).format(q)} ${unit}`;
}

/* ---------- 3. Resumo da carteira (topo da lista) ---------- */
let summaryTimer = null;
function scheduleSummary() {               // no máximo 2x por segundo
  if (summaryTimer) return;
  summaryTimer = setTimeout(() => { summaryTimer = null; renderSummary(); }, 500);
}

function renderSummary() {
  const box = $("#portfolio-summary");
  const symbols = state.list.map((i) => i.symbol).filter((s) => positionOf(s));
  if (!symbols.length) { box.hidden = true; return; }

  // Moeda do resumo: a escolhida no topo; em "Moeda original" soma tudo em reais
  let cur = state.currency === "orig" ? "BRL" : state.currency;
  let value = 0, cost = 0, day = 0, missing = 0;
  for (const s of symbols) {
    const c = calcPosition(s);
    if (!c) { missing++; continue; }
    const from = currencyOf(s);
    const v = convertBetween(c.value, from, cur);
    if (v == null) { missing++; continue; }      // câmbio ainda não carregou
    value += v;
    cost += convertBetween(c.cost, from, cur);
    day += convertBetween(c.day, from, cur);
  }
  const total = value - cost;
  const totalPct = cost ? (total / cost) * 100 : 0;
  const dayPct = value - day ? (day / (value - day)) * 100 : 0;

  box.hidden = false;
  box.innerHTML = `
    <div class="ps-title"><b>Minha carteira</b><span class="muted small">${symbols.length} ativo(s)${missing ? ` · ${missing} aguardando preço` : ""}</span></div>
    <div><div class="ps-label">Valor atual</div><div class="ps-value">${fmtIn(value, cur)}</div><div class="ps-sub muted">investido ${fmtIn(cost, cur)}</div></div>
    <div><div class="ps-label">Resultado hoje</div><div class="ps-value ${cls(day)}">${signed(day, cur)}</div><div class="ps-sub ${cls(day)}">${signedPct(dayPct)}</div></div>
    <div><div class="ps-label">Resultado total</div><div class="ps-value ${cls(total)}">${signed(total, cur)}</div><div class="ps-sub ${cls(total)}">${signedPct(totalPct)}</div></div>`;
}

/* ---------- 4. Linha da posição no card ---------- */
on("cardCreated", (symbol, el) => {
  const row = document.createElement("div");
  row.className = "card-pos";
  row.hidden = true;
  el.querySelector(".card-foot").before(row);
});

on("card", (symbol, c) => {
  const row = c.el.querySelector(".card-pos");
  if (!row) return;
  const p = positionOf(symbol);
  const calc = calcPosition(symbol);
  row.hidden = !p;
  if (!p) return;
  row.innerHTML = calc
    ? `<span>${fmtQty(p.qty, symbol)}</span><span class="mono ${cls(calc.total)}">${calc.total >= 0 ? "+" : "−"}${fmtPrice(Math.abs(calc.total), symbol)} (${signedPct(calc.totalPct)})</span>`
    : `<span>${fmtQty(p.qty, symbol)}</span><span class="muted">aguardando preço</span>`;
});

/* ---------- 5. Seção "Minha posição" no painel ---------- */
function renderPositionSection(symbol) {
  const box = $("#d-position");
  if (state.preview) {
    box.innerHTML = `<h4>Minha posição</h4><p class="d-note">Adicione à sua lista para registrar quantas você tem.</p>`;
    return;
  }
  const p = portfolio[symbol] || {};
  const cur = currencyOf(symbol) === "BRL" ? "R$" : "US$";
  box.innerHTML = `
    <h4>Minha posição ${positionOf(symbol) ? `<button class="link-btn x" id="pos-clear" title="Apagar posição">apagar</button>` : ""}</h4>
    <form class="d-form" id="pos-form">
      <label>Quantidade
        <input id="pos-qty" type="number" step="any" min="0" value="${p.qty ?? ""}" placeholder="${providerOf(symbol) === "crypto" ? "0,05" : "100"}" />
      </label>
      <label>Preço médio (${cur})
        <input id="pos-avg" type="number" step="any" min="0" value="${p.avg ?? ""}" placeholder="${state.data[symbol]?.price?.toFixed(2) ?? "0,00"}" />
      </label>
      <button class="btn btn-primary btn-sm" type="submit">Salvar</button>
    </form>
    <dl class="kv" id="pos-kv"></dl>`;

  $("#pos-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const qty = parseFloat(String($("#pos-qty").value).replace(",", "."));
    const avg = parseFloat(String($("#pos-avg").value).replace(",", "."));
    if (!(qty > 0) || !(avg > 0)) { toast("Preencha quantidade e preço médio maiores que zero."); return; }
    portfolio[symbol] = { qty, avg };
    savePortfolio();
    toast("Posição salva.");
    renderPositionSection(symbol);
    refreshAll();
  });
  const clear = $("#pos-clear");
  if (clear) clear.addEventListener("click", () => {
    delete portfolio[symbol];
    savePortfolio();
    renderPositionSection(symbol);
    refreshAll();
  });
  updatePositionValues(symbol);
}

// Só os números (não redesenha o formulário enquanto você digita)
function updatePositionValues(symbol) {
  const kv = $("#pos-kv");
  if (!kv) return;
  const c = calcPosition(symbol);
  if (!positionOf(symbol) || !c) { kv.hidden = true; return; }
  kv.hidden = false;
  const money = (v) => `${v >= 0 ? "+" : "−"}${fmtPrice(Math.abs(v), symbol)}`;
  kv.innerHTML = `
    <div><dt>Valor atual</dt><dd>${fmtPrice(c.value, symbol)}</dd></div>
    <div><dt>Investido</dt><dd>${fmtPrice(c.cost, symbol)}</dd></div>
    <div><dt>Resultado total</dt><dd class="${cls(c.total)}">${money(c.total)} (${signedPct(c.totalPct)})</dd></div>
    <div><dt>Resultado hoje</dt><dd class="${cls(c.day)}">${money(c.day)} (${signedPct(c.dayPct)})</dd></div>`;
}

function refreshAll() {
  state.list.forEach((i) => markDirty(i.symbol));
  scheduleSummary();
}

/* ---------- 6. Ligações com o app ---------- */
on("detailOpen", renderPositionSection);
on("detail", updatePositionValues);
on("price", scheduleSummary);
on("listChanged", () => {
  // posição de ativo removido da lista é apagada junto
  let changed = false;
  for (const s of Object.keys(portfolio)) if (!state.list.some((i) => i.symbol === s)) { delete portfolio[s]; changed = true; }
  if (changed) savePortfolio();
  scheduleSummary();
});
on("init", () => {
  portfolio = load(STORAGE_PORTFOLIO, {});
  scheduleSummary();
  // outra aba mudou a carteira? atualiza esta também
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_PORTFOLIO) { portfolio = load(STORAGE_PORTFOLIO, {}); refreshAll(); }
  });
});
