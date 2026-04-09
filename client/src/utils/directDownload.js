/**
 * Trigger a file save from a public URL. Avoids opening an empty `about:blank` tab (bad on mobile).
 * Tries CORS fetch → blob → object URL + download first; falls back to a one-shot anchor click.
 */
export async function downloadFromPublicUrl(url, filename = "download") {
  if (!url || typeof url !== "string") return;
  const name = String(filename || "download").replace(/[/\\?%*:|"<>]/g, "_");

  const triggerBlobDownload = (blob) => {
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
  };

  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    triggerBlobDownload(blob);
    return;
  } catch {
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.rel = "noopener noreferrer";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
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
