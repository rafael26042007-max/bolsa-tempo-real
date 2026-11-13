/* =========================================================
   NOVIDADES DA VERSÃO
   ---------------------------------------------------------
   • Quando o Pregão é atualizado, mostra uma janela com o que
     mudou desde a última vez que a pessoa abriu o app.
   • Só entra o que importa para quem USA: nada de "refatorei",
     "testes", "corrigi variável". Escreva como se falasse com
     um amigo que não programa.
   • Pessoa nova (primeira visita) não vê: o guia de boas-vindas
     já apresenta tudo.
   • Se uma versão nova for publicada com o app aberto, aparece
     a faixa "Nova versão pronta · Atualizar".

   COMO LANÇAR UMA VERSÃO NOVA
   1. Adicione um item NO TOPO de CHANGELOG (versão, data, mudanças).
   2. Em sw.js, troque CACHE para "pregao-v" + a mesma versão.
      (o teste automático confere se os dois batem)
   3. git push. Os testes rodam e, se passarem, o site é publicado.
   ========================================================= */
"use strict";

/* ---------- 1. Histórico (o primeiro é a versão atual) ---------- */
const CHANGELOG = [
  {
    version: "2.2",
    date: "2026-11-13",
    items: [
      ["✨", "Agora você vê aqui o que mudou a cada atualização do Pregão."],
      ["⚡", "Mais estável com listas grandes: com muitas ações dos EUA, os preços não param mais de atualizar."],
      ["🔒", "Os links de notícias e dos sites das empresas ficaram mais seguros."],
    ],
  },
  {
    version: "2.1",
    date: "2026-11-12",
    items: [
      ["🧭", "Guia de primeiros passos e modo demonstração: dá para usar sem criar conta."],
      ["⤓", "Botão Baixar app no celular e no computador, com QR code."],
      ["🔑", "Ficou fácil achar sua chave de acesso e trazer seus dados de outro aparelho."],
      ["📱", "Topo da tela ajustado no celular."],
    ],
  },
  {
    version: "2.0",
    date: "2026-11-12",
    items: [
      ["🔔", "Alertas de preço com aviso, som e notificação."],
      ["💼", "Minha carteira: quanto você ganhou ou perdeu, no dia e no total."],
      ["↕", "Filtre, ordene e arraste os ativos da sua lista."],
      ["📰", "Notícias e indicadores de cada empresa."],
      ["☀", "Tema claro e app instalável."],
    ],
  },
];

const APP_VERSION_NUMBER = CHANGELOG[0].version;
const APP_VERSION = `${APP_VERSION_NUMBER} · ${new Date(CHANGELOG[0].date + "T12:00:00")
  .toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`;
const STORAGE_SEEN = "pregao.seenVersion";

// "2.10" > "2.9" (compara número por número)
function versionGt(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

/* ---------- 2. Janela de novidades ---------- */
function renderChangelog(entries, title) {
  $("#news-title").textContent = title;
  $("#news-body").innerHTML = entries.map((e) => `
    <div class="nv-version">
      <div class="nv-head">
        <span class="nv-badge">versão ${esc(e.version)}</span>
        <span class="muted small">${new Date(e.date + "T12:00:00").toLocaleDateString("pt-BR")}</span>
      </div>
      <ul class="nv-list">${e.items.map(([icon, text]) => `<li><span class="nv-ico">${icon}</span><span>${esc(text)}</span></li>`).join("")}</ul>
    </div>`).join("");
  $("#news-overlay").hidden = false;
}

function closeNews() {
  $("#news-overlay").hidden = true;
  save(STORAGE_SEEN, APP_VERSION_NUMBER); // só marca como visto depois de fechar
}

function showAllNews() { renderChangelog(CHANGELOG, "Histórico de novidades"); }

/* ---------- 3. Decide se mostra ao abrir ---------- */
// Lido AGORA, antes do app iniciar e salvar qualquer coisa: a pessoa já usava o Pregão?
const WAS_RETURNING_USER = ["pregao.watchlist", "pregao.config", "pregao.prefs", "pregao.theme"].some((k) => {
  try { return localStorage.getItem(k) !== null; } catch { return false; }
});

function checkWhatsNew() {
  let seen = load(STORAGE_SEEN, null);
  if (seen === null) {
    // Quem já usava antes deste recurso tem dados salvos: considera que viu a 2.1
    if (!WAS_RETURNING_USER) { save(STORAGE_SEEN, APP_VERSION_NUMBER); return; } // pessoa nova
    seen = "2.1";
  }
  const fresh = CHANGELOG.filter((e) => versionGt(e.version, seen));
  if (!fresh.length) return;

  const show = () => renderChangelog(fresh, fresh.length === 1 ? "O que há de novo" : "O que mudou desde a sua última visita");
  // Espera o guia de primeiros passos fechar, se estiver aberto
  const waitWizard = () => ($("#welcome-overlay").hidden ? show() : setTimeout(waitWizard, 800));
  setTimeout(waitWizard, 600);
}

/* ---------- 4. Versão nova publicada com o app aberto ---------- */
function watchForUpdates() {
  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;
  const hadController = !!navigator.serviceWorker.controller;
  // O service worker novo assume quando uma versão é publicada (sw.js mudou)
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) $("#update-banner").hidden = false;
  });
  // Procura versão nova a cada 30 min e ao voltar para o app
  const check = () => navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
  setInterval(check, 30 * 60_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
}

/* ---------- 5. Ligações com o app ---------- */
on("init", () => {
  $("#news-close").addEventListener("click", closeNews);
  $("#news-ok").addEventListener("click", closeNews);
  $("#news-overlay").addEventListener("click", (e) => { if (e.target.id === "news-overlay") closeNews(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#news-overlay").hidden) closeNews(); });
  $("#update-reload").addEventListener("click", () => location.reload());
  $("#update-later").addEventListener("click", () => ($("#update-banner").hidden = true));
  const all = $("#show-news");
  if (all) all.addEventListener("click", () => { closeSettings(); showAllNews(); });

  checkWhatsNew();
  watchForUpdates();
});
