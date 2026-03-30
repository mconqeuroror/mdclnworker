function prune(t) {
  const o = {};
  if (t.translateX?.trim()) o.translateX = t.translateX.trim();
  if (t.translateY?.trim()) o.translateY = t.translateY.trim();
  if (t.width?.trim())      o.width      = t.width.trim();
  if (t.maxWidth?.trim())   o.maxWidth   = t.maxWidth.trim();
  if (t.height?.trim())     o.height     = t.height.trim();
  if (t.marginTop?.trim())    o.marginTop    = t.marginTop.trim();
  if (t.marginBottom?.trim()) o.marginBottom = t.marginBottom.trim();
  if (t.marginLeft?.trim())   o.marginLeft   = t.marginLeft.trim();
  if (t.marginRight?.trim())  o.marginRight  = t.marginRight.trim();
  if (t.hidden === true) o.hidden = true;
  return Object.keys(o).length > 0 ? o : null;
}

export function mergeSpatialPatch(spatial, targetId, bp, patch) {
  const so = { ...(spatial ?? {}) };
  const entry = { ...(so[targetId] ?? {}) };
  const prev = { ...(entry[bp] ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") delete prev[k];
    else prev[k] = v;
  }
  const cleaned = prune(prev);
  if (cleaned) entry[bp] = cleaned;
  else delete entry[bp];
  if (!Object.keys(entry).length) delete so[targetId];
  else so[targetId] = entry;
  return so;
}

export function resetSpatialBreakpoint(spatial, targetId, bp) {
  const so = { ...(spatial ?? {}) };
  const entry = { ...(so[targetId] ?? {}) };
  delete entry[bp];
  if (!Object.keys(entry).length) delete so[targetId];
  else so[targetId] = entry;
  return so;
}

export function copySpatialLgToSmaller(spatial, targetId) {
  const lg = spatial?.[targetId]?.lg;
  if (!lg) return { ...(spatial ?? {}) };
  const so = { ...(spatial ?? {}) };
  so[targetId] = { ...(so[targetId] ?? {}), base: { ...lg }, sm: { ...lg }, md: { ...lg } };
  return so;
}

export function parseTranslate(raw, axisSizePx) {
  const s = (raw ?? "").trim();
  if (!s) return { px: 0, percent: 0 };
  if (s.endsWith("%")) {
    const n = parseFloat(s);
    return { px: (isFinite(n) ? n : 0) * 0.01 * axisSizePx, percent: isFinite(n) ? n : 0 };
  }
  if (s.endsWith("px")) {
    const n = parseFloat(s);
    const px = isFinite(n) ? n : 0;
    return { px, percent: axisSizePx > 0 ? (px / axisSizePx) * 100 : 0 };
  }
  const n = parseFloat(s);
  if (isFinite(n)) return { px: n, percent: axisSizePx > 0 ? (n / axisSizePx) * 100 : 0 };
  return { px: 0, percent: 0 };
}

export function formatTranslatePercent(percent) {
  return `${percent.toFixed(2)}%`;
}

export function getEffectiveTransform(t, w, h) {
  const tx = parseTranslate(t?.translateX, w);
  const ty = parseTranslate(t?.translateY, h);
  return { txPx: tx.px, tyPx: ty.px, txPct: tx.percent, tyPct: ty.percent };
}

export function mergeStylePatch(styleOverrides, targetId, bp, patch) {
  const so = { ...(styleOverrides ?? {}) };
  const entry = { ...(so[targetId] ?? {}) };
  const prev = { ...(entry[bp] ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") delete prev[k];
    else prev[k] = v;
  }
  if (!Object.keys(prev).length) delete entry[bp];
  else entry[bp] = prev;
  if (!Object.keys(entry).length) delete so[targetId];
  else so[targetId] = entry;
  return so;
}
