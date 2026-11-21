// Options Tracker — positions and live prices.
// To add a position, append an entry to POSITIONS. Prices are fetched from
// the site's own /api/quote proxy (Worker -> Yahoo Finance, Stooq fallback).
//
// Position kinds:
//   shares    — shares held (e.g. assigned from a short put), with cost basis
//   short-put — a short put still open; shows strike, expiry and intrinsic value

const POSITIONS = [
  {
    kind: "shares",
    symbol: "MU",
    name: "Micron Technology, Inc.",
    shares: 100,
    costBasis: 680.0, // assigned 20 Nov 2026 from short 680P
    acquired: "20 Nov 2026",
    acquiredNote: "Assigned from short MU 680P expiring 20 Nov 2026",
    // Last verified close, used only if the live quote is unavailable.
    lastKnownPrice: 594.51,
    lastKnownAsOf: "Fri 20 Nov 2026 close",
    plannedCall: {
      contracts: 1,
      strike: 640,
      expiry: "24 Dec 2026",
      status: "Planned",
    },
  },
  {
    kind: "shares",
    symbol: "NVDA",
    name: "NVIDIA Corporation",
    shares: 100,
    costBasis: 205.0, // assigned 20 Nov 2026 from short 205P (IBKR)
    acquired: "20 Nov 2026",
    acquiredNote: "Assigned from short NVDA 205P expiring 20 Nov 2026 (IBKR)",
    lastKnownPrice: 125.53,
    lastKnownAsOf: "Fri 20 Nov 2026 close",
    plannedCall: null, // needs the premium collected to work out the break-even strike
  },
  {
    kind: "shares",
    symbol: "SMH",
    name: "VanEck Semiconductor ETF",
    shares: 100,
    costBasis: 550.0, // assigned 20 Nov 2026 from short 550P (IBKR)
    acquired: "20 Nov 2026",
    acquiredNote: "Assigned from short SMH 550P expiring 20 Nov 2026 (IBKR)",
    lastKnownPrice: 400.06,
    lastKnownAsOf: "Fri 20 Nov 2026 close",
    plannedCall: null, // needs the premium collected to work out the break-even strike
  },
  {
    kind: "short-put",
    symbol: "QQQ",
    name: "Invesco QQQ Trust",
    contracts: 1,
    strike: 660,
    expiry: "27 Nov 2026",
    note: "Short put, Moomoo book — morning watch runs until expiry",
    lastKnownPrice: 608.45,
    lastKnownAsOf: "Fri 20 Nov 2026 close",
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
  const asOf = live
    ? new Date(quote.asOf).toLocaleString("en-SG", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : pos.lastKnownAsOf;
  const prevClose = live ? quote.previousClose : null;
  const change = prevClose != null ? price - prevClose : null;
  const changePct = change != null && prevClose ? (change / prevClose) * 100 : null;
  return { live, price, asOf, prevClose, change, changePct };
}

function headerHtml(pos, live) {
  return `
    <div class="card-head">
      <div>
        <div class="symbol">${pos.symbol}</div>
        <div class="company">${pos.name}</div>
      </div>
      <span class="badge ${live ? "live" : "stale"}">${live ? "● Live" : "Last known"}</span>
    </div>`;
}

function priceHtml(p) {
  return `
    <div class="price-row">
      <span class="price">${fmtUSD(p.price)}</span>
      ${
        p.change != null
          ? `<span class="change ${p.change >= 0 ? "up" : "down"}">${fmtSigned(p.change)} (${fmtSignedPlain(p.changePct)}%)</span>`
          : ""
      }
    </div>
    <div class="as-of">As of ${p.asOf} · USD</div>`;
}

function renderShares(pos, quote) {
  const p = priceBlock(pos, quote);
  const cost = pos.shares * pos.costBasis;
  const value = pos.shares * p.price;
  const pnl = value - cost;
  const pnlPct = (pnl / cost) * 100;

  let callHtml = "";
  const call = pos.plannedCall;
  if (call) {
    const strikeGap = call.strike - p.price;
    const strikeGapPct = (strikeGap / p.price) * 100;
    const calledAway = pos.shares * call.strike;
    const shortfallVsCost = calledAway - cost;
    const breakevenPremium = -shortfallVsCost / pos.shares;
    callHtml = `
      <div class="subhead">Covered call — ${call.status}</div>
      <div class="call-box">
        <div class="call-title">Sell ${call.contracts} × ${pos.symbol} ${fmtUSD(call.strike, 0)} Call, exp ${call.expiry}</div>
        <p>Strike is <strong>${fmtUSD(strikeGap)} (${fmtSignedPlain(strikeGapPct)}%)</strong> above the current price.</p>
        <p>If called away at ${fmtUSD(call.strike, 0)}: <strong>${fmtUSD(calledAway, 0)}</strong> proceeds vs ${fmtUSD(cost, 0)} cost — <strong>${fmtSigned(shortfallVsCost, 0)}</strong> before premium.</p>
        <p>Premium needed to break even if called away: <strong>${fmtUSD(breakevenPremium)}/share</strong> (${fmtUSD(Math.abs(shortfallVsCost), 0)} total).</p>
      </div>`;
  } else {
    callHtml = `
      <div class="subhead">Covered call — not set</div>
      <div class="call-box">
        <div class="call-title">No covered call planned yet</div>
        <p>Needs the premium collected on the put to work out the break-even strike.</p>
      </div>`;
  }

  const el = document.createElement("article");
  el.className = "card";
  el.innerHTML = `
    ${headerHtml(pos, p.live)}
    ${priceHtml(p)}
    <div class="rows">
      <div class="row"><span class="label">Shares</span><span class="value">${pos.shares} @ ${fmtUSD(pos.costBasis)}</span></div>
      <div class="row"><span class="label">Acquired</span><span class="value">${pos.acquired}</span></div>
      <div class="row"><span class="label">Cost</span><span class="value">${fmtUSD(cost, 0)}</span></div>
      <div class="row"><span class="label">Market value</span><span class="value">${fmtUSD(value, 0)}</span></div>
      <div class="row"><span class="label">Unrealised P&amp;L</span><span class="value ${pnl >= 0 ? "pos" : "neg"}">${fmtSigned(pnl, 0)} (${fmtSignedPlain(pnlPct)}%)</span></div>
    </div>
    ${callHtml}
    <div class="rows">
      <div class="row"><span class="label">${pos.acquiredNote}</span><span class="value"></span></div>
    </div>`;
  return el;
}

function renderShortPut(pos, quote) {
  const p = priceBlock(pos, quote);
  const itm = Math.max(pos.strike - p.price, 0);
  const intrinsic = itm * 100 * pos.contracts;
  const moneyness = ((p.price - pos.strike) / pos.strike) * 100;
  const expiry = new Date(`${pos.expiry}T16:00:00-05:00`);
  const daysLeft = Math.max(
    0,
    Math.ceil((expiry - Date.now()) / (1000 * 60 * 60 * 24)),
  );

  const el = document.createElement("article");
  el.className = "card";
  el.innerHTML = `
    ${headerHtml(pos, p.live)}
    ${priceHtml(p)}
    <div class="rows">
      <div class="row"><span class="label">Position</span><span class="value">Short ${pos.contracts} × ${pos.strike}P</span></div>
      <div class="row"><span class="label">Expiry</span><span class="value">${pos.expiry} (${daysLeft} day${daysLeft === 1 ? "" : "s"} left)</span></div>
      <div class="row"><span class="label">Strike vs price</span><span class="value ${itm > 0 ? "neg" : "pos"}">${itm > 0 ? "In the money" : "Out of the money"} by ${fmtUSD(Math.abs(pos.strike - p.price))} (${fmtSignedPlain(moneyness)}%)</span></div>
      <div class="row"><span class="label">Intrinsic value</span><span class="value ${intrinsic > 0 ? "neg" : "pos"}">${fmtUSD(intrinsic, 0)}</span></div>
    </div>
    <div class="rows">
      <div class="row"><span class="label">${pos.note}</span><span class="value"></span></div>
    </div>`;
  return el;
}

async function renderAll() {
  const container = document.getElementById("positions");
  const status = document.getElementById("status-line");
  container.innerHTML = "";
  let ok = 0;
  for (const pos of POSITIONS) {
    let quote = null;
    try {
      quote = await fetchQuote(pos.symbol);
      ok++;
    } catch (e) {
      console.warn(`quote failed for ${pos.symbol}:`, e);
    }
    container.appendChild(
      pos.kind === "short-put"
        ? renderShortPut(pos, quote)
        : renderShares(pos, quote),
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
