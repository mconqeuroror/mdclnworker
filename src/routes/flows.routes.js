/**
 * AI Flows Builder — REST + SSE routes
 *
 * GET    /api/flows              — list user's flows
 * POST   /api/flows              — create flow
 * GET    /api/flows/:id          — get flow with latest run
 * PUT    /api/flows/:id          — update flow
 * DELETE /api/flows/:id          — delete flow
 * POST   /api/flows/:id/run      — start async run
 * GET    /api/flows/runs/:runId  — get run status + nodeResults
 * GET    /api/flows/runs/:runId/stream — SSE real-time stream
 * DELETE /api/flows/runs/:runId  — cancel run
 * GET    /api/flows/:id/runs     — run history
 */

import { Router } from "express";
import prisma from "../lib/prisma.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import {
  executeFlow,
  cancelFlowRun,
  registerSSEClient,
  emitSSEEvent,
  markRunActive,
  markRunInactive,
  isRunActive,
} from "../services/flow-engine.service.js";
import { NODE_REGISTRY, NODE_CATEGORIES, estimateFlowCredits } from "../services/flow-node-registry.js";

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// ── Node registry / credit estimator (frontend reads this) ─────────────────

router.get("/node-types", (req, res) => {
  const types = Object.entries(NODE_REGISTRY).map(([type, def]) => ({
    type,
    label: def.label,
    category: def.category,
    color: def.color,
    description: def.description,
    inputs: def.inputs,
    outputs: def.outputs,
    defaultData: def.defaultData,
    creditCost: def.creditCost,
    hidden: def.hidden || false,
  }));
  res.json({ types, categories: NODE_CATEGORIES });
});

router.post("/estimate-credits", (req, res) => {
  const { nodes = [] } = req.body;
  res.json({ credits: estimateFlowCredits(nodes) });
});

// ── Flow CRUD ──────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const flows = await prisma.flow.findMany({
      where: { userId: req.user.id },
      select: {
        id: true, name: true, description: true, thumbnail: true,
        isPublic: true, createdAt: true, updatedAt: true,
        _count: { select: { runs: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    res.json({ flows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name = "Untitled Flow", description, nodes = [], edges = [], thumbnail, isPublic = false } = req.body;
    const flow = await prisma.flow.create({
      data: { userId: req.user.id, name, description, nodes, edges, thumbnail, isPublic },
    });
    res.status(201).json({ flow });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const flow = await prisma.flow.findFirst({
      where: { id: req.params.id, OR: [{ userId: req.user.id }, { isPublic: true }] },
      include: {
        runs: {
          orderBy: { startedAt: "desc" },
          take: 1,
          select: { id: true, status: true, creditsUsed: true, startedAt: true, completedAt: true },
        },
      },
    });
    if (!flow) return res.status(404).json({ error: "Flow not found" });
    res.json({ flow });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const flow = await prisma.flow.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!flow) return res.status(404).json({ error: "Flow not found" });
    const { name, description, nodes, edges, thumbnail, isPublic } = req.body;
    const updated = await prisma.flow.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(nodes !== undefined && { nodes }),
        ...(edges !== undefined && { edges }),
        ...(thumbnail !== undefined && { thumbnail }),
        ...(isPublic !== undefined && { isPublic }),
      },
    });
    res.json({ flow: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const flow = await prisma.flow.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!flow) return res.status(404).json({ error: "Flow not found" });
    await prisma.flow.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Run management ─────────────────────────────────────────────────────────

// Start a run (fire-and-forget async execution with SSE)
router.post("/:id/run", async (req, res) => {
  try {
    const flow = await prisma.flow.findFirst({
      where: { id: req.params.id, OR: [{ userId: req.user.id }, { isPublic: true }] },
    });
    if (!flow) return res.status(404).json({ error: "Flow not found" });

    if (!flow.nodes || flow.nodes.length === 0) {
      return res.status(400).json({ error: "Flow has no nodes" });
    }

    const run = await prisma.flowRun.create({
      data: { flowId: flow.id, userId: req.user.id, status: "pending" },
    });

    // Respond immediately — client subscribes to SSE stream for updates
    res.status(202).json({ runId: run.id, status: "pending" });

    // Execute in background
    markRunActive(run.id);
    setImmediate(async () => {
      try {
        await executeFlow({
          flow,
          runId: run.id,
          userId: req.user.id,
          onEvent: (payload) => emitSSEEvent(run.id, payload),
        });
      } catch (err) {
        emitSSEEvent(run.id, { type: "flow", status: "failed", error: err.message });
      } finally {
        markRunInactive(run.id);
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * SSE stream — must come before /:runId to avoid route conflict.
 *
 * Each connection has a hard ~25s lifetime so we never sit on a Vercel
 * function until the platform's `maxDuration` (800s) kills it. When the
 * window expires the server emits a `reconnect` event and ends the
 * stream; the client should reconnect immediately and pick up where
 * it left off (run state is in the DB, not in the connection).
 *
 * Configurable via FLOW_SSE_MAX_DURATION_MS (default 25_000).
 */
const FLOW_SSE_MAX_DURATION_MS = Math.max(
  5_000,
  Math.min(120_000, Number(process.env.FLOW_SSE_MAX_DURATION_MS) || 25_000),
);

router.get("/runs/:runId/stream", async (req, res) => {
  const { runId } = req.params;

  const run = await prisma.flowRun.findFirst({ where: { id: runId, userId: req.user.id } });
  if (!run) return res.status(404).json({ error: "Run not found" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Terminal states resolve in a single payload — no need to keep the
  // connection open at all.
  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    res.write(`data: ${JSON.stringify({
      type: "flow",
      status: run.status,
      nodeResults: run.nodeResults,
      creditsUsed: run.creditsUsed,
    })}\n\n`);
    return res.end();
  }

  registerSSEClient(runId, res);

  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
  }, 20_000);

  // Hard-cap connection lifetime. Burning 800s of function time per stream
  // costs serverless budget and risks Vercel killing the function with a
  // 504 mid-message. After this window we send a typed `reconnect` event
  // and close cleanly — clients should reopen the stream immediately.
  const maxLifetimeTimer = setTimeout(() => {
    try {
      res.write(`event: reconnect\ndata: ${JSON.stringify({ reason: "lifetime_cap", afterMs: FLOW_SSE_MAX_DURATION_MS })}\n\n`);
    } catch { /* connection already gone */ }
    try { res.end(); } catch { /* ignore */ }
  }, FLOW_SSE_MAX_DURATION_MS);

  res.on("close", () => {
    clearInterval(heartbeat);
    clearTimeout(maxLifetimeTimer);
  });
});

router.get("/runs/:runId", async (req, res) => {
  try {
    const run = await prisma.flowRun.findFirst({
      where: { id: req.params.runId, userId: req.user.id },
    });
    if (!run) return res.status(404).json({ error: "Run not found" });
    res.json({ run });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/runs/:runId", async (req, res) => {
  try {
    const run = await prisma.flowRun.findFirst({ where: { id: req.params.runId, userId: req.user.id } });
    if (!run) return res.status(404).json({ error: "Run not found" });
    if (run.status === "running" || run.status === "pending") {
      await cancelFlowRun(run.id);
      emitSSEEvent(run.id, { type: "flow", status: "cancelled" });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id/runs", async (req, res) => {
  try {
    const flow = await prisma.flow.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!flow) return res.status(404).json({ error: "Flow not found" });
    const runs = await prisma.flowRun.findMany({
      where: { flowId: req.params.id },
      orderBy: { startedAt: "desc" },
      take: 50,
      select: { id: true, status: true, creditsUsed: true, startedAt: true, completedAt: true },
    });
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
