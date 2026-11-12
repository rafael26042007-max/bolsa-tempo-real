/* =========================================================
   ORGANIZAR A LISTA: filtrar, ordenar e arrastar
   ---------------------------------------------------------
   • Filtro: Todos, EUA, B3, Cripto ou só o que está na carteira.
   • Ordem: a sua (arrastando os cards), maior alta, maior queda,
     nome ou maior posição na carteira.
   • A escolha fica salva no navegador.
   Usa os ganchos: init, price, cardCreated e listChanged.
   Usa positionOf/calcPosition/convertBetween de js/carteira.js.
   ========================================================= */
"use strict";

/* ---------- 1. Preferências ---------- */
const STORAGE_VIEW = "pregao.listview";
const view = { filter: "all", sort: "manual", ...load(STORAGE_VIEW, {}) };
function saveView() { save(STORAGE_VIEW, view); }

/* ---------- 2. Regras de filtro e ordem ---------- */
function passesFilter(symbol) {
  if (view.filter === "all") return true;
  if (view.filter === "pos") return !!positionOf(symbol);
  return providerOf(symbol) === view.filter;
}

function dayChangePct(symbol) {
  const r = state.data[symbol];
  return r && r.price != null && r.prevClose ? ((r.price - r.prevClose) / r.prevClose) * 100 : null;
}

// Valor da posição em dólar (para comparar ativos de moedas diferentes)
function positionUsd(symbol) {
  const c = calcPosition(symbol);
  return c ? convertBetween(c.value, currencyOf(symbol), "USD") ?? c.value : -1;
}

function orderedSymbols() {
  const syms = state.list.map((i) => i.symbol);       // "Minha ordem" = ordem da lista salva
  const nameOf = (s) => (state.list.find((i) => i.symbol === s)?.name || displaySymbol(s)).toLowerCase();
  const byPct = (dir) => (a, b) => {
    const pa = dayChangePct(a), pb = dayChangePct(b);
    if (pa == null) return 1;                          // sem preço vai pro fim
    if (pb == null) return -1;
    return dir * (pb - pa);
  };
  switch (view.sort) {
    case "gain":  return syms.sort(byPct(1));
    case "loss":  return syms.sort(byPct(-1));
    case "name":  return syms.sort((a, b) => nameOf(a).localeCompare(nameOf(b), "pt-BR"));
    case "value": return syms.sort((a, b) => positionUsd(b) - positionUsd(a));
    default:      return syms;
  }
}

/* ---------- 3. Aplica na tela ---------- */
function applyView() {
  const wrap = $("#watchlist");
  const order = orderedSymbols();
  let visible = 0;

  // Só mexe no DOM se a ordem realmente mudou (evita "piscar")
  const current = [...wrap.children].map((el) => el.dataset.symbol);
  if (order.join("|") !== current.join("|")) {
    order.forEach((s) => { const c = state.cards[s]; if (c) wrap.appendChild(c.el); });
  }
  for (const s of order) {
    const c = state.cards[s];
    if (!c) continue;
    const show = passesFilter(s);
    c.el.hidden = !show;
    c.el.draggable = view.sort === "manual";
    if (show) visible++;
  }
  $("#filter-empty").hidden = !(state.list.length && !visible);

  document.querySelectorAll("#list-filter button").forEach((b) => b.classList.toggle("on", b.dataset.f === view.filter));
  $("#list-sort").value = view.sort;
}

// Com "maior alta/queda" a ordem muda com o preço: reordena no máximo a cada 3 s
let reorderTimer = null;
function scheduleReorder() {
  if (reorderTimer) return;
  reorderTimer = setTimeout(() => { reorderTimer = null; applyView(); }, 3000);
}

/* ---------- 4. Arrastar e soltar (só em "Minha ordem") ---------- */
let dragging = null;

function clearDropMarks() {
  document.querySelectorAll(".drop-before, .drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
}

on("cardCreated", (symbol, el) => {
  el.dataset.symbol = symbol;
  el.draggable = view.sort === "manual";

  el.addEventListener("dragstart", (e) => {
    if (view.sort !== "manual") { e.preventDefault(); return; }
    dragging = symbol;
    el.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", symbol);
  });
  el.addEventListener("dragend", () => { dragging = null; el.classList.remove("dragging"); clearDropMarks(); });

  el.addEventListener("dragover", (e) => {
    if (!dragging || dragging === symbol) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;   // metade direita = depois
    clearDropMarks();
    el.classList.add(after ? "drop-after" : "drop-before");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drop-before", "drop-after"));

  el.addEventListener("drop", (e) => {
    e.preventDefault();
    if (!dragging || dragging === symbol) return;
    const after = el.classList.contains("drop-after");
    clearDropMarks();
    const from = state.list.findIndex((i) => i.symbol === dragging);
    const [moved] = state.list.splice(from, 1);
    let to = state.list.findIndex((i) => i.symbol === symbol);
    if (after) to++;
    state.list.splice(to, 0, moved);
    save(STORAGE_LIST, state.list);                       // salva a nova ordem
    applyView();
  });
});

/* ---------- 5. Ligações com o app ---------- */
on("init", () => {
  $("#list-filter").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-f]");
    if (!b) return;
    view.filter = b.dataset.f;
    saveView();
    applyView();
  });
  $("#list-sort").addEventListener("change", (e) => {
    view.sort = e.target.value;
    saveView();
    applyView();
  });
  applyView();
});
on("listChanged", applyView);
on("price", () => {
  if (view.sort !== "manual" && view.sort !== "name") scheduleReorder();
  if (view.filter === "pos") scheduleReorder();
});
