import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma.js';

const isProduction = process.env.NODE_ENV === 'production';

const BAN_RESPONSE = {
  success: false,
  code: 'ACCOUNT_BAN_LOCKED',
  message: 'This account has been suspended.',
};

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/',
};

export function setAuthCookie(res, token) {
  res.cookie('auth_token', token, COOKIE_OPTIONS);
}

export function setRefreshCookie(res, refreshToken) {
  res.cookie('refresh_token', refreshToken, COOKIE_OPTIONS);
}

export function clearAuthCookie(res) {
  const { maxAge, ...clearCookieOptions } = COOKIE_OPTIONS;
  res.clearCookie('auth_token', clearCookieOptions);
  res.clearCookie('refresh_token', clearCookieOptions);
}

function extractRawApiKey(req) {
  const x = req.headers['x-api-key'];
  if (typeof x === 'string' && x.trim()) return x.trim();
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('ApiKey ')) return authHeader.slice(7).trim();
  if (authHeader?.startsWith('Bearer mcl_')) return authHeader.slice(7).trim();
  return null;
}

export const authMiddleware = async (req, res, next) => {
  try {
    const rawApiKey = extractRawApiKey(req);
    if (rawApiKey) {
      const keyPrefix = rawApiKey.slice(0, 16);
      const candidates = await prisma.apiKey.findMany({
        where: { keyPrefix, revokedAt: null },
        include: {
          user: { select: { id: true, email: true, banLocked: true } },
        },
      });
      for (const rec of candidates) {
        const match = await bcrypt.compare(rawApiKey, rec.keyHash);
        if (!match) continue;
        const user = rec.user;
        if (!user) continue;
        if (user.banLocked) {
          return res.status(403).json(BAN_RESPONSE);
        }
        const origin = req.headers.origin;
        if (origin && rec.corsOrigins) {
          let allowed = [];
          try {
            allowed = JSON.parse(rec.corsOrigins);
          } catch {
            allowed = [];
          }
          if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(origin)) {
            return res.status(403).json({
              success: false,
              message: 'Origin not allowed for this API key',
            });
          }
        }
        void prisma.apiKey
          .update({
            where: { id: rec.id },
            data: { lastUsedAt: new Date() },
          })
          .catch(() => {});
        req.apiKey = { id: rec.id, name: rec.name, userId: rec.userId };
        req.user = {
          userId: user.id,
          id: user.id,
          email: user.email,
          banLocked: false,
          authViaApiKey: true,
        };
        return next();
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid API key',
      });
    }

    let token = req.cookies?.auth_token;

    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const bearer = authHeader.split(' ')[1];
        if (bearer?.startsWith('mcl_')) {
          return res.status(401).json({
            success: false,
            message: 'Invalid API key',
          });
        }
        token = bearer;
      }
    }

    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'No token provided' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Refresh tokens must never authorize normal API routes.
    if (decoded?.type === "refresh") {
      return res.status(401).json({
        success: false,
        message: "Invalid token type",
      });
    }
    // Normalize so id, userId, and sub all work (some tokens may use only one)
    const userId = decoded.userId ?? decoded.id ?? decoded.sub;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Invalid token payload" });
    }

    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { banLocked: true },
    });
    if (!row) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }
    if (row.banLocked) {
      return res.status(403).json(BAN_RESPONSE);
    }

    req.user = { ...decoded, userId, id: userId, banLocked: false };
    next();
  } catch (error) {
    return res.status(401).json({ 
      success: false, 
      message: 'Invalid token' 
    });
  }
};
