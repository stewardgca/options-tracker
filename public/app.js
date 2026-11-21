// Options Tracker — positions and live prices.
// To add a position, append an entry to POSITIONS. Prices are fetched from
// the site's own /api/quote proxy (Worker -> Yahoo Finance, Stooq fallback).

const POSITIONS = [
  {
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
];

const REFRESH_MS = 60_000;
const fmtUSD = (n, dp = 2) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
const fmtNum = (n, dp = 2) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
const fmtSigned = (n, dp = 2) =>
  (n >= 0 ? "+" : "−") + fmtUSD(Math.abs(n), dp);

async function fetchQuote(symbol) {
  const res = await fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`);
  if (!res.ok) throw new Error(`quote ${res.status}`);
  const q = await res.json();
  if (typeof q.price !== "number") throw new Error("no price");
  return q;
}

function renderPosition(pos, quote) {
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

  const cost = pos.shares * pos.costBasis;
  const value = pos.shares * price;
  const pnl = value - cost;
  const pnlPct = (pnl / cost) * 100;

  const prevClose = live ? quote.previousClose : null;
  const change =
    prevClose != null ? price - prevClose : null;
  const changePct =
    change != null && prevClose ? (change / prevClose) * 100 : null;

  const call = pos.plannedCall;
  const strikeGap = call.strike - price;
  const strikeGapPct = (strikeGap / price) * 100;
  const calledAway = pos.shares * call.strike;
  const shortfallVsCost = calledAway - cost; // negative = loss before premium
  const breakevenPremium = -shortfallVsCost / pos.shares; // $/share needed

  const el = document.createElement("article");
  el.className = "card";
  el.innerHTML = `
    <div class="card-head">
      <div>
        <div class="symbol">${pos.symbol}</div>
        <div class="company">${pos.name}</div>
      </div>
      <span class="badge ${live ? "live" : "stale"}">${live ? "● Live" : "Last known"}</span>
    </div>

    <div class="price-row">
      <span class="price">${fmtUSD(price)}</span>
      ${
        change != null
          ? `<span class="change ${change >= 0 ? "up" : "down"}">${fmtSigned(change)} (${fmtSigned(changePct, 2).replace("$", "")}%)</span>`
          : ""
      }
    </div>
    <div class="as-of">As of ${asOf}${live ? ` · ${quote.source}` : ""} · USD</div>

    <div class="rows">
      <div class="row"><span class="label">Shares</span><span class="value">${pos.shares} @ ${fmtUSD(pos.costBasis)}</span></div>
      <div class="row"><span class="label">Acquired</span><span class="value">${pos.acquired}</span></div>
      <div class="row"><span class="label">Cost</span><span class="value">${fmtUSD(cost, 0)}</span></div>
      <div class="row"><span class="label">Market value</span><span class="value">${fmtUSD(value, 0)}</span></div>
      <div class="row"><span class="label">Unrealised P&amp;L</span><span class="value ${pnl >= 0 ? "pos" : "neg"}">${fmtSigned(pnl, 0)} (${fmtSigned(pnlPct, 2).replace("$", "")}%)</span></div>
    </div>

    <div class="subhead">Covered call — ${call.status}</div>
    <div class="call-box">
      <div class="call-title">Sell ${call.contracts} × ${pos.symbol} ${fmtUSD(call.strike, 0)} Call, exp ${call.expiry}</div>
      <p>Strike is <strong>${fmtUSD(strikeGap)} (${fmtSigned(strikeGapPct, 2).replace("$", "")}%)</strong> above the current price.</p>
      <p>If called away at ${fmtUSD(call.strike, 0)}: <strong>${fmtUSD(calledAway, 0)}</strong> proceeds vs ${fmtUSD(cost, 0)} cost — <strong>${fmtSigned(shortfallVsCost, 0)}</strong> before premium.</p>
      <p>Premium needed to break even if called away: <strong>${fmtUSD(breakevenPremium)}/share</strong> (${fmtUSD(Math.abs(shortfallVsCost), 0)} total).</p>
    </div>

    <div class="rows">
      <div class="row"><span class="label">${pos.acquiredNote}</span><span class="value"></span></div>
    </div>
  `;
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
    container.appendChild(renderPosition(pos, quote));
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
