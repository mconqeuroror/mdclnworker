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

// normalise "foo[0].bar" → "foo.0.bar"
function normPath(path) {
  return path.replace(/\[(\d+)\]/g, ".$1");
}

export function getByPath(obj, path) {
  return normPath(path)
    .split(".")
    .reduce((acc, part) => (acc == null ? acc : acc[part]), obj);
}

export function setByPath(obj, path, value) {
  const parts = normPath(path).split(".");
  const out = structuredClone(obj);
  let cursor = out;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    const nextPart = parts[i + 1];
    const nextIsIndex = /^\d+$/.test(nextPart);
    if (cursor[p] == null || typeof cursor[p] !== "object") {
      cursor[p] = nextIsIndex ? [] : {};
    }
    cursor = cursor[p];
  }
  const last = parts[parts.length - 1];
  cursor[last] = value;
  return out;
}

export function resolveLayout(config, targetId, breakpoint) {
  const node = config?.layout?.[targetId] || {};
  const base = node.base || {};
  const bp = breakpoint && breakpoint !== "base" ? (node[breakpoint] || {}) : {};
  return { ...base, ...bp };
}
