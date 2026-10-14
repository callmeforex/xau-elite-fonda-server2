"use strict";
/**
 * XAU-ELITE-FONDA — SERVER-SIDE Daily Closure & AI Learning Engine (24/7, device-independent)
 * ---------------------------------------------------------------------------------------------
 * Runs inside the Node server edition. NO browser, NO user device, NO refresh needed:
 *  1. Every cycle it pulls REAL daily bars (TradingView CFD feed) for all instruments and
 *     stores every newly CLOSED daily candle server-side (data/closed-candles.json).
 *  2. It grades the previous ex-ante forecasts against the actual closed candles
 *     (data/forecast-ledger.json): HIT/MISS, close error %, mistake-pattern tags.
 *  3. It computes per-symbol LESSONS (accuracy, repeated mistake patterns, corrective rules).
 *  4. It generates TODAY's ex-ante next-candle forecast for every instrument with the
 *     CodeCraft AI chain — including the just-closed candle and the lessons — and stores it
 *     (data/daily-forecasts.json). Any browser/device then simply READS the official forecast
 *     via GET /api/learning/state — identical on every device.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const vm = require("vm");
const liveEngine = require("./live-provider-engine");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const F_CLOSED = path.join(DATA_DIR, "closed-candles.json");
const F_LEDGER = path.join(DATA_DIR, "forecast-ledger.json");
const F_FORECASTS = path.join(DATA_DIR, "daily-forecasts.json");
const F_STATUS = path.join(DATA_DIR, "engine-status.json");

const CC_BASE = "https://codecraftapi.com/v1";
const CC_KEY = process.env.CODECRAFT_API_KEY || "cc_evD1D06LuOTmKbTDDtnJDeTL6KJyWs5aF4rGcqAMSk3DvgNR";
const CC_MODELS = ["deepseek-v4-pro-max", "claude-opus-5.5", "deepseek-v4-pro-0813", "gpt-5.6-sol"];
const ALL_SYMBOLS = Object.keys(liveEngine.CFD_SYMBOLS || { XAUUSD: {} });
const FORECAST_SYMBOLS = (process.env.XEF_FORECAST_SYMBOLS || "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
const SYMBOLS_TO_FORECAST = FORECAST_SYMBOLS.length ? ALL_SYMBOLS.filter(s => FORECAST_SYMBOLS.includes(s)) : ALL_SYMBOLS;

const todayUTC = () => new Date().toISOString().slice(0, 10);
const load = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return dflt; } };
const save = (f, v) => { try { fs.writeFileSync(f, JSON.stringify(v)); } catch (e) { console.error("[closure-engine] save failed", f, e.message); } };
const dirOf = b => { const s = String(b || "").toUpperCase(); return s.includes("BULL") ? 1 : s.includes("BEAR") ? -1 : 0; };
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

let seasonalityCache = null, cotCache = null, macroCache = null;
function loadStaticDatasets() {
  if (!seasonalityCache) {
    try {
      const code = fs.readFileSync(path.join(__dirname, "public", "seasonality-all-34.js"), "utf8");
      const sandbox = { window: {} }; vm.createContext(sandbox); vm.runInContext(code, sandbox, { timeout: 20000 });
      seasonalityCache = sandbox.window.__PRELOADED_ALL_SEASONALITY__ || {};
    } catch (e) { seasonalityCache = {}; }
  }
  if (!cotCache) {
    try {
      const code = fs.readFileSync(path.join(__dirname, "public", "cot-5yr-all.js"), "utf8");
      const sandbox = { window: {} }; vm.createContext(sandbox); vm.runInContext(code, sandbox, { timeout: 20000 });
      cotCache = sandbox.window.__PRELOADED_CFTC_5YR__ || {};
    } catch (e) { cotCache = {}; }
  }
  if (!macroCache) {
    try { macroCache = JSON.parse(fs.readFileSync(path.join(__dirname, "public", "macro-history.json"), "utf8")); }
    catch (e) { macroCache = { events: [] }; }
  }
}

async function getCompletedBars(sym) {
  let bars = await liveEngine.fetchTradingViewCfdBars(sym, "1D", 400).catch(() => []);
  if (!bars || bars.length < 30) {
    await new Promise(r => setTimeout(r, 900));
    bars = await liveEngine.fetchTradingViewCfdBars(sym, "1D", 400).catch(() => []);
  }
  const today = todayUTC();
  return (bars || [])
    .map(b => ({ date: String(b.date || (b.tsSec ? new Date(b.tsSec * 1000).toISOString().slice(0, 10) : "")), o: num(b.open), h: num(b.high), l: num(b.low), c: num(b.close) }))
    .filter(b => b.date && b.date < today && b.c !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function gradeLedger(closedStore, ledger) {
  let changed = false;
  for (const r of ledger) {
    if (r.status === "evaluated") continue;
    const candles = closedStore[r.symbol] || [];
    const actual = candles.find(c => c.date === r.targetDate);
    if (!actual) continue;
    const movePct = actual.o ? ((actual.c - actual.o) / actual.o) * 100 : 0;
    const actualDir = Math.abs(movePct) < 0.05 ? 0 : (movePct > 0 ? 1 : -1);
    const biasDir = dirOf(r.bias);
    r.actual = actual; r.actualMovePct = Number(movePct.toFixed(3));
    r.hit = biasDir === 0 ? Math.abs(movePct) < 0.3 : (biasDir === actualDir);
    r.closeErrorPct = (r.predicted && r.predicted.close && actual.c) ? Number((Math.abs(r.predicted.close - actual.c) / actual.c * 100).toFixed(3)) : null;
    r.mistakeTags = [];
    if (!r.hit) {
      const f = r.featuresAtForecast || {};
      if (biasDir !== 0 && Number(f.momentum20Pct || 0) * biasDir < 0 && Math.abs(Number(f.momentum20Pct || 0)) > 0.5) r.mistakeTags.push("opposedMomentum20");
      if (Number(r.conviction || 0) >= 80) r.mistakeTags.push("highConvictionMiss");
      if (Math.abs(Number(f.seasonality5dPct || 0)) > Math.abs(Number(f.momentum20Pct || 0)) && biasDir !== 0 && Math.sign(Number(f.seasonality5dPct || 0)) === biasDir) r.mistakeTags.push("seasonalityLedMiss");
      if (f.prevCandleDirection && dirOf(f.prevCandleDirection) !== 0 && biasDir !== 0 && dirOf(f.prevCandleDirection) !== biasDir) r.mistakeTags.push("counterPrevCandle");
      if (!r.mistakeTags.length) r.mistakeTags.push("generalMiss");
    }
    r.status = "evaluated"; r.evaluatedAt = new Date().toISOString(); changed = true;
  }
  return changed;
}

function computeLessons(ledger, sym) {
  const graded = ledger.filter(r => r.symbol === sym && r.status === "evaluated").slice(-20);
  if (!graded.length) return { evaluatedForecasts: 0, accuracyPct: 0, instructions: [] };
  const hits = graded.filter(r => r.hit).length;
  const patterns = {};
  graded.filter(r => !r.hit).forEach(r => (r.mistakeTags || []).forEach(t => { patterns[t] = (patterns[t] || 0) + 1; }));
  const top = Object.entries(patterns).sort((a, b) => b[1] - a[1]);
  const txt = {
    opposedMomentum20: "You repeatedly forecast AGAINST the 20-day momentum and lost. Today: align with 20-day momentum or cut conviction below 60.",
    highConvictionMiss: "Your high-conviction (>=80) calls have missed. Today: reserve 80+ conviction for multi-element agreement only.",
    seasonalityLedMiss: "Seasonality-led calls underperformed structure. Today: completed-candle structure dominates; seasonality only adjusts conviction.",
    counterPrevCandle: "Counter-previous-candle calls missed. Today: require extra confirmation before fading the previous completed candle.",
    generalMiss: "Review the last misses below and state explicitly what is different today."
  };
  return {
    evaluatedForecasts: graded.length, hits, accuracyPct: Math.round((hits / graded.length) * 100),
    mistakePatterns: patterns,
    instructions: top.slice(0, 3).map(([t, n]) => `[${t} x${n}] ${txt[t] || txt.generalMiss}`),
    recentGraded: graded.slice(-5).map(r => ({ date: r.targetDate, forecast: r.bias, conviction: r.conviction, result: r.hit ? "HIT" : "MISS", actualMovePct: r.actualMovePct, closeErrorPct: r.closeErrorPct, tags: r.mistakeTags }))
  };
}

function statsFor(bars) {
  const closes = bars.map(b => b.c);
  const ema = (arr, p) => { const k = 2 / (p + 1); let e = arr[0]; for (const v of arr) e = v * k + e * (1 - k); return e; };
  const mom = n => closes.length > n ? ((closes[closes.length - 1] - closes[closes.length - 1 - n]) / closes[closes.length - 1 - n]) * 100 : 0;
  const trs = bars.slice(-15).map((b, i, a) => i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - a[i - 1].c), Math.abs(b.l - a[i - 1].c)));
  return {
    lastCompletedClose: closes[closes.length - 1],
    ema20: Number(ema(closes.slice(-60), 20).toFixed(4)), ema50: Number(ema(closes.slice(-120), 50).toFixed(4)),
    momentum1dPct: Number(mom(1).toFixed(3)), momentum5dPct: Number(mom(5).toFixed(3)),
    momentum10dPct: Number(mom(10).toFixed(3)), momentum20dPct: Number(mom(20).toFixed(3)),
    atr14: Number((trs.reduce((a, b) => a + b, 0) / trs.length).toFixed(4))
  };
}

function ccChat(messages, maxTokens = 6000) {
  return new Promise(async resolve => {
    for (const model of CC_MODELS) {
      try {
        const out = await new Promise((res2, rej2) => {
          const body = JSON.stringify({ model, messages, temperature: 0.15, max_tokens: maxTokens });
          const req = https.request(CC_BASE + "/chat/completions", { method: "POST", timeout: 240000, headers: { "Content-Type": "application/json", "Authorization": "Bearer " + CC_KEY } }, r => {
            let d = ""; r.on("data", c => d += c); r.on("end", () => { try { res2(JSON.parse(d)); } catch (e) { rej2(e); } });
          });
          req.on("error", rej2); req.on("timeout", () => { req.destroy(new Error("timeout")); });
          req.write(body); req.end();
        });
        const content = out && out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content;
        if (content) return resolve({ model, content });
        LAST_CC_ERROR = model + " -> " + JSON.stringify(out).slice(0, 160);
      } catch (e) { /* try next model */ }
    }
    resolve(null);
  });
}

let LAST_CC_ERROR = "";
async function generateForecast(sym, bars, lessons) {
  const stats = statsFor(bars);
  const meta = (liveEngine.CFD_SYMBOLS || {})[sym] || {};
  const seas = (seasonalityCache || {})[sym] || {};
  const seasRows = (seas.forecastTable || []).slice(0, 5).map(r => ({ daysFromToday: r.daysFromToday, predictionPct: r.predictionPct, probabilityPct: r.probabilityPct }));
  const usEvents = ((macroCache && macroCache.events) || []).filter(e => e.country === "US" && e.actual !== null && e.actual !== undefined && e.actual !== "")
    .slice(-8).map(e => ({ date: e.date, event: e.event, actual: e.actual, forecast: e.forecast, previous: e.previous }));
  const dossier = {
    task: "EX-ANTE FORECAST of the NEXT daily candle. Use ONLY completed candles + day-open information. NEVER describe a candle that has already formed.",
    symbol: sym, instrument: meta.name || sym, forecastForDate: todayUTC(),
    lastCompletedCandle: bars[bars.length - 1],
    last30CompletedCandles: bars.slice(-30),
    statistics: stats,
    seasonalityForecastNext5: seasRows,
    last8USMacroReleases: usEvents,
    yourGradedTrackRecordAndLessons: lessons
  };
  const prompt =
    "You are the XAU-ELITE-FONDA AI forecasting engine (server edition). " + JSON.stringify(dossier) + "\n\n" +
    "RULES: Completed-candle structure (EMA20/50, momentum 1/5/10/20d, ATR) dominates the call; seasonality and macro only adjust conviction. If lessons exist, OBEY them and state in executiveSummary how you avoid the top mistake pattern. Anchor: aiFutureCandles Day+1 open MUST equal lastCompletedClose (" + stats.lastCompletedClose + "), each next open equals the previous predicted close.\n" +
    "Return ONLY valid JSON (no markdown): {dailyBias: STRONG BULLISH|BULLISH|NEUTRAL / RANGE|BEARISH|STRONG BEARISH, conviction: 50..94, masterScore: -10..10, forecastForDate: \"" + todayUTC() + "\", headlineThesis, executiveSummary, factorScores:{technicalScore,seasonalityScore,positioningScore,macroRatesScore} (-10..10 each), keyLevels:{biasPivot,entryZone,target1,target2,invalidationStop,riskReward}, whyPillars:[4x{title,verdict,explanation}], intradayPlaybook, aiFutureCandles:[10x{day,date,open,high,low,close,expectedDirection,expectedRangePips,confidencePct,mainDriver}], aiFutureNewsPredictions:[6x{eventTime,currency,eventName,consensusForecast,previousActual,aiPredictedOutcome,expectedAssetImpact,expectedMovePips,probabilityPct,tradingReactionPlan}]}";
  const res = await ccChat([{ role: "user", content: prompt }], 7000);
  if (!res) { LAST_CC_ERROR = "all AI models unreachable/empty"; return null; }
  let obj = null;
  try { obj = JSON.parse(res.content); } catch (e) {
    const m = res.content.match(/\{[\s\S]*\}/); if (m) { try { obj = JSON.parse(m[0]); } catch (e2) {} }
  }
  if (!obj || !obj.dailyBias) { LAST_CC_ERROR = "AI returned unparseable JSON"; return null; }
  obj.forecastForDate = todayUTC(); obj.model = res.model + " · CodeCraft (server 24/7)"; obj.generatedBy = "server-closure-engine";
  obj.generatedAt = new Date().toISOString();
  if (Array.isArray(obj.aiFutureCandles) && obj.aiFutureCandles.length) {
    let prevClose = stats.lastCompletedClose;
    obj.aiFutureCandles = obj.aiFutureCandles.slice(0, 10).map((c, i) => {
      const o = i === 0 ? prevClose : prevClose;
      const cl = num(c.close) !== null ? num(c.close) : o;
      const out = { ...c, day: i + 1, open: o, close: cl, high: Math.max(num(c.high) ?? cl, o, cl), low: Math.min(num(c.low) ?? cl, o, cl) };
      prevClose = cl; return out;
    });
  }
  return obj;
}

let running = false;
async function runCycle(reason = "schedule") {
  if (running) return { skipped: "already-running" };
  running = true;
  const status = load(F_STATUS, {});
  try {
    loadStaticDatasets();
    const closedStore = load(F_CLOSED, {});
    const ledger = load(F_LEDGER, []);
    const forecasts = load(F_FORECASTS, {});
    const today = todayUTC();
    forecasts[today] = forecasts[today] || {};

    // 1) Store newly closed candles (authoritative real history, all instruments)
    const report = { at: new Date().toISOString(), reason, symbols: {} };
    const barsBySym = {};
    for (const sym of ALL_SYMBOLS) {
      const bars = await getCompletedBars(sym).catch(() => []);
      barsBySym[sym] = bars;
      report.symbols[sym] = { barsFetched: bars.length, lastBar: bars.length ? bars[bars.length - 1].date : null };
      if (bars.length) {
        const map = new Map((closedStore[sym] || []).map(c => [c.date, c]));
        bars.slice(-120).forEach(b => map.set(b.date, { ...b, source: "server-history" }));
        closedStore[sym] = [...map.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-180);
      }
    }
    save(F_CLOSED, closedStore);

    // 2) Grade pending forecasts whose candle has now closed
    if (gradeLedger(closedStore, ledger)) save(F_LEDGER, ledger.slice(-600));

    // 3+4) Generate today's missing forecasts (lessons included), sequentially
    let generated = 0;
    for (const sym of SYMBOLS_TO_FORECAST) {
      if (forecasts[today][sym]) continue;
      const bars = barsBySym[sym] || [];
      if (bars.length < 30) continue;
      const lessons = computeLessons(ledger, sym);
      let fcBars = bars;
      if (!fcBars || fcBars.length < 30) {
        // Fallback: generate from the server's stored closed candles so a feed hiccup never blocks the forecast
        fcBars = (closedStore[sym] || []).map(c => ({ date: c.date, o: c.o, h: c.h, l: c.l, c: c.c }));
        if (fcBars.length >= 30) report.symbols[sym].forecastSource = "stored-closed-candles (feed fetch failed)";
      }
      if (!fcBars || fcBars.length < 30) { report.symbols[sym].forecast = "SKIPPED: only " + (fcBars ? fcBars.length : 0) + " bars available"; continue; }
      LAST_CC_ERROR = "";
      const fc = await generateForecast(sym, fcBars, lessons).catch(e => { LAST_CC_ERROR = String(e && e.message || e); return null; });
      report.symbols[sym].forecast = fc ? ("OK " + fc.dailyBias + " " + fc.conviction + "% via " + fc.model) : ("FAILED: " + (LAST_CC_ERROR || "unknown"));
      if (fc) {
        forecasts[today][sym] = fc; generated++;
        const lastC = fcBars[fcBars.length - 1];
        ledger.push({
          symbol: sym, targetDate: today, bias: fc.dailyBias, conviction: Number(fc.conviction || 0), model: fc.model,
          generatedAt: fc.generatedAt, generatedBy: "server",
          predicted: (fc.aiFutureCandles && fc.aiFutureCandles[0]) ? { open: fc.aiFutureCandles[0].open, high: fc.aiFutureCandles[0].high, low: fc.aiFutureCandles[0].low, close: fc.aiFutureCandles[0].close } : null,
          featuresAtForecast: { momentum20Pct: statsFor(fcBars).momentum20dPct, prevCandleDirection: lastC.c > lastC.o ? "BULLISH" : lastC.c < lastC.o ? "BEARISH" : "FLAT", seasonality5dPct: Number(((seasonalityCache || {})[sym]?.forecastTable || [])[0]?.predictionPct || 0) },
          status: "pending", hit: null, mistakeTags: []
        });
        save(F_FORECASTS, forecasts); save(F_LEDGER, ledger.slice(-600));
      }
      status.progress = { date: today, forecastsReady: Object.keys(forecasts[today]).length, forecastsTotal: SYMBOLS_TO_FORECAST.length, lastSymbol: sym, at: new Date().toISOString() };
      save(F_STATUS, status);
    }

    // prune old forecast days (keep 14)
    Object.keys(forecasts).sort().slice(0, -14).forEach(d => delete forecasts[d]);
    save(F_FORECASTS, forecasts);

    try { fs.writeFileSync(path.join(DATA_DIR, "cycle-report.json"), JSON.stringify(report, null, 1)); } catch (e) {}
    status.lastCycleAt = new Date().toISOString(); status.lastCycleDay = today; status.lastReason = reason;
    status.closedSymbols = Object.keys(closedStore).length;
    status.forecastsToday = Object.keys(forecasts[today]).length;
    save(F_STATUS, status);
    console.log(`[closure-engine] cycle done (${reason}) day=${today} newForecasts=${generated} ready=${status.forecastsToday}/${SYMBOLS_TO_FORECAST.length}`);
    return status;
  } catch (e) {
    console.error("[closure-engine] cycle error", e && e.message);
    status.lastError = String(e && e.message || e); status.lastErrorAt = new Date().toISOString(); save(F_STATUS, status);
    return status;
  } finally { running = false; }
}

function getState() {
  const closedStore = load(F_CLOSED, {});
  const ledger = load(F_LEDGER, []);
  const forecasts = load(F_FORECASTS, {});
  const today = todayUTC();
  const lessons = {};
  ALL_SYMBOLS.forEach(sym => { lessons[sym] = computeLessons(ledger, sym); });
  return {
    ok: true, serverTime: new Date().toISOString(), todayUTC: today,
    status: load(F_STATUS, {}),
    closedCandles: closedStore,
    ledger: ledger.slice(-300),
    forecastsToday: forecasts[today] || {},
    lessons
  };
}

function start() {
  console.log("[closure-engine] SERVER 24/7 Daily Closure & Learning engine started. Symbols:", ALL_SYMBOLS.length, "Forecast symbols:", SYMBOLS_TO_FORECAST.length);
  setTimeout(() => runCycle("boot-catchup"), 4000);
  setInterval(() => {
    const status = load(F_STATUS, {});
    if (status.lastCycleDay !== todayUTC()) runCycle("utc-rollover");
    else {
      const forecasts = load(F_FORECASTS, {});
      const ready = Object.keys(forecasts[todayUTC()] || {}).length;
      if (ready < SYMBOLS_TO_FORECAST.length) runCycle("resume-missing-forecasts");
    }
  }, 60000);
}

module.exports = { start, runCycle, getState, DATA_DIR };
