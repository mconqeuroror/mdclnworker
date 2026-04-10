import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

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
    const key = deriveKey();
    if (!key || !plain) return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
  } catch {
    return null;
  }
}

export function decryptApiKey(payload) {
  try {
    const key = deriveKey();
    if (!key || !payload) return null;
    const [ivB64, tagB64, dataB64] = String(payload).split(".");
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivB64, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}
