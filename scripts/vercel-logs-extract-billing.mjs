/**
 * Parse Vercel "log export" JSON (single array) and pull billing/Stripe-related rows.
 * Usage: node scripts/vercel-logs-extract-billing.mjs "path/to/export.json" [out.json]
 * Does not connect to DB. Review output, then use Stripe API / manual fixes.
 */
import fs from "fs";
import path from "path";

const inPath = process.argv[2];
const outPath =
  process.argv[3] ||
  path.join(process.cwd(), "tmp", "vercel-billing-extract.json");

if (!inPath) {
  console.error('Usage: node scripts/vercel-logs-extract-billing.mjs "path/to/log-export.json" [out.json]');
  process.exit(1);
}

const raw = fs.readFileSync(inPath, "utf8");
const rows = JSON.parse(raw);
if (!Array.isArray(rows)) {
  console.error("Expected top-level JSON array");
  process.exit(1);
}

const billingPath = (p) =>
  /stripe|webhook|checkout|billing|credits?|subscription|invoice|payment|portal/i.test(
    String(p || "")
  );

// Require full checkout session prefix so we don't false-positive on "cs_live" or "cs_CZ"
const idPatterns =
  /(cs_live_[a-zA-Z0-9]+|sub_[a-zA-Z0-9]+|pi_[a-zA-Z0-9]+|cus_[a-zA-Z0-9]+|in_[a-zA-Z0-9]+|evt_[a-zA-Z0-9]+)/g;

const extracted = [];
const idHits = new Map();

for (const r of rows) {
  const reqPath = r?.requestPath ?? "";
  const msg = r?.message ?? "";
  if (!billingPath(reqPath) && !billingPath(msg)) continue;
  const blob = JSON.stringify(r);
  let m;
  const found = new Set();
  const re = new RegExp(idPatterns.source, "g");
  while ((m = re.exec(blob)) !== null) {
    found.add(m[1]);
    idHits.set(m[1], (idHits.get(m[1]) || 0) + 1);
  }
  extracted.push({
    TimeUTC: r.TimeUTC,
    timestampInMs: r.timestampInMs,
    requestPath: r.requestPath,
    requestMethod: r.requestMethod,
    responseStatusCode: r.responseStatusCode,
    level: r.level,
    message: typeof msg === "string" && msg.length > 2000 ? msg.slice(0, 2000) + "…" : msg,
    stripeIds: [...found],
  });
}

// Unique id summary (sorted by frequency)
const byFreq = [...idHits.entries()].sort((a, b) => b[1] - a[1]);

const report = {
  source: path.resolve(inPath),
  totalInputRows: rows.length,
  billingRelatedRows: extracted.length,
  stripeIdSummary: byFreq.map(([id, n]) => ({ id, count: n })),
  rows: extracted,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
console.log(`Wrote ${outPath}`);
console.log(`Scanned ${rows.length} rows; ${extracted.length} billing-related; ${idHits.size} unique Stripe-style ids in those rows.`);
