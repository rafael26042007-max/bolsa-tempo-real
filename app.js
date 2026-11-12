/* =========================================================
   Pregão — acompanhamento da bolsa em tempo real
   ---------------------------------------------------------
   Fontes de dados:
   • Finnhub  → ações dos EUA + cripto. Preço AO VIVO via WebSocket
                (cada negócio fechado chega na hora).
   • brapi    → ações da B3 (PETR4, VALE3…). Plano grátis tem
                atraso de ~30 min (limitação da fonte, não do app).
   • Binance  → variação de 24h das criptos (API pública, sem chave).
   ========================================================= */

"use strict";

/* =========================================================
   1. CONFIGURAÇÃO E CONSTANTES
   ========================================================= */
const FINNHUB_REST = "https://finnhub.io/api/v1";
const FINNHUB_WS = "wss://ws.finnhub.io";
const BRAPI = "https://brapi.dev/api";
const BINANCE = "https://api.binance.com/api/v3";
// [NOVO] Câmbio: open.er-api (160+ moedas) e reserva Frankfurter (Banco Central Europeu) — grátis e sem chave
const FX_APIS = [
  { url: "https://open.er-api.com/v6/latest/USD", pick: (j) => j.rates, date: (j) => j.time_last_update_utc && new Date(j.time_last_update_utc).toISOString().slice(0, 10) },
  { url: "https://api.frankfurter.dev/v1/latest?base=USD", pick: (j) => ({ USD: 1, ...j.rates }), date: (j) => j.date },
];
const FX_REFRESH_MS = 60 * 60 * 1000; // câmbio de referência muda pouco: 1x por hora

// [NOVO] Moedas que aparecem no seletor ("orig" = moeda original do ativo)
const CURRENCIES = [
  { code: "orig", label: "Moeda original" },
  { code: "BRL", label: "R$ · BRL" },
  { code: "USD", label: "US$ · USD" },
  { code: "EUR", label: "€ · EUR" },
  { code: "GBP", label: "£ · GBP" },
  { code: "JPY", label: "¥ · JPY" },
  { code: "CAD", label: "C$ · CAD" },
  { code: "CHF", label: "Fr · CHF" },
  { code: "CNY", label: "¥ · CNY" },
  { code: "ARS", label: "$ · ARS" },
];
const STORAGE_CCY = "pregao.currency";

const STORAGE_CONFIG = "pregao.config";
const STORAGE_LIST = "pregao.watchlist";

const MAX_TICKS = 900;          // pontos guardados por ativo (1 por segundo ≈ 15 min)
const WS_SYMBOL_LIMIT = 50;     // limite do plano grátis da Finnhub
const B3_POLL_MS = 120_000;     // B3 já vem atrasada, então 2 min é suficiente
const CRYPTO_STATS_MS = 60_000; // variação 24h das criptos

// Atalhos que aparecem embaixo da busca
const QUICK = [
  { symbol: "AAPL", name: "Apple" },
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "TSLA", name: "Tesla" },
  { symbol: "PETR4.SA", name: "Petrobras" },
  { symbol: "VALE3.SA", name: "Vale" },
  { symbol: "ITUB4.SA", name: "Itaú" },
  { symbol: "BINANCE:BTCUSDT", name: "Bitcoin" },
  { symbol: "BINANCE:ETHUSDT", name: "Ethereum" },
];

// Lista inicial (primeira vez que abre o app)
const DEFAULT_LIST = ["AAPL", "NVDA", "PETR4.SA", "VALE3.SA", "BINANCE:BTCUSDT"];

// Criptos pesquisáveis pelo nome (a busca da Finnhub não retorna cripto)
const CRYPTOS = [
  ["BTC", "Bitcoin"], ["ETH", "Ethereum"], ["SOL", "Solana"], ["BNB", "BNB"],
  ["XRP", "XRP"], ["ADA", "Cardano"], ["DOGE", "Dogecoin"], ["AVAX", "Avalanche"],
  ["DOT", "Polkadot"], ["LINK", "Chainlink"], ["LTC", "Litecoin"], ["TRX", "TRON"],
].map(([c, n]) => ({ symbol: `BINANCE:${c}USDT`, name: `${n} (${c}/USDT)`, tag: "Cripto" }));

/* =========================================================
   2. ESTADO DO APP
   ========================================================= */
const state = {
  config: load(STORAGE_CONFIG, { finnhubKey: "", brapiKey: "" }),
  list: load(STORAGE_LIST, null) || DEFAULT_LIST.map((s) => ({ symbol: s, name: "" })),
  data: {},          // symbol → { price, prevClose, high, low, open, ticks[], status, ... }
  cards: {},         // symbol → referências do DOM do card
  ws: null,
  wsRetry: 0,
  detail: null,      // símbolo aberto no painel
  currency: load(STORAGE_CCY, "orig"), // [NOVO] moeda escolhida no seletor
  fx: { USD: 1 },    // [NOVO] quanto vale 1 dólar em cada moeda (ex.: fx.BRL = 5,4)
  fxDate: null,      // [NOVO] data da cotação do câmbio
  dirty: new Set(),  // símbolos que precisam ser redesenhados
  timers: [],
};

/* =========================================================
   3. UTILITÁRIOS
   ========================================================= */
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sem storage */ }
}
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Qual fonte usar para cada símbolo
function providerOf(symbol) {
  if (symbol.includes(":")) return "crypto";          // ex.: BINANCE:BTCUSDT
  if (/\.SA$/i.test(symbol)) return "b3";             // ex.: PETR4.SA
  return "us";                                         // ex.: AAPL
}
function displaySymbol(symbol) {
  const p = providerOf(symbol);
  if (p === "crypto") return symbol.split(":")[1].replace(/USDT$/, "/USDT");
  if (p === "b3") return symbol.replace(/\.SA$/i, "");
  return symbol;
}
function currencyOf(symbol) {
  return providerOf(symbol) === "b3" ? "BRL" : "USD";
}

// [NOVO] Moeda em que o valor vai ser MOSTRADO (a escolhida ou a original)
function targetCurrency(symbol) {
  const c = state.currency;
  if (c === "orig" || !state.fx[c]) return currencyOf(symbol); // sem câmbio carregado → original
  return c;
}
// [NOVO] Converte um valor da moeda original do ativo para a moeda escolhida
// Regra de três via dólar: valor ÷ (moeda original por US$) × (moeda alvo por US$)
function convert(v, symbol) {
  if (v == null || isNaN(v)) return v;
  const from = currencyOf(symbol), to = targetCurrency(symbol);
  if (from === to) return v;
  return (v / state.fx[from]) * state.fx[to];
}

// [ALTERADO] Agora converte antes de formatar
function fmtPrice(v, symbol) {
  if (v == null || isNaN(v)) return "—";
  v = convert(v, symbol);
  const currency = targetCurrency(symbol);
  // Moedas sem centavos (ex.: iene) usam 0 casas; as outras, 2
  const base = new Intl.NumberFormat("pt-BR", { style: "currency", currency }).resolvedOptions().minimumFractionDigits;
  const digits = v < 1 ? 6 : v < 10 ? Math.max(base, 3) : base;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency", currency,
    minimumFractionDigits: base, maximumFractionDigits: digits,
  }).format(v);
}
function fmtNum(v, digits = 2) {
  if (v == null || isNaN(v)) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}
// [ALTERADO] Converte e usa o símbolo da moeda escolhida
function fmtBig(v, symbol) {
  if (!v) return "—";
  v = convert(v, symbol);
  const code = targetCurrency(symbol);
  const cur = { BRL: "R$", USD: "US$" }[code] || code;
  if (v >= 1e12) return `${cur} ${fmtNum(v / 1e12)} tri`;
  if (v >= 1e9) return `${cur} ${fmtNum(v / 1e9)} bi`;
  if (v >= 1e6) return `${cur} ${fmtNum(v / 1e6)} mi`;
  return `${cur} ${fmtNum(v, 0)}`;
}
function fmtTime(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtChange(d, pct) {
  if (d == null || isNaN(d)) return { text: "—", cls: "flat" };
  const sign = d > 0 ? "+" : d < 0 ? "−" : "";
  const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "•";
  return {
    text: `${arrow} ${sign}${fmtNum(Math.abs(pct ?? 0))}%`,
    cls: d > 0 ? "up" : d < 0 ? "down" : "flat",
  };
}

let toastTimer;
function toast(msg, ms = 3500) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

// Cria (ou pega) o registro de dados de um símbolo
function rec(symbol) {
  if (!state.data[symbol]) {
    state.data[symbol] = {
      price: null, prevClose: null, open: null, high: null, low: null,
      volume: null, lastTs: null, ticks: [], status: "wait", note: "", profile: null,
    };
  }
  return state.data[symbol];
}

// Adiciona um ponto no histórico (no máximo 1 por segundo)
function pushTick(r, t, p) {
  const sec = Math.floor(t / 1000) * 1000;
  const last = r.ticks[r.ticks.length - 1];
  if (last && last.t === sec) last.p = p;
  else if (!last || sec > last.t) r.ticks.push({ t: sec, p });
  if (r.ticks.length > MAX_TICKS) r.ticks.splice(0, r.ticks.length - MAX_TICKS);
}

/* =========================================================
   4. CHAMADAS DE API
   ========================================================= */
async function finnhub(path, params = {}) {
  if (!state.config.finnhubKey) throw new Error("NO_KEY");
  const qs = new URLSearchParams({ ...params, token: state.config.finnhubKey });
  const res = await fetch(`${FINNHUB_REST}${path}?${qs}`);
  if (res.status === 401) throw new Error("BAD_KEY");
  if (res.status === 403) throw new Error("NO_ACCESS");
  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  return res.json();
}

async function brapi(path, params = {}) {
  const qs = new URLSearchParams(params);
  if (state.config.brapiKey) qs.set("token", state.config.brapiKey);
  const res = await fetch(`${BRAPI}${path}?${qs}`);
  if (res.status === 401 || res.status === 403) throw new Error("BRAPI_TOKEN");
  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  return res.json();
}

/* ---------- 4.1 Ações dos EUA (Finnhub) ---------- */
async function loadUS(symbol) {
  const r = rec(symbol);
  try {
    const q = await finnhub("/quote", { symbol });
    if (!q || (q.c === 0 && q.t === 0)) {
      r.status = "err"; r.note = "Sem dados para este código";
    } else {
      if (r.price == null || !r.ticks.length) r.price = q.c;  // WS tem prioridade
      r.prevClose = q.pc; r.open = q.o; r.high = q.h; r.low = q.l;
      r.lastTs = r.lastTs || q.t * 1000;
      if (r.status !== "live") r.status = "ready";
    }
  } catch (e) {
    r.status = "err";
    r.note = e.message === "NO_ACCESS" ? "Fora do plano grátis da Finnhub"
           : e.message === "NO_KEY" ? "Configure a chave da Finnhub"
           : e.message === "BAD_KEY" ? "Chave da Finnhub inválida"
           : e.message === "RATE_LIMIT" ? "Limite de requisições — aguarde"
           : "Falha ao buscar cotação";
  }
  markDirty(symbol);

  // Perfil da empresa (logo, setor, valor de mercado) — só uma vez
  if (!r.profile && state.config.finnhubKey) {
    try {
      const p = await finnhub("/stock/profile2", { symbol });
      if (p && p.name) {
        r.profile = {
          name: p.name, logo: p.logo, industry: p.finnhubIndustry, web: p.weburl,
          exchange: p.exchange, country: p.country, ipo: p.ipo,
          marketCap: p.marketCapitalization ? p.marketCapitalization * 1e6 : null,
        };
        setName(symbol, p.name);
      } else r.profile = {};
    } catch { r.profile = {}; }
    markDirty(symbol);
  }
}

/* ---------- 4.2 Ações da B3 (brapi, com atraso) ---------- */
// [CORRIGIDO] A brapi devolvia 429 (limite de requisições) porque o histórico do dia
// era pedido de novo a cada atualização. Agora: histórico só 1 vez por ativo e,
// se der 429, o app espera 2 min sem chamar a brapi e mantém o último preço na tela.
let brapiPausedUntil = 0;

async function loadB3(symbol, withHistory = false) {
  const r = rec(symbol);
  const ticker = displaySymbol(symbol);
  if (Date.now() < brapiPausedUntil) return;             // em pausa por limite
  const wantHistory = withHistory && !r.histTried;       // histórico só uma vez
  try {
    let json;
    try {
      json = await brapi(`/quote/${ticker}`, wantHistory ? { range: "1d", interval: "5m" } : {});
    } catch (e) {
      if (!wantHistory || e.message === "BRAPI_TOKEN" || e.message === "RATE_LIMIT") throw e;
      json = await brapi(`/quote/${ticker}`);           // histórico indisponível → só cotação
    } finally {
      if (wantHistory) r.histTried = true;
    }
    const q = json.results && json.results[0];
    if (!q || q.regularMarketPrice == null) throw new Error("NOT_FOUND");

    r.price = q.regularMarketPrice;
    r.prevClose = q.regularMarketPreviousClose;
    r.open = q.regularMarketOpen;
    r.high = q.regularMarketDayHigh;
    r.low = q.regularMarketDayLow;
    r.volume = q.regularMarketVolume;
    r.lastTs = q.regularMarketTime ? new Date(q.regularMarketTime).getTime() : Date.now();
    r.status = "delay";
    r.note = "";
    r.profile = r.profile || {
      name: q.longName || q.shortName, logo: q.logourl, marketCap: q.marketCap,
      exchange: "B3", country: "BR",
    };
    setName(symbol, q.longName || q.shortName);

    // Histórico intradiário (se veio)
    if (Array.isArray(q.historicalDataPrice) && q.historicalDataPrice.length) {
      r.ticks = q.historicalDataPrice
        .filter((h) => h.close != null)
        .map((h) => ({ t: h.date * 1000, p: h.close }))
        .sort((a, b) => a.t - b.t);
    }
    pushTick(r, r.lastTs, r.price);
  } catch (e) {
    if (e.message === "RATE_LIMIT") {
      brapiPausedUntil = Date.now() + 120_000;           // pausa de 2 min
      if (r.price != null) { markDirty(symbol); return; } // mantém o último preço
    }
    r.status = "err";
    r.note = e.message === "BRAPI_TOKEN" ? "Precisa do token da brapi"
           : e.message === "NOT_FOUND" ? "Código não encontrado na B3"
           : e.message === "RATE_LIMIT" ? "Limite da brapi — tentando de novo em 2 min"
           : "Falha ao buscar (brapi)";
  }
  markDirty(symbol);
}

/* ---------- 4.3 Cripto (variação de 24h pela Binance) ---------- */
// [CORRIGIDO] api.binance.com dava ERR_CERT_AUTHORITY_INVALID na sua rede
// (antivírus ou provedor interceptando o certificado). Agora tenta primeiro o
// domínio público de dados da Binance; se nenhum funcionar, para de tentar por 15 min
// e usa a variação desde que a página abriu. O preço ao vivo (Finnhub) não é afetado.
const BINANCE_HOSTS = ["https://data-api.binance.vision/api/v3", BINANCE];
let binanceHost = null;          // domínio que funcionou
let binancePausedUntil = 0;

async function loadCryptoStats(symbol) {
  const r = rec(symbol);
  const pair = symbol.split(":")[1];
  if (Date.now() < binancePausedUntil) return;
  const hosts = binanceHost ? [binanceHost] : BINANCE_HOSTS;
  for (const host of hosts) {
    try {
      const res = await fetch(`${host}/ticker/24hr?symbol=${pair}`);
      if (!res.ok) throw new Error();
      const s = await res.json();
      binanceHost = host;
      r.prevClose = parseFloat(s.openPrice);  // referência = preço de 24h atrás
      r.open = parseFloat(s.openPrice);
      r.high = parseFloat(s.highPrice);
      r.low = parseFloat(s.lowPrice);
      r.volume = parseFloat(s.volume);
      if (r.price == null) { r.price = parseFloat(s.lastPrice); r.lastTs = Date.now(); }
      if (r.status === "wait") r.status = "ready";
      r.note = "Variação de 24h";
      markDirty(symbol);
      return;
    } catch { /* tenta o próximo domínio */ }
  }
  binanceHost = null;
  binancePausedUntil = Date.now() + 15 * 60_000;
  r.note = "Variação desde que você abriu a página";
  markDirty(symbol);
}

/* =========================================================
   5. TEMPO REAL — WebSocket da Finnhub
   ---------------------------------------------------------
   [CORRIGIDO] O plano grátis da Finnhub aceita só 1 conexão ao vivo
   por chave. Com o Pregão aberto em 2 abas (ou no PC e no celular),
   a segunda conexão era recusada e ficava em "Reconectando…".
   Agora:
   • Só UMA aba abre o WebSocket (a "líder", eleita com Web Locks)
     e repassa os negócios para as outras abas (BroadcastChannel).
   • Se mesmo assim não conectar, o app avisa o motivo e passa a
     atualizar pelo REST a cada ~15 s, para os preços não pararem.
   ========================================================= */
const channel = "BroadcastChannel" in window ? new BroadcastChannel("pregao-live") : null;
const live = {
  leader: false,        // esta aba é a dona da conexão?
  remoteOn: false,      // (abas seguidoras) a líder está ao vivo?
  failures: 0,          // tentativas seguidas que falharam
  warned: false,        // já mostrou o aviso de falha?
  remoteSubs: new Set() // ativos pedidos pelas outras abas
};

function wsSymbols() {
  const own = state.list.map((i) => i.symbol).filter((s) => providerOf(s) !== "b3");
  return [...new Set([...own, ...live.remoteSubs])];
}

// Está recebendo tempo real (por esta aba ou pela líder)?
function isLive() {
  if (live.leader) return !!state.ws && state.ws.readyState === WebSocket.OPEN;
  return live.remoteOn;
}

// Ponto de entrada: disputa a liderança; quem ganha conecta
function startLive() {
  if (!state.config.finnhubKey) { setWsStatus("off", "Sem chave"); return; }
  if (live.started) { connectWS(); return; } // já está na disputa: só pede reconexão
  live.started = true;
  if (!navigator.locks || !channel) { live.leader = true; connectWS(); return; }

  setWsStatus("wait", "Conectando…");
  // Fica na fila do "cadeado". Quando a aba líder fecha, a próxima assume sozinha.
  navigator.locks.request("pregao-ws", () => new Promise(() => {
    live.leader = true;
    connectWS();
  }));
  // Enquanto não é líder, pede à líder os ativos desta aba
  channel.postMessage({ type: "sub", symbols: wsSymbols() });
}

function connectWS() {
  if (!live.leader) { channel && channel.postMessage({ type: "reconnect" }); return; }
  state.config = load(STORAGE_CONFIG, state.config); // pega a chave mais nova (pode ter mudado em outra aba)
  if (!state.config.finnhubKey) { setWsStatus("off", "Sem chave"); return; }
  if (state.ws) { state.ws.onclose = null; state.ws.close(); }

  // Depois de 3 falhas mantém o aviso "Sem tempo real" enquanto tenta de novo
  if (live.failures < 3) setWsStatus("wait", "Conectando…");
  const ws = new WebSocket(`${FINNHUB_WS}?token=${encodeURIComponent(state.config.finnhubKey)}`);
  state.ws = ws;
  let opened = false;

  ws.onopen = () => {
    opened = true;
    state.wsRetry = 0;
    live.failures = 0;
    setWsStatus("on", "Ao vivo");
    const syms = wsSymbols();
    if (syms.length > WS_SYMBOL_LIMIT) toast(`O plano grátis transmite até ${WS_SYMBOL_LIMIT} ativos ao vivo.`);
    syms.slice(0, WS_SYMBOL_LIMIT).forEach(sendSub);
  };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === "trade" && Array.isArray(msg.data)) {
      for (const tr of msg.data) onTrade(tr.s, tr.p, tr.t, tr.v);
      channel && channel.postMessage({ type: "trades", data: msg.data }); // repassa às outras abas
    } else if (msg.type === "error") {
      toast(`Finnhub: ${msg.msg}`);
    }
  };

  ws.onclose = () => {
    if (!opened) live.failures++;
    if (live.failures >= 3 && !live.warned) {
      live.warned = true;
      toast("Não consegui conectar ao vivo na Finnhub. O mais comum: o Pregão aberto em outro lugar com a mesma chave " +
            "(o plano grátis permite 1 conexão). Enquanto isso, atualizo a cada ~15 s.", 9000);
    }
    setWsStatus("off", live.failures >= 3 ? "Sem tempo real · 15 s" : "Reconectando…");
    // Espera crescente: 3s, 6s, 12s… até 60s (tentar rápido demais faz a Finnhub bloquear)
    const wait = Math.min(60_000, 3000 * 2 ** state.wsRetry++);
    setTimeout(connectWS, wait);
  };
  ws.onerror = () => ws.close();
}

function sendSub(symbol) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN)
    state.ws.send(JSON.stringify({ type: "subscribe", symbol }));
}

function subscribe(symbol) {
  if (live.leader) sendSub(symbol);
  else channel && channel.postMessage({ type: "sub", symbols: [symbol] });
}
function unsubscribe(symbol) {
  // Só a líder fala com a Finnhub, e só cancela se nenhuma outra aba pediu o ativo
  if (live.leader && !live.remoteSubs.has(symbol) && state.ws && state.ws.readyState === WebSocket.OPEN)
    state.ws.send(JSON.stringify({ type: "unsubscribe", symbol }));
}

// Mensagens entre as abas
function bindChannel() {
  if (!channel) return;
  channel.onmessage = ({ data: m }) => {
    if (m.type === "trades" && !live.leader) {
      for (const tr of m.data) onTrade(tr.s, tr.p, tr.t, tr.v);
    } else if (m.type === "status" && !live.leader) {
      live.remoteOn = m.kind === "on";
      setWsStatus(m.kind, m.kind === "on" ? "Ao vivo" : m.text);
    } else if (m.type === "sub" && live.leader) {
      m.symbols.forEach((s) => { live.remoteSubs.add(s); sendSub(s); });
      channel.postMessage({ type: "status", kind: isLive() ? "on" : "off", text: $("#ws-status .pill-text").textContent });
    } else if (m.type === "reconnect" && live.leader) {
      live.failures = 0; live.warned = false; state.wsRetry = 0;
      connectWS();
    }
  };
}

/* ---------- 5.1 [NOVO] Plano B: atualização pelo REST quando o ao vivo cai ---------- */
async function pollFallback() {
  if (isLive() || !state.config.finnhubKey || document.hidden) return;
  const syms = state.list.map((i) => i.symbol).filter((s) => providerOf(s) === "us");
  for (const symbol of syms) {
    if (isLive()) return;
    try {
      const q = await finnhub("/quote", { symbol });
      if (q && q.c && state.data[symbol]) {
        const r = state.data[symbol];
        if (q.c !== r.price) onTrade(symbol, q.c, q.t ? q.t * 1000 : Date.now());
        r.status = "poll";
        markDirty(symbol);
      }
    } catch { /* tenta no próximo ciclo */ }
    await sleep(1200); // respeita o limite de 60 req/min
  }
}

// Cada negócio fechado na bolsa chega aqui
function onTrade(symbol, price, ts, volume) {
  if (!state.data[symbol]) return;
  const r = state.data[symbol];
  r.prevPrice = r.price;
  r.price = price;
  r.lastTs = ts;
  r.status = "live";
  if (r.high != null && price > r.high) r.high = price;
  if (r.low != null && r.low > 0 && price < r.low) r.low = price;
  if (r.prevClose == null) r.prevClose = r.ticks.length ? r.ticks[0].p : price;
  pushTick(r, ts, price);
  r.flash = (r.prevPrice != null && price !== r.prevPrice) ? (price > r.prevPrice ? "up" : "down") : r.flash;
  markDirty(symbol);
}

function setWsStatus(kind, text) {
  if (live.leader && channel) channel.postMessage({ type: "status", kind, text });
  const el = $("#ws-status");
  el.className = `pill pill-${kind}`;
  el.querySelector(".pill-text").textContent = text;
}

/* =========================================================
   6. RENDERIZAÇÃO (agrupada por quadro para não travar)
   ========================================================= */
let rafPending = false;
function markDirty(symbol) {
  state.dirty.add(symbol);
  if (!rafPending) { rafPending = true; requestAnimationFrame(flush); }
}
function flush() {
  rafPending = false;
  for (const s of state.dirty) {
    updateCard(s);
    if (state.detail === s) updateDetail();
  }
  state.dirty.clear();
  $("#last-update").textContent = `Atualizado às ${fmtTime(Date.now())}`;
}

/* ---------- 6.1 Card ---------- */
function createCard(item) {
  const el = document.createElement("article");
  el.className = "card";
  el.tabIndex = 0;
  el.innerHTML = `
    <div class="card-top">
      <div class="logo">${esc(displaySymbol(item.symbol).slice(0, 2))}</div>
      <div class="card-id">
        <div class="card-sym">${esc(displaySymbol(item.symbol))}</div>
        <div class="card-name">${esc(item.name || "—")}</div>
      </div>
      <span class="badge">…</span>
    </div>
    <div class="card-price-row">
      <span class="card-price">—</span>
      <span class="change flat">—</span>
    </div>
    <canvas class="spark"></canvas>
    <div class="card-foot"><span class="foot-l">—</span><span class="foot-r"></span></div>`;
  el.addEventListener("click", () => openDetail(item.symbol));
  el.addEventListener("keydown", (e) => { if (e.key === "Enter") openDetail(item.symbol); });

  state.cards[item.symbol] = {
    el,
    logo: el.querySelector(".logo"),
    name: el.querySelector(".card-name"),
    badge: el.querySelector(".badge"),
    price: el.querySelector(".card-price"),
    change: el.querySelector(".change"),
    spark: el.querySelector(".spark"),
    footL: el.querySelector(".foot-l"),
    footR: el.querySelector(".foot-r"),
    logoSet: false,
  };
  return el;
}

function badgeFor(symbol, r) {
  if (r.status === "err") return { text: "ERRO", cls: "err" };
  if (r.status === "delay") return { text: "B3 · ~30 MIN", cls: "delay" };
  if (r.status === "live" && isLive()) return { text: "AO VIVO", cls: "live" };
  if (r.status === "poll" || (r.status === "live" && providerOf(symbol) === "us"))
    return { text: "A CADA 15 S", cls: "delay" }; // [NOVO] plano B quando o ao vivo cai
  if (providerOf(symbol) === "b3") return { text: "B3", cls: "" };
  // [NOVO] Fora do pregão americano mostra "FECHADO" em vez de "AGUARDANDO"
  if (providerOf(symbol) === "us" && state.usMarketOpen === false) return { text: "FECHADO", cls: "" };
  return { text: "AGUARDANDO", cls: "" };
}

function updateCard(symbol) {
  const c = state.cards[symbol];
  if (!c) return;
  const r = rec(symbol);

  // Logo
  if (!c.logoSet && r.profile && r.profile.logo) {
    c.logo.innerHTML = `<img src="${esc(r.profile.logo)}" alt="" loading="lazy" onerror="this.remove()">`;
    c.logoSet = true;
  }

  // Selo de status
  const b = badgeFor(symbol, r);
  c.badge.textContent = b.text;
  c.badge.className = `badge ${b.cls}`;

  // Preço + variação
  c.price.textContent = fmtPrice(r.price, symbol);
  c.price.classList.toggle("long", c.price.textContent.length > 12);
  const d = r.price != null && r.prevClose ? r.price - r.prevClose : null;
  const ch = fmtChange(d, d != null ? (d / r.prevClose) * 100 : null);
  c.change.textContent = ch.text;
  c.change.className = `change ${ch.cls}`;

  // Pisca verde/vermelho quando o preço muda
  if (r.flash) {
    c.price.classList.remove("flash-up", "flash-down");
    void c.price.offsetWidth; // reinicia a animação
    c.price.classList.add(r.flash === "up" ? "flash-up" : "flash-down");
    clearTimeout(c.flashTimer);
    c.flashTimer = setTimeout(() => c.price.classList.remove("flash-up", "flash-down"), 600);
    r.flash = null;
  }

  // Rodapé
  if (r.status === "err") {
    c.footL.textContent = r.note;
    c.footR.textContent = "";
  } else {
    c.footL.textContent = r.lastTs ? `Último: ${fmtTime(r.lastTs)}` : "—";
    c.footR.textContent = d != null ? `${d >= 0 ? "+" : "−"}${fmtPrice(Math.abs(d), symbol)}` : "";
  }

  drawSpark(c.spark, r);
}

/* ---------- 6.2 Mini gráfico do card ---------- */
function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function lineColor(r) {
  const css = getComputedStyle(document.documentElement);
  if (r.price == null || r.prevClose == null) return css.getPropertyValue("--muted");
  return css.getPropertyValue(r.price >= r.prevClose ? "--up" : "--down");
}

function drawSpark(canvas, r) {
  const { ctx, w, h } = setupCanvas(canvas);
  const pts = r.ticks;
  const pad = 3;

  if (pts.length < 2) {
    // Sem histórico ainda: linha tracejada discreta
    ctx.strokeStyle = "rgba(125,133,146,.35)";
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  let min = Infinity, max = -Infinity;
  for (const p of pts) { if (p.p < min) min = p.p; if (p.p > max) max = p.p; }
  if (min === max) { min -= 1e-9; max += 1e-9; }
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const x = (t) => ((t - t0) / (t1 - t0 || 1)) * w;
  const y = (p) => h - pad - ((p - min) / (max - min)) * (h - pad * 2);

  ctx.strokeStyle = lineColor(r);
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(p.p)) : ctx.moveTo(x(p.t), y(p.p))));
  ctx.stroke();
}

/* =========================================================
   7. PAINEL DE DETALHES
   ========================================================= */
function openDetail(symbol) {
  state.detail = symbol;
  $("#detail-overlay").hidden = false;
  document.body.style.overflow = "hidden";
  updateDetail();
  // Recarrega dados completos ao abrir
  const p = providerOf(symbol);
  if (p === "b3") loadB3(symbol, true);
  else if (p === "us") loadUS(symbol);
}
function closeDetail() {
  state.detail = null;
  $("#detail-overlay").hidden = true;
  document.body.style.overflow = "";
  $("#d-tooltip").hidden = true;
}

function updateDetail() {
  const symbol = state.detail;
  if (!symbol) return;
  const r = rec(symbol);
  const item = state.list.find((i) => i.symbol === symbol) || {};
  const prof = r.profile || {};
  const provider = providerOf(symbol);

  $("#d-symbol").textContent = displaySymbol(symbol);
  $("#d-name").textContent = prof.name || item.name || "—";
  $("#d-logo").innerHTML = prof.logo
    ? `<img src="${esc(prof.logo)}" alt="" onerror="this.remove()">`
    : esc(displaySymbol(symbol).slice(0, 2));

  const priceEl = $("#d-price");
  priceEl.textContent = fmtPrice(r.price, symbol);

  const d = r.price != null && r.prevClose ? r.price - r.prevClose : null;
  const ch = fmtChange(d, d != null ? (d / r.prevClose) * 100 : null);
  const chEl = $("#d-change");
  chEl.textContent = d != null ? `${ch.text}  (${d >= 0 ? "+" : "−"}${fmtPrice(Math.abs(d), symbol)})` : "—";
  chEl.className = `change ${ch.cls}`;

  const src = {
    us: r.status === "live" ? "● Ao vivo pela Finnhub — cada negócio aparece na hora." : "Finnhub · aguardando o próximo negócio (o mercado dos EUA pode estar fechado).",
    crypto: r.status === "live" ? "● Ao vivo pela Finnhub (Binance) — 24h por dia." : "Aguardando negociações…",
    b3: "brapi · plano grátis com atraso de ~30 min. Atualiza a cada 2 min.",
  }[provider];
  // [ALTERADO] Avisa quando o valor está convertido
  const from = currencyOf(symbol), to = targetCurrency(symbol);
  const fxNote = from !== to
    ? ` Convertido de ${from} para ${to} pelo câmbio de referência${state.fxDate ? ` de ${state.fxDate.split("-").reverse().join("/")}` : ""}.`
    : "";
  $("#d-source").textContent = r.status === "err" ? `⚠ ${r.note}` : `${src} Último: ${fmtTime(r.lastTs)}.${fxNote}`;

  // Estatísticas
  const refLabel = provider === "crypto" ? "Preço 24h atrás" : "Fechamento anterior";
  const stats = [
    ["Abertura", fmtPrice(r.open, symbol)],
    [refLabel, fmtPrice(r.prevClose, symbol)],
    ["Máxima", fmtPrice(r.high, symbol)],
    ["Mínima", fmtPrice(r.low, symbol)],
  ];
  if (prof.marketCap) stats.push(["Valor de mercado", fmtBig(prof.marketCap, symbol)]);
  if (r.volume) stats.push(["Volume", fmtNum(r.volume, 0)]);
  $("#d-stats").innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");

  // Perfil
  const rows = [
    ["Setor", prof.industry], ["Bolsa", prof.exchange], ["País", prof.country], ["IPO", prof.ipo],
  ].filter(([, v]) => v);
  let html = rows.map(([k, v]) => `<div class="row"><span>${k}</span><span>${esc(v)}</span></div>`).join("");
  if (prof.web) html += `<div class="row"><span>Site</span><a href="${esc(prof.web)}" target="_blank" rel="noopener">${esc(prof.web.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a></div>`;
  $("#d-profile").innerHTML = html;

  drawDetailChart();
}

/* ---------- 7.1 Gráfico grande com mira e tooltip ---------- */
const chartState = { hoverX: null, geom: null };

function drawDetailChart() {
  const symbol = state.detail;
  if (!symbol) return;
  const r = rec(symbol);
  const canvas = $("#d-chart");
  const { ctx, w, h } = setupCanvas(canvas);
  const pts = r.ticks;
  const empty = $("#d-chart-empty");

  if (pts.length < 2) {
    empty.hidden = false;
    empty.textContent = providerOf(symbol) === "b3"
      ? "Histórico do dia indisponível no plano atual da brapi."
      : "Aguardando negociações ao vivo… o gráfico vai se formando a cada negócio.";
    chartState.geom = null;
    return;
  }
  empty.hidden = true;

  const padL = 12, padR = 70, padT = 16, padB = 24;
  let min = Infinity, max = -Infinity;
  for (const p of pts) { if (p.p < min) min = p.p; if (p.p > max) max = p.p; }
  if (r.prevClose && r.prevClose > min - (max - min) && r.prevClose < max + (max - min)) {
    min = Math.min(min, r.prevClose); max = Math.max(max, r.prevClose);
  }
  const span = (max - min) || max * 0.001 || 1;
  min -= span * 0.08; max += span * 0.08;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = (t) => padL + ((t - t0) / (t1 - t0 || 1)) * (w - padL - padR);
  const y = (p) => padT + (1 - (p - min) / (max - min)) * (h - padT - padB);
  chartState.geom = { pts, x, y, padL, padR, padT, padB, w, h, symbol };

  const css = getComputedStyle(document.documentElement);
  const muted = css.getPropertyValue("--muted");
  const border = css.getPropertyValue("--border");

  // Grade horizontal discreta + rótulos de preço (eixo à direita)
  ctx.font = "11px JetBrains Mono, monospace";
  ctx.fillStyle = muted;
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 3; i++) {
    const v = min + ((max - min) * i) / 3;
    const yy = y(v);
    ctx.strokeStyle = border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
    const cv = convert(v, symbol); // [ALTERADO] eixo do gráfico na moeda escolhida
    ctx.fillText(fmtNum(cv, cv < 10 ? 3 : 2), w - padR + 8, yy);
  }
  // Rótulos de horário (início e fim)
  ctx.textBaseline = "alphabetic";
  ctx.fillText(new Date(t0).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }), padL, h - 7);
  const endLbl = new Date(t1).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  ctx.fillText(endLbl, w - padR - ctx.measureText(endLbl).width, h - 7);

  // Linha de referência (fechamento anterior)
  if (r.prevClose) {
    ctx.strokeStyle = muted; ctx.globalAlpha = .6;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(padL, y(r.prevClose)); ctx.lineTo(w - padR, y(r.prevClose)); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  // Linha de preço
  const color = lineColor(r);
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = "round";
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(p.p)) : ctx.moveTo(x(p.t), y(p.p))));
  ctx.stroke();

  // Ponto atual com anel
  const last = pts[pts.length - 1];
  ctx.fillStyle = css.getPropertyValue("--bg");
  ctx.beginPath(); ctx.arc(x(last.t), y(last.p), 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x(last.t), y(last.p), 4, 0, Math.PI * 2); ctx.fill();

  // Mira (hover)
  if (chartState.hoverX != null) drawCrosshair(ctx);
}

function nearestPoint(px) {
  const g = chartState.geom;
  let best = null, bestD = Infinity;
  for (const p of g.pts) {
    const d = Math.abs(g.x(p.t) - px);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function drawCrosshair(ctx) {
  const g = chartState.geom;
  if (!g) return;
  const p = nearestPoint(chartState.hoverX);
  if (!p) return;
  const css = getComputedStyle(document.documentElement);
  const xx = g.x(p.t), yy = g.y(p.p);
  ctx.strokeStyle = css.getPropertyValue("--border-strong");
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(xx, g.padT); ctx.lineTo(xx, g.h - g.padB); ctx.stroke();
  ctx.fillStyle = css.getPropertyValue("--text");
  ctx.beginPath(); ctx.arc(xx, yy, 4, 0, Math.PI * 2); ctx.fill();

  const tip = $("#d-tooltip");
  tip.innerHTML = `<b>${fmtPrice(p.p, g.symbol)}</b><br><span class="muted">${fmtTime(p.t)}</span>`;
  tip.hidden = false;
  const tw = tip.offsetWidth;
  tip.style.left = `${Math.min(Math.max(xx - tw / 2, 4), g.w - tw - 4)}px`;
  tip.style.top = `${Math.max(yy - 52, 4)}px`;
}

function bindChartHover() {
  const canvas = $("#d-chart");
  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    chartState.hoverX = e.clientX - rect.left;
    drawDetailChart();
  });
  canvas.addEventListener("pointerleave", () => {
    chartState.hoverX = null;
    $("#d-tooltip").hidden = true;
    drawDetailChart();
  });
}

/* =========================================================
   8. LISTA DE ACOMPANHAMENTO
   ========================================================= */
function setName(symbol, name) {
  const item = state.list.find((i) => i.symbol === symbol);
  // [CORRIGIDO] não troca um nome bom (ex.: "Petrobras") pelo próprio código ("PETR4")
  if (item && name && item.name !== name && name.toUpperCase() !== displaySymbol(symbol)) {
    item.name = name;
    save(STORAGE_LIST, state.list);
    const c = state.cards[symbol];
    if (c) c.name.textContent = name;
  }
}

// Preenche nomes conhecidos (atalhos e criptos) quando o item não tem nome
function knownName(symbol) {
  const k = [...QUICK, ...CRYPTOS].find((q) => q.symbol === symbol);
  return k ? k.name : "";
}

function renderList() {
  state.list.forEach((i) => { if (!i.name) i.name = knownName(i.symbol); });
  const wrap = $("#watchlist");
  wrap.innerHTML = "";
  state.cards = {};
  state.list.forEach((item) => wrap.appendChild(createCard(item)));
  $("#empty-state").hidden = state.list.length > 0;
  state.list.forEach((i) => markDirty(i.symbol));
}

function addSymbol(symbol, name = "") {
  symbol = symbol.trim().toUpperCase();
  if (!symbol) return;
  if (state.list.some((i) => i.symbol === symbol)) {
    toast(`${displaySymbol(symbol)} já está na sua lista.`);
    openDetail(symbol);
    return;
  }
  const item = { symbol, name: name || knownName(symbol) };
  state.list.unshift(item);
  save(STORAGE_LIST, state.list);
  $("#watchlist").prepend(createCard(item));
  $("#empty-state").hidden = true;
  rec(symbol);
  fetchInitial(symbol);
  if (providerOf(symbol) !== "b3") subscribe(symbol);
  toast(`${displaySymbol(symbol)} adicionado.`);
}

function removeSymbol(symbol) {
  state.list = state.list.filter((i) => i.symbol !== symbol);
  save(STORAGE_LIST, state.list);
  const c = state.cards[symbol];
  if (c) c.el.remove();
  delete state.cards[symbol];
  delete state.data[symbol];
  if (providerOf(symbol) !== "b3") unsubscribe(symbol);
  $("#empty-state").hidden = state.list.length > 0;
  closeDetail();
}

function fetchInitial(symbol) {
  const p = providerOf(symbol);
  if (p === "us") return loadUS(symbol);
  if (p === "b3") return loadB3(symbol, true);
  return loadCryptoStats(symbol);
}

/* =========================================================
   9. BUSCA (Finnhub + brapi + criptos)
   ========================================================= */
let searchSeq = 0;
let activeIdx = -1;
let currentResults = [];

async function runSearch(q) {
  const seq = ++searchSeq;
  const box = $("#search-results");
  if (q.length < 1) { box.hidden = true; return; }

  box.hidden = false;
  box.innerHTML = `<li class="r-info">Buscando…</li>`;

  const ql = q.toLowerCase();
  const tasks = [];

  // a) Finnhub: ações do mundo inteiro (EUA têm tempo real no plano grátis)
  if (state.config.finnhubKey) {
    tasks.push(
      finnhub("/search", { q }).then((j) =>
        (j.result || [])
          .filter((r) => r.symbol && (!r.symbol.includes(".") || /\.SA$/.test(r.symbol) || /^[A-Z]+\.[A-Z]$/.test(r.symbol)))
          .slice(0, 12)
          .map((r) => ({ symbol: r.symbol, name: r.description, tag: /\.SA$/.test(r.symbol) ? "B3" : ({ "Common Stock": "Ação", "ETP": "ETF" }[r.type] || r.type || "EUA") }))
      ).catch(() => [])
    );
  }
  // b) brapi: ações, FIIs e BDRs da B3
  tasks.push(
    brapi("/quote/list", { search: q, limit: 8 }).then((j) =>
      (j.stocks || []).map((s) => ({ symbol: `${s.stock}.SA`, name: s.name, tag: "B3" }))
    ).catch(() => [])
  );
  // c) Criptos (lista local)
  tasks.push(Promise.resolve(
    CRYPTOS.filter((c) => c.name.toLowerCase().includes(ql) || c.symbol.toLowerCase().includes(ql))
  ));

  const groups = await Promise.all(tasks);
  if (seq !== searchSeq) return; // chegou uma busca mais nova

  // Junta e remove repetidos
  const seen = new Set();
  currentResults = groups.flat().filter((r) => {
    const k = r.symbol.toUpperCase();
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  // Prioriza código exato
  const qu = q.toUpperCase();
  currentResults.sort((a, b) =>
    (displaySymbol(b.symbol) === qu) - (displaySymbol(a.symbol) === qu));

  activeIdx = currentResults.length ? 0 : -1;
  renderResults(q);
}

function renderResults(q) {
  const box = $("#search-results");
  if (!currentResults.length) {
    box.innerHTML = `<li class="r-info">Nada encontrado para “${esc(q)}”.${state.config.finnhubKey ? "" : " Configure a chave da Finnhub para buscar ações dos EUA."}</li>`;
    return;
  }
  box.innerHTML = currentResults.map((r, i) => `
    <li data-i="${i}" class="${i === activeIdx ? "active" : ""}">
      <span class="r-sym">${esc(displaySymbol(r.symbol))}</span>
      <span class="r-name">${esc(r.name)}</span>
      <span class="r-tag">${esc(r.tag)}</span>
    </li>`).join("");
}

function pickResult(i) {
  const r = currentResults[i];
  if (!r) return;
  addSymbol(r.symbol, r.name);
  $("#search-input").value = "";
  $("#search-results").hidden = true;
}

function bindSearch() {
  const input = $("#search-input");
  let debounce;
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => runSearch(input.value.trim()), 280);
  });
  input.addEventListener("keydown", (e) => {
    const box = $("#search-results");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!currentResults.length) return;
      activeIdx = (activeIdx + (e.key === "ArrowDown" ? 1 : -1) + currentResults.length) % currentResults.length;
      renderResults(input.value);
      box.querySelector(".active")?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0 && !box.hidden) pickResult(activeIdx);
      else if (input.value.trim()) addSymbol(input.value.trim()); // código digitado direto
    } else if (e.key === "Escape") {
      box.hidden = true; input.blur();
    }
  });
  $("#search-results").addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) { e.preventDefault(); pickResult(+li.dataset.i); }
  });
  input.addEventListener("blur", () => setTimeout(() => ($("#search-results").hidden = true), 120));
  input.addEventListener("focus", () => { if (currentResults.length && input.value) $("#search-results").hidden = false; });
}

/* =========================================================
   10. STATUS DO MERCADO (EUA)
   ========================================================= */
async function loadMarketStatus() {
  const el = $("#market-status");
  if (!state.config.finnhubKey) { el.textContent = "Mercado: —"; return; }
  try {
    const s = await finnhub("/stock/market-status", { exchange: "US" });
    const label = s.isOpen
      ? (s.session === "pre-market" ? "Pré-mercado" : s.session === "post-market" ? "After-market" : "Aberto")
      : (s.holiday ? `Feriado (${s.holiday})` : "Fechado");
    el.textContent = `EUA: ${label}`;
    state.usMarketOpen = !!s.isOpen; // [NOVO] usado no selo dos cards
    redrawAll();
  } catch { el.textContent = "Mercado: —"; }
}

/* =========================================================
   10.1 [NOVO] CÂMBIO E SELETOR DE MOEDA
   ========================================================= */
async function loadFx() {
  for (const api of FX_APIS) {
    try {
      const res = await fetch(api.url);
      if (!res.ok) continue;
      const j = await res.json();
      const rates = api.pick(j);
      if (!rates || !rates.BRL) continue;
      state.fx = rates;
      state.fxDate = api.date(j) || null;
      updateCurrencyOptions();
      redrawAll();
      return;
    } catch { /* tenta a próxima API */ }
  }
  // Nenhuma API respondeu: volta para a moeda original
  if (state.currency !== "orig") toast("Não consegui carregar o câmbio — mostrando a moeda original.");
  updateCurrencyOptions();
}

// Desativa no seletor as moedas que a API de câmbio não trouxe
function updateCurrencyOptions() {
  const sel = $("#currency-select");
  [...sel.options].forEach((o) => { o.disabled = o.value !== "orig" && !state.fx[o.value]; });
}

// Redesenha todos os cards e o painel aberto
function redrawAll() {
  state.list.forEach((i) => markDirty(i.symbol));
}

function bindCurrency() {
  const sel = $("#currency-select");
  sel.innerHTML = CURRENCIES.map((c) => `<option value="${c.code}">${esc(c.label)}</option>`).join("");
  sel.value = CURRENCIES.some((c) => c.code === state.currency) ? state.currency : "orig";
  sel.addEventListener("change", () => {
    state.currency = sel.value;
    save(STORAGE_CCY, state.currency);
    redrawAll();
  });
}

/* =========================================================
   11. ATUALIZAÇÕES PERIÓDICAS
   ========================================================= */
function startTimers() {
  state.timers.forEach(clearInterval);
  state.timers = [];

  // Ações dos EUA: o WS dá o preço, o REST atualiza máx/mín/fechamento.
  // Respeita o limite de 60 req/min: espaça de acordo com o tamanho da lista.
  const usLoop = async () => {
    const us = state.list.filter((i) => providerOf(i.symbol) === "us");
    for (const i of us) { await loadUS(i.symbol); await sleep(1500); }
  };
  state.timers.push(setInterval(usLoop, 90_000));

  // B3 (com atraso) a cada 2 min
  state.timers.push(setInterval(() => {
    state.list.filter((i) => providerOf(i.symbol) === "b3").forEach((i) => loadB3(i.symbol, state.detail === i.symbol));
  }, B3_POLL_MS));

  // Cripto: variação 24h
  state.timers.push(setInterval(() => {
    state.list.filter((i) => providerOf(i.symbol) === "crypto").forEach((i) => loadCryptoStats(i.symbol));
  }, CRYPTO_STATS_MS));

  // Status do mercado a cada 5 min
  state.timers.push(setInterval(loadMarketStatus, 300_000));

  // [NOVO] Plano B: se o ao vivo cair, atualiza ações dos EUA pelo REST a cada 15 s
  state.timers.push(setInterval(pollFallback, 15_000));

  // [NOVO] Câmbio a cada 1 hora
  state.timers.push(setInterval(loadFx, FX_REFRESH_MS));
}

async function loadAll() {
  for (const item of state.list) {
    fetchInitial(item.symbol);
    if (providerOf(item.symbol) === "us") await sleep(250); // não estoura o limite
  }
}

/* =========================================================
   12. CONFIGURAÇÕES
   ========================================================= */
function openSettings() {
  $("#finnhub-key").value = state.config.finnhubKey;
  $("#brapi-key").value = state.config.brapiKey;
  $("#settings-overlay").hidden = false;
  setTimeout(() => $("#finnhub-key").focus(), 50);
}
function closeSettings() { $("#settings-overlay").hidden = true; }

function bindSettings() {
  $("#btn-settings").addEventListener("click", openSettings);
  $("#settings-cancel").addEventListener("click", closeSettings);
  $("#settings-overlay").addEventListener("click", (e) => { if (e.target.id === "settings-overlay") closeSettings(); });
  $("#settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    state.config.finnhubKey = $("#finnhub-key").value.trim();
    state.config.brapiKey = $("#brapi-key").value.trim();
    save(STORAGE_CONFIG, state.config);
    closeSettings();
    toast("Chaves salvas. Conectando…");
    live.failures = 0; live.warned = false; state.wsRetry = 0;
    startLive();
    loadMarketStatus();
    state.list.forEach((i) => { const r = rec(i.symbol); if (r.status === "err") r.status = "wait"; });
    loadAll();
  });
}

/* =========================================================
   13. INICIALIZAÇÃO
   ========================================================= */
function renderChips() {
  $("#quick-chips").innerHTML = QUICK.map((q) =>
    `<button class="chip" data-s="${q.symbol}" data-n="${esc(q.name)}">${esc(q.name)}</button>`).join("");
  $("#quick-chips").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (b) addSymbol(b.dataset.s, b.dataset.n);
  });
}

function bindGlobal() {
  $("#detail-close").addEventListener("click", closeDetail);
  $("#detail-overlay").addEventListener("click", (e) => { if (e.target.id === "detail-overlay") closeDetail(); });
  $("#d-remove").addEventListener("click", () => state.detail && removeSymbol(state.detail));

  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement.tagName !== "INPUT") { e.preventDefault(); $("#search-input").focus(); }
    if (e.key === "Escape") { closeDetail(); closeSettings(); }
  });

  // Redesenha gráficos se a janela mudar de tamanho
  let rz;
  window.addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => state.list.forEach((i) => markDirty(i.symbol)), 150);
  });

  // Ao voltar para a aba, recarrega tudo (o navegador pausa timers em segundo plano)
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { loadAll(); loadMarketStatus(); }
  });
}

function init() {
  renderChips();
  bindSearch();
  bindSettings();
  bindGlobal();
  bindChartHover();
  bindChannel();  // [NOVO] conversa entre abas abertas
  bindCurrency(); // [NOVO] monta o seletor de moeda
  loadFx();       // [NOVO] busca o câmbio
  renderList();

  if (!state.config.finnhubKey) {
    setWsStatus("off", "Sem chave");
    openSettings();
  } else {
    startLive(); // [ALTERADO] antes era connectWS()
    loadMarketStatus();
  }
  loadAll();
  startTimers();
}

document.addEventListener("DOMContentLoaded", init);
