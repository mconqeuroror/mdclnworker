/**
 * Client-upload (Vercel Blob handleUpload) size ceiling.
 * Set BLOB_CLIENT_UPLOAD_MAX_BYTES to match your Vercel Blob / plan limits (see Vercel Blob docs).
 * Default follows Vercel’s large multipart object support (5 TiB, within Number.MAX_SAFE_INTEGER).
 */
const FIVE_TIB = 5 * 1024 ** 4;

export function getBlobClientUploadMaxBytes() {
  const raw = process.env.BLOB_CLIENT_UPLOAD_MAX_BYTES;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(String(raw).trim());
    if (Number.isFinite(n) && n > 0) return Math.min(Math.floor(n), Number.MAX_SAFE_INTEGER);
  }
  return Math.min(FIVE_TIB, Number.MAX_SAFE_INTEGER);
}

/** Human-readable max for error messages (e.g. multer / upload guards). */
export function formatBlobUploadMaxForMessage() {
  const b = getBlobClientUploadMaxBytes();
  const tb = b / 1024 ** 4;
  if (tb >= 1) return `${tb >= 10 ? tb.toFixed(0) : tb.toFixed(1)} TB`;
  const gb = b / 1024 ** 3;
  if (gb >= 1) return `${gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)} GB`;
  const mb = b / 1024 ** 2;
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}
