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

/* ---------- 2. Instalar como app ---------- */
let installPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();             // guarda o convite para mostrar no nosso botão
  installPrompt = e;
  const btn = $("#btn-install");
  if (btn) btn.hidden = false;
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  const btn = $("#btn-install");
  if (btn) btn.hidden = true;
  toast("Pregão instalado! Procure o ícone na sua tela inicial.");
});

on("init", () => {
  $("#btn-install").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $("#btn-install").hidden = true;
  });

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
