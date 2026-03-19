import crypto from "crypto";
import os from "os";
import prisma from "../lib/prisma.js";

const IP_HASH_SALT = process.env.TELEMETRY_IP_SALT || process.env.JWT_SECRET || "telemetry-default-salt";
const MAX_DETAILS_JSON_LENGTH = 4000;
const SLOW_REQUEST_THRESHOLD_MS = Number(process.env.TELEMETRY_SLOW_REQUEST_MS || 4000);
const HEALTHCHECK_ANALYSIS_WINDOW_MINUTES = 15;
const HEALTHCHECK_TRAFFIC_LOOKBACK_HOURS = 24;
const MIN_RECENT_SAMPLES_FOR_STRICT_HEALTH = 10;

const ENDPOINT_HEALTH_CATALOG = [
  // Core
  { method: "GET",    path: "/api/health" },
  { method: "GET",    path: "/api/brand" },
  { method: "GET",    path: "/api/plans" },
  // Auth
  { method: "POST",   path: "/api/auth/login" },
  { method: "POST",   path: "/api/auth/signup" },
  { method: "GET",    path: "/api/auth/profile" },
  { method: "POST",   path: "/api/auth/google" },
  { method: "POST",   path: "/api/auth/refresh" },
  { method: "POST",   path: "/api/auth/logout" },
  { method: "POST",   path: "/api/auth/check-email" },
  { method: "POST",   path: "/api/auth/firebase-signup" },
  { method: "POST",   path: "/api/auth/verify-email" },
  { method: "POST",   path: "/api/auth/resend-code" },
  { method: "POST",   path: "/api/auth/request-password-reset" },
  { method: "POST",   path: "/api/auth/reset-password" },
  { method: "POST",   path: "/api/auth/change-password" },
  { method: "PUT",    path: "/api/auth/profile" },
  // 2FA
  { method: "GET",    path: "/api/auth/2fa/status" },
  { method: "POST",   path: "/api/auth/2fa/generate" },
  { method: "POST",   path: "/api/auth/2fa/verify" },
  { method: "POST",   path: "/api/auth/2fa/disable" },
  // Models
  { method: "GET",    path: "/api/models" },
  { method: "POST",   path: "/api/models" },
  { method: "DELETE", path: "/api/models/:id" },
  // Generations
  { method: "GET",    path: "/api/generations" },
  { method: "GET",    path: "/api/generations/:id" },
  // Generate pipeline
  { method: "POST",   path: "/api/generate/complete-recreation" },
  { method: "POST",   path: "/api/generate/image-identity" },
  { method: "POST",   path: "/api/generate/video-motion" },
  { method: "POST",   path: "/api/generate/face-swap" },
  { method: "POST",   path: "/api/generate/video-directly" },
  { method: "POST",   path: "/api/generate/face-swap-video" },
  { method: "POST",   path: "/api/generate/talking-head" },
  { method: "POST",   path: "/api/generate/advanced" },
  { method: "POST",   path: "/api/generate/enhance-prompt" },
  { method: "POST",   path: "/api/generate/describe-target" },
  { method: "GET",    path: "/api/voices" },
  // NSFW generation
  { method: "POST",   path: "/api/nsfw/generate" },
  { method: "POST",   path: "/api/nsfw/nudes-pack" },
  { method: "POST",   path: "/api/nsfw/generate-video" },
  { method: "POST",   path: "/api/nsfw/extend-video" },
  { method: "POST",   path: "/api/nsfw/generate-advanced" },
  { method: "POST",   path: "/api/nsfw/generate-prompt" },
  { method: "POST",   path: "/api/nsfw/plan-generation" },
  { method: "POST",   path: "/api/nsfw/auto-select" },
  // NSFW LoRA management
  { method: "POST",   path: "/api/nsfw/lora/create" },
  { method: "GET",    path: "/api/nsfw/loras/:modelId" },
  { method: "POST",   path: "/api/nsfw/lora/set-active" },
  { method: "DELETE", path: "/api/nsfw/lora/:loraId" },
  { method: "PUT",    path: "/api/nsfw/lora/:loraId/appearance" },
  { method: "GET",    path: "/api/nsfw/appearance/:modelId" },
  // NSFW training
  { method: "POST",   path: "/api/nsfw/initialize-training" },
  { method: "POST",   path: "/api/nsfw/start-training-session" },
  { method: "POST",   path: "/api/nsfw/train-lora" },
  { method: "GET",    path: "/api/nsfw/training-status/:modelId" },
  { method: "POST",   path: "/api/nsfw/upload-training-images" },
  // img2img
  { method: "POST",   path: "/api/img2img/describe" },
  { method: "POST",   path: "/api/img2img/generate" },
  { method: "GET",    path: "/api/img2img/status/:jobId" },
  // Video repurpose
  { method: "POST",   path: "/api/video-repurpose/generate" },
  { method: "POST",   path: "/api/video-repurpose/compare" },
  { method: "GET",    path: "/api/video-repurpose/history" },
  // Stripe
  { method: "POST",   path: "/api/stripe/create-checkout-session" },
  { method: "POST",   path: "/api/stripe/create-onetime-checkout" },
  { method: "POST",   path: "/api/stripe/create-payment-intent" },
  { method: "GET",    path: "/api/stripe/subscription-status" },
  // Crypto
  { method: "POST",   path: "/api/crypto/create-payment" },
  { method: "GET",    path: "/api/crypto/currencies" },
  // Referrals
  { method: "GET",    path: "/api/referrals/me/overview" },
  { method: "GET",    path: "/api/referrals/admin/overview" },
  // Admin
  { method: "GET",    path: "/api/admin/stats" },
  { method: "GET",    path: "/api/admin/users" },
  { method: "GET",    path: "/api/admin/telemetry/overview" },
  { method: "GET",    path: "/api/admin/telemetry/endpoint-health" },
  // Drafts
  { method: "GET",    path: "/api/drafts/:feature" },
  { method: "PUT",    path: "/api/drafts/:feature" },
  // Misc
  { method: "POST",   path: "/api/upload" },
  { method: "GET",    path: "/api/download" },
];

function toMb(bytes) {
  return Math.round((Number(bytes || 0) / (1024 * 1024)) * 100) / 100;
}

export function hashIp(ip) {
  if (!ip) return null;
  return crypto
    .createHash("sha256")
    .update(`${IP_HASH_SALT}:${ip}`)
    .digest("hex")
    .slice(0, 24);
}

export function normalizeTelemetryPath(pathname) {
  const raw = String(pathname || "/").split("?")[0];
  return raw
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ":uuid")
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    .replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, "/:token");
}

function safeJsonString(value) {
  try {
    const encoded = JSON.stringify(value ?? {});
    return encoded.length > MAX_DETAILS_JSON_LENGTH
      ? `${encoded.slice(0, MAX_DETAILS_JSON_LENGTH)}...`
      : encoded;
  } catch {
    return null;
  }
}

export async function recordApiRequestMetric(data) {
  try {
    await prisma.apiRequestMetric.create({
      data: {
        method: String(data.method || "GET").toUpperCase(),
        routePath: String(data.routePath || "/"),
        normalizedPath: normalizeTelemetryPath(data.normalizedPath || data.routePath || "/"),
        statusCode: Number.isFinite(data.statusCode) ? Number(data.statusCode) : 0,
        durationMs: Number.isFinite(data.durationMs) ? Math.max(0, Math.round(data.durationMs)) : 0,
        userId: data.userId || null,
        isAdmin: data.isAdmin === true,
        ipHash: data.ipHash || null,
        userAgent: data.userAgent ? String(data.userAgent).slice(0, 300) : null,
        requestBytes: Number.isFinite(data.requestBytes) ? Math.max(0, Math.round(data.requestBytes)) : null,
        responseBytes: Number.isFinite(data.responseBytes) ? Math.max(0, Math.round(data.responseBytes)) : null,
      },
    });
  } catch (error) {
    const msg = error?.message || String(error);
    const short = msg.includes("Can't reach database") ? "database unreachable (e.g. cold start)" : msg?.slice(0, 120);
    console.warn("[telemetry] failed to record request metric:", short);
  }
}

export async function recordTelemetryEdgeEvent({
  eventType,
  severity = "info",
  message = null,
  routePath = null,
  statusCode = null,
  userId = null,
  ipHash = null,
  details = null,
}) {
  try {
    await prisma.telemetryEdgeEvent.create({
      data: {
        eventType: String(eventType || "unknown"),
        severity: String(severity || "info"),
        message: message ? String(message).slice(0, 500) : null,
        routePath: routePath ? String(routePath).slice(0, 300) : null,
        statusCode: Number.isFinite(statusCode) ? Math.round(statusCode) : null,
        userId: userId || null,
        ipHash: ipHash || null,
        detailsJson: safeJsonString(details),
      },
    });
  } catch (error) {
    const msg = error?.message || String(error);
    const short = msg.includes("Can't reach database") ? "database unreachable (e.g. cold start)" : msg?.slice(0, 120);
    console.warn("[telemetry] failed to record edge event:", short);
  }
}

export async function captureSystemHealthSnapshot() {
  try {
    const mem = process.memoryUsage();
    const load = os.loadavg();
    const activeHandles = typeof process._getActiveHandles === "function" ? process._getActiveHandles().length : null;
    const activeRequests = typeof process._getActiveRequests === "function" ? process._getActiveRequests().length : null;

    await prisma.systemHealthMetric.create({
      data: {
        processUptimeSec: Math.round(process.uptime()),
        memoryRssMb: toMb(mem.rss),
        memoryHeapUsedMb: toMb(mem.heapUsed),
        memoryHeapTotalMb: toMb(mem.heapTotal),
        loadAvg1: Number.isFinite(load[0]) ? Number(load[0].toFixed(2)) : null,
        activeHandles,
        activeRequests,
      },
    });
  } catch (error) {
    console.warn("[telemetry] failed to capture system snapshot:", error?.message || error);
  }
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function endpointKey(method, path) {
  return `${String(method || "GET").toUpperCase()} ${path}`;
}

function evaluateEndpointStatus({ totalRecent, errorRecent, avgLatencyRecent, totalLookback }) {
  if (!totalLookback) {
    return { status: "unknown", message: "No traffic in lookback window" };
  }
  if (!totalRecent) {
    return { status: "stale", message: "No requests in the last 15 minutes" };
  }

  // Avoid false alarms for tiny traffic samples.
  if (totalRecent < MIN_RECENT_SAMPLES_FOR_STRICT_HEALTH) {
    const errorRate = errorRecent / totalRecent;
    if (errorRate > 0 || avgLatencyRecent >= SLOW_REQUEST_THRESHOLD_MS) {
      return {
        status: "degraded",
        message: `Low sample size (${totalRecent}) with some failures/latency`,
      };
    }
    return {
      status: "healthy",
      message: `Low sample size (${totalRecent}), no error signals`,
    };
  }

  const errorRate = errorRecent / totalRecent;
  if (errorRate >= 0.5) {
    return { status: "down", message: "High 5xx error rate" };
  }
  if (errorRate >= 0.1 || avgLatencyRecent >= SLOW_REQUEST_THRESHOLD_MS) {
    return { status: "degraded", message: "Elevated error rate or latency" };
  }
  return { status: "healthy", message: "Operating normally" };
}

export async function runEndpointHealthChecks({
  appPort = process.env.PORT || 5000,
} = {}) {
  const now = new Date();
  const recentSince = new Date(now.getTime() - HEALTHCHECK_ANALYSIS_WINDOW_MINUTES * 60 * 1000);
  const lookbackSince = new Date(now.getTime() - HEALTHCHECK_TRAFFIC_LOOKBACK_HOURS * 60 * 60 * 1000);
  const runId = `run_${now.getTime()}`;

  const snapshots = [];

  for (const endpoint of ENDPOINT_HEALTH_CATALOG) {
    const normalizedPath = normalizeTelemetryPath(endpoint.path);

    const [recentStats, lookbackCount] = await Promise.all([
      prisma.apiRequestMetric.aggregate({
        where: {
          method: endpoint.method,
          normalizedPath,
          createdAt: { gte: recentSince },
        },
        _count: { _all: true },
        _avg: { durationMs: true },
      }),
      prisma.apiRequestMetric.count({
        where: {
          method: endpoint.method,
          normalizedPath,
          createdAt: { gte: lookbackSince },
        },
      }),
    ]);

    const recentTotal = recentStats._count._all || 0;
    const recentErrors = await prisma.apiRequestMetric.count({
      where: {
        method: endpoint.method,
        normalizedPath,
        statusCode: { gte: 500 },
        createdAt: { gte: recentSince },
      },
    });
    const avgLatencyRecent = Number.isFinite(recentStats._avg.durationMs)
      ? Math.round(recentStats._avg.durationMs)
      : null;

    const statusEval = evaluateEndpointStatus({
      totalRecent: recentTotal,
      errorRecent: recentErrors,
      avgLatencyRecent: avgLatencyRecent || 0,
      totalLookback: lookbackCount,
    });

    snapshots.push({
      runId,
      endpointKey: endpointKey(endpoint.method, endpoint.path),
      method: endpoint.method,
      path: endpoint.path,
      status: statusEval.status,
      checksCount: recentTotal,
      errorRatePct: recentTotal > 0 ? Number(((recentErrors / recentTotal) * 100).toFixed(2)) : null,
      avgLatencyMs: avgLatencyRecent,
      message: statusEval.message,
      checkedAt: now,
    });
  }

  // ── Synthetic probes: real HTTP requests to verify endpoints respond ──────
  // These endpoints are probed live each run so they show real status even
  // with zero user traffic. Auth-required endpoints expect 401, not 200.
  const SYNTHETIC_PROBES = [
    { method: "GET",  path: "/health",           expectStatuses: [200] },
    { method: "GET",  path: "/api/health",        expectStatuses: [200] },
    { method: "GET",  path: "/api/brand",         expectStatuses: [200] },
    { method: "GET",  path: "/api/plans",         expectStatuses: [200] },
    { method: "GET",  path: "/api/auth/profile",  expectStatuses: [401, 403] },
    { method: "GET",  path: "/api/models",        expectStatuses: [401, 403] },
    { method: "GET",  path: "/api/generations",   expectStatuses: [401, 403] },
    { method: "GET",  path: "/api/voices",        expectStatuses: [200, 401, 403] },
    { method: "GET",  path: "/api/crypto/currencies", expectStatuses: [200] },
    { method: "GET",  path: "/api/stripe/subscription-status", expectStatuses: [401, 403] },
    { method: "GET",  path: "/api/video-repurpose/history",    expectStatuses: [401, 403] },
    { method: "GET",  path: "/api/referrals/me/overview",      expectStatuses: [401, 403] },
    { method: "GET",  path: "/api/img2img/status/probe-check", expectStatuses: [401, 403, 404] },
  ];

  for (const probe of SYNTHETIC_PROBES) {
    const started = Date.now();
    let probeStatus = "down";
    let probeMessage = "";
    let elapsedMs = null;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`http://127.0.0.1:${appPort}${probe.path}`, {
        method: probe.method,
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
      });
      clearTimeout(timeout);
      elapsedMs = Date.now() - started;

      const ok = probe.expectStatuses.includes(response.status);
      probeStatus = ok ? "healthy" : (response.status >= 500 ? "down" : "degraded");
      probeMessage = ok
        ? `Synthetic probe passed (${response.status})`
        : `Unexpected status ${response.status} (expected ${probe.expectStatuses.join("/")})`;
    } catch (error) {
      elapsedMs = Date.now() - started;
      probeStatus = "down";
      probeMessage = `Probe failed: ${error?.message || "unknown"}`.slice(0, 500);
    }

    snapshots.push({
      runId,
      endpointKey: `SYNTHETIC ${probe.method} ${probe.path}`,
      method: probe.method,
      path: probe.path,
      status: probeStatus,
      checksCount: 1,
      errorRatePct: probeStatus === "healthy" ? 0 : 100,
      avgLatencyMs: elapsedMs,
      message: probeMessage,
      checkedAt: now,
    });
  }

  try {
    await prisma.apiEndpointHealthSnapshot.createMany({
      data: snapshots,
    });

    const degradedOrDown = snapshots.filter((s) => s.status === "degraded" || s.status === "down");
    if (degradedOrDown.length > 0) {
      await recordTelemetryEdgeEvent({
        eventType: "endpoint_health_alert",
        severity: degradedOrDown.some((x) => x.status === "down") ? "critical" : "warning",
        message: `${degradedOrDown.length} endpoint(s) unhealthy`,
        details: degradedOrDown.map((row) => ({
          endpoint: row.endpointKey,
          status: row.status,
          message: row.message,
        })),
      });
    }
  } catch (error) {
    console.warn("[telemetry] failed to persist endpoint health snapshots:", error?.message || error);
  }
}

export async function getLatestEndpointHealthSnapshots() {
  const latest = await prisma.apiEndpointHealthSnapshot.findFirst({
    orderBy: { checkedAt: "desc" },
    select: { runId: true, checkedAt: true },
  });

  if (!latest) {
    return { checkedAt: null, items: [] };
  }

  const items = await prisma.apiEndpointHealthSnapshot.findMany({
    where: { runId: latest.runId },
    orderBy: [{ status: "asc" }, { endpointKey: "asc" }],
    select: {
      endpointKey: true,
      method: true,
      path: true,
      status: true,
      checksCount: true,
      errorRatePct: true,
      avgLatencyMs: true,
      message: true,
      checkedAt: true,
    },
  });

  return {
    checkedAt: latest.checkedAt,
    items,
  };
}

export async function getTelemetryOverview(hours = 24) {
  const boundedHours = Math.min(168, Math.max(1, Number(hours) || 24));
  const since = new Date(Date.now() - boundedHours * 60 * 60 * 1000);

  const latestEndpointHealth = await getLatestEndpointHealthSnapshots();
  const [totalRequests, errorRequests, slowRequests, topPaths, statusBreakdown, edgeTypeBreakdown, recentEdgeEvents, latencySamples, uniqueUsers, latestInfra] =
    await Promise.all([
      prisma.apiRequestMetric.count({
        where: { createdAt: { gte: since } },
      }),
      prisma.apiRequestMetric.count({
        where: { createdAt: { gte: since }, statusCode: { gte: 500 } },
      }),
      prisma.apiRequestMetric.count({
        where: { createdAt: { gte: since }, durationMs: { gte: SLOW_REQUEST_THRESHOLD_MS } },
      }),
      prisma.apiRequestMetric.groupBy({
        by: ["normalizedPath"],
        where: { createdAt: { gte: since } },
        _count: { normalizedPath: true },
        orderBy: { _count: { normalizedPath: "desc" } },
        take: 10,
      }),
      prisma.apiRequestMetric.groupBy({
        by: ["statusCode"],
        where: { createdAt: { gte: since } },
        _count: { statusCode: true },
        orderBy: { statusCode: "asc" },
      }),
      prisma.telemetryEdgeEvent.groupBy({
        by: ["eventType"],
        where: { createdAt: { gte: since } },
        _count: { eventType: true },
        orderBy: { _count: { eventType: "desc" } },
      }),
      prisma.telemetryEdgeEvent.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true,
          eventType: true,
          severity: true,
          message: true,
          routePath: true,
          statusCode: true,
          createdAt: true,
        },
      }),
      prisma.apiRequestMetric.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 5000,
        select: { durationMs: true },
      }),
      prisma.apiRequestMetric.findMany({
        where: { createdAt: { gte: since }, userId: { not: null } },
        distinct: ["userId"],
        select: { userId: true },
      }),
      prisma.systemHealthMetric.findFirst({
        orderBy: { createdAt: "desc" },
      }),
    ]);

  const durations = latencySamples.map((x) => x.durationMs).filter((x) => Number.isFinite(x));
  const avgLatencyMs = durations.length
    ? Math.round(durations.reduce((sum, ms) => sum + ms, 0) / durations.length)
    : 0;

  return {
    windowHours: boundedHours,
    totals: {
      requests: totalRequests,
      errors5xx: errorRequests,
      slowRequests,
      uniqueUsers: uniqueUsers.length,
      errorRatePct: totalRequests > 0 ? Number(((errorRequests / totalRequests) * 100).toFixed(2)) : 0,
    },
    latency: {
      avgMs: avgLatencyMs,
      p95Ms: Math.round(percentile(durations, 95)),
      p99Ms: Math.round(percentile(durations, 99)),
      slowThresholdMs: SLOW_REQUEST_THRESHOLD_MS,
    },
    traffic: {
      statusBreakdown: statusBreakdown.map((row) => ({
        statusCode: row.statusCode,
        count: row._count.statusCode,
      })),
      topPaths: topPaths.map((row) => ({
        path: row.normalizedPath,
        count: row._count.normalizedPath,
      })),
    },
    edgeMonitoring: {
      byType: edgeTypeBreakdown.map((row) => ({
        eventType: row.eventType,
        count: row._count.eventType,
      })),
      recent: recentEdgeEvents,
    },
    infra: latestInfra
      ? {
          capturedAt: latestInfra.createdAt,
          processUptimeSec: latestInfra.processUptimeSec,
          memoryRssMb: latestInfra.memoryRssMb,
          memoryHeapUsedMb: latestInfra.memoryHeapUsedMb,
          memoryHeapTotalMb: latestInfra.memoryHeapTotalMb,
          loadAvg1: latestInfra.loadAvg1,
          activeHandles: latestInfra.activeHandles,
          activeRequests: latestInfra.activeRequests,
        }
      : null,
    endpointHealth: {
      checkedAt: latestEndpointHealth.checkedAt,
      summary: latestEndpointHealth.items.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {}),
    },
  };
}

export const telemetryConfig = {
  SLOW_REQUEST_THRESHOLD_MS,
};
