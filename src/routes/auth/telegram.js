import crypto from "crypto";
import jwt from "jsonwebtoken";
import { Router } from "express";
import prisma from "../../lib/prisma.js";
import {
  authMiddleware,
  setAuthCookie,
  setRefreshCookie,
} from "../../middleware/auth.middleware.js";

const router = Router();
const DAY_SECONDS = 24 * 60 * 60;

function validateTelegramInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return false;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const expectedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const hashBuffer = Buffer.from(hash, "utf8");
  const expectedHashBuffer = Buffer.from(expectedHash, "utf8");
  if (hashBuffer.length !== expectedHashBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, expectedHashBuffer);
}

function parseTelegramPayload(initData) {
  const params = new URLSearchParams(initData);
  const authDateRaw = params.get("auth_date");
  const userRaw = params.get("user");

  if (!authDateRaw || !userRaw) return null;
  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate)) return null;

  let user;
  try {
    user = JSON.parse(userRaw);
  } catch {
    return null;
  }
  if (!user || typeof user.id !== "number") return null;
  return { authDate, user };
}

function validateAndParse(initData, botToken) {
  const isValid = validateTelegramInitData(initData, botToken);
  if (!isValid) {
    return { ok: false, status: 401, message: "Invalid Telegram authorization payload." };
  }
  const parsed = parseTelegramPayload(initData);
  if (!parsed) {
    return { ok: false, status: 400, message: "Malformed Telegram user payload." };
  }
  const authAgeSeconds = Math.floor(Date.now() / 1000) - parsed.authDate;
  if (authAgeSeconds < 0 || authAgeSeconds > DAY_SECONDS) {
    return { ok: false, status: 401, message: "Telegram authorization payload expired." };
  }
  return { ok: true, parsed };
}

router.post("/telegram", async (req, res) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const initData = String(req.body?.initData || "").trim();

  if (!botToken) {
    return res.status(500).json({
      success: false,
      message: "Telegram auth is not configured.",
    });
  }

  if (!initData) {
    return res.status(400).json({
      success: false,
      message: "Missing Telegram initData.",
    });
  }

  const checked = validateAndParse(initData, botToken);
  if (!checked.ok) {
    return res.status(checked.status).json({ success: false, message: checked.message });
  }
  const { parsed } = checked;

  const telegramId = String(parsed.user.id);
  const telegramUsername = parsed.user.username ? String(parsed.user.username) : null;
  const displayName = [parsed.user.first_name, parsed.user.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  try {
    let user = await prisma.user.findFirst({
      where: { telegram_id: telegramId },
    });

    if (!user && parsed.user.email) {
      user = await prisma.user.findUnique({
        where: { email: String(parsed.user.email).toLowerCase().trim() },
      });
    }

    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          telegram_id: telegramId,
          telegram_username: telegramUsername,
          is_telegram: true,
          ...(displayName ? { name: displayName } : {}),
          isVerified: true,
        },
      });
    } else {
      const fallbackEmail = `telegram_${telegramId}@telegram.modelclone.local`;
      user = await prisma.user.create({
        data: {
          email: fallbackEmail,
          name: displayName || telegramUsername || `telegram-${telegramId}`,
          authProvider: "telegram",
          telegram_id: telegramId,
          telegram_username: telegramUsername,
          is_telegram: true,
          isVerified: true,
          subscriptionStatus: "trial",
          subscriptionCredits: 0,
          purchasedCredits: 0,
          credits: 250,
          maxModels: 999,
          specialOfferEligible: true,
        },
      });
    }

    if (user.banLocked) {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_BAN_LOCKED",
        message: "This account has been suspended.",
      });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );
    const refreshToken = jwt.sign(
      { userId: user.id, email: user.email, type: "refresh" },
      process.env.JWT_SECRET,
      { expiresIn: "30d" },
    );

    setAuthCookie(res, token);
    setRefreshCookie(res, refreshToken);

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        authProvider: user.authProvider,
        credits: Number(user.credits ?? 0) || 0,
        subscriptionCredits: Number(user.subscriptionCredits ?? 0) || 0,
        purchasedCredits: Number(user.purchasedCredits ?? 0) || 0,
        isVerified: user.isVerified,
        onboardingCompleted: user.onboardingCompleted,
        specialOfferEligible: user.specialOfferEligible,
        specialOfferLockedAt: user.specialOfferLockedAt,
        freeVideosCompleted: user.freeVideosCompleted,
        subscriptionStatus: user.subscriptionStatus ?? null,
        premiumFeaturesUnlocked: user.premiumFeaturesUnlocked ?? false,
        telegramUser: {
          id: parsed.user.id,
          first_name: parsed.user.first_name || null,
          last_name: parsed.user.last_name || null,
          username: parsed.user.username || null,
          photo_url: parsed.user.photo_url || null,
          language_code: parsed.user.language_code || null,
        },
      },
    });
  } catch (error) {
    console.error("Telegram auth error:", error);
    return res.status(500).json({
      success: false,
      message: "Telegram authentication failed.",
    });
  }
});

router.post("/telegram/link", authMiddleware, async (req, res) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const initData = String(req.body?.initData || "").trim();
  if (!botToken) {
    return res.status(500).json({
      success: false,
      message: "Telegram auth is not configured.",
    });
  }
  if (!initData) {
    return res.status(400).json({
      success: false,
      message: "Missing Telegram initData.",
    });
  }

  const checked = validateAndParse(initData, botToken);
  if (!checked.ok) {
    return res.status(checked.status).json({ success: false, message: checked.message });
  }
  const { parsed } = checked;

  const telegramId = String(parsed.user.id);
  const telegramUsername = parsed.user.username ? String(parsed.user.username) : null;
  const displayName = [parsed.user.first_name, parsed.user.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const currentUserId = req.user?.userId;

  try {
    const existingTelegramUser = await prisma.user.findFirst({
      where: { telegram_id: telegramId },
      select: { id: true },
    });
    if (existingTelegramUser && existingTelegramUser.id !== currentUserId) {
      return res.status(409).json({
        success: false,
        message: "This Telegram account is already linked to another user.",
      });
    }

    await prisma.user.update({
      where: { id: currentUserId },
      data: {
        telegram_id: telegramId,
        telegram_username: telegramUsername,
        is_telegram: true,
        ...(displayName ? { name: displayName } : {}),
      },
    });

    return res.json({
      success: true,
      linked: true,
      telegramUser: {
        id: parsed.user.id,
        first_name: parsed.user.first_name || null,
        last_name: parsed.user.last_name || null,
        username: parsed.user.username || null,
        photo_url: parsed.user.photo_url || null,
        language_code: parsed.user.language_code || null,
      },
    });
  } catch (error) {
    console.error("Telegram link error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to link Telegram account.",
    });
  }
});

export default router;
