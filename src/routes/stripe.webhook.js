import express from "express";
import Stripe from "stripe";
import prisma from "../lib/prisma.js";
import {
  inferSubscriptionPlanFromAmount,
  inferSubscriptionCreditsFromAmount,
  normalizeCreditUnits,
  resolveSubscriptionBillingCycle,
} from "../utils/creditUnits.js";
import { sendCreditPurchaseEmail, sendSpecialOfferConfirmationEmail } from "../services/email.service.js";
import { recordReferralCommissionFromPayment, linkReferrerOnFirstPurchase } from "../services/referral.service.js";
import { generateTwoPosesFromReference } from "../services/wavespeed.service.js";
import {
  awardFirstPaidModelCompletionBonus,
  rolloverSubPoolToPurchasedUpdate,
} from "../services/credit.service.js";
import {
  getChunkedString,
  parseSpecialOfferAiConfigFromMetadata,
} from "../lib/stripeMetadataChunk.js";

const router = express.Router();

/**
 * Stripe callback URL (webhook). Stripe calls this on every configured event.
 * On subscription rebill, Stripe sends invoice.payment_succeeded with subscription + invoice (tx) id;
 * we match the subscription to our user and assign plan renewal + credits.
 * See docs/STRIPE_WEBHOOK.md for URL, events, and env.
 */

// GET: describe the webhook endpoint (for ops/support; Stripe only POSTs)
router.get("/", (req, res) => {
  const base = req.protocol + "://" + req.get("host");
  res.json({
    callbackUrl: `${base}/api/stripe/webhook`,
    method: "POST",
    description: "Stripe calls this URL on payment events (e.g. rebill). We match user and assign plan renewal + credits.",
    eventsUsed: [
      "invoice.payment_succeeded",
      "checkout.session.completed",
      "payment_intent.succeeded",
      "customer.subscription.deleted",
      "customer.subscription.updated",
      "charge.refunded",
    ],
    rebillEvent: "invoice.payment_succeeded",
  });
});

// Use TEST keys in development, LIVE keys in production
const stripeSecretKey =
  process.env.NODE_ENV === "production"
    ? process.env.STRIPE_SECRET_KEY
    : process.env.TESTING_STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  console.error("❌ Stripe secret key is not set");
}

console.log(
  `🔑 Webhook using ${process.env.NODE_ENV === "production" ? "LIVE" : "TEST"} Stripe keys`,
);

const stripe = new Stripe(stripeSecretKey || "sk_test_placeholder", {
  apiVersion: "2024-11-20.acacia",
});

async function finalizeSpecialOfferModelReady(modelId, updates = {}) {
  const model = await prisma.savedModel.update({
    where: { id: modelId },
    data: { ...updates, status: "ready" },
    select: { id: true, userId: true },
  });
  const awarded = await awardFirstPaidModelCompletionBonus(model.userId, model.id);
  return { model, awarded };
}

function inferRefundBucketFromTransaction(tx) {
  if (!tx) return "purchased";
  const description = (tx.description || "").toLowerCase();
  if (tx.type === "subscription" || description.includes("subscription")) {
    return "subscription";
  }
  return "purchased";
}

/** Align subscription pool expiry with Stripe's invoice period when present (avoids webhook-delay drift). */
function subscriptionCreditsExpireAtFromInvoice(invoice, billingCycle) {
  const periodEndSec = invoice?.lines?.data?.[0]?.period?.end ?? invoice?.period_end;
  if (periodEndSec && typeof periodEndSec === "number") {
    const d = new Date(periodEndSec * 1000);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const fallback = new Date();
  if (billingCycle === "annual") {
    fallback.setFullYear(fallback.getFullYear() + 1);
  } else {
    fallback.setMonth(fallback.getMonth() + 1);
  }
  return fallback;
}

async function resolveRefundContextFromCharge(charge) {
  const candidateSessionIds = [];
  const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  if (paymentIntentId) {
    candidateSessionIds.push(paymentIntentId);
    try {
      const sessions = await stripe.checkout.sessions.list({
        payment_intent: paymentIntentId,
        limit: 1,
      });
      if (sessions.data[0]?.id) {
        candidateSessionIds.push(sessions.data[0].id);
      }
    } catch (error) {
      console.warn("⚠️ Could not resolve checkout session for payment intent:", paymentIntentId, error.message);
    }
  }

  if (candidateSessionIds.length > 0) {
    const tx = await prisma.creditTransaction.findFirst({
      where: {
        paymentSessionId: { in: candidateSessionIds },
        amount: { gt: 0 },
      },
      orderBy: { createdAt: "desc" },
    });

    if (tx) {
      return {
        userId: tx.userId,
        originalCredits: tx.amount,
        bucket: inferRefundBucketFromTransaction(tx),
        sourceKey: tx.paymentSessionId,
      };
    }
  }

  const invoiceId = typeof charge.invoice === "string" ? charge.invoice : null;
  if (invoiceId) {
    try {
      const invoice = await stripe.invoices.retrieve(invoiceId);
      const subscriptionId =
        typeof invoice.subscription === "string" ? invoice.subscription : null;
      const stripeCustomerId =
        typeof charge.customer === "string"
          ? charge.customer
          : typeof invoice.customer === "string"
            ? invoice.customer
            : null;

      if (subscriptionId && stripeCustomerId) {
        const [subscription, user] = await Promise.all([
          stripe.subscriptions.retrieve(subscriptionId),
          prisma.user.findFirst({ where: { stripeCustomerId } }),
        ]);
        const originalCredits = normalizeCreditUnits(
          subscription.metadata?.credits,
        );
        if (user && originalCredits > 0) {
          return {
            userId: user.id,
            originalCredits,
            bucket: "subscription",
            sourceKey: `invoice:${invoiceId}`,
          };
        }
      }
    } catch (error) {
      console.warn("⚠️ Could not resolve invoice subscription refund context:", invoiceId, error.message);
    }
  }

  return null;
}

// Webhook to handle successful payments
// IMPORTANT: This route needs RAW body for signature verification
router.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      // Verify webhook signature
      if (process.env.STRIPE_WEBHOOK_SECRET) {
        event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET,
        );
        console.log("✅ Webhook signature verified");
      } else if (process.env.NODE_ENV === 'production') {
        // CRITICAL: In production, ALWAYS require webhook secret
        console.error("❌ FATAL: STRIPE_WEBHOOK_SECRET missing in production!");
        return res.status(500).send("Webhook configuration error");
      } else {
        // Development only: allow without signature (for testing)
        console.warn("⚠️ DEV MODE: Skipping webhook signature verification");
        event = JSON.parse(req.body.toString());
      }
    } catch (err) {
      console.error("❌ Webhook signature verification failed:", err.message);
      return res.status(400).send("Webhook signature verification failed");
    }

    console.log(`📨 Received webhook event: ${event.type}`);

    // Handle the event
    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          const { userId, credits, tierId, type, billingCycle } =
            session.metadata;

          // Guardrail: never grant credits from checkout completion unless Stripe marks it paid.
          // First-cycle/renewal safety nets (payment_intent/invoice events) handle delayed confirmations.
          const sessionPaymentStatus = String(session.payment_status || "").toLowerCase();
          if (sessionPaymentStatus !== "paid") {
            console.warn(
              `⚠️ checkout.session.completed ${session.id} is ${sessionPaymentStatus || "unknown"}; skipping credit grant until paid event`,
            );
            break;
          }

          if (!userId || !credits) {
            console.error(
              "❌ Missing metadata in checkout session:",
              session.metadata,
            );
            break;
          }

          let isNewTransaction = false;

          if (type === "one-time") {
            // One-time credit purchase (no subscription) - NEVER EXPIRE
            // Use atomic transaction with UNIQUE constraint to prevent race conditions
            try {
              await prisma.$transaction(async (tx) => {
                // Insert transaction with UNIQUE session ID (fails if duplicate)
                await tx.creditTransaction.create({
                  data: {
                    userId,
                    amount: normalizeCreditUnits(credits),
                    type: "purchase",
                    description: `One-time purchase: ${credits} credits`,
                    paymentSessionId: session.id, // UNIQUE constraint prevents duplicates
                  },
                });

                // Only add credits if transaction insert succeeded
                await tx.user.update({
                  where: { id: userId },
                  data: {
                    purchasedCredits: {
                      increment: normalizeCreditUnits(credits), // Add to purchased credits (never expire)
                    },
                  },
                });
              });

              isNewTransaction = true;
              console.log(
                `✅ One-time purchase for user ${userId}: +${credits} purchased credits (never expire)`,
              );
              const sessionReferrerId = session.metadata?.referrerUserId || null;
              if (sessionReferrerId) await linkReferrerOnFirstPurchase(userId, sessionReferrerId);
              await recordReferralCommissionFromPayment({
                referredUserId: userId,
                purchaseAmountCents: session.amount_total || 0,
                sourceType: "stripe_checkout_session",
                sourceId: session.id,
              });

              // Send confirmation email (idempotent - check if already sent)
              const user = await prisma.user.findUnique({
                where: { id: userId },
              });
              if (user) {
                // Find the transaction for this session to check email status
                const transaction = await prisma.creditTransaction.findUnique({
                  where: { paymentSessionId: session.id },
                });

                if (transaction && !transaction.emailSentAt) {
                  const amount = session.amount_total / 100; // Convert from cents
                  try {
                    const emailResult = await sendCreditPurchaseEmail(
                      user.email,
                      normalizeCreditUnits(credits),
                      amount,
                      "one-time",
                      null,
                      session.id,
                    );

                    if (emailResult.success) {
                      // Mark email as sent
                      await prisma.creditTransaction.update({
                        where: { id: transaction.id },
                        data: { emailSentAt: new Date() },
                      });
                      console.log(
                        `📧 Confirmation email sent to ${user.email}`,
                      );
                    } else {
                      console.error(
                        `⚠️ Failed to send confirmation email to ${user.email}:`,
                        emailResult.error,
                      );
                    }
                  } catch (emailError) {
                    console.error(
                      `⚠️ Email send error for ${user.email}:`,
                      emailError,
                    );
                    // Don't fail webhook - credits already awarded
                  }
                } else if (transaction?.emailSentAt) {
                  console.log(
                    `📧 Email already sent for session ${session.id} at ${transaction.emailSentAt}`,
                  );
                }
              }
            } catch (error) {
              // If unique constraint violation, payment already processed
              if (error.code === "P2002") {
                console.log(
                  `✅ One-time purchase already processed for session ${session.id}`,
                );
              } else {
                throw error; // Re-throw other errors
              }
            }
          } else {
            // Subscription purchase
            const subscriptionId = session.subscription;
            const idempotencyKey =
              typeof subscriptionId === "string" && subscriptionId
                ? subscriptionId
                : session.id;

            // Check if user has an old subscription (this is an upgrade)
            const userBefore = await prisma.user.findUnique({
              where: { id: userId },
            });

            let oldSubscriptionId = null;
            if (
              userBefore &&
              userBefore.stripeSubscriptionId &&
              userBefore.stripeSubscriptionId !== subscriptionId
            ) {
              oldSubscriptionId = userBefore.stripeSubscriptionId;
              console.log(
                `🚀 UPGRADE: User had ${userBefore.subscriptionTier}, upgrading to ${tierId}`,
              );
              console.log(
                `📝 Old subscription to cancel: ${oldSubscriptionId}`,
              );
            }

            // Use atomic transaction with UNIQUE constraint to prevent race conditions
            try {
              await prisma.$transaction(async (tx) => {
                // Insert transaction with UNIQUE session ID (fails if duplicate)
                await tx.creditTransaction.create({
                  data: {
                    userId,
                    amount: normalizeCreditUnits(credits),
                    type: "purchase",
                    description: `Subscription: ${tierId} plan`,
                    paymentSessionId: idempotencyKey, // aligns with subscription lifecycle idempotency
                  },
                });

                // Calculate credit expiration date
                const now = new Date();
                const creditsExpireAt = new Date(now);
                if (billingCycle === "annual") {
                  creditsExpireAt.setFullYear(
                    creditsExpireAt.getFullYear() + 1,
                  );
                } else {
                  creditsExpireAt.setMonth(creditsExpireAt.getMonth() + 1);
                }

                const priorSub = await tx.user.findUnique({
                  where: { id: userId },
                  select: { subscriptionCredits: true },
                });
                const rollover = rolloverSubPoolToPurchasedUpdate(priorSub?.subscriptionCredits);
                if (Object.keys(rollover).length) {
                  console.log(
                    `💾 Plan change / new sub (checkout webhook): rolling ${priorSub?.subscriptionCredits || 0} subscription credits → purchased before new grant`,
                  );
                }

                // Only update user if transaction insert succeeded
                await tx.user.update({
                  where: { id: userId },
                  data: {
                    ...rollover,
                    stripeSubscriptionId: subscriptionId,
                    subscriptionTier: tierId,
                    subscriptionStatus: "active",
                    subscriptionBillingCycle: billingCycle || "monthly",
                    subscriptionCredits: normalizeCreditUnits(credits), // Subscription credits (expire)
                    creditsExpireAt, // Expiration date
                    maxModels: 999, // Unlimited models for all paid tiers
                  },
                });
              });

              isNewTransaction = true;
              console.log(
                `✅ Subscription created for user ${userId}: +${credits} credits (${tierId})`,
              );
              // For subscriptions, session.amount_total is often null at checkout.session.completed
              // time because Stripe hasn't collected the first payment yet.
              // Resolve the real amount from the subscription's latest invoice instead.
              let subscriptionAmountCents = session.amount_total || 0;
              if (!subscriptionAmountCents && session.subscription) {
                try {
                  const subForAmount = await stripe.subscriptions.retrieve(
                    typeof session.subscription === "string" ? session.subscription : session.subscription.id,
                    { expand: ["latest_invoice"] }
                  );
                  subscriptionAmountCents = subForAmount.latest_invoice?.amount_paid
                    || subForAmount.latest_invoice?.amount_due
                    || 0;
                } catch (amtErr) {
                  console.warn(`⚠️ Could not resolve subscription amount for referral commission: ${amtErr.message}`);
                }
              }
              const sessionReferrerId = session.metadata?.referrerUserId || null;
              if (sessionReferrerId) await linkReferrerOnFirstPurchase(userId, sessionReferrerId);
              await recordReferralCommissionFromPayment({
                referredUserId: userId,
                purchaseAmountCents: subscriptionAmountCents,
                sourceType: "stripe_checkout_session",
                sourceId: session.id,
              });

              // Send confirmation email (idempotent - check if already sent)
              const user = await prisma.user.findUnique({
                where: { id: userId },
              });
              if (user) {
                // Find the transaction for this session to check email status
                const transaction = await prisma.creditTransaction.findUnique({
                  where: { paymentSessionId: idempotencyKey },
                });

                if (transaction && !transaction.emailSentAt) {
                  const amount = session.amount_total / 100; // Convert from cents
                  const tierName =
                    tierId.charAt(0).toUpperCase() + tierId.slice(1) + " Plan";
                  try {
                    const emailResult = await sendCreditPurchaseEmail(
                      user.email,
                      normalizeCreditUnits(credits),
                      amount,
                      "subscription",
                      tierName,
                      session.id,
                    );

                    if (emailResult.success) {
                      // Mark email as sent
                      await prisma.creditTransaction.update({
                        where: { id: transaction.id },
                        data: { emailSentAt: new Date() },
                      });
                      console.log(
                        `📧 Confirmation email sent to ${user.email}`,
                      );
                    } else {
                      console.error(
                        `⚠️ Failed to send confirmation email to ${user.email}:`,
                        emailResult.error,
                      );
                    }
                  } catch (emailError) {
                    console.error(
                      `⚠️ Email send error for ${user.email}:`,
                      emailError,
                    );
                    // Don't fail webhook - credits already awarded
                  }
                } else if (transaction?.emailSentAt) {
                  console.log(
                    `📧 Email already sent for session ${session.id} at ${transaction.emailSentAt}`,
                  );
                }
              }

              // NOW cancel the old subscription (AFTER new payment succeeded)
              if (oldSubscriptionId) {
                try {
                  await stripe.subscriptions.cancel(oldSubscriptionId);
                  console.log(
                    `✅ Cancelled old subscription ${oldSubscriptionId} after successful upgrade`,
                  );
                } catch (cancelError) {
                  console.error(
                    `⚠️ Failed to cancel old subscription ${oldSubscriptionId}:`,
                    cancelError.message,
                  );
                  // Don't fail the webhook - the new subscription is already active
                  // This will need manual cleanup, but user has the new subscription
                }
              }
            } catch (error) {
              // If unique constraint violation, payment already processed
              if (error.code === "P2002") {
                console.log(
                  `✅ Subscription already processed for session ${session.id}`,
                );
              } else {
                throw error; // Re-throw other errors
              }
            }
          }

          if (isNewTransaction) {
            const discountCodeId = session.metadata?.discountCodeId;
            if (discountCodeId) {
              try {
                await prisma.discountCode.update({
                  where: { id: discountCodeId },
                  data: { currentUses: { increment: 1 } },
                });
                console.log(`🏷️ Discount code usage incremented (webhook checkout.session.completed): ${discountCodeId}`);
              } catch (dcErr) {
                console.warn('⚠️ Failed to increment discount code usage in webhook (non-fatal):', dcErr.message);
              }
            }
          }
          break;
        }

        case "payment_intent.succeeded": {
          const paymentIntent = event.data.object;
          const { userId, credits, type, tierId, billingCycle } = paymentIntent.metadata;

          // Handle special offer fulfillment as webhook safety net
          if (type === 'special-offer-ai-model') {
            if (!userId) {
              console.error('❌ Missing userId in special offer payment intent:', paymentIntent.id);
              break;
            }

            const existingTx = await prisma.creditTransaction.findFirst({
              where: { paymentSessionId: paymentIntent.id }
            });
            if (existingTx) {
              console.log(`✅ Special offer already fulfilled for ${paymentIntent.id} — webhook skipping`);
              break;
            }

            console.log(`🎁 Webhook safety net: Fulfilling special offer for user ${userId}, PI: ${paymentIntent.id}`);
            const referenceUrl = getChunkedString(paymentIntent.metadata, 'referenceUrl');
            const aiConfig = parseSpecialOfferAiConfigFromMetadata(paymentIntent.metadata);
            const bonusCredits = parseInt(paymentIntent.metadata.bonusCredits || '250');
            const modelName = aiConfig.modelName || 'My AI Model';
            const photo1Url = referenceUrl;

            try {
              const result = await prisma.$transaction(async (tx) => {
                await tx.creditTransaction.create({
                  data: {
                    userId,
                    amount: 0,
                    type: 'special_offer_model_fulfillment',
                    description: 'Special Offer: AI Model fulfillment',
                    paymentSessionId: paymentIntent.id
                  }
                });

                const model = await tx.savedModel.create({
                  data: {
                    userId,
                    name: modelName,
                    photo1Url,
                    photo2Url: photo1Url,
                    photo3Url: photo1Url,
                    thumbnail: photo1Url,
                    status: 'generating',
                    paymentIntentId: paymentIntent.id,
                  }
                });

                await tx.user.update({
                  where: { id: userId },
                  data: {
                    onboardingCompleted: true,
                    hasUsedFreeTrial: true
                  }
                });

                return { model };
              });

              console.log(`✅ Webhook fulfilled special offer: model ${result.model.id} created for user ${userId}`);

              const piReferrerId = paymentIntent.metadata?.referrerUserId || null;
              if (piReferrerId) await linkReferrerOnFirstPurchase(userId, piReferrerId);
              await recordReferralCommissionFromPayment({
                referredUserId: userId,
                purchaseAmountCents: paymentIntent.amount_received || paymentIntent.amount || 0,
                sourceType: "stripe_payment_intent",
                sourceId: paymentIntent.id,
              });

              try {
                const userRecord = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
                if (userRecord?.email) {
                  await sendSpecialOfferConfirmationEmail({
                    to: userRecord.email,
                    name: userRecord.name || 'there',
                    modelName,
                    creditsAwarded: bonusCredits,
                  });
                }
              } catch (emailError) {
                console.error('⚠️ Failed to send special offer confirmation email:', emailError.message);
              }

              generateTwoPosesFromReference(referenceUrl, {
                outfitType: aiConfig?.style || 'casual',
                poseStyle: aiConfig?.poseStyle || 'natural'
              }).then(async (posesResult) => {
                try {
                  if (posesResult.success && posesResult.photos) {
                    const readyResult = await finalizeSpecialOfferModelReady(result.model.id, {
                      photo2Url: posesResult.photos.photo2Url || photo1Url,
                      photo3Url: posesResult.photos.photo3Url || photo1Url,
                    });
                    console.log(`🎁 Special offer completion bonus awarded: ${readyResult.awarded}`);
                  } else {
                    const readyResult = await finalizeSpecialOfferModelReady(result.model.id);
                    console.log(`🎁 Special offer completion bonus awarded: ${readyResult.awarded}`);
                  }
                } catch (e) {
                  console.error('❌ Webhook pose update failed:', e.message);
                }
              }).catch(() => {
                finalizeSpecialOfferModelReady(result.model.id).catch(console.error);
              });
            } catch (error) {
              if (error.code === 'P2002') {
                console.log(`✅ Special offer already processed for ${paymentIntent.id} (P2002)`);
              } else {
                console.error('❌ Webhook special offer fulfillment failed:', error.message);
              }
            }
            break;
          }

          if (!type || (!type.includes('embedded'))) {
            // Fallback for hosted Stripe Checkout flows:
            // some deployments/processes may miss checkout.session.completed,
            // but payment_intent.succeeded still fires reliably.
            // In that case, resolve the Checkout Session from this PI and award credits here.
            try {
              const sessions = await stripe.checkout.sessions.list({
                payment_intent: paymentIntent.id,
                limit: 1,
              });
              const checkoutSession = sessions.data?.[0] || null;
              const meta = checkoutSession?.metadata || {};
              const checkoutUserId = meta.userId;
              const checkoutCredits = normalizeCreditUnits(meta.credits || "0");
              const checkoutType = meta.type; // "one-time" for one-time packs; subscriptions usually have no type
              const checkoutTierId = meta.tierId;
              const checkoutBillingCycle = meta.billingCycle;

              if (!checkoutSession || !checkoutUserId || !checkoutCredits) {
                console.log(`ℹ️ PI ${paymentIntent.id}: no linked checkout session credits to process`);
                break;
              }

              let isNewTransaction = false;

              if (checkoutType === "one-time") {
                try {
                  await prisma.$transaction(async (tx) => {
                    await tx.creditTransaction.create({
                      data: {
                        userId: checkoutUserId,
                        amount: checkoutCredits,
                        type: "purchase",
                        description: `One-time purchase (PI fallback): ${checkoutCredits} credits`,
                        paymentSessionId: checkoutSession.id,
                      },
                    });

                    await tx.user.update({
                      where: { id: checkoutUserId },
                      data: {
                        purchasedCredits: { increment: checkoutCredits },
                      },
                    });
                  });
                  isNewTransaction = true;
                  console.log(`✅ PI fallback credited one-time purchase for user ${checkoutUserId}: +${checkoutCredits}`);
                } catch (fallbackErr) {
                  if (fallbackErr.code === "P2002") {
                    console.log(`✅ PI fallback one-time already processed for session ${checkoutSession.id}`);
                  } else {
                    throw fallbackErr;
                  }
                }
              } else {
                const subscriptionId =
                  typeof checkoutSession.subscription === "string" && checkoutSession.subscription
                    ? checkoutSession.subscription
                    : checkoutSession.id;

                try {
                  await prisma.$transaction(async (tx) => {
                    await tx.creditTransaction.create({
                      data: {
                        userId: checkoutUserId,
                        amount: checkoutCredits,
                        type: "purchase",
                        description: `Subscription (PI fallback): ${checkoutTierId || "plan"}`,
                        paymentSessionId: subscriptionId,
                      },
                    });

                    const now = new Date();
                    const creditsExpireAt = new Date(now);
                    if (checkoutBillingCycle === "annual") {
                      creditsExpireAt.setFullYear(creditsExpireAt.getFullYear() + 1);
                    } else {
                      creditsExpireAt.setMonth(creditsExpireAt.getMonth() + 1);
                    }

                    const priorSubPi = await tx.user.findUnique({
                      where: { id: checkoutUserId },
                      select: { subscriptionCredits: true },
                    });
                    const rolloverPi = rolloverSubPoolToPurchasedUpdate(priorSubPi?.subscriptionCredits);
                    if (Object.keys(rolloverPi).length) {
                      console.log(
                        `💾 PI→checkout fallback sub: rolling ${priorSubPi?.subscriptionCredits || 0} subscription credits → purchased`,
                      );
                    }

                    const updateData = {
                      ...rolloverPi,
                      subscriptionTier: checkoutTierId || null,
                      subscriptionStatus: "active",
                      subscriptionBillingCycle: checkoutBillingCycle || "monthly",
                      subscriptionCredits: checkoutCredits,
                      creditsExpireAt,
                      maxModels: 999,
                    };

                    if (typeof checkoutSession.subscription === "string" && checkoutSession.subscription) {
                      updateData.stripeSubscriptionId = checkoutSession.subscription;
                    }

                    await tx.user.update({
                      where: { id: checkoutUserId },
                      data: updateData,
                    });
                  });
                  isNewTransaction = true;
                  console.log(`✅ PI fallback credited subscription for user ${checkoutUserId}: +${checkoutCredits}`);
                } catch (fallbackErr) {
                  if (fallbackErr.code === "P2002") {
                    console.log(`✅ PI fallback subscription already processed for ${subscriptionId}`);
                  } else {
                    throw fallbackErr;
                  }
                }
              }

              if (isNewTransaction) {
                const piReferrerId = meta.referrerUserId || null;
                if (piReferrerId) await linkReferrerOnFirstPurchase(checkoutUserId, piReferrerId);
                await recordReferralCommissionFromPayment({
                  referredUserId: checkoutUserId,
                  purchaseAmountCents: checkoutSession.amount_total || paymentIntent.amount_received || paymentIntent.amount || 0,
                  sourceType: "stripe_checkout_session",
                  sourceId: checkoutSession.id,
                });

                const fallbackDiscountCodeId = meta.discountCodeId;
                if (fallbackDiscountCodeId) {
                  try {
                    await prisma.discountCode.update({
                      where: { id: fallbackDiscountCodeId },
                      data: { currentUses: { increment: 1 } },
                    });
                    console.log(`🏷️ Discount code usage incremented (PI fallback): ${fallbackDiscountCodeId}`);
                  } catch (dcErr) {
                    console.warn("⚠️ Failed to increment discount code usage in PI fallback (non-fatal):", dcErr.message);
                  }
                }
              }
            } catch (fallbackOuterErr) {
              console.error(`❌ PI fallback checkout processing failed for ${paymentIntent.id}:`, fallbackOuterErr.message);
            }
            break;
          }

          if (!userId || !credits) {
            console.error("❌ Missing metadata in payment intent:", paymentIntent.metadata);
            break;
          }

          console.log(`💳 Processing embedded payment: ${type} for user ${userId}`);

          if (type === "one-time-embedded") {
            // One-time credit purchase via embedded checkout
            try {
              await prisma.$transaction(async (tx) => {
                // Insert transaction with UNIQUE payment intent ID
                await tx.creditTransaction.create({
                  data: {
                    userId,
                    amount: normalizeCreditUnits(credits),
                    type: "purchase",
                    description: `One-time purchase: ${credits} credits`,
                    paymentSessionId: paymentIntent.id,
                  },
                });

                await tx.user.update({
                  where: { id: userId },
                  data: {
                    purchasedCredits: {
                      increment: normalizeCreditUnits(credits),
                    },
                  },
                });
              });

              console.log(`✅ Embedded one-time purchase for user ${userId}: +${credits} purchased credits`);
              const piReferrerId = paymentIntent.metadata?.referrerUserId || null;
              if (piReferrerId) await linkReferrerOnFirstPurchase(userId, piReferrerId);
              await recordReferralCommissionFromPayment({
                referredUserId: userId,
                purchaseAmountCents: paymentIntent.amount_received || paymentIntent.amount || 0,
                sourceType: "stripe_payment_intent",
                sourceId: paymentIntent.id,
              });

              const piDiscountCodeId = paymentIntent.metadata?.discountCodeId;
              if (piDiscountCodeId) {
                try {
                  await prisma.discountCode.update({
                    where: { id: piDiscountCodeId },
                    data: { currentUses: { increment: 1 } },
                  });
                  console.log(`🏷️ Discount code usage incremented (PI webhook one-time-embedded): ${piDiscountCodeId}`);
                } catch (dcErr) {
                  console.warn('⚠️ Failed to increment discount code usage (non-fatal):', dcErr.message);
                }
              }
            } catch (error) {
              if (error.code === "P2002") {
                console.log(`✅ Embedded one-time already processed for ${paymentIntent.id}`);
              } else {
                throw error;
              }
            }
          } else if (type === "subscription-embedded") {
            // Subscription via embedded checkout — webhook safety net
            // Resolves the Stripe subscription ID from the payment intent's invoice
            let resolvedSubId = null;
            try {
              const invoiceId = paymentIntent.invoice;
              if (invoiceId) {
                const inv = typeof invoiceId === 'object' ? invoiceId : await stripe.invoices.retrieve(invoiceId);
                resolvedSubId = inv.subscription || null;
              }
            } catch (e) {
              console.warn('⚠️ Could not resolve subscription ID from PI invoice:', e.message);
            }

            // Cross-path idempotency: check if /confirm-subscription or invoice webhook
            // already awarded credits for this subscription (they use subscriptionId as paymentSessionId)
            if (resolvedSubId) {
              const existingTx = await prisma.creditTransaction.findUnique({
                where: { paymentSessionId: resolvedSubId },
              });
              if (existingTx) {
                console.log(`✅ Embedded subscription already processed by /confirm-subscription or invoice webhook for sub ${resolvedSubId} — PI webhook skipping`);
                break;
              }
            }

            try {
              const now = new Date();
              const creditsExpireAt = new Date(now);
              if (billingCycle === "annual") {
                creditsExpireAt.setFullYear(creditsExpireAt.getFullYear() + 1);
              } else {
                creditsExpireAt.setMonth(creditsExpireAt.getMonth() + 1);
              }

              // Use subscriptionId as paymentSessionId when available (matches /confirm-subscription)
              // to ensure cross-path idempotency via the UNIQUE constraint
              const idempotencyKey = resolvedSubId || paymentIntent.id;

              await prisma.$transaction(async (tx) => {
                await tx.creditTransaction.create({
                  data: {
                    userId,
                    amount: normalizeCreditUnits(credits),
                    type: "subscription",
                    description: `Subscription: ${tierId} plan — PI safety net`,
                    paymentSessionId: idempotencyKey,
                  },
                });

                const priorEmb = await tx.user.findUnique({
                  where: { id: userId },
                  select: { subscriptionCredits: true },
                });
                const rolloverEmb = rolloverSubPoolToPurchasedUpdate(priorEmb?.subscriptionCredits);
                if (Object.keys(rolloverEmb).length) {
                  console.log(
                    `💾 Embedded sub PI webhook: rolling ${priorEmb?.subscriptionCredits || 0} subscription credits → purchased`,
                  );
                }

                const updateData = {
                  ...rolloverEmb,
                  subscriptionTier: tierId,
                  subscriptionStatus: "active",
                  subscriptionBillingCycle: billingCycle || "monthly",
                  subscriptionCredits: normalizeCreditUnits(credits),
                  creditsExpireAt,
                  maxModels: 999,
                };
                if (resolvedSubId) {
                  updateData.stripeSubscriptionId = resolvedSubId;
                }

                await tx.user.update({
                  where: { id: userId },
                  data: updateData,
                });
              });

              console.log(`✅ Embedded subscription (PI safety net) for user ${userId}: +${credits} credits (${tierId}), sub=${resolvedSubId || 'unknown'}`);
              const piReferrerId = paymentIntent.metadata?.referrerUserId || null;
              if (piReferrerId) await linkReferrerOnFirstPurchase(userId, piReferrerId);
              await recordReferralCommissionFromPayment({
                referredUserId: userId,
                purchaseAmountCents: paymentIntent.amount_received || paymentIntent.amount || 0,
                sourceType: "stripe_payment_intent",
                sourceId: paymentIntent.id,
              });

              const piSubDiscountCodeId = paymentIntent.metadata?.discountCodeId;
              if (piSubDiscountCodeId) {
                try {
                  await prisma.discountCode.update({
                    where: { id: piSubDiscountCodeId },
                    data: { currentUses: { increment: 1 } },
                  });
                  console.log(`🏷️ Discount code usage incremented (PI webhook subscription-embedded): ${piSubDiscountCodeId}`);
                } catch (dcErr) {
                  console.warn('⚠️ Failed to increment discount code usage (non-fatal):', dcErr.message);
                }
              }
            } catch (error) {
              if (error.code === "P2002") {
                console.log(`✅ Embedded subscription already processed for ${resolvedSubId || paymentIntent.id}`);
              } else {
                throw error;
              }
            }
          }
          break;
        }

        case "invoice.payment_succeeded": {
          const invoice = event.data.object;
          // Normalize: webhook may send subscription as ID string or expanded object
          const subscriptionIdRaw = invoice.subscription;
          const subscriptionId =
            typeof subscriptionIdRaw === "string"
              ? subscriptionIdRaw
              : subscriptionIdRaw?.id ?? null;
          const billingReason = invoice.billing_reason || null;

          if (!subscriptionId) {
            console.warn("⚠️ invoice.payment_succeeded: missing subscription ID on invoice", invoice.id);
            break;
          }

          const stripeCustomerId =
            typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id || null;

          // Find user by subscription ID
          let user = await prisma.user.findFirst({
            where: { stripeSubscriptionId: subscriptionId },
          });

          // Fallback: if user not found by subscriptionId (first payment where
          // /confirm-subscription may have failed), look up via subscription metadata
          if (!user) {
            try {
              const subObj = await stripe.subscriptions.retrieve(subscriptionId);
              const metaUserId = subObj.metadata?.userId;
              if (metaUserId) {
                user = await prisma.user.findUnique({ where: { id: metaUserId } });
                if (user) {
                  console.log(`🔄 invoice.payment_succeeded: Found user ${metaUserId} via subscription metadata (stripeSubscriptionId not yet set)`);
                  // Set subscription details since /confirm-subscription never ran
                  const metaTierId = subObj.metadata?.tierId;
                  const metaBillingCycle = resolveSubscriptionBillingCycle(subObj);
                  const metaCredits = normalizeCreditUnits(subObj.metadata?.credits);

                  if (metaTierId && metaCredits && !user.stripeSubscriptionId) {
                    // Cross-path idempotency: check if /confirm-subscription or PI webhook already awarded
                    const existingTx = await prisma.creditTransaction.findUnique({
                      where: { paymentSessionId: subscriptionId },
                    });
                    if (existingTx) {
                      console.log(`✅ invoice.payment_succeeded: credits already awarded for sub ${subscriptionId} — skipping`);
                      break;
                    }

                    const creditsExpireAt = subscriptionCreditsExpireAtFromInvoice(
                      invoice,
                      metaBillingCycle || "monthly",
                    );

                    try {
                      await prisma.$transaction(async (tx) => {
                        // Use subscriptionId as paymentSessionId to match /confirm-subscription
                        // for cross-path idempotency via the UNIQUE constraint
                        await tx.creditTransaction.create({
                          data: {
                            userId: user.id,
                            amount: metaCredits,
                            type: "subscription",
                            description: `${metaTierId.charAt(0).toUpperCase() + metaTierId.slice(1)} subscription (${metaBillingCycle || "monthly"}) — invoice safety net`,
                            paymentSessionId: subscriptionId,
                          },
                        });

                        const priorInv = await tx.user.findUnique({
                          where: { id: user.id },
                          select: { subscriptionCredits: true },
                        });
                        const rolloverInv = rolloverSubPoolToPurchasedUpdate(priorInv?.subscriptionCredits);
                        if (Object.keys(rolloverInv).length) {
                          console.log(
                            `💾 Invoice safety net: rolling ${priorInv?.subscriptionCredits || 0} subscription credits → purchased`,
                          );
                        }

                        await tx.user.update({
                          where: { id: user.id },
                          data: {
                            ...rolloverInv,
                            stripeSubscriptionId: subscriptionId,
                            subscriptionTier: metaTierId,
                            subscriptionStatus: "active",
                            subscriptionBillingCycle: metaBillingCycle || "monthly",
                            subscriptionCredits: metaCredits,
                            creditsExpireAt,
                            maxModels: 999,
                          },
                        });
                      });

                      console.log(`✅ invoice.payment_succeeded safety net: awarded ${metaCredits} credits to user ${user.id} (${metaTierId})`);
                      const subReferrerId = subObj?.metadata?.referrerUserId || null;
                      if (subReferrerId) await linkReferrerOnFirstPurchase(user.id, subReferrerId);
                      await recordReferralCommissionFromPayment({
                        referredUserId: user.id,
                        purchaseAmountCents: invoice.amount_paid || 0,
                        sourceType: "stripe_invoice",
                        sourceId: invoice.id,
                      });
                    } catch (safetyErr) {
                      if (safetyErr.code === "P2002") {
                        console.log(`✅ Invoice ${invoice.id} already processed (safety net P2002)`);
                      } else {
                        console.error("❌ invoice.payment_succeeded safety net failed:", safetyErr.message);
                      }
                    }
                    break;
                  }
                }
              }

              if (!user && stripeCustomerId) {
                user = await prisma.user.findFirst({
                  where: { stripeCustomerId },
                });
                if (user) {
                  console.log(
                    `🔄 invoice.payment_succeeded: recovered user ${user.id} via stripeCustomerId for subscription ${subscriptionId}`,
                  );
                }
              }
            } catch (subLookupErr) {
              console.warn("⚠️ Could not retrieve subscription for invoice fallback:", subLookupErr.message);
            }
          }

          if (!user) {
            console.error(
              "❌ User not found for subscription:",
              subscriptionId,
            );
            break;
          }

          // Get subscription details to find credits amount
          const subscription =
            await stripe.subscriptions.retrieve(subscriptionId);
          const billingCycle = resolveSubscriptionBillingCycle(subscription);
          const billedAmountCents =
            invoice.subtotal_excluding_tax ||
            invoice.subtotal ||
            invoice.amount_paid ||
            invoice.amount_due ||
            0;
          const paidAmountCents = parseInt(String(invoice.amount_paid || 0), 10) || 0;

          // Guardrail: do not award credits on $0 invoices (e.g. full-discount/trial/no charge).
          // Requirement is to credit only after successful payment.
          if (paidAmountCents <= 0) {
            console.warn(
              `⚠️ invoice.payment_succeeded ${invoice.id} for sub ${subscriptionId} has amount_paid=${paidAmountCents}; skipping credit grant`,
            );
            break;
          }

          const inferredPlan = inferSubscriptionPlanFromAmount(
            billedAmountCents,
            billingCycle,
          );
          const resolvedTierId =
            subscription.metadata?.tierId || user.subscriptionTier || inferredPlan?.tierId || null;

          if (user.stripeSubscriptionId !== subscriptionId) {
            try {
              await prisma.user.update({
                where: { id: user.id },
                data: {
                  stripeSubscriptionId: subscriptionId,
                  subscriptionTier: resolvedTierId,
                  subscriptionBillingCycle: billingCycle,
                  subscriptionStatus: "active",
                },
              });
              user.stripeSubscriptionId = subscriptionId;
              user.subscriptionTier = resolvedTierId;
            } catch (repairErr) {
              console.warn(`⚠️ Failed to repair stripeSubscriptionId for user ${user.id}:`, repairErr.message);
            }
          }

          let credits = subscription.metadata?.credits;
          let parsedCredits = 0;

          if (billingReason === "subscription_cycle") {
            parsedCredits = inferSubscriptionCreditsFromAmount(
              billedAmountCents,
              billingCycle,
            );
            if (parsedCredits) {
              credits = String(parsedCredits);
              console.log(
                `🔄 invoice.payment_succeeded: mapped ${billedAmountCents} cents (${billingCycle}) to ${parsedCredits} credits for sub ${subscriptionId}`,
              );
            }
          }

          // Fallback: if metadata.credits missing (e.g. legacy subscription), use amount from first grant for this subscription
          if ((credits == null || credits === "") && !parsedCredits) {
            const firstGrant = await prisma.creditTransaction.findFirst({
              where: { paymentSessionId: subscriptionId, amount: { gt: 0 } },
              orderBy: { createdAt: "asc" },
            });
            if (firstGrant) {
              credits = String(firstGrant.amount);
              console.log(`🔄 invoice.payment_succeeded: no metadata.credits for ${subscriptionId}, using renewal amount from first grant: ${credits}`);
            }
          }

          if (credits != null && credits !== "") {
            // Prevent first-cycle double crediting when /confirm-subscription already
            // awarded credits with paymentSessionId=subscriptionId.
            if (billingReason === "subscription_create") {
              const initialGrantExists = await prisma.creditTransaction.findUnique({
                where: { paymentSessionId: subscriptionId },
              });
              if (initialGrantExists) {
                console.log(`✅ Initial subscription credits already granted for ${subscriptionId} — skipping invoice ${invoice.id}`);
                break;
              }
            }

            const existingRenewal = await prisma.creditTransaction.findFirst({
              where: { paymentSessionId: invoice.id },
            });
            if (existingRenewal) {
              console.log(`✅ Invoice ${invoice.id} already processed — skipping renewal`);
              break;
            }

            // Match checkout.session.completed / confirm-subscription: same scale as normalizeCreditUnits
            if (!parsedCredits) {
              parsedCredits = normalizeCreditUnits(credits);
            }
            if (!parsedCredits) {
              console.error(
                `⚠️ Invalid credits for invoice ${invoice.id}: "${credits}" (user ${user.id}, billed=${billedAmountCents}, cycle=${billingCycle})`,
              );
              break;
            }

            if (billingReason === "subscription_cycle") {
              console.log(`🔄 invoice.payment_succeeded: processing renewal for user ${user.id}, sub ${subscriptionId}, +${parsedCredits} credits`);
            }

            const creditsExpireAt = subscriptionCreditsExpireAtFromInvoice(invoice, billingCycle);

            try {
              await prisma.$transaction(async (tx) => {
                await tx.creditTransaction.create({
                  data: {
                    userId: user.id,
                    amount: parsedCredits,
                    type: "purchase",
                    description: `Subscription renewal: ${subscription.metadata?.tierId || "plan"}`,
                    paymentSessionId: invoice.id,
                  },
                });

                const priorRenewal = await tx.user.findUnique({
                  where: { id: user.id },
                  select: { subscriptionCredits: true },
                });
                const rolloverRenewal = rolloverSubPoolToPurchasedUpdate(priorRenewal?.subscriptionCredits);
                if (Object.keys(rolloverRenewal).length) {
                  console.log(
                    `💾 Renewal: rolling ${priorRenewal?.subscriptionCredits ?? 0} subscription credits → purchased`,
                  );
                }

                await tx.user.update({
                  where: { id: user.id },
                  data: {
                    ...rolloverRenewal,
                    stripeSubscriptionId: subscriptionId,
                    subscriptionTier: resolvedTierId,
                    subscriptionStatus: "active",
                    subscriptionBillingCycle: billingCycle,
                    subscriptionCredits: parsedCredits,
                    creditsExpireAt,
                  },
                });
              });

              console.log(
                `✅ Subscription renewed for user ${user.id}: ${parsedCredits} credits (${resolvedTierId || "unknown-tier"}, expire ${creditsExpireAt.toDateString()})`,
              );
              const subReferrerId = subscription?.metadata?.referrerUserId || null;
              if (subReferrerId) await linkReferrerOnFirstPurchase(user.id, subReferrerId);
              await recordReferralCommissionFromPayment({
                referredUserId: user.id,
                purchaseAmountCents: invoice.amount_paid || 0,
                sourceType: "stripe_invoice",
                sourceId: invoice.id,
              });
            } catch (txError) {
              if (txError.code === "P2002") {
                console.log(`✅ Invoice ${invoice.id} already processed (P2002) — skipping`);
              } else {
                throw txError;
              }
            }
          } else {
            console.error(
              `❌ invoice.payment_succeeded: no credits for subscription ${subscriptionId} (invoice ${invoice.id}, user ${user.id}, billing_reason=${billingReason}, billed=${billedAmountCents}, tier=${resolvedTierId || "unknown"}). Check subscription metadata or first grant.`,
            );
          }
          break;
        }

        case "customer.subscription.deleted": {
          const subscription = event.data.object;

          const user = await prisma.user.findFirst({
            where: { stripeSubscriptionId: subscription.id },
          });

          if (user) {
            await prisma.user.update({
              where: { id: user.id },
              data: {
                subscriptionStatus: "cancelled",
                stripeSubscriptionId: null,
                subscriptionTier: null,
                subscriptionBillingCycle: null,
                subscriptionCredits: 0,
                creditsExpireAt: null,
                subscriptionCancelledAt: new Date(),
              },
            });

            console.log(`❌ Subscription cancelled for user ${user.id}; subscription credits wiped`);
          }
          break;
        }

        case "customer.subscription.updated": {
          const subscription = event.data.object;
          const billingCycle = resolveSubscriptionBillingCycle(subscription);
          const stripeCustomerId =
            typeof subscription.customer === "string"
              ? subscription.customer
              : subscription.customer?.id || null;
          const activeStatuses = new Set(["active", "trialing", "past_due"]);
          // Do not treat `paused` (e.g. pause collection) like cancellation — wiping credits there was incorrect.
          const inactiveStatuses = new Set(["canceled", "unpaid", "incomplete_expired"]);

          if (activeStatuses.has(subscription.status)) {
            let user = await prisma.user.findFirst({
              where: { stripeSubscriptionId: subscription.id },
            });

            if (!user) {
              const metadataUserId = subscription.metadata?.userId || null;
              if (metadataUserId) {
                user = await prisma.user.findUnique({ where: { id: metadataUserId } });
              }
            }

            if (!user && stripeCustomerId) {
              user = await prisma.user.findFirst({
                where: { stripeCustomerId },
              });
            }

            if (user) {
              await prisma.user.update({
                where: { id: user.id },
                data: {
                  stripeSubscriptionId: subscription.id,
                  subscriptionTier: subscription.metadata?.tierId || user.subscriptionTier,
                  subscriptionBillingCycle: billingCycle,
                  subscriptionStatus: subscription.status === "past_due" ? "active" : subscription.status,
                },
              });

              console.log(
                `🔄 Subscription sync repaired for user ${user.id}: ${subscription.id} (${subscription.status})`,
              );
            }
            break;
          }

          if (!inactiveStatuses.has(subscription.status)) {
            break;
          }

          const user = await prisma.user.findFirst({
            where: { stripeSubscriptionId: subscription.id },
          });

          if (user) {
            await prisma.user.update({
              where: { id: user.id },
              data: {
                subscriptionStatus: "cancelled",
                stripeSubscriptionId: null,
                subscriptionTier: null,
                subscriptionBillingCycle: null,
                subscriptionCredits: 0,
                creditsExpireAt: null,
                subscriptionCancelledAt: new Date(),
              },
            });

            console.log(
              `⚠️ Subscription moved to ${subscription.status} for user ${user.id}; subscription credits wiped`,
            );
          }
          break;
        }

        case "charge.refunded": {
          const charge = event.data.object;
          const totalChargedCents = charge.amount || 0;
          const totalRefundedCents = charge.amount_refunded || 0;

          if (totalChargedCents <= 0 || totalRefundedCents <= 0) {
            break;
          }

          const context = await resolveRefundContextFromCharge(charge);
          if (!context) {
            console.warn("⚠️ Unable to map refund to a credit purchase context for charge:", charge.id);
            break;
          }

          const { userId, originalCredits, bucket, sourceKey } = context;
          const targetCreditsFromRefund = Math.min(
            originalCredits,
            Math.round((originalCredits * totalRefundedCents) / totalChargedCents),
          );

          const marker = `stripe_refund_for:${sourceKey}:`;
          const priorRefundDebits = await prisma.creditTransaction.findMany({
            where: {
              userId,
              type: "refund",
              amount: { lt: 0 },
              description: { startsWith: marker },
            },
            select: { amount: true },
          });
          const alreadyDebitedCredits = priorRefundDebits.reduce(
            (sum, tx) => sum + Math.abs(tx.amount || 0),
            0,
          );

          const creditsToDebitNow = targetCreditsFromRefund - alreadyDebitedCredits;
          if (creditsToDebitNow <= 0) {
            console.log(
              `ℹ️ Refund already reconciled for ${sourceKey} (target=${targetCreditsFromRefund}, already=${alreadyDebitedCredits})`,
            );
            break;
          }

          try {
            await prisma.$transaction(async (tx) => {
              const data =
                bucket === "subscription"
                  ? { subscriptionCredits: { decrement: creditsToDebitNow } }
                  : { purchasedCredits: { decrement: creditsToDebitNow } };

              await tx.user.update({
                where: { id: userId },
                data,
              });

              await tx.creditTransaction.create({
                data: {
                  userId,
                  amount: -creditsToDebitNow,
                  type: "refund",
                  description:
                    `${marker} debited=${creditsToDebitNow} (refund ${totalRefundedCents}/${totalChargedCents} cents, charge=${charge.id})`,
                  paymentSessionId: `stripe_refund_event_${event.id}`,
                },
              });

              // Floor credits at 0 to prevent negative balances
              if (bucket === "subscription") {
                await tx.user.updateMany({
                  where: { id: userId, subscriptionCredits: { lt: 0 } },
                  data: { subscriptionCredits: 0 },
                });
              } else {
                await tx.user.updateMany({
                  where: { id: userId, purchasedCredits: { lt: 0 } },
                  data: { purchasedCredits: 0 },
                });
              }
            });
          } catch (refundTxErr) {
            if (refundTxErr.code === "P2002") {
              console.log(`✅ Refund event ${event.id} already processed (P2002) — skipping`);
              break;
            }
            throw refundTxErr;
          }

          console.log(
            `💸 Processed Stripe refund for user ${userId}: -${creditsToDebitNow} ${bucket} credits (${totalRefundedCents}/${totalChargedCents} cents refunded)`,
          );

          try {
            const commissions = await prisma.referralCommission.findMany({
              where: { referredUserId: userId },
            });

            for (const commission of commissions) {
              const clawbackMarker = `referral_clawback:${commission.id}:${charge.id}`;
              const existingForCharge = await prisma.creditTransaction.findMany({
                where: {
                  userId: commission.referrerUserId,
                  description: { startsWith: clawbackMarker },
                },
                select: { description: true },
              });
              const alreadyClawedForCharge = existingForCharge.reduce((sum, tx) => {
                const match = String(tx.description || "").match(/clawed back (\d+) cents/i);
                return sum + (match ? parseInt(match[1], 10) || 0 : 0);
              }, 0);
              const originalCommissionForCharge =
                (commission.commissionCents || 0) + alreadyClawedForCharge;
              const targetClawbackForCharge = Math.round(
                (originalCommissionForCharge * totalRefundedCents) / totalChargedCents,
              );
              const clawbackCents = targetClawbackForCharge - alreadyClawedForCharge;
              if (clawbackCents <= 0) continue;

              await prisma.$transaction(async (tx) => {
                await tx.referralCommission.update({
                  where: { id: commission.id },
                  data: { commissionCents: { decrement: clawbackCents } },
                });

                await tx.creditTransaction.create({
                  data: {
                    userId: commission.referrerUserId,
                    amount: 0,
                    type: "refund",
                    description: `${clawbackMarker} clawed back ${clawbackCents} cents from referral commission (refund on charge ${charge.id})`,
                    paymentSessionId: `referral_clawback_${commission.id}_${event.id}`,
                  },
                });
              });

              console.log(
                `🔄 Clawed back ${clawbackCents} cents from referral commission ${commission.id} (referrer=${commission.referrerUserId})`,
              );
            }
          } catch (clawbackErr) {
            console.warn("⚠️ Referral commission clawback failed:", clawbackErr.message);
          }

          break;
        }

        default:
          console.log(`ℹ️ Unhandled event type: ${event.type}`);
      }

      res.json({ received: true });
    } catch (error) {
      console.error("❌ Webhook handler error:", error);
      res.status(500).json({ error: "Webhook handler failed" });
    }
  },
);

export default router;
