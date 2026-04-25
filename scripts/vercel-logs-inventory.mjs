/**
 * Build a full JSON inventory from a Vercel log export (one JSON array file).
 * Usage: node scripts/vercel-logs-inventory.mjs "path/to/export.json" [out.json]
 * Needs NODE_OPTIONS=--max-old-space-size=16384 for very large files.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildVercelLogInventoryReport } from "../src/services/vercel-log-inventory.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inPath = process.argv[2];
const outPath = process.argv[3] || path.join(process.cwd(), "tmp", "vercel-inventory.json");

if (!inPath) {
  console.error('Usage: node scripts/vercel-logs-inventory.mjs "path/to/log-export.json" [out.json]');
  process.exit(1);
}

const raw = fs.readFileSync(inPath, "utf8");
const rows = JSON.parse(raw);
if (!Array.isArray(rows)) {
  console.error("Expected a JSON array of Vercel log rows");
  process.exit(1);
}

const report = buildVercelLogInventoryReport(rows);
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
console.log("Wrote", path.resolve(outPath));
console.log(
  "Rows:",
  report.totalRows,
  report.timeRange ? `| window ${report.timeRange.minIso} → ${report.timeRange.maxIso}` : "",
  "| gen path:",
  report.countGenerationIdsInPaths,
  "| gen msg:",
  report.countGenerationIdsFromMessages,
  "| kie task ids:",
  report.countKieTaskIds,
  "| runpod job ids in msg:",
  report.countRunpodJobIdsFromMessages,
  "| stripe ids:",
  report.countStripeIds,
  "| modelIds in /api/generations queries:",
  report.countUniqueModelIdsInGenerationsQuery,
);
