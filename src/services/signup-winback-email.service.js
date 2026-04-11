import { randomBytes } from "node:crypto";
import prisma from "../lib/prisma.js";
import { sendFirstMembershipDiscountEmail } from "./email.service.js";

const DEFAULT_DISCOUNT_PERCENT = 15;
const DEFAULT_ELIGIBLE_AFTER_HOURS = 12;
const DEFAULT_LOOKBACK_HOURS = 24 * 7;
const DEFAULT_BATCH_SIZE = 100;
const DISCOUNT_VALID_DAYS = 14;

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function safeName(name, email) {
  if (typeof name === "string" && name.trim()) return name.trim();
  const localPart = String(email || "").split("@")[0];
  return localPart || "Creator";
}

async function findFirstMembershipPurchase(userId, afterDate = null) {
  return prisma.creditTransaction.findFirst({
    where: {
      userId,
      amount: { gt: 0 },
      ...(afterDate ? { createdAt: { gte: afterDate } } : {}),
      OR: [
        { type: "subscription" },
        { description: { contains: "subscription", mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      createdAt: true,
    },
  });
}

async function createFirstMembershipDiscountCode(discountPercent) {
  const validFrom = new Date();
  const validUntil = addDays(validFrom, DISCOUNT_VALID_DAYS);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = `WELCOME${discountPercent}-${randomBytes(3).toString("hex").toUpperCase()}`;
    try {
      const row = await prisma.discountCode.create({
        data: {
          code,
          discountType: "percentage",
          discountValue: discountPercent,
          appliesTo: "subscription",
          validFrom,
          validUntil,
          maxUses: 1,
          currentUses: 0,
          isActive: true,
        },
        select: { id: true, code: true, validUntil: true },
      });
      return row;
    } catch (error) {
      if (error?.code === "P2002") continue;
      throw error;
    }
  }
  throw new Error("Failed to create unique discount code");
}

async function syncConvertedOffers(limit = 200) {
  const pendingConversion = await prisma.abandonedSignupEmailOffer.findMany({
    where: {
      sentAt: { not: null },
      convertedAt: null,
      status: { in: ["sent"] },
    },
    orderBy: { sentAt: "asc" },
    take: limit,
    select: {
      id: true,
      userId: true,
      sentAt: true,
    },
  });

  let converted = 0;
  for (const offer of pendingConversion) {
    const membershipTx = await findFirstMembershipPurchase(offer.userId, offer.sentAt || null);
    if (!membershipTx) continue;
    await prisma.abandonedSignupEmailOffer.update({
      where: { id: offer.id },
      data: {
        status: "converted",
        convertedAt: membershipTx.createdAt || new Date(),
        membershipTxId: membershipTx.id,
      },
    });
    converted += 1;
  }

  return converted;
}

export async function runSignupNoPurchaseWinbackCampaign({
  discountPercent = DEFAULT_DISCOUNT_PERCENT,
  eligibleAfterHours = DEFAULT_ELIGIBLE_AFTER_HOURS,
  lookbackHours = DEFAULT_LOOKBACK_HOURS,
  batchSize = DEFAULT_BATCH_SIZE,
} = {}) {
  const now = new Date();
  const eligibleBefore = addHours(now, -Math.abs(eligibleAfterHours));
  const eligibleAfter = addHours(now, -Math.abs(lookbackHours));

  const users = await prisma.user.findMany({
    where: {
      isVerified: true,
      banLocked: false,
      createdAt: {
        gte: eligibleAfter,
        lte: eligibleBefore,
      },
      abandonedSignupEmailOffer: { is: null },
    },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(batchSize, 500)),
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
    },
  });

  const unsubscribedRows = await prisma.emailUnsubscribe.findMany({
    select: { email: true },
  });
  const unsubscribed = new Set(unsubscribedRows.map((row) => String(row.email || "").toLowerCase()));

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    const email = String(user.email || "").trim().toLowerCase();
    if (!email) continue;
    const scheduledFor = addHours(user.createdAt, eligibleAfterHours);

    if (unsubscribed.has(email)) {
      await prisma.abandonedSignupEmailOffer.create({
        data: {
          userId: user.id,
          email,
          discountCode: "",
          discountPercent,
          status: "skipped",
          scheduledFor,
          errorMessage: "unsubscribed",
        },
      }).catch(() => {});
      skipped += 1;
      continue;
    }

    const membershipTx = await findFirstMembershipPurchase(user.id, null);
    if (membershipTx) {
      await prisma.abandonedSignupEmailOffer.create({
        data: {
          userId: user.id,
          email,
          discountCode: "",
          discountPercent,
          status: "skipped",
          scheduledFor,
          convertedAt: membershipTx.createdAt || now,
          membershipTxId: membershipTx.id,
          errorMessage: "already_member",
        },
      }).catch(() => {});
      skipped += 1;
      continue;
    }

    let offer = null;
    try {
      const discount = await createFirstMembershipDiscountCode(discountPercent);
      offer = await prisma.abandonedSignupEmailOffer.create({
        data: {
          userId: user.id,
          email,
          discountCodeId: discount.id,
          discountCode: discount.code,
          discountPercent,
          status: "pending",
          scheduledFor,
        },
      });

      const sendResult = await sendFirstMembershipDiscountEmail({
        email,
        userName: safeName(user.name, email),
        discountCode: discount.code,
        discountPercent,
        validUntil: discount.validUntil,
      });

      if (sendResult.success) {
        await prisma.abandonedSignupEmailOffer.update({
          where: { id: offer.id },
          data: {
            status: "sent",
            sentAt: new Date(),
          },
        });
        sent += 1;
      } else {
        await prisma.abandonedSignupEmailOffer.update({
          where: { id: offer.id },
          data: {
            status: "failed",
            errorMessage: String(sendResult.error || "send_failed").slice(0, 300),
          },
        });
        failed += 1;
      }
    } catch (error) {
      if (offer?.id) {
        await prisma.abandonedSignupEmailOffer.update({
          where: { id: offer.id },
          data: {
            status: "failed",
            errorMessage: String(error?.message || "unknown_error").slice(0, 300),
          },
        }).catch(() => {});
      }
      failed += 1;
    }
  }

  const converted = await syncConvertedOffers();

  return {
    scanned: users.length,
    sent,
    skipped,
    failed,
    converted,
    eligibleWindow: {
      start: eligibleAfter,
      end: eligibleBefore,
    },
  };
}
