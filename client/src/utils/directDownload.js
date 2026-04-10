import api from "../services/api";

/**
 * Save bytes as a file. On iOS Safari, `a[download]` is unreliable; prefer Web Share → Save to Files.
 */
async function saveBlobAsFile(blob, filename) {
  const name = String(filename || "download").replace(/[/\\?%*:|"<>]/g, "_");
  const type = blob.type || "application/octet-stream";
  const ua = typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "";
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  if (
    isIOS
    && typeof navigator !== "undefined"
    && typeof navigator.share === "function"
    && typeof navigator.canShare === "function"
    && typeof File !== "undefined"
  ) {
    try {
      const file = new File([blob], name, { type });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return;
      // fall through to anchor download
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = name;
  a.style.display = "none";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 120_000);
}

/**
 * Download via same-origin API proxy (Content-Disposition: attachment) — works when cross-origin fetch/CORS fails (typical on iPhone).
 */
async function tryAuthenticatedProxyDownload(url, filename) {
  try {
    const res = await api.get("/download", {
      params: { url, filename },
      responseType: "blob",
      timeout: 120_000,
    });
    const blob = res.data;
    if (!(blob instanceof Blob) || blob.size === 0) return false;
    if (blob.type?.includes("application/json")) {
      try {
        const j = JSON.parse(await blob.text());
        if (j?.success === false || j?.error) return false;
      } catch {
        return false;
      }
    }
    await saveBlobAsFile(blob, filename);
    return true;
  } catch (e) {
    const data = e?.response?.data;
    if (data instanceof Blob) {
      try {
        const t = await data.text();
        const j = JSON.parse(t);
        if (j?.error) return false;
      } catch {
        /* ignore */
      }
    }
    return false;
  }
}

/**
 * Save a file from a public asset URL. Prefers authenticated `/api/download` proxy (forced attachment, no blank tabs),
 * then CORS fetch. Does not open `about:blank` or redirect the app.
 */
export async function downloadFromPublicUrl(url, filename = "download") {
  if (!url || typeof url !== "string") return;
  const name = String(filename || "download").replace(/[/\\?%*:|"<>]/g, "_");

  if (url.startsWith("data:")) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      await saveBlobAsFile(blob, name);
    } catch {
      /* ignore */
    }
    return;
  }

  if (url.startsWith("blob:")) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      await saveBlobAsFile(blob, name);
    } catch {
      /* ignore */
    }
    return;
  }

  // Same-origin `/api/download` — sends httpOnly session cookie (`withCredentials` on axios); forces attachment on server.
  if (await tryAuthenticatedProxyDownload(url, name)) {
    return;
  }

  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    await saveBlobAsFile(blob, name);
  } catch {
    /* CORS / offline — proxy already failed (e.g. logged out or disallowed host) */
  }
}

export async function fetchPublicAssetBlob(url) {
  if (!url.startsWith("data:") && !url.startsWith("blob:")) {
    try {
      const res = await api.get("/download", {
        params: { url, filename: "asset.bin" },
        responseType: "blob",
        timeout: 120_000,
      });
      const blob = res.data;
      if (blob instanceof Blob && blob.size > 0 && !blob.type?.includes("application/json")) {
        return blob;
      }
    } catch {
      /* fall through */
    }
  }
  const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}
