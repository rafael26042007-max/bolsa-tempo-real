// =========================================================
// DUBLÊS DAS APIS para os testes
// ---------------------------------------------------------
// Os testes não usam internet nem chaves de verdade: antes da
// página carregar, trocamos o fetch e o WebSocket do navegador
// por versões falsas que respondem como a Finnhub, brapi,
// Twelve Data, Binance e o serviço de câmbio responderiam.
// =========================================================

/**
 * Prepara a página com os dublês.
 * @param {import('@playwright/test').Page} page
 * @param {object} o
 *   keys      chaves salvas (false = nenhuma)       padrão { finnhubKey: "demo" }
 *   list      lista de símbolos inicial              padrão: lista do app
 *   storage   outras chaves do localStorage { "pregao.x": valor }
 *   wsFails   o WebSocket sempre recusa (simula ao vivo caído)
 *   brapiConcurrency429  responde 429 se a brapi receber 2 pedidos ao mesmo tempo
 *   evilLinks notícias/perfil devolvem links "javascript:"
 */
async function setup(page, o = {}) {
  await page.addInitScript((o) => {
    // ---------- dados iniciais ----------
    if (!sessionStorage.getItem("__seeded")) {        // só na 1ª carga (recarregar não reseta)
      sessionStorage.setItem("__seeded", "1");
      if (o.keys !== false) localStorage.setItem("pregao.config", JSON.stringify(o.keys || { finnhubKey: "demo" }));
      if (o.list) localStorage.setItem("pregao.watchlist", JSON.stringify(o.list.map((s) => ({ symbol: s, name: s }))));
      // por padrão a pessoa já viu as novidades (senão a janela cobre a tela nos outros testes)
      if (o.keys !== false) localStorage.setItem("pregao.seenVersion", JSON.stringify("999"));
      for (const [k, v] of Object.entries(o.storage || {})) localStorage.setItem(k, JSON.stringify(v));
    }

    // ---------- contadores para os testes conferirem ----------
    window.__calls = { finnhub: [], brapi: 0, brapiMax: 0, brapi429: 0 };
    let brapiNow = 0;
    const ok = (j) => ({ ok: true, status: 200, headers: new Headers(), json: async () => j, text: async () => JSON.stringify(j) });
    const fail = (s) => ({ ok: false, status: s, headers: new Headers({ "Retry-After": "30" }), json: async () => ({}) });
    const base = { AAPL: [228.1, 225.4], NVDA: [141.2, 144.9], MSFT: [415.3, 412.0] };
    const realFetch = window.fetch.bind(window);

    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url, location.href);
      if (url.origin === location.origin) return realFetch(input, init);   // arquivos do próprio site
      const host = url.hostname, path = url.pathname;

      if (host === "finnhub.io") {
        window.__calls.finnhub.push(Date.now());
        if (url.searchParams.get("token") === "errada") return fail(401);
        const s = url.searchParams.get("symbol");
        if (path.endsWith("/quote")) { const b = base[s] || [100, 99]; return ok({ c: b[0], pc: b[1], o: b[1], h: b[0] + 1, l: b[1] - 1, t: Date.now() / 1000 }); }
        if (path.includes("profile2")) return ok({ name: `${s} Inc`, finnhubIndustry: "Technology", exchange: "NASDAQ", country: "US", marketCapitalization: 3e6, weburl: o.evilLinks ? "javascript:alert(1)" : "https://example.com/" });
        if (path.includes("market-status")) return ok({ isOpen: true, session: "regular" });
        if (path.includes("/search")) return ok({ result: [{ symbol: "AAPL", description: "APPLE INC", type: "Common Stock" }, { symbol: "AMZN", description: "AMAZON.COM INC", type: "Common Stock" }] });
        if (path.includes("/stock/metric")) return ok({ metric: { "52WeekHigh": 260, "52WeekLow": 164, peTTM: 34.2, epsTTM: 6.7, beta: 1.2 } });
        if (path.includes("company-news") || path.endsWith("/news")) return ok([
          { headline: "Notícia boa", url: "https://example.com/n1", source: "Reuters", datetime: Date.now() / 1000 - 3600 },
          { headline: "Notícia com link perigoso", url: o.evilLinks ? "javascript:alert(1)" : "https://example.com/n2", source: "X", datetime: Date.now() / 1000 - 7200 },
        ]);
        return fail(404);
      }

      if (host === "brapi.dev") {
        window.__calls.brapi++;
        brapiNow++; window.__calls.brapiMax = Math.max(window.__calls.brapiMax, brapiNow);
        await new Promise((r) => setTimeout(r, 150));
        const tooMany = o.brapiConcurrency429 && brapiNow > 1;
        brapiNow--;
        if (tooMany) { window.__calls.brapi429++; return fail(429); }
        if (path.includes("/quote/list")) return ok({ stocks: [{ stock: "PETR4", name: "Petrobras PN", close: 37.42, change: 1.01 }] });
        const t = path.split("/").pop();
        const p = { PETR4: 37.42, VALE3: 61.1 }[t] || 20;
        const hist = Array.from({ length: 40 }, (_, i) => ({ date: Date.now() / 1000 - (40 - i) * 300, close: p * (1 + Math.sin(i / 6) * 0.01) }));
        return ok({ results: [{ symbol: t, shortName: t, longName: `${t} S.A.`, regularMarketPrice: p, regularMarketPreviousClose: p * 0.99, regularMarketOpen: p, regularMarketDayHigh: p * 1.01, regularMarketDayLow: p * 0.98, regularMarketTime: new Date().toISOString(), historicalDataPrice: hist }] });
      }

      if (host.includes("er-api") || host.includes("frankfurter")) return ok({ rates: { USD: 1, BRL: 5.0, EUR: 0.9, GBP: 0.8, JPY: 150 }, time_last_update_utc: new Date().toUTCString(), date: "2026-11-13" });
      if (host.includes("binance")) return ok({ openPrice: "89000", highPrice: "91000", lowPrice: "88000", lastPrice: "90000", volume: "1000" });
      if (host.includes("twelvedata")) return ok({ status: "ok", daily_usage: 1, plan_daily_limit: 800, meta: { exchange_timezone: "America/New_York" }, values: [] });
      return fail(404);
    };

    // ---------- WebSocket falso: manda negócios subindo devagar ----------
    class FakeWS {
      constructor() {
        this.readyState = 0;
        if (o.wsFails) { setTimeout(() => { this.readyState = 3; this.onerror && this.onerror(); }, 10); return; }
        setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 30);
        const px = { AAPL: 228.1, NVDA: 141.2, "BINANCE:BTCUSDT": 90000 };
        this.iv = setInterval(() => {
          const data = Object.keys(px).map((s) => { px[s] *= 1.0004; return { s, p: +px[s].toFixed(4), t: Date.now(), v: 1 }; });
          this.onmessage && this.onmessage({ data: JSON.stringify({ type: "trade", data }) });
        }, 100);
      }
      send() {}
      close() {
        clearInterval(this.iv);
        if (!this._c) { this._c = 1; setTimeout(() => this.onclose && this.onclose(), 0); }
      }
    }
    FakeWS.OPEN = 1;
    window.WebSocket = FakeWS;
  }, o);

  // Junta erros de JavaScript da página para os testes conferirem no final
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

module.exports = { setup };
