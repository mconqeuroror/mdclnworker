import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "ModelClone-App-Documentation.pdf");

const doc = new PDFDocument({
  size: "A4",
  margins: { top: 55, bottom: 55, left: 60, right: 60 },
  bufferPages: true,
  info: {
    Title: "ModelClone — Complete Application Documentation",
    Author: "ModelClone Engineering",
    Subject: "Full technical documentation",
  },
  // Set a dark page background via the underlying Compress setting
});

const stream = fs.createWriteStream(OUT);
doc.pipe(stream);

// ── Colours ───────────────────────────────────────────────────────────────────
const BG = "#0a0a0f";
const PURPLE = "#a855f7";
const PURPLE_L = "#c084fc";
const BLUE = "#3b82f6";
const TEAL = "#14b8a6";
const TEXT = "#e2e8f0";
const MUTED = "#94a3b8";
const CODE_BG = "#111827";
const WHITE = "#ffffff";
const H1C = "#f8fafc";
const H2C = "#c084fc";
const H3C = "#7dd3fc";
const TH_BG = "#1e1b4b";
const TR1 = "#0f172a";
const TR2 = "#0d1526";
const BORDER = "#1e293b";

const PW = doc.page.width;
const PH = doc.page.height;
const ML = 60;
const MR = 60;
const TW = PW - ML - MR;

// ── BG helper (no event handler — call explicitly) ────────────────────────────
function bg() {
  doc.save();
  doc.rect(0, 0, PW, PH).fill(BG);
  doc.restore();
}

// ── Text helpers ──────────────────────────────────────────────────────────────
function h1(text) {
  doc.moveDown(0.5);
  doc.fontSize(20).fillColor(H1C).font("Helvetica-Bold")
    .text(text, ML, doc.y, { width: TW });
  doc.moveDown(0.3);
  doc.moveTo(ML, doc.y).lineTo(PW - MR, doc.y)
    .lineWidth(1.5).strokeColor(PURPLE).stroke();
  doc.moveDown(0.7);
}

function h2(text) {
  doc.moveDown(0.7);
  doc.fontSize(13).fillColor(H2C).font("Helvetica-Bold")
    .text(text, ML, doc.y, { width: TW });
  doc.moveDown(0.4);
}

function h3(text) {
  doc.moveDown(0.4);
  doc.fontSize(10.5).fillColor(H3C).font("Helvetica-Bold")
    .text(text, ML, doc.y, { width: TW });
  doc.moveDown(0.3);
}

function para(text, color) {
  doc.fontSize(9.5).fillColor(color || TEXT).font("Helvetica")
    .text(text, ML, doc.y, { width: TW, lineGap: 2 });
  doc.moveDown(0.4);
}

function bullet(items, indent) {
  const ix = indent || 70;
  items.forEach(item => {
    const label = (typeof item === "object") ? item.label : null;
    const text = (typeof item === "object") ? item.text : item;
    if (label) {
      doc.fontSize(9.5).fillColor(PURPLE_L).font("Helvetica-Bold")
        .text(`• ${label}: `, ix, doc.y, { continued: true, width: TW });
      doc.fillColor(TEXT).font("Helvetica")
        .text(text, { lineGap: 2 });
    } else {
      doc.fontSize(9.5).fillColor(TEXT).font("Helvetica")
        .text(`• ${text}`, ix, doc.y, { width: TW - (ix - ML), lineGap: 2 });
    }
    doc.moveDown(0.2);
  });
  doc.moveDown(0.2);
}

function codeBlock(text) {
  const lines = text.split("\n");
  const LH = 12.5;
  const PAD = 10;
  const boxH = lines.length * LH + PAD * 2;
  const x = ML + 5;
  const w = TW - 10;
  const y = doc.y;
  doc.save();
  doc.rect(x, y, w, boxH).fill(CODE_BG);
  doc.rect(x, y, 3, boxH).fill(PURPLE);
  doc.fontSize(7.8).fillColor(TEAL).font("Courier");
  lines.forEach((line, i) => {
    doc.text(line, x + 12, y + PAD + i * LH, { lineBreak: false, width: w - 20 });
  });
  doc.restore();
  doc.y = y + boxH + 8;
  doc.moveDown(0.2);
}

function tableRow(cols, widths, isHeader, even) {
  const x0 = ML;
  const rowH = 16;
  const y = doc.y;
  const bg2 = isHeader ? TH_BG : (even ? TR1 : TR2);
  doc.save();
  doc.rect(x0, y, widths.reduce((a, b) => a + b, 0), rowH).fill(bg2);
  let xc = x0;
  cols.forEach((cell, i) => {
    doc.fontSize(isHeader ? 7.5 : 8).fillColor(isHeader ? PURPLE_L : TEXT)
      .font(isHeader ? "Helvetica-Bold" : "Helvetica")
      .text(String(cell || ""), xc + 4, y + 4, { width: widths[i] - 8, lineBreak: false });
    xc += widths[i];
  });
  doc.restore();
  doc.y = y + rowH + 1;
}

function tbl(headers, rows, widths) {
  tableRow(headers, widths, true, false);
  rows.forEach((r, i) => tableRow(r, widths, false, i % 2 === 0));
  doc.moveDown(0.4);
}

function np() {
  doc.addPage();
  bg();
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE 1 — COVER
// ─────────────────────────────────────────────────────────────────────────────
bg();

// Header band
doc.rect(0, 0, PW, 240).fill("#0d0520");

doc.fontSize(42).font("Helvetica-Bold").fillColor(WHITE)
  .text("ModelClone", ML, 70, { align: "center", width: TW });
doc.fontSize(13).font("Helvetica").fillColor(PURPLE_L)
  .text("AI Identity Recreation & Generation Platform", ML, 122, { align: "center", width: TW });
doc.moveTo(PW/2 - 70, 148).lineTo(PW/2 + 70, 148)
  .lineWidth(1).strokeColor(PURPLE).stroke();
doc.fontSize(10.5).font("Helvetica-Bold").fillColor(TEXT)
  .text("Complete Technical Documentation", ML, 162, { align: "center", width: TW });

doc.rect(90, 200, PW - 180, 48).fill("#1a0a2e");
doc.fontSize(8.5).font("Helvetica").fillColor(MUTED)
  .text("Version 1.0  ·  March 2026  ·  Confidential — Internal Use Only", 90, 218, {
    align: "center", width: PW - 180,
  });

// TOC
doc.y = 280;
h1("Table of Contents");

const toc = [
  ["1", "Project Overview & Architecture"],
  ["2", "Technology Stack"],
  ["3", "Database Schema"],
  ["4", "Backend Architecture"],
  ["5", "API Endpoint Reference"],
  ["6", "Frontend Architecture"],
  ["7", "Credit & Payment System"],
  ["8", "Generation Pipelines"],
  ["9", "Authentication & Security"],
  ["10", "Referral & Affiliate System"],
  ["11", "Admin Panel"],
  ["12", "Environment Variables"],
  ["13", "Background Jobs & Monitoring"],
  ["14", "Error Handling & Reporting"],
];
toc.forEach(([n, title]) => {
  doc.fontSize(9).font("Helvetica").fillColor(TEXT)
    .text(`${n}.   ${title}`, 70, doc.y, { width: TW - 20, lineGap: 1 });
  doc.moveDown(0.32);
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1
// ─────────────────────────────────────────────────────────────────────────────
np();
h1("1. Project Overview & Architecture");
para("ModelClone (modelclone.app) is a B2C SaaS platform that lets users create synthetic AI personas from reference photos, train custom LoRA fine-tuning models on those personas, then generate professional-quality NSFW and SFW images and videos. The platform runs on a credit economy — users buy subscription plans or one-time credit packs via Stripe, consume credits per generation, and receive automatic refunds on failed jobs.");

h2("1.1 Core User Journey");
bullet([
  "Sign up → 25 free trial credits + guided onboarding",
  "Upload 3 reference photos or generate an AI model → SavedModel",
  "Purchase subscription (Starter/Pro/Business) or credit pack",
  "Train LoRA on fal.ai (75–150 credits) → model learns the persona",
  "Generate NSFW images/videos using trained LoRA on RunPod ComfyUI",
  "Generate SFW content using WaveSpeed or kie.ai pipelines",
  "Face-swap, talking-head, img2img, video repurpose, viral reel finder tools",
  "Earn 15% referral commission on referred users' first purchase",
]);

h2("1.2 High-Level Architecture");
codeBlock(
`┌──────────────────────────────────────────────────────────────────┐
│                    CLIENT  (React 18 SPA / Vite)                 │
│        Zustand · TanStack Query · TailwindCSS · Stripe.js        │
└─────────────────────────┬────────────────────────────────────────┘
                          │  HTTPS / REST JSON
┌─────────────────────────▼────────────────────────────────────────┐
│              BACKEND  (Node.js 22 / Express 4)                   │
│    JWT Auth · Prisma 6 · Rate Limiting · Telemetry Middleware    │
│                                                                  │
│  ┌───────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │  Stripe   │ │  RunPod  │ │  fal.ai  │ │  WaveSpeed/kie   │  │
│  │ Webhooks  │ │ ComfyUI  │ │  LoRA    │ │  Image / Video   │  │
│  └───────────┘ └──────────┘ └──────────┘ └──────────────────┘  │
│                                                                  │
│  ┌────────────┐ ┌──────────────┐ ┌───────────┐ ┌───────────┐   │
│  │ PostgreSQL │ │ Cloudflare R2│ │ SendGrid  │ │ElevenLabs │   │
│  │  (Prisma)  │ │  (Storage)   │ │  (Email)  │ │  (Voice)  │   │
│  └────────────┘ └──────────────┘ └───────────┘ └───────────┘   │
└──────────────────────────────────────────────────────────────────┘`
);

h2("1.3 Deployment");
bullet([
  { label: "Platform", text: "Replit (Node.js 22, auto-scaled)" },
  { label: "Database", text: "PostgreSQL (Neon serverless) via Prisma 6" },
  { label: "Dev DB", text: "SQLite (file:./dev.db)" },
  { label: "Static files", text: "Cloudflare R2 (S3-compatible via @aws-sdk/client-s3)" },
  { label: "Frontend", text: "Vite-bundled SPA served by Express from /dist" },
  { label: "GPU Workers", text: "RunPod serverless (ComfyUI Docker image) + fal.ai serverless" },
]);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2
// ─────────────────────────────────────────────────────────────────────────────
np();
h1("2. Technology Stack");

h2("2.1 Backend");
tbl(
  ["Layer", "Technology", "Purpose"],
  [
    ["Runtime", "Node.js 22 (ESM)", "Server, native ES modules"],
    ["Framework", "Express 4.x", "HTTP routing, middleware"],
    ["ORM", "Prisma 6", "Type-safe DB access + migrations"],
    ["Auth", "jsonwebtoken", "JWT access + refresh tokens"],
    ["2FA", "otplib + qrcode", "TOTP two-factor authentication"],
    ["Storage", "Cloudflare R2 (@aws-sdk)", "Persistent file/image storage"],
    ["Email", "SendGrid (@sendgrid/mail)", "Transactional + marketing emails"],
    ["Payments", "Stripe SDK", "Subscriptions, one-time, webhooks"],
    ["Crypto Pay", "NOWPayments", "Crypto invoice + IPN webhook"],
    ["Rate Limiting", "express-rate-limit", "Per-route abuse prevention"],
    ["Validation", "express-validator", "Request body schema validation"],
    ["File Upload", "multer (memory)", "Multipart form data (50 MB limit)"],
    ["Video Tools", "fluent-ffmpeg + exiftool", "Frame extraction + metadata writing"],
  ],
  [100, 160, 215]
);

h2("2.2 Frontend");
tbl(
  ["Layer", "Technology", "Purpose"],
  [
    ["Framework", "React 18", "UI rendering"],
    ["Build", "Vite", "HMR + production bundling"],
    ["Routing", "react-router-dom v7", "Client-side routing"],
    ["Global State", "Zustand", "Auth, user, UI state"],
    ["Server State", "TanStack React Query v5", "API cache + mutations"],
    ["UI Components", "Radix UI + shadcn/ui", "Accessible component primitives"],
    ["Styling", "Tailwind CSS v3", "Utility-first CSS"],
    ["Animations", "Framer Motion", "Page/component transitions"],
    ["Forms", "React Hook Form + Zod", "Form validation"],
    ["Payments UI", "@stripe/react-stripe-js", "Embedded Stripe Elements"],
    ["Charts", "Recharts", "Admin revenue graphs"],
    ["Social Auth", "Firebase JS SDK", "Google OAuth"],
    ["HTTP Client", "Axios", "API calls with interceptors"],
  ],
  [100, 160, 215]
);

h2("2.3 External AI Services");
tbl(
  ["Service", "Purpose"],
  [
    ["RunPod (serverless)", "NSFW image generation + img2img via self-hosted ComfyUI Docker"],
    ["fal.ai", "LoRA training (z-image-turbo-trainer-v2) + face swap workflow"],
    ["WaveSpeed", "SFW identity images, video motion transfer, NSFW video, face swap video"],
    ["kie.ai", "Alternative generation: Seedream images, Nano Banana, video"],
    ["xAI Grok 3 Mini", "Prompt engineering, image captioning, AI LoRA selector (vision)"],
    ["ElevenLabs", "TTS voice synthesis + talking-head lip-sync video"],
    ["Apify", "Instagram viral reel scraper (Instagram scraper actor)"],
    ["Replicate", "Admin test page only (Flux NSFW, SDXL, Seedream)"],
  ],
  [165, 310]
);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3
// ─────────────────────────────────────────────────────────────────────────────
np();
h1("3. Database Schema");
para("PostgreSQL (production) / SQLite (dev), managed by Prisma 6. All primary keys are UUIDs. All models have createdAt / updatedAt timestamps.");

h2("3.1 User  (central entity)");
tbl(
  ["Field", "Type", "Notes"],
  [
    ["id", "UUID PK", "Primary key"],
    ["email", "String UNIQUE", "Login identifier"],
    ["password", "String?", "bcrypt hash — null for Google users"],
    ["role", "String", '"user" | "admin"'],
    ["authProvider", "String", '"email" | "google"'],
    ["isVerified", "Boolean", "Email verification flag"],
    ["subscriptionTier", "String?", '"starter" | "pro" | "business"'],
    ["subscriptionStatus", "String", '"trial" | "active" | "cancelled"'],
    ["stripeCustomerId", "String?", "Stripe customer ID"],
    ["stripeSubscriptionId", "String?", "Stripe subscription ID"],
    ["subscriptionCredits", "Int", "Expires at creditsExpireAt"],
    ["purchasedCredits", "Int", "Never expire"],
    ["credits", "Int", "Legacy / admin-granted"],
    ["creditsExpireAt", "DateTime?", "When subscriptionCredits reset to 0"],
    ["totalCreditsUsed", "Int", "Lifetime generation deduction counter"],
    ["twoFactorEnabled", "Boolean", "TOTP 2FA enabled flag"],
    ["twoFactorSecret", "String?", "Encrypted TOTP secret"],
    ["referralCode", "String? UNIQUE", "User's own referral code"],
    ["referredByUserId", "UUID? FK", "Who referred this user — permanent link"],
    ["specialOfferEligible", "Boolean", "$6 onboarding upsell eligibility"],
    ["allowCustomLoraTrainingPhotos", "Boolean", "Admin-gated feature flag"],
    ["premiumFeaturesUnlocked", "Boolean", "Admin-gated premium feature flag"],
    ["maxModels", "Int", "Max allowed models (default 999)"],
  ],
  [155, 100, 220]
);

h2("3.2 CreditTransaction  (immutable audit log)");
tbl(
  ["Field", "Notes"],
  [
    ["userId", "FK to User"],
    ["amount", "Positive = credit, negative = debit"],
    ["type", '"purchase" | "subscription" | "generation" | "refund"'],
    ["description", "Human-readable reason"],
    ["paymentSessionId UNIQUE", "Stripe session/PI/invoice ID — prevents duplicate credit awards via UNIQUE constraint"],
    ["emailSentAt", "Timestamp of purchase confirmation email"],
  ],
  [165, 310]
);

h2("3.3 Generation  (each AI job)");
tbl(
  ["Field", "Notes"],
  [
    ["userId / modelId", "Links to User and SavedModel"],
    ["type", '"nsfw" | "face-swap" | "talking-head" | "advanced-image" | "video-prompt" | ...'],
    ["status", '"pending" | "processing" | "completed" | "failed"'],
    ["creditsCost", "Credits consumed (used for refund)"],
    ["creditsRefunded", "Boolean — prevents double-refund"],
    ["replicateModel", "Repurposed: stores WaveSpeed/RunPod request IDs"],
    ["outputUrl", "R2 URL of generated output"],
    ["errorMessage", "Provider failure detail — shown to user"],
    ["isNsfw / isTrial", "Content classification flags"],
  ],
  [165, 310]
);

h2("3.4 SavedModel  (AI persona)");
tbl(
  ["Field", "Notes"],
  [
    ["photo1/2/3Url", "Reference photos on R2"],
    ["activeLoraId", "FK to TrainedLora — currently selected LoRA"],
    ["nsfwUnlocked", "Earned when first LoRA training completes"],
    ["nsfwOverride", "Admin bypass — enables NSFW without training"],
    ["faceReferenceUrl", "Cropped face for fal.ai face-swap step"],
    ["savedAppearance", "JSON — persisted chip selections"],
  ],
  [165, 310]
);

h2("3.5 TrainedLora  (LoRA model per persona)");
tbl(
  ["Field", "Notes"],
  [
    ["status", '"awaiting_images" | "images_ready" | "training" | "ready" | "failed"'],
    ["trainingMode", '"standard" (75 credits, 1000 steps) | "pro" (150 credits, 2000 steps)'],
    ["loraUrl", "R2 URL of the trained .safetensors file"],
    ["triggerWord", "LoRA activation keyword inserted into every prompt"],
    ["falRequestId", "fal.ai training job ID for status polling"],
    ["defaultAppearance", "JSON — auto-detected chip defaults from training images"],
  ],
  [165, 310]
);

h2("3.6 ReferralCommission");
tbl(
  ["Field", "Notes"],
  [
    ["referrerUserId", "Who earns the commission"],
    ["referredUserId", "Who made the purchase"],
    ["purchaseAmountCents", "Full purchase amount in cents"],
    ["commissionCents", "Exactly 15% of purchaseAmountCents"],
    ["sourceType / sourceId", "Stripe event type + ID for idempotency"],
    ["@@unique([sourceType, sourceId, referredUserId])", "DB-level duplicate prevention"],
  ],
  [220, 255]
);

h2("3.7 Other Models");
tbl(
  ["Model", "Purpose"],
  [
    ["LoraTrainingImage", "Individual training images for a LoRA (up to 15 per LoRA)"],
    ["CryptoPayment", "NOWPayments crypto transaction tracking"],
    ["RepurposeJob / RepurposeOutput", "FFmpeg video repurposer jobs + output files"],
    ["ReelFinderProfile / Reel / ScrapeLog", "Instagram viral reel discovery data"],
    ["SignupFingerprint", "Device fingerprinting — prevents free credit abuse"],
    ["ReferralPayoutRequest", "User-requested Solana payouts of referral earnings"],
    ["AdminAuditLog", "Admin action audit trail for compliance"],
    ["ApiRequestMetric", "HTTP traffic telemetry (sampled per request)"],
    ["TelemetryEdgeEvent", "Error / slow-request / rate-limit event log"],
    ["SystemHealthMetric", "Periodic Node.js process health snapshots"],
    ["ApiEndpointHealthSnapshot", "Periodic endpoint liveness check results"],
    ["AppBranding", "Singleton white-label config (appName, logo, favicon, baseUrl)"],
    ["AffiliatePartner / AffiliateConversion", "External affiliate program (separate from user referral)"],
    ["DraftTask", "Persisted in-progress generation form state per user+feature"],
  ],
  [195, 280]
);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4
// ─────────────────────────────────────────────────────────────────────────────
np();
h1("4. Backend Architecture");

h2("4.1 Entry Point — src/server.js");
bullet([
  "Validates required secrets at startup (warns/errors if missing)",
  "Configures CORS for localhost, *.replit.dev, *.replit.app, modelclone.app",
  "Mounts Stripe and NOWPayments webhooks BEFORE express.json() — preserves raw body for signature verification",
  "Applies apiLimiter globally to all /api routes",
  "Attaches telemetry middleware for request sampling",
  "Mounts all route groups under /api",
  "Runs startup cleanup: stuck generations, NSFW recovery, LoRA migration",
  "Starts background jobs: generation poller, stuck-model/LoRA healers, health snapshots",
]);

h2("4.2 Route Files");
tbl(
  ["File", "Mount Path", "Purpose"],
  [
    ["api.routes.js", "/api", "Main router — auth, models, generation, NSFW, admin, plans"],
    ["stripe.routes.js", "/api/stripe", "Checkout sessions, subscriptions, portal, confirmations"],
    ["stripe.webhook.js", "/api/stripe/webhook", "Stripe webhook — raw body, HMAC-verified"],
    ["crypto.webhook.js", "/api/crypto/webhook", "NOWPayments IPN — HMAC-SHA512 verified"],
    ["nowpayments.routes.js", "/api/crypto", "NOWPayments invoice creation"],
    ["admin.routes.js", "/api/admin", "Extended admin: branding, backups, NSFW override, telemetry"],
    ["referral.routes.js", "/api/referrals", "Referral code management + payout requests"],
    ["draft.routes.js", "/api/drafts", "Save/load generation draft state per feature"],
    ["img2img.routes.js", "/api/img2img", "Image-to-image pipeline (describe + generate + poll)"],
    ["video-repurpose.routes.js", "/api/video-repurpose", "FFmpeg video repurposer"],
    ["viral-reels.routes.js", "/api/viral-reels", "Instagram reel scraper + finder"],
  ],
  [135, 115, 225]
);

h2("4.3 Key Services");
tbl(
  ["Service", "Purpose"],
  [
    ["credit.service.js", "3-pool credit deduction, expiry check, atomic refunds, floor protection"],
    ["fal.service.js", "fal.ai LoRA training, RunPod NSFW generation, AI LoRA chip selector"],
    ["img2img.service.js", "RunPod ComfyUI img2img + JoyCaption analysis + Grok injection"],
    ["wavespeed.service.js", "WaveSpeed: identity images, video motion, face swap, NSFW video"],
    ["kie.service.js", "kie.ai: Seedream, Nano Banana generation with dynamic polling"],
    ["generation-poller.service.js", "Background poller for all WaveSpeed async jobs"],
    ["referral.service.js", "Referral code management, commission recording (15% first-purchase)"],
    ["email.service.js", "SendGrid: all transactional emails + admin frontend error alerts"],
    ["elevenlabs.service.js", "ElevenLabs voice list + preview generation"],
    ["telemetry.service.js", "System health snapshots + endpoint health checks"],
    ["fingerprint.service.js", "Device fingerprinting — free credit abuse prevention"],
  ],
  [160, 315]
);

h2("4.4 Dynamic Polling — dynamicPoll.js");
para("Prevents premature job timeouts by pausing the clock while a job is queued and only counting time once it is actually running:");
codeBlock(
`dynamicPoll({
  pollFn: async () => {
    const s = await checkJobStatus();
    if (s === 'IN_QUEUE')    return { phase: 'queued' };  // clock paused
    if (s === 'IN_PROGRESS') return { phase: 'running' }; // clock running
    if (s === 'COMPLETED')   return { phase: 'done', result };
    if (s === 'FAILED')      return { phase: 'done', error: '...' };
  },
  runningTimeoutMs: 10 * 60 * 1000,  // only counts while running
  queuedIntervalMs: 8_000,           // slow poll while queued
  runningIntervalMs: 3_000,          // fast poll while running
})
// Used by: RunPod NSFW (fal.service.js), RunPod img2img, kie.ai jobs`
);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5
// ─────────────────────────────────────────────────────────────────────────────
np();
h1("5. API Endpoint Reference");

h2("5.1 Auth  /api/auth/...");
tbl(
  ["Method", "Path", "Purpose", "Auth"],
  [
    ["POST", "/auth/signup", "Email/password signup → sends OTP", "No"],
    ["POST", "/auth/login", "Login → JWT cookie", "No"],
    ["POST", "/auth/google", "Google ID token login/signup", "No"],
    ["POST", "/auth/firebase-signup", "Firebase Google signup", "No"],
    ["POST", "/auth/verify-email", "Verify OTP → award 25 credits", "No"],
    ["POST", "/auth/resend-code", "Resend verification OTP", "No"],
    ["POST", "/auth/refresh", "Refresh JWT from refresh token", "No"],
    ["POST", "/auth/logout", "Clear auth cookie", "No"],
    ["GET", "/auth/profile", "Current user + credit totals", "Yes"],
    ["PUT", "/auth/profile", "Update name/email", "Yes"],
    ["POST", "/auth/change-password", "Change password", "Yes"],
    ["POST", "/auth/request-password-reset", "Password reset OTP", "No"],
    ["POST", "/auth/reset-password", "Reset with OTP", "No"],
    ["POST", "/auth/2fa/generate", "Generate TOTP secret + QR code", "Yes"],
    ["POST", "/auth/2fa/verify", "Enable 2FA", "Yes"],
    ["POST", "/auth/2fa/disable", "Disable 2FA", "Yes"],
  ],
  [42, 155, 168, 38]
);

h2("5.2 Generation  /api/generate/...");
tbl(
  ["Method", "Path", "Credits", "Purpose"],
  [
    ["POST", "/generate/image-identity", "3", "SFW identity image (WaveSpeed)"],
    ["POST", "/generate/video-motion", "20", "Video motion transfer (WaveSpeed)"],
    ["POST", "/generate/complete-recreation", "23+", "Image + video combined"],
    ["POST", "/generate/video-prompt", "20–25", "Kling V2.5 image-to-video"],
    ["POST", "/generate/face-swap", "5/sec", "Face swap in video"],
    ["POST", "/generate/image-faceswap", "3", "Face swap in image"],
    ["POST", "/generate/talking-head", "~15", "ElevenLabs TTS + lip-sync"],
    ["POST", "/generate/advanced", "1–2", "Seedream or Nano Banana image"],
    ["POST", "/generate/prompt-image", "3/img", "Prompt-based image"],
    ["GET", "/generations/:id", "0", "Poll generation status"],
    ["GET", "/generations", "0", "Paginated generation history"],
    ["POST", "/generations/batch-delete", "0", "Delete generations (blocks if active)"],
  ],
  [42, 160, 48, 198]
);

h2("5.3 NSFW  /api/nsfw/...");
tbl(
  ["Method", "Path", "Purpose"],
  [
    ["POST", "/nsfw/lora/create", "Create new LoRA training session"],
    ["GET", "/nsfw/loras/:modelId", "List all LoRAs for a model"],
    ["POST", "/nsfw/lora/set-active", "Set active LoRA"],
    ["DELETE", "/nsfw/lora/:loraId", "Delete LoRA + R2 files"],
    ["PUT", "/nsfw/lora/:loraId/appearance", "Update LoRA default appearance chips"],
    ["POST", "/nsfw/lora/:loraId/auto-appearance", "AI-detect appearance from training images (Grok Vision)"],
    ["POST", "/nsfw/generate-training-images", "Generate 15 training images via WaveSpeed"],
    ["POST", "/nsfw/upload-training-images", "Upload custom training photos (admin-gated)"],
    ["POST", "/nsfw/train-lora", "Start LoRA training on fal.ai (75 or 150 credits)"],
    ["GET", "/nsfw/training-status/:modelId", "Poll LoRA training status"],
    ["POST", "/nsfw/generate", "Generate NSFW image (RunPod ComfyUI + AI LoRA selector)"],
    ["POST", "/nsfw/generate-advanced", "Advanced NSFW with full chip control"],
    ["POST", "/nsfw/generate-video", "NSFW video from image (WaveSpeed)"],
    ["POST", "/nsfw/extend-video", "Extend/loop NSFW video"],
  ],
  [42, 200, 233]
);

np();
h2("5.4 img2img  /api/img2img/...");
tbl(
  ["Method", "Path", "Credits", "Purpose"],
  [
    ["POST", "/img2img/describe", "1", "JoyCaption (RunPod) + Grok → editable prompt from photo"],
    ["POST", "/img2img/generate", "10", "Full pipeline: analyze → inject → generate → R2"],
    ["GET", "/img2img/job/:jobId", "0", "Poll img2img job status"],
  ],
  [42, 160, 48, 228]
);

h2("5.5 Stripe  /api/stripe/...");
tbl(
  ["Method", "Path", "Purpose"],
  [
    ["POST", "/stripe/create-checkout-session", "Hosted Stripe checkout (subscription)"],
    ["POST", "/stripe/create-onetime-checkout", "Hosted Stripe checkout (one-time credits)"],
    ["POST", "/stripe/create-payment-intent", "Embedded payment intent (one-time)"],
    ["POST", "/stripe/create-embedded-subscription", "Embedded subscription"],
    ["POST", "/stripe/confirm-payment", "Confirm embedded one-time + award credits"],
    ["POST", "/stripe/confirm-subscription", "Confirm embedded subscription + award credits"],
    ["POST", "/stripe/create-special-offer-intent", "$6 special offer payment intent"],
    ["POST", "/stripe/confirm-special-offer", "Confirm $6 offer + create AI model + 25 credits"],
    ["POST", "/stripe/verify-session", "Verify hosted checkout + award credits"],
    ["GET", "/stripe/subscription-status", "Get subscription from Stripe"],
    ["POST", "/stripe/cancel-subscription", "Cancel at period end"],
    ["POST", "/stripe/create-portal-session", "Stripe billing portal"],
  ],
  [42, 200, 235]
);

h2("5.6 Admin  /api/admin/...  (role=admin required)");
tbl(
  ["Method", "Path", "Purpose"],
  [
    ["GET", "/admin/stats", "Users, models, generations, credits totals"],
    ["GET", "/admin/stripe-revenue", "Stripe revenue by period"],
    ["GET", "/admin/users", "Paginated user list"],
    ["POST", "/admin/credits/add", "Manually add credits to user"],
    ["POST", "/admin/users/settings", "Update role, subscription, feature flags"],
    ["GET", "/admin/telemetry/overview", "Traffic + infra telemetry summary"],
    ["PUT", "/admin/branding", "Update white-label config"],
    ["POST", "/admin/backup/create", "Create database backup"],
    ["POST", "/admin/models/:modelId/nsfw-override", "Toggle NSFW override"],
    ["POST", "/admin/send-marketing-email", "HTML campaign to all verified users"],
    ["GET", "/admin/telemetry/endpoint-health", "Endpoint health snapshot"],
  ],
  [42, 195, 240]
);

h2("5.7 Other Endpoints");
tbl(
  ["Method", "Path", "Purpose"],
  [
    ["GET", "/api/health", "Server health + queue stats (public)"],
    ["POST", "/api/errors/report", "Frontend crash report → admin email (rate limited: 5/15min)"],
    ["GET", "/api/plans", "Pricing plan definitions (public)"],
    ["POST", "/api/upload", "Upload file to R2"],
    ["GET", "/api/download", "CORS-safe R2/Cloudinary download proxy"],
    ["GET", "/api/referrals/me/overview", "Own referral dashboard"],
    ["POST", "/api/referrals/me/code", "Create/update own referral code"],
    ["POST", "/api/referrals/me/request-payout", "Request Solana payout"],
  ],
  [42, 195, 240]
);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6
// ─────────────────────────────────────────────────────────────────────────────
np();
h1("6. Frontend Architecture");

h2("6.1 Pages");
tbl(
  ["Page", "Route", "Purpose"],
  [
    ["LandingPage", "/", "Marketing — pricing, features, captures ?ref= referral param"],
    ["LoginPage", "/login", "Login form — also captures ?ref= param"],
    ["SignupPage", "/signup", "Registration — passes pendingReferralCode to API"],
    ["VerifyEmailPage", "/verify", "6-digit OTP verification"],
    ["OnboardingPage", "/onboarding", "Trial generation + $6 special offer upsell"],
    ["DashboardPage", "/dashboard", "Main dashboard — recent generations"],
    ["GeneratePage", "/generate", "SFW studio: video, face-swap, talking-head"],
    ["NSFWPage", "/nsfw", "NSFW studio: LoRA management + full generation UI"],
    ["ModelsPage", "/models", "Create/manage AI models"],
    ["HistoryPage", "/history", "Generation history with filters"],
    ["SettingsPage", "/settings", "Account, subscription, 2FA, billing"],
    ["ReferralProgramPage", "/referral", "Referral earnings, code, payout requests"],
    ["ReferralCapturePage", "/r/:code", "Captures code → localStorage → redirects to /signup"],
    ["AdminPage", "/admin", "Admin dashboard — users, stats, branding, telemetry"],
    ["VideoRepurposerPage", "/video-repurpose", "FFmpeg video repurposer"],
    ["ViralReelFinderPage", "/viral-reels", "Instagram viral reel discovery"],
  ],
  [130, 100, 245]
);

h2("6.2 Key Components");
tbl(
  ["Component", "Purpose"],
  [
    ["AppSidebar.jsx", "Nav sidebar with real-time credit display"],
    ["CheckoutModal.jsx", "Stripe embedded checkout — subs + one-time"],
    ["ErrorBoundary.jsx", "Prod: clean error screen + auto admin email. Dev: full stack trace."],
    ["ErrorDisplay.jsx", "Dev-only error popup — returns null in production"],
    ["useActiveGeneration.js", "Real-time generation polling — toast.error on failure"],
    ["usePageVisibility.js", "Pauses polling when tab is hidden (battery/CPU friendly)"],
  ],
  [160, 315]
);

h2("6.3 Referral Code Capture — All Entry Points");
codeBlock(
`LandingPage.jsx  → captures ?ref= → localStorage("pendingReferralCode")
LoginPage.jsx    → captures ?ref= → localStorage("pendingReferralCode")
SignupPage.jsx   → captures ?ref= → localStorage("pendingReferralCode")
ReferralCapturePage → /r/:code → localStorage → redirect to /signup

On signup (email, Google, Firebase):
  getPendingReferralCode() reads localStorage
  → passed as referralCode to POST /auth/signup (or /auth/google, etc.)
  → backend: attachReferrerToUser(userId, referralCode)
  → sets user.referredByUserId permanently
  → localStorage cleared on confirmed new user registration`
);

h2("6.4 Google Translate Protection");
bullet([
  { label: "HTML tag", text: 'translate="no" on <html> — suppresses automatic translate offer' },
  { label: "Meta tag", text: '<meta name="google" content="notranslate"> — signals Chrome/crawlers' },
  { label: "JS guard", text: "Patches Node.prototype.insertBefore — catches TypeError when translate moves React's reference nodes, gracefully appends instead of crashing the app" },
]);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7
// ─────────────────────────────────────────────────────────────────────────────
np();
h1("7. Credit & Payment System");

h2("7.1 Three Credit Pools");
tbl(
  ["Pool", "DB Field", "Expires?", "Source"],
  [
    ["Purchased", "purchasedCredits", "Never", "One-time packs, refunds, special offer bonus"],
    ["Legacy/Admin", "credits", "Never", "Admin grants, legacy field"],
    ["Subscription", "subscriptionCredits", "Yes (creditsExpireAt)", "Subscription purchase/renewal"],
  ],
  [70, 110, 65, 230]
);
para("Deduction order: purchasedCredits → credits → subscriptionCredits. Ensures paid-for credits are spent before subscription credits expire.");

h2("7.2 Credit Costs");
tbl(
  ["Action", "Cost"],
  [
    ["Email verification (new user)", "+25 free credits (gift to subscriptionCredits)"],
    ["LoRA training — standard (1000 steps)", "75 credits"],
    ["LoRA training — pro (2000 steps)", "150 credits"],
    ["img2img analyze (/describe)", "1 credit"],
    ["img2img full pipeline (/generate)", "10 credits"],
    ["SFW identity image", "3 credits"],
    ["Video motion transfer", "20 credits"],
    ["Face swap video", "5 credits/second"],
    ["Image face swap", "3 credits"],
    ["Talking-head video", "~15 credits"],
    ["Video from prompt (5s / 10s)", "20 / 25 credits"],
    ["Advanced image — Seedream", "1 credit"],
    ["Advanced image — Nano Banana", "2 credits"],
    ["Prompt-based image", "3 credits/image"],
  ],
  [235, 240]
);

h2("7.3 Subscription Plans");
tbl(
  ["Tier", "Monthly", "Annual (17% off)", "Credits/Month"],
  [
    ["Starter", "$29/mo", "$290/yr", "290 credits"],
    ["Pro", "$79/mo", "$790/yr", "890 credits"],
    ["Business", "$199/mo", "$1,990/yr", "2,490 credits"],
  ],
  [90, 80, 120, 185]
);

h2("7.4 Payment Idempotency");
codeBlock(
`// All credit awards use this atomic pattern:
await prisma.$transaction(async (tx) => {
  await tx.creditTransaction.create({
    data: { userId, amount, paymentSessionId: session.id }
    // ^^^ UNIQUE constraint — throws P2002 if duplicate
  });
  await tx.user.update({ ... increment credits ... });
});
// P2002 caught → "already processed" → silently skip
// Handles: duplicate Stripe webhooks, double browser submissions`
);

h2("7.5 Stripe Webhook Events");
tbl(
  ["Event", "Action"],
  [
    ["checkout.session.completed (one-time)", "Award purchasedCredits, record referral commission, send email"],
    ["checkout.session.completed (subscription)", "Award subscriptionCredits, set tier/expiry, cancel old sub on upgrade, commission"],
    ["payment_intent.succeeded", "Safety net: embedded payments + special offer fulfillment"],
    ["invoice.payment_succeeded", "Safety net: subscription first payment + renewal top-up"],
    ["customer.subscription.deleted", "Wipe subscriptionCredits + subscription status"],
    ["customer.subscription.updated (inactive)", "Wipe if status is canceled/unpaid/paused"],
    ["charge.refunded", "Proportional credit deduction + referral commission clawback"],
  ],
  [190, 285]
);

h2("7.6 Refund Logic");
bullet([
  { label: "Generation failure", text: "refundGeneration(id) — adds creditsCost to purchasedCredits, sets creditsRefunded=true (prevents double-refund)" },
  { label: "Stuck LoRA training", text: "Background healer refunds 75 or 150 credits after 2-hour timeout" },
  { label: "Stripe charge.refunded", text: "Webhook deducts proportional credits from the correct pool, floors at 0" },
  { label: "Referral clawback", text: "On Stripe refund: proportional commissionCents decremented on ReferralCommission" },
]);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8
// ─────────────────────────────────────────────────────────────────────────────
np();
h1("8. Generation Pipelines");

h2("8.1 SFW Image/Video — WaveSpeed");
codeBlock(
`1. User submits → credits deducted atomically
2. Generation record created (status: "processing")
3. WaveSpeed API → returns requestId
4. requestId stored in generation.replicateModel
5. Immediate response to client with generationId
6. Background poller polls all pending WaveSpeed jobs
7. Completion → output archived to R2, status → "completed"
8. Failure → refundGeneration(), status → "failed", errorMessage set
9. Client polls GET /api/generations/:id until status !== "processing"`
);

h2("8.2 NSFW LoRA Training — fal.ai");
codeBlock(
`POST /nsfw/lora/create
  → TrainedLora(status:"awaiting_images")

Prepare 15 training images:
  - Generate via WaveSpeed identity pipeline  OR
  - Assign from user's gallery  OR
  - Upload custom (admin-gated)

POST /nsfw/train-lora (75 or 150 credits)
  1. Caption 15 images with Grok 3 Mini vision (parallel batches of 5)
  2. Zip images + .txt captions → upload to R2
  3. Submit ZIP URL to fal.ai (z-image-turbo-trainer-v2)
  4. Background healer polls fal.ai every 15 min
  5. Completion:
     - .safetensors file archived to R2
     - faceReferenceUrl generated via fal.ai face crop
     - Training images deleted from R2 (storage cleanup)
     - TrainedLora.status = "ready", nsfwUnlocked = true`
);

h2("8.3 NSFW Image Generation — RunPod ComfyUI");
codeBlock(
`POST /nsfw/generate or /nsfw/generate-advanced
  ↓
AI LoRA Selector (Grok 3 Mini — determines for this generation):
  · Girl LoRA strength: 0.55–0.80 (based on face visibility)
  · Pose LoRA: 1 of 6 options (doggystyle, missionary, cowgirl, etc.)
  · Enhancement LoRAs: amateur nudes, deepthroat, masturbation, dildo
  · Special effects: running makeup, cum effect
  ↓
Build ComfyUI workflow JSON dynamically:
  · Base: zImageTurboNSFW_62BF16.safetensors
  · CLIP: qwen_3_4b.safetensors  ·  VAE: ae.safetensors
  · LoRAs chained via LoraLoaderFromURL nodes
  ↓
Submit to RunPod serverless → pollNsfwJob() via dynamicPoll
  · Queued: 8s poll interval, timeout paused
  · Running: 5s poll interval, 20-min timeout
  ↓
Decode base64 → upload to R2
  ↓
Optional: fal.ai face-swap (replaces AI face with trained persona's face)`
);

h2("8.4 img2img Pipeline — RunPod ComfyUI + Grok");
codeBlock(
`Input validation (double-guarded):
  Route: reject if no base64 AND inputImageUrl not https://...
  Service: same guard in extractPromptFromImage()

Step 1 — JoyCaption Analysis (RunPod ComfyUI):
  · Workflow: LayerUtility:JoyCaptionBeta1 → easy saveText (node 53)
  · Input: base64 image (provided directly or fetched from URL)
  · Output: scene description text

Step 2 — Grok Injection:
  · Input: rawDescription + triggerWord + lookDescription
  · Grok 3 Mini rewrites: keeps scene/pose, replaces original
    woman's appearance with LoRA model's full physical profile
  · Output: ComfyUI-ready prompt starting with trigger word

Step 3 — img2img Generation (RunPod ComfyUI):
  · Workflow with LoRA URL, strength, denoise, seed
  · Same RunPod endpoint (RUNPOD_ENDPOINT_ID)
  · Output image → uploaded to R2

Critical fix: RUNPOD_BASE = https://api.runpod.ai/v2/\${RUNPOD_ENDPOINT_ID}
  (was missing, caused ReferenceError in production)`
);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9
// ─────────────────────────────────────────────────────────────────────────────
np();
h1("9. Authentication & Security");

h2("9.1 Auth Flow");
codeBlock(
`Email signup:
  POST /auth/signup → bcrypt hash → create User → send 6-digit OTP
  POST /auth/verify-email → isVerified=true → +25 credits → issue JWT pair

Google signup:
  POST /auth/google → verify Google ID token → create/find User → JWT

Firebase signup:
  POST /auth/firebase-signup → verify with Firebase Admin SDK → send OTP
  POST /auth/verify-firebase-email → isVerified=true → +25 credits → JWT

Token pair:
  Access: JWT, 30-day expiry, HTTP-only cookie (secure+sameSite in prod)
  Refresh: longer-lived JWT, also HTTP-only cookie
  POST /auth/refresh → new access token from valid refresh`
);

h2("9.2 Rate Limiting");
tbl(
  ["Limiter", "Limit", "Window", "Applied To"],
  [
    ["apiLimiter (global)", "2000 req", "15 min", "All /api routes"],
    ["authLimiter", "20 req", "15 min", "/auth/login, /auth/verify-*"],
    ["signupLimiter", "10 req", "1 hour", "/auth/signup"],
    ["passwordResetLimiter", "5 req", "15 min", "/auth/request-password-reset"],
    ["generationLimiter", "30 req", "1 min", "All generation endpoints"],
    ["errorReportLimiter", "5 req", "15 min", "/api/errors/report"],
  ],
  [120, 65, 60, 230]
);

h2("9.3 Security Features");
bullet([
  { label: "Webhook HMAC", text: "Stripe: stripe.webhooks.constructEvent() verifies signature. NOWPayments: HMAC-SHA512 IPN signature." },
  { label: "Credit floors", text: "subscriptionCredits and purchasedCredits can never go negative — Math.max(0, ...) guards everywhere" },
  { label: "Credit idempotency", text: "UNIQUE paymentSessionId on CreditTransaction prevents double-credit on duplicate webhooks" },
  { label: "Admin audit log", text: "AdminAuditLog records every admin action: adminEmail, action, targetType, targetId, detailsJson" },
  { label: "Device fingerprinting", text: "SignupFingerprint prevents multiple free trial credit claims from same IP/device" },
  { label: "Stack trace hiding", text: "ErrorBoundary shows zero technical details in production — auto-reports to admin via email" },
  { label: "Body limits", text: "express.json({ limit: '10mb' }) — supports base64 image payloads safely" },
  { label: "TOTP 2FA", text: "otplib TOTP — user scans QR code, required on login if enabled" },
]);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10
// ─────────────────────────────────────────────────────────────────────────────
np();
h1("10. Referral & Affiliate System");

h2("10.1 Full Referral Flow");
codeBlock(
`1. Referrer creates code: POST /api/referrals/me/code
   · 4–30 chars, alphanumeric + hyphens/underscores
   · Globally unique (UNIQUE constraint on User.referralCode)
   · Reserved words blocked: admin, api, login, signup, etc.

2. Referrer shares link:
   https://modelclone.app/r/theircode   (via /r/:code route)
   OR: https://modelclone.app/?ref=theircode   (via LandingPage)
   OR: https://modelclone.app/signup?ref=theircode

3. New user visits any entry point:
   LandingPage / LoginPage / SignupPage / ReferralCapturePage
   → All capture ?ref= or :code → localStorage.pendingReferralCode

4. User signs up:
   referralCode sent to POST /auth/signup (or google, firebase)
   → attachReferrerToUser(userId, referralCode)
   → user.referredByUserId = referrer.id  (permanent, idempotent)

5. User makes first purchase:
   Stripe webhook fires → recordReferralCommissionFromPayment()
   → 15% commission created in ReferralCommission table
   → Commission is FIRST PURCHASE ONLY (enforced by DB row check)

6. Referrer requests payout:
   Minimum $100.00 accumulated → POST /api/referrals/me/request-payout
   → Admin reviews + marks paid → Solana wallet transfer`
);

h2("10.2 Commission Logic Details");
tbl(
  ["Guard", "Implementation"],
  [
    ["Amount > 0", "Skips if purchaseAmountCents ≤ 0 (subscription checkout null — deferred to invoice event)"],
    ["Has referrer", "referredUser.referredByUserId must be set"],
    ["No self-referral", "referredByUserId !== referredUser.id"],
    ["First purchase only", "findFirst({ where: { referredUserId } }) — blocks if any commission exists"],
    ["Rate: 15%", "COMMISSION_BPS = 1500 → Math.floor(amount × 1500 / 10000)"],
    ["DB idempotency", "@@unique([sourceType, sourceId, referredUserId]) → P2002 caught silently"],
  ],
  [155, 320]
);

h2("10.3 Webhook Coverage (all payment paths)");
tbl(
  ["Stripe Event", "Amount Used"],
  [
    ["checkout.session.completed (one-time)", "session.amount_total"],
    ["checkout.session.completed (subscription)", "latest_invoice.amount_paid (resolved if amount_total null)"],
    ["payment_intent.succeeded (embedded, special offer)", "paymentIntent.amount_received || amount"],
    ["invoice.payment_succeeded", "invoice.amount_paid (also blocks via firstPurchaseOnly on renewals)"],
  ],
  [235, 240]
);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11
// ─────────────────────────────────────────────────────────────────────────────
np();
h1("11. Admin Panel");
para("Route: /admin — requires role='admin'. All /api/admin routes protected by authMiddleware + adminMiddleware.");

h2("11.1 Sections");
bullet([
  { label: "User Management", text: "Paginated user table with email search. Per-user: 3 credit pools, subscription info, Stripe IDs. Actions: add credits, edit settings, delete user." },
  { label: "Platform Stats", text: "Total users/models/generations/credits. New signups + generations per selected period." },
  { label: "Stripe Revenue", text: "Total revenue, MRR, ARR, plan breakdown — filter by day/week/month/year. Synced with date picker." },
  { label: "Telemetry", text: "API request metrics (avg latency, error rate), edge events (slow req, rate limits), endpoint health snapshots, system health (memory, uptime)." },
  { label: "Branding", text: "Update appName, logoUrl, faviconUrl, baseUrl for white-label deployment." },
  { label: "Email Campaigns", text: "Send custom HTML marketing email to all verified users. 50%-off promo campaign." },
  { label: "Backups", text: "Create DB backup, view history, restore credits from backup." },
  { label: "NSFW Override", text: "View user's models, toggle nsfwOverride on any model." },
  { label: "LoRA Assignment", text: "Assign an external LoRA URL to a user's model by email + model name." },
  { label: "Referral Admin", text: "View all referral commissions, payout requests. Mark payouts as paid." },
]);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12
// ─────────────────────────────────────────────────────────────────────────────
np();
h1("12. Environment Variables");

h2("12.1 Required — Production will fail without these");
tbl(
  ["Variable", "Purpose"],
  [
    ["DATABASE_URL", "Prisma DB (PostgreSQL URI in prod, file:./dev.db in dev)"],
    ["JWT_SECRET", "Signs all JWT tokens — must be long, random, secret"],
    ["STRIPE_SECRET_KEY", "Stripe live secret key (sk_live_...)"],
    ["STRIPE_WEBHOOK_SECRET", "Stripe webhook signing secret — required in production"],
    ["SENDGRID_API_KEY", "SendGrid API key for all transactional emails"],
    ["SENDGRID_FROM_EMAIL", "From address (e.g. support@modelclone.app)"],
    ["ADMIN_EMAIL", "Receives frontend error alerts + payout notifications"],
    ["RUNPOD_API_KEY", "RunPod API key for ComfyUI NSFW + img2img"],
    ["RUNPOD_ENDPOINT_ID", "RunPod serverless endpoint ID (default: 0uskdglppin5ey)"],
    ["FAL_API_KEY", "fal.ai API key for LoRA training + face swap"],
    ["WAVESPEED_API_KEY", "WaveSpeed API key for SFW generation"],
    ["XAI_API_KEY", "xAI Grok API key for prompt engineering + LoRA selector"],
    ["R2_ACCOUNT_ID", "Cloudflare R2 account ID"],
    ["R2_ACCESS_KEY_ID", "R2 access key"],
    ["R2_SECRET_ACCESS_KEY", "R2 secret key"],
    ["R2_BUCKET_NAME", "R2 bucket name"],
    ["R2_PUBLIC_URL", "Public R2 base URL (https://pub-xxx.r2.dev)"],
  ],
  [195, 280]
);

h2("12.2 Optional / Feature-Specific");
tbl(
  ["Variable", "Default", "Purpose"],
  [
    ["KIE_API_KEY", "—", "kie.ai: Seedream + Nano Banana"],
    ["ELEVENLABS_API_KEY", "—", "ElevenLabs voice synthesis"],
    ["APIFY_API_TOKEN", "—", "Instagram viral reel scraper"],
    ["NOWPAYMENTS_API_KEY", "—", "NOWPayments crypto invoices"],
    ["NOWPAYMENTS_IPN_SECRET", "—", "NOWPayments webhook HMAC secret"],
    ["TESTING_STRIPE_SECRET_KEY", "—", "Stripe test key (dev only)"],
    ["VITE_STRIPE_PUBLIC_KEY", "—", "Stripe publishable key (frontend)"],
    ["VITE_FIREBASE_PROJECT_ID", "—", "Firebase project ID"],
    ["FIREBASE_CLIENT_EMAIL", "—", "Firebase service account email"],
    ["FIREBASE_PRIVATE_KEY", "—", "Firebase service account private key"],
    ["CLOUDINARY_CLOUD_NAME/API_KEY/SECRET", "—", "Cloudinary fallback storage"],
    ["WAVESPEED_MAX_CONCURRENT", "20", "Max concurrent WaveSpeed requests"],
    ["TELEMETRY_SLOW_REQUEST_MS", "4000", "Slow request alert threshold (ms)"],
    ["TELEMETRY_REQUEST_SAMPLE_RATE", "1.0", "Fraction of requests to log (0.0–1.0)"],
    ["FRONTEND_URL", "—", "Frontend URL for Stripe redirect callbacks"],
    ["PORT", "5000", "Server port"],
  ],
  [195, 70, 210]
);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13
// ─────────────────────────────────────────────────────────────────────────────
np();
h1("13. Background Jobs & Monitoring");

h2("13.1 Generation Poller");
bullet([
  "Polls WaveSpeed for all pending/processing generations continuously",
  "Uses requestQueue concurrency limiter (WAVESPEED_MAX_CONCURRENT)",
  "Completion: archives output to R2, updates outputUrl + status='completed'",
  "Failure: refundGeneration(), sets errorMessage, status='failed'",
  "Self-ping every 5 min to keep Replit process alive",
  "Shutdown handlers in server.js clean up on SIGTERM/SIGINT",
]);

h2("13.2 Stuck Generation Healer  (every 10 min)");
bullet([
  "Finds generations stuck in 'processing' for >20 minutes",
  "Marks them 'failed', errorMessage = 'Generation timed out'",
  "Calls refundGeneration() for each — credits returned to user",
]);

h2("13.3 Stuck LoRA Healer  (every 15 min)");
bullet([
  "Finds LoRAs stuck in 'training' for >2 hours",
  "Marks them 'failed'",
  "Calls refundCredits(userId, 75 or 150)",
  "Creates CreditTransaction audit record for the refund",
]);

h2("13.4 System Health Snapshots  (every 5 min)");
bullet([
  "Records: memory RSS/heap, event loop lag, uptime, active handles",
  "Writes to SystemHealthMetric table",
  "Admin telemetry page visualizes last 24 hours",
]);

h2("13.5 Endpoint Health Checks  (every 15 min)");
bullet([
  "Makes real HTTP requests to critical API endpoints",
  "Records response time, status code, pass/fail per endpoint",
  "Writes ApiEndpointHealthSnapshot",
  "Admin telemetry shows current health status for each route",
]);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 14
// ─────────────────────────────────────────────────────────────────────────────
np();
h1("14. Error Handling & Reporting");

h2("14.1 Frontend Error Boundary — Production Behaviour");
codeBlock(
`IS_PROD = import.meta.env.PROD (set by Vite at build time)

Production:
  - Shows clean user-facing screen: "Something went wrong — team notified"
  - ZERO stack trace / component stack visible to users
  - Auto-fires POST /api/errors/report immediately (fire-and-forget)
  - Reads logged-in user from Zustand store (class component workaround)
  - Shows "✓ Error report sent to support" once confirmed
  - Buttons: Refresh Page / Go to Dashboard / Contact Support (inactive)

Development:
  - Full error + component stack displayed, open by default
  - No email sent (avoids alert noise during development)`
);

h2("14.2 Admin Error Alert Email");
para("sendFrontendErrorAlert() sends a styled HTML email to ADMIN_EMAIL containing:");
bullet([
  "Error message (JavaScript exception message)",
  "Page URL where the crash occurred",
  "User ID + email (from Zustand store if logged in)",
  "User agent (browser + OS)",
  "Full JavaScript stack trace",
  "Full React component stack",
  "Timestamp (ISO 8601)",
]);

h2("14.3 POST /api/errors/report — Endpoint Details");
bullet([
  { label: "Rate limit", text: "5 reports per IP per 15 minutes — prevents spam/abuse" },
  { label: "Response", text: "Always HTTP 200 immediately — client never blocks waiting for email" },
  { label: "Noise filter", text: "Silently drops insertBefore/NotFoundError (browser-translate side effect, separately guarded)" },
  { label: "Auth", text: "Not required — errors can occur pre-login. Rate-limited to prevent abuse." },
]);

h2("14.4 Backend Error Philosophy");
bullet([
  "All generation endpoints return err.message in 500 responses — never generic 'Server error'",
  "Credit deductions always attempt refund before returning error to client",
  "Background IIFEs wrap entire logic in try/finally to guarantee refundGeneration runs",
  "Prisma P2002 (unique constraint) caught silently on all idempotent payment operations",
  "ErrorDisplay component is null-rendered in production — dev-only error popups",
  "Stack traces in API responses are never exposed — only human-readable messages",
]);

// ─────────────────────────────────────────────────────────────────────────────
// ADD PAGE NUMBERS to all buffered pages
// ─────────────────────────────────────────────────────────────────────────────
const range = doc.bufferedPageRange();
const total = range.count;

for (let i = 0; i < total; i++) {
  doc.switchToPage(range.start + i);
  if (i > 0) {
    doc.fontSize(7).fillColor(MUTED).font("Helvetica")
      .text(
        `ModelClone Technical Documentation  ·  Page ${i + 1} of ${total}`,
        ML, PH - 38,
        { align: "center", width: TW }
      );
  }
}

doc.end();

stream.on("finish", () => {
  console.log(`\n✅ PDF generated successfully!`);
  console.log(`📄 File: ${OUT}`);
  const size = fs.statSync(OUT).size;
  console.log(`📦 Size: ${(size / 1024).toFixed(0)} KB`);
});
stream.on("error", (e) => {
  console.error("❌ PDF write error:", e.message);
  process.exit(1);
});
