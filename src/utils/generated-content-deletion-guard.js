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

/**
 * Ops-only extras via env (optional). Primary enforcement is User.banLocked in the database + auth middleware.
 */
export function isGeneratedContentDeletionBlocked(req) {
  if (req?.user?.banLocked) return true;

  const userId = String(req?.user?.userId || "").trim();
  const email = String(req?.user?.email || "").trim().toLowerCase();
  const ipAddress = getRequestIp(req);

  const blockedUserIds = parseCsvToSet(process.env.BLOCK_GENERATED_CONTENT_DELETE_USER_IDS);
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

export function enforceRestrictedUserActions(req, res) {
  if (!isGeneratedContentDeletionBlocked(req)) return false;
  res.status(403).json({
    success: false,
    code: "ACCOUNT_ACTIONS_BLOCKED",
    message: "This action is disabled for your account.",
  });
  return true;
}
