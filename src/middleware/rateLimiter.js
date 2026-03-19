import rateLimit from "express-rate-limit";

const isDev = process.env.NODE_ENV === "development";

const userOrIpKey = (req) => {
  return req.user?.userId ? `user:${req.user.userId}` : req.ip;
};

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 5,
  message: {
    success: false,
    message:
      "Too many authentication attempts. Please try again in 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

// Refresh endpoint should be more permissive than login/signup.
// Browsers can trigger bursts after wake-from-sleep/tab-resume, and
// strict auth limiting here causes "stuck" sessions until hard refresh/relogin.
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 120,
  message: {
    success: false,
    message: "Too many session refresh attempts. Please wait a moment and try again.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 10000 : 5,
  message: {
    success: false,
    message: "Too many accounts created. Please try again in 1 hour.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 10000 : 3,
  message: {
    success: false,
    message: "Too many password reset requests. Please try again in 1 hour.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Per-user generation submissions per minute (env: GENERATION_RATE_LIMIT_MAX, default 60)
const generationLimitMax = Math.max(10, parseInt(process.env.GENERATION_RATE_LIMIT_MAX || "60", 10));
export const generationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 10000 : generationLimitMax,
  message: {
    success: false,
    message: "Too many generation requests. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  validate: false,
  keyGenerator: userOrIpKey,
});

export const modelsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: {
    success: false,
    message: "Too many model requests. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  validate: false,
  keyGenerator: userOrIpKey,
});

/** Voice design previews call ElevenLabs; keep abuse low */
export const voiceDesignPreviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 1000 : 20,
  message: {
    success: false,
    message: "Too many voice preview requests. Try again in an hour.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  validate: false,
  keyGenerator: userOrIpKey,
});

export const generationsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: {
    success: false,
    message: "Too many generation history requests. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  validate: false,
  keyGenerator: userOrIpKey,
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const downloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 300 : 60,
  message: {
    success: false,
    error: "Too many download requests. Please slow down.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: userOrIpKey,
});
