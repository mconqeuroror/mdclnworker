import prisma from "../lib/prisma.js";

const TRANSIENT_ERROR_PATTERNS = [
  "Unable to start a transaction",
  "Transaction already closed",
  "Connection pool timeout",
  "Can't reach database server",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "prepared statement",
  "server closed the connection unexpectedly",
];

function isTransientError(err) {
  const msg = err?.message || String(err);
  return TRANSIENT_ERROR_PATTERNS.some((p) => msg.includes(p));
}

async function withRetry(fn, { attempts = 3, delayMs = 1000, label = "operation" } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts || !isTransientError(err)) {
        console.error(`❌ ${label} failed after ${i} attempt(s): ${err.message}`);
        throw err;
      }
      console.warn(`⚠️ ${label} attempt ${i}/${attempts} failed (transient): ${err.message} — retrying in ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/**
 * Check if subscription credits have expired and reset them if needed
 * Uses atomic updateMany + findUnique instead of interactive transaction
 * to minimize connection pool pressure
 */
export async function checkAndExpireCredits(userId) {
  const now = new Date();

  await prisma.user.updateMany({
    where: {
      id: userId,
      creditsExpireAt: { not: null, lt: now },
    },
    data: {
      subscriptionCredits: 0,
      creditsExpireAt: null,
    },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, subscriptionCredits: true, purchasedCredits: true, creditsExpireAt: true, credits: true },
  });

  if (!user) {
    throw new Error("User not found");
  }

  return user;
}

/**
 * Get total available credits (subscription + purchased + legacy/admin credits)
 */
export function getTotalCredits(user) {
  return (
    (user.subscriptionCredits || 0) +
    (user.purchasedCredits || 0) +
    (user.credits || 0)
  );
}

/**
 * Before replacing `subscriptionCredits` with a new plan grant, move any unused subscription
 * balance into `purchasedCredits` (non-expiring). Total credits stay the same; deduction order
 * still uses purchased first, then legacy, then subscription.
 *
 * @param {number|null|undefined} previousSubscriptionCredits
 * @returns {import("@prisma/client").Prisma.UserUpdateInput}
 */
export function rolloverSubPoolToPurchasedUpdate(previousSubscriptionCredits) {
  const n = Math.max(0, Math.floor(Number(previousSubscriptionCredits) || 0));
  if (n <= 0) return {};
  return { purchasedCredits: { increment: n } };
}

/**
 * Deduct credits from user account (ATOMIC, prevents race conditions)
 * Uses one-time purchased credits first, then legacy/admin credits, then subscription credits last
 */
export async function deductCredits(userId, amount) {
  if (amount <= 0) {
    throw new Error("Amount must be positive");
  }

  return await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;

    const currentUser = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, subscriptionCredits: true, purchasedCredits: true, creditsExpireAt: true, credits: true },
    });

    if (!currentUser) {
      throw new Error("User not found");
    }

    let subscriptionCredits = currentUser.subscriptionCredits || 0;
    let purchasedCredits = currentUser.purchasedCredits || 0;
    let legacyCredits = currentUser.credits || 0;

    const totalAvailable =
      subscriptionCredits + purchasedCredits + legacyCredits;

    if (totalAvailable < amount) {
      throw new Error(
        `Insufficient credits. Need ${amount}, have ${totalAvailable}`,
      );
    }

    let subscriptionDeduction = 0;
    let purchasedDeduction = 0;
    let legacyDeduction = 0;
    let remaining = amount;

    if (purchasedCredits >= remaining) {
      purchasedDeduction = remaining;
      remaining = 0;
    } else {
      purchasedDeduction = purchasedCredits;
      remaining -= purchasedCredits;
    }

    if (remaining > 0) {
      if (legacyCredits >= remaining) {
        legacyDeduction = remaining;
        remaining = 0;
      } else {
        legacyDeduction = legacyCredits;
        remaining -= legacyCredits;
      }
    }

    if (remaining > 0) {
      subscriptionDeduction = remaining;
      remaining = 0;
    }

    console.log(
      `💳 Deducting ${amount} credits: ${purchasedDeduction} from purchased, ${legacyDeduction} from legacy/admin, ${subscriptionDeduction} from subscription`,
    );

    const newSubscription = Math.max(0, subscriptionCredits - subscriptionDeduction);
    const newPurchased = Math.max(0, purchasedCredits - purchasedDeduction);
    const newLegacy = Math.max(0, legacyCredits - legacyDeduction);

    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: {
        subscriptionCredits: newSubscription,
        purchasedCredits: newPurchased,
        credits: newLegacy,
        totalCreditsUsed: { increment: amount },
      },
    });

    console.log(`✅ DB update complete. New purchasedCredits: ${updatedUser.purchasedCredits}`);

    return updatedUser;
  }, { timeout: 30000 });
}

export async function deductCreditsTx(tx, userId, amount) {
  if (amount <= 0) {
    throw new Error("Amount must be positive");
  }

  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;

  const currentUser = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, subscriptionCredits: true, purchasedCredits: true, creditsExpireAt: true, credits: true },
  });

  if (!currentUser) {
    throw new Error("User not found");
  }

  let subscriptionCredits = currentUser.subscriptionCredits || 0;

  if (currentUser.creditsExpireAt && new Date(currentUser.creditsExpireAt) < new Date()) {
    console.log(`⏰ [deductCreditsTx] Expiring ${subscriptionCredits} subscription credits for user ${userId}`);
    subscriptionCredits = 0;
    await tx.user.update({
      where: { id: userId },
      data: { subscriptionCredits: 0, creditsExpireAt: null },
    });
  }

  let purchasedCredits = currentUser.purchasedCredits || 0;
  let legacyCredits = currentUser.credits || 0;

  const totalAvailable =
    subscriptionCredits + purchasedCredits + legacyCredits;

  if (totalAvailable < amount) {
    throw new Error(
      `Insufficient credits. Need ${amount}, have ${totalAvailable}`,
    );
  }

  let subscriptionDeduction = 0;
  let purchasedDeduction = 0;
  let legacyDeduction = 0;
  let remaining = amount;

  if (purchasedCredits >= remaining) {
    purchasedDeduction = remaining;
    remaining = 0;
  } else {
    purchasedDeduction = purchasedCredits;
    remaining -= purchasedCredits;
  }

  if (remaining > 0) {
    if (legacyCredits >= remaining) {
      legacyDeduction = remaining;
      remaining = 0;
    } else {
      legacyDeduction = legacyCredits;
      remaining -= legacyCredits;
    }
  }

  if (remaining > 0) {
    subscriptionDeduction = remaining;
    remaining = 0;
  }

  console.log(
    `💳 Deducting ${amount} credits: ${purchasedDeduction} from purchased, ${legacyDeduction} from legacy/admin, ${subscriptionDeduction} from subscription`,
  );

  const newSubscription = Math.max(0, subscriptionCredits - subscriptionDeduction);
  const newPurchased = Math.max(0, purchasedCredits - purchasedDeduction);
  const newLegacy = Math.max(0, legacyCredits - legacyDeduction);

  const updatedUser = await tx.user.update({
    where: { id: userId },
    data: {
      subscriptionCredits: newSubscription,
      purchasedCredits: newPurchased,
      credits: newLegacy,
      totalCreditsUsed: { increment: amount },
    },
  });

  console.log(`✅ DB update complete. New purchasedCredits: ${updatedUser.purchasedCredits}`);

  return updatedUser;
}

/**
 * Refund credits to user account (ATOMIC, with retry)
 * Adds back to purchasedCredits (never expire).
 * Floors totalCreditsUsed at 0 so it never goes negative.
 */
export async function refundCredits(userId, amount) {
  if (amount <= 0) {
    throw new Error("Amount must be positive");
  }

  console.log(`💰 Refunding ${amount} credits to user ${userId}`);

  return await withRetry(
    () =>
      prisma.$transaction(async (tx) => {
        const current = await tx.user.findUnique({
          where: { id: userId },
          select: { totalCreditsUsed: true },
        });

        if (!current) throw new Error(`User ${userId} not found for refund`);

        const safeDecrement = Math.min(amount, Math.max(0, current.totalCreditsUsed || 0));

        return await tx.user.update({
          where: { id: userId },
          data: {
            purchasedCredits: { increment: amount },
            totalCreditsUsed: { decrement: safeDecrement },
          },
        });
      }, { timeout: 60000 }),
    { attempts: 3, delayMs: 1000, label: `refundCredits(${userId}, ${amount})` },
  );
}

/**
 * Refund generation and mark as refunded (prevents double refunds)
 * ATOMIC operation with retry to survive transient pool exhaustion
 * @param {string} generationId - Generation record ID
 * @returns {Promise<number>} Amount refunded (0 if already refunded)
 */
export async function refundGeneration(generationId) {
  return await withRetry(
    () =>
      prisma.$transaction(async (tx) => {
        const generation = await tx.generation.findUnique({
          where: { id: generationId },
          select: { id: true, userId: true, creditsCost: true, creditsRefunded: true },
        });

        if (!generation) {
          console.warn(`⚠️ Generation ${generationId} not found, skipping refund`);
          return 0;
        }

        const claimed = await tx.generation.updateMany({
          where: { id: generationId, creditsRefunded: false },
          data: { creditsRefunded: true },
        });
        if (claimed.count === 0) {
          console.log(`⏭️ Generation ${generationId} already refunded, skipping`);
          return 0;
        }

        const amount = generation.creditsCost;

        if (!amount || amount <= 0) {
          console.warn(`⚠️ Generation ${generationId} has no creditsCost (${amount}), marking refunded anyway`);
          return 0;
        }

        const currentUser = await tx.user.findUnique({
          where: { id: generation.userId },
          select: { totalCreditsUsed: true },
        });
        const safeDecrement = Math.min(amount, Math.max(0, currentUser?.totalCreditsUsed || 0));

        await tx.user.update({
          where: { id: generation.userId },
          data: {
            purchasedCredits: { increment: amount },
            totalCreditsUsed: { decrement: safeDecrement },
          },
        });

        console.log(`💰 Refunded ${amount} credits for generation ${generationId}`);
        return amount;
      }, { timeout: 60000 }),
    { attempts: 3, delayMs: 1000, label: `refundGeneration(${generationId})` },
  );
}

export async function awardFirstPaidModelCompletionBonus(userId, modelId) {
  const BONUS_CREDITS = 250;
  if (!userId || !modelId) return 0;

  return await prisma.$transaction(async (tx) => {
    const existingBonus = await tx.creditTransaction.findFirst({
      where: { userId, type: "first_paid_model_completion_bonus" },
      select: { id: true },
    });
    if (existingBonus) return 0;

    const model = await tx.savedModel.findUnique({
      where: { id: modelId },
      select: { id: true, userId: true, status: true, paymentIntentId: true },
    });
    if (!model || model.userId !== userId) return 0;
    if (model.status !== "ready") return 0;
    if (!model.paymentIntentId) return 0;

    await tx.user.update({
      where: { id: userId },
      data: { purchasedCredits: { increment: BONUS_CREDITS } },
    });
    await tx.creditTransaction.create({
      data: {
        userId,
        amount: BONUS_CREDITS,
        type: "first_paid_model_completion_bonus",
        description: `First completed paid model bonus - ${BONUS_CREDITS} free credits`,
      },
    });

    console.log(`🎁 Awarded ${BONUS_CREDITS} credits to user ${userId} for first completed paid model`);
    return BONUS_CREDITS;
  });
}
