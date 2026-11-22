// Options Tracker — Cloudflare Worker
// Serves the static site from ./public and proxies live stock quotes
// through /api/quote so the browser never hits Yahoo directly (no CORS issues).

const YAHOO_UA =
  "Mozilla/5.0 (compatible; OptionsTracker/1.0; +https://github.com/stewardgca/options-tracker)";

async function quoteFromHyperliquid(symbol) {
  // Tokenised-equity perps on the xyz dex, e.g. xyz:MU. Trades around the
  // clock, so this is the live price even when the stock market is closed.
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "allMids", dex: "xyz" }),
  });
  if (!res.ok) throw new Error(`Hyperliquid ${res.status}`);
  const mids = await res.json();
  const mid = parseFloat(mids[`xyz:${symbol}`]);
  if (!Number.isFinite(mid)) throw new Error(`Hyperliquid: no xyz:${symbol}`);
  return {
    symbol,
    price: mid,
    currency: "USD",
    asOf: new Date().toISOString(),
    source: `Hyperliquid xyz:${symbol}`,
  };
}

async function quoteFromYahoo(symbol) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=5d&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": YAHOO_UA } });
  if (!res.ok) throw new Error(`Yahoo ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  const price = meta?.regularMarketPrice;
  if (typeof price !== "number") throw new Error("Yahoo: no price");
  // meta.chartPreviousClose is the close before the 5-day window, not
  // yesterday's close — take the second-to-last close from the chart itself.
  const closes = (result?.indicators?.quote?.[0]?.close || []).filter(
    (c) => typeof c === "number",
  );
  const previousClose =
    closes.length >= 2 ? closes[closes.length - 2] : null;
  return {
    symbol: meta.symbol || symbol,
    price,
    previousClose,
    currency: meta.currency || "USD",
    asOf: meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : new Date().toISOString(),
    source: "Yahoo Finance",
  };
}

async function quoteFromStooq(symbol) {
  // Stooq symbol format: mu.us (lowercase, US stocks)
  const stooqSymbol = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol)}&f=sd2t2ohlcv&h&e=csv`;
  const res = await fetch(url, { headers: { "User-Agent": YAHOO_UA } });
  if (!res.ok) throw new Error(`Stooq ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split("\n");
  if (lines.length < 2) throw new Error("Stooq: no data");
  const cols = lines[1].split(",");
  const close = parseFloat(cols[6]);
  if (!Number.isFinite(close)) throw new Error("Stooq: no close");
  return {
    symbol,
    price: close,
    previousClose: null,
    currency: "USD",
    asOf: new Date().toISOString(),
    source: "Stooq",
  };
}

async function handleQuote(symbol) {
  // MU, NVDA, GOLD: Hyperliquid xyz perps first (live even when the market
  // is closed). For MU/NVDA, Yahoo's last stock close is the reference for
  // the day change; GOLD has no Yahoo stock equivalent, so it has no
  // previousClose and the change column shows "—".
  // Note: xyz lists GOLD and SP500, but not SPY, GLD, QQQ, SPYX or QQQX
  // (checked 22 Nov 2026), so those stay on Yahoo if added.
  if (["MU", "NVDA", "GOLD"].includes(symbol)) {
    try {
      const hl = await quoteFromHyperliquid(symbol);
      const yh =
        symbol === "GOLD"
          ? null
          : await quoteFromYahoo(symbol).catch(() => null);
      return jsonResponse({
        ...hl,
        previousClose: yh ? yh.price : null,
      });
    } catch (e) {
      // fall through to the Yahoo/Stooq chain below
    }
  }
  // GOLD must never fall back to Yahoo "GOLD" — that is Barrick Gold stock,
  // not gold. If Hyperliquid fails, report unavailable instead.
  if (symbol === "GOLD") {
    return new Response(JSON.stringify({ error: "quote unavailable" }), {
      status: 502,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
  const errors = [];
  for (const fn of [quoteFromYahoo, quoteFromStooq]) {
    try {
      return jsonResponse(await fn(symbol));
    } catch (e) {
      errors.push(String(e));
    }
  }
  return new Response(
    JSON.stringify({ error: "quote unavailable", details: errors }),
    {
      status: 502,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

function jsonResponse(q) {
  return new Response(JSON.stringify(q), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "max-age=30",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/quote") {
      const symbol = (url.searchParams.get("symbol") || "MU").toUpperCase();
      return handleQuote(symbol);
    }
    return env.ASSETS.fetch(request);
  },
};
