/* =========================================================
   TEMA CLARO/ESCURO + APP INSTALÁVEL (PWA)
   ---------------------------------------------------------
   Tema: o botão ☀/☾ do topo alterna. A escolha fica salva.
   Na primeira visita segue o tema do sistema. (O tema salvo
   é aplicado num <script> no <head> do index.html, antes da
   página aparecer, para não "piscar".)

   PWA: com o manifest.json e o sw.js, o Pregão pode ser
   instalado como aplicativo (ícone na tela do celular/PC, abre
   sem a barra do navegador). Funciona em https (GitHub Pages)
   e em localhost. O botão "Instalar app" aparece sozinho quando
   o navegador permite.
   ========================================================= */
"use strict";

/* ---------- 1. Tema ---------- */
const STORAGE_THEME = "pregao.theme";

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  // cor da barra do navegador no celular
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "light" ? "#f5f4f0" : "#0b0d11";
  // os gráficos leem as cores do CSS: redesenha tudo
  if (typeof redrawAll === "function") redrawAll();
  if (state.detail) drawDetailChart();
}

// Preferência salva: "dark", "light" ou "system" (segue o sistema)
function themePref() { return load(STORAGE_THEME, "system"); }
function resolveTheme(pref) {
  return pref === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : pref;
}
// Usada também pela aba Aparência (js/configuracoes.js)
function setThemePref(pref) {
  save(STORAGE_THEME, pref);
  applyTheme(resolveTheme(pref));
}

on("init", () => {
  applyTheme(resolveTheme(themePref()));
  $("#btn-theme").addEventListener("click", () => {
    setThemePref(document.documentElement.dataset.theme === "light" ? "dark" : "light");
  });
  // no modo "Sistema", acompanha quando o sistema muda de tema
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (themePref() === "system") applyTheme(resolveTheme("system"));
  });
});

/* ---------- 2. [ALTERADO] Baixar / instalar como app ----------
   • Chrome e Edge (Android e PC) mandam um "convite" (beforeinstallprompt):
     aí o botão instala direto, com um clique.
   • iPhone/iPad, Samsung Internet e Firefox não mandam esse convite: o botão
     abre uma janela com o passo a passo do aparelho da pessoa.
   • No computador, a janela também mostra um QR code para abrir no celular.
   • Já instalado (abrindo pelo ícone)? O botão some.
   -------------------------------------------------------------------- */
let installPrompt = null;

// Qual aparelho/navegador é (para mostrar o passo a passo certo primeiro)
function detectPlatform() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS/.test(ua) ? "ios-other" : "ios";
  if (/Android/.test(ua)) {
    if (/SamsungBrowser/.test(ua)) return "samsung";
    if (/Firefox/.test(ua)) return "android-firefox";
    return "android";
  }
  if (/Firefox/.test(ua)) return "desktop-firefox";
  return "desktop";
}

const INSTALL_GUIDES = {
  ios: { title: "iPhone / iPad (Safari)", steps: [
    "Toque no botão <b>Compartilhar</b> (o quadrado com a seta para cima ⬆), na barra de baixo do Safari.",
    "Role a lista e toque em <b>Adicionar à Tela de Início</b>.",
    "Toque em <b>Adicionar</b>. O ícone do Pregão aparece junto dos seus apps.",
  ] },
  "ios-other": { title: "iPhone / iPad (Chrome, Edge ou Firefox)", steps: [
    "Toque no botão <b>Compartilhar</b> ⬆ (no Chrome fica na barra de endereço; nos outros, no menu).",
    "Toque em <b>Adicionar à Tela de Início</b>.",
    "Se não aparecer, abra o mesmo link no <b>Safari</b> e faça por lá.",
  ] },
  android: { title: "Android (Chrome)", steps: [
    "Toque no menu <b>⋮</b> (três pontinhos, no canto de cima).",
    "Toque em <b>Instalar app</b> (em alguns celulares: <b>Adicionar à tela inicial</b>).",
    "Confirme em <b>Instalar</b>. O Pregão aparece na gaveta de apps.",
  ] },
  samsung: { title: "Samsung Internet", steps: [
    "Toque no menu <b>☰</b> (três tracinhos, embaixo).",
    "Toque em <b>Adicionar página a</b> → <b>Tela inicial</b>.",
  ] },
  "android-firefox": { title: "Android (Firefox)", steps: [
    "Toque no menu <b>⋮</b>.",
    "Toque em <b>Instalar</b> (ou <b>Adicionar à tela inicial</b>).",
  ] },
  desktop: { title: "Computador (Chrome ou Edge)", steps: [
    "Clique no ícone de <b>instalar</b> no lado direito da barra de endereço (um monitor com seta ⤓).",
    "Ou abra o menu <b>⋮</b> / <b>…</b> → <b>Transmitir, salvar e compartilhar</b> / <b>Apps</b> → <b>Instalar Pregão</b>.",
    "O Pregão abre numa janela própria e ganha atalho no menu Iniciar.",
  ] },
  "desktop-firefox": { title: "Computador (Firefox)", steps: [
    "O Firefox no computador não instala sites como app.",
    "Abra o mesmo link no <b>Chrome</b> ou no <b>Edge</b> e clique em <b>Baixar app</b> por lá.",
  ] },
};

function guideHtml(key, highlight) {
  const g = INSTALL_GUIDES[key];
  return `<div class="inst-guide ${highlight ? "main" : ""}">
    <b>${g.title}</b>
    <ol>${g.steps.map((s) => `<li>${s}</li>`).join("")}</ol>
  </div>`;
}

// QR code: biblioteca qrcode-generator (MIT, Kazuhiko Arase) guardada no próprio
// projeto (js/vendor/qrcode.js), então funciona até sem internet. Só é carregada
// quando a janela abre no computador.
let qrLib = null;
function loadQrLib() {
  if (qrLib) return qrLib;
  qrLib = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "js/vendor/qrcode.js";
    s.onload = () => resolve(window.qrcode);
    s.onerror = () => { qrLib = null; reject(new Error("sem QR")); };
    document.head.appendChild(s);
  });
  return qrLib;
}

async function openInstallModal() {
  const p = detectPlatform();
  $("#inst-steps").innerHTML = guideHtml(p, true);
  $("#inst-all").innerHTML = Object.keys(INSTALL_GUIDES).filter((k) => k !== p).map((k) => guideHtml(k)).join("");
  const mobile = p !== "desktop" && p !== "desktop-firefox";
  const url = location.href.split("?")[0].split("#")[0];
  $("#inst-qr-box").hidden = mobile;
  $("#inst-url").textContent = url;
  $("#install-overlay").hidden = false;

  if (!mobile) {
    const box = $("#inst-qr");
    box.innerHTML = "";
    try {
      const qrcode = await loadQrLib();
      const qr = qrcode(0, "M");               // 0 = tamanho automático, M = correção média
      qr.addData(url);
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } catch {
      box.hidden = true;                       // sem QR: fica só o endereço escrito
    }
  }
}

function updateInstallButton() {
  const btn = $("#btn-install");
  if (btn) btn.hidden = isInstalledApp();      // já instalado: não mostra
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();             // guarda o convite para usar no nosso botão
  installPrompt = e;
  updateInstallButton();
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  $("#install-overlay").hidden = true;
  const btn = $("#btn-install");
  if (btn) btn.hidden = true;
  toast("Pregão instalado! Procure o ícone na sua tela inicial.", 6000);
});

on("init", () => {
  updateInstallButton();
  $("#btn-install").addEventListener("click", async () => {
    if (installPrompt) {                       // Chrome/Edge: instala com um clique
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      installPrompt = null;
      if (outcome !== "accepted") toast("Tudo bem! O botão continua aqui se mudar de ideia.");
      return;
    }
    openInstallModal();                        // demais: passo a passo
  });
  $("#install-close").addEventListener("click", () => ($("#install-overlay").hidden = true));
  $("#install-overlay").addEventListener("click", (e) => { if (e.target.id === "install-overlay") $("#install-overlay").hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#install-overlay").hidden = true; });

  // Service worker: só funciona em http(s) (não ao abrir o arquivo com dois cliques)
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Service worker:", err));
  }
});

/* ---------- 3. [NOVO] Modo aplicativo: bloqueia atalhos de desenvolvedor ----------
   Só vale no app INSTALADO (janela própria, sem barra do navegador) e se a opção
   "Modo aplicativo" estiver ligada em Configurações → Aparência.
   Bloqueia: F12, Ctrl+Shift+I / J / C (DevTools), Ctrl+U (ver código-fonte) e o
   menu do botão direito (exceto em campos de texto, para poder colar).
   ⚠ Não é segurança: o DevTools ainda abre pelo menu ⋮ do navegador. Serve só para
   o app se comportar como um aplicativo de verdade.
   --------------------------------------------------------------------------- */
function isInstalledApp() {
  return matchMedia("(display-mode: standalone)").matches ||
         matchMedia("(display-mode: window-controls-overlay)").matches ||
         navigator.standalone === true; // iPhone
}
function appLockActive() {
  return state.prefs.appMode !== false && isInstalledApp();
}

document.addEventListener("keydown", (e) => {
  if (!appLockActive()) return;
  const k = e.key.toUpperCase();
  const devtools = e.key === "F12" ||
    (e.ctrlKey && e.shiftKey && ["I", "J", "C"].includes(k)) ||
    (e.metaKey && e.altKey && ["I", "J", "C"].includes(k)) || // Mac
    (e.ctrlKey && !e.shiftKey && k === "U");
  if (devtools) { e.preventDefault(); e.stopPropagation(); }
}, true); // "true" = pega o atalho antes de qualquer outro código

document.addEventListener("contextmenu", (e) => {
  if (!appLockActive()) return;
  if (e.target.closest("input, textarea, [contenteditable]")) return; // deixa colar nas caixas de texto
  e.preventDefault();
});
