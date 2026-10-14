"use strict";
const fs = require("fs");
const path = require("path");
const engine = require("./daily-closure-engine");
const SNAPSHOT = path.join(engine.DATA_DIR, "learning-state.json");
function writeSnapshot() {
  try { fs.writeFileSync(SNAPSHOT, JSON.stringify(engine.getState())); } catch (e) {}
}
(async () => {
  writeSnapshot();
  const timer = setInterval(writeSnapshot, 20000);
  try {
    const status = await engine.runCycle(process.env.XEF_CYCLE_REASON || "one-shot");
    clearInterval(timer);
    writeSnapshot();
    console.log("[run-daily-cycle] done:", JSON.stringify(status.progress || status));
    process.exit(0);
  } catch (e) {
    clearInterval(timer);
    writeSnapshot();
    console.error("[run-daily-cycle] failed:", e && e.message);
    process.exit(1);
  }
})();
