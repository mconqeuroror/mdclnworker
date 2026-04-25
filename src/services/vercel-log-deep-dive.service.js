/**
 * Deep analysis of Vercel log export rows: requestId correlation, message taxonomy,
 * URL/IP extraction, and failure/429 profiles — for disaster-recovery triage.
 * Does not connect to DB.
 */
import {
  buildVercelLogInventoryReport,
  extractGenerationIdFromPath,
  extractGenerationIdsFromVercelMessageText,
  normalizeVercelPath,
} from "./vercel-log-inventory.service.js";

const R_URL = /https?:\/\/[^\s"'<>\\]+/gi;
const R_IPV4 = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
const R_KIE_TASK = /\[KIE Callback\]\s*taskId=([a-f0-9]+)/gi;
const R_GENID_MSG = /generationId=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
const R_RUNPOD_JOB = /jobId=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[^\s'"]*)/gi;
function isVercelDefaultRequestLine(s) {
  return /^\d{4}-\d{2}-\d{2}T[\d:.-]+Z\s*[-–]\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//i.test(
    String(s || ""),
  );
}

function inc(map, k, d = 1) {
  map.set(k, (map.get(k) || 0) + d);
}

function sortMapToObj(map, limit) {
  const e = [...map.entries()].sort((a, b) => b[1] - a[1]);
  return limit ? Object.fromEntries(e.slice(0, limit)) : Object.fromEntries(e);
}

function allMatches(re, s, group = 0) {
  const out = new Set();
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let m;
  while ((m = r.exec(s)) !== null) {
    if (m[group]) out.add(m[group]);
  }
  return out;
}

function urlDomains(s) {
  const doms = new Map();
  if (!s) return doms;
  let m;
  const r = new RegExp(R_URL.source, "gi");
  while ((m = r.exec(s)) !== null) {
    const u = m[0].replace(/[),.;]+$/, "");
    try {
      const h = new URL(u).hostname;
      if (h) inc(doms, h);
    } catch {
      /* ignore */
    }
  }
  return doms;
}

function classifyMessageLine(msg) {
  const s = String(msg || "");
  if (!s) return "empty";
  if (/^\[KIE Callback\]/i.test(s)) return "kie_callback";
  if (/^\[KIE Pipeline\]/i.test(s)) return "kie_pipeline";
  if (/^\[KIE\]/i.test(s)) return "kie_internal";
  if (/\[KIE\//i.test(s)) return "kie_submit_slice";
  if (/^\[runpod-callback\]/i.test(s) || s.includes("[runpod-callback]")) return "runpod_callback_line";
  if (/\[RunPod webhook\]/i.test(s) || /RunPod webhook/i.test(s)) return "runpod_webhook";
  if (/\[Blob\/KIE relay\]/i.test(s)) return "blob_kie_relay";
  if (/\[img2img\]/i.test(s) || /^\s*🔥\s*\[RunPod\]/i.test(s)) return "img2img_runpod";
  if (/\[wavespeed\]/i.test(s) || /wavespeed.*callback/i.test(s)) return "wavespeed_log";
  if (/^\d{4}-\d{2}-\d{2}T[\d:.-]+Z\s*[-–]\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//i.test(s)) return "vercel_request_line";
  if (s.length < 3) return "tiny";
  return "other_message";
}

function lineBucket(n) {
  if (n <= 1) return "1";
  if (n === 2) return "2";
  if (n <= 5) return "3-5";
  if (n <= 10) return "6-10";
  if (n <= 20) return "11-20";
  return "21+";
}

/**
 * @param {object[]} rows
 * @param {object} [opts]
 * @param {number} [opts.topRequestIdFanout=25] — richest requestId groups to detail
 */
export function buildVercelLogDeepDiveReport(rows, opts = {}) {
  if (!Array.isArray(rows)) {
    return { error: "expected array of log rows" };
  }
  const topK = Math.min(200, Math.max(5, opts.topRequestIdFanout ?? 25));

  const inventory = buildVercelLogInventoryReport(rows);

  const byHourUtc = new Map();
  const taxonomy = new Map();
  const byLevel = new Map();
  const err500Paths = new Map();
  const rate429Paths = new Map();
  const auth401Paths = new Map();
  const byApiSegment = new Map();
  const byMethodSegment = new Map();
  const deploymentIds = new Map();
  const functionField = new Map();
  const vercelCache = new Map();
  const ipInMessages = new Map();
  const creditSpendHints = { deductingLogLines: 0, newPurchasedCreditsLogLines: 0 };
  const jsonId32InMessages = new Set();

  /** @type {Map<string, { rows: number; path: string; method: string; tmin: number; tmax: number; messages: string[]; maxStatus: string }} */
  const byRid = new Map();

  for (const row of rows) {
    const ts = row?.timestampInMs;
    if (typeof ts === "number" && !Number.isNaN(ts)) {
      const d = new Date(ts);
      const h = d.toISOString().slice(0, 13) + ":00:00.000Z";
      inc(byHourUtc, h);
    }

    const level = String(row?.level || "unknown");
    inc(byLevel, level);

    const pnorm = normalizeVercelPath(row?.requestPath || "");
    const seg = pnorm.split("/").filter(Boolean).slice(0, 2).join("/");
    if (seg) inc(byApiSegment, seg);
    const mm = String(row?.requestMethod || "GET").toUpperCase();
    if (seg) inc(byMethodSegment, `${mm} /${seg}`);

    if (row?.responseStatusCode) {
      const sc = String(row.responseStatusCode);
      if (sc === "500" && pnorm) inc(err500Paths, pnorm.slice(0, 200));
      if (sc === "429" && pnorm) inc(rate429Paths, pnorm.slice(0, 200));
      if (sc === "401" && pnorm) inc(auth401Paths, pnorm.slice(0, 200));
    }

    if (row?.deploymentId) inc(deploymentIds, String(row.deploymentId));
    if (row?.function) inc(functionField, String(row.function) || "(empty)");
    if (row?.vercelCache != null && row?.vercelCache !== "") inc(vercelCache, String(row.vercelCache));

    const msg = String(row?.message || "");
    const tline = classifyMessageLine(msg);
    inc(taxonomy, tline);

    for (const ip of msg.match(R_IPV4) || []) {
      if (!/^127\./.test(ip) && ip !== "0.0.0.0") inc(ipInMessages, ip);
    }

    if (/(?:💳\s*)?Deducting\s+\d+\s+credits/i.test(msg) || /deductCredits/i.test(msg)) {
      creditSpendHints.deductingLogLines += 1;
    }
    if (/New purchasedCredits|purchasedCredits:\s*\d+/i.test(msg)) {
      creditSpendHints.newPurchasedCreditsLogLines += 1;
    }
    const rJ32 = /"id"\s*:\s*"([a-f0-9]{32})"/gi;
    let jm;
    while ((jm = rJ32.exec(msg)) !== null) {
      if (jm[1]) jsonId32InMessages.add(jm[1]);
    }

    const rid = row?.requestId;
    if (!rid) continue;

    let g = byRid.get(rid);
    if (!g) {
      g = {
        rows: 0,
        path: normalizeVercelPath(row?.requestPath || ""),
        method: mm,
        tmin: ts || 0,
        tmax: ts || 0,
        messages: [],
        maxStatus: String(row?.responseStatusCode || ""),
      };
      byRid.set(rid, g);
    }
    g.rows += 1;
    g.path = g.path || normalizeVercelPath(row?.requestPath || "");
    if (ts && (g.tmin === 0 || ts < g.tmin)) g.tmin = ts;
    if (ts && ts > g.tmax) g.tmax = ts;
    g.messages.push(msg);
    if (row?.responseStatusCode) g.maxStatus = String(row.responseStatusCode);
  }

  const lineBuckets = new Map();
  const kieHeuristic = {
    withKieCallbackToken: 0,
    withCallbackTaskIdLine: 0,
    withRunpodToken: 0,
    withGenerationIdInMerged: 0,
    withMultiLine: 0,
  };
  const fanoutSamples = [];

  for (const [rid, g] of byRid) {
    inc(lineBuckets, lineBucket(g.rows));
    const merged = g.messages.join("\n");
    if (g.rows >= 2) kieHeuristic.withMultiLine += 1;

    if (/\[KIE Callback\]/i.test(merged)) {
      kieHeuristic.withKieCallbackToken += 1;
      if (/\[KIE Callback\]\s*taskId=/.test(merged)) kieHeuristic.withCallbackTaskIdLine += 1;
    }
    if (/\[runpod-callback\]|\[RunPod webhook\]/i.test(merged) || /jobId=/i.test(merged)) kieHeuristic.withRunpodToken += 1;
    R_GENID_MSG.lastIndex = 0;
    if (R_GENID_MSG.test(merged) || extractGenerationIdsFromVercelMessageText(merged).length > 0) {
      kieHeuristic.withGenerationIdInMerged += 1;
    }
    R_GENID_MSG.lastIndex = 0;

    const kieFromMerged = allMatches(R_KIE_TASK, merged, 1);
    const gid = extractGenerationIdFromPath(g.path);
    const genPath = gid ? [gid] : [];
    const genFromM = extractGenerationIdsFromVercelMessageText(merged);
    const allGen = new Set([...genPath, ...genFromM].filter(Boolean));
    const jobs = allMatches(new RegExp(R_RUNPOD_JOB.source, "gi"), merged, 1);
    const urlsN = (merged.match(R_URL) || []).length;

    fanoutSamples.push({
      requestId: rid,
      lineCount: g.rows,
      path: g.path.slice(0, 200),
      method: g.method,
      durationMs: g.tmax > g.tmin ? g.tmax - g.tmin : 0,
      kieTaskIdCount: kieFromMerged.size,
      runpodJobIdCount: jobs.size,
      generationIdUnionCount: allGen.size,
      urlCountInMessages: urlsN,
    });
  }

  fanoutSamples.sort((a, b) => b.lineCount - a.lineCount);
  const topFanout = fanoutSamples.slice(0, topK);
  for (const s of topFanout) {
    const g = byRid.get(s.requestId);
    if (g) {
      const merged = g.messages.join("\n");
      s.kieTaskIdSample = [...allMatches(new RegExp(R_KIE_TASK.source, "gi"), merged, 1)].slice(0, 3);
      s.runpodJobSample = [...allMatches(new RegExp(R_RUNPOD_JOB.source, "gi"), merged, 1)].slice(0, 2);
      s.messagePreview = g.messages
        .filter((m) => m && !isVercelDefaultRequestLine(m))
        .slice(0, 8)
        .map((m) => (m.length > 220 ? `${m.slice(0, 220)}…` : m));
    }
  }

  const domainAgg = new Map();
  for (const row of rows) {
    const m = String(row?.message || "");
    if (!m.includes("http")) continue;
    for (const [d, c] of urlDomains(m)) {
      inc(domainAgg, d, c);
    }
  }

  const requestIdUniques = byRid.size;
  const rowsWithRequestId = rows.filter((r) => r?.requestId).length;
  const noRequestId = rows.length - rowsWithRequestId;

  return {
    version: 1,
    baseInventory: {
      version: inventory.version,
      totalRows: inventory.totalRows,
      timeRange: inventory.timeRange,
      byFamily: inventory.byFamily,
      countGenerationIdsInPaths: inventory.countGenerationIdsInPaths,
      countGenerationIdsFromMessages: inventory.countGenerationIdsFromMessages,
      countKieTaskIds: inventory.countKieTaskIds,
      countRunpodJobIdsFromMessages: inventory.countRunpodJobIdsFromMessages,
      countStripeIds: inventory.countStripeIds,
    },
    requestIds: {
      unique: requestIdUniques,
      rowsWithNoRequestId: noRequestId,
      lineCountHistogram: Object.fromEntries([...lineBuckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
      /**
       * Multi-line requests are where the server printed extra logs; that's where `generationId=`, KIE, RunPod, URLs appear.
       */
      heuristics: {
        /** Number of `requestId` values that have 2+ Vercel rows (the fan-out log lines for one request). */
        requestIdsWithAtLeast2LogLines: [...lineBuckets.entries()]
          .filter(([k]) => k !== "1")
          .reduce((s, [, n]) => s + n, 0),
        /** Per merged `requestId` blob: how many contain recovery tokens (use with `unique:`, not per-row). */
        mergedBlobs: kieHeuristic,
        rowsWithRequestId,
      },
      topFanoutRequests: topFanout,
    },
    messageLineTaxonomy: Object.fromEntries([...taxonomy.entries()].sort((a, b) => b[1] - a[1])),
    byLevel: Object.fromEntries([...byLevel.entries()].sort((a, b) => b[1] - a[1])),
    trafficByHourUtc: Object.fromEntries([...byHourUtc.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    topPathSegments: sortMapToObj(byApiSegment, 30),
    topMethodSegment: sortMapToObj(byMethodSegment, 40),
    topDeploymentIds: sortMapToObj(deploymentIds, 15),
    functionField: sortMapToObj(functionField, 15),
    vercelCache: sortMapToObj(vercelCache, 12),
    errors: {
      top500Paths: sortMapToObj(err500Paths, 25),
      top429Paths: sortMapToObj(rate429Paths, 25),
      top401Paths: sortMapToObj(auth401Paths, 15),
    },
    topIpAddressesInMessages: sortMapToObj(ipInMessages, 25),
    topUrlDomainsInSampledMessages: sortMapToObj(domainAgg, 50),
    /** WaveSpeed and similar return JSON in stdout with 32-hex `id` fields; join to your provider state if present. */
    countUnique32HexJsonIdsTouched: jsonId32InMessages.size,
    /**
     * Console noise from `deductCredits` and balance logs — not authoritative vs DB, but shows spend happened in-request.
     * Caution: balance snapshots in logs are sensitive; treat as hints only.
     */
    creditRelatedLogLineHints: creditSpendHints,
    recoveryHints: {
      v: 1,
      bestSignals:
        "Vercel emits multiple stdout lines per `requestId` (median ~2.6 in your export); almost every request is multi-line — merge on `requestId` before regex. Strong tokens: [KIE Callback] taskId, [runpod-callback] jobId, generationId=, WaveSpeed/JSON 32-hex id, and URLs. Credit deduction is logged as plain text (Deducting N credits) but is not a DB join. ApiRequestMetric + KieTask in DB are still the authoritative link to `userId`.",
    },
  };
}
