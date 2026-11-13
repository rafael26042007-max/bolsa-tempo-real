/* =========================================================
   CONFIGURAÇÕES (janela com abas)
   ---------------------------------------------------------
   1. Chaves de API  → mostrar/ocultar, testar cada chave.
                       O botão "Salvar e conectar" é tratado no app.js.
   2. Aparência      → tema, moeda, layout compacto, mini-gráficos,
                       piscar preço, atalhos da busca.
   3. Atualização    → status do ao vivo, reconectar, intervalo da B3,
                       uso das APIs.
   4. Alertas        → som, notificações do sistema, todos os alertas.
   5. Dados e backup → exportar/importar, limpar cache, apagar tudo.
   6. Sobre          → versão, fontes de dados e atalhos.
   As abas 2 a 5 salvam na hora, sem botão de salvar.
   ========================================================= */
"use strict";

const APP_VERSION = "2.0 · novembro de 2026";
const STORAGE_PREFS = "pregao.prefs";

function savePrefs() { save(STORAGE_PREFS, state.prefs); }
function flashSaved() { toast("Preferência salva.", 1400); }

/* ---------- 1. Abrir, fechar e trocar de aba ---------- */
function showTab(tab) {
  document.querySelectorAll("#settings-nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  document.querySelectorAll(".settings-content > section").forEach((s) => (s.hidden = s.dataset.panel !== tab));
  // cada aba atualiza o que mostra quando é aberta
  ({ update: refreshUpdateTab, alerts: refreshAlertsTab, data: refreshDataTab, look: refreshLookTab }[tab] || (() => {}))();
}

/* ---------- 2. Aba Chaves: mostrar/ocultar e testar ---------- */
function setKeyStatus(name, ok, text) {
  const el = $(`#status-${name}`);
  el.className = `key-status ${ok === true ? "ok" : ok === false ? "bad" : ""}`;
  el.textContent = text;
}

async function testKey(name) {
  const key = $(`#${{ finnhub: "finnhub-key", brapi: "brapi-key", twelve: "twelve-key" }[name]}`).value.trim();
  if (!key) { setKeyStatus(name, false, "Cole a chave antes de testar."); return; }
  setKeyStatus(name, null, "Testando…");
  try {
    if (name === "finnhub") {
      const res = await fetch(`${FINNHUB_REST}/quote?symbol=AAPL&token=${encodeURIComponent(key)}`);
      if (res.status === 401 || res.status === 403) return setKeyStatus(name, false, "✗ Chave inválida.");
      if (res.status === 429) return setKeyStatus(name, null, "Chave aceita, mas o limite por minuto foi atingido. Tente em 1 min.");
      const j = await res.json();
      setKeyStatus(name, j.c > 0, j.c > 0 ? `✓ Funcionando — Apple agora: US$ ${fmtNum(j.c)}` : "✗ A chave não retornou dados.");
    } else if (name === "brapi") {
      if (Date.now() < brapiPausedUntil) return setKeyStatus(name, null, `A brapi pediu uma pausa — teste em ${brapiPauseLeft()} min.`);
      const res = await fetch(`${BRAPI}/quote/BBAS3?token=${encodeURIComponent(key)}`); // BBAS3 não é de teste: exige token
      if (res.status === 401 || res.status === 403) return setKeyStatus(name, false, "✗ Token inválido.");
      if (res.status === 429) return setKeyStatus(name, null, "Token aceito, mas o limite foi atingido agora. Tente mais tarde.");
      const j = await res.json();
      const q = j.results && j.results[0];
      setKeyStatus(name, !!q, q ? `✓ Funcionando — BBAS3: R$ ${fmtNum(q.regularMarketPrice)}` : "✗ O token não retornou dados.");
    } else {
      const res = await fetch(`${TWELVE}/api_usage?apikey=${encodeURIComponent(key)}`);
      const j = await res.json();
      if (j.status === "error" || j.code) return setKeyStatus(name, false, `✗ ${j.code === 401 ? "Chave inválida." : j.message || "Erro."}`);
      setKeyStatus(name, true, `✓ Funcionando — usados hoje: ${j.daily_usage ?? j.current_usage ?? "?"} de ${j.plan_daily_limit ?? j.plan_limit ?? "?"} pedidos.`);
    }
  } catch {
    setKeyStatus(name, false, "✗ Sem resposta (internet, bloqueio de rede ou extensão do navegador).");
  }
}

/* ---------- 3. Aba Aparência ---------- */
function applyLookPrefs() {
  document.body.classList.toggle("compact", !!state.prefs.compact);
  document.body.classList.toggle("no-spark", !state.prefs.spark);
  $("#quick-chips").hidden = !state.prefs.chips;
}

function refreshLookTab() {
  const pref = typeof themePref === "function" ? themePref() : "system";
  document.querySelectorAll("#set-theme button").forEach((b) => b.classList.toggle("on", b.dataset.v === pref));
  const main = $("#currency-select");
  const sel = $("#set-currency");
  sel.innerHTML = main.innerHTML;          // mesmas opções do seletor do topo
  sel.value = main.value;
  $("#set-compact").checked = !!state.prefs.compact;
  $("#set-spark").checked = !!state.prefs.spark;
  $("#set-flash").checked = !!state.prefs.flash;
  $("#set-chips").checked = !!state.prefs.chips;
  $("#set-appmode").checked = state.prefs.appMode !== false; // [NOVO]
  $("#set-appmode-info").textContent = isInstalledApp()
    ? "Você está no app instalado: F12, Ctrl+Shift+I, Ctrl+U e o botão direito ficam bloqueados. Desligue quando for programar."
    : "Vale só no app instalado (agora você está no navegador, então nada é bloqueado aqui).";
}

function bindLookTab() {
  $("#set-theme").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    setThemePref(b.dataset.v);
    refreshLookTab();
  });
  $("#set-currency").addEventListener("change", (e) => {
    const main = $("#currency-select");
    main.value = e.target.value;
    main.dispatchEvent(new Event("change"));  // reaproveita a lógica do app.js
    flashSaved();
  });
  const toggles = { "set-compact": "compact", "set-spark": "spark", "set-flash": "flash", "set-chips": "chips", "set-appmode": "appMode" }; // [ALTERADO] + appMode
  for (const [id, key] of Object.entries(toggles)) {
    $(`#${id}`).addEventListener("change", (e) => {
      state.prefs[key] = e.target.checked;
      savePrefs();
      applyLookPrefs();
      redrawAll();
      flashSaved();
    });
  }
}

/* ---------- 4. Aba Atualização ---------- */
function refreshUpdateTab() {
  const info = $("#set-live-info");
  if (!state.config.finnhubKey) info.textContent = "Sem chave da Finnhub.";
  else if (isLive()) info.textContent = live.leader ? "Conectado — esta aba recebe os preços ao vivo." : "Conectado — recebendo de outra aba aberta do Pregão.";
  else info.textContent = live.failures >= 3 ? "Sem tempo real — atualizando a cada 15 s." : "Conectando…";
  $("#set-b3poll").value = String(state.prefs.b3PollMin || 2);
}

function bindUpdateTab() {
  $("#set-reconnect").addEventListener("click", () => {
    live.failures = 0; live.warned = false; state.wsRetry = 0;
    if (live.leader) connectWS(); else startLive();
    toast("Reconectando…");
    setTimeout(refreshUpdateTab, 2500);
  });
  $("#set-b3poll").addEventListener("change", (e) => {
    state.prefs.b3PollMin = parseInt(e.target.value, 10);
    savePrefs();
    startTimers();                            // reinicia os timers com o novo intervalo
    flashSaved();
  });
  $("#set-usage-btn").addEventListener("click", async () => {
    const out = $("#set-usage");
    const parts = [];
    if (state.config.twelveKey) {
      try {
        const j = await (await fetch(`${TWELVE}/api_usage?apikey=${encodeURIComponent(state.config.twelveKey)}`)).json();
        parts.push(`Twelve Data: ${j.daily_usage ?? j.current_usage ?? "?"} de ${j.plan_daily_limit ?? j.plan_limit ?? "?"} hoje`);
      } catch { parts.push("Twelve Data: sem resposta"); }
    }
    parts.push(Date.now() < brapiPausedUntil ? `brapi: em pausa por ${brapiPauseLeft()} min` : "brapi: liberada");
    parts.push("Finnhub: até 60 pedidos/min (sem contador público)");
    out.textContent = parts.join(" · ");
  });
}

/* ---------- 5. Aba Alertas ---------- */
function refreshAlertsTab() {
  $("#set-sound").checked = state.prefs.sound !== false;
  const info = $("#set-notif-info");
  const allow = $("#set-notif-allow");
  if (!("Notification" in window)) { info.textContent = "Este navegador não suporta notificações."; allow.hidden = true; }
  else {
    const p = Notification.permission;
    info.textContent = p === "granted" ? "Permitidas ✓" : p === "denied"
      ? "Bloqueadas. Libere no cadeado ao lado do endereço do site." : "Ainda não permitidas.";
    allow.hidden = p !== "default";
  }

  // todos os alertas de todos os ativos
  const all = getAlerts();
  const rows = [];
  for (const [symbol, list] of Object.entries(all))
    for (const a of list) rows.push({ symbol, a });
  $("#set-alert-list").innerHTML = rows.length ? rows.map(({ symbol, a }) => `
    <li class="${a.active ? "" : "fired"}">
      <b class="mono">${esc(displaySymbol(symbol))}</b>
      <span class="a-txt">${esc(alertText(a, symbol))}</span>
      <span class="a-meta">${a.active ? "ativo" : `disparou ${fmtTime(a.firedAt)}`}</span>
      <button class="link-btn x" data-s="${esc(symbol)}" data-id="${a.id}" aria-label="Excluir">✕</button>
    </li>`).join("") : `<li class="d-note" style="border:0">Nenhum alerta. Crie no painel de cada ativo.</li>`;
}

function bindAlertsTab() {
  $("#set-sound").addEventListener("change", (e) => { state.prefs.sound = e.target.checked; savePrefs(); flashSaved(); });
  $("#set-sound-test").addEventListener("click", () => beep(true));
  $("#set-notif-allow").addEventListener("click", async () => { await Notification.requestPermission(); refreshAlertsTab(); });
  $("#set-notif-test").addEventListener("click", () => {
    if (!("Notification" in window) || Notification.permission !== "granted") { toast("Permita as notificações primeiro."); return; }
    systemNotify("🔔 Pregão — teste", "Assim aparece quando um alerta disparar.");
  });
  $("#set-alert-list").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]");
    if (!b) return;
    const all = getAlerts();
    all[b.dataset.s] = (all[b.dataset.s] || []).filter((a) => a.id !== b.dataset.id);
    if (!all[b.dataset.s].length) delete all[b.dataset.s];
    setAlerts(all);
    updateCardFlags(b.dataset.s);
    refreshAlertsTab();
  });
}

/* ---------- 6. Aba Dados e backup ---------- */
const CACHE_KEYS = ["pregao.hist", "pregao.b3cache"];
const KEYS_KEY = "pregao.config";

function pregaoKeys() {
  return Object.keys(localStorage).filter((k) => k.startsWith("pregao."));
}
function refreshDataTab() {
  const bytes = CACHE_KEYS.reduce((n, k) => n + (localStorage.getItem(k) || "").length, 0);
  $("#set-cache-info").textContent = `Gráficos e últimas cotações salvos (${(bytes / 1024).toFixed(1)} KB). Não apaga lista, carteira nem alertas.`;
}

function bindDataTab() {
  $("#set-export").addEventListener("click", () => {
    const withKeys = $("#set-export-keys").checked;
    const data = {};
    for (const k of pregaoKeys()) {
      if (CACHE_KEYS.includes(k)) continue;           // cache não precisa ir no backup
      if (k === KEYS_KEY && !withKeys) continue;
      data[k] = JSON.parse(localStorage.getItem(k));
    }
    const blob = new Blob([JSON.stringify({ app: "pregao", version: APP_VERSION, exportedAt: new Date().toISOString(), data }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pregao-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(withKeys ? "Backup baixado (com as chaves — guarde com cuidado)." : "Backup baixado.");
  });

  $("#set-import").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      if (json.app !== "pregao" || !json.data) throw new Error();
      window.__pregaoFrozen = true;            // [CORRIGIDO] trava os salvamentos da página antiga
      pregaoKeys().forEach((k) => localStorage.removeItem(k)); // backup substitui tudo
      for (const [k, v] of Object.entries(json.data)) if (k.startsWith("pregao.")) localStorage.setItem(k, JSON.stringify(v));
      toast("Backup restaurado. Recarregando…");
      setTimeout(() => location.reload(), 900);
    } catch {
      toast("Esse arquivo não é um backup do Pregão.");
    }
    e.target.value = "";
  });

  $("#set-clear-cache").addEventListener("click", () => {
    CACHE_KEYS.forEach((k) => localStorage.removeItem(k));
    Object.values(state.data).forEach((r) => (r.hist = {}));
    refreshDataTab();
    toast("Cache limpo.");
  });

  // Apagar tudo pede confirmação com um segundo clique (sem janela do navegador)
  let armed = null;
  const reset = $("#set-reset");
  reset.addEventListener("click", () => {
    if (!armed) {
      reset.textContent = "Clique de novo para confirmar";
      armed = setTimeout(() => { armed = null; reset.textContent = "Apagar tudo"; }, 4000);
      return;
    }
    window.__pregaoFrozen = true;              // [CORRIGIDO] idem ao importar
    pregaoKeys().forEach((k) => localStorage.removeItem(k));
    toast("Tudo apagado. Recarregando…");
    setTimeout(() => location.reload(), 900);
  });
}

/* ---------- 7. Ligações com o app ---------- */
on("init", () => {
  applyLookPrefs();
  $("#set-version").textContent = `versão ${APP_VERSION}`;

  $("#settings-nav").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (b) showTab(b.dataset.tab);
  });
  $("#settings-close").addEventListener("click", closeSettings);

  // Mostrar/ocultar chave
  document.querySelectorAll("[data-eye]").forEach((b) => b.addEventListener("click", () => {
    const input = $(`#${b.dataset.eye}`);
    input.type = input.type === "password" ? "text" : "password";
    b.textContent = input.type === "password" ? "Mostrar" : "Ocultar";
  }));
  // Testar chave
  document.querySelectorAll("[data-test]").forEach((b) => b.addEventListener("click", () => testKey(b.dataset.test)));

  // [NOVO] atalho "Importar backup" na aba de chaves: abre direto a escolha do arquivo
  $("#hint-import").addEventListener("click", () => $("#set-import").click());

  bindLookTab();
  bindUpdateTab();
  bindAlertsTab();
  bindDataTab();

  // Sempre abre na primeira aba e limpa os status dos testes
  $("#btn-settings").addEventListener("click", () => {
    showTab("keys");
    ["finnhub", "brapi", "twelve"].forEach((n) => setKeyStatus(n, null, ""));
    $("#import-hint").hidden = !!state.config.finnhubKey; // só aparece enquanto não tem chave
  });
});
