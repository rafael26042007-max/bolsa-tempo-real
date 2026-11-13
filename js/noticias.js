/* =========================================================
   INDICADORES E NOTÍCIAS (painel de detalhes)
   ---------------------------------------------------------
   Indicadores:
   • EUA  → Finnhub /stock/metric (grátis): faixa de 52 semanas,
            P/L, lucro por ação, dividend yield e beta.
   • B3   → o que já vem na cotação da brapi: 52 semanas, P/L e LPA.
   • Cripto → só a faixa de 52 semanas não existe na fonte grátis,
            então a seção não aparece.
   Notícias:
   • EUA   → Finnhub /company-news (últimos 7 dias).
   • Cripto → Finnhub /news?category=crypto (notícias gerais de cripto).
   • B3    → a Finnhub grátis não tem; a seção explica.
   As notícias vêm em inglês: cada uma tem o link "em português",
   que abre a página pelo Google Tradutor.
   Usa os ganchos: detailOpen e detail.
   ========================================================= */
"use strict";

const METRICS_TTL = 6 * 60 * 60_000; // 6 h
const NEWS_TTL = 15 * 60_000;        // 15 min
const metricsCache = new Map();      // symbol → { data, at }
const newsCache = new Map();         // symbol → { items, at }

/* ---------- 1. Indicadores ---------- */
async function getMetrics(symbol) {
  const p = providerOf(symbol);
  if (p === "b3") return state.data[symbol]?.metrics || null;
  if (p !== "us" || !state.config.finnhubKey) return null;

  const hit = metricsCache.get(symbol);
  if (hit && Date.now() - hit.at < METRICS_TTL) return hit.data;
  try {
    const j = await finnhub("/stock/metric", { symbol, metric: "all" });
    const m = j.metric || {};
    const data = {
      high52: m["52WeekHigh"], low52: m["52WeekLow"],
      pe: m.peTTM ?? m.peBasicExclExtraTTM ?? m.peNormalizedAnnual,
      eps: m.epsTTM ?? m.epsBasicExclExtraItemsTTM,
      dy: m.dividendYieldIndicatedAnnual ?? m.currentDividendYieldTTM,
      beta: m.beta,
    };
    metricsCache.set(symbol, { data, at: Date.now() });
    return data;
  } catch { return null; }
}

function rangePos(m, price) {
  if (!m || m.high52 == null || m.low52 == null || price == null || m.high52 <= m.low52) return null;
  return Math.min(100, Math.max(0, ((price - m.low52) / (m.high52 - m.low52)) * 100));
}

async function renderMetrics(symbol) {
  const box = $("#d-metrics");
  box.innerHTML = "";
  if (providerOf(symbol) === "crypto") return;
  const m = await getMetrics(symbol);
  if (state.detail !== symbol) return;                 // fechou ou trocou de ativo
  if (!m) return;

  const r = state.data[symbol] || {};
  const pos = rangePos(m, r.price);
  const n = (v, d = 2) => (v == null || isNaN(v) ? "—" : fmtNum(v, d));
  const rows = [
    ["P/L (preço/lucro)", n(m.pe)],
    ["Lucro por ação", m.eps == null ? "—" : fmtPrice(m.eps, symbol)],
  ];
  if (m.dy != null) rows.push(["Dividend yield", `${n(m.dy)}%`]);
  if (m.beta != null) rows.push(["Beta (volatilidade)", n(m.beta)]);

  box.innerHTML = `
    <h4>Indicadores</h4>
    ${pos != null ? `
      <div class="range52" title="Onde o preço de hoje está entre a mínima e a máxima das últimas 52 semanas">
        <div class="d-note" style="margin-bottom:8px">Faixa de 52 semanas</div>
        <div class="bar"><span class="dot" id="r52-dot" style="left:${pos}%"></span></div>
        <div class="ends"><span>mín ${fmtPrice(m.low52, symbol)}</span><span>máx ${fmtPrice(m.high52, symbol)}</span></div>
      </div>` : ""}
    <dl class="kv">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
}

// Atualiza só a bolinha da faixa de 52 semanas quando o preço muda
function updateRangeDot(symbol, r) {
  const dot = $("#r52-dot");
  if (!dot) return;
  const m = providerOf(symbol) === "b3" ? r.metrics : metricsCache.get(symbol)?.data;
  const pos = rangePos(m, r.price);
  if (pos != null) dot.style.left = `${pos}%`;
}

/* ---------- 2. Notícias ---------- */
function isoDay(ms) { return new Date(ms).toISOString().slice(0, 10); }

async function getNews(symbol) {
  const p = providerOf(symbol);
  if (p === "b3" || !state.config.finnhubKey) return null;
  const hit = newsCache.get(symbol);
  if (hit && Date.now() - hit.at < NEWS_TTL) return hit.items;
  try {
    const raw = p === "crypto"
      ? await finnhub("/news", { category: "crypto" })
      : await finnhub("/company-news", { symbol, from: isoDay(Date.now() - 7 * 864e5), to: isoDay(Date.now()) });
    const items = (raw || [])
      .filter((n) => n.headline && safeUrl(n.url) !== "#") // [CORRIGIDO] só links http(s)
      .sort((a, b) => b.datetime - a.datetime)
      .slice(0, 6)
      .map((n) => ({ title: n.headline, url: n.url, source: n.source, at: n.datetime * 1000 }));
    newsCache.set(symbol, { items, at: Date.now() });
    return items;
  } catch { return null; }
}

function timeAgo(ms) {
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 60) return `há ${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return new Date(ms).toLocaleDateString("pt-BR");
}

async function renderNews(symbol) {
  const box = $("#d-news");
  const p = providerOf(symbol);
  if (p === "b3") {
    box.innerHTML = `<h4>Notícias</h4><p class="d-note">A fonte gratuita (Finnhub) só tem notícias de empresas dos EUA e de cripto.</p>`;
    return;
  }
  if (!state.config.finnhubKey) { box.innerHTML = ""; return; }
  box.innerHTML = `<h4>${p === "crypto" ? "Notícias de cripto" : "Notícias"}</h4><p class="d-note">Carregando…</p>`;
  const items = await getNews(symbol);
  if (state.detail !== symbol) return;
  if (!items) { box.innerHTML = `<h4>Notícias</h4><p class="d-note">Não consegui carregar as notícias agora.</p>`; return; }
  if (!items.length) { box.innerHTML = `<h4>Notícias</h4><p class="d-note">Nenhuma notícia nos últimos 7 dias.</p>`; return; }

  const tr = (url) => `https://translate.google.com/translate?sl=auto&tl=pt&u=${encodeURIComponent(url)}`;
  box.innerHTML = `
    <h4>${p === "crypto" ? "Notícias de cripto" : "Notícias"} <span class="muted small" style="text-transform:none;letter-spacing:0;font-weight:400">em inglês</span></h4>
    <ul class="news-list">${items.map((n) => `
      <li>
        <a href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener">${esc(n.title)}</a>
        <div class="n-meta">${esc(n.source || "")} · ${timeAgo(n.at)} · <a class="link-btn" style="display:inline;padding:0" href="${tr(n.url)}" target="_blank" rel="noopener">em português</a></div>
      </li>`).join("")}
    </ul>`;
}

/* ---------- 3. Ligações com o app ---------- */
on("detailOpen", (symbol) => { renderMetrics(symbol); renderNews(symbol); });
on("detail", (symbol, r) => {
  updateRangeDot(symbol, r);
  // B3: os indicadores chegam junto com a cotação — mostra assim que chegarem
  if (providerOf(symbol) === "b3" && r.metrics && !$("#d-metrics").innerHTML) renderMetrics(symbol);
});
