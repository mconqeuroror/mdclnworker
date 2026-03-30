const BP_MIN = { sm: 640, md: 768, lg: 1024, xl: 1280 };
const BP_BASE_MAX = 639;

function esc(id) {
  return id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildSpatialDecls(t) {
  const d = [];
  if (t.hidden) d.push("display:none !important;");
  if (t.translateX != null || t.translateY != null) {
    d.push(`transform:translate(${t.translateX ?? "0"},${t.translateY ?? "0"}) !important;`);
  }
  if (t.width)        d.push(`width:${t.width} !important;`);
  if (t.maxWidth)     d.push(`max-width:${t.maxWidth} !important;`);
  if (t.height)       d.push(`height:${t.height} !important;`);
  if (t.marginTop)    d.push(`margin-top:${t.marginTop} !important;`);
  if (t.marginBottom) d.push(`margin-bottom:${t.marginBottom} !important;`);
  if (t.marginLeft)   d.push(`margin-left:${t.marginLeft} !important;`);
  if (t.marginRight)  d.push(`margin-right:${t.marginRight} !important;`);
  return d.join("");
}

export function buildSpatialCss(spatialOverrides) {
  if (!spatialOverrides || !Object.keys(spatialOverrides).length) return "";
  const parts = [];
  for (const [id, responsive] of Object.entries(spatialOverrides)) {
    const sel = `[data-dp-target-id="${esc(id)}"]`;
    if (responsive.base) {
      const inner = buildSpatialDecls(responsive.base);
      if (inner) parts.push(`@media (max-width:${BP_BASE_MAX}px){${sel}{${inner}}}`);
    }
    for (const bp of ["sm", "md", "lg", "xl"]) {
      const t = responsive[bp];
      if (!t) continue;
      const inner = buildSpatialDecls(t);
      if (inner) parts.push(`@media (min-width:${BP_MIN[bp]}px){${sel}{${inner}}}`);
    }
  }
  return parts.join("\n");
}

export function buildStyleOverrideCss(styleOverrides) {
  if (!styleOverrides || !Object.keys(styleOverrides).length) return "";
  const lines = [];
  for (const [id, responsive] of Object.entries(styleOverrides)) {
    const sel = `[data-dp-target-id="${esc(id)}"]`;
    for (const [bp, o] of Object.entries(responsive)) {
      if (!o) continue;
      const d = [];
      if (o.color)           d.push(`color:${o.color} !important;`);
      if (o.backgroundColor) d.push(`background-color:${o.backgroundColor} !important;`);
      if (o.fontSize)        d.push(`font-size:${o.fontSize} !important;`);
      if (o.fontWeight)      d.push(`font-weight:${o.fontWeight} !important;`);
      if (!d.length) continue;
      const inner = `${sel}{${d.join("")}}`;
      if (bp === "base") lines.push(`@media (max-width:${BP_BASE_MAX}px){${inner}}`);
      else lines.push(`@media (min-width:${BP_MIN[bp]}px){${inner}}`);
    }
  }
  return lines.join("\n");
}
