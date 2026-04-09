/**
 * Save a file from a public URL without sending bytes through the app API (avoids Vercel proxy limits / 413).
 */
export async function downloadFromPublicUrl(url, filename = "download") {
  if (!url || typeof url !== "string") return;
  const name = filename || "download";
  const ua = String(window?.navigator?.userAgent || "").toLowerCase();
  const isMobile = /iphone|ipad|ipod|android|mobile/.test(ua);
  const isIOS = /iphone|ipad|ipod/.test(ua);
  // Open a fallback tab synchronously from the user gesture context.
  // If CORS fetch fails, we can still navigate this tab to the file URL.
  let fallbackTab = null;
  try {
    fallbackTab = window.open("", "_blank", "noopener,noreferrer");
  } catch {
    fallbackTab = null;
  }
  // iOS and many mobile browsers often block blob/download flows for cross-origin media.
  // Prefer direct navigation so the browser can handle open/share/save reliably.
  if (isMobile || isIOS) {
    if (fallbackTab && !fallbackTab.closed) {
      fallbackTab.location.href = url;
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 120_000);
    if (fallbackTab && !fallbackTab.closed) {
      fallbackTab.close();
    }
  } catch {
    if (fallbackTab && !fallbackTab.closed) {
      fallbackTab.location.href = url;
    } else {
      try {
        window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        window.location.assign(url);
      }
    }
  }
}

export async function fetchPublicAssetBlob(url) {
  const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}
