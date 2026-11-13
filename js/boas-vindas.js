/* =========================================================
   GUIA DE PRIMEIROS PASSOS + MODO DEMONSTRAÇÃO
   ---------------------------------------------------------
   Para quem abre o Pregão e não sabe o que é uma "chave de API":
   • Passo 0: explica em linguagem simples e oferece 3 caminhos:
     configurar agora, modo demonstração ou importar backup.
   • Passo 1: Finnhub (obrigatória), com o passo a passo de onde
     clicar, link para criar a conta e link "ver minha chave"
     para quem já tem conta. Testa a chave antes de seguir.
   • Passo 2: brapi e Twelve Data (opcionais, pode pular).
   • Passo 3: pronto, com o resumo do que funciona.
   Modo demonstração: sem chave nenhuma. Funcionam cripto (preço
   pela Binance a cada 15 s) e as 4 ações de teste da B3.
   Usa os ganchos: needKey, init e keysChanged.
   Usa verifyKey() de js/configuracoes.js e applyKeys() de app.js.
   ========================================================= */
"use strict";

const STORAGE_DEMO = "pregao.demo"; // true = a pessoa escolheu usar sem chave

/* ---------- 1. Abrir, fechar e navegar entre os passos ---------- */
function showWizardStep(n) {
  document.querySelectorAll(".wz-step").forEach((s) => (s.hidden = +s.dataset.step !== n));
  $("#wz-bar").style.width = `${(n / 3) * 100}%`;
  const firstInput = document.querySelector(`.wz-step[data-step="${n}"] input`);
  if (firstInput) setTimeout(() => firstInput.focus(), 60);
}

function openWizard(step = 0) {
  closeSettings();
  $("#wz-finnhub").value = state.config.finnhubKey || "";
  $("#wz-brapi").value = state.config.brapiKey || "";
  $("#wz-twelve").value = state.config.twelveKey || "";
  ["finnhub", "brapi", "twelve"].forEach((n) => setWzStatus(n, null, ""));
  $("#welcome-overlay").hidden = false;
  showWizardStep(step);
}
function closeWizard() { $("#welcome-overlay").hidden = true; }

function setWzStatus(name, ok, text) {
  const el = $(`#wz-${name}-status`);
  el.className = `key-status ${ok === true ? "ok" : ok === false ? "bad" : ""}`;
  el.textContent = text;
}

/* ---------- 2. Modo demonstração ---------- */
function isDemo() { return !state.config.finnhubKey; }

function updateDemoBanner() {
  const show = isDemo() && load(STORAGE_DEMO, false) && $("#welcome-overlay").hidden;
  $("#demo-banner").hidden = !show;
  document.body.classList.toggle("has-demo-banner", show);
  if (isDemo()) setWsStatus("off", "Demonstração");
}

// Sem chave da Finnhub não há preço ao vivo de cripto: busca na Binance a cada 15 s
async function demoCryptoTick() {
  if (!isDemo() || document.hidden) return;
  for (const i of state.list) {
    if (providerOf(i.symbol) !== "crypto") continue;
    const r = rec(i.symbol);
    const before = r.price;
    r.price = null;                       // força loadCryptoStats a gravar o preço novo
    await loadCryptoStats(i.symbol);
    if (r.price == null) { r.price = before; continue; }
    if (before != null && r.price !== before) r.flash = r.price > before ? "up" : "down";
    pushTick(r, Date.now(), r.price);
    r.lastTs = Date.now();
    r.status = "poll";
    markDirty(i.symbol);
  }
}

/* ---------- 3. Ações dos botões ---------- */
function bindWizard() {
  document.querySelectorAll("#welcome-overlay [data-go]").forEach((b) =>
    b.addEventListener("click", () => showWizardStep(+b.dataset.go)));

  $("#wz-demo").addEventListener("click", () => {
    save(STORAGE_DEMO, true);
    closeWizard();
    updateDemoBanner();
    demoCryptoTick();
    toast("Modo demonstração: cripto e ações de teste da B3 funcionam sem chave.", 5000);
  });

  $("#wz-backup").addEventListener("click", () => $("#set-import").click());

  // Passo 1: testa a chave da Finnhub antes de seguir
  const next = $("#wz-finnhub-next");
  const goFinnhub = async () => {
    const key = $("#wz-finnhub").value.trim();
    next.disabled = true;
    setWzStatus("finnhub", null, "Testando…");
    const r = await verifyKey("finnhub", key);
    next.disabled = false;
    setWzStatus("finnhub", r.ok, r.text);
    if (r.ok === false) return;
    state.config.finnhubKey = key;
    setTimeout(() => showWizardStep(2), r.ok ? 700 : 1500);
  };
  next.addEventListener("click", goFinnhub);
  $("#wz-finnhub").addEventListener("keydown", (e) => { if (e.key === "Enter") goFinnhub(); });

  // Passo 2: testa só o que foi preenchido; o que estiver vazio é pulado
  $("#wz-finish").addEventListener("click", async () => {
    const btn = $("#wz-finish");
    btn.disabled = true;
    for (const name of ["brapi", "twelve"]) {
      const key = $(`#wz-${name}`).value.trim();
      const field = name === "brapi" ? "brapiKey" : "twelveKey";
      if (!key) { state.config[field] = ""; setWzStatus(name, null, ""); continue; }
      setWzStatus(name, null, "Testando…");
      const r = await verifyKey(name, key);
      setWzStatus(name, r.ok, r.text);
      if (r.ok === false) { btn.disabled = false; return; } // chave errada: deixa corrigir
      state.config[field] = key;
    }
    btn.disabled = false;
    save(STORAGE_DEMO, false);
    applyKeys();                         // salva e conecta (app.js)

    const ok = (v) => `<li>${v}</li>`;
    $("#wz-summary").innerHTML = [
      ok("Preço <b>ao vivo</b> de ações dos EUA e cripto"),
      ok("Busca, notícias e indicadores"),
      state.config.brapiKey ? ok("Todas as ações da <b>B3</b> (com ~30 min de atraso)") : ok("B3: só PETR4, VALE3, MGLU3 e ITUB4 (sem a chave da brapi)"),
      state.config.twelveKey ? ok("Gráficos mesmo com o mercado fechado") : "",
    ].join("");
    showWizardStep(3);
  });

  $("#wz-close").addEventListener("click", () => { closeWizard(); updateDemoBanner(); });
  $("#demo-setup").addEventListener("click", () => openWizard(0));
  $("#open-guide").addEventListener("click", () => openWizard(0));

  // Esc fecha o guia (como as outras janelas)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#welcome-overlay").hidden) {
      closeWizard();
      if (isDemo()) { save(STORAGE_DEMO, true); updateDemoBanner(); }
    }
  });
}

/* ---------- 4. Ligações com o app ---------- */
// [NOVO] Recado depois de importar um backup (a página recarrega no meio)
function takeImportMsg() {
  try {
    const m = sessionStorage.getItem("pregao.importMsg");
    sessionStorage.removeItem("pregao.importMsg");
    return m;
  } catch { return null; }
}

on("init", () => {
  const msg = takeImportMsg();
  if (msg === "with-keys") toast("Backup importado com as chaves. Tudo pronto!", 5000);
  if (msg === "kept-keys") toast("Backup importado. Ele não tinha chaves, então mantive as que já estavam aqui.", 7000);
  if (msg === "no-keys" || msg === "empty-keys") state.importedWithoutKeys = msg; // [ALTERADO]
  bindWizard();
  setInterval(demoCryptoTick, 15_000);
  updateDemoBanner();
  if (isDemo()) demoCryptoTick();
});
// Sem chave: abre o guia (ou, se já escolheu o modo demonstração, só mostra a faixa)
on("needKey", () => {
  // [NOVO] veio de um backup sem chaves: explica e já abre direto no passo da chave
  if (state.importedWithoutKeys) {
    openWizard(1);
    // [ALTERADO] explica qual dos dois casos aconteceu
    setWzStatus("finnhub", null, state.importedWithoutKeys === "empty-keys"
      ? "Backup importado: sua lista, carteira e alertas chegaram ✓. As chaves estavam incluídas, mas VAZIAS: " +
        "esse backup foi feito num navegador/endereço onde a chave nunca foi colada. Cole a chave aqui " +
        "(o link \"ver minha chave\" mostra ela no site da Finnhub)."
      : "Backup importado: sua lista, carteira e alertas chegaram ✓. Mas ele não tinha as chaves " +
        "(a opção \"incluir as chaves de API\" estava desmarcada). Cole a chave aqui, ou exporte o backup de novo marcando essa opção.");
    return;
  }
  if (load(STORAGE_DEMO, false)) updateDemoBanner();
  else openWizard(0);
});
on("keysChanged", updateDemoBanner);
