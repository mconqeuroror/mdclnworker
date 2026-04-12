import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import apiRoutes from './routes/api.routes.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { cleanupStuckGenerations } from './controllers/generation.controller.js';
import nsfwController from './controllers/nsfw.controller.js';
const { recoverStuckNsfwGenerations, recoverStaleLoraTrainings } = nsfwController;
import generationPoller from './services/generation-poller.service.js';
import prisma from './lib/prisma.js';
import { refundCredits } from './services/credit.service.js';
import { telemetryMiddleware } from './middleware/telemetry.middleware.js';
import { generationSafetyMiddleware } from './middleware/generation-safety.middleware.js';
import {
  captureSystemHealthSnapshot,
  hashIp,
  recordTelemetryEdgeEvent,
  runEndpointHealthChecks,
} from './services/telemetry.service.js';
import { processPendingBlobRemirrorQueue } from "./services/blob-remirror-queue.service.js";
import { runSignupNoPurchaseWinbackCampaign } from "./services/signup-winback-email.service.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';

// CRITICAL: Validate required secrets before starting
if (!process.env.JWT_SECRET) {
  if (isProduction) {
    console.error('❌ FATAL: JWT_SECRET is required in production');
    process.exit(1);
  } else {
    console.warn('⚠️ WARNING: JWT_SECRET not set - using insecure default for development');
    process.env.JWT_SECRET = 'dev-jwt-secret-do-not-use-in-production';
  }
}

// Production-only: Stripe + crypto secrets (main web app / checkout). API-only deployments
// (same codebase, no payment routes needed) set REQUIRE_PAYMENT_SECRETS=false in env.
if (isProduction && process.env.REQUIRE_PAYMENT_SECRETS !== 'false') {
  const productionSecrets = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'NOWPAYMENTS_IPN_SECRET'];
  const missingProdSecrets = productionSecrets.filter((key) => !process.env[key]);
  if (missingProdSecrets.length > 0) {
    console.error('❌ FATAL: Missing production secrets:', missingProdSecrets.join(', '));
    console.error(
      'Set Stripe/crypto env vars on the app that runs checkout, or set REQUIRE_PAYMENT_SECRETS=false for an API-only deployment.',
    );
    process.exit(1);
  }
} else if (isProduction && process.env.REQUIRE_PAYMENT_SECRETS === 'false') {
  console.log(
    'ℹ️ REQUIRE_PAYMENT_SECRETS=false — skipping Stripe/crypto secret check (API-only / worker deployment).',
  );
}

const app = express();

// Apple Pay domain verification — mount first (before CORS, auth, /api rate limits).
// Apple's crawler GETs /.well-known/... with no session; must not sit behind auth.
const wellKnownDirs = [
  path.join(__dirname, 'public', '.well-known'),
  path.join(__dirname, '..', 'client', 'public', '.well-known'),
];
for (const dir of wellKnownDirs) {
  if (existsSync(dir)) {
    app.use('/.well-known', express.static(dir));
    console.log('📎 Serving /.well-known (Apple Pay domain association) from:', dir);
    break;
  }
}

// Prefer SERVER_PORT so the backend never binds to a platform-assigned "frontend" PORT (e.g. Replit 3001)
const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 5000) || 5000;
const readIntervalMs = (value, fallbackMs) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
};
const STUCK_GENERATIONS_CLEANUP_INTERVAL_MS =
  readIntervalMs(process.env.STUCK_GENERATIONS_CLEANUP_INTERVAL_MS, 10 * 60 * 1000);
const TELEMETRY_INFRA_SNAPSHOT_INTERVAL_MS =
  readIntervalMs(process.env.TELEMETRY_INFRA_SNAPSHOT_INTERVAL_MS, 5 * 60 * 1000);
const ENDPOINT_HEALTHCHECK_INTERVAL_MS =
  readIntervalMs(process.env.ENDPOINT_HEALTHCHECK_INTERVAL_MS, 15 * 60 * 1000);
const BLOB_REMIRROR_QUEUE_INTERVAL_MS =
  readIntervalMs(process.env.BLOB_REMIRROR_QUEUE_INTERVAL_MS, 60 * 1000);
const SIGNUP_WINBACK_EMAIL_INTERVAL_MS =
  readIntervalMs(process.env.SIGNUP_WINBACK_EMAIL_INTERVAL_MS, 30 * 60 * 1000);

// Middleware - strict origin allowlist for production
const allowedOrigins = new Set(
  [
    process.env.FRONTEND_URL,
    process.env.CLIENT_URL,
    "https://modelclone.app",
    "https://www.modelclone.app",
    "https://api.wavespeed.ai", // WaveSpeed webhooks call our /api/wavespeed/callback
    "https://queue.fal.run",   // fal.ai webhooks (training + faceswap callbacks)
    "https://rest.fal.ai",
    ...(process.env.CORS_ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ].filter(Boolean),
);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, server-side, same-origin)
    if (!origin) return callback(null, true);

    let parsedOrigin;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      return callback(new Error("Invalid origin"));
    }

    // In development, allow local and replit preview domains.
    if (!isProduction) {
      if (
        parsedOrigin.hostname === "localhost" ||
        parsedOrigin.hostname === "127.0.0.1" ||
        parsedOrigin.hostname.endsWith(".replit.dev") ||
        parsedOrigin.hostname.endsWith(".repl.co") ||
        parsedOrigin.hostname.endsWith(".replit.app")
      ) {
        return callback(null, true);
      }
    }

    // Always allow Vercel preview/production deployments for this project
    if (
      parsedOrigin.hostname.endsWith(".vercel.app") ||
      parsedOrigin.hostname.endsWith(".mdlcln.vercel.app")
    ) {
      return callback(null, true);
    }

    // In all environments, allow configured exact origins only.
    if (allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    // Log blocked origin for debugging
    console.warn('⚠️ CORS blocked origin:', origin);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Trust proxy in production (Replit deploys behind a reverse proxy).
// Without this, all requests appear from the same IP and rate limiting
// becomes a single shared bucket for ALL users.
app.set("trust proxy", isProduction ? 1 : false);

// Logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check — used by the keepalive self-ping to reset Replit's idle-kill timer
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// CRITICAL: Mount webhooks BEFORE body parsing
// Webhooks need raw body for signature verification (KIE callback needs it for reliable payload on Vercel)
import stripeWebhookRouter from './routes/stripe.webhook.js';
import cryptoWebhookRouter from './routes/crypto.webhook.js';
import kieCallbackRoutes from './routes/kie-callback.routes.js';
import piapiCallbackRoutes from './routes/piapi-callback.routes.js';
import wavespeedCallbackRoutes from './routes/wavespeed-callback.routes.js';
import videoRepurposeRoutes from './routes/video-repurpose.routes.js';
import img2imgRoutes from './routes/img2img.routes.js';
import viralReelsRoutes from './routes/viral-reels.routes.js';
import supportRoutes from './routes/support.routes.js';
import runpodCallbackRoutes from './routes/runpod-callback.routes.js';
import falCallbackRoutes from './routes/fal-callback.routes.js';
import telegramAuthRoutes from './routes/auth/telegram.js';
import telegramWebhookRoutes from './routes/telegram/webhook.js';
app.use('/api/stripe/webhook', stripeWebhookRouter);
app.use('/api/crypto/webhook', cryptoWebhookRouter);
app.use('/api/kie/callback', kieCallbackRoutes);
app.use('/api/piapi/callback', piapiCallbackRoutes);
app.use('/api/wavespeed/callback', wavespeedCallbackRoutes);
app.use('/api/fal/webhook', falCallbackRoutes);
app.use('/api/runpod', runpodCallbackRoutes);

// Request size limits (prevent DOS attacks)
// NOTE: This comes AFTER webhooks to preserve raw body for signature verification
const BODY_LIMIT = process.env.BODY_LIMIT || "50mb";
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

// Cookie parser for HTTP-only auth cookies
app.use(cookieParser());

// API telemetry capture (traffic + edge-case signals)
app.use(telemetryMiddleware());

// Global rate limiting (catch-all protection)
// Skip rate limiting for admin routes (already protected by auth + admin role check)
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/admin')) return next();
  if (req.path.startsWith('/runpod/callback')) return next();
  if (req.path.startsWith('/heygen/webhook')) return next();
  return apiLimiter(req, res, next);
});

// AI safety constraints for generation endpoints:
// - blocks child sexual content globally
// - blocks explicit NSFW sex scenes on ModelClone-X (mild adult nudity allowed)
app.use('/api', generationSafetyMiddleware);

// Admin impersonation login - sets auth cookies from a token in the URL
app.get('/admin-login', async (req, res) => {
  try {
    const token = (req.query.token || '').trim();
    if (!token) return res.status(400).send('Missing token');

    const jwt = (await import('jsonwebtoken')).default;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.impersonatedBy) {
      return res.status(403).send('Invalid impersonation token');
    }

    const target = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { banLocked: true },
    });
    if (target?.banLocked) {
      return res.status(403).send('Account suspended');
    }

    const { setAuthCookie, setRefreshCookie } = await import('./middleware/auth.middleware.js');

    const accessToken = jwt.sign(
      { userId: decoded.userId, email: decoded.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const refreshToken = jwt.sign(
      { userId: decoded.userId, email: decoded.email, type: 'refresh' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    setAuthCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);

    console.log(`🔑 Admin impersonation login: ${decoded.email} (by admin ${decoded.impersonatedBy})`);
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Admin login error:', error.message);
    res.status(401).send('Invalid or expired token');
  }
});

// Routes: mount specific /api/* path prefixes BEFORE the catch-all /api router
// so /api/viral-reels/:id/stream and /api/viral-reels/media are reachable
app.use('/api/viral-reels', viralReelsRoutes);
app.use('/api/video-repurpose', videoRepurposeRoutes);
app.use('/api/img2img', img2imgRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/auth', telegramAuthRoutes);
app.use('/api/telegram', telegramWebhookRoutes);
app.use('/api', apiRoutes);

// ── Public unsubscribe endpoint (no auth required — email links click here) ──
function renderUnsubscribePage(title, body, isError = false, token = null) {
  const escH = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const actionHtml = !isError && token
    ? `<form method="POST" action="/api/unsubscribe" style="margin:0 0 16px">
         <input type="hidden" name="token" value="${escH(token)}" />
         <button type="submit" style="background:#111;color:#fff;border:none;border-radius:6px;padding:10px 14px;font-size:13px;font-weight:600;cursor:pointer">Confirm unsubscribe</button>
       </form>`
    : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escH(title)}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f3;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}.card{background:#fff;border:1px solid #e2e2de;border-radius:8px;max-width:420px;width:100%;padding:40px 36px;text-align:center}.icon{font-size:40px;margin-bottom:16px}h1{font-size:20px;font-weight:600;color:#111;margin:0 0 8px}p{font-size:14px;color:#666;line-height:1.6;margin:0 0 24px}a{font-size:13px;color:#111;font-weight:500}</style></head><body><div class="card"><div class="icon">${isError ? '⚠️' : '✉️'}</div><h1>${escH(title)}</h1><p>${escH(body)}</p>${actionHtml}<a href="/">Back to ModelClone</a></div></body></html>`;
}

app.get('/api/unsubscribe', async (req, res) => {
  const sendPage = (title, body, isError = false, token = null) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderUnsubscribePage(title, body, isError, token));
  };

  const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  if (!token) return sendPage('Missing token', 'No unsubscribe token was provided. Please use the link from your email.', true);

  try {
    const jwt = (await import('jsonwebtoken')).default;
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return sendPage('Invalid link', 'This unsubscribe link is invalid, expired, or has been tampered with. Please contact support.', true);
    }

    if (payload.purpose !== 'unsubscribe' || !payload.sub) {
      return sendPage('Invalid link', 'This link cannot be used for unsubscribing.', true);
    }

    const email = String(payload.sub).toLowerCase().trim();
    if (!email) return sendPage('Invalid link', 'This link cannot be used for unsubscribing.', true);
    return sendPage('Confirm unsubscribe', `${email} will be removed from our mailing list. Click below to confirm.`, false, token);
  } catch (err) {
    console.error('Unsubscribe error:', err?.message ?? err, err?.stack);
    return sendPage('Something went wrong', 'We were unable to process your request. Please try again or contact support.', true);
  }
});

app.post('/api/unsubscribe', async (req, res) => {
  const sendPage = (title, body, isError = false) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderUnsubscribePage(title, body, isError, null));
  };

  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token) return sendPage('Missing token', 'No unsubscribe token was provided. Please use the link from your email.', true);

  try {
    const jwt = (await import('jsonwebtoken')).default;
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return sendPage('Invalid link', 'This unsubscribe link is invalid, expired, or has been tampered with. Please contact support.', true);
    }

    if (payload.purpose !== 'unsubscribe' || !payload.sub) {
      return sendPage('Invalid link', 'This link cannot be used for unsubscribing.', true);
    }
    const email = String(payload.sub).toLowerCase().trim();
    if (!email) return sendPage('Invalid link', 'This link cannot be used for unsubscribing.', true);

    await prisma.emailUnsubscribe.upsert({
      where: { email },
      update: {},
      create: { email },
    });

    console.log(`✉️ Unsubscribed: ${email}`);
    return sendPage('You\'ve been unsubscribed', `${email} has been removed from our mailing list. You won't receive any more newsletters from us.`, false);
  } catch (err) {
    console.error('Unsubscribe POST error:', err?.message ?? err, err?.stack);
    return sendPage('Something went wrong', 'We were unable to process your request. Please try again or contact support.', true);
  }
});

// Vite integration for development OR static serving for production
if (!isProduction) {
  // Development: lazy-import Vite (devDependency — not available in production/Vercel)
  // Wrapped in async IIFE so esbuild can bundle without top-level await issues
  (async () => {
    try {
      const { createServer } = await import('vite');
      const vite = await createServer({
        server: { 
          middlewareMode: true,
          host: '0.0.0.0',
          strictPort: false,
          allowedHosts: [
            '96b8f0b2-1966-48dc-8c95-9420f48db9f9-00-ubwrmqeunf9f.worf.replit.dev',
            '.replit.dev',
            '.repl.co',
          ],
        },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.error('Vite dev server failed to start:', e.message);
    }
  })();
} else if (!process.env.VERCEL) {
  // Production non-Vercel (Replit/Railway/Render): serve built SPA from dist/public
  // In production, __dirname is 'dist' folder, so public is in 'dist/public'
  const clientDistPath = path.join(__dirname, 'public');
  console.log('📁 Serving production build from:', clientDistPath);
  app.use(express.static(clientDistPath));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}
// On Vercel: static files are served from /public by Vercel CDN — no express.static needed

// Error handler
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large' || err?.name === 'PayloadTooLargeError') {
    return res.status(413).json({
      success: false,
      message: 'File too big. Please upload a smaller file.',
      code: 'FILE_TOO_BIG',
    });
  }
  console.error('Server error:', err);
  const routePath = req?.originalUrl?.split("?")[0] || req?.path || "/";
  const ipRaw = String(req?.headers?.["x-forwarded-for"] || req?.ip || "")
    .split(",")[0]
    .trim();
  void recordTelemetryEdgeEvent({
    eventType: "unhandled_exception",
    severity: "critical",
    message: "Unhandled Express error",
    routePath,
    statusCode: 500,
    userId: req?.user?.userId || req?.user?.id || null,
    ipHash: hashIp(ipRaw),
    details: {
      name: err?.name || "Error",
      message: err?.message || "Unknown",
    },
  });
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// Start server (skip on Vercel — they use the exported app as the serverless handler)
if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', async () => {
  console.log('');
  console.log('🚀 =============================================');
  console.log('🚀  MODEL CLONE - YOUR WORKFLOW');
  console.log('🚀 =============================================');
  console.log('');
  console.log(`📡 Server: http://localhost:${PORT}`);
  console.log(`🔑 WaveSpeed: ${process.env.WAVESPEED_API_KEY ? '✅ Configured' : '❌ Missing'}`);
  console.log(`🔧 Mode: ${isProduction ? 'Production' : 'Development (Vite HMR)'}`);
  console.log('');
  console.log('📚 YOUR WORKFLOW ENDPOINTS:');
  console.log('   POST /api/generate/image-identity       - Step 1: Identity recreation');
  console.log('   POST /api/generate/video-motion         - Step 2: Motion transfer');
  console.log('   POST /api/generate/complete-recreation  - Both steps together ⭐');
  console.log('');
  console.log('🎯 Your exact WaveSpeed workflow is ready!');
  console.log('');
  
  // Run cleanup on startup to clear any stuck generations from crashes/restarts
  try {
    await cleanupStuckGenerations(null, null);
  } catch (error) {
    console.error('Startup cleanup failed (non-fatal):', error.message);
  }

  // Recover recent NSFW generations that were interrupted by server restart
  try {
    await recoverStuckNsfwGenerations();
  } catch (error) {
    console.error('NSFW recovery failed (non-fatal):', error.message);
  }
  try {
    const stale = await recoverStaleLoraTrainings();
    if ((stale?.checked || 0) > 0) {
      console.log("🧯 Startup stale LoRA recovery:", stale);
    }
  } catch (error) {
    console.error('Stale LoRA recovery failed on startup (non-fatal):', error.message);
  }

  if (process.env.RUN_STARTUP_DATA_FIXES === "true") {
    // Optional one-time manual data fixes; disabled by default in production.
    // Keep this behind an explicit env flag to avoid accidental data mutation on startup.
    try {
      const migrationCutoff = new Date("2026-02-15T00:00:00Z");
      const flagged = await prisma.trainedLora.updateMany({
        where: { status: "ready", trainedAt: { lt: migrationCutoff } },
        data: { status: "legacy_flux" },
      });
      if (flagged.count > 0) {
        console.log(`🔄 Flagged ${flagged.count} old Flux LoRAs as legacy`);
        const legacyLoraIds = (await prisma.trainedLora.findMany({
          where: { status: "legacy_flux" },
          select: { id: true },
        })).map(l => l.id);
        await prisma.savedModel.updateMany({
          where: { activeLoraId: { in: legacyLoraIds } },
          data: { activeLoraId: null, nsfwUnlocked: false },
        });
      }
    } catch (error) {
      console.error('Flux LoRA migration failed (non-fatal):', error.message);
    }
    
    // One-time fix: Repair "Natlie Core" model with empty R2 photo files
    try {
      const brokenModel = await prisma.savedModel.findUnique({
        where: { id: "da66a6db-6c86-4974-9803-a1183679e6f5" },
        select: { id: true, name: true, photo1Url: true },
      });
      if (brokenModel && brokenModel.photo1Url.includes("r2.dev/models/")) {
        try {
          const headRes = await fetch(brokenModel.photo1Url, { method: "HEAD" });
          const contentLength = parseInt(headRes.headers.get("content-length") || "0", 10);
          if (contentLength === 0) {
            await prisma.savedModel.update({
              where: { id: brokenModel.id },
              data: {
                photo1Url: "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771856602367_8trplv4h.png",
                photo2Url: "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771856770271_2vncd06c.png",
                photo3Url: "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771856823915_vn0ercdo.png",
                thumbnail: "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771856602367_8trplv4h.png",
              },
            });
            console.log(`🔧 Fixed empty photos for model "${brokenModel.name}"`);
          }
        } catch (e) { /* ignore fetch failures */ }
      }
    } catch (error) {
      console.error('Model photo fix failed (non-fatal):', error.message);
    }

    // One-time: Assign external LoRA to MuscleMommy model for info@essentialfans.agency
    try {
      const targetUser = await prisma.user.findFirst({
        where: { email: "info@essentialfans.agency" },
        select: { id: true },
      });
      if (targetUser) {
        const targetModel = await prisma.savedModel.findFirst({
          where: { userId: targetUser.id, name: { contains: "Muscle", mode: "insensitive" } },
        });
        if (targetModel && !targetModel.activeLoraId) {
          const loraUrl = "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/loras/1771879455857_musclemommy_weights.safetensors";
          const newLora = await prisma.trainedLora.create({
            data: {
              modelId: targetModel.id,
              name: "MuscleMommy LoRA",
              status: "ready",
              loraUrl: loraUrl,
              triggerWord: "musclemommy_lora",
              trainedAt: new Date(),
            },
          });
          await prisma.savedModel.update({
            where: { id: targetModel.id },
            data: {
              activeLoraId: newLora.id,
              loraStatus: "ready",
              loraUrl: loraUrl,
              loraTriggerWord: "musclemommy_lora",
              loraTrainedAt: new Date(),
              nsfwOverride: true,
              nsfwUnlocked: true,
            },
          });
          console.log(`✅ Assigned MuscleMommy LoRA to model "${targetModel.name}" for info@essentialfans.agency`);
        } else if (targetModel?.activeLoraId) {
          if (targetModel.loraTriggerWord === "muclemommy_lora") {
            await prisma.savedModel.update({
              where: { id: targetModel.id },
              data: { loraTriggerWord: "musclemommy_lora" },
            });
            if (targetModel.activeLoraId) {
              await prisma.trainedLora.updateMany({
                where: { id: targetModel.activeLoraId, triggerWord: "muclemommy_lora" },
                data: { triggerWord: "musclemommy_lora" },
              });
            }
            console.log(`🔧 Fixed MuscleMommy trigger word: muclemommy_lora → musclemommy_lora`);
          }
        }
      }
    } catch (error) {
      console.error('MuscleMommy LoRA assignment failed (non-fatal):', error.message);
    }

    // One-time: Import MuscleMommy reference photos into gallery
    try {
      const MM_USER = "fbfb2c4d-b872-4df1-ae44-e4d6b1b55593";
      const MM_MODEL = "74cec983-9fae-47c7-a9ae-365eb0517b55";
      const modelExists = await prisma.savedModel.findUnique({ where: { id: MM_MODEL }, select: { id: true } });
      if (modelExists) {
        const existingCount = await prisma.generation.count({
          where: { userId: MM_USER, modelId: MM_MODEL, prompt: "MuscleMommy reference photo" }
        });
        if (existingCount === 0) {
          const mmUrls = [
            "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771889417210_jbssnktj.png",
            "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771889418512_sb144e8h.jpg",
            "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771889420014_lq5g29zl.jpg",
            "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771889421466_0yoo6198.jpg",
            "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771889422627_lzpmo29q.jpg",
            "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771889423803_0lmvjrz9.png",
            "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771889425106_ucnf7yaq.jpg",
            "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771889426314_bbxgzgfd.jpg",
            "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771889427309_8713loh4.jpg",
            "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771889428453_pgk7c6n5.jpg",
            "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771889429648_adaeehj1.jpg",
            "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771889430778_0susz1y1.jpg",
            "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771889431960_aq7kj91u.jpg",
            "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771889433267_4ic2z1g9.jpg",
            "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771889434439_qay3jpym.jpg",
            "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771889435936_1ihrkgys.png",
            "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771889437280_8tcxszrq.jpg",
            "https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/generations/1771889438564_4vaj1pz6.jpg",
          ];
          for (const url of mmUrls) {
            await prisma.generation.create({
              data: {
                userId: MM_USER, modelId: MM_MODEL, type: "nsfw",
                prompt: "MuscleMommy reference photo", creditsCost: 0,
                creditsRefunded: false, actualCostUSD: 0, outputUrl: url,
                status: "completed", isNsfw: true, isTrial: false, completedAt: new Date(),
              },
            });
          }
          console.log(`✅ Imported ${mmUrls.length} MuscleMommy reference photos into gallery`);
        }
      }
    } catch (error) {
      console.error('MuscleMommy gallery import failed (non-fatal):', error.message);
    }
  }

  // Start background generation poller
  console.log('🔄 Starting background generation poller...');
  generationPoller.start();
  console.log('✅ Background poller running - all generations will auto-update!');

  // Periodic watchdog: mark stale jobs as failed + refund credits
  let cleanupInProgress = false;
  setInterval(async () => {
    if (cleanupInProgress) return;
    cleanupInProgress = true;
    try {
      await cleanupStuckGenerations(null, null);
    } catch (error) {
      console.error('Periodic stuck-generation cleanup failed (non-fatal):', error.message);
    } finally {
      cleanupInProgress = false;
    }
  }, STUCK_GENERATIONS_CLEANUP_INTERVAL_MS);
  console.log(`🧹 Periodic stuck-generation cleanup enabled (${Math.round(STUCK_GENERATIONS_CLEANUP_INTERVAL_MS / 1000)}s interval)`);

  let blobRemirrorInProgress = false;
  setInterval(async () => {
    if (blobRemirrorInProgress) return;
    blobRemirrorInProgress = true;
    try {
      const stats = await processPendingBlobRemirrorQueue({ limit: 20 });
      if (stats?.processed) {
        console.log("📦 Blob re-mirror queue processed:", stats);
      }
    } catch (error) {
      console.error("Blob re-mirror queue failed (non-fatal):", error?.message || error);
    } finally {
      blobRemirrorInProgress = false;
    }
  }, BLOB_REMIRROR_QUEUE_INTERVAL_MS);
  console.log(`📦 Blob re-mirror queue enabled (${Math.round(BLOB_REMIRROR_QUEUE_INTERVAL_MS / 1000)}s interval)`);

  let signupWinbackInProgress = false;
  const runSignupWinbackTick = async () => {
    if (signupWinbackInProgress) return;
    signupWinbackInProgress = true;
    try {
      const summary = await runSignupNoPurchaseWinbackCampaign();
      if ((summary?.sent || 0) > 0 || (summary?.converted || 0) > 0) {
        console.log("📨 Signup winback campaign:", summary);
      }
    } catch (error) {
      console.error("Signup winback campaign failed (non-fatal):", error?.message || error);
    } finally {
      signupWinbackInProgress = false;
    }
  };
  await runSignupWinbackTick();
  setInterval(runSignupWinbackTick, SIGNUP_WINBACK_EMAIL_INTERVAL_MS);
  console.log(
    `📨 Signup winback email automation enabled (${Math.round(SIGNUP_WINBACK_EMAIL_INTERVAL_MS / 1000)}s interval)`,
  );

  // Heal stuck "generating" models every 10 min (initial 3-pose creation only).
  let modelHealingInProgress = false;
  setInterval(async () => {
    if (modelHealingInProgress) return;
    modelHealingInProgress = true;
    try {
      const cutoff = new Date(Date.now() - 15 * 60 * 1000);
      const stuckModels = await prisma.savedModel.findMany({
        where: {
          status: 'generating',
          createdAt: { lt: cutoff },
          loraStatus: { not: 'training' },
        },
        select: { id: true, userId: true, createdAt: true }
      });
      if (stuckModels.length > 0) {
        console.log(`⚠️ Found ${stuckModels.length} stuck generating models — healing...`);
        await prisma.savedModel.updateMany({
          where: { id: { in: stuckModels.map(m => m.id) } },
          data: { status: 'ready' }
        });
        console.log(`✅ Healed ${stuckModels.length} stuck models to 'ready'`);
      }
    } catch (error) {
      console.error('Model healing job failed (non-fatal):', error.message);
    } finally {
      modelHealingInProgress = false;
    }
  }, 10 * 60 * 1000);
  console.log('🩹 Stuck model healing enabled (600s)');

  // Stale LoRA training watchdog: if a training row is >4h old, poll fal result.
  // Completed rows are finalized; failed/stuck rows are failed and credits refunded once.
  let staleLoraRecoveryInProgress = false;
  const STALE_LORA_RECOVERY_INTERVAL_MS =
    readIntervalMs(process.env.STALE_LORA_RECOVERY_INTERVAL_MS, 10 * 60 * 1000);
  setInterval(async () => {
    if (staleLoraRecoveryInProgress) return;
    staleLoraRecoveryInProgress = true;
    try {
      const stale = await recoverStaleLoraTrainings();
      if ((stale?.checked || 0) > 0) {
        console.log("🧯 Periodic stale LoRA recovery:", stale);
      }
    } catch (error) {
      console.error('Periodic stale LoRA recovery failed (non-fatal):', error.message);
    } finally {
      staleLoraRecoveryInProgress = false;
    }
  }, STALE_LORA_RECOVERY_INTERVAL_MS);
  console.log(
    `🧯 Stale LoRA recovery enabled (${Math.round(STALE_LORA_RECOVERY_INTERVAL_MS / 1000)}s interval; stale after ${Math.round((Number(process.env.LORA_STALE_RECOVERY_MS) || 4 * 60 * 60 * 1000) / 1000)}s)`,
  );

  // Periodic system snapshots for infra monitoring
  await captureSystemHealthSnapshot();
  setInterval(() => {
    void captureSystemHealthSnapshot();
  }, TELEMETRY_INFRA_SNAPSHOT_INTERVAL_MS);
  console.log(`📈 Telemetry infra snapshots enabled (${Math.round(TELEMETRY_INFRA_SNAPSHOT_INTERVAL_MS / 1000)}s interval)`);

  // Endpoint health status snapshots every 15 minutes
  let endpointHealthInProgress = false;
  await runEndpointHealthChecks({ appPort: PORT });
  setInterval(async () => {
    if (endpointHealthInProgress) return;
    endpointHealthInProgress = true;
    try {
      await runEndpointHealthChecks({ appPort: PORT });
    } catch (error) {
      console.error('Endpoint healthcheck run failed (non-fatal):', error.message);
    } finally {
      endpointHealthInProgress = false;
    }
  }, ENDPOINT_HEALTHCHECK_INTERVAL_MS);
  console.log(`🩺 Endpoint health checks enabled (${Math.round(ENDPOINT_HEALTHCHECK_INTERVAL_MS / 1000)}s interval)`);
  console.log('');

  // Graceful shutdown on SIGTERM/SIGINT (Heroku, Docker, etc.)
  const shutdown = () => {
    console.log('\n🛑 Graceful shutdown initiated...');
    generationPoller.stop();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  });
}

export default app;

