/**
 * Save a file from a public URL without sending bytes through the app API (avoids Vercel proxy limits / 413).
 */
export async function downloadFromPublicUrl(url, filename = "download") {
  if (!url || typeof url !== "string") return;
  const name = filename || "download";
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
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function fetchPublicAssetBlob(url) {
  const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}
