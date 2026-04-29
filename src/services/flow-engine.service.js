/**
 * AI Flows Builder — Execution Engine
 *
 * Topologically sorts flow nodes (Kahn's algorithm), executes them level by level,
 * resolves inter-node data dependencies, streams events via SSE, and updates the DB.
 */

import prisma from "../lib/prisma.js";
import { NODE_REGISTRY } from "./flow-node-registry.js";

// ---------------------------------------------------------------------------
// Topological sort (Kahn's algorithm)
// Returns nodes in execution order. Parallel branches are returned as sub-arrays.
// ---------------------------------------------------------------------------
export function topoSort(nodes, edges) {
  const inDegree = new Map(nodes.map(n => [n.id, 0]));
  const adj = new Map(nodes.map(n => [n.id, []]));

  for (const edge of edges) {
    adj.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  }

  const queue = nodes.filter(n => (inDegree.get(n.id) || 0) === 0);
  const sorted = [];

  while (queue.length > 0) {
    const levelSize = queue.length;
    // Collect the current "level" (nodes with no remaining deps) as a parallel batch
    const level = queue.splice(0, levelSize);
    sorted.push(level);
    for (const node of level) {
      for (const nextId of (adj.get(node.id) || [])) {
        const newDeg = (inDegree.get(nextId) || 0) - 1;
        inDegree.set(nextId, newDeg);
        if (newDeg === 0) {
          const nextNode = nodes.find(n => n.id === nextId);
          if (nextNode) queue.push(nextNode);
        }
      }
    }
  }

  return sorted; // array of levels, each level is array of nodes to run in parallel
}

// ---------------------------------------------------------------------------
// Resolve inputs for a node from previously computed results
//
// When multiple edges land on the same target handle, values are collected
// into an array. For "text" handles we also expose a joined string under the
// same key so consumers that expect a single string keep working.
// ---------------------------------------------------------------------------
function resolveInputs(node, edges, results) {
  const incomingEdges = edges.filter(e => e.target === node.id);

  // Group incoming edges by target handle so we can detect multi-fanin.
  const byHandle = new Map();
  for (const edge of incomingEdges) {
    const sourceResult = results[edge.source];
    if (sourceResult?.output === undefined) continue;
    const targetHandle = edge.targetHandle || "input";
    const list = byHandle.get(targetHandle) || [];
    list.push({
      value: sourceResult.output,
      type: sourceResult.outputType,
    });
    byHandle.set(targetHandle, list);
  }

  const inputs = {};
  for (const [handle, items] of byHandle.entries()) {
    if (items.length === 1) {
      inputs[handle] = items[0].value;
    } else {
      const values = items.map((i) => i.value);
      // Text handles get a joined string for back-compat with single-string
      // consumers, plus the array under `<handle>List`.
      const allText = items.every((i) => i.type === "text" || typeof i.value === "string");
      inputs[handle] = allText ? values.join("\n\n") : values;
      inputs[`${handle}List`] = values;
    }
  }

  // Generic aliases — first-wins, preserved for back-compat.
  for (const items of byHandle.values()) {
    for (const { value, type } of items) {
      if (!inputs.any) inputs.any = value;
      if (type === "image" && !inputs.image) inputs.image = value;
      if (type === "video" && !inputs.video) inputs.video = value;
      if (type === "text"  && !inputs.text)  inputs.text  = value;
      if (type === "model" && !inputs.model) inputs.model = value;
    }
  }

  return inputs;
}

// ---------------------------------------------------------------------------
// Main flow executor
// ---------------------------------------------------------------------------
export async function executeFlow({ flow, runId, userId, onEvent }) {
  const emit = (payload) => {
    onEvent?.(payload);
  };

  // Load the run record
  const run = await prisma.flowRun.update({
    where: { id: runId },
    data: { status: "running" },
  });

  const levels = topoSort(flow.nodes || [], flow.edges || []);
  const results = {}; // nodeId → { output, outputType, creditsUsed }
  const logs = [];
  let totalCreditsUsed = 0;

  const log = (message, nodeId = null, level = "info") => {
    const entry = { ts: Date.now(), nodeId, message, level };
    logs.push(entry);
    emit({ type: "log", ...entry });
  };

  log("Flow execution started");

  try {
    for (const level of levels) {
      // Run all nodes in this level in parallel
      await Promise.all(level.map(async (node) => {
        const executor = NODE_REGISTRY[node.type];
        if (!executor) {
          log(`Unknown node type: ${node.type}`, node.id, "warn");
          results[node.id] = { status: "skipped", output: null, error: `Unknown type: ${node.type}` };
          emit({ type: "node", nodeId: node.id, status: "skipped" });
          return;
        }

        // Skip if there's no executor (pure UI nodes like output-viewer still run)
        emit({ type: "node", nodeId: node.id, status: "running" });
        log(`Starting node: ${executor.label || node.type}`, node.id);

        const inputs = resolveInputs(node, flow.edges || [], results);

        try {
          const onProgress = ({ message: msg }) => {
            log(msg, node.id, "info");
            emit({ type: "node", nodeId: node.id, status: "running", message: msg });
          };

          const result = await executor.execute(inputs, node.data || {}, userId, onProgress);

          results[node.id] = { status: "completed", ...result };
          totalCreditsUsed += result.creditsUsed || 0;

          // Persist partial results to DB for recovery
          await prisma.flowRun.update({
            where: { id: runId },
            data: {
              nodeResults: results,
              logs,
              creditsUsed: totalCreditsUsed,
            },
          }).catch(() => {}); // non-fatal

          emit({ type: "node", nodeId: node.id, status: "completed", output: result.output, outputType: result.outputType });
          log(`Completed: ${executor.label || node.type}`, node.id);

        } catch (err) {
          results[node.id] = { status: "failed", output: null, error: err.message };
          log(`Failed: ${err.message}`, node.id, "error");
          emit({ type: "node", nodeId: node.id, status: "failed", error: err.message });

          // Respect "stop on error" setting per-node
          if (node.data?.stopOnError !== false) {
            throw err; // propagate to abort the whole flow
          }
        }
      }));
    }

    // Mark run completed
    await prisma.flowRun.update({
      where: { id: runId },
      data: {
        status: "completed",
        nodeResults: results,
        logs,
        creditsUsed: totalCreditsUsed,
        completedAt: new Date(),
      },
    });

    log("Flow completed successfully");
    emit({ type: "flow", status: "completed", creditsUsed: totalCreditsUsed });

  } catch (err) {
    await prisma.flowRun.update({
      where: { id: runId },
      data: {
        status: "failed",
        nodeResults: results,
        logs,
        creditsUsed: totalCreditsUsed,
        completedAt: new Date(),
      },
    }).catch(() => {});

    log(`Flow failed: ${err.message}`, null, "error");
    emit({ type: "flow", status: "failed", error: err.message, creditsUsed: totalCreditsUsed });
    throw err;
  }

  return { results, creditsUsed: totalCreditsUsed };
}

// ---------------------------------------------------------------------------
// Cancel a running flow (best-effort, marks status in DB)
// ---------------------------------------------------------------------------
export async function cancelFlowRun(runId) {
  await prisma.flowRun.update({
    where: { id: runId },
    data: { status: "cancelled", completedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// In-memory SSE client registry  { runId → Set<SSEClient> }
// ---------------------------------------------------------------------------
const sseClients = new Map();

export function registerSSEClient(runId, res) {
  if (!sseClients.has(runId)) sseClients.set(runId, new Set());
  sseClients.get(runId).add(res);

  res.on("close", () => {
    sseClients.get(runId)?.delete(res);
  });
}

export function emitSSEEvent(runId, payload) {
  const clients = sseClients.get(runId);
  if (!clients?.size) return;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try { res.write(data); } catch { /* closed */ }
  }
}

// Active run tracking  { runId → boolean }  for cancel support
const activeRuns = new Set();
export function isRunActive(runId) { return activeRuns.has(runId); }
export function markRunActive(runId) { activeRuns.add(runId); }
export function markRunInactive(runId) { activeRuns.delete(runId); }
