/**
 * Reverse-engineer Vercel "log export" row shape into structured inventory.
 * The export is a JSON array of { requestPath, requestMethod, message, requestId, requestQueryString, type, function, level, ... }.
 * Request bodies and auth identity are NOT included — only paths, query strings, and the default request line in `message`.
 */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
/** Rare in exports; KIE task ids usually appear in `message` as `[KIE Callback] taskId=...` instead. */
const KIE_PREFIX = /kie-task:([a-zA-Z0-9_-]+)/g;
const KIE_CALLBACK_LOG_TASK = /\[KIE Callback\]\s*taskId=([a-f0-9]+)/gi;
const STRIPE_IDS = /(cs_live_[a-zA-Z0-9]+|sub_[a-zA-Z0-9]+|pi_[a-zA-Z0-9]+|cus_[a-zA-Z0-9]+|in_[a-zA-Z0-9]+|evt_[a-zA-Z0-9]+)/g;
/** e.g. `[runpod-callback] jobId=...` or runpod worker logs */
const MSG_RUNPOD_JOB = /jobId=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[^\s]*)/gi;
const MSG_GENERATION_ID = /generationId=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

/**
 * Structured app logs (e.g. RunPod callback) may include `generationId=<uuid>` in `message` — not in the URL path.
 * @param {string} [msg]
 * @returns {string[]}
 */
export function extractGenerationIdsFromVercelMessageText(msg) {
  const s = String(msg || "");
  const re = new RegExp(MSG_GENERATION_ID.source, "gi");
  const out = new Set();
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m[1]) out.add(m[1]);
  }
  return [...out];
}

/**
 * "modelclone.app/api/foo" or "/api/foo" → "/api/foo"
 */
export function normalizeVercelPath(raw) {
  const s = String(raw || "").replace(/^https?:\/\/[^/]+/i, "");
  if (!s.startsWith("/") && s.includes("api/")) {
    return `/${s.replace(/^.*?(api\/)/, "api/")}`.replace(/^api\//, "/api/");
  }
  if (!s.startsWith("/")) return `/${s}`;
  return s.split("?")[0] || s;
}

export function parseQuery(pathOrQuery) {
  const s = String(pathOrQuery || "");
  const i = s.indexOf("?");
  if (i === -1) return { path: s, q: new URLSearchParams() };
  return { path: s.slice(0, i), q: new URLSearchParams(s.slice(i + 1)) };
}

/**
 * Extract first UUID in path that looks like GET /api/generations/{uuid} or .../generations/UUID/...
 */
export function extractGenerationIdFromPath(path) {
  const p = String(path || "");
  const m = p.match(/\/generations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (m) return m[1];
  return null;
}

/**
 * @param {object} row — one Vercel log row
 */
export function classifyVercelRow(row) {
  const p = normalizeVercelPath(row?.requestPath || row?.message || "");
  const method = String(row?.requestMethod || "").toUpperCase() || "GET";
  const { path: noQuery, q } = parseQuery(row?.requestPath + (row?.requestQueryString ? `?${row.requestQueryString}` : ""));

  let family = "other";
  if (/^\/api\/(stripe|checkout|billing|payment)/i.test(noQuery) || /stripe|webhook.*stripe/i.test(p)) {
    family = "billing";
  } else if (/\/(kie|callback|webhook|runpod|wavespeed|piapi|heygen|pi-api)/i.test(p)) {
    family = "provider_callback";
  } else if (/\/(generations?|generate)/i.test(p)) {
    family = "generation";
  } else if (/\/(models?|model\/)/i.test(p)) {
    family = "model";
  } else if (/\/(auth|login|signup|refresh|forgot|reset|verify)/i.test(p)) {
    family = "auth";
  } else if (/\/(user|me|account|settings)/i.test(p)) {
    family = "user";
  } else if (/\/(drafts|upload|history)/i.test(p)) {
    family = "content";
  } else if (/\/(nsfw|nudes)/i.test(p) || /nsfw/i.test(p)) {
    family = "nsfw";
  }

  return {
    family,
    method,
    path: noQuery,
    hasQuery: Boolean(row?.requestQueryString),
    pathQueryKeys: q ? [...new Set([...q.keys()])] : [],
    generationIdFromPath: extractGenerationIdFromPath(noQuery),
  };
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

/**
 * Scan arbitrary text for all UUIDs, de-dupe.
 */
function extractUuidsInText(s) {
  if (!s || typeof s !== "string") return [];
  return uniq(String(s).match(new RegExp(UUID.source, "gi")) || []);
}

/**
 * @param {object[]} rows
 */
export function buildVercelLogInventoryReport(rows) {
  if (!Array.isArray(rows)) {
    return { error: "expected array of log rows" };
  }

  const byFamily = Object.create(null);
  const byPathPrefix = Object.create(null);
  const generationIdsFromPath = new Set();
  const allUuidsInAllMessages = new Set();
  const kieTaskIds = new Set();
  const stripeIds = new Set();
  const byRequestId = new Map();
  const statusCodes = Object.create(null);
  const byHost = Object.create(null);
  const modelIdFromGenerationsList = Object.create(null);
  const generationIdsFromMessage = new Set();
  const runpodJobIdsFromMessage = new Set();
  let timeMin = Infinity;
  let timeMax = -Infinity;

  for (const row of rows) {
    const t = row?.timestampInMs;
    if (typeof t === "number" && !Number.isNaN(t)) {
      if (t < timeMin) timeMin = t;
      if (t > timeMax) timeMax = t;
    }
    const h = String(row?.host || row?.deploymentDomain || "").trim() || "unknown";
    byHost[h] = (byHost[h] || 0) + 1;

    const c = classifyVercelRow(row);
    byFamily[c.family] = (byFamily[c.family] || 0) + 1;
    const prefix = c.path.split("/").slice(0, 4).join("/") || "/";
    byPathPrefix[prefix] = (byPathPrefix[prefix] || 0) + 1;
    if (c.generationIdFromPath) generationIdsFromPath.add(c.generationIdFromPath);
    if (row?.responseStatusCode) {
      const sc = String(row.responseStatusCode);
      statusCodes[sc] = (statusCodes[sc] || 0) + 1;
    }

    const msg = typeof row?.message === "string" ? row.message : "";
    if (row?.requestQueryString && /\/api\/generations/i.test(String(row?.requestPath || ""))) {
      try {
        const q = new URLSearchParams(String(row.requestQueryString));
        const mid = q.get("modelId");
        if (mid) modelIdFromGenerationsList[mid] = (modelIdFromGenerationsList[mid] || 0) + 1;
      } catch {
        /* ignore */
      }
    }

    let m2;
    const reGmsg = new RegExp(MSG_GENERATION_ID.source, "gi");
    while ((m2 = reGmsg.exec(msg)) !== null) {
      if (m2[1]) generationIdsFromMessage.add(m2[1]);
    }
    const reJ = new RegExp(MSG_RUNPOD_JOB.source, "gi");
    while ((m2 = reJ.exec(msg)) !== null) {
      if (m2[1]) runpodJobIdsFromMessage.add(m2[1].trim());
    }
    const reKieL = new RegExp(KIE_CALLBACK_LOG_TASK.source, "gi");
    while ((m2 = reKieL.exec(msg)) !== null) {
      if (m2[1]) kieTaskIds.add(m2[1]);
    }

    const blob = JSON.stringify(row);
    for (const m of extractUuidsInText(blob)) allUuidsInAllMessages.add(m);
    const reK = new RegExp(KIE_PREFIX.source, "g");
    while ((m2 = reK.exec(blob)) !== null) {
      if (m2[1]) kieTaskIds.add(m2[1]);
    }
    const reS = new RegExp(STRIPE_IDS.source, "g");
    while ((m2 = reS.exec(blob)) !== null) {
      if (m2[1]) stripeIds.add(m2[1]);
    }
    const rid = row?.requestId;
    if (rid) {
      if (!byRequestId.has(rid)) byRequestId.set(rid, []);
      byRequestId.get(rid).push({
        t: row.timestampInMs,
        m: c.method,
        p: c.path,
        f: c.family,
      });
    }
  }

  // Optional: find requestIds with both "generation" family and a generation id
  const requestIdsWithGeneration = [];
  for (const [rid, list] of byRequestId) {
    const hasGen = list.some((x) => x.f === "generation" || /generations\//.test(x.p));
    if (hasGen) requestIdsWithGeneration.push(rid);
  }

  const timeRange =
    timeMin !== Infinity && timeMax !== -Infinity
      ? {
          minMs: timeMin,
          maxMs: timeMax,
          minIso: new Date(timeMin).toISOString(),
          maxIso: new Date(timeMax).toISOString(),
        }
      : null;

  return {
    version: 2,
    totalRows: rows.length,
    timeRange,
    topHosts: sortObj(byHost, 25),
    byFamily: sortObj(byFamily),
    topPathPrefixes: sortObj(byPathPrefix, 50),
    statusCodes: sortObj(statusCodes),
    uniqueRequestIds: byRequestId.size,
    requestIdLinkedToGenerationFamily: requestIdsWithGeneration.length,
    /**
     * Strong signal: /api/generations/{uuid} appeared in requestPath (usually GET or polling).
     */
    generationIdsInPaths: [...generationIdsFromPath].sort(),
    countGenerationIdsInPaths: generationIdsFromPath.size,
    /**
     * From app log lines like `[runpod-callback] generationId=…` (not in every flow).
     */
    generationIdsFromMessages: [...generationIdsFromMessage].sort(),
    countGenerationIdsFromMessages: generationIdsFromMessage.size,
    runpodJobIdsFromMessages: [...runpodJobIdsFromMessage].sort(),
    countRunpodJobIdsFromMessages: runpodJobIdsFromMessage.size,
    /**
     * KIE: from `[KIE Callback] taskId=…` in `message`, plus rare `kie-task:…` in the blob.
     * Join in DB via `KieTask.taskId` when recovering generations.
     */
    kieTaskIds: [...kieTaskIds].sort(),
    countKieTaskIds: kieTaskIds.size,
    stripeIds: [...stripeIds].sort(),
    countStripeIds: stripeIds.size,
    /**
     * Saved-model ids seen on `GET/HEAD /api/generations?...&modelId=` (list/poll). Useful for *which model*
     * was active; does not name a `Generation` row by itself.
     */
    topModelIdsFromGenerationsQuery: sortObj(modelIdFromGenerationsList, 80),
    countUniqueModelIdsInGenerationsQuery: Object.keys(modelIdFromGenerationsList).length,
    /**
     * Weak signal: any UUID in the row (may be model, user, request id, etc. — not all are generation ids).
     */
    uuidsTouched: [...allUuidsInAllMessages].length,
  };
}

function sortObj(o, limit) {
  const e = Object.entries(o).sort((a, b) => b[1] - a[1]);
  return limit ? Object.fromEntries(e.slice(0, limit)) : Object.fromEntries(e);
}

/**
 * Join all `message` fields that share a `requestId` (Vercel emits multiple rows per request).
 * Use for recovery: KIE/RunPod lines are often on follow-up log lines, not the first.
 * @param {object[]} rows
 * @returns {Map<string, string>} requestId -> merged text
 */
export function buildMergedVercelMessagesByRequestId(rows) {
  const m = new Map();
  for (const row of rows || []) {
    const rid = row?.requestId;
    if (!rid) continue;
    const msg = String(row?.message || "");
    const prev = m.get(rid) || "";
    m.set(rid, prev ? `${prev}\n${msg}` : msg);
  }
  return m;
}
