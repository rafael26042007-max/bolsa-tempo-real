/* =========================================================
   SERVICE WORKER — permite instalar o Pregão como app
   ---------------------------------------------------------
   Estratégia "rede primeiro" para os arquivos do próprio app:
   tenta sempre a versão nova; se estiver sem internet, usa a
   cópia salva (o app abre, mas sem preços até a internet voltar).
   As APIs de cotação (Finnhub, brapi…) NUNCA passam pelo cache:
   preço velho seria pior do que nenhum preço.
   Mude CACHE ao alterar esta lista de arquivos.
   ========================================================= */
const CACHE = "pregao-v13"; // [ALTERADO] mude o número sempre que a lista de arquivos mudar
const APP_FILES = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "js/alertas.js",
  "js/carteira.js",
  "js/lista.js",
  "js/noticias.js",
  "js/tema-pwa.js",
  "js/configuracoes.js",
  "js/boas-vindas.js",
  "js/vendor/qrcode.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  // apaga caches de versões antigas
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // APIs: direto na rede
  // [CORRIGIDO] cache: "no-cache" = sempre pergunta ao servidor se o arquivo mudou.
  // Sem isso, o GitHub Pages deixava o navegador usar a versão velha por até 10 min
  // depois de cada publicação. (Navegação de página não aceita esse ajuste no
  // pedido original, então ela é refeita pelo endereço.)
  const fresh = e.request.mode === "navigate"
    ? fetch(e.request.url, { cache: "no-cache", credentials: "include" })
    : fetch(e.request, { cache: "no-cache" });
  e.respondWith(
    fresh
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

// Clicar na notificação de alerta abre/foca o app
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then((list) =>
      list.length ? list[0].focus() : self.clients.openWindow("./"))
  );
});
