// Portfolio Tracker — positions and live prices, one compact row per position.
// To add a position, append an entry to POSITIONS. Prices are fetched from
// the site's own /api/quote proxy (Worker -> Hyperliquid xyz perps for MU,
// NVDA and GOLD, Hyperliquid spot xStocks for QQQ (QQQX) and SPY (SPYX),
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
    strike: 660,
    expiry: "27 Nov 2026",
    lastKnownPrice: 608.45, // price now via Hyperliquid QQQX/USDC spot (@704)
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

renderAll();
setInterval(renderAll, REFRESH_MS);
