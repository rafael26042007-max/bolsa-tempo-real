/* =========================================================
   ALERTAS DE PREÇO
   ---------------------------------------------------------
   "Me avisa quando a PETR4 passar de R$ 45" ou "quando a
   Apple cair 3% no dia".
   • 4 tipos: preço acima de, preço abaixo de, alta do dia ≥ X%,
     queda do dia ≥ X%.
   • Dispara uma vez só: aparece um aviso na tela, uma notificação
     do sistema (se você permitir), um som e o título da aba pisca.
   • Fica salvo no navegador (localStorage).
   Usa os ganchos do app.js: init, price, cardCreated, card,
   detailOpen e detail.
   ========================================================= */
"use strict";

/* ---------- 1. Dados ---------- */
const STORAGE_ALERTS = "pregao.alerts";

const ALERT_TYPES = {
  above: { label: "Preço acima de", unit: "price" },
  below: { label: "Preço abaixo de", unit: "price" },
  up:    { label: "Alta do dia de pelo menos", unit: "pct" },
  down:  { label: "Queda do dia de pelo menos", unit: "pct" },
};

// Sempre lê do navegador: assim várias abas abertas enxergam a mesma lista
function getAlerts() { return load(STORAGE_ALERTS, {}); }
function setAlerts(all) { save(STORAGE_ALERTS, all); }
function alertsOf(symbol) { return getAlerts()[symbol] || []; }

// Preço na moeda ORIGINAL do ativo (alertas são guardados nela)
function fmtNative(v, symbol) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currencyOf(symbol), maximumFractionDigits: v < 10 ? 4 : 2 }).format(v);
}

function alertText(a, symbol) {
  const t = ALERT_TYPES[a.type];
  return t.unit === "pct"
    ? `${t.label} ${fmtNum(a.value)}%`
    : `${t.label} ${fmtNative(a.value, symbol)}`;
}

/* ---------- 2. Regra: a condição foi atingida? ---------- */
function dayPct(r) {
  return r.price != null && r.prevClose ? ((r.price - r.prevClose) / r.prevClose) * 100 : null;
}
function isHit(a, r) {
  if (r.price == null) return false;
  const pct = dayPct(r);
  switch (a.type) {
    case "above": return r.price >= a.value;
    case "below": return r.price <= a.value;
    case "up":    return pct != null && pct >= a.value;
    case "down":  return pct != null && pct <= -a.value;
  }
  return false;
}

/* ---------- 3. Disparo (aviso, notificação, som, título) ---------- */
let audioCtx = null;
function beep(force = false) {
  if (!force && state.prefs.sound === false) return; // [NOVO] som desligado nas Configurações
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [880, 1320].forEach((freq, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = freq; o.type = "sine";
      const t0 = audioCtx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0); o.stop(t0 + 0.17);
    });
  } catch { /* sem áudio: tudo bem */ }
}

async function systemNotify(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    // No celular (Android) só funciona pelo service worker do app (js/tema-pwa.js)
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg) reg.showNotification(title, { body, icon: "icons/icon-192.png", tag: title });
    else new Notification(title, { body, icon: "icons/icon-192.png" });
  } catch { /* ignorado */ }
}

let titleTimer = null;
function flashTitle(text) {
  const original = "Pregão — Bolsa em tempo real";
  let n = 0;
  clearInterval(titleTimer);
  titleTimer = setInterval(() => {
    document.title = n++ % 2 ? original : `🔔 ${text}`;
    if (n > 12) { clearInterval(titleTimer); document.title = original; }
  }, 900);
}

function fire(symbol, a, r) {
  const title = `🔔 ${displaySymbol(symbol)} — ${alertText(a, symbol)}`;
  const body = `Preço agora: ${fmtNative(r.price, symbol)}` +
    (dayPct(r) != null ? ` (${dayPct(r) >= 0 ? "+" : ""}${fmtNum(dayPct(r))}% no dia)` : "");
  toast(`${title} · ${body}`, 9000);
  systemNotify(title, body);
  beep();
  flashTitle(displaySymbol(symbol));
  const c = state.cards[symbol];
  if (c && c.flags) {
    c.flags.classList.remove("ring"); void c.flags.offsetWidth; c.flags.classList.add("ring");
  }
}

/* ---------- 4. Verificação a cada mudança de preço ---------- */
function checkAlerts(symbol) {
  if (!state.list.some((i) => i.symbol === symbol)) return; // prévia não dispara
  const r = state.data[symbol];
  if (!r || r.price == null) return;
  const all = getAlerts();
  const list = all[symbol];
  if (!list || !list.some((a) => a.active)) return;

  let changed = false;
  for (const a of list) {
    if (a.active && isHit(a, r)) {
      a.active = false;              // dispara uma vez só
      a.firedAt = Date.now();
      a.firedPrice = r.price;
      changed = true;
      fire(symbol, a, r);
    }
  }
  if (changed) {
    setAlerts(all);
    if (state.detail === symbol) renderAlertsSection(symbol);
    updateCardFlags(symbol);
  }
}

/* ---------- 5. Sino no card ---------- */
function updateCardFlags(symbol) {
  const c = state.cards[symbol];
  if (!c || !c.flags) return;
  const n = alertsOf(symbol).filter((a) => a.active).length;
  c.flags.hidden = n === 0;
  c.flags.title = `${n} alerta(s) ativo(s)`;
  c.flags.querySelector("span").textContent = n > 1 ? n : "";
}

on("cardCreated", (symbol, el) => {
  const flags = document.createElement("span");
  flags.className = "card-flags";
  flags.hidden = true;
  flags.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg><span></span>`;
  el.querySelector(".badge").before(flags);
  // as referências do card são criadas logo depois deste gancho
  setTimeout(() => { if (state.cards[symbol]) { state.cards[symbol].flags = flags; updateCardFlags(symbol); } });
});

/* ---------- 6. Seção "Alertas" no painel ---------- */
function renderAlertsSection(symbol) {
  const box = $("#d-alerts");
  if (state.preview) {
    box.innerHTML = `<h4>Alertas de preço</h4><p class="d-note">Adicione à sua lista para criar alertas.</p>`;
    return;
  }
  const list = alertsOf(symbol);
  const cur = currencyOf(symbol) === "BRL" ? "R$" : "US$";
  box.innerHTML = `
    <h4>Alertas de preço</h4>
    ${list.length ? `<ul class="alert-list">${list.map((a) => `
      <li class="${a.active ? "" : "fired"}">
        <span class="a-txt">${esc(alertText(a, symbol))}</span>
        <span class="a-meta">${a.active ? "ativo" : `disparou ${fmtTime(a.firedAt)}`}</span>
        ${a.active ? "" : `<button class="link-btn" data-reactivate="${a.id}">reativar</button>`}
        <button class="link-btn x" data-del="${a.id}" title="Excluir alerta" aria-label="Excluir alerta">✕</button>
      </li>`).join("")}</ul>` : ""}
    <form class="d-form" id="alert-form">
      <label>Quando
        <select id="alert-type">
          ${Object.entries(ALERT_TYPES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join("")}
        </select>
      </label>
      <label><span id="alert-unit">Valor (${cur})</span>
        <input id="alert-value" type="number" step="any" min="0" required placeholder="0,00" />
      </label>
      <button class="btn btn-primary btn-sm" type="submit">Criar alerta</button>
    </form>`;

  const typeSel = $("#alert-type");
  const valueIn = $("#alert-value");
  const unit = $("#alert-unit");
  const syncUnit = () => {
    const pct = ALERT_TYPES[typeSel.value].unit === "pct";
    unit.textContent = pct ? "Variação (%)" : `Valor (${cur})`;
    valueIn.placeholder = pct ? "3" : (state.data[symbol]?.price ? String(state.data[symbol].price.toFixed(2)) : "0,00");
  };
  typeSel.addEventListener("change", syncUnit);
  syncUnit();

  $("#alert-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const value = parseFloat(String(valueIn.value).replace(",", "."));
    if (!(value > 0)) { toast("Digite um valor maior que zero."); return; }
    const a = { id: Date.now().toString(36), type: typeSel.value, value, active: true, createdAt: Date.now() };
    const r = state.data[symbol];
    if (r && isHit(a, r)) {
      toast("Essa condição já é verdadeira agora — escolha outro valor.");
      return;
    }
    const all = getAlerts();
    (all[symbol] = all[symbol] || []).push(a);
    setAlerts(all);
    // pede permissão de notificação no primeiro alerta (precisa ser num clique)
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    // o navegador só libera som depois de um clique: já prepara o áudio aqui
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); } catch { /* sem áudio */ }
    toast("Alerta criado.");
    renderAlertsSection(symbol);
    updateCardFlags(symbol);
  });

  box.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
    const all = getAlerts();
    all[symbol] = (all[symbol] || []).filter((a) => a.id !== b.dataset.del);
    if (!all[symbol].length) delete all[symbol];
    setAlerts(all);
    renderAlertsSection(symbol);
    updateCardFlags(symbol);
  }));
  box.querySelectorAll("[data-reactivate]").forEach((b) => b.addEventListener("click", () => {
    const all = getAlerts();
    const a = (all[symbol] || []).find((x) => x.id === b.dataset.reactivate);
    if (!a) return;
    if (state.data[symbol] && isHit(a, state.data[symbol])) { toast("A condição ainda é verdadeira — mude o valor."); return; }
    a.active = true; delete a.firedAt;
    setAlerts(all);
    renderAlertsSection(symbol);
    updateCardFlags(symbol);
  }));
}

/* ---------- 7. Ligações com o app ---------- */
on("price", checkAlerts);
on("detailOpen", renderAlertsSection);
// Remove alertas de ativos que saíram da lista
function pruneAlerts() {
  const all = getAlerts();
  let changed = false;
  for (const s of Object.keys(all)) if (!state.list.some((i) => i.symbol === s)) { delete all[s]; changed = true; }
  if (changed) setAlerts(all);
}
on("listChanged", () => { pruneAlerts(); state.list.forEach((i) => updateCardFlags(i.symbol)); });
on("init", pruneAlerts);
