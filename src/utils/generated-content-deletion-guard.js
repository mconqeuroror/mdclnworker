const DEFAULT_BLOCKED_USER_IDS = new Set([
  "957b162d-c7d8-47ac-93b7-783ec3468ca2",
]);

function parseCsvToSet(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  );
}

function getRequestIp(req) {
  const forwarded = req?.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return String(req?.ip || "").trim();
}

export function isGeneratedContentDeletionBlocked(req) {
  const userId = String(req?.user?.userId || "").trim();
  const email = String(req?.user?.email || "").trim().toLowerCase();
  const ipAddress = getRequestIp(req);

  const blockedUserIds = new Set([
    ...DEFAULT_BLOCKED_USER_IDS,
    ...parseCsvToSet(process.env.BLOCK_GENERATED_CONTENT_DELETE_USER_IDS),
  ]);
  const blockedEmails = parseCsvToSet(process.env.BLOCK_GENERATED_CONTENT_DELETE_EMAILS);
  const blockedIps = parseCsvToSet(process.env.BLOCK_GENERATED_CONTENT_DELETE_IPS);

  if (userId && blockedUserIds.has(userId.toLowerCase())) return true;
  if (email && blockedEmails.has(email)) return true;
  if (ipAddress && blockedIps.has(ipAddress.toLowerCase())) return true;
  return false;
}

export function enforceGeneratedContentDeletionBlock(req, res) {
  if (!isGeneratedContentDeletionBlocked(req)) return false;
  res.status(403).json({
    success: false,
    code: "CONTENT_DELETE_BLOCKED",
    message: "Deletion of generated content is disabled for this account.",
  });
  return true;
}

export function enforceIdentityUpdateBlock(req, res) {
  if (!isGeneratedContentDeletionBlocked(req)) return false;
  res.status(403).json({
    success: false,
    code: "IDENTITY_UPDATE_BLOCKED",
    message: "Identity updates are disabled for this account.",
  });
  return true;
}
