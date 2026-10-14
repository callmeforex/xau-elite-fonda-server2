# XAU-ELITE-FONDA — Complete Free & Live Institutional Edition

This archive contains the complete **XAU-ELITE-FONDA** web application (100% free, zero login/paywall, real-time `XAUUSD` Spot Gold CFD & 34 global assets, 128 institutional widgets across 19 categories, 17.4-year empirical seasonality engine, CFTC COT, Swissquote L2 liquidity book, multi-timeframe interactive charts, and Google Gemini AI Daily Bias + Expected Future Daily Candles OHLC Table & Chart).

---

## 📦 What's Included in This Archive

1. **`full-server-edition/` (Node.js Backend + Frontend + Live Cache)**
   - Runs the full Node.js backend (`server.js` + `live-provider-engine.js`) with 24/7 Server-Sent Events (`/api/stream`), live TradingView CFD WebSocket (`OANDA:XAUUSD`), XAU-ELITE-FONDA WebSocket (`wss://pws.primemarket-terminal.com:8081`), CFTC Socrata API, Swissquote BBO API, and Google Gemini AI synthesis.
   - **How to run locally or on any VPS / Render / Railway / Fly.io:**
     ```bash
     cd full-server-edition
     npm install   # (Zero external dependencies required — uses native Node.js 18+/20+ APIs; ws is optional)
     node server.js
     ```
   - Open `http://localhost:3000/xauusd` in your browser.

2. **`static-cdn-edition/` (Drag-and-Drop Static Cloud Hosting Edition)**
   - Ready to deploy to **Surge.sh, Netlify Drop, Cloudflare Pages, Vercel, GitHub Pages, AWS S3, or any static web server** with zero backend setup required.
   - Connects directly from the visitor's browser to `wss://pws.primemarket-terminal.com:8081` (real-time CFD ticks) and `https://generativelanguage.googleapis.com` (Google Gemini AI Daily Bias & Future Candles).
   - **One-Command Deploy to Surge.sh:**
     ```bash
     npx surge ./static-cdn-edition your-custom-domain.surge.sh
     ```
   - **Or Drag-and-Drop:** Drag the `static-cdn-edition` folder directly into `https://app.netlify.com/drop` or Cloudflare Pages.

3. **`standalone-single-file/XAU-ELITE-FONDA-Live.html`**
   - A 100% self-contained single HTML file with all scripts, styles, charts, and pre-hydrated data embedded.
   - Double-click `XAU-ELITE-FONDA-Live.html` on any computer to open it directly in Chrome, Brave, Edge, Firefox, or Safari.

---

## 🔑 Configuring Your Google Gemini API Key
- By default, the terminal uses the configured Google AI Studio key inside `live-provider-engine.js` and `public/index.html`.
- You can override it anytime via environment variable:
  ```bash
  GEMINI_API_KEY="your_api_key_here" node server.js
  ```
