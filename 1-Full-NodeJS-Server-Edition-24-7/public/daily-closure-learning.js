/* XAU-ELITE-FONDA — Daily Closure & AI Learning Engine
   After every daily market closure (UTC rollover):
   1) The finished daily candle (real OHLC captured live all day from the TradingView
      Scanner: open/high/low/close) is stored and merged into every chart dataset —
      technical charts, seasonality, AI future-candle table & chart re-anchor on it.
   2) The AI forecast that predicted that candle is GRADED (hit/miss, close error %,
      mistake pattern). The graded track record + mistake patterns are exposed via
      window.XEF_GET_LESSONS(symbol) and injected into the next AI bias run (block 15),
      so the AI learns and does not repeat the same mistakes.
   3) A fresh next-candle forecast is triggered for the new day.
   Storage is per-browser (localStorage): the longer the terminal is used daily,
   the richer the real closed-candle series and the AI track record become. */
(function () {
  "use strict";
  const LS_CLOSED = "xef_closed_candles_v1";
  const LS_FORMING = "xef_forming_candle_v1";
  const LS_LEDGER = "xef_forecast_ledger_v1";
  const LS_CLOSURE_DAY = "xef_last_closure_day_v1";
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v === null || v === undefined ? d : v; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const todayUTC = () => new Date().toISOString().slice(0, 10);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (v, d) => (v === null || v === undefined || !Number.isFinite(Number(v))) ? "—" : Number(v).toFixed(d ?? 2);

  // ---------- Track record & lessons (available immediately for the AI prompt) ----------
  function dirOf(bias) { const b = String(bias || "").toUpperCase(); return b.includes("BULL") ? 1 : b.includes("BEAR") ? -1 : 0; }

  function computeLessons(sym) {
    const ledger = load(LS_LEDGER, []);
    const mine = ledger.filter(r => r.symbol === sym);
    const pool = (mine.filter(r => r.status === "evaluated").length >= 3 ? mine : ledger).filter(r => r.status === "evaluated");
    const recent = pool.slice(-20);
    if (!recent.length) {
      return { evaluatedForecasts: 0, note: "No graded forecasts yet. Grading starts automatically after the first daily closure following an AI forecast — every closed candle then teaches the next prediction." };
    }
    const hits = recent.filter(r => r.hit).length;
    const patterns = {};
    recent.filter(r => !r.hit).forEach(r => (r.mistakeTags || ["generalMiss"]).forEach(t => { patterns[t] = (patterns[t] || 0) + 1; }));
    const top = Object.entries(patterns).sort((a, b) => b[1] - a[1]);
    const instructions = [];
    if (patterns.opposedMomentum20) instructions.push("You missed " + patterns.opposedMomentum20 + "x by forecasting AGAINST the 20-day completed-candle momentum. Today: if your bias opposes 20d momentum, you need an exceptional, explicit reason — otherwise follow structure or cut conviction below 60.");
    if (patterns.highConvictionMiss) instructions.push("You missed " + patterns.highConvictionMiss + "x at conviction >= 80. Today: reserve 80+ ONLY for full alignment (structure + momentum + seasonality + COT + macro); anything less caps at 75.");
    if (patterns.seasonalityLedMiss) instructions.push("You missed " + patterns.seasonalityLedMiss + "x by following seasonality against candle structure. Today: seasonality may adjust conviction, it may NOT override the previous-close structure.");
    if (patterns.counterPrevCandle) instructions.push("You missed " + patterns.counterPrevCandle + "x forecasting against the last completed candle's body/close location without follow-through evidence. Today: a counter-structure call needs a named reversal trigger (level + catalyst).");
    if (!instructions.length && recent.length) instructions.push("Your recent graded forecasts are performing — keep the same evidence discipline and do not force conviction when evidence conflicts.");
    return {
      evaluatedForecasts: recent.length,
      hits,
      accuracyPct: Math.round((hits / recent.length) * 100),
      mistakePatterns: patterns,
      topMistake: top.length ? top[0][0] : null,
      lastEvaluations: recent.slice(-6).map(r => ({
        symbol: r.symbol, targetDate: r.targetDate, forecastBias: r.bias, conviction: r.conviction,
        actualCandle: r.actual ? { o: r.actual.o, h: r.actual.h, l: r.actual.l, c: r.actual.c } : null,
        actualDirection: r.actualDirection, hit: r.hit,
        predictedClose: r.predicted?.close ?? null, closeErrorPct: r.closeErrorPct ?? null,
        mistakeTags: r.mistakeTags || []
      })),
      LESSONS_YOU_MUST_APPLY: instructions
    };
  }
  window.XEF_GET_LESSONS = computeLessons;

  // ---------- Closed-candle store & merge into all chart datasets ----------
  function mergeClosedIntoData() {
    const closed = load(LS_CLOSED, {});
    const seasAll = window.__PRELOADED_ALL_SEASONALITY__ || {};
    let merged = 0;
    Object.keys(closed).forEach(sym => {
      const seas = seasAll[sym];
      if (!seas || !Array.isArray(seas.recentRealCandles)) return;
      const byDate = new Map(seas.recentRealCandles.map(c => [c.date, c]));
      (closed[sym] || []).forEach(c => {
        byDate.set(c.date, { date: c.date, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v || 0, _closedLive: true });
        merged++;
      });
      seas.recentRealCandles = Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
      if (window.PMT_LIVE && window.PMT_LIVE.seasonalityBySymbol) window.PMT_LIVE.seasonalityBySymbol[sym] = seas;
    });
    return merged;
  }
  window.XEF_MERGE_CLOSED = mergeClosedIntoData;

  function getCompletedCandles(sym) {
    const seas = (window.__PRELOADED_ALL_SEASONALITY__ || {})[sym];
    const bars = (seas?.recentRealCandles || []).filter(c => c.date < todayUTC());
    return bars;
  }

  // ---------- Forecast ledger: record every new AI forecast, grade it at closure ----------
  function recordForecasts() {
    const bySym = window.PMT_LIVE?.aiBiasBySymbol || {};
    const ledger = load(LS_LEDGER, []);
    const have = new Set(ledger.map(r => r.symbol + "|" + r.targetDate));
    let changed = false;
    Object.keys(bySym).forEach(sym => {
      const ai = bySym[sym];
      if (!ai || !ai.dailyBias || !ai.forecastForDate) return;
      const key = sym + "|" + ai.forecastForDate;
      if (have.has(key)) return;
      const bars = getCompletedCandles(sym);
      const closes = bars.map(c => Number(c.close)).filter(Number.isFinite);
      const mom20 = closes.length > 20 ? ((closes[closes.length - 1] - closes[closes.length - 21]) / closes[closes.length - 21]) * 100 : 0;
      const prev = bars[bars.length - 1] || {};
      const seas = (window.__PRELOADED_ALL_SEASONALITY__ || {})[sym] || {};
      const f5 = (seas.forecastTable || []).find(x => Number(x.daysFromToday) === 5) || (seas.forecastTable || [])[0] || {};
      const pred = (Array.isArray(ai.aiFutureCandles) && ai.aiFutureCandles[0]) || {};
      ledger.push({
        symbol: sym, targetDate: ai.forecastForDate, bias: ai.dailyBias, conviction: Number(ai.conviction || 0),
        model: ai.model || "", generatedAt: new Date().toISOString(),
        predicted: { open: pred.open ?? null, high: pred.high ?? null, low: pred.low ?? null, close: pred.close ?? null },
        featuresAtForecast: {
          momentum20Pct: Number(mom20.toFixed(3)),
          prevCandleDirection: prev.close > prev.open ? "BULLISH" : prev.close < prev.open ? "BEARISH" : "FLAT",
          seasonality5dPct: Number(f5.predictionPct || 0)
        },
        status: "pending", hit: null, mistakeTags: []
      });
      have.add(key); changed = true;
    });
    if (changed) save(LS_LEDGER, ledger.slice(-400));
  }

  function evaluateLedger() {
    const ledger = load(LS_LEDGER, []);
    let changed = false;
    ledger.forEach(r => {
      if (r.status === "evaluated") return;
      if (!(r.targetDate < todayUTC())) return;
      const bars = getCompletedCandles(r.symbol);
      const actual = bars.find(c => c.date === r.targetDate) || null;
      if (!actual) return;
      const movePct = ((Number(actual.close) - Number(actual.open)) / Number(actual.open)) * 100;
      const actualDir = Math.abs(movePct) < 0.05 ? 0 : (movePct > 0 ? 1 : -1);
      const predDir = dirOf(r.bias);
      r.actual = { o: Number(actual.open), h: Number(actual.high), l: Number(actual.low), c: Number(actual.close) };
      r.actualDirection = actualDir > 0 ? "BULLISH" : actualDir < 0 ? "BEARISH" : "FLAT";
      r.hit = predDir === 0 ? Math.abs(movePct) < 0.3 : (predDir === actualDir);
      if (r.predicted && Number.isFinite(Number(r.predicted.close))) {
        r.closeErrorPct = Number((Math.abs(Number(r.predicted.close) - Number(actual.close)) / Number(actual.close) * 100).toFixed(3));
      }
      r.mistakeTags = [];
      if (!r.hit) {
        const f = r.featuresAtForecast || {};
        if (predDir !== 0 && Number(f.momentum20Pct || 0) !== 0 && Math.sign(Number(f.momentum20Pct)) !== predDir) r.mistakeTags.push("opposedMomentum20");
        if (Number(r.conviction || 0) >= 80) r.mistakeTags.push("highConvictionMiss");
        if (predDir !== 0 && Number(f.seasonality5dPct || 0) !== 0 && Math.sign(Number(f.seasonality5dPct)) === predDir && Math.sign(Number(f.momentum20Pct || 0)) === -predDir) r.mistakeTags.push("seasonalityLedMiss");
        if (f.prevCandleDirection && f.prevCandleDirection !== "FLAT" && dirOf(f.prevCandleDirection) === -predDir) r.mistakeTags.push("counterPrevCandle");
        if (!r.mistakeTags.length) r.mistakeTags.push("generalMiss");
      }
      r.status = "evaluated"; r.evaluatedAt = new Date().toISOString();
      changed = true;
    });
    if (changed) save(LS_LEDGER, ledger);
    return changed;
  }

  // ---------- Live capture of the forming candle; closure at UTC rollover ----------
  async function captureForming() {
    const D = window.PMT_DATA;
    if (!D || !Array.isArray(D.INSTRUMENTS)) return;
    const tickers = Array.from(new Set(D.INSTRUMENTS.map(i => i.scanTvSymbol || i.tvSymbol).filter(Boolean)));
    if (!tickers.length) return;
    let rows = [];
    try {
      const r = await fetch("https://scanner.tradingview.com/global/scan?t=" + Date.now(), {
        method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({ symbols: { tickers }, columns: ["open", "high", "low", "close"] }), cache: "no-store"
      });
      if (r.ok) rows = (await r.json()).data || [];
    } catch (e) { return; }
    const byTicker = new Map(rows.map(x => [x.s, x.d]));
    const forming = load(LS_FORMING, {});
    const today = todayUTC();
    let closedSomething = false;
    D.INSTRUMENTS.forEach(inst => {
      const d = byTicker.get(inst.scanTvSymbol || inst.tvSymbol);
      if (!d || !Number.isFinite(Number(d[3]))) return;
      const prevF = forming[inst.symbol];
      if (prevF && prevF.date < today && Number.isFinite(Number(prevF.c))) {
        // The stored forming candle belongs to a finished day -> it is now CLOSED.
        const closed = load(LS_CLOSED, {});
        closed[inst.symbol] = closed[inst.symbol] || [];
        if (!closed[inst.symbol].some(c => c.date === prevF.date)) {
          closed[inst.symbol].push({ date: prevF.date, o: Number(prevF.o), h: Number(prevF.h), l: Number(prevF.l), c: Number(prevF.c), source: "live-captured" });
          closed[inst.symbol] = closed[inst.symbol].sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-90);
          save(LS_CLOSED, closed);
          closedSomething = true;
        }
      }
      forming[inst.symbol] = { date: today, o: Number(d[0]), h: Number(d[1]), l: Number(d[2]), c: Number(d[3]) };
    });
    save(LS_FORMING, forming);
    if (closedSomething) onNewClosure();
  }

  function onNewClosure() {
    mergeClosedIntoData();
    evaluateLedger();
    renderTrackPanel();
    const lastDay = load(LS_CLOSURE_DAY, "");
    const today = todayUTC();
    if (lastDay !== today) {
      save(LS_CLOSURE_DAY, today);
      // Refresh charts/tables with the newly closed candle, then a fresh forecast for the new day.
      try {
        const sym = window.PMT_STATE?.activeSymbol;
        if (sym && typeof window.PMT_SET_SYMBOL === "function") window.PMT_SET_SYMBOL(sym);
      } catch (e) {}
      setTimeout(() => {
        try {
          const sym = window.PMT_STATE?.activeSymbol || "XAUUSD";
          if (typeof window.fetchAIDailyBiasForSymbol === "function") window.fetchAIDailyBiasForSymbol(sym, true);
        } catch (e) {}
      }, 4000);
    }
  }

  // ---------- SERVER 24/7 sync: official closed candles, graded ledger & forecasts (device-independent) ----------
  const LS_SERVER = "xef_server_state_v1";
  let serverAppliedDay = "";
  function apiBase() {
    try { return String(window.XEF_API_BASE || localStorage.getItem("xef_api_base") || "").replace(/\/$/, ""); } catch (e) { return ""; }
  }
  async function syncServerState() {
    try {
      const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch(apiBase() + "/api/learning/state?t=" + Date.now(), { cache: "no-store", signal: ctrl.signal });
      clearTimeout(to);
      if (!r.ok) return false;
      const j = await r.json();
      if (!j || !j.ok) return false;
      save(LS_SERVER, { at: new Date().toISOString(), todayUTC: j.todayUTC, status: j.status, ledger: j.ledger || [], forecastsToday: j.forecastsToday || {}, lessons: j.lessons || {} });
      // 1) Merge server closed candles (authoritative) into local store + datasets
      const closed = load(LS_CLOSED, {});
      Object.keys(j.closedCandles || {}).forEach(sym => {
        const map = new Map((closed[sym] || []).map(c => [c.date, c]));
        (j.closedCandles[sym] || []).forEach(c => map.set(c.date, { ...c, source: c.source || "server" }));
        closed[sym] = [...map.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-180);
      });
      save(LS_CLOSED, closed);
      mergeClosedIntoData();
      // 2) Apply TODAY's official server forecasts identically on every device (writes the day-lock)
      const today = todayUTC();
      const fcs = j.forecastsToday || {};
      let appliedActive = false;
      Object.keys(fcs).forEach(sym => {
        const fc = fcs[sym];
        if (!fc || !fc.dailyBias || fc.forecastForDate !== today) return;
        try { localStorage.setItem("xef_forecast_bias_v2_" + today + "_" + sym, JSON.stringify(fc)); } catch (e) {}
        if (window.PMT_LIVE) {
          if (!window.PMT_LIVE.aiBiasBySymbol) window.PMT_LIVE.aiBiasBySymbol = {};
          const cur = window.PMT_LIVE.aiBiasBySymbol[sym] || {};
          window.PMT_LIVE.aiBiasBySymbol[sym] = { ...cur, ...fc, lockedForDate: today };
        }
        if (sym === String(window.PMT_STATE?.activeSymbol || "XAUUSD").toUpperCase()) appliedActive = true;
      });
      if (appliedActive && serverAppliedDay !== today) {
        serverAppliedDay = today;
        try {
          const sym = window.PMT_STATE?.activeSymbol;
          if (sym && typeof window.PMT_SET_SYMBOL === "function") window.PMT_SET_SYMBOL(sym);
        } catch (e) {}
      }
      renderTrackPanel();
      return true;
    } catch (e) { return false; }
  }
  window.XEF_SYNC_SERVER = syncServerState;

  // ---------- Track Record & Learning: SEPARATED full-screen view (click to open) ----------
  function ensureTrackOverlay() {
    if (document.getElementById("xefTrackOverlay")) return;
    const ov = document.createElement("div");
    ov.id = "xefTrackOverlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "AI Track Record and Learning");
    ov.style.cssText = "display:none;position:fixed;inset:0;z-index:99998;background:rgba(3,3,6,0.985);overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px 14px 28px;";
    ov.innerHTML = '<div style="max-width:1000px;margin:0 auto;">' +
      '<div style="position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#0b0b10;border:1px solid rgba(245,197,66,0.55);border-radius:9px;padding:10px 12px;margin-bottom:12px;box-shadow:0 8px 28px rgba(0,0,0,0.7);">' +
      '<strong style="color:#f5c542;font-size:16px;">🎓 AI Track Record &amp; Learning</strong>' +
      '<span style="color:#9ca3af;font-size:12px;">Closed-candle grading · mistake patterns · lessons fed into tomorrow\'s forecast</span>' +
      '<span style="flex:1"></span>' +
      '<button type="button" id="xefTrackCloseBtn" style="background:#f5c542;color:#111;border:0;border-radius:6px;padding:7px 14px;font-weight:900;font-size:13px;cursor:pointer;">✕ Close</button></div>' +
      '<div id="xefTrackBody"></div></div>';
    document.body.appendChild(ov);
    const _cb = ov.querySelector ? ov.querySelector("#xefTrackCloseBtn") : null;
    if (_cb) _cb.addEventListener("click", closeTrackRecord);
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeTrackRecord(); });
    // Entry points: header button (next to the Fundamental button) + mobile quick pill
    try {
      const btns = Array.from(document.querySelectorAll("button"));
      const fundBtn = btns.find(b => (b.getAttribute("onclick") || "").includes("openFundamentalScoreboard"));
      if (fundBtn && !document.getElementById("xefTrackHeaderBtn")) {
        const b = document.createElement("button");
        b.type = "button"; b.id = "xefTrackHeaderBtn"; b.className = fundBtn.className || "ctrl-btn";
        b.setAttribute("style", "border-color:rgba(245,197,66,0.65);color:#f5c542;font-weight:800;");
        b.title = "Open AI Track Record & Learning: graded forecasts, accuracy, mistake patterns";
        b.textContent = "🎓 Learning";
        b.addEventListener("click", openTrackRecord);
        fundBtn.insertAdjacentElement("afterend", b);
      }
      const qb = document.getElementById("mobileQuickBar");
      if (qb && !document.getElementById("xefTrackPill")) {
        const p = document.createElement("button");
        p.type = "button"; p.id = "xefTrackPill"; p.className = "mq-pill"; p.textContent = "🎓 AI Track Record";
        p.addEventListener("click", openTrackRecord);
        qb.appendChild(p);
      }
    } catch (e) {}
  }
  function openTrackRecord() {
    ensureTrackOverlay();
    renderTrackPanel();
    const ov = document.getElementById("xefTrackOverlay");
    if (ov) { ov.style.display = "block"; document.body.style.overflow = "hidden"; ov.scrollTop = 0; }
  }
  function closeTrackRecord() {
    const ov = document.getElementById("xefTrackOverlay");
    if (ov) ov.style.display = "none";
    document.body.style.overflow = "";
  }
  window.openAiTrackRecord = openTrackRecord;
  window.closeAiTrackRecord = closeTrackRecord;

  function renderTrackPanel() {
    ensureTrackOverlay();
    const panel = document.getElementById("xefTrackBody");
    if (!panel) return;
    const sym = String(window.PMT_STATE?.activeSymbol || "XAUUSD").toUpperCase();
    const closed = load(LS_CLOSED, {});
    const myClosed = closed[sym] || [];
    const lastClosed = myClosed[myClosed.length - 1];
    const lessons = computeLessons(sym);
    const serverState = load(LS_SERVER, null);
    const ledgerSrc = (serverState && Array.isArray(serverState.ledger) && serverState.ledger.some(r => r.symbol === sym)) ? serverState.ledger : load(LS_LEDGER, []);
    const ledger = ledgerSrc.filter(r => r.symbol === sym).slice(-8).reverse();
    const forming = load(LS_FORMING, {})[sym];
    const ev = lessons.evaluatedForecasts || 0;
    const rows = ledger.map(r => {
      const st = r.status === "evaluated"
        ? (r.hit ? '<span style="color:#34d399;font-weight:900">✔ HIT</span>' : '<span style="color:#fb7185;font-weight:900">✘ MISS</span>')
        : '<span style="color:#f5c542;font-weight:800">⏳ Awaiting closure</span>';
      return '<tr style="border-bottom:1px solid rgba(148,163,184,0.12)">' +
        '<td style="padding:6px 8px;font-family:monospace;color:#f5c542">' + esc(r.targetDate) + '</td>' +
        '<td style="padding:6px 8px;font-weight:800;color:' + (dirOf(r.bias) > 0 ? "#34d399" : dirOf(r.bias) < 0 ? "#fb7185" : "#f5c542") + '">' + esc(r.bias) + ' (' + esc(r.conviction) + '%)</td>' +
        '<td style="padding:6px 8px;font-family:monospace;color:#cbd5e1">' + (r.actual ? ("O " + fmt(r.actual.o) + " · H " + fmt(r.actual.h) + " · L " + fmt(r.actual.l) + " · C " + fmt(r.actual.c)) : "—") + '</td>' +
        '<td style="padding:6px 8px">' + st + (r.closeErrorPct !== null && r.closeErrorPct !== undefined ? ' <span style="color:#94a3b8;font-size:11px">(close err ' + fmt(r.closeErrorPct) + '%)</span>' : "") + '</td>' +
        '<td style="padding:6px 8px;color:#fb7185;font-size:11.5px">' + esc((r.mistakeTags || []).join(", ")) + '</td></tr>';
    }).join("");
    panel.innerHTML =
    '<div style="background:linear-gradient(180deg,#0c0a08,#070709);border:1px solid rgba(245,197,66,0.5);border-radius:9px;padding:13px 15px">' +
      '<div style="font-size:15px;font-weight:900;color:#f5c542">🎓 AI TRACK RECORD &amp; LEARNING — ' + esc(sym) + '</div>' +
      (serverState ? '<div style="margin-top:7px;font-size:12.5px;color:#7dd3a8">🖥️ <b>SERVER 24/7 SYNCED</b> — official candles, grading &amp; forecasts come from the server (identical on every device, no refresh needed). Last server cycle: ' + esc((serverState.status && serverState.status.lastCycleAt) || serverState.at || "") + ' · Forecasts ready for ' + esc(serverState.todayUTC || "") + ': <b>' + Object.keys(serverState.forecastsToday || {}).length + '</b></div>' : '<div style="margin-top:7px;font-size:12.5px;color:#fbbf24">⚠️ Browser mode: no 24/7 server connected yet — capture/learning currently depends on this browser. Deploy the Node server edition (24/7) to make it fully automatic on every device.</div>') +
      '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:9px;font-size:12.5px;color:#cbd5e1">' +
        '<span>🕯️ Last closed candle captured: <b style="color:#f8fafc">' + (lastClosed ? (esc(lastClosed.date) + " · O " + fmt(lastClosed.o) + " H " + fmt(lastClosed.h) + " L " + fmt(lastClosed.l) + " C " + fmt(lastClosed.c)) : "none yet — captured live at the next daily closure (UTC rollover)") + '</b></span>' +
        '<span>📥 Closed candles stored for ' + esc(sym) + ': <b style="color:#f8fafc">' + myClosed.length + '</b></span>' +
        '<span>🎯 Graded forecasts: <b style="color:#f8fafc">' + ev + '</b>' + (ev ? ' · Accuracy: <b style="color:' + (lessons.accuracyPct >= 60 ? "#34d399" : "#fb7185") + '">' + lessons.accuracyPct + '%</b> (' + lessons.hits + '/' + ev + ' hits)' : "") + '</span>' +
        (forming ? '<span>🔴 Today forming: <b style="color:#f8fafc">' + esc(forming.date) + ' · O ' + fmt(forming.o) + ' H ' + fmt(forming.h) + ' L ' + fmt(forming.l) + ' C ' + fmt(forming.c) + '</b> (closes at UTC rollover)</span>' : "") +
      '</div>' +
      (lessons.LESSONS_YOU_MUST_APPLY
        ? '<div style="margin-top:9px;background:rgba(245,197,66,0.08);border:1px solid rgba(245,197,66,0.35);border-radius:6px;padding:8px 11px;font-size:12.5px;line-height:1.65;color:#e7e5e4"><b style="color:#f5c542">🧠 Lessons injected into your next AI forecast (input block 15):</b><br>' + lessons.LESSONS_YOU_MUST_APPLY.map(x => "• " + esc(x)).join("<br>") + '</div>'
        : '<div style="margin-top:9px;font-size:12.5px;color:#cbd5e1;line-height:1.6">📭 <b style="color:#f5c542">No graded forecasts yet for ' + esc(sym) + '.</b> This view fills automatically: when you run an AI forecast (Verify Bias), it is recorded below as <i>⏳ Awaiting closure</i>. After the next daily closure (UTC rollover), the finished candle appears here with its real OHLC, the forecast is graded ✔/✘ with its mistake pattern, and those lessons are fed into tomorrow\'s AI bias (input block 15).</div>') +
      (ledger.length ? '<div style="overflow-x:auto;margin-top:10px"><table style="width:100%;min-width:640px;border-collapse:collapse;font-size:12.5px"><thead><tr style="color:#94a3b8;text-align:left;border-bottom:1px solid rgba(245,197,66,0.35)"><th style="padding:6px 8px">Target candle</th><th style="padding:6px 8px">AI forecast (ex-ante)</th><th style="padding:6px 8px">Actual closed candle (OHLC)</th><th style="padding:6px 8px">Grade</th><th style="padding:6px 8px">Mistake pattern</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : "") +
      '<div style="font-size:11px;color:#9ca3af;margin-top:9px;line-height:1.6">How it works: all day, the real forming candle (TradingView Scanner OHLC) is tracked. At UTC rollover it becomes the CLOSED candle: it is merged into the technical/seasonality datasets (AI OHLC table &amp; Future Candles chart re-anchor on it), the pending forecast for that date is graded, mistake patterns are computed, and a fresh next-candle forecast — including the just-closed candle and these lessons — is generated. Keep the terminal open daily (or run the Node server edition) so every closure is captured. Asset follows the terminal\'s selected asset.</div>' +
    '</div>';
  }
  window.XEF_RENDER_TRACK = renderTrackPanel;



  function init() {
    ensureTrackOverlay();
    mergeClosedIntoData();
    evaluateLedger();
    renderTrackPanel();
    captureForming();
    setInterval(captureForming, 60000);          // track forming candle; closure fires at rollover
    setInterval(recordForecasts, 15000);         // ledger any new AI forecast
    setInterval(() => { evaluateLedger(); renderTrackPanel(); }, 60000);
    setInterval(recordForecasts, 5000);
    setTimeout(recordForecasts, 3000);
    setTimeout(syncServerState, 2500);          // pull official server state (any device)
    setInterval(syncServerState, 300000);        // re-sync every 5 minutes
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(init, 800));
  else setTimeout(init, 800);
})();
