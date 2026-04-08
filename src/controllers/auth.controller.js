import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";
import {
  sendVerificationEmail,
  generateVerificationCode,
} from "../services/email.service.js";
import { calculateFreeCredits } from "../services/fingerprint.service.js";
import {
  REFERRAL_COOKIE_NAME,
  attachReferrerToUser,
  getReferralCookieOptions,
  normalizeReferralCode,
  resolveReferralMatchForSignup,
} from "../services/referral.service.js";
import { verifyFirebaseToken } from "../lib/firebase-admin.js";
import { setAuthCookie, setRefreshCookie, clearAuthCookie } from "../middleware/auth.middleware.js";
import {
  enforceIdentityUpdateBlock,
  enforceRestrictedUserActions,
} from "../utils/generated-content-deletion-guard.js";

function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    req.ip ||
    req.connection?.remoteAddress ||
    "unknown"
  );
}

async function applyReferralOnSignup({
  req,
  res,
  userId,
  userEmail,
  explicitReferralCode,
  ipAddress,
  deviceFingerprint,
}) {
  const match = await resolveReferralMatchForSignup({
    explicitReferralCode: normalizeReferralCode(explicitReferralCode),
    signedReferralToken: req.cookies?.[REFERRAL_COOKIE_NAME] || null,
    ipAddress,
    deviceFingerprint: deviceFingerprint || "no-fingerprint-available",
    signupUserId: userId,
    signupEmail: userEmail,
  });

  if (match?.clearCookie) {
    const { maxAge, ...clearOpts } = getReferralCookieOptions();
    res.clearCookie(REFERRAL_COOKIE_NAME, clearOpts);
  }

  if (match?.referralCode) {
    await attachReferrerToUser(userId, match.referralCode);
  }

  if (match && (match.status === "ambiguous" || match.status === "blocked")) {
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: "system",
        adminEmail: null,
        action: "referral_signup_needs_review",
        targetType: "user",
        targetId: userId,
        detailsJson: JSON.stringify({
          userId,
          userEmail,
          ipAddress,
          method: match.method,
          status: match.status,
          reason: match.reason || null,
          candidates: Array.isArray(match.candidates) ? match.candidates.slice(0, 10) : [],
        }),
      },
    });
  }
}

export async function checkEmail(req, res) {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email required",
      });
    }
    
    const user = await prisma.user.findUnique({ 
      where: { email },
      select: { id: true, authProvider: true }
    });
    
    return res.json({
      success: true,
      exists: !!user,
      authProvider: user?.authProvider || null,
    });
  } catch (error) {
    console.error("Check email error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

export async function firebaseSignup(req, res) {
  try {
    // If a user is already logged in (e.g. admin), drop that session before signup
    clearAuthCookie(res);

    const { idToken, name, referralCode, deviceFingerprint } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: "Firebase token required",
      });
    }

    // Verify the Firebase token server-side
    const verifiedToken = await verifyFirebaseToken(idToken);
    
    if (!verifiedToken) {
      return res.status(401).json({
        success: false,
        message: "Invalid Firebase token",
      });
    }

    const { uid, email } = verifiedToken;
    const ipAddress = getClientIp(req);
    const { getRegionFromIp } = await import("../utils/geo.js");
    const signupRegion = await getRegionFromIp(ipAddress);

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email not available from Firebase account",
      });
    }

    // Check if user already exists in our database
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { googleId: uid },
          { email: email }
        ]
      }
    });

    if (user) {
      // User already exists
      if (user.authProvider === 'email') {
        return res.status(400).json({
          success: false,
          message: "This email is already registered with password login. Please use the login page.",
        });
      }
      
      if (user.isVerified) {
        return res.status(400).json({
          success: false,
          message: "Account already verified. Please login.",
        });
      }
      
      // Resend verification code
      const verificationCode = generateVerificationCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      
      await prisma.user.update({
        where: { id: user.id },
        data: {
          verificationCode,
          codeExpiresAt: expiresAt,
        },
      });
      
      await sendVerificationEmail(email, verificationCode, user.name);
      
      return res.json({
        success: true,
        message: "Verification code sent! Check your email.",
        requiresVerification: true,
      });
    }

    // Create new user with verification code
    const verificationCode = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    user = await prisma.user.create({
      data: {
        email,
        name: name || email.split('@')[0],
        googleId: uid,
        authProvider: 'firebase',
        isVerified: false,
        verificationCode,
        codeExpiresAt: expiresAt,
        subscriptionStatus: 'trial',
        subscriptionCredits: 0,
        credits: 0,
        maxModels: 999,
        specialOfferEligible: true,
        ...(signupRegion ? { region: signupRegion } : {}),
      },
    });
    await applyReferralOnSignup({
      req,
      res,
      userId: user.id,
      userEmail: user.email,
      explicitReferralCode: referralCode,
      ipAddress,
      deviceFingerprint: deviceFingerprint || "no-fingerprint-available",
    });

    // Send our branded verification email
    await sendVerificationEmail(email, verificationCode, user.name);

    console.log(`✅ New Firebase user created: ${email} (awaiting verification)`);

    res.json({
      success: true,
      message: "Account created! Check your email for verification code.",
      requiresVerification: true,
    });
  } catch (error) {
    console.error("Firebase signup error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

export async function verifyFirebaseEmail(req, res) {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: "Email and verification code required",
      });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.authProvider !== 'firebase') {
      return res.status(400).json({
        success: false,
        message: "Please use the regular verification page",
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Email already verified",
      });
    }

    if (user.verificationCode !== code) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code",
      });
    }

    if (user.codeExpiresAt < new Date()) {
      return res.status(400).json({
        success: false,
        message: "Verification code expired. Please request a new one.",
      });
    }

    if (user.banLocked) {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_BAN_LOCKED",
        message: "This account has been suspended.",
      });
    }

    // Verify the user
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        verificationCode: null,
        codeExpiresAt: null,
      },
    });

    // Generate tokens
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    const refreshToken = jwt.sign(
      { userId: user.id, email: user.email, type: 'refresh' },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log(`✅ Firebase user verified: ${email}`);

    setAuthCookie(res, token);
    setRefreshCookie(res, refreshToken);

    res.json({
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
        isVerified: true,
        onboardingCompleted: user.onboardingCompleted,
        specialOfferEligible: user.specialOfferEligible,
        specialOfferLockedAt: user.specialOfferLockedAt,
        freeVideosCompleted: user.freeVideosCompleted,
        subscriptionStatus: user.subscriptionStatus ?? null,
        premiumFeaturesUnlocked: user.premiumFeaturesUnlocked ?? false,
      },
    });
  } catch (error) {
    console.error("Firebase verify error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

export async function resendFirebaseCode(req, res) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email required",
      });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Email already verified",
      });
    }

    const verificationCode = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        verificationCode,
        codeExpiresAt: expiresAt,
      },
    });

    await sendVerificationEmail(email, verificationCode, user.name);

    res.json({
      success: true,
      message: "Verification code sent!",
    });
  } catch (error) {
    console.error("Resend code error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

export async function signup(req, res) {
  try {
    // If a user is already logged in (e.g. admin), drop that session before signup
    clearAuthCookie(res);

    const { email, password, name, deviceFingerprint, userAgent, referralCode, acceptedPolicies } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password required",
      });
    }
    if (acceptedPolicies !== true) {
      return res.status(400).json({
        success: false,
        message: "You must accept the Terms, Privacy Policy, and Cookie Policy to register.",
        code: "POLICY_CONSENT_REQUIRED",
      });
    }

    // Device fingerprint is optional (may be blocked by ad blockers)
    // If not provided, use fallback value
    const finalFingerprint = deviceFingerprint || "no-fingerprint-available";

    // Check if user exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      if (!existingUser.isVerified) {
        // User exists but not verified - tell them to verify
        return res.status(400).json({
          success: false,
          message: "Account exists but not verified. Check your email for the verification code.",
          requiresVerification: true,
        });
      }

      // If user exists and IS verified, tell them to login
      return res.status(400).json({
        success: false,
        message: "User already exists. Please login instead.",
      });
    }

    // Get client IP address (respects reverse proxy headers from Replit)
    const ipAddress = getClientIp(req);
    const { getRegionFromIp } = await import("../utils/geo.js");
    const signupRegion = await getRegionFromIp(ipAddress);

    // Calculate free credits based on fingerprint and IP history
    const { credits, reason, previousAttempts } = await calculateFreeCredits(
      finalFingerprint,
      ipAddress,
      userAgent || req.headers["user-agent"] || "Unknown",
      email,
    );

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate verification code
    const verificationCode = generateVerificationCode();
    const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Create user with email verification required
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        isVerified: false,
        verificationCode,
        codeExpiresAt,
        subscriptionStatus: "trial",
        subscriptionCredits: 0, // Credits awarded after email verification
        credits: 0,
        maxModels: 999,
        specialOfferEligible: true,
        ...(signupRegion ? { region: signupRegion } : {}),
      },
    });
    await applyReferralOnSignup({
      req,
      res,
      userId: user.id,
      userEmail: user.email,
      explicitReferralCode: referralCode,
      ipAddress,
      deviceFingerprint: finalFingerprint,
    });

    // Send verification email
    try {
      await sendVerificationEmail(email, verificationCode, name);
      console.log(`📧 Verification email sent to: ${email}`);
    } catch (emailError) {
      console.error(`❌ Failed to send verification email to ${email}:`, emailError);
      // Still allow signup to proceed - user can request resend
    }

    console.log(`✅ New user registered (pending verification): ${email}`);

    res.status(201).json({
      success: true,
      message: "Account created! Check your email for verification code.",
      userId: user.id,
      email: user.email,
      requiresVerification: true,
      pendingCredits: credits, // Credits they'll receive after verification
      creditReason: reason,
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

export async function verifyEmail(req, res) {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: "Email and code required",
      });
    }

    // Find user
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if already verified
    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Email already verified",
      });
    }

    // Check code
    if (user.verificationCode !== code) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code",
      });
    }

    // Check expiration
    if (new Date() > user.codeExpiresAt) {
      return res.status(400).json({
        success: false,
        message: "Verification code expired",
      });
    }

    if (user.banLocked) {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_BAN_LOCKED",
        message: "This account has been suspended.",
      });
    }

    // Verify user (no credits awarded)
    const verifiedUser = await prisma.user.update({
      where: { email },
      data: {
        isVerified: true,
        verificationCode: null,
        codeExpiresAt: null,
      },
    });

    console.log(`✅ Email verified: ${email}`);

    // Access token (15 minutes)
    const token = jwt.sign(
      { userId: verifiedUser.id, email: verifiedUser.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    // Refresh token (30 days)
    const refreshToken = jwt.sign(
      { userId: verifiedUser.id, email: verifiedUser.email, type: "refresh" },
      process.env.JWT_SECRET,
      { expiresIn: "30d" },
    );

    setAuthCookie(res, token);
    setRefreshCookie(res, refreshToken);

    res.json({
      success: true,
      message: "Email verified successfully!",
      token,
      user: {
        id: verifiedUser.id,
        email: verifiedUser.email,
        name: verifiedUser.name,
        role: verifiedUser.role,
        authProvider: verifiedUser.authProvider,
        credits: Number(verifiedUser.credits ?? 0) || 0,
        subscriptionCredits: Number(verifiedUser.subscriptionCredits ?? 0) || 0,
        purchasedCredits: Number(verifiedUser.purchasedCredits ?? 0) || 0,
        isVerified: verifiedUser.isVerified,
        subscriptionStatus: verifiedUser.subscriptionStatus ?? null,
        premiumFeaturesUnlocked: verifiedUser.premiumFeaturesUnlocked ?? false,
      },
    });
  } catch (error) {
    console.error("Verification error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

export async function resendVerificationCode(req, res) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email required",
      });
    }

    // Find user
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if already verified
    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Email already verified",
      });
    }

    // Generate new code
    const verificationCode = generateVerificationCode();
    const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Update user
    await prisma.user.update({
      where: { email },
      data: {
        verificationCode,
        codeExpiresAt,
      },
    });

    // Send email
    const emailResult = await sendVerificationEmail(
      email,
      verificationCode,
      user.name,
    );

    if (!emailResult.success) {
      console.error("Failed to send verification email:", emailResult.error);
      return res.status(500).json({
        success: false,
        message: "Failed to send email",
      });
    }

    res.json({
      success: true,
      message: "Verification code sent!",
    });
  } catch (error) {
    console.error("Resend code error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

export async function login(req, res) {
  try {
    const { email, password, twoFactorCode } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password required",
      });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Legacy rows may have null authProvider; treat as email so bcrypt/hash checks still apply.
    const authProvider = user.authProvider ?? "email";
    if (authProvider !== "email") {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }
    const passwordHash = user.password;
    if (typeof passwordHash !== "string" || !passwordHash.startsWith("$2")) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const validPassword = await bcrypt.compare(password, passwordHash);
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    if (user.banLocked) {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_BAN_LOCKED",
        message: "This account has been suspended.",
      });
    }

    // Check if verified
    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: "Please verify your email first",
        requiresVerification: true,
        email: user.email,
      });
    }

    // Check if 2FA is enabled
    if (user.twoFactorEnabled) {
      // If no 2FA code provided, ask for it
      if (!twoFactorCode) {
        return res.status(200).json({
          success: false,
          requires2FA: true,
          message: "Please enter your 2FA code",
        });
      }

      // Verify 2FA code
      const { authenticator } = await import("otplib");
      const isValid = authenticator.verify({
        token: twoFactorCode,
        secret: user.twoFactorSecret,
      });

      if (!isValid) {
        return res.status(401).json({
          success: false,
          requires2FA: true,
          message: "Invalid 2FA code",
        });
      }
    }

    // Access token (15 minutes)
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    // Refresh token (30 days)
    const refreshToken = jwt.sign(
      { userId: user.id, email: user.email, type: "refresh" },
      process.env.JWT_SECRET,
      { expiresIn: "30d" },
    );

    setAuthCookie(res, token);
    setRefreshCookie(res, refreshToken);

    res.json({
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
        freeVideosCompleted: user.freeVideosCompleted,
        subscriptionStatus: user.subscriptionStatus ?? null,
        premiumFeaturesUnlocked: user.premiumFeaturesUnlocked ?? false,
        proAccess: user.proAccess ?? false,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

export async function getProfile(req, res) {
  try {
    const { checkAndExpireCredits } = await import("../services/credit.service.js");
    let freshUser = null;
    try {
      freshUser = await checkAndExpireCredits(req.user.userId);
    } catch (creditErr) {
      console.warn("checkAndExpireCredits failed (non-fatal):", creditErr.message);
    }
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        credits: true,
        subscriptionCredits: true,
        purchasedCredits: true,
        totalCreditsUsed: true,
        subscriptionTier: true,
        subscriptionStatus: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        isVerified: true,
        onboardingCompleted: true,
        hasUsedFreeTrial: true,
        specialOfferEligible: true,
        specialOfferLockedAt: true,
        freeVideosCompleted: true,
        authProvider: true,
        password: true,
        createdAt: true,
        allowCustomLoraTrainingPhotos: true,
        premiumFeaturesUnlocked: true,
        region: true,
        marketingLanguage: true,
        proAccess: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Always send credit fields as numbers so client never receives null/undefined (prevents 0-credits display bugs)
    const credits = Number(freshUser?.credits ?? user.credits ?? 0) || 0;
    const subscriptionCredits = Number(freshUser?.subscriptionCredits ?? user.subscriptionCredits ?? 0) || 0;
    const purchasedCredits = Number(freshUser?.purchasedCredits ?? user.purchasedCredits ?? 0) || 0;

    const safeUser = {
      ...user,
      credits,
      subscriptionCredits,
      purchasedCredits,
      hasPassword: Boolean(user.password),
      password: undefined,
    };

    res.json({
      success: true,
      user: safeUser,
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

export async function updateProfile(req, res) {
  try {
    const userId = req.user?.userId ?? req.user?.id ?? req.user?.sub;
    if (enforceIdentityUpdateBlock(req, res)) return;
    const { name, region, marketingLanguage } = req.body;

    const data = {};
    if (name !== undefined) {
      if (typeof name !== "string") {
        return res.status(400).json({ success: false, message: "Name must be a string" });
      }
      const trimmedName = name.trim();
      if (trimmedName.length < 2 || trimmedName.length > 60) {
        return res.status(400).json({ success: false, message: "Name must be between 2 and 60 characters" });
      }
      data.name = trimmedName;
    }
    if (region !== undefined) {
      data.region = region === null || region === "" ? null : String(region).trim().slice(0, 10) || null;
    }
    if (marketingLanguage !== undefined) {
      data.marketingLanguage = marketingLanguage === null || marketingLanguage === "" ? null : String(marketingLanguage).trim().slice(0, 10) || null;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields to update" });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        authProvider: true,
        region: true,
        marketingLanguage: true,
      },
    });

    res.json({
      success: true,
      message: "Profile updated successfully",
      user: updated,
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

export async function requestEmailChange(req, res) {
  try {
    const userId = req.user?.userId;
    if (enforceIdentityUpdateBlock(req, res)) return;
    const { newEmail, currentPassword } = req.body;

    if (!newEmail || !currentPassword) {
      return res.status(400).json({
        success: false,
        message: "New email and current password are required",
      });
    }

    const normalizedEmail = newEmail.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        authProvider: true,
        password: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.authProvider !== "email" || !user.password) {
      return res.status(400).json({
        success: false,
        message: "Email change is only available for email/password accounts",
      });
    }

    if (user.email.toLowerCase() === normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: "Please enter a different email address",
      });
    }

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "That email is already in use",
      });
    }

    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    const code = generateVerificationCode();
    const emailChangeToken = jwt.sign(
      { userId: user.id, newEmail: normalizedEmail, code, type: "email-change" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    await sendVerificationEmail(normalizedEmail, code, user.name || normalizedEmail);

    res.json({
      success: true,
      message: "Verification code sent to your new email",
      emailChangeToken,
    });
  } catch (error) {
    console.error("Request email change error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

export async function verifyEmailChange(req, res) {
  try {
    const userId = req.user?.userId;
    if (enforceIdentityUpdateBlock(req, res)) return;
    const { code, emailChangeToken } = req.body;

    if (!code || !emailChangeToken) {
      return res.status(400).json({
        success: false,
        message: "Verification code and token are required",
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(emailChangeToken, process.env.JWT_SECRET);
    } catch {
      return res.status(400).json({
        success: false,
        message: "Email change session expired. Please request a new code.",
      });
    }

    if (
      decoded.type !== "email-change" ||
      decoded.userId !== userId ||
      decoded.code !== code
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code",
      });
    }

    const existing = await prisma.user.findUnique({ where: { email: decoded.newEmail } });
    if (existing && existing.id !== userId) {
      return res.status(400).json({
        success: false,
        message: "That email is already in use",
      });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { email: decoded.newEmail, isVerified: true },
      select: { id: true, email: true, name: true, authProvider: true },
    });

    res.json({
      success: true,
      message: "Email updated successfully",
      user: updated,
    });
  } catch (error) {
    console.error("Verify email change error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

export async function requestPasswordReset(req, res) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email required",
      });
    }

    // Find user
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      // For security, don't reveal if email exists or not
      return res.json({
        success: true,
        message: "If that email exists, a reset code has been sent",
      });
    }

    if (user.banLocked) {
      console.warn("Password reset request suppressed for ban-locked account");
      return res.json({
        success: true,
        message: "If that email exists, a reset code has been sent",
      });
    }

    const resetCode = generateVerificationCode();
    const resetCodeExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.user.update({
      where: { email },
      data: {
        resetCode,
        resetCodeExpiresAt,
      },
    });

    // Send password reset email
    const emailResult = await sendVerificationEmail(
      email,
      resetCode,
      user.name,
      true,
    );

    if (!emailResult.success) {
      console.error("Failed to send reset email:", emailResult.error);
      return res.status(500).json({
        success: false,
        message: "Failed to send reset email",
      });
    }

    res.json({
      success: true,
      message: "If that email exists, a reset code has been sent",
    });
  } catch (error) {
    console.error("Request password reset error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

export async function resetPassword(req, res) {
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Email, code, and new password required",
      });
    }

    // Validate password length
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    // Find user
    const user = await prisma.user.findUnique({ where: { email } });

    // For security: Don't reveal if email exists or not
    if (!user) {
      console.warn(`Password reset attempted for non-existent email: ${email}`);
      return res.status(400).json({
        success: false,
        message: "Invalid reset code or email",
      });
    }

    if (user.banLocked) {
      return res.status(400).json({
        success: false,
        message: "Invalid reset code or email",
      });
    }

    if (!user.resetCode || user.resetCode !== code) {
      return res.status(400).json({
        success: false,
        message: "Invalid reset code or email",
      });
    }

    if (new Date() > user.resetCodeExpiresAt) {
      return res.status(400).json({
        success: false,
        message: "Reset code expired",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { email },
      data: {
        password: hashedPassword,
        resetCode: null,
        resetCodeExpiresAt: null,
      },
    });

    res.json({
      success: true,
      message: "Password reset successfully!",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

// Refresh token endpoint
export async function refreshToken(req, res) {
  try {
    const refreshToken = req.body?.refreshToken || req.cookies?.refresh_token;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: "Refresh token required",
      });
    }

    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired refresh token",
      });
    }

    // Check if it's a refresh token type
    if (decoded.type !== "refresh") {
      return res.status(401).json({
        success: false,
        message: "Invalid token type",
      });
    }

    // Check if user still exists
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        totalCreditsUsed: true,
        subscriptionTier: true,
        subscriptionStatus: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        authProvider: true,
        credits: true,
        subscriptionCredits: true,
        purchasedCredits: true,
        isVerified: true,
        onboardingCompleted: true,
        hasUsedFreeTrial: true,
        specialOfferEligible: true,
        specialOfferLockedAt: true,
        freeVideosCompleted: true,
        createdAt: true,
        allowCustomLoraTrainingPhotos: true,
        premiumFeaturesUnlocked: true,
        region: true,
        marketingLanguage: true,
        proAccess: true,
        banLocked: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.banLocked) {
      clearAuthCookie(res);
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_BAN_LOCKED",
        message: "This account has been suspended.",
      });
    }

    // Generate new access token
    const newToken = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    setAuthCookie(res, newToken);

    // Always send credit fields as numbers so client never receives null/undefined (prevents 0-credits display bugs)
    const safeUser = {
      ...user,
      credits: Number(user.credits ?? 0) || 0,
      subscriptionCredits: Number(user.subscriptionCredits ?? 0) || 0,
      purchasedCredits: Number(user.purchasedCredits ?? 0) || 0,
    };

    res.json({
      success: true,
      token: newToken,
      user: safeUser,
    });
  } catch (error) {
    console.error("Refresh token error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

// Change password (requires authentication and current password)
export async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user?.userId;
    if (enforceRestrictedUserActions(req, res)) return;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters",
      });
    }

    // Get user with password
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true, authProvider: true },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!user.password || user.authProvider !== "email") {
      return res.status(400).json({
        success: false,
        message: "Password change is only available for email/password accounts",
      });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    res.json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

export async function googleAuth(req, res) {
  try {
    const { idToken, mode, referralCode, deviceFingerprint, acceptedPolicies } = req.body;
    const ipAddress = getClientIp(req);

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: "Missing ID token",
      });
    }

    // Verify the Firebase ID token server-side (SECURITY FIX)
    const verifiedToken = await verifyFirebaseToken(idToken);
    
    if (!verifiedToken.success) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    // Use VERIFIED data from Firebase, not client-provided data
    const { uid, email, name: displayName } = verifiedToken;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email not available from Google account",
      });
    }

    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { googleId: uid },
          { email: email }
        ]
      }
    });

    let isNewUser = false;

    if (!user) {
      if (mode === "signup" && acceptedPolicies !== true) {
        return res.status(400).json({
          success: false,
          message: "You must accept the Terms, Privacy Policy, and Cookie Policy to register.",
          code: "POLICY_CONSENT_REQUIRED",
        });
      }
      // Auto-create account for smoother onboarding (no friction)
      isNewUser = true;
      const { getRegionFromIp } = await import("../utils/geo.js");
      const signupRegion = await getRegionFromIp(ipAddress);
      user = await prisma.user.create({
        data: {
          email,
          name: displayName || email.split('@')[0],
          googleId: uid,
          authProvider: 'google',
          isVerified: true,
          subscriptionStatus: 'trial',
          subscriptionCredits: 0,
          credits: 0,
          maxModels: 999,
          specialOfferEligible: true,
          ...(signupRegion ? { region: signupRegion } : {}),
        },
      });
      await applyReferralOnSignup({
        req,
        res,
        userId: user.id,
        userEmail: user.email,
        explicitReferralCode: referralCode,
        ipAddress,
        deviceFingerprint: deviceFingerprint || "no-fingerprint-available",
      });
      console.log(`✅ New Google user registered: ${email} (verified)`);
    } else if (!user.googleId) {
      if (user.banLocked) {
        return res.status(403).json({
          success: false,
          code: "ACCOUNT_BAN_LOCKED",
          message: "This account has been suspended.",
        });
      }
      // Link existing email account to Google
      await prisma.user.update({
        where: { id: user.id },
        data: { 
          googleId: uid,
          isVerified: true,
          // Keep original authProvider to preserve that they started with email
        },
      });
      user = await prisma.user.findUnique({ where: { id: user.id } });
      console.log(`✅ Existing user linked to Google: ${email} (verified)`);
    } else {
      console.log(`✅ Google user logged in: ${email} (verified)`);
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
      { expiresIn: "7d" }
    );

    const refreshToken = jwt.sign(
      { userId: user.id, email: user.email, type: 'refresh' },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    setAuthCookie(res, token);
    setRefreshCookie(res, refreshToken);

    res.json({
      success: true,
      isNewUser,
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
      },
    });
  } catch (error) {
    console.error("Google auth error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

export async function logout(req, res) {
  clearAuthCookie(res);
  res.json({ success: true, message: "Logged out successfully" });
}
