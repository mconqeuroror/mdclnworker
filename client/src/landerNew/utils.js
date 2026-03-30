export function deepMerge(base, override) {
  if (Array.isArray(base)) return Array.isArray(override) ? override : base;
  if (base && typeof base === "object") {
    const out = { ...base };
    const source = override && typeof override === "object" ? override : {};
    for (const key of Object.keys(source)) {
      out[key] = deepMerge(base[key], source[key]);
    }
    return out;
  }
  return override === undefined ? base : override;
}

export function getByPath(obj, path) {
  return path.split(".").reduce((acc, part) => (acc == null ? acc : acc[part]), obj);
}

export function setByPath(obj, path, value) {
  const parts = path.split(".");
  const out = structuredClone(obj);
  let cursor = out;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    if (!cursor[p] || typeof cursor[p] !== "object") cursor[p] = {};
    cursor = cursor[p];
  }
  cursor[parts[parts.length - 1]] = value;
  return out;
}

export function resolveLayout(config, targetId, breakpoint) {
  const node = config?.layout?.[targetId] || {};
  const base = node.base || {};
  const bp = breakpoint && breakpoint !== "base" ? (node[breakpoint] || {}) : {};
  return { ...base, ...bp };
}

