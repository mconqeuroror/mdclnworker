import axios from "axios";
import toast from "react-hot-toast";

// Import error display (will be initialized by App.jsx)
let showErrorDetailsGlobal = null;
export function setErrorDisplay(fn) {
  showErrorDetailsGlobal = fn;
}

// Backend mounts API routes at /api — base URL must end with /api (e.g. http://localhost:5006/api)
// When app is served from localhost, always use local backend to avoid CORS (production often doesn't allow localhost origin)
function resolveApiBase() {
  const raw = import.meta.env.VITE_API_URL || "";
  const isLocalHost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  let base = raw;
  if (isLocalHost && raw.startsWith("http") && !raw.includes("localhost") && !raw.includes("127.0.0.1")) {
    base = `http://localhost:${import.meta.env.VITE_DEV_PORT || "5006"}`;
  }
  if (!base) base = "/api";
  else if (base.includes("://") && !base.replace(/\/$/, "").endsWith("/api")) base = `${base.replace(/\/$/, "")}/api`;
  return base;
}
const API_URL = resolveApiBase();
const AUTH_EVENT_KEY = "auth:event";

const safeStorageGet = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const safeStorageSet = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage-denied/quota errors.
  }
};
const safeStorageRemove = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage-denied/quota errors.
  }
};

const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
});

/** Safe string for toasts / UI — avoids passing API error objects into react-hot-toast (React #31). */
export function formatApiError(err, fallback = "Something went wrong") {
  if (err == null) return fallback;
  const d = err?.response?.data;
  if (d === undefined || d === null) {
    const m = err?.message;
    return typeof m === "string" && m.trim() ? m : fallback;
  }
  if (typeof d === "string") return d;
  if (typeof d.error === "string") return d.error;
  if (typeof d.message === "string") return d.message;
  if (d.error && typeof d.error === "object" && typeof d.error.message === "string") return d.error.message;
  try {
    return JSON.stringify(d);
  } catch {
    return fallback;
  }
}

// On these paths never run 401 refresh/forceLogout — just reject (stops redirect loop)
function isPublicPath() {
  if (typeof window === "undefined") return false;
  const p = (window.location.pathname || "").toLowerCase();
  return p === "/" || p === "/login" || p === "/signup" || p === "/landing" || p.startsWith("/r/") || p === "/forgot-password" || p === "/reset-password" || p === "/verify" || p === "/terms" || p === "/privacy" || p === "/cookies" || p === "/create-ai-model" || p.startsWith("/sk/") || p === "/free-course" || p === "/admin-login";
}

// Request interceptor: tag requests made from public pages so 401 handler never triggers logout for them
api.interceptors.request.use(
  (config) => {
    config._fromPublicPath = isPublicPath();
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// Flag to prevent multiple refresh attempts
let isRefreshing = false;
let failedQueue = [];
let hasForcedLogout = false;
let refreshBlockedUntil = 0;

const processQueue = (error) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve();
    }
  });
  failedQueue = [];
};

const LOGOUT_REDIRECT_KEY = "logout_redirect_ts";
const LOGOUT_REDIRECT_THROTTLE_MS = 6000;

const AUTH_FORCE_LOGOUT_EVENT = "auth:force-logout";

const isLocalHost =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

const forceLogoutOnce = (message = "Session expired. Please login again.") => {
  if (hasForcedLogout) return;
  // On localhost never run logout/redirect — prevents refresh loop when dev CORS or stale auth causes 401s
  if (isLocalHost) return;
  if (typeof window !== "undefined") {
    try {
      const last = parseInt(safeStorageGet(LOGOUT_REDIRECT_KEY) || "0", 10);
      if (Date.now() - last < LOGOUT_REDIRECT_THROTTLE_MS) return;
    } catch (_) {}
  }
  hasForcedLogout = true;
  safeStorageRemove("auth-storage");
  safeStorageSet(
    AUTH_EVENT_KEY,
    JSON.stringify({ type: "logout", reason: message, ts: Date.now() }),
  );
  toast.error(message);
  if (typeof window === "undefined" || window.location.pathname === "/login") return;
  try {
    safeStorageSet(LOGOUT_REDIRECT_KEY, String(Date.now()));
  } catch (_) {}
  // Dispatch only; App's ForceLogoutListener clears store and navigates (no full reload, no import failure loop)
  window.dispatchEvent(new CustomEvent(AUTH_FORCE_LOGOUT_EVENT));
};

if (typeof window !== "undefined" && !window.__authEventListenerRegistered) {
  window.__authEventListenerRegistered = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== AUTH_EVENT_KEY || !event.newValue) return;
    try {
      const payload = JSON.parse(event.newValue);
      if (payload?.type === "logout") {
        safeStorageRemove("auth-storage");
        if (typeof window !== "undefined" && !isLocalHost && window.location.pathname !== "/login") {
          window.dispatchEvent(new CustomEvent(AUTH_FORCE_LOGOUT_EVENT));
        }
      }
    } catch {
      // Ignore malformed payload
    }
  });
}

// Response interceptor - handle errors and token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    // CORS or network errors have no response — never run refresh/logout (prevents loop when localhost is blocked by prod CORS)
    if (!error.response) {
      return Promise.reject(error);
    }
    const isLoginAttempt = originalRequest?.url?.includes("/auth/login");
    const isRefreshAttempt = originalRequest?.url?.includes("/auth/refresh");
    const is401 = error.response?.status === 401;

    // Never trigger refresh or forceLogout when on a public page OR when the request was sent from a public page (prevents loop)
    if (is401 && (isPublicPath() || originalRequest?._fromPublicPath)) {
      return Promise.reject(error);
    }

    // On localhost never refresh or force-logout — avoids dev loop from CORS/stale auth (prod works because same-origin + valid cookies)
    if (is401 && isLocalHost) return Promise.reject(error);

    console.error("🚨 API Error:", {
      url: originalRequest?.url,
      method: originalRequest?.method,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message,
    });

    // Try to refresh token on 401 (except for login/refresh attempts)
    if (is401 && !isLoginAttempt && !isRefreshAttempt && !originalRequest._retry) {
      if (Date.now() < refreshBlockedUntil) {
        return Promise.reject(error);
      }
      if (isRefreshing) {
        // Queue this request while refresh is in progress
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then(() => api(originalRequest))
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Refresh token is sent via secure HTTP-only cookie.
        const response = await axios.post(
          `${API_URL}/auth/refresh`,
          {},
          { withCredentials: true },
        );

        if (response.data.success) {
          const ru = response.data.user;
          const { useAuthStore, enrichUserWithTotalCredits } = await import("../store");
          const currentUser = useAuthStore.getState().user;
          // When refresh returns no user, keep current state and only retry the request (never clear or overwrite)
          if (!ru && !currentUser) {
            processQueue(null);
            return api(originalRequest);
          }
          // Bulletproof merge: only overwrite credit fields when server sends numbers; never replace with undefined
          const existingCredits = {
            credits: currentUser?._legacyCredits ?? currentUser?.credits,
            subscriptionCredits: currentUser?._subscriptionCredits ?? currentUser?.subscriptionCredits,
            purchasedCredits: currentUser?._purchasedCredits ?? currentUser?.purchasedCredits,
          };
          const safeCredits = {
            credits: typeof ru?.credits === "number" ? ru.credits : (existingCredits.credits ?? 0),
            subscriptionCredits: typeof ru?.subscriptionCredits === "number" ? ru.subscriptionCredits : (existingCredits.subscriptionCredits ?? 0),
            purchasedCredits: typeof ru?.purchasedCredits === "number" ? ru.purchasedCredits : (existingCredits.purchasedCredits ?? 0),
          };
          const mergedRaw = ru ? { ...(currentUser || {}), ...ru, ...safeCredits } : currentUser;
          const enrichedUser = mergedRaw ? enrichUserWithTotalCredits(mergedRaw) : null;

          if (enrichedUser) {
            const authStorage = safeStorageGet("auth-storage");
            if (authStorage) {
              try {
                const { state } = JSON.parse(authStorage);
                const updatedState = { ...state, user: enrichedUser };
                safeStorageSet("auth-storage", JSON.stringify({ state: updatedState, version: 0 }));
              } catch (storageParseError) {
                console.warn("Failed to parse persisted auth state:", storageParseError);
              }
            }
            try {
              useAuthStore.setState({ user: enrichedUser });
            } catch (storeSyncError) {
              console.warn("Failed to sync refreshed user into auth store:", storeSyncError);
            }
          }

          processQueue(null);
          return api(originalRequest);
        }
      } catch (refreshError) {
        processQueue(refreshError);
        const refreshStatus = refreshError?.response?.status;
        const refreshMessage = String(refreshError?.response?.data?.message || "").toLowerCase();
        console.error("🔐 Token refresh failed", refreshStatus || "no-status");
        if (
          refreshStatus === 401 ||
          refreshStatus === 403 ||
          // Some backends may still return 400 for missing refresh cookie.
          (refreshStatus === 400 && refreshMessage.includes("refresh token"))
        ) {
          // Refresh token is invalid/expired — force logout
          forceLogoutOnce("Session expired. Please login again.");
        } else {
          // Transient network/server error — do NOT log out.
          // Block further refresh attempts for 10s then allow retry.
          refreshBlockedUntil = Date.now() + 10_000;
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    const requestUrl = originalRequest?.url || "";
    const suppressGlobalError =
      originalRequest?.suppressGlobalError === true ||
      /\/(generate|nsfw|video-repurpose|onboarding)\b/.test(requestUrl);

    // Show detailed error popup (except for 401 login attempts and generation flows that already toast locally)
    if (!isLoginAttempt && !is401 && !suppressGlobalError && showErrorDetailsGlobal) {
      showErrorDetailsGlobal(
        error,
        `API Error: ${error.config?.method?.toUpperCase()} ${error.config?.url}`,
      );
    }

    // Do not force-logout on any trailing 401 here.
    // We already handle explicit refresh-token invalidation in the refresh catch path.
    // Keeping users signed in avoids random logouts from transient/endpoint-specific 401s.

    return Promise.reject(error);
  },
);

// Auth API
export const authAPI = {
  signup: async (email, password, name, deviceFingerprint, userAgent, referralCode = null) => {
    const body = { email, password, name, deviceFingerprint, userAgent };
    if (referralCode) body.referralCode = referralCode;
    const response = await api.post("/auth/signup", body);
    return response.data;
  },

  verifyEmail: async (email, code) => {
    const response = await api.post("/auth/verify-email", { email, code });
    return response.data;
  },

  resendCode: async (email) => {
    const response = await api.post("/auth/resend-code", { email });
    return response.data;
  },

  login: async (email, password, twoFactorCode) => {
    const response = await api.post("/auth/login", { email, password, twoFactorCode });
    return response.data;
  },

  googleAuth: async (
    idToken,
    email,
    displayName,
    uid,
    mode = 'signup',
    referralCode = null,
    deviceFingerprint = null,
    userAgent = null,
  ) => {
    const body = { idToken, email, displayName, uid, mode };
    if (referralCode) body.referralCode = referralCode;
    if (deviceFingerprint) body.deviceFingerprint = deviceFingerprint;
    if (userAgent) body.userAgent = userAgent;
    const response = await api.post("/auth/google", body);
    return response.data;
  },

  firebaseAuth: async (idToken) => {
    const response = await api.post("/auth/google", { idToken });
    return response.data;
  },

  checkEmail: async (email) => {
    const response = await api.post("/auth/check-email", { email });
    return response.data;
  },

  firebaseSignup: async (idToken, name, referralCode = null, deviceFingerprint = null, userAgent = null) => {
    const body = { idToken, name };
    if (referralCode) body.referralCode = referralCode;
    if (deviceFingerprint) body.deviceFingerprint = deviceFingerprint;
    if (userAgent) body.userAgent = userAgent;
    const response = await api.post("/auth/firebase-signup", body);
    return response.data;
  },

  verifyFirebaseEmail: async (email, code) => {
    const response = await api.post("/auth/verify-firebase-email", { email, code });
    return response.data;
  },

  resendFirebaseCode: async (email) => {
    const response = await api.post("/auth/resend-firebase-code", { email });
    return response.data;
  },

  // Two-Factor Authentication
  get2FAStatus: async () => {
    const response = await api.get("/auth/2fa/status");
    return response.data;
  },

  generate2FASecret: async () => {
    const response = await api.post("/auth/2fa/generate");
    return response.data;
  },

  verify2FA: async (code) => {
    const response = await api.post("/auth/2fa/verify", { code });
    return response.data;
  },

  disable2FA: async (code) => {
    const response = await api.post("/auth/2fa/disable", { code });
    return response.data;
  },

  getProfile: async () => {
    const response = await api.get("/auth/profile");
    return response.data;
  },

  updateProfile: async (payload) => {
    const body = typeof payload === "string" ? { name: payload } : payload;
    const response = await api.put("/auth/profile", body);
    return response.data;
  },

  requestEmailChange: async (newEmail, currentPassword) => {
    const response = await api.post("/auth/change-email/request", {
      newEmail,
      currentPassword,
    });
    return response.data;
  },

  verifyEmailChange: async (code, emailChangeToken) => {
    const response = await api.post("/auth/change-email/verify", {
      code,
      emailChangeToken,
    });
    return response.data;
  },

  requestPasswordReset: async (email) => {
    const response = await api.post("/auth/request-password-reset", { email });
    return response.data;
  },

  resetPassword: async (email, code, newPassword) => {
    const response = await api.post("/auth/reset-password", {
      email,
      code,
      newPassword,
    });
    return response.data;
  },

  logout: async () => {
    const response = await api.post("/auth/logout");
    return response.data;
  },
};

// Generation API
export const generationAPI = {
  completeRecreation: async (data) => {
    const response = await api.post("/generate/complete-recreation", data);
    return response.data;
  },

  imageIdentity: async (data) => {
    const response = await api.post("/generate/image-identity", data);
    return response.data;
  },

  describeTarget: async (data) => {
    const response = await api.post("/generate/describe-target", data);
    return response.data;
  },

  videoMotion: async (data) => {
    const response = await api.post("/generate/video-motion", data);
    return response.data;
  },

  faceSwap: async (data) => {
    const response = await api.post("/generate/face-swap", data);
    return response.data;
  },

  // Simplified direct video generation (TikTok/Reel format)
  generateVideoDirectly: async (
    modelId,
    referenceVideoUrl,
    videoDuration,
    tempId,
    options = {},
  ) => {
    const requestBody = {
      modelId,
      referenceVideoUrl,
      videoDuration,
      tempId,
      ultra: options.ultra === true,
      ultraMode: options.ultraMode === true,
      selectedImageUrl: options.selectedImageUrl || undefined,
    };
    console.log("📦 [API] generateVideoDirectly request body:", requestBody);
    return await api.post("/generate/video-directly", requestBody);
  },

  // Face swap video (per-second pricing)
  faceSwapVideo: async (
    sourceVideoUrl,
    modelId,
    videoDuration,
    targetGender = "all",
    tempId,
  ) => {
    return await api.post("/generate/face-swap-video", {
      sourceVideoUrl,
      modelId,
      videoDuration,
      targetGender,
      tempId, // v46 FIX: Send tempId to backend
    });
  },

  getHistory: async (type, limit = 20) => {
    const response = await api.get("/generate/history", {
      params: { type, limit },
    });
    return response.data;
  },
};

// Stripe API
export const stripeAPI = {
  createCheckoutSession: async (tierId, billingCycle, referralCode = null, discountCode = null) => {
    const body = { tierId, billingCycle };
    if (referralCode) body.referralCode = referralCode;
    if (discountCode) body.discountCode = discountCode;
    const response = await api.post("/stripe/create-checkout-session", body);
    return response.data;
  },

  createOneTimeCheckout: async (creditAmount, referralCode = null, discountCode = null) => {
    const body = { creditAmount };
    if (referralCode) body.referralCode = referralCode;
    if (discountCode) body.discountCode = discountCode;
    const response = await api.post("/stripe/create-onetime-checkout", body);
    return response.data;
  },

  createPaymentIntent: async (creditAmount, referralCode = null, discountCode = null) => {
    const body = { creditAmount };
    if (referralCode) body.referralCode = referralCode;
    if (discountCode) body.discountCode = discountCode;
    const response = await api.post("/stripe/create-payment-intent", body);
    return response.data;
  },

  createEmbeddedSubscription: async (tierId, billingCycle, referralCode = null, discountCode = null) => {
    const body = { tierId, billingCycle };
    if (referralCode) body.referralCode = referralCode;
    if (discountCode) body.discountCode = discountCode;
    const response = await api.post("/stripe/create-embedded-subscription", body);
    return response.data;
  },

  validateDiscountCode: async (code, purchaseType, amountCents) => {
    const response = await api.post("/stripe/validate-discount-code", { code, purchaseType, amountCents });
    return response.data;
  },

  confirmPayment: async (paymentIntentId) => {
    const response = await api.post("/stripe/confirm-payment", {
      paymentIntentId,
    });
    return response.data;
  },

  confirmSubscription: async (subscriptionId) => {
    const response = await api.post("/stripe/confirm-subscription", {
      subscriptionId,
    });
    return response.data;
  },

  createSpecialOfferIntent: async (referenceUrl, aiConfig) => {
    const response = await api.post("/stripe/create-special-offer-intent", {
      referenceUrl,
      aiConfig,
    });
    return response.data;
  },

  confirmSpecialOffer: async (paymentIntentId) => {
    const response = await api.post("/stripe/confirm-special-offer", {
      paymentIntentId,
    });
    return response.data;
  },

  getSubscriptionStatus: async () => {
    const response = await api.get("/stripe/subscription-status");
    return response.data;
  },

  cancelSubscription: async () => {
    const response = await api.post("/stripe/cancel-subscription");
    return response.data;
  },

  createPortalSession: async () => {
    const response = await api.post("/stripe/create-portal-session");
    return response.data;
  },
};

export const referralAPI = {
  captureHint: async (referralCode, deviceFingerprint = null, userAgent = null) => {
    const response = await api.post("/referrals/capture", {
      referralCode,
      deviceFingerprint,
      userAgent,
    });
    return response.data;
  },
  resolveCode: async (suffix) => {
    const response = await api.get(`/referrals/resolve/${encodeURIComponent(suffix)}`);
    return response.data;
  },
  getOverview: async () => {
    const response = await api.get("/referrals/me/overview");
    return response.data;
  },
  setMyCode: async (suffix) => {
    const response = await api.post("/referrals/me/code", { suffix });
    return response.data;
  },
  requestPayout: async (walletAddress) => {
    const response = await api.post("/referrals/me/request-payout", { walletAddress });
    return response.data;
  },
  getAdminOverview: async () => {
    const response = await api.get("/referrals/admin/overview");
    return response.data;
  },
  markPayoutPaid: async (requestId, adminNote = "") => {
    const response = await api.post(`/referrals/admin/payout-requests/${requestId}/mark-paid`, { adminNote });
    return response.data;
  },
  markReferrerPaid: async (userId, adminNote = "") => {
    const response = await api.post(`/referrals/admin/users/${userId}/mark-paid`, { adminNote });
    return response.data;
  },
  getReconciliation: async (limit = 100) => {
    const response = await api.get(`/referrals/admin/reconciliation?limit=${encodeURIComponent(limit)}`);
    return response.data;
  },
  linkReconciliation: async ({ userId, referrerUserId, draftId = null, note = "" }) => {
    const response = await api.post("/referrals/admin/reconciliation/link", {
      userId,
      referrerUserId,
      draftId,
      note,
    });
    return response.data;
  },
  setAdvanced: async (userId, advanced) => {
    const response = await api.post(`/referrals/admin/users/${userId}/set-advanced`, { advanced });
    return response.data;
  },
};

export const adminTelemetryAPI = {
  getOverview: async (hours = 24) => {
    const response = await api.get(`/admin/telemetry/overview?hours=${encodeURIComponent(hours)}`);
    return response.data;
  },
  getRequests: async (hours = 24, page = 1, limit = 50) => {
    const response = await api.get(
      `/admin/telemetry/requests?hours=${encodeURIComponent(hours)}&page=${encodeURIComponent(page)}&limit=${encodeURIComponent(limit)}`,
    );
    return response.data;
  },
  getEdgeEvents: async (hours = 24, limit = 100) => {
    const response = await api.get(
      `/admin/telemetry/edge-events?hours=${encodeURIComponent(hours)}&limit=${encodeURIComponent(limit)}`,
    );
    return response.data;
  },
  getEndpointHealth: async () => {
    const response = await api.get("/admin/telemetry/endpoint-health");
    return response.data;
  },
};

/** Logged-in users — values match `getGenerationPricing()` / admin Generation Pricing. */
export const pricingAPI = {
  getGeneration: async () => {
    const response = await api.get("/pricing/generation");
    return response.data;
  },
};

export const brandingAPI = {
  getPublicBranding: async () => {
    const response = await api.get("/brand");
    return response.data;
  },
  getAdminBranding: async () => {
    const response = await api.get("/admin/branding");
    return response.data;
  },
  updateAdminBranding: async (payload) => {
    const response = await api.put("/admin/branding", payload);
    return response.data;
  },
};

export const tutorialsAPI = {
  getCatalog: async () => {
    const response = await api.get("/tutorials/catalog");
    return response.data;
  },
  getAdminSlots: async () => {
    const response = await api.get("/admin/tutorial-video-slots");
    return response.data;
  },
  /** Browser → Vercel Blob (admin handleUpload) then POST URL to DB; falls back to multipart → server (R2) when Blob is off. */
  uploadSlotVideo: async ({ slot, file }) => {
    const config = await getUploadConfig();
    if (config.directToBlob && typeof window !== "undefined") {
      const { upload } = await import("@vercel/blob/client");
      const base = API_URL.startsWith("http")
        ? API_URL.replace(/\/$/, "")
        : `${window.location.origin}${API_URL.startsWith("/") ? API_URL : `/${API_URL}`}`;
      const handleUploadUrl = `${base}/admin/upload/blob`;
      const safeName = (file.name || "video.mp4").replace(/[^a-zA-Z0-9._-]/g, "_") || "video.mp4";
      const slug = String(slot || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/-+/g, "-");
      const pathname = `tutorials/${Date.now()}_${slug}_${safeName}`;
      const blob = await upload(pathname, file, {
        access: "public",
        handleUploadUrl,
        clientPayload: String(slot || "").trim(),
        multipart: (file.size || 0) > 10 * 1024 * 1024,
      });
      const response = await api.post("/admin/tutorial-video-slot-commit", {
        slot: String(slot || "").trim(),
        url: blob.url,
      });
      return response.data;
    }
    const formData = new FormData();
    formData.append("slot", slot);
    formData.append("video", file);
    const response = await api.post("/admin/tutorial-video-slot", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data;
  },
};

export const adminAPI = {
  loraRecovery: async ({
    userId,
    modelName,
    falLoraUrl,
    triggerWord,
    enableNsfw = true,
  }) => {
    const response = await api.post("/admin/lora-recovery", {
      userId,
      modelName,
      falLoraUrl,
      triggerWord,
      enableNsfw,
    });
    return response.data;
  },
  reconcileLostGenerations: async ({ userId, limit = 200, dryRun = true }) => {
    const response = await api.post("/admin/lost-generations/reconcile", {
      userId,
      limit,
      dryRun,
    });
    return response.data;
  },
  reconcileLostGenerationsAll: async ({ limit = 500, dryRun = true }) => {
    const response = await api.post("/admin/lost-generations/reconcile-all", {
      limit,
      dryRun,
    });
    return response.data;
  },
};

// Crypto API (NOWPayments)
export const cryptoAPI = {
  checkStatus: async () => {
    const response = await api.get("/crypto/status");
    return response.data;
  },

  getCurrencies: async () => {
    const response = await api.get("/crypto/currencies");
    return response.data;
  },

  createPayment: async (credits, type = 'credits') => {
    const response = await api.post("/crypto/create-payment", { credits, type });
    return response.data;
  },
};

// Creator Studio API
export const creatorStudioAPI = {
  generate: async ({ prompt, referencePhotos = [], aspectRatio = "1:1", resolution = "1K", nanoBananaModel = "nano-banana-pro" }) => {
    const response = await api.post("/generate/creator-studio", {
      prompt,
      referencePhotos,
      aspectRatio,
      resolution,
      nanoBananaModel,
    });
    return response.data;
  },
  getHistory: async ({ limit = 20, offset = 0 } = {}) => {
    const response = await api.get(`/generations?type=creator-studio&limit=${limit}&offset=${offset}`);
    return response.data;
  },
};

// Real Avatars API
export const avatarAPI = {
  list: async (modelId) => {
    const response = await api.get(`/avatars?modelId=${modelId}`);
    return response.data;
  },

  create: async (formData) => {
    const response = await api.post("/avatars", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data;
  },

  delete: async (id) => {
    const response = await api.delete(`/avatars/${id}`);
    return response.data;
  },

  generateVideo: async (avatarId, { script }) => {
    const response = await api.post(`/avatars/${avatarId}/generate`, { script });
    return response.data;
  },

  getVideoStatus: async (videoId) => {
    const response = await api.get(`/avatars/videos/${videoId}`);
    return response.data;
  },

  listVideos: async (avatarId) => {
    const response = await api.get(`/avatars/${avatarId}/videos`);
    return response.data;
  },
};

// Model API
export const modelAPI = {
  create: async (data) => {
    const response = await api.post("/models", data);
    return response.data;
  },

  getAll: async () => {
    const response = await api.get("/models");
    return response.data;
  },

  getById: async (id) => {
    const response = await api.get(`/models/${id}`);
    return response.data;
  },

  update: async (id, data) => {
    const response = await api.put(`/models/${id}`, data);
    return response.data;
  },

  delete: async (id) => {
    const response = await api.delete(`/models/${id}`);
    return response.data;
  },

  // Generate AI model from parameters (legacy single-step)
  generateAI: async (data) => {
    const response = await api.post("/models/generate-ai", data);
    return response.data;
  },

  // Generate reference image (Phase 1)
  generateReference: async (data) => {
    const response = await api.post("/models/generate-reference", data);
    return response.data;
  },

  // Generate 3 poses from reference (Phase 2)
  generatePoses: async (data) => {
    const response = await api.post("/models/generate-poses", data);
    return response.data;
  },

  generateAdvanced: async (data) => {
    const response = await api.post("/models/generate-advanced", data);
    return response.data;
  },

  getVoiceStudio: async (modelId) => {
    const response = await api.get(`/models/${modelId}/voices`);
    return response.data;
  },

  generateVoiceDesignPreviews: async (modelId, data) => {
    const response = await api.post(`/models/${modelId}/voices/design-previews`, data);
    return response.data;
  },

  confirmDesignedVoice: async (modelId, data) => {
    const response = await api.post(`/models/${modelId}/voices/design-confirm`, data);
    return response.data;
  },

  cloneVoice: async (modelId, formData) => {
    const response = await api.post(`/models/${modelId}/voices/clone`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data;
  },

  selectVoice: async (modelId, voiceId) => {
    const response = await api.post(`/models/${modelId}/voices/${voiceId}/select`);
    return response.data;
  },

  deleteVoice: async (modelId, voiceId) => {
    const response = await api.delete(`/models/${modelId}/voices/${voiceId}`);
    return response.data;
  },

  generateVoiceAudio: async (modelId, data) => {
    const response = await api.post(`/models/${modelId}/voices/generate-audio`, data);
    return response.data;
  },
};

// System API
export const systemAPI = {
  health: async () => {
    const response = await api.get("/health");
    return response.data;
  },
};

export const reformatterAPI = {
  /** List converter job history (outputs kept ~1 month). */
  getHistory: async (cursor) => {
    const params = cursor ? { cursor } : {};
    const res = await api.get("/reformatter/history", { params });
    return res.data;
  },
  /** Upload input file to R2, then start server conversion (user can leave). Returns jobId. */
  convertInBackground: async (file, onUploadProgress) => {
    const name = file?.name || "upload";
    if (onUploadProgress) onUploadProgress(8);
    const publicUrl = await uploadFile(file, (p) => onUploadProgress?.(Math.max(8, Math.min(80, Math.round(p * 0.72)))));
    if (!publicUrl) throw new Error("Could not upload file");
    if (onUploadProgress) onUploadProgress(80);
    const start = await api.post("/reformatter/convert-background", { inputUrl: publicUrl, originalFileName: name });
    if (onUploadProgress) onUploadProgress(100);
    return { success: true, jobId: start.data?.jobId, message: start.data?.message || "Conversion started. Check Conversion history." };
  },
  /** Upload input (Blob-first), then external FFmpeg worker processes the file. */
  convertWithWorker: async (file, onUploadProgress) => {
    const name = file?.name || "upload";
    if (onUploadProgress) onUploadProgress(8);
    const publicUrl = await uploadFile(file, (p) => onUploadProgress?.(Math.max(8, Math.min(60, Math.round(p * 0.52)))));
    if (!publicUrl) throw new Error("Could not upload file");
    if (onUploadProgress) onUploadProgress(60);
    const start = await api.post("/reformatter/convert-with-worker", { inputUrl: publicUrl, originalFileName: name });
    if (onUploadProgress) onUploadProgress(100);
    return {
      success: true,
      jobId: start.data?.jobId,
      message:
        start.data?.message ||
        "Conversion started. You can leave this page — check Conversion history for progress.",
    };
  },
  getJobStatus: async (jobId) => {
    const res = await api.get(`/reformatter/status/${jobId}`);
    return res.data;
  },
};

// Support chat (subscribers only)
export const supportAPI = {
  startChat: async () => {
    const response = await api.post("/support/chat/start");
    return response.data;
  },
  sendMessage: async (sessionId, userMessage, attachmentFiles = [], options = {}) => {
    const form = new FormData();
    form.append("sessionId", sessionId);
    form.append("userMessage", userMessage);
    if (options?.isEndOfChat) {
      form.append("isEndOfChat", "true");
    }
    attachmentFiles.forEach((file) => form.append("attachments", file));
    const response = await api.post("/support/chat/message", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data;
  },
};

// Cached upload config (direct-to-blob avoids 413 when file never hits Vercel server)
let uploadConfigCache = null;
export const getUploadConfig = async () => {
  if (uploadConfigCache != null) return uploadConfigCache;
  try {
    const { data } = await api.get("/upload/config");
    uploadConfigCache = data;
    return uploadConfigCache;
  } catch {
    uploadConfigCache = {
      directToBlob: false,
      maxUploadBytes: null,
      maxUploadLabel: null,
    };
    return uploadConfigCache;
  }
};

// Direct browser → Vercel Blob (no file through server → no 413 Request Entity Too Large)
async function uploadFileDirectToBlob(file, onProgress) {
  const { upload } = await import("@vercel/blob/client");
  const base =
    API_URL.startsWith("http")
      ? API_URL.replace(/\/$/, "")
      : `${window.location.origin}${API_URL.startsWith("/") ? API_URL : "/" + API_URL}`;
  const handleUploadUrl = `${base}/upload/blob`;
  const pathname = `user-uploads/${Date.now()}-${(file.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const blob = await upload(pathname, file, {
    access: "public",
    handleUploadUrl,
    multipart: (file.size || 0) > 10 * 1024 * 1024,
    onUploadProgress:
      onProgress &&
      (({ percentage }) => {
        onProgress(typeof percentage === "number" ? percentage : 0);
      }),
  });
  return blob.url;
}

// Multipart upload through API (file goes through server → can hit 413 on Vercel)
async function uploadFileMultipart(file, onProgress) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post("/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: (progressEvent) => {
      const percentCompleted = Math.round(
        (progressEvent.loaded * 100) / (progressEvent.total || 1),
      );
      if (onProgress) onProgress(percentCompleted);
    },
  });
  return response.data.url;
}

// File upload: Vercel Blob client upload when configured (provider-enforced size via token).
// Multipart /upload is dev-only fallback when Blob is not configured (local testing).
export const uploadFile = async (file, onProgress) => {
  const config = await getUploadConfig();
  if (config.directToBlob) {
    return uploadFileDirectToBlob(file, onProgress);
  }
  if (import.meta.env.DEV) {
    console.warn(
      "[upload] Blob not configured — using multipart /upload (dev only). Set BLOB_READ_WRITE_TOKEN for production.",
    );
    return uploadFileMultipart(file, onProgress);
  }
  throw new Error(
    "Uploads require Vercel Blob. Configure BLOB_READ_WRITE_TOKEN on the server (and optional BLOB_CLIENT_UPLOAD_MAX_BYTES to match your plan).",
  );
};

// Alias for backward compatibility
export const uploadToCloudinary = uploadFile;

export default api;
