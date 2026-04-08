import { authenticator } from "otplib";
import QRCode from "qrcode";
import prisma from "../lib/prisma.js";
import { enforceRestrictedUserActions } from "../utils/generated-content-deletion-guard.js";

// Generate 2FA secret and QR code for setup
export async function generate2FASecret(req, res) {
  try {
    const userId = req.user?.userId;
    if (enforceRestrictedUserActions(req, res)) return;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, twoFactorEnabled: true },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.twoFactorEnabled) {
      return res.status(400).json({
        success: false,
        message: "2FA is already enabled. Disable it first to set up a new one.",
      });
    }

    // Generate secret
    const secret = authenticator.generateSecret();

    // Generate OTP Auth URL for authenticator apps
    const otpAuthUrl = authenticator.keyuri(user.email, "ModelClone", secret);

    // Generate QR code as data URL
    const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl);

    // Store secret temporarily (not enabled until verified)
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret },
    });

    res.json({
      success: true,
      secret,
      qrCode: qrCodeDataUrl,
      message: "Scan the QR code with your authenticator app, then verify with a code",
    });
  } catch (error) {
    console.error("Generate 2FA secret error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

// Verify 2FA code and enable 2FA
export async function verify2FA(req, res) {
  try {
    const userId = req.user?.userId;
    if (enforceRestrictedUserActions(req, res)) return;
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Verification code required",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, twoFactorEnabled: true },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!user.twoFactorSecret) {
      return res.status(400).json({
        success: false,
        message: "No 2FA setup in progress. Generate a secret first.",
      });
    }

    // Verify the code
    const isValid = authenticator.verify({
      token: code,
      secret: user.twoFactorSecret,
    });

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code. Please try again.",
      });
    }

    // Enable 2FA
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });

    res.json({
      success: true,
      message: "Two-factor authentication enabled successfully!",
    });
  } catch (error) {
    console.error("Verify 2FA error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

// Disable 2FA (requires current 2FA code)
export async function disable2FA(req, res) {
  try {
    const userId = req.user?.userId;
    if (enforceRestrictedUserActions(req, res)) return;
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "2FA code required to disable",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, twoFactorEnabled: true },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!user.twoFactorEnabled) {
      return res.status(400).json({
        success: false,
        message: "2FA is not enabled",
      });
    }

    // Verify the code
    const isValid = authenticator.verify({
      token: code,
      secret: user.twoFactorSecret,
    });

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code",
      });
    }

    // Disable 2FA
    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
      },
    });

    res.json({
      success: true,
      message: "Two-factor authentication disabled",
    });
  } catch (error) {
    console.error("Disable 2FA error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

// Get 2FA status
export async function get2FAStatus(req, res) {
  try {
    const userId = req.user?.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      twoFactorEnabled: user.twoFactorEnabled,
    });
  } catch (error) {
    console.error("Get 2FA status error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

// Validate 2FA code during login (called internally)
export function validate2FACode(secret, code) {
  return authenticator.verify({
    token: code,
    secret: secret,
  });
}
