/**
 * Save a file from a public URL without sending bytes through the app API (avoids Vercel proxy limits / 413).
 */
export async function downloadFromPublicUrl(url, filename = "download") {
  if (!url || typeof url !== "string") return;
  const name = filename || "download";
  // Open a fallback tab synchronously from the user gesture context.
  // If CORS fetch fails, we can still navigate this tab to the file URL.
  let fallbackTab = null;
  try {
    fallbackTab = window.open("", "_blank", "noopener,noreferrer");
  } catch {
    fallbackTab = null;
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
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }
}

export async function fetchPublicAssetBlob(url) {
  const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}
