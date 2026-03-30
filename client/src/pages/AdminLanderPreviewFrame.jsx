import { useEffect, useRef, useState } from "react";
import LanderNewPublicApp from "../components/landerNew/LanderNewPublicApp";
import { buildSpatialCss, buildStyleOverrideCss } from "../landerNew/spatialCss";

// Collect bounds for every [data-dp-target-id] element in the document
function collectBounds() {
  const nodes = document.querySelectorAll("[data-dp-target-id]");
  const map = new Map();
  for (const el of nodes) {
    const id = el.getAttribute("data-dp-target-id");
    if (!id) continue;
    const r = el.getBoundingClientRect();
    const prev = map.get(id);
    if (!prev) {
      map.set(id, { left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    } else {
      map.set(id, {
        left:   Math.min(prev.left,   r.left),
        top:    Math.min(prev.top,    r.top),
        right:  Math.max(prev.right,  r.right),
        bottom: Math.max(prev.bottom, r.bottom),
      });
    }
  }
  const de = document.documentElement;
  return {
    type:         "dp-bounds-response",
    bounds:       [...map.entries()].map(([targetId, b]) => ({
      targetId,
      rect: { left: b.left, top: b.top, width: b.right - b.left, height: b.bottom - b.top },
    })),
    clientWidth:  de.clientWidth,
    clientHeight: de.clientHeight,
    scrollWidth:  de.scrollWidth,
    scrollHeight: de.scrollHeight,
  };
}

function sendBounds() {
  window.parent.postMessage(collectBounds(), window.location.origin);
}

function applySelection(targetId) {
  document.querySelectorAll("[data-dp-selected]").forEach(el => el.removeAttribute("data-dp-selected"));
  if (!targetId) return;
  const safe = targetId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  document.querySelectorAll(`[data-dp-target-id="${safe}"]`).forEach(el => el.setAttribute("data-dp-selected", "true"));
}

export default function AdminLanderPreviewFrame() {
  const [payload, setPayload]   = useState(null);
  const editModeRef             = useRef(false);
  const rafRef                  = useRef(0);

  // ── Message bus ──────────────────────────────────────────────────────────
  useEffect(() => {
    function onMessage(e) {
      if (e.origin !== window.location.origin) return;
      const d = e.data;

      if (d?.type === "dp-preview-payload") {
        editModeRef.current = Boolean(d.editMode);
        setPayload(d);
        requestAnimationFrame(() => {
          applySelection(d.selectedTargetId ?? null);
          sendBounds();
        });
        return;
      }
      if (d?.type === "dp-select-target") {
        applySelection(d.targetId ?? null);
        return;
      }
      if (d?.type === "dp-request-bounds") {
        sendBounds();
        return;
      }
    }

    window.addEventListener("message", onMessage);
    // Signal to the shell that this frame is ready
    window.parent?.postMessage({ type: "dp-preview-ready" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // ── Click-to-select ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!payload?.editMode) return undefined;
    function handleClick(e) {
      const target = e.target.closest("[data-dp-target-id]");
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      const targetId = target.getAttribute("data-dp-target-id");
      if (!targetId) return;
      window.parent.postMessage({ type: "dp-element-selected", targetId }, window.location.origin);
    }
    window.addEventListener("click", handleClick, true);
    return () => window.removeEventListener("click", handleClick, true);
  }, [payload?.editMode]);

  // ── Bounds on scroll/resize ───────────────────────────────────────────────
  useEffect(() => {
    if (!payload?.editMode) return undefined;
    const schedule = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; sendBounds(); });
    };
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [payload?.editMode]);

  // ── Mouse position for crosshair ─────────────────────────────────────────
  useEffect(() => {
    if (!payload?.editMode) return undefined;
    const onMove = (e) => {
      window.parent.postMessage({ type: "dp-preview-pointer", x: e.clientX, y: e.clientY }, window.location.origin);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, [payload?.editMode]);

  if (!payload) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#07070c", color: "#555", fontFamily: "system-ui,sans-serif", fontSize: 14 }}>
        Waiting for editor…
      </div>
    );
  }

  const spatialCss = buildSpatialCss(payload.config?.spatialOverrides);
  const styleCss   = buildStyleOverrideCss(payload.config?.styleOverrides);

  return (
    <>
      {(spatialCss || styleCss) && (
        <style dangerouslySetInnerHTML={{ __html: `${spatialCss}\n${styleCss}` }} />
      )}
      <LanderNewPublicApp
        config={payload.config}
        noCursor
        editMode={Boolean(payload.editMode)}
      />
    </>
  );
}
