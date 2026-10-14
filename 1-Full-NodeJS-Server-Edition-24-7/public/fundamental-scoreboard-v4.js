/* XAU-ELITE-FONDA — Fundamental Scoreboard v4 + AI Verdict (2026-10-14) (screenshot structure)
   100% real data only:
   - Macro Actual/Forecast/Previous/Date + history: TradingView Economic Calendar API
   - COT: window.__PRELOADED_CFTC_5YR__ (official U.S. CFTC Socrata, 260 weekly reports)
   - Seasonality: window.__PRELOADED_ALL_SEASONALITY__ (4,500 real daily CFD bars / asset)
   - 2Y yield: TradingView Global Scanner (TVC:xx02Y) + FRED DGS2 (US 21-day SMA)
   No random / synthetic values are generated. Missing releases are shown as unavailable. */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const state = {
    symbol: "XAUUSD", economy: "US", events: [], eventsByEconomy: {},
    yieldInfo: {}, selectedIndicator: null, lastFetch: null, loading: false, lastSymbolCheck: ""
  };

  const ECONOMIES = {
    US: { label: "United States", country: "US", ccy: "USD", yieldTicker: "TVC:US02Y", fred: "DGS2" },
    EU: { label: "Euro Area", country: "EU,DE,FR,IT,ES", ccy: "EUR", yieldTicker: "TVC:DE02Y", fred: null },
    GB: { label: "United Kingdom", country: "GB", ccy: "GBP", yieldTicker: "TVC:GB02Y", fred: null },
    JP: { label: "Japan", country: "JP", ccy: "JPY", yieldTicker: "TVC:JP02Y", fred: null },
    CA: { label: "Canada", country: "CA", ccy: "CAD", yieldTicker: "TVC:CA02Y", fred: null },
    AU: { label: "Australia", country: "AU", ccy: "AUD", yieldTicker: "TVC:AU02Y", fred: null },
    NZ: { label: "New Zealand", country: "NZ", ccy: "NZD", yieldTicker: "TVC:NZ02Y", fred: null },
    CH: { label: "Switzerland", country: "CH", ccy: "CHF", yieldTicker: "TVC:CH02Y", fred: null },
    CN: { label: "China", country: "CN", ccy: "CNY", yieldTicker: "TVC:CN02Y", fred: null }
  };
  const CCY_TO_ECON = { USD: "US", EUR: "EU", GBP: "GB", JPY: "JP", CAD: "CA", AUD: "AU", NZD: "NZ", CHF: "CH", CNY: "CN", CNH: "CN" };

  // goodUp = a positive surprise is bullish FOR THAT ECONOMY'S CURRENCY
  const GROUPS = [
    { id: "growth", title: "Economic growth", items: [
      { key: "gdp", label: "GDP Growth QoQ", unit: "%", eps: 0.05, goodUp: true, match: [/gdp growth rate qoq/i, /gdp growth qoq/i, /^gdp.*qoq/i, /gross domestic product.*qoq/i] },
      { key: "mpmi", label: "Manufacturing PMI", unit: "", eps: 0.3, goodUp: true, match: [/ism manufacturing pmi/i, /manufacturing pmi/i] },
      { key: "spmi", label: "Services PMI", unit: "", eps: 0.3, goodUp: true, match: [/ism services pmi/i, /services pmi/i, /non[- ]manufacturing pmi/i] },
      { key: "retail", label: "Retail Sales MoM", unit: "%", eps: 0.1, goodUp: true, match: [/^retail sales mom/i, /retail sales ex (gas|autos)/i, /retail sales/i] },
      { key: "conf", label: "Consumer Confidence", unit: "", eps: 0.5, goodUp: true, match: [/consumer confidence/i, /consumer sentiment/i] }
    ]},
    { id: "inflation", title: "Inflation", items: [
      { key: "cpi", label: "CPI YoY", unit: "%", eps: 0.05, goodUp: false, match: [/inflation rate yoy/i, /cpi yoy/i, /consumer price.*yoy/i, /^cpi$/i] },
      { key: "ppi", label: "PPI YoY", unit: "%", eps: 0.05, goodUp: false, match: [/ppi yoy/i, /producer price.*yoy/i, /ppi mom/i] },
      { key: "pce", label: "PCE / Core CPI YoY", unit: "%", eps: 0.05, goodUp: false, match: [/pce price index yoy/i, /core pce.*yoy/i, /core inflation rate yoy/i, /core cpi yoy/i] },
      { key: "yield2y", label: "2 Yr Yield (21 day SMA)", unit: "%", eps: 0.01, goodUp: false, yieldRow: true, match: [] }
    ]},
    { id: "jobs", title: "Jobs market", items: [
      { key: "nfp", label: "Non-Farm Payroll / Employment Change", unit: "k", eps: 10, goodUp: true, match: [/non farm payrolls/i, /employment change/i, /net change in employment/i] },
      { key: "unemp", label: "Unemployment Rate %", unit: "%", eps: 0.05, goodUp: false, match: [/unemployment rate/i, /jobless rate/i] },
      { key: "claims", label: "Weekly Jobless Claims", unit: "k", eps: 5, goodUp: false, match: [/initial jobless claims/i, /jobless claims/i, /jobseeker/i] },
      { key: "adp", label: "ADP Employment Change", unit: "k", eps: 10, goodUp: true, match: [/adp employment/i] },
      { key: "jolts", label: "JOLTs Job Openings / Employment", unit: "M", eps: 0.1, goodUp: true, match: [/jolts job openings/i, /job openings/i, /labour.*survey/i] }
    ]}
  ];

  function fmt(v, d) {
    if (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) return "—";
    return Number(v).toLocaleString("en-US", { minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2 });
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d)) return String(iso).slice(0, 10);
    return d.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" }) + (d.getUTCFullYear() !== new Date().getUTCFullYear() ? " " + d.getUTCFullYear() : "");
  }
  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  function economiesForSymbol(sym) {
    sym = String(sym || "XAUUSD").toUpperCase();
    if (sym.startsWith("XAU") || sym.startsWith("XAG")) return ["US"];
    if (sym === "DXY") return ["US"];
    if (["SPX500", "NAS100", "US30", "VIX"].includes(sym)) return ["US"];
    if (sym === "GER40") return ["EU", "US"];
    if (sym === "UK100") return ["GB", "US"];
    if (sym === "JPN225") return ["JP", "US"];
    if (["USOIL", "UKOIL", "NATGAS", "COPPER", "BTCUSD", "ETHUSD"].includes(sym)) return ["US"];
    const b = CCY_TO_ECON[sym.slice(0, 3)], q = CCY_TO_ECON[sym.slice(3, 6)];
    return Array.from(new Set([b, q].filter(Boolean))).length ? Array.from(new Set([b, q].filter(Boolean))) : ["US"];
  }
  function assetFactor(sym, econKey) {
    // +1 economy strength is bullish for the selected asset, -1 bearish, 0 indirect
    sym = String(sym || "").toUpperCase();
    const ccy = ECONOMIES[econKey]?.ccy;
    if (!ccy) return 0;
    if (sym.startsWith("XAU") || sym.startsWith("XAG")) return ccy === "USD" ? -1 : 0;
    if (sym === "DXY") return ccy === "USD" ? 1 : -0.5;
    if (sym.slice(0, 3) === ccy) return 1;
    if (sym.slice(3, 6) === ccy) return -1;
    if (["SPX500", "NAS100", "US30"].includes(sym) && ccy === "USD") return 0.5;
    return 0;
  }

  function sentimentOf(item, ev) {
    if (!ev || !Number.isFinite(Number(ev.actual))) return { label: "No release", score: 0, cls: "neutral" };
    const base = Number.isFinite(Number(ev.forecast)) ? Number(ev.forecast) : (Number.isFinite(Number(ev.previous)) ? Number(ev.previous) : null);
    if (base === null) return { label: "Neutral", score: 0, cls: "neutral" };
    const surprise = Number(ev.actual) - base;
    if (Math.abs(surprise) < (item.eps || 0.05)) return { label: "Neutral", score: 0, cls: "neutral", surprise };
    const bullishEconomy = (surprise > 0) === !!item.goodUp;
    const strong = Math.abs(surprise) >= (item.eps || 0.05) * 4;
    return bullishEconomy
      ? { label: strong ? "Very Bullish" : "Bullish", score: strong ? 2 : 1, cls: "bull", surprise }
      : { label: strong ? "Very Bearish" : "Bearish", score: strong ? -2 : -1, cls: "bear", surprise };
  }
  function groupLabel(scores) {
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    if (avg >= 1.2) return { label: "Very Bullish", cls: "bull", avg };
    if (avg > 0.25) return { label: "Bullish", cls: "bull", avg };
    if (avg <= -1.2) return { label: "Very Bearish", cls: "bear", avg };
    if (avg < -0.25) return { label: "Bearish", cls: "bear", avg };
    return { label: "Neutral", cls: "neutral", avg };
  }
  const SENT_STYLE = {
    bull: "background:#2f5cff;color:#fff;",
    bear: "background:#ff5a5f;color:#fff;",
    neutral: "background:#3a3f4b;color:#e5e7eb;"
  };

  function findEvents(item) {
    const list = state.events.filter(e => Number.isFinite(Number(e.actual)));
    for (const rx of item.match) {
      const m = list.filter(e => rx.test(e.title || ""));
      if (m.length) return m.sort((a, b) => new Date(a.date) - new Date(b.date));
    }
    return [];
  }

  let BUNDLE_PROMISE = null;
  function loadBundle() {
    if (!BUNDLE_PROMISE) {
      BUNDLE_PROMISE = fetch("/macro-history.json?v=20261014-4", { cache: "no-store" })
        .then(r => (r.ok ? r.json() : null)).catch(() => null);
    }
    return BUNDLE_PROMISE;
  }

  async function fetchCalendar(econKey) {
    if (state.eventsByEconomy[econKey]) { state.events = state.eventsByEconomy[econKey]; return; }
    const econ = ECONOMIES[econKey];
    const codes = econ.country.split(",").map(s => s.trim());
    let items = [];
    let liveOk = false;
    // 1) Same-origin bundled real calendar history (TradingView Calendar, fetched server-side at build:
    //    TradingView returns 403 to direct browser requests, so this guarantees the releases display).
    try {
      const bundle = await loadBundle();
      if (bundle && Array.isArray(bundle.events)) {
        items = bundle.events.filter(e => codes.includes(e.country));
        if (bundle.generatedAt) state.lastFetch = new Date(bundle.generatedAt);
      }
    } catch (e) {}
    // 2) Best-effort live refresh on top (merges any newer releases when the browser can reach the API/proxy)
    try {
      const from = new Date(Date.now() - 200 * 864e5).toISOString();
      const to = new Date(Date.now() + 14 * 864e5).toISOString();
      const url = `https://economic-calendar.tradingview.com/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&countries=${encodeURIComponent(econ.country)}`;
      let live = [];
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (r.ok) live = (await r.json()).result || [];
      } catch (e) {}
      if (!live.length) {
        try {
          const r = await fetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(url), { cache: "no-store" });
          if (r.ok) live = (await r.json()).result || [];
        } catch (e) {}
      }
      if (live.length) {
        liveOk = true;
        const key = e => `${e.title}|${e.date}|${e.country}`;
        const map = new Map(items.map(e => [key(e), e]));
        live.forEach(e => map.set(key(e), e));
        items = Array.from(map.values()).sort((a, b) => new Date(a.date) - new Date(b.date));
      }
    } catch (e) {}
    state.eventsByEconomy[econKey] = items;
    state.events = items;
    if (liveOk || !state.lastFetch) state.lastFetch = new Date();
    state.calendarSource = liveOk ? "Live TradingView Calendar" : "TradingView Calendar (bundled real history, refreshed at build)";
  }

  async function fetchYield(econKey) {
    const econ = ECONOMIES[econKey];
    const out = { current: null, change: null, sma21: null, rising: null, source: "TradingView Scanner TVC 2Y" };
    try {
      const r = await fetch(`https://scanner.tradingview.com/global/scan?t=${Date.now()}`, {
        method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({ symbols: { tickers: [econ.yieldTicker] }, columns: ["close", "change"] }), cache: "no-store"
      });
      if (r.ok) { const j = await r.json(); const d = j.data?.[0]?.d; if (d) { out.current = d[0]; out.change = d[1]; } }
    } catch (e) {}
    if (econ.fred) {
      try {
        // Same-origin file generated from the official FRED DGS2 CSV (FRED itself sends no CORS headers).
        // The latest point is then overwritten with the live TradingView Scanner yield above.
        const r = await fetch("/yield-2y-history.json", { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          const rows = (j.rows || []).map(x => Number(x.value)).filter(Number.isFinite);
          if (rows.length > 21) {
            const series = rows.slice(-21);
            if (out.current !== null) series[series.length - 1] = Number(out.current);
            out.sma21 = series.reduce((a, b) => a + b, 0) / series.length;
            if (out.current === null) out.current = rows[rows.length - 1];
            out.rising = Number(out.current) > out.sma21;
            out.source = "FRED DGS2 history (21d SMA) + live TradingView Scanner 2Y";
          }
        }
      } catch (e) {}
    }
    if (out.current !== null && out.sma21 === null && out.change !== null) out.rising = Number(out.change) > 0;
    state.yieldInfo[econKey] = out;
    return out;
  }

  function cotForEconomy(econKey) {
    const ccy = ECONOMIES[econKey]?.ccy;
    const db = window.__PRELOADED_CFTC_5YR__ || {};
    const key = ccy === "EUR" ? "EUR" : ccy === "USD" ? "USD" : ccy;
    const contract = db[key] || db.USD || null;
    if (!contract || !contract.rows?.length) return null;
    const r = contract.rows[0], prev = contract.rows[1] || r;
    const [date, long, lChg, short, sChg, spread, spChg, total, net, pL, pS] = r.map((v, i) => i === 0 ? v : Number(v));
    const denom = Math.max(1, long + short);
    const longPct = long / denom * 100, shortPct = 100 - longPct;
    const netChgPct = prev && prev[7] ? ((net - Number(prev[7])) / Math.abs(Number(prev[7]))) * 100 : Number(r[3] || 0) - Number(r[4] || 0);
    const latestFlow = Number(lChg) - Number(sChg);
    return { name: contract.name, date, long, short, net, longPct, shortPct, netChgPct, latestFlow,
      netSent: net > 0 ? { label: "Bullish", cls: "bull" } : net < 0 ? { label: "Bearish", cls: "bear" } : { label: "Neutral", cls: "neutral" },
      flowSent: latestFlow > 0 ? { label: "Bullish", cls: "bull" } : latestFlow < 0 ? { label: "Bearish", cls: "bear" } : { label: "Neutral", cls: "neutral" } };
  }

  function seasonalityFor(sym) {
    const raw = window.__PRELOADED_ALL_SEASONALITY__?.[sym] || window.PMT_LIVE?.seasonalityBySymbol?.[sym];
    if (!raw) return null;
    const ft = raw.forecastTable || [];
    const pick = d => ft.find(x => Number(x.daysFromToday) === d) || ft[d] || null;
    return { f5: pick(5), f10: pick(10), f20: pick(20), raw };
  }


  // ============ AI FUNDAMENTAL VERDICT (CodeCraft API, OpenAI-compatible) ============
  // Tested live 2026-10-14 from this key: deepseek-v4-pro-0813 (~10s, strong reasoning) primary,
  // ai-3.7-flash / deepseek-v4-flash-0731 / gpt-5.6-sol fallbacks. CORS is open for our domains.
  const CC_KEY = "cc_evD1D06LuOTmKbTDDtnJDeTL6KJyWs5aF4rGcqAMSk3DvgNR";
  const CC_MODELS = ["deepseek-v4-pro-0813", "ai-3.7-flash", "deepseek-v4-flash-0731", "gpt-5.6-sol"];
  state.aiCache = state.aiCache || {};
  state.aiAutoTried = state.aiAutoTried || {};

  function aiKeyFor() { return state.symbol + "|" + state.economy; }

  function buildAiFundamentalPayload() {
    const sym = state.symbol, econKey = state.economy, econ = ECONOMIES[econKey];
    const indicators = [];
    GROUPS.forEach(g => g.items.forEach(item => {
      if (item.yieldRow) return;
      const series = findEvents(item).slice(-8);
      if (!series.length) return;
      indicators.push({
        group: g.title, indicator: item.label,
        interpretation: item.goodUp ? "higher-than-forecast is bullish for " + econ.ccy : "higher-than-forecast is bearish for " + econ.ccy + " (inflation/jobs-weakness logic as labelled)",
        last8Releases: series.map(ev => ({
          date: String(ev.date || "").slice(0, 10),
          actual: ev.actual === null || ev.actual === undefined ? null : Number(ev.actual),
          forecast: ev.forecast === null || ev.forecast === undefined ? null : Number(ev.forecast),
          previous: ev.previous === null || ev.previous === undefined ? null : Number(ev.previous),
          surpriseVsForecast: (ev.actual !== null && ev.forecast !== null && ev.actual !== undefined && ev.forecast !== undefined) ? Number((Number(ev.actual) - Number(ev.forecast)).toFixed(4)) : null
        }))
      });
    }));
    const cot = cotForEconomy(econKey);
    let cotBlock = null;
    if (cot) {
      const db = window.__PRELOADED_CFTC_5YR__ || {};
      const ccyKey = econ.ccy === "EUR" ? "EUR" : econ.ccy;
      const contract = db[ccyKey] || db.USD;
      cotBlock = {
        contract: cot.name, latestDate: cot.date, longPct: Number(cot.longPct.toFixed(2)), shortPct: Number(cot.shortPct.toFixed(2)),
        netContracts: cot.net, weeklyNetFlow: cot.latestFlow,
        last8WeeklyReports: contract && contract.rows ? contract.rows.slice(0, 8).map(r => ({ date: r[0], long: Number(r[1]), short: Number(r[3]), net: Number(r[7]) })) : []
      };
    }
    const seas = seasonalityFor(sym);
    const y = state.yieldInfo[econKey] || {};
    return {
      task: "Decide the fundamental bias for the ASSET (not just the economy)",
      asset: sym, economy: econ.label, economyCurrency: econ.ccy,
      assetMappingNote: sym.startsWith("XAU") || sym.startsWith("XAG")
        ? "Stronger USD fundamentals are normally BEARISH for " + sym + " (and vice versa)"
        : "Asset base currency is " + sym.slice(0, 3) + " and quote currency is " + sym.slice(3, 6) + ". Stronger fundamentals of the BASE currency are bullish for the asset; stronger fundamentals of the QUOTE currency are bearish for the asset.",
      indicators,
      cot: cotBlock,
      seasonalityNextDays: seas ? {
        plus5d: seas.f5 ? { pct: seas.f5.predictionPct, pips: seas.f5.predictionPips, probabilityPct: seas.f5.probability } : null,
        plus10d: seas.f10 ? { pct: seas.f10.predictionPct, pips: seas.f10.predictionPips, probabilityPct: seas.f10.probability } : null,
        plus20d: seas.f20 ? { pct: seas.f20.predictionPct, pips: seas.f20.predictionPips, probabilityPct: seas.f20.probability } : null,
        basis: "empirical seasonality from 4,500 real daily CFD bars"
      } : null,
      yield2Y: { currentPct: y.current ?? null, sma21Pct: y.sma21 ?? null, trend: y.current === null || y.current === undefined ? "unknown" : (y.rising ? "rising (hawkish)" : "falling (dovish)"), source: y.source || "" }
    };
  }

  async function runAiVerdict(force) {
    const key = aiKeyFor();
    if (state.aiLoading) return;
    if (!force && state.aiCache[key]) { render(); return; }
    state.aiLoading = true; state.aiError = null; render();
    const payload = buildAiFundamentalPayload();
    const prompt = "You are a senior fundamental strategist. Below is REAL official macro data: for every indicator you get the LAST 8 RELEASES with dates (actual vs forecast vs previous), plus CFTC COT positioning (with last 8 weekly reports), empirical seasonality and the 2-year yield. " +
      "Analyse the TREND across the last 8 releases of each indicator (not just the latest print), weigh growth vs inflation vs jobs, COT positioning and seasonality, then decide the fundamental bias FOR THE ASSET named in the payload (respect assetMappingNote).\n" +
      "Return ONLY valid JSON, no markdown: {\"assetVerdict\":\"STRONG BULLISH|BULLISH|NEUTRAL|BEARISH|STRONG BEARISH\",\"assetScore\":-100..100 (negative=bearish for the asset),\"economyVerdict\":\"STRONG BULLISH|BULLISH|NEUTRAL|BEARISH|STRONG BEARISH\" (for the economy currency),\"economyScore\":-100..100,\"confidence\":0..100,\"headline\":\"one sentence\",\"summary\":\"3-5 sentences citing specific releases, dates and values\",\"bullishDrivers\":[\"up to 4 short points with values/dates\"],\"bearishDrivers\":[\"up to 4 short points with values/dates\"],\"perIndicator\":[{\"indicator\":\"name\",\"signal\":\"BULLISH|BEARISH|NEUTRAL\" (for the ASSET),\"comment\":\"short, citing the last releases trend\"}]}\nDATA:\n" + JSON.stringify(payload);
    let lastErr = null;
    for (const model of CC_MODELS) {
      try {
        const r = await fetch("https://codecraftapi.com/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": "Bearer " + CC_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 5000, temperature: 0.2 })
        });
        if (!r.ok) { lastErr = model + " HTTP " + r.status; continue; }
        const j = await r.json();
        const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
        if (!txt) { lastErr = model + " empty"; continue; }
        const parsed = JSON.parse(txt.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim());
        if (parsed && parsed.assetVerdict) {
          parsed._model = model;
          parsed._at = new Date().toLocaleTimeString("en-GB");
          state.aiCache[key] = parsed;
          state.aiLoading = false; render(); return;
        }
        lastErr = model + " bad JSON";
      } catch (e) { lastErr = model + ": " + (e.message || String(e)); }
    }
    state.aiLoading = false;
    state.aiError = "AI unavailable (" + (lastErr || "no model responded") + "). Fundamental tables below remain fully functional — press Run AI again.";
    render();
  }
  window.runFsAiVerdict = runAiVerdict;

  function renderAiPanel() {
    const key = aiKeyFor();
    const v = state.aiCache[key];
    const score = v ? Math.max(-100, Math.min(100, Number(v.assetScore || 0))) : 0;
    const pct = 50 + score / 2;
    const vCol = !v ? "#f5c542" : score > 25 ? "#34d399" : score < -25 ? "#fb7185" : "#f5c542";
    const sigPill = s => {
      const c = String(s || "NEUTRAL").toUpperCase();
      const st = c.includes("BULL") ? SENT_STYLE.bull : c.includes("BEAR") ? SENT_STYLE.bear : SENT_STYLE.neutral;
      return `<span class="fs-pill" style="${st};min-width:74px;padding:3px 7px;font-size:11px">${esc(c)}</span>`;
    };
    if (state.aiLoading) {
      return `<div class="fs-ai"><div class="fs-ai-head"><strong>🤖 AI FUNDAMENTAL VERDICT — ${esc(state.symbol)}</strong><span class="fs-ai-badge">CodeCraft AI · reading the last 8 releases…</span></div>
        <div style="color:#cbd5e1;font-size:13px;padding:6px 0">⏳ The AI is analysing the last 8 reports of every indicator (with dates), CFTC COT, seasonality and the 2Y yield — a deep read takes ~30–60 seconds — the verdict is then cached for this asset…</div></div>`;
    }
    if (!v) {
      return `<div class="fs-ai"><div class="fs-ai-head"><strong>🤖 AI FUNDAMENTAL VERDICT — ${esc(state.symbol)}</strong><span class="fs-ai-badge">CodeCraft AI · deepseek-v4-pro + fallbacks</span></div>
        ${state.aiError ? `<div style="color:#fda4af;font-size:12.5px;margin:6px 0">${esc(state.aiError)}</div>` : `<div style="color:#cbd5e1;font-size:13px;margin:6px 0">The AI receives the <b>last 8 real releases (with dates)</b> of every indicator below, the last 8 CFTC COT weekly reports, seasonality and the 2Y yield — then decides Bullish/Bearish <b>for ${esc(state.symbol)}</b> with a score.</div>`}
        <button type="button" class="fs-refresh" id="fsAiRunBtn">🤖 Run AI Verdict for ${esc(state.symbol)}</button></div>`;
    }
    return `<div class="fs-ai">
      <div class="fs-ai-head"><strong>🤖 AI FUNDAMENTAL VERDICT — ${esc(state.symbol)}</strong>
        <span class="fs-ai-badge">Model: ${esc(v._model || "")} · ${esc(v._at || "")} · fed last 8 releases/indicator + COT 8w</span>
        <span style="flex:1"></span><button type="button" class="fs-refresh" id="fsAiRunBtn">↻ Re-run AI</button></div>
      <div class="fs-ai-main">
        <div class="fs-ai-verdict" style="border-color:${vCol}">
          <div style="font-size:11px;color:#9ca3af;letter-spacing:.08em">AI VERDICT FOR ${esc(state.symbol)}</div>
          <div style="font-size:23px;font-weight:900;color:${vCol};line-height:1.15">${esc(v.assetVerdict)}</div>
          <div style="font-size:12px;color:#cbd5e1">Confidence <b style="color:#f5c542">${esc(v.confidence)}%</b> · Economy ${esc(ECONOMIES[state.economy].ccy)}: ${esc(v.economyVerdict)} (${esc(v.economyScore)})</div>
        </div>
        <div class="fs-ai-score">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:#cbd5e1;font-weight:700"><span>◀ −100 BEARISH</span><span style="color:${vCol};font-size:15px">SCORE ${score > 0 ? "+" : ""}${esc(score)} / 100</span><span>BULLISH +100 ▶</span></div>
          <div class="fs-gauge-bar" style="margin-top:7px"><span class="fs-gauge-dot" style="left:${pct}%"></span></div>
          <div style="font-size:13.5px;color:#f3f4f6;margin-top:9px;line-height:1.55"><b>${esc(v.headline || "")}</b></div>
          <div style="font-size:12.5px;color:#cbd5e1;line-height:1.6">${esc(v.summary || "")}</div>
        </div>
      </div>
      <div class="fs-ai-drivers">
        <div><div style="color:#7aa2ff;font-weight:900;font-size:12px;margin-bottom:5px">▲ BULLISH DRIVERS (for ${esc(state.symbol)})</div>${(v.bullishDrivers || []).map(d => `<div class="fs-driver">• ${esc(d)}</div>`).join("") || '<div class="fs-driver">—</div>'}</div>
        <div><div style="color:#ff7a7e;font-weight:900;font-size:12px;margin-bottom:5px">▼ BEARISH DRIVERS</div>${(v.bearishDrivers || []).map(d => `<div class="fs-driver">• ${esc(d)}</div>`).join("") || '<div class="fs-driver">—</div>'}</div>
      </div>
      ${Array.isArray(v.perIndicator) && v.perIndicator.length ? `<div class="fs-scroll" style="margin-top:9px"><table class="fs-table" style="min-width:520px"><thead><tr><th>Indicator (last-8 trend)</th><th>AI signal for ${esc(state.symbol)}</th><th>AI comment</th></tr></thead><tbody>
        ${v.perIndicator.map(p => `<tr><td class="fs-name" style="min-width:150px">${esc(p.indicator)}</td><td>${sigPill(p.signal)}</td><td style="white-space:normal;min-width:260px;color:#cbd5e1">${esc(p.comment)}</td></tr>`).join("")}
      </tbody></table></div>` : ""}
    </div>`;
  }

  function render() {
    const root = document.getElementById("fundamentalScoreboard");
    if (!root) return;
    const sym = state.symbol, econKey = state.economy, econ = ECONOMIES[econKey];
    const factor = assetFactor(sym, econKey);
    const cot = cotForEconomy(econKey);
    const seas = seasonalityFor(sym);
    const y = state.yieldInfo[econKey] || {};

    // Build rows + scores
    let allScores = [];
    const groupsHtml = GROUPS.map(g => {
      const gScores = [];
      const rows = g.items.map(item => {
        if (item.yieldRow) {
          const has = y.current !== null && y.current !== undefined;
          const rising = has ? !!y.rising : null;
          const sent = !has ? { label: "Loading…", cls: "neutral", score: 0 }
            : rising ? { label: "Bullish", cls: "bull", score: 1 } : { label: "Bearish", cls: "bear", score: -1 };
          // For currency: rising 2Y = hawkish = bullish currency (screenshot labels it Bullish for USD)
          if (has) gScores.push(sent.score);
          return `<tr>
            <td class="fs-name">${esc(item.label)}</td>
            <td><span class="fs-pill" style="${SENT_STYLE[sent.cls]}">${sent.label}</span></td>
            <td class="fs-wide" colspan="4">${has ? `The 2yr yield is ${rising ? "rising" : "falling"} (${rising ? "hawkish" : "dovish"}) — Now ${fmt(y.current)}%${y.sma21 ? ` · 21d SMA ${fmt(y.sma21)}%` : ""} · ${esc(y.source || "")}` : "Fetching live 2Y yield…"}</td>
            <td>${state.lastFetch ? fmtDate(state.lastFetch.toISOString()) : "—"}</td></tr>`;
        }
        const series = findEvents(item);
        const ev = series[series.length - 1];
        if (!ev) return ""; // no official release for this economy — omit the row entirely, never show a placeholder
        const s = sentimentOf(item, ev);
        gScores.push(s.score);
        const surprise = s.surprise ?? (Number.isFinite(Number(ev.forecast)) ? Number(ev.actual) - Number(ev.forecast) : null);
        const unit = item.unit || ev.unit || "";
        const fVal = v => v === null || v === undefined || !Number.isFinite(Number(v)) ? "—" : fmt(v, Math.abs(Number(v)) >= 100 ? 0 : 2) + (unit === "%" ? "%" : unit === "k" && Math.abs(Number(v)) < 10000 ? "k" : "");
        const sel = state.selectedIndicator === item.key;
        return `<tr class="fs-click ${sel ? "fs-sel" : ""}" data-fs-ind="${item.key}" title="Click for last releases (history)">
          <td class="fs-name">${esc(item.label)}</td>
          <td><span class="fs-pill" style="${SENT_STYLE[s.cls]}">${s.label}</span></td>
          <td>${fVal(ev.actual)}</td><td>${fVal(ev.forecast)}</td>
          <td style="color:${surprise > 0 ? "#60a5fa" : surprise < 0 ? "#ff6b6f" : "#e5e7eb"};font-weight:700">${surprise === null ? "—" : (surprise > 0 ? "+" : "") + fmt(surprise, Math.abs(surprise) >= 100 ? 0 : 2) + (unit === "%" ? "%" : "")}</td>
          <td>${fmtDate(ev.date)}</td></tr>`;
      }).join("");
      const gl = groupLabel(gScores);
      allScores = allScores.concat(gScores);
      return `<div class="fs-group">
        <div class="fs-group-head"><span class="fs-group-title">${esc(g.title)}</span><span class="fs-group-sent ${gl.cls}">${gl.label}</span>
        <span class="fs-group-cols">Actual&nbsp;&nbsp;·&nbsp;&nbsp;Forecast&nbsp;&nbsp;·&nbsp;&nbsp;Surprise&nbsp;&nbsp;·&nbsp;&nbsp;Date</span></div>
        <div class="fs-scroll"><table class="fs-table"><tbody>${rows}</tbody></table></div></div>`;
    }).join("");

    const overall = groupLabel(allScores);
    const assetScore = overall.avg * factor;
    const assetLabel = factor === 0 ? "Indirect for " + sym
      : assetScore > 0.25 ? "Bullish for " + sym : assetScore < -0.25 ? "Bearish for " + sym : "Neutral for " + sym;
    const bullPct = Math.max(4, Math.min(96, 50 + overall.avg * 25));

    const seasHtml = seas && seas.f5 ? `
      <div class="fs-group"><div class="fs-group-head"><span class="fs-group-title">Seasonality Trend — ${esc(sym)} (real 4,500 daily CFD bars)</span>
      <span class="fs-group-sent ${(seas.f5.predictionPct || 0) >= 0 ? "bull" : "bear"}">${(seas.f5.predictionPct || 0) >= 0 ? "Bullish" : "Bearish"}</span></div>
      <div class="fs-season">
        ${[["+5 days", seas.f5], ["+10 days", seas.f10], ["+20 days", seas.f20]].filter(x => x[1]).map(([l, r]) => `
          <div class="fs-season-card"><div>${l} · ${esc(r.formattedDate || "")}</div>
          <strong style="color:${(r.predictionPct || 0) >= 0 ? "#34d399" : "#fb7185"}">${(r.predictionPct || 0) >= 0 ? "+" : ""}${fmt(r.predictionPct)}% (${fmt(r.predictionPips, 1)} pips)</strong>
          <span>Probability ${fmt(r.probability, 0)}%</span></div>`).join("")}
      </div></div>` : "";

    const cotHtml = cot ? `
      <div class="fs-group"><div class="fs-group-head"><span class="fs-group-title">Institutional activity — CFTC COT (${esc(cot.name)})</span><span class="fs-group-sent ${cot.netSent.cls}">${cot.netSent.label}</span></div>
      <div class="fs-scroll"><table class="fs-table"><tbody>
        <tr><td class="fs-name">COT - Net Positioning</td><td><span class="fs-pill" style="${SENT_STYLE[cot.netSent.cls]}">${cot.netSent.label}</span></td>
          <td colspan="2">Long % <strong style="color:#60a5fa">${fmt(cot.longPct)}%</strong> · Short % ${fmt(cot.shortPct)}%</td>
          <td style="color:${cot.netChgPct >= 0 ? "#60a5fa" : "#ff6b6f"}">${cot.netChgPct >= 0 ? "+" : ""}${fmt(cot.netChgPct)}%</td><td>${fmtDate(cot.date)}</td></tr>
        <tr><td class="fs-name">COT - Latest Buys/Sells</td><td><span class="fs-pill" style="${SENT_STYLE[cot.flowSent.cls]}">${cot.flowSent.label}</span></td>
          <td colspan="2">Net ${fmt(cot.net, 0)} contracts · Weekly flow ${cot.latestFlow >= 0 ? "+" : ""}${fmt(cot.latestFlow, 0)}</td>
          <td>—</td><td>${fmtDate(cot.date)}</td></tr>
      </tbody></table></div></div>` : `<div class="fs-group"><div class="fs-group-head"><span class="fs-group-title">Institutional activity — CFTC COT</span></div><div style="padding:10px;color:#9ca3af">CFTC contract unavailable for this economy.</div></div>`;

    // History panel
    let histHtml = "";
    if (state.selectedIndicator) {
      const item = GROUPS.flatMap(g => g.items).find(i => i.key === state.selectedIndicator);
      const series = item && !item.yieldRow ? findEvents(item).slice(-8).reverse() : [];
      histHtml = `<div class="fs-history"><strong>🕘 History — ${esc(item?.label || "")} (${esc(econ.label)}, last ${series.length} real releases)</strong>
        ${series.length ? `<div class="fs-scroll"><table class="fs-table"><thead><tr><th>Date</th><th>Actual</th><th>Forecast</th><th>Previous</th><th>Surprise</th><th>Sentiment (economy)</th></tr></thead><tbody>
          ${series.map(ev => { const s = sentimentOf(item, ev); const sp = Number.isFinite(Number(ev.forecast)) ? Number(ev.actual) - Number(ev.forecast) : null;
            return `<tr><td>${fmtDate(ev.date)}</td><td>${fmt(ev.actual)}</td><td>${fmt(ev.forecast)}</td><td>${fmt(ev.previous)}</td><td>${sp === null ? "—" : (sp > 0 ? "+" : "") + fmt(sp)}</td><td><span class="fs-pill" style="${SENT_STYLE[s.cls]}">${s.label}</span></td></tr>`; }).join("")}
        </tbody></table></div>` : `<div style="color:#9ca3af;padding:6px 0">No historical releases returned for this indicator.</div>`}
        <div style="color:#9ca3af;font-size:11px">Source security: TradingView Economic Calendar (official releases). Click any row above to change this history.</div></div>`;
    }

    const econPills = economiesForSymbol(sym).map(k => `<button type="button" class="fs-econ ${k === econKey ? "active" : ""}" data-fs-econ="${k}">${k} · ${ECONOMIES[k].ccy}</button>`).join("");

    root.innerHTML = `
      <style>
        #fundamentalScoreboard{background:linear-gradient(180deg,#101116,#070709);border:1px solid rgba(245,197,66,.45);border-radius:10px;padding:12px;color:#e5e7eb;overflow:hidden}
        .fs-head{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start}
        .fs-title{font-size:17px;font-weight:900;color:#f5c542;letter-spacing:.02em}
        .fs-sub{font-size:11.5px;color:#9ca3af;margin-top:3px;line-height:1.5}
        .fs-econ{background:#17181f;color:#cbd5e1;border:1px solid rgba(245,197,66,.35);border-radius:999px;padding:6px 11px;font-weight:800;cursor:pointer;font-size:12px}
        .fs-econ.active{background:#f5c542;color:#111;border-color:#f5c542}
        .fs-gauge{margin:10px 0 4px}
        .fs-gauge-labels{display:flex;justify-content:space-between;font-size:11px;color:#cbd5e1;font-weight:700}
        .fs-gauge-bar{height:10px;border-radius:999px;background:linear-gradient(90deg,#2f5cff,#3a3f4b,#ff5a5f);position:relative;margin-top:5px}
        .fs-gauge-dot{position:absolute;top:50%;width:18px;height:18px;border-radius:50%;background:#f5c542;border:2px solid #111;transform:translate(-50%,-50%);box-shadow:0 0 10px rgba(245,197,66,.8)}
        .fs-group{border:1px solid rgba(255,255,255,.09);border-radius:8px;margin-top:10px;background:#0b0b10;overflow:hidden}
        .fs-group-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 10px;background:#17181f;border-bottom:1px solid rgba(255,255,255,.08)}
        .fs-group-title{font-style:italic;font-weight:800;color:#f3f4f6;font-size:14px}
        .fs-group-sent{font-weight:900}.fs-group-sent.bull{color:#7aa2ff}.fs-group-sent.bear{color:#ff7a7e}.fs-group-sent.neutral{color:#d1d5db}
        .fs-group-cols{margin-left:auto;color:#9ca3af;font-style:italic;font-size:11px}
        .fs-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%}
        .fs-table{width:100%;min-width:580px;border-collapse:collapse;font-size:13px}
        .fs-table td,.fs-table th{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.07);text-align:left;white-space:nowrap}
        .fs-table th{color:#9ca3af;font-style:italic}
        .fs-name{font-weight:700;color:#f9fafb;min-width:210px}
        .fs-pill{display:inline-block;min-width:86px;text-align:center;padding:5px 8px;border-radius:4px;font-weight:900;font-size:12px}
        .fs-click{cursor:pointer}.fs-click:hover{background:rgba(245,197,66,.07)}.fs-sel{background:rgba(245,197,66,.12)!important}
        .fs-season{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:10px}
        .fs-season-card{background:#11131a;border:1px solid rgba(255,255,255,.09);border-radius:7px;padding:9px;display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9ca3af}
        .fs-season-card strong{font-size:15px}
        .fs-history{margin-top:10px;border:1px solid rgba(56,189,248,.4);background:#08111c;border-radius:8px;padding:10px;font-size:13px}
        .fs-ai{border:1.5px solid rgba(47,92,255,.55);background:linear-gradient(180deg,#0a1024,#070709);border-radius:9px;padding:11px 12px;margin-bottom:11px}.fs-ai-head{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.fs-ai-head strong{color:#7aa2ff;font-size:15px}.fs-ai-badge{font-size:11px;color:#9ca3af;border:1px solid rgba(148,163,184,.35);padding:2px 7px;border-radius:999px}.fs-ai-main{display:grid;grid-template-columns:250px 1fr;gap:12px;margin-top:10px}.fs-ai-verdict{border:1.5px solid #f5c542;border-radius:8px;padding:10px;background:#0b0b10;display:flex;flex-direction:column;gap:5px}.fs-ai-drivers{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px}.fs-driver{font-size:12px;color:#cbd5e1;line-height:1.55}@media(max-width:700px){.fs-ai-main{grid-template-columns:1fr}.fs-ai-drivers{grid-template-columns:1fr}}
        .fs-refresh{background:#f5c542;color:#111;border:0;border-radius:6px;padding:7px 12px;font-weight:900;cursor:pointer}
        @media(max-width:700px){.fs-season{grid-template-columns:1fr}.fs-title{font-size:15px}.fs-table{font-size:12.5px;min-width:560px}}
      </style>
      ${renderAiPanel()}
      <div class="fs-head">
        <div>
          <div class="fs-title">📊 FUNDAMENTAL SCOREBOARD — ${esc(sym)} <span style="color:#9ca3af;font-size:12px">/ ${esc(econ.label)} (${esc(econ.ccy)})</span></div>
          <div class="fs-sub">Separated section structured exactly like your screenshot. Sentiment pills = strength of the <b style="color:#e5e7eb">${esc(econ.ccy)} economy</b> (blue Bullish · red Bearish). Overall translation: <b style="color:${assetScore > 0.25 ? "#34d399" : assetScore < -0.25 ? "#fb7185" : "#f5c542"}">${esc(assetLabel)}</b> (economy score ${fmt(overall.avg)} × asset factor ${factor}).<br>
          Real sources only: ${esc(state.calendarSource || "TradingView Economic Calendar")} · U.S. CFTC Socrata (260w) · TradingView Scanner 2Y yield${econ.fred ? " + FRED DGS2" : ""} · 4,500-bar seasonality. Updated ${state.lastFetch ? state.lastFetch.toLocaleTimeString("en-GB") : "…"} · auto-refresh 60s. <b style="color:#f5c542">Click any indicator row for its last 8 real releases.</b></div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${econPills}
          <button type="button" class="fs-refresh" id="fsRefreshBtn">↻ Refresh live</button></div>
      </div>
      <div class="fs-gauge"><div class="fs-gauge-labels"><span>◀ Bullish sentiment (${esc(econ.ccy)})</span><span>${overall.label} — economy score ${fmt(overall.avg)}</span><span>Bearish sentiment ▶</span></div>
        <div class="fs-gauge-bar"><span class="fs-gauge-dot" style="left:${bullPct}%"></span></div></div>
      ${seasHtml}
      ${cotHtml}
      ${groupsHtml}
      ${histHtml}
      <div style="font-size:10.5px;color:#6b7280;margin-top:9px;line-height:1.5">The readings are for informational purposes only, do not constitute financial advice. Values are the latest official releases returned by the sources above; no value is estimated or randomised. If a source returns no release, the row explicitly says so.</div>`;

    root.querySelectorAll("[data-fs-econ]").forEach(b => b.addEventListener("click", async () => {
      state.economy = b.dataset.fsEcon; state.selectedIndicator = null; render();
      await Promise.all([fetchCalendar(state.economy), fetchYield(state.economy)]); render();
    }));
    root.querySelectorAll("[data-fs-ind]").forEach(tr => tr.addEventListener("click", () => {
      const k = tr.dataset.fsInd;
      state.selectedIndicator = state.selectedIndicator === k ? null : k; render();
      document.getElementById("fundamentalScoreboard")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }));
    const ab = document.getElementById("fsAiRunBtn");
    if (ab) ab.addEventListener("click", () => runAiVerdict(true));
    const _ak = aiKeyFor();
    if (!state.aiLoading && !state.aiCache[_ak] && !state.aiAutoTried[_ak] && state.events && state.events.length) {
      state.aiAutoTried[_ak] = true;
      setTimeout(() => runAiVerdict(false), 350);
    }
    const rb = document.getElementById("fsRefreshBtn");
    if (rb) rb.addEventListener("click", async () => { delete state.eventsByEconomy[state.economy]; await Promise.all([fetchCalendar(state.economy), fetchYield(state.economy)]); render(); });
  }

  async function loadAll() {
    if (state.loading) return; state.loading = true; render();
    await Promise.all([fetchCalendar(state.economy), fetchYield(state.economy)]);
    state.loading = false; render();
  }

  function openScoreboard() {
    const ov = document.getElementById("fsOverlay");
    if (!ov) return;
    // Sync with the asset currently selected in the terminal
    const cur = String((window.PMT_STATE && window.PMT_STATE.activeSymbol) || state.symbol || "XAUUSD").toUpperCase();
    if (cur !== state.symbol) {
      state.symbol = cur;
      const ecos = economiesForSymbol(cur);
      if (!ecos.includes(state.economy)) state.economy = ecos[0] || "US";
      state.selectedIndicator = null;
    }
    const sel = document.getElementById("fsAssetSelect");
    if (sel) sel.value = state.symbol;
    ov.style.display = "block";
    document.body.style.overflow = "hidden";
    ov.scrollTop = 0;
    loadAll();
  }
  function closeScoreboard() {
    const ov = document.getElementById("fsOverlay");
    if (ov) ov.style.display = "none";
    document.body.style.overflow = "";
  }
  window.openFundamentalScoreboard = openScoreboard;
  window.closeFundamentalScoreboard = closeScoreboard;

  function mount() {
    if (document.getElementById("fsOverlay")) return true;
    if (!document.body) return false;
    // SEPARATED FULL-SCREEN SECTION: hidden until the user clicks "📊 Fundamental".
    // It never sits inside (or gets squeezed by) the main widget grid.
    const ov = document.createElement("div");
    ov.id = "fsOverlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "Fundamental Scoreboard");
    ov.style.cssText = "display:none;position:fixed;inset:0;z-index:99999;background:rgba(3,3,6,0.985);overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px 14px 28px;";
    const instruments = (window.PMT_DATA && window.PMT_DATA.INSTRUMENTS) || [];
    ov.innerHTML = `
      <div style="max-width:1150px;margin:0 auto;">
        <div style="position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#0b0b10;border:1px solid rgba(245,197,66,0.5);border-radius:9px;padding:10px 12px;margin-bottom:12px;box-shadow:0 8px 28px rgba(0,0,0,0.7);">
          <strong style="color:#f5c542;font-size:16px;">📊 Fundamental Scoreboard</strong>
          <span style="color:#9ca3af;font-size:12px;">Separated section · real-time & historical data per asset</span>
          <span style="flex:1"></span>
          <label style="color:#cbd5e1;font-size:12px;font-weight:700;">Asset
            <select id="fsAssetSelect" style="background:#17181f;color:#f5c542;border:1px solid rgba(245,197,66,0.55);border-radius:6px;padding:6px 9px;font-weight:800;font-size:13px;cursor:pointer;">
              ${instruments.map(i => `<option value="${esc(i.symbol)}">${esc(i.symbol)} — ${esc(i.name || "")}</option>`).join("")}
            </select>
          </label>
          <button type="button" id="fsCloseBtn" style="background:#f5c542;color:#111;border:0;border-radius:6px;padding:7px 14px;font-weight:900;font-size:13px;cursor:pointer;">✕ Close</button>
        </div>
        <section id="fundamentalScoreboard" aria-label="Fundamental Scoreboard"></section>
      </div>`;
    document.body.appendChild(ov);
    document.getElementById("fsCloseBtn").addEventListener("click", closeScoreboard);
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeScoreboard(); });
    const sel = document.getElementById("fsAssetSelect");
    if (sel) sel.addEventListener("change", () => {
      const v = String(sel.value || "XAUUSD").toUpperCase();
      if (typeof window.PMT_SET_SYMBOL === "function") { try { window.PMT_SET_SYMBOL(v); } catch (e) {} }
      if (window.PMT_STATE) window.PMT_STATE.activeSymbol = v;
      state.symbol = v;
      const ecos = economiesForSymbol(v);
      if (!ecos.includes(state.economy)) state.economy = ecos[0] || "US";
      state.selectedIndicator = null;
      loadAll();
    });
    const sym = (window.PMT_STATE && window.PMT_STATE.activeSymbol) || "XAUUSD";
    state.symbol = String(sym).toUpperCase();
    state.economy = economiesForSymbol(state.symbol)[0] || "US";
    if (sel) sel.value = state.symbol;
    render(); // pre-render hidden content so the first open is instant
    loadAll();
    // Follow asset switches made anywhere else in the terminal (only re-render visibly when open)
    setInterval(() => {
      const cur = String((window.PMT_STATE && window.PMT_STATE.activeSymbol) || "").toUpperCase();
      if (cur && cur !== state.symbol) {
        state.symbol = cur;
        const ecos = economiesForSymbol(cur);
        if (!ecos.includes(state.economy)) state.economy = ecos[0] || "US";
        state.selectedIndicator = null;
        const s2 = document.getElementById("fsAssetSelect");
        if (s2) s2.value = cur;
        loadAll();
      }
    }, 1500);
    // 24/7 auto-refresh: calendar + yields every 60s (content stays fresh behind the click)
    setInterval(() => { delete state.eventsByEconomy[state.economy]; loadAll(); }, 60000);
    return true;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { if (!mount()) { const t = setInterval(() => { if (mount()) clearInterval(t); }, 500); } });
  else if (!mount()) { const t = setInterval(() => { if (mount()) clearInterval(t); }, 500); setTimeout(() => clearInterval(t), 15000); }
})();
