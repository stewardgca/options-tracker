// Portfolio Tracker — positions and live prices, one compact row per position.
// To add a position, append an entry to POSITIONS. Prices are fetched from
// the site's own /api/quote proxy (Worker -> Hyperliquid xyz perps for MU,
// NVDA, AMD and GOLD, Hyperliquid spot xStocks for QQQ (QQQX) and SPY (SPYX),
// Yahoo Finance as the close reference, Stooq fallback).
//
// Position kinds:
//   shares    — shares held (e.g. assigned from a short put), with cost basis
//   short-put — a short put still open; shows strike, expiry and intrinsic value
//   watch     — price only, no position held; no value or P&L

const POSITIONS = [
  {
    kind: "shares",
    symbol: "MU",
    name: "Micron",
    shares: 100,
    costBasis: 680.0, // assigned 20 Nov 2026 from short 680P
    lastKnownPrice: 594.51,
    plannedCall: { contracts: 1, strike: 640, expiry: "24 Dec 2026", status: "Planned" },
  },
  {
    kind: "shares",
    symbol: "NVDA",
    name: "NVIDIA",
    shares: 100,
    costBasis: 205.0, // assigned 20 Nov 2026 from short 205P (IBKR)
    lastKnownPrice: 125.53,
    plannedCall: null, // needs the premium collected to work out the break-even strike
  },
  {
    kind: "short-put",
    symbol: "QQQ",
    name: "Invesco QQQ",
    contracts: 1,
    strike: 645,
    expiry: "24 Dec 2026",
    lastKnownPrice: 635.32, // rolled 25 Nov 2026 from 660P/27 Nov; price now via Hyperliquid QQQX/USDC spot (@704)
  },
  {
    kind: "short-put",
    symbol: "AMD",
    name: "Advanced Micro Devices",
    contracts: 1,
    strike: 410,
    expiry: "24 Dec 2026",
    lastKnownPrice: 410.85, // price now via Hyperliquid xyz:AMD; 25 Nov 2026 Moomoo underlying
  },
  {
    kind: "watch",
    symbol: "SPY",
    name: "S&P 500 (SPYX)",
    lastKnownPrice: 689.81, // Friday 20 Nov 2026 ETF close; live price via Hyperliquid SPYX/USDC spot (@703)
  },
  {
    kind: "watch",
    symbol: "GOLD",
    name: "Gold (xyz perp)",
    lastKnownPrice: 3557.05, // Hyperliquid xyz:GOLD mid, 22 Nov 2026
  },
  {
    kind: "watch",
    symbol: "GLD",
    name: "SPDR Gold Shares",
    lastKnownPrice: 322.87, // Yahoo Finance, Fri 20 Nov 2026 close
  },
  {
    kind: "watch",
    symbol: "SLV",
    name: "iShares Silver Trust",
    lastKnownPrice: 36.97, // Yahoo Finance, Fri 20 Nov 2026 close
  },
];

const REFRESH_MS = 60_000;

// All short options (Moomoo book), as supplied by Chee on 25 Nov 2026.
// Static snapshot — avg cost, current price, market value and unrealised
// P/L are the 25 Nov Moomoo figures, not live prices. Rendered nearest
// expiry first. 6 puts + 15 calls = 21 contracts.
const OPTIONS_POSITIONS = [
  // 27 Nov 2026
  { symbol: "SLV", strike: 54.5, type: "C", expiry: "2026-11-27", avg: 0.65, current: 0.0001, mv: -0.01, pnl: 64.99, underlying: 36.85 },
  { symbol: "IBIT", strike: 53, type: "C", expiry: "2026-11-27", avg: 0.56, current: 0.0001, mv: -0.01, pnl: 55.99, underlying: 33.52 },
  // 4 Dec 2026
  { symbol: "AAPL", strike: 300, type: "P", expiry: "2026-12-04", avg: 0.62, current: 0.153, mv: -15.3, pnl: 46.7, underlying: 354.04 },
  { symbol: "SLV", strike: 52.5, type: "C", expiry: "2026-12-04", avg: 0.47, current: 0.003, mv: -0.29, pnl: 46.71, underlying: 36.85 },
  { symbol: "INTC", strike: 75, type: "C", expiry: "2026-12-04", avg: 0.57, current: 0.055, mv: -5.52, pnl: 51.48, underlying: 54.55 },
  { symbol: "DRAM", strike: 49, type: "C", expiry: "2026-12-04", avg: 0.96, current: 0.062, mv: -6.18, pnl: 89.82, underlying: 35.54 },
  // 11 Dec 2026
  { symbol: "TSM", strike: 350, type: "P", expiry: "2026-12-11", avg: 2.61, current: 20.3, mv: -2030.04, pnl: -1769.04, underlying: 346.66 },
  { symbol: "MU", strike: 550, type: "P", expiry: "2026-12-11", avg: 9.4, current: 20.65, mv: -2064.75, pnl: -1124.75, underlying: 621.97 },
  { symbol: "SLV", strike: 53.5, type: "C", expiry: "2026-12-11", avg: 0.53, current: 0.025, mv: -2.5, pnl: 50.5, underlying: 36.85 },
  { symbol: "GLD", strike: 377, type: "C", expiry: "2026-12-11", avg: 2.59, current: 0.218, mv: -21.76, pnl: 237.24, underlying: 324.75 },
  // 18 Dec 2026
  { symbol: "SLV", strike: 55, type: "C", expiry: "2026-12-18", avg: 0.42, current: 0.045, mv: -4.53, pnl: 37.47, underlying: 36.85 },
  { symbol: "NVDA", strike: 193, type: "C", expiry: "2026-12-18", avg: 1.37, current: 1.4, mv: -140, pnl: -3, underlying: 152.48 },
  { symbol: "GOOG", strike: 335, type: "C", expiry: "2026-12-18", avg: 0.94, current: 0.296, mv: -29.64, pnl: 64.36, underlying: 275.88 },
  { symbol: "GOOG", strike: 295, type: "C", expiry: "2026-12-18", avg: 9.55, current: 3.852, mv: -385.23, pnl: 569.77, underlying: 275.88 },
  { symbol: "DRAM", strike: 52, type: "C", expiry: "2026-12-18", avg: 0.26, current: 0.187, mv: -18.66, pnl: 7.34, underlying: 35.54 },
  // 24 Dec 2026
  { symbol: "SPY", strike: 660, type: "P", expiry: "2026-12-24", avg: 7.03, current: 4.875, mv: -487.5, pnl: 215.5, underlying: 716.54 },
  { symbol: "QQQ", strike: 645, type: "P", expiry: "2026-12-24", avg: 28.81, current: 25.99, mv: -2598.9, pnl: 282.1, underlying: 635.32 },
  { symbol: "AMD", strike: 410, type: "P", expiry: "2026-12-24", avg: 22.69, current: 38.97, mv: -3897.31, pnl: -1628.31, underlying: 410.85 },
  { symbol: "SLV", strike: 55, type: "C", expiry: "2026-12-24", avg: 0.53, current: 0.054, mv: -5.4, pnl: 47.6, underlying: 36.85 },
  // 31 Dec 2026
  { symbol: "SLV", strike: 50.5, type: "C", expiry: "2026-12-31", avg: 0.53, current: 0.123, mv: -12.28, pnl: 40.72, underlying: 36.85 },
  // 15 Jan 2027
  { symbol: "SLV", strike: 48, type: "C", expiry: "2027-01-15", avg: 0.35, current: 0.351, mv: -35.05, pnl: -0.05, underlying: 36.85 },
];
const fmtUSD = (n, dp = 2) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
const fmtSigned = (n, dp = 2) =>
  (n >= 0 ? "+" : "−") + fmtUSD(Math.abs(n), dp);
const fmtSignedPlain = (n, dp = 2) =>
  (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(dp);

async function fetchQuote(symbol) {
  const res = await fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`);
  if (!res.ok) throw new Error(`quote ${res.status}`);
  const q = await res.json();
  if (typeof q.price !== "number") throw new Error("no price");
  return q;
}

function priceBlock(pos, quote) {
  const live = !!quote;
  const price = live ? quote.price : pos.lastKnownPrice;
  const prevClose = live ? quote.previousClose : null;
  const change = prevClose != null ? price - prevClose : null;
  const changePct = change != null && prevClose ? (change / prevClose) * 100 : null;
  const source = live ? quote.source : "Last known";
  return { live, price, prevClose, change, changePct, source };
}

function shortSource(source) {
  if (!source) return "";
  if (source.startsWith("Hyperliquid")) return "Hyperliquid";
  if (source === "Yahoo Finance") return "Yahoo";
  return source;
}

function renderSharesRow(pos, quote) {
  const p = priceBlock(pos, quote);
  const cost = pos.shares * pos.costBasis;
  const value = pos.shares * p.price;
  const pnl = value - cost;
  const pnlPct = (pnl / cost) * 100;

  let options;
  const call = pos.plannedCall;
  if (call) {
    const strikeGapPct = ((call.strike - p.price) / p.price) * 100;
    const breakevenPremium = (cost - pos.shares * call.strike) / pos.shares;
    options =
      `CC ${fmtUSD(call.strike, 0)} · ${call.expiry}<br>` +
      `<span class="muted">${call.status} · ${fmtSignedPlain(strikeGapPct)}% to strike · BE prem ${fmtUSD(breakevenPremium)}/sh</span>`;
  } else {
    options = `<span class="muted">CC not set</span>`;
  }

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><span class="sym">${pos.symbol}<small>${pos.name}</small></span></td>
    <td class="num"><span class="price"><span class="dot ${p.live ? "live" : "stale"}"></span>${fmtUSD(p.price)}</span><span class="src">${shortSource(p.source)}</span></td>
    <td class="num ${p.change == null ? "" : p.change >= 0 ? "up" : "down"}">${
      p.change == null ? "—" : `${fmtSigned(p.change)}<br><span>(${fmtSignedPlain(p.changePct)}%)</span>`
    }</td>
    <td>${pos.shares} sh @ ${fmtUSD(pos.costBasis)}</td>
    <td class="num">${fmtUSD(value, 0)}</td>
    <td class="num ${pnl >= 0 ? "pos" : "neg"}">${fmtSigned(pnl, 0)}<br><span>(${fmtSignedPlain(pnlPct)}%)</span></td>
    <td>${options}</td>`;
  return tr;
}

function renderShortPutRow(pos, quote) {
  const p = priceBlock(pos, quote);
  const itm = Math.max(pos.strike - p.price, 0);
  const intrinsic = itm * 100 * pos.contracts;
  const expiry = new Date(`${pos.expiry}T16:00:00-05:00`);
  const daysLeft = Math.max(
    0,
    Math.ceil((expiry - Date.now()) / (1000 * 60 * 60 * 24)),
  );

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><span class="sym">${pos.symbol}<small>${pos.name}</small></span></td>
    <td class="num"><span class="price"><span class="dot ${p.live ? "live" : "stale"}"></span>${fmtUSD(p.price)}</span><span class="src">${shortSource(p.source)}</span></td>
    <td class="num ${p.change == null ? "" : p.change >= 0 ? "up" : "down"}">${
      p.change == null ? "—" : `${fmtSigned(p.change)}<br><span>(${fmtSignedPlain(p.changePct)}%)</span>`
    }</td>
    <td>Short ${pos.contracts}× ${pos.strike}P</td>
    <td class="num">Intrinsic ${fmtUSD(intrinsic, 0)}</td>
    <td class="num ${itm > 0 ? "neg" : "pos"}">${itm > 0 ? `ITM ${fmtUSD(itm)}` : "OTM"}</td>
    <td>Exp ${pos.expiry}<br><span class="muted">${daysLeft} day${daysLeft === 1 ? "" : "s"} left</span></td>`;
  return tr;
}

function renderWatchRow(pos, quote) {
  const p = priceBlock(pos, quote);
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><span class="sym">${pos.symbol}<small>${pos.name}</small></span></td>
    <td class="num"><span class="price"><span class="dot ${p.live ? "live" : "stale"}"></span>${fmtUSD(p.price)}</span><span class="src">${shortSource(p.source)}</span></td>
    <td class="num ${p.change == null ? "" : p.change >= 0 ? "up" : "down"}">${
      p.change == null ? "—" : `${fmtSigned(p.change)}<br><span>(${fmtSignedPlain(p.changePct)}%)</span>`
    }</td>
    <td><span class="muted">Price only</span></td>
    <td class="num">—</td>
    <td class="num">—</td>
    <td><span class="muted">—</span></td>`;
  return tr;
}

// Breach price for a quote: for Hyperliquid rows the live perp/token price
// can sit well above the stock/ETF close (QQQX/SPYX tokens, 24/7 perps), so
// use the Yahoo close reference (previousClose) as the breach test there.
// For Yahoo rows the price itself is the last close.
function breachPriceFromQuote(q) {
  if (!q || typeof q.price !== "number") return null;
  if (
    typeof q.source === "string" &&
    q.source.startsWith("Hyperliquid") &&
    typeof q.previousClose === "number"
  ) {
    return q.previousClose;
  }
  return q.price;
}

async function renderOptionsPositions() {
  const tbody = document.getElementById("options-positions");
  if (!tbody) return;
  // One live quote per underlying, in parallel; fall back to the 25 Nov
  // snapshot underlying if a quote fails.
  const symbols = [...new Set(OPTIONS_POSITIONS.map((o) => o.symbol))];
  const quotes = {};
  await Promise.all(
    symbols.map(async (s) => {
      try {
        quotes[s] = await fetchQuote(s);
      } catch (e) {
        console.warn(`quote failed for ${s}:`, e);
      }
    }),
  );
  const sorted = [...OPTIONS_POSITIONS].sort(
    (a, b) => new Date(a.expiry) - new Date(b.expiry),
  );
  tbody.innerHTML = "";
  let totalMv = 0;
  let totalPnl = 0;
  for (const o of sorted) {
    totalMv += o.mv;
    totalPnl += o.pnl;
    const ref = breachPriceFromQuote(quotes[o.symbol]) ?? o.underlying;
    const breached =
      o.type === "P" ? ref < o.strike : ref > o.strike;
    const expiry = new Date(`${o.expiry}T12:00:00+08:00`).toLocaleDateString(
      "en-SG",
      { day: "numeric", month: "short", year: "numeric" },
    );
    const tr = document.createElement("tr");
    if (breached) tr.className = "breached";
    tr.innerHTML = `
      <td><span class="sym">${o.symbol} ${o.strike}${o.type}</span></td>
      <td>${expiry}</td>
      <td class="num">${fmtUSD(o.avg, o.avg < 1 ? 4 : 2)}</td>
      <td class="num">${fmtUSD(o.current, o.current < 1 ? 4 : 2)}</td>
      <td class="num">${fmtUSD(o.mv, 2)}</td>
      <td class="num ${o.pnl >= 0 ? "pos" : "neg"}">${fmtSigned(o.pnl, 2)}</td>`;
    tbody.appendChild(tr);
  }
  const totals = document.getElementById("options-totals");
  if (totals) {
    totals.innerHTML =
      `${sorted.length} contracts · Market value ${fmtUSD(totalMv, 2)} · ` +
      `Unrealised P/L <span class="${totalPnl >= 0 ? "pos" : "neg"}">${fmtSigned(totalPnl, 2)}</span>`;
  }
}

async function renderAll() {
  const tbody = document.getElementById("positions");
  const status = document.getElementById("status-line");
  tbody.innerHTML = "";
  let ok = 0;
  for (const pos of POSITIONS) {
    let quote = null;
    try {
      quote = await fetchQuote(pos.symbol);
      ok++;
    } catch (e) {
      console.warn(`quote failed for ${pos.symbol}:`, e);
    }
    tbody.appendChild(
      pos.kind === "short-put"
        ? renderShortPutRow(pos, quote)
        : pos.kind === "watch"
          ? renderWatchRow(pos, quote)
          : renderSharesRow(pos, quote),
    );
  }
  const now = new Date().toLocaleTimeString("en-SG", {
    hour: "numeric",
    minute: "2-digit",
  });
  status.textContent =
    ok === POSITIONS.length
      ? `Prices updated ${now} · refreshing every minute`
      : `Showing last known prices for ${POSITIONS.length - ok} position${POSITIONS.length - ok > 1 ? "s" : ""} — live quote unavailable · checked ${now}`;
}

renderOptionsPositions();
renderAll();
setInterval(renderAll, REFRESH_MS);
