// XAU-ELITE-FONDA — Institutional CFD & Macro Server (Zero-Dependency Node.js)
// Powered by:
// - XAU-ELITE-FONDA Live CFD WebSocket (wss://pws.primemarket-terminal.com:8081)
// - TradingView Institutional CFD OHLCV Feed (wss://data.tradingview.com/socket.io/websocket — OANDA:XAUUSD, OANDA:EURJPY, etc.)
// - Official U.S. CFTC Socrata API (publicreporting.cftc.gov)
// - Reverse Proxy for XAU-ELITE-FONDA's TradingView Charting Library v22.032 (/charting_library/*)

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");
const liveEngine = require("./live-provider-engine");
const closureEngine = require("./daily-closure-engine");

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const TV_CACHE_DIR = path.join(__dirname, "live-cache", "tv_assets");
if (!fs.existsSync(TV_CACHE_DIR)) {
  fs.mkdirSync(TV_CACHE_DIR, { recursive: true });
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf"
};

function send(res, status, body, contentType = "text/html; charset=utf-8", extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Cache-Control": "no-cache",
    ...extraHeaders
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// Proxy /charting_library/* and /tradingview-custom.css from https://desk.prime-terminal.com
function proxyTradingViewAsset(reqPath, res) {
  const safeName = reqPath.replace(/[^a-zA-Z0-9._-]/g, "_");
  const cachePath = path.join(TV_CACHE_DIR, safeName);
  const ext = path.extname(reqPath.split("?")[0]).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  if (fs.existsSync(cachePath)) {
    try {
      const data = fs.readFileSync(cachePath);
      return send(res, 200, data, contentType, { "Cache-Control": "public, max-age=86400" });
    } catch {}
  }

  const targetUrl = `https://desk.prime-terminal.com${reqPath}`;
  https
    .get(
      targetUrl,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
          Referer: "https://desk.prime-terminal.com/",
          Origin: "https://desk.prime-terminal.com"
        }
      },
      (upRes) => {
        const chunks = [];
        upRes.on("data", (c) => chunks.push(c));
        upRes.on("end", () => {
          const buf = Buffer.concat(chunks);
          if (upRes.statusCode === 200 && buf.length > 0) {
            try { fs.writeFileSync(cachePath, buf); } catch {}
          }
          const ct = upRes.headers["content-type"] || contentType;
          send(res, upRes.statusCode || 200, buf, ct, { "Cache-Control": "public, max-age=86400" });
        });
      }
    )
    .on("error", (err) => {
      send(res, 502, `Upstream TV asset proxy error: ${err.message}`, "text/plain; charset=utf-8");
    });
}

async function buildLiveMacroAIResponse(query = "", symbol = "XAUUSD") {
  const sym = (symbol || "XAUUSD").toUpperCase();
  const ai = await liveEngine.generateGeminiDailyBias(sym, query, Boolean(query));
  const biasColor = String(ai.dailyBias || "").includes("BULL")
    ? "#34d399"
    : String(ai.dailyBias || "").includes("BEAR")
    ? "#fb7185"
    : "#f59e0b";

  const pillarsHtml = (ai.whyPillars || [])
    .map(
      (p) => `
      <div style="background:#0f172a;padding:9px 11px;border-radius:6px;border-left:3px solid ${String(p.verdict).includes("BULL") ? "#34d399" : String(p.verdict).includes("BEAR") ? "#fb7185" : "#38bdf8"};">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="font-size:11.5px;color:#f8fafc;">${p.title}</strong>
          <span style="font-size:10px;font-weight:800;padding:1px 6px;border-radius:4px;background:rgba(255,255,255,0.06);color:${String(p.verdict).includes("BULL") ? "#34d399" : String(p.verdict).includes("BEAR") ? "#fb7185" : "#38bdf8"};">${p.verdict}</span>
        </div>
        <div style="font-size:11.5px;color:#cbd5e1;margin-top:4px;line-height:1.5;">${p.explanation}</div>
      </div>`
    )
    .join("");

  const html = `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(249,115,22,0.35);padding-bottom:8px;flex-wrap:wrap;gap:6px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="background:rgba(56,189,248,0.18);color:#38bdf8;padding:2px 8px;border-radius:4px;font-size:10.5px;font-weight:800;">GOOGLE GEMINI (${ai.model}) · ${sym} (${ai.tvSymbol})</span>
          <span style="background:${biasColor}22;color:${biasColor};border:1px solid ${biasColor}66;padding:2px 9px;border-radius:4px;font-size:11px;font-weight:900;">DAILY BIAS: ${ai.dailyBias} (${ai.conviction}% CONVICTION)</span>
        </div>
        <span style="font-family:monospace;font-size:11px;color:#94a3b8;">Spot: <strong style="color:#fff;">${ai.spotPrice}</strong> · Pivot: <strong style="color:#f97316;">${ai.keyLevels?.biasPivot || "—"}</strong> · R:R <strong style="color:#34d399;">${ai.keyLevels?.riskReward || "1:2.5"}</strong></span>
      </div>
      <div style="font-size:12.5px;font-weight:800;color:#f8fafc;">${ai.headlineThesis || ""}</div>
      <div style="font-size:11.5px;color:#cbd5e1;line-height:1.55;">${ai.executiveSummary || ""}</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">${pillarsHtml}</div>
      <div style="background:rgba(249,115,22,0.08);border:1px solid rgba(249,115,22,0.3);padding:8px 11px;border-radius:6px;font-size:11.5px;color:#e2e8f0;">
        <strong style="color:#f97316;">INTRADAY EXECUTION PLAYBOOK:</strong> ${ai.intradayPlaybook || ""}
      </div>
    </div>
  `;
  return { Status: "Success", query, symbol: sym, ai, html };
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || "/";
  const query = parsed.query || {};

  if (req.method === "OPTIONS") {
    return send(res, 204, "");
  }

  // 0. Reverse Proxy for XAU-ELITE-FONDA's TradingView Charting Library v22.032 (/charting_library/* & /tradingview-custom.css)
  if (pathname.startsWith("/charting_library/") || pathname === "/tradingview-custom.css") {
    return proxyTradingViewAsset(req.url, res);
  }

  // 1. Live 24/7 SSE Stream (/api/stream) — Broadcasts real-time CFD ticks + 24/7 automatic multi-provider data sync
  if (pathname === "/api/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    sseClients.add(res);
    res.write(`data: ${JSON.stringify({ type: "connected", mode: "24/7 AUTO-SYNC ACTIVE", provider: "wss://pws.primemarket-terminal.com:8081", timestamp: new Date().toISOString() })}\n\n`);
    const unsub = liveEngine.onLiveCfdTick((tick) => {
      try {
        res.write(`data: ${JSON.stringify({ type: "price", ...tick })}\n\n`);
      } catch {}
    });
    const timer = setInterval(() => {
      try {
        res.write(`data: ${JSON.stringify({ type: "heartbeat", timestamp: new Date().toISOString() })}\n\n`);
      } catch {}
    }, 10000);
    req.on("close", () => {
      sseClients.delete(res);
      unsub();
      clearInterval(timer);
    });
    return;
  }

  // 2. LIVE REAL-PROVIDER API ENDPOINTS
  try {
    // XAU-ELITE-FONDA's exact TradingView Datafeed endpoint (from 4835.js: POST /api/pmt/getIQFeedHistoricalData)
    if (pathname === "/api/pmt/getIQFeedHistoricalData") {
      const body = req.method === "POST" ? await readJsonBody(req) : query;
      const sym = String(body.sym || body.symbol || query.symbol || "XAUUSD").toUpperCase();
      const resTf = String(body.res || body.resolution || query.timeframe || "1D");
      const chart = await liveEngine.getRealChartCandles(sym, resTf);
      const data = (chart.bars || []).map((b) => ({
        intervals: b.tsSec * 1000,
        time: b.tsSec * 1000,
        datetime: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume || 0
      }));
      return send(
        res,
        200,
        JSON.stringify({
          success: true,
          symbol: sym,
          tvSymbol: chart.tvSymbol,
          timeframe: resTf,
          data
        }),
        "application/json; charset=utf-8"
      );
    }

    if (pathname === "/api/pmt/cleanIQFeedCache") {
      return send(res, 200, JSON.stringify({ success: true }), "application/json; charset=utf-8");
    }

    if (pathname === "/api/live/bootstrap") {
      const symbol = String(query.symbol || "XAUUSD").toUpperCase();
      const timeframe = String(query.timeframe || "1D");
      // Return Seasonality & Chart immediately (<50ms) and only attach aiBias if it resolves within 350ms (otherwise /api/ai/daily-bias streams it asynchronously)
      const fastAiPromise = Promise.race([
        liveEngine.generateGeminiDailyBias(symbol).catch(() => null),
        new Promise((r) => setTimeout(() => r(null), 350))
      ]);
      const [snapshot, seasonality, chart, cftc, news, orderbook, aiBias] = await Promise.all([
        liveEngine.getLiveMarketSnapshot(),
        liveEngine.computeRealSeasonality(symbol),
        liveEngine.getRealChartCandles(symbol, timeframe),
        liveEngine.getRealCftcCotData(),
        liveEngine.getRealLiveNews(),
        liveEngine.getRealOrderbook(symbol),
        fastAiPromise
      ]);
      return send(
        res,
        200,
        JSON.stringify({
          ok: true,
          success: true,
          timestamp: new Date().toISOString(),
          symbol,
          timeframe,
          autoSync24x7: true,
          providers: [
            "XAU-ELITE-FONDA Official Live CFD WebSocket (wss://pws.primemarket-terminal.com:8081)",
            `TradingView Institutional CFD OHLCV (${seasonality.tvSymbol} — 4,500 Bars)`,
            "TradingView Global Scanner API (Live Sovereign Curves, ECONOMICS:* Central Banks/Macro, Equity Fundamentals)",
            "TradingView Official Economic Calendar API (economic-calendar.tradingview.com)",
            "U.S. CFTC Socrata Official TFF & Disaggregated API (publicreporting.cftc.gov)",
            "Swissquote Live Institutional Multi-Tier ECN Book + Binance Vision L2 Depth API",
            "CNBC Live Financial & Macro RSS",
            "Google Gemini AI Institutional Daily Bias Engine (generativelanguage.googleapis.com)"
          ],
          snapshot,
          seasonality,
          chart,
          chartData: chart,
          cftc,
          news,
          orderbook,
          aiBias
        }),
        "application/json; charset=utf-8"
      );
    }

    if (pathname === "/api/ai/daily-bias") {
      const body = req.method === "POST" ? await readJsonBody(req) : query;
      const symbol = String(body.symbol || query.symbol || "XAUUSD").toUpperCase();
      const question = String(body.question || query.question || "");
      const force = Boolean(body.force || query.force === "1" || query.force === "true");
      const data = await liveEngine.generateGeminiDailyBias(symbol, question, force);
      return send(res, 200, JSON.stringify({ success: true, data }), "application/json; charset=utf-8");
    }

    if (pathname === "/api/ai/classify-vip-post") {
      const body = req.method === "POST" ? await readJsonBody(req) : query;
      const postText = String(body.postText || body.text || query.postText || query.text || "");
      const vipAuthor = String(body.vipAuthor || body.author || query.vipAuthor || "Auto-Detect VIP");
      const data = await liveEngine.classifyVipPostWithGemini(postText, vipAuthor);
      return send(res, 200, JSON.stringify({ success: true, data }), "application/json; charset=utf-8");
    }

    if (pathname === "/api/live/vip-news") {
      const data = await liveEngine.getRealLiveNews();
      return send(res, 200, JSON.stringify({ success: true, data }), "application/json; charset=utf-8");
    }

    if (pathname === "/api/live/seasonality") {
      const symbol = String(query.symbol || "XAUUSD").toUpperCase();
      const data = await liveEngine.computeRealSeasonality(symbol);
      return send(res, 200, JSON.stringify({ success: true, data }), "application/json; charset=utf-8");
    }

    if (pathname === "/api/live/chart") {
      const symbol = String(query.symbol || "XAUUSD").toUpperCase();
      const timeframe = String(query.timeframe || "1D");
      const data = await liveEngine.getRealChartCandles(symbol, timeframe);
      return send(res, 200, JSON.stringify({ success: true, data }), "application/json; charset=utf-8");
    }

    if (pathname === "/api/live/cftc") {
      const data = await liveEngine.getRealCftcCotData();
      return send(res, 200, JSON.stringify({ success: true, data }), "application/json; charset=utf-8");
    }

    if (pathname === "/api/live/cftc-history") {
      const file5yr = path.join(__dirname, "live-cache", "cftc_5yr_all.json");
      if (fs.existsSync(file5yr)) {
        const raw = fs.readFileSync(file5yr, "utf8");
        return send(res, 200, raw, "application/json; charset=utf-8");
      }
      const data = await liveEngine.getRealCftcCotData();
      return send(res, 200, JSON.stringify({ success: true, data }), "application/json; charset=utf-8");
    }

    if (pathname === "/api/live/news") {
      const data = await liveEngine.getRealLiveNews();
      return send(res, 200, JSON.stringify({ success: true, data }), "application/json; charset=utf-8");
    }

    if (pathname === "/api/live/orderbook") {
      const symbol = String(query.symbol || "BTCUSDT").toUpperCase();
      const data = await liveEngine.getRealOrderbook(symbol);
      return send(res, 200, JSON.stringify({ success: true, data }), "application/json; charset=utf-8");
    }

    if (pathname === "/api/live/snapshot") {
      const data = await liveEngine.getLiveMarketSnapshot();
      return send(res, 200, JSON.stringify({ success: true, data }), "application/json; charset=utf-8");
    }

    // Compatible XAU-ELITE-FONDA Seasonality Endpoints (7030.js, 4526.js, 9263.js, 2507.js)
    if (pathname === "/api/seasonality/getSeasonalityForecastTableNew") {
      const body = req.method === "POST" ? await readJsonBody(req) : query;
      const sym = String(body.symbol || query.symbol || "XAUUSD").toUpperCase();
      const seas = await liveEngine.computeRealSeasonality(sym);
      return send(res, 200, JSON.stringify({ success: true, data: seas.forecastTable }), "application/json; charset=utf-8");
    }

    if (pathname === "/api/seasonality/getSeasonalityForecastChartNew") {
      const body = req.method === "POST" ? await readJsonBody(req) : query;
      const sym = String(body.symbol || query.symbol || "XAUUSD").toUpperCase();
      const seas = await liveEngine.computeRealSeasonality(sym);
      return send(
        res,
        200,
        JSON.stringify({
          success: true,
          symbol: sym,
          historicalCategory: seas.recentRealCandles.map((c) => ({ label: c.date })),
          historicalChartData: seas.recentRealCandles,
          category: seas.predictionCandles.map((c) => ({ label: c.date })),
          chartData: seas.predictionCandles.map((c) => ({
            forecast: c.forecast,
            upper_95: c.upper95,
            lower_95: c.lower95,
            upper_68: c.upper68,
            lower_68: c.lower68
          }))
        }),
        "application/json; charset=utf-8"
      );
    }

    if (pathname === "/api/ai/query" && req.method === "POST") {
      const body = await readJsonBody(req);
      const out = await buildLiveMacroAIResponse(body.query, body.symbol);
      return send(res, 200, JSON.stringify(out), "application/json; charset=utf-8");
    }
  } catch (err) {
    console.error("Live API Error on", pathname, err.message);
    return send(res, 500, JSON.stringify({ success: false, error: err.message }), "application/json; charset=utf-8");
  }

  // SERVER 24/7 Daily Closure & AI Learning state (device-independent official forecasts)
  if (pathname === "/api/learning/state") {
    return send(res, 200, JSON.stringify(closureEngine.getState()), "application/json; charset=utf-8");
  }
  if (pathname === "/api/learning/run") {
    closureEngine.runCycle("manual");
    return send(res, 202, JSON.stringify({ ok: true, message: "Closure & forecast cycle triggered (runs in background)" }), "application/json; charset=utf-8");
  }

  // 3. Any other /api/* endpoint
  if (pathname.startsWith("/api/")) {
    return send(
      res,
      200,
      JSON.stringify({
        Status: "Success",
        success: true,
        authenticated: true,
        user: {
          id: 1,
          email: "institutional@prime-terminal.com",
          name: "Prime Institutional Desk (Free Unlocked)",
          role: "institutional",
          plan: "institutional",
          subscriptionStatus: "active",
          isPro: true,
          verified: true
        },
        data: []
      }),
      "application/json; charset=utf-8"
    );
  }

  // 4. Main Workstation Routes (/, /desk, /terminal, /workspace/*, /analyze/*, /xauusd, /eurjpy, etc.)
  const cleanUpper = pathname.replace(/^\/+|\/+$/g, "").split("/").pop().toUpperCase();
  if (
    pathname === "/" ||
    pathname === "/desk" ||
    pathname === "/terminal" ||
    pathname.startsWith("/workspace/") ||
    pathname.startsWith("/analyze/") ||
    (liveEngine.CFD_SYMBOLS && liveEngine.CFD_SYMBOLS[cleanUpper])
  ) {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"));
    return send(res, 200, html, "text/html; charset=utf-8");
  }

  // 5. Marketing Landing Page (Payment & Launch Gate Deleted)
  if (pathname === "/landing" || pathname === "/home") {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, "landing.html"));
    return send(res, 200, html, "text/html; charset=utf-8");
  }

  // 6. Academy SPA (/academy and /academy/lesson/*)
  if (pathname === "/academy" || pathname.startsWith("/academy/")) {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, "academy.html"));
    return send(res, 200, html, "text/html; charset=utf-8");
  }

  // 7. Knowledge Base (/knowledge and /knowledge/*)
  if (pathname === "/knowledge" || pathname.startsWith("/knowledge/")) {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, "knowledge.html"));
    return send(res, 200, html, "text/html; charset=utf-8");
  }

  // 8. Static Assets in /public
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    return send(res, 200, fs.readFileSync(filePath), contentType);
  }

  // Fallback to workstation index.html
  const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"));
  return send(res, 200, html, "text/html; charset=utf-8");
});

const sseClients = new Set();

function broadcastSse(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch {
      sseClients.delete(client);
    }
  }
}

// 24/7 Continuous Background Data Refresh Scheduler (No manual update clicks needed)
setInterval(async () => {
  try {
    const [snapshot, news, orderbook] = await Promise.all([
      liveEngine.getLiveMarketSnapshot(),
      liveEngine.getRealLiveNews(),
      liveEngine.getRealOrderbook("XAUUSD")
    ]);
    broadcastSse({
      type: "auto_sync_snapshot",
      timestamp: new Date().toISOString(),
      snapshot,
      news,
      orderbook
    });
  } catch {}
}, 15000);

setInterval(async () => {
  try {
    const cftc = await liveEngine.getRealCftcCotData();
    broadcastSse({
      type: "auto_sync_cftc",
      timestamp: new Date().toISOString(),
      cftc
    });
  } catch {}
}, 60000);

server.listen(PORT, HOST, () => {
  try { closureEngine.start(); } catch (e) { console.error("[closure-engine] start failed", e.message); }
  console.log(`XAU-ELITE-FONDA (24/7 Auto-Sync + Gemini AI Daily Bias Edition) listening on http://${HOST}:${PORT}`);
});
