/**
 * Deep Vercel export analysis: requestId fan-out, message taxonomy, URLs, errors.
 * Usage: node scripts/vercel-logs-deep-dive.mjs "path/to/export.json" [out.json]
 * NODE_OPTIONS=--max-old-space-size=20480 for large files.
 */
import fs from "fs";
import path from "path";
import { buildVercelLogDeepDiveReport } from "../src/services/vercel-log-deep-dive.service.js";

const inPath = process.argv[2];
const outPath = process.argv[3] || path.join(process.cwd(), "tmp", "vercel-logs-deep-dive.json");
const topFan = Number.parseInt(process.argv[4] || "40", 10) || 40;

if (!inPath) {
  console.error('Usage: node scripts/vercel-logs-deep-dive.mjs "path/to/log-export.json" [out.json] [topRequestIdFanout]');
  process.exit(1);
}

const raw = fs.readFileSync(inPath, "utf8");
const rows = JSON.parse(raw);
if (!Array.isArray(rows)) {
  console.error("Expected a JSON array of Vercel log rows");
  process.exit(1);
}

const report = buildVercelLogDeepDiveReport(rows, { topRequestIdFanout: topFan });
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

const inv = report.baseInventory || {};
const r = report.requestIds || {};
const h = (r.heuristics || {}).mergedBlobs || {};
console.log("Wrote", path.resolve(outPath));
console.log(
  "rows:",
  inv.totalRows,
  "| requestIds:",
  (r || {}).unique,
  "| 2+ lines / req:",
  (r.lineCountHistogram && Object.entries(r.lineCountHistogram).filter(([k]) => k !== "1").reduce((s, [, n]) => s + n, 0)) || 0,
  "| kie [KIE Callback] in merge:",
  h.withKieCallbackToken,
  "| runpod-ish merge:",
  h.withRunpodToken,
  "| merge has genId text:",
  h.withGenerationIdInMerged,
  "| 500 top paths (see JSON):",
  Object.keys((report.errors || {}).top500Paths || {}).length,
);