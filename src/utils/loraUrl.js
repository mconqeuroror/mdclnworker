/**
 * ComfyUI / RunPod nodes often pass LoRA URLs through encodeURI(), which encodes `%` as `%25`.
 * If the URL already contains percent-encoded bytes (e.g. %20 for space), you get %2520 and
 * HuggingFace 404s. Prefer literal spaces in HF paths, or run this to unwrap double-encoding.
 */
export function sanitizeLoraDownloadUrl(url) {
  if (!url || typeof url !== "string") return url;
  let s = url.trim();
  while (/%25[0-9a-f]{2}/i.test(s)) {
    s = s.replace(/%25([0-9a-f]{2})/gi, (_, hex) => `%${hex}`);
  }
  return s;
}
