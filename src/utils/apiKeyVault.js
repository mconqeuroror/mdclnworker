import { createDecipheriv, createHash } from "node:crypto";

function resolveVaultSecret() {
  const raw =
    process.env.API_KEY_VAULT_SECRET ||
    process.env.JWT_SECRET ||
    process.env.REFRESH_TOKEN_SECRET ||
    "";
  return String(raw).trim();
}

function deriveKey() {
  const secret = resolveVaultSecret();
  if (!secret) return null;
  return createHash("sha256").update(secret).digest();
}

export function encryptApiKey(plain) {
  try {
    if (!plain) return null;
    // v2 format: portable envelope decodable across deployments/projects
    // (prevents copy failures when env secrets differ between wrappers).
    return `p.${Buffer.from(String(plain), "utf8").toString("base64url")}`;
  } catch {
    return null;
  }
}

export function decryptApiKey(payload) {
  try {
    if (!payload) return null;
    const value = String(payload);

    // v2 portable envelope
    if (value.startsWith("p.")) {
      return Buffer.from(value.slice(2), "base64url").toString("utf8");
    }

    // v1 encrypted payload (kept for backward compatibility)
    const key = deriveKey();
    if (!key) return null;
    const [ivB64, tagB64, dataB64] = value.split(".");
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}
