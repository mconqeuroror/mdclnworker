import express from 'express';
import Stripe from 'stripe';
import prisma from "../lib/prisma.js";
import {
  setChunkedString,
  getChunkedString,
  parseSpecialOfferAiConfigFromMetadata,
} from "../lib/stripeMetadataChunk.js";
import { authMiddleware } from '../middleware/auth.middleware.js';
import { generateModelPosesFromReference } from '../services/wavespeed.service.js';
import { recordReferralCommissionFromPayment, validateReferralCodeForCheckout, linkReferrerOnFirstPurchase } from "../services/referral.service.js";
import { sendSpecialOfferConfirmationEmail } from "../services/email.service.js";
import {
  MIN_PURCHASABLE_CREDITS,
  MAX_PURCHASABLE_CREDITS,
} from "../constants/creditPurchaseLimits.js";
import {
  getSubscriptionPricing,
  normalizeCreditUnits,
  resolveSubscriptionBillingCycle,
} from "../utils/creditUnits.js";
import {
  awardFirstPaidModelCompletionBonus,
  rolloverSubPoolToPurchasedUpdate,
} from "../services/credit.service.js";

// DEPRECATED - keeping for reference but not used
async function generatePosesAsyncDEPRECATED(modelId, referenceUrl, aiConfig) {
  try {
    console.log('🎨 [ASYNC] Starting pose generation for model:', modelId);
    
    let photo2Url = referenceUrl;
    let photo3Url = referenceUrl;
    
    const posesResult = await generateModelPosesFromReference(referenceUrl, {
      outfitType: aiConfig?.style || 'casual',
      poseStyle: 'natural'
    });
    
    if (posesResult.success && posesResult.photos) {
      photo2Url = posesResult.photos.photo2Url || referenceUrl;
      photo3Url = posesResult.photos.photo3Url || referenceUrl;
      console.log('✅ [ASYNC] Poses generated successfully for model:', modelId);
    } else {
      console.warn('⚠️ [ASYNC] Pose generation failed, keeping reference:', posesResult.error);
    }
    
    // Update model with generated poses
    await prisma.savedModel.update({
      where: { id: modelId },
      data: {
        photo2Url,
        photo3Url,
        status: 'ready'
      }
    });
    
    console.log('✅ [ASYNC] Model updated with poses:', modelId);
  } catch (error) {
    console.error('❌ [ASYNC] Pose generation failed for model:', modelId, error.message);
    // Mark model as ready anyway (with reference images as fallback)
    try {
      await prisma.savedModel.update({
        where: { id: modelId },
        data: { status: 'ready' }
      });
    } catch (updateError) {
      console.error('❌ [ASYNC] Failed to update model status:', updateError.message);
    }
  }
}

const router = express.Router();
const STRIPE_DEBUG_LOGS = process.env.NODE_ENV !== "production";
const debugStripe = (...args) => {
  if (STRIPE_DEBUG_LOGS) console.log(...args);
};

// Use TEST keys in development, LIVE keys in production
const stripeSecretKey = process.env.NODE_ENV === 'production' 
  ? process.env.STRIPE_SECRET_KEY 
  : process.env.TESTING_STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  console.error('❌ Stripe secret key is not set');
}

console.log(`🔑 Using ${process.env.NODE_ENV === 'production' ? 'LIVE' : 'TEST'} Stripe keys`);

const stripe = new Stripe(stripeSecretKey || 'sk_test_placeholder', {
  apiVersion: '2024-11-20.acacia',
});

function sanitizeReferralId(rawReferralId) {
  if (typeof rawReferralId !== 'string') return null;
  const referralId = rawReferralId.trim();
  if (!referralId) return null;
  // Keep strict to prevent malformed/tampered IDs and overlong payloads.
  if (referralId.length > 120) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(referralId)) return null;
  return referralId;
}

async function finalizeSpecialOfferModelReady(modelId, updates = {}) {
  const model = await prisma.savedModel.update({
    where: { id: modelId },
    data: { ...updates, status: 'ready' },
    select: { id: true, userId: true },
  });
  const awarded = await awardFirstPaidModelCompletionBonus(model.userId, model.id);
  return { model, awarded };
}

function getTrustedFrontendUrl(req) {
  const fallbackProdUrl = process.env.FRONTEND_URL || process.env.CLIENT_URL || "https://modelclone.app";
  if (process.env.NODE_ENV !== "production") {
    return (
      (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null) ||
      process.env.FRONTEND_URL ||
      "http://localhost:5000"
    );
  }

  const configuredOrigins = new Set(
    [
      process.env.FRONTEND_URL,
      process.env.CLIENT_URL,
      "https://modelclone.app",
      "https://www.modelclone.app",
      ...(process.env.CORS_ALLOWED_ORIGINS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ].filter(Boolean),
  );

  const headerOrigin = req.headers.origin;
  if (headerOrigin && configuredOrigins.has(headerOrigin)) {
    return headerOrigin;
  }
  return fallbackProdUrl;
}

async function validateAndApplyDiscountCode(discountCode, purchaseType, amountCents) {
  if (!discountCode || typeof discountCode !== 'string' || !discountCode.trim()) {
    return { valid: false };
  }

  const code = discountCode.trim().toUpperCase();
  const record = await prisma.discountCode.findUnique({ where: { code } });

  if (!record) {
    return { valid: false, error: 'Invalid discount code' };
  }
  if (!record.isActive) {
    return { valid: false, error: 'This discount code is no longer active' };
  }
  const now = new Date();
  if (now < record.validFrom) {
    return { valid: false, error: 'This discount code is not yet valid' };
  }
  if (now > record.validUntil) {
    return { valid: false, error: 'This discount code has expired' };
  }
  if (record.maxUses && record.currentUses >= record.maxUses) {
    return { valid: false, error: 'This discount code has reached its maximum uses' };
  }
  if (record.appliesTo !== 'both' && record.appliesTo !== purchaseType) {
    return { valid: false, error: `This code only applies to ${record.appliesTo} purchases` };
  }
  if (record.minPurchaseAmount && amountCents < record.minPurchaseAmount * 100) {
    return { valid: false, error: `Minimum purchase of $${record.minPurchaseAmount} required` };
  }

  let discountAmountCents;
  if (record.discountType === 'percentage') {
    discountAmountCents = Math.round(amountCents * (record.discountValue / 100));
  } else {
    discountAmountCents = Math.round(record.discountValue * 100);
  }

  const finalAmountCents = Math.max(amountCents - discountAmountCents, 50);

  return {
    valid: true,
    discountCodeId: record.id,
    discountCode: record.code,
    discountType: record.discountType,
    discountValue: record.discountValue,
    discountAmountCents,
    finalAmountCents,
  };
}

async function createSingleCycleDiscountCoupon({
  amountOffCents,
  customerId,
  codeLabel,
}) {
  const amount = parseInt(String(amountOffCents ?? "0"), 10) || 0;
  if (amount <= 0) return null;

  return stripe.coupons.create({
    amount_off: amount,
    currency: "usd",
    duration: "once",
    name: codeLabel || "Subscription first-cycle discount",
    metadata: {
      customerId: customerId || "",
      source: "modelclone-subscription-discount",
    },
  });
}

router.post('/validate-discount-code', authMiddleware, async (req, res) => {
  try {
    const { code, purchaseType, amountCents } = req.body;
    const result = await validateAndApplyDiscountCode(code, purchaseType || 'both', amountCents || 0);
    if (!result.valid) {
      return res.status(400).json({ error: result.error || 'Invalid discount code' });
    }
    res.json({
      valid: true,
      discountType: result.discountType,
      discountValue: result.discountValue,
      discountAmountCents: result.discountAmountCents,
      finalAmountCents: result.finalAmountCents,
    });
  } catch (error) {
    console.error('Discount code validation error:', error.message);
    res.status(500).json({ error: 'Failed to validate discount code' });
  }
});

// Create checkout session for subscription
router.post('/create-checkout-session', authMiddleware, async (req, res) => {
  try {
    debugStripe('🔷 Creating checkout session');
    const { tierId, billingCycle, referralId, referralCode, discountCode } = req.body;
    const safeReferralId = sanitizeReferralId(referralId);
    const userId = req.user.userId; // JWT stores userId, not id
    
    console.log('🔷 User ID from token:', userId);
    
    // Get full user from database
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user) {
      console.error('❌ User not found:', userId);
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log('✅ User found:', user.email);

    // Referral code at checkout: validate and apply 5% discount (first purchase only)
    let referrerUserId = null;
    if (referralCode && typeof referralCode === 'string' && referralCode.trim()) {
      const validation = await validateReferralCodeForCheckout(userId, referralCode.trim());
      if (validation.valid) {
        referrerUserId = validation.referrerUserId;
        console.log('🔷 Referral code valid, 5% discount applied, referrer:', referrerUserId);
      } else if (validation.message) {
        return res.status(400).json({ error: validation.message });
      }
    }

    // LIVE STRIPE SYNC: Prevent stale DB from blocking legitimate re-purchases
    if (user.stripeSubscriptionId) {
      try {
        const stripeSubscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
        const isReallyActive = ['active', 'trialing'].includes(stripeSubscription.status);
        if (!isReallyActive) {
          console.log(`⚠️ Stale subscription detected for user ${user.id}. Stripe status: ${stripeSubscription.status}, DB status: ${user.subscriptionStatus}`);
          await prisma.user.update({
            where: { id: user.id },
            data: {
              subscriptionStatus: 'cancelled',
              stripeSubscriptionId: null,
              subscriptionTier: null,
              subscriptionBillingCycle: null,
              subscriptionCredits: 0,
              creditsExpireAt: null,
              subscriptionCancelledAt: new Date(),
            },
          });
          user.stripeSubscriptionId = null;
          user.subscriptionStatus = 'cancelled';
          user.subscriptionTier = null;
          user.subscriptionBillingCycle = null;
        }
      } catch (syncError) {
        if (syncError.code === 'resource_missing') {
          console.log(`⚠️ Subscription ${user.stripeSubscriptionId} not found in Stripe (resource_missing) for user ${user.id} — clearing stale data`);
          await prisma.user.update({
            where: { id: user.id },
            data: {
              subscriptionStatus: 'cancelled',
              stripeSubscriptionId: null,
              subscriptionTier: null,
              subscriptionBillingCycle: null,
              subscriptionCredits: 0,
              creditsExpireAt: null,
              subscriptionCancelledAt: new Date(),
            },
          });
          user.stripeSubscriptionId = null;
          user.subscriptionStatus = 'cancelled';
          user.subscriptionTier = null;
          user.subscriptionBillingCycle = null;
        } else {
          console.error('❌ Failed to sync subscription from Stripe:', syncError.message);
        }
      }
    }

    // Smart upgrade/downgrade logic
    if (user.stripeSubscriptionId && user.subscriptionStatus === 'active') {
      const currentTier = user.subscriptionTier;
      let currentBilling = user.subscriptionBillingCycle;
      
      // If billing cycle is NULL (legacy user), fetch from Stripe
      if (!currentBilling) {
        try {
          console.log('⚠️ Billing cycle NULL - fetching from Stripe...');
          const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
          const interval = subscription.items.data[0]?.plan?.interval;
          currentBilling = interval === 'year' ? 'annual' : 'monthly';
          
          await prisma.user.update({
            where: { id: user.id },
            data: { subscriptionBillingCycle: currentBilling }
          });
          
          console.log(`✅ Fetched billing cycle from Stripe: ${currentBilling}`);
        } catch (error) {
          if (error.code === 'resource_missing') {
            console.log(`⚠️ Legacy billing fetch: subscription ${user.stripeSubscriptionId} not found in Stripe. Clearing stale record for user ${user.id}.`);
            await prisma.user.update({
              where: { id: user.id },
              data: {
                subscriptionStatus: 'cancelled',
                stripeSubscriptionId: null,
                subscriptionTier: null,
                subscriptionBillingCycle: null,
                subscriptionCredits: 0,
                creditsExpireAt: null,
              },
            });
            user.stripeSubscriptionId = null;
            user.subscriptionStatus = 'cancelled';
            user.subscriptionTier = null;
            user.subscriptionBillingCycle = null;
          } else {
            console.error('❌ Failed to fetch billing cycle from Stripe:', error.message);
            return res.status(503).json({ 
              error: 'Unable to verify your subscription details. Please try again in a moment or contact support@modelclone.app if this persists.' 
            });
          }
        }
      }
      
      // Tier hierarchy for upgrade/downgrade detection
      const tierValue = { starter: 1, pro: 2, business: 3 };
      const billingValue = { monthly: 1, annual: 2 };
      
      const currentTierValue = tierValue[currentTier] || 0;
      const newTierValue = tierValue[tierId] || 0;
      const currentBillingValue = billingValue[currentBilling] || 1;
      const newBillingValue = billingValue[billingCycle] || 1;
      
      // Same tier + same billing = Already have this plan (BLOCK)
      if (currentTier === tierId && currentBilling === billingCycle) {
        return res.status(400).json({ 
          error: `You already have the ${tierId.charAt(0).toUpperCase() + tierId.slice(1)} ${billingCycle} plan active.`
        });
      }
      
      // Higher tier = UPGRADE (ALLOW)
      // Same tier + switching to annual = UPGRADE (ALLOW)
      const isUpgrade = newTierValue > currentTierValue || 
                        (newTierValue === currentTierValue && newBillingValue > currentBillingValue);
      
      // Lower tier = DOWNGRADE (BLOCK - must cancel first)
      const isDowngrade = newTierValue < currentTierValue || 
                          (newTierValue === currentTierValue && newBillingValue < currentBillingValue);
      
      if (isDowngrade) {
        const currentPlanName = currentTier ? 
          currentTier.charAt(0).toUpperCase() + currentTier.slice(1) : 
          'current';
        
        return res.status(400).json({ 
          error: `To downgrade from ${currentPlanName}, please cancel your current subscription in Settings first. We'd love to keep you - check Settings for special retention offers!`
        });
      }
      
      // If it's an upgrade, we'll cancel the old subscription AFTER the new payment succeeds
      if (isUpgrade) {
        console.log(`🚀 UPGRADE detected: ${currentTier} (${currentBilling}) → ${tierId} (${billingCycle})`);
        console.log(`✅ Allowing upgrade - old subscription will be cancelled after successful payment`);
      }
    }

    // Define pricing tiers (matches AddCreditsModal.jsx)
    // Volume discounts: Higher tiers get better rates per credit.
    // Monthly: Stripe bills monthly; each invoice grants `pricing.credits`.
    // Annual: Stripe bills yearly (one invoice per year); each invoice grants the same `pricing.credits`
    // per period as the monthly tier (not 12× per year — see docs/STRIPE_WEBHOOK.md).
    // Credits on first payment + each renewal: checkout.session.completed / invoice.payment_succeeded.
    const knownTierIds = ["starter", "pro", "business"];
    if (!knownTierIds.includes(tierId)) {
      return res.status(400).json({ error: 'Invalid tier ID' });
    }

    const pricing = getSubscriptionPricing(tierId, billingCycle);
    if (!pricing) {
      return res.status(400).json({ error: 'Invalid billing cycle' });
    }

    const recurringUnitAmountCents = pricing.priceCents;
    let firstInvoiceAmountCents = recurringUnitAmountCents;
    if (referrerUserId) {
      firstInvoiceAmountCents = Math.round(firstInvoiceAmountCents * 0.95);
    }

    let appliedDiscountCodeId = null;
    if (discountCode && !referrerUserId) {
      const discountResult = await validateAndApplyDiscountCode(discountCode, 'subscription', firstInvoiceAmountCents);
      if (discountResult.valid) {
        firstInvoiceAmountCents = discountResult.finalAmountCents;
        appliedDiscountCodeId = discountResult.discountCodeId;
        console.log(`🏷️ Discount code ${discountResult.discountCode} applied: -$${(discountResult.discountAmountCents / 100).toFixed(2)}`);
      } else if (discountResult.error) {
        return res.status(400).json({ error: discountResult.error });
      }
    }

    // Create or retrieve Stripe customer
    let customerId = user.stripeCustomerId;
    
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          userId: user.id,
        },
      });
      customerId = customer.id;
      
      // Save customer ID to database
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId }
      });
    }

    const firstCycleDiscountCents = Math.max(recurringUnitAmountCents - firstInvoiceAmountCents, 0);
    const firstCycleCoupon = firstCycleDiscountCents > 0
      ? await createSingleCycleDiscountCoupon({
          amountOffCents: firstCycleDiscountCents,
          customerId,
          codeLabel: referrerUserId ? 'Referral first-cycle discount' : 'Discount code first-cycle discount',
        })
      : null;

    console.log('🔷 Creating Stripe session with:', {
      tierId,
      billingCycle,
      customerId,
      credits: pricing.credits,
      recurringUnitAmountCents,
      firstInvoiceAmountCents,
    });
    
    const frontendUrl = getTrustedFrontendUrl(req);
    
    console.log('🔷 Using frontend URL for redirect:', frontendUrl);
    
    // Create checkout session with subscription metadata
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      client_reference_id: safeReferralId || undefined,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${tierId.charAt(0).toUpperCase() + tierId.slice(1)} Plan`,
              description: `${pricing.credits} credits per ${billingCycle === 'annual' ? 'year' : 'month'}`,
            },
            unit_amount: recurringUnitAmountCents,
            recurring: {
              interval: billingCycle === 'annual' ? 'year' : 'month',
            },
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${frontendUrl}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/dashboard`,
      subscription_data: {
        metadata: {
          userId: user.id,
          tierId,
          billingCycle,
          credits: pricing.credits.toString(),
          recurringAmountCents: recurringUnitAmountCents.toString(),
          firstInvoiceAmountCents: firstInvoiceAmountCents.toString(),
          ...(referrerUserId ? { referrerUserId } : {}),
          ...(appliedDiscountCodeId ? { discountCodeId: appliedDiscountCodeId } : {}),
        },
      },
      ...(firstCycleCoupon ? { discounts: [{ coupon: firstCycleCoupon.id }] } : {}),
      metadata: {
        userId: user.id,
        tierId,
        billingCycle,
        credits: pricing.credits.toString(),
        recurringAmountCents: recurringUnitAmountCents.toString(),
        firstInvoiceAmountCents: firstInvoiceAmountCents.toString(),
        ...(referrerUserId ? { referrerUserId } : {}),
        ...(appliedDiscountCodeId ? { discountCodeId: appliedDiscountCodeId } : {}),
      },
    });

    console.log('✅ Stripe session created:', session.id, 'URL:', session.url);
    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('❌ Stripe checkout error:', error.message);
    res.status(500).json({ error: 'Failed to create checkout session. Please try again.' });
  }
});

// Create one-time credit purchase (no subscription)
router.post('/create-onetime-checkout', authMiddleware, async (req, res) => {
  try {
    debugStripe('🔷 Creating one-time checkout');
    const { creditAmount, referralId, referralCode, discountCode } = req.body;
    const safeReferralId = sanitizeReferralId(referralId);
    const userId = req.user.userId;
    
    if (
      !creditAmount ||
      creditAmount < MIN_PURCHASABLE_CREDITS ||
      creditAmount > MAX_PURCHASABLE_CREDITS
    ) {
      return res.status(400).json({
        error: `Credit amount must be between ${MIN_PURCHASABLE_CREDITS} and ${MAX_PURCHASABLE_CREDITS}`,
      });
    }
    
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user) {
      console.error('❌ User not found:', userId);
      return res.status(404).json({ error: 'User not found' });
    }
    
    let referrerUserId = null;
    if (referralCode && typeof referralCode === 'string' && referralCode.trim()) {
      const validation = await validateReferralCodeForCheckout(userId, referralCode.trim());
      if (validation.valid) {
        referrerUserId = validation.referrerUserId;
      } else if (validation.message) {
        return res.status(400).json({ error: validation.message });
      }
    }
    
    const pricePerCredit = 0.012;
    let totalPrice = Math.round(creditAmount * pricePerCredit * 100);
    if (referrerUserId) {
      totalPrice = Math.round(totalPrice * 0.95);
    }

    let appliedDiscountCodeId = null;
    if (discountCode && !referrerUserId) {
      const discountResult = await validateAndApplyDiscountCode(discountCode, 'credits', totalPrice);
      if (discountResult.valid) {
        totalPrice = discountResult.finalAmountCents;
        appliedDiscountCodeId = discountResult.discountCodeId;
        console.log(`🏷️ Discount code ${discountResult.discountCode} applied: -$${(discountResult.discountAmountCents / 100).toFixed(2)}`);
      } else if (discountResult.error) {
        return res.status(400).json({ error: discountResult.error });
      }
    }
    
    let customerId = user.stripeCustomerId;
    
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          userId: user.id,
        },
      });
      customerId = customer.id;
      
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId }
      });
    }
    
    const frontendUrl = getTrustedFrontendUrl(req);
    
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      client_reference_id: safeReferralId || undefined,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${creditAmount} Credits`,
              description: `One-time credit purchase - Credits never expire`,
            },
            unit_amount: totalPrice,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${frontendUrl}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/dashboard`,
      metadata: {
        userId: user.id,
        credits: creditAmount.toString(),
        type: 'one-time',
        ...(referrerUserId ? { referrerUserId } : {}),
        ...(appliedDiscountCodeId ? { discountCodeId: appliedDiscountCodeId } : {}),
      },
    });

    console.log('✅ One-time checkout session created:', session.id);
    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('❌ One-time checkout error:', error.message);
    res.status(500).json({ error: 'Failed to create checkout session. Please try again.' });
  }
});

// Create Payment Intent for one-time credit purchase (embedded checkout)
router.post('/create-payment-intent', authMiddleware, async (req, res) => {
  try {
    debugStripe('💳 Creating payment intent');
    const { creditAmount, referralId, referralCode, discountCode } = req.body;
    const safeReferralId = sanitizeReferralId(referralId);
    const userId = req.user.userId;
    
    if (
      !creditAmount ||
      creditAmount < MIN_PURCHASABLE_CREDITS ||
      creditAmount > MAX_PURCHASABLE_CREDITS
    ) {
      return res.status(400).json({
        error: `Credit amount must be between ${MIN_PURCHASABLE_CREDITS} and ${MAX_PURCHASABLE_CREDITS}`,
      });
    }
    
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    let referrerUserId = null;
    if (referralCode && typeof referralCode === 'string' && referralCode.trim()) {
      const validation = await validateReferralCodeForCheckout(userId, referralCode.trim());
      if (validation.valid) {
        referrerUserId = validation.referrerUserId;
      } else if (validation.message) {
        return res.status(400).json({ error: validation.message });
      }
    }
    
    const pricePerCredit = 0.012;
    let totalAmount = Math.round(creditAmount * pricePerCredit * 100);
    if (referrerUserId) {
      totalAmount = Math.round(totalAmount * 0.95);
    }

    let appliedDiscountCodeId = null;
    if (discountCode && !referrerUserId) {
      const discountResult = await validateAndApplyDiscountCode(discountCode, 'credits', totalAmount);
      if (discountResult.valid) {
        totalAmount = discountResult.finalAmountCents;
        appliedDiscountCodeId = discountResult.discountCodeId;
        console.log(`🏷️ Discount code ${discountResult.discountCode} applied: -$${(discountResult.discountAmountCents / 100).toFixed(2)}`);
      } else if (discountResult.error) {
        return res.status(400).json({ error: discountResult.error });
      }
    }
    
    let customerId = user.stripeCustomerId;
    
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId }
      });
    }
    
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalAmount,
      currency: 'usd',
      customer: customerId,
      metadata: {
        userId: user.id,
        credits: creditAmount.toString(),
        type: 'one-time-embedded',
        referralId: safeReferralId || '',
        ...(referrerUserId ? { referrerUserId } : {}),
        ...(appliedDiscountCodeId ? { discountCodeId: appliedDiscountCodeId } : {}),
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    console.log('✅ Payment intent created:', paymentIntent.id);
    res.json({ 
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: totalAmount,
      credits: creditAmount
    });
  } catch (error) {
    console.error('❌ Payment intent error:', error.message);
    res.status(500).json({ error: 'Failed to create payment. Please try again.' });
  }
});

// Create Embedded Subscription (proper Stripe Subscription with default_incomplete)
// This creates a REAL recurring subscription, not just a one-time payment
router.post('/create-embedded-subscription', authMiddleware, async (req, res) => {
  try {
    debugStripe('💳 Creating embedded subscription');
    let { tierId, billingCycle, referralId, referralCode, discountCode } = req.body;
    tierId = typeof tierId === 'string' ? tierId.trim().toLowerCase() : '';
    billingCycle = typeof billingCycle === 'string' ? billingCycle.trim().toLowerCase() : '';
    const safeReferralId = sanitizeReferralId(referralId);
    const userId = req.user?.userId ?? req.user?.id ?? req.user?.sub;
    
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    let referrerUserId = null;
    if (referralCode && typeof referralCode === 'string' && referralCode.trim()) {
      const validation = await validateReferralCodeForCheckout(userId, referralCode.trim());
      if (validation.valid) {
        referrerUserId = validation.referrerUserId;
      } else if (validation.message) {
        return res.status(400).json({ error: validation.message });
      }
    }
    
    if (!tierId || !billingCycle) {
      return res.status(400).json({ error: 'Tier and billing cycle are required.' });
    }
    const knownTierIds = ["starter", "pro", "business"];
    if (!knownTierIds.includes(tierId)) {
      return res.status(400).json({ error: 'Invalid plan. Choose Starter, Pro, or Business.' });
    }

    const pricing = getSubscriptionPricing(tierId, billingCycle);
    if (!pricing) {
      return res.status(400).json({ error: 'Invalid billing cycle. Use monthly or annual.' });
    }

    const recurringUnitAmountCents = pricing.priceCents;
    let firstInvoiceAmountCents = recurringUnitAmountCents;
    if (referrerUserId) {
      firstInvoiceAmountCents = Math.round(firstInvoiceAmountCents * 0.95);
    }

    let appliedDiscountCodeId = null;
    if (discountCode && !referrerUserId) {
      const discountResult = await validateAndApplyDiscountCode(discountCode, 'subscription', firstInvoiceAmountCents);
      if (discountResult.valid) {
        firstInvoiceAmountCents = discountResult.finalAmountCents;
        appliedDiscountCodeId = discountResult.discountCodeId;
        console.log(`🏷️ Discount code ${discountResult.discountCode} applied: -$${(discountResult.discountAmountCents / 100).toFixed(2)}`);
      } else if (discountResult.error) {
        return res.status(400).json({ error: discountResult.error });
      }
    }

    // LIVE STRIPE SYNC: Prevent stale DB from blocking legitimate re-purchases
    if (user.stripeSubscriptionId) {
      try {
        const stripeSubscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
        const isReallyActive = ['active', 'trialing'].includes(stripeSubscription.status);
        if (!isReallyActive) {
          console.log(`⚠️ Stale subscription detected for user ${user.id}. Stripe status: ${stripeSubscription.status}, DB status: ${user.subscriptionStatus}`);
          await prisma.user.update({
            where: { id: user.id },
            data: {
              subscriptionStatus: 'cancelled',
              stripeSubscriptionId: null,
              subscriptionTier: null,
              subscriptionBillingCycle: null,
              subscriptionCredits: 0,
              creditsExpireAt: null,
              subscriptionCancelledAt: new Date(),
            },
          });
          user.stripeSubscriptionId = null;
          user.subscriptionStatus = 'cancelled';
          user.subscriptionTier = null;
          user.subscriptionBillingCycle = null;
        }
      } catch (syncError) {
        if (syncError.code === 'resource_missing') {
          console.log(`⚠️ Subscription ${user.stripeSubscriptionId} not found in Stripe (resource_missing) for user ${user.id} — clearing stale data`);
          await prisma.user.update({
            where: { id: user.id },
            data: {
              subscriptionStatus: 'cancelled',
              stripeSubscriptionId: null,
              subscriptionTier: null,
              subscriptionBillingCycle: null,
              subscriptionCredits: 0,
              creditsExpireAt: null,
              subscriptionCancelledAt: new Date(),
            },
          });
          user.stripeSubscriptionId = null;
          user.subscriptionStatus = 'cancelled';
          user.subscriptionTier = null;
          user.subscriptionBillingCycle = null;
        } else {
          console.error('❌ Failed to sync subscription from Stripe:', syncError.message);
        }
      }
    }

    // Smart upgrade/downgrade logic for existing subscribers
    if (user.stripeSubscriptionId && user.subscriptionStatus === 'active') {
      const currentTier = user.subscriptionTier;
      let currentBilling = user.subscriptionBillingCycle;
      
      // Fetch billing cycle from Stripe if not in DB
      if (!currentBilling) {
        try {
          const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
          const interval = subscription.items.data[0]?.plan?.interval;
          currentBilling = interval === 'year' ? 'annual' : 'monthly';
          
          await prisma.user.update({
            where: { id: user.id },
            data: { subscriptionBillingCycle: currentBilling }
          });
        } catch (error) {
          if (error.code === 'resource_missing') {
            console.log(`⚠️ Legacy billing fetch: subscription ${user.stripeSubscriptionId} not found in Stripe. Clearing stale record for user ${user.id}.`);
            await prisma.user.update({
              where: { id: user.id },
              data: {
                subscriptionStatus: 'cancelled',
                stripeSubscriptionId: null,
                subscriptionTier: null,
                subscriptionBillingCycle: null,
                subscriptionCredits: 0,
                creditsExpireAt: null,
              },
            });
            user.stripeSubscriptionId = null;
            user.subscriptionStatus = 'cancelled';
            user.subscriptionTier = null;
            user.subscriptionBillingCycle = null;
          } else {
            console.error('❌ Failed to fetch billing cycle from Stripe:', error.message);
            return res.status(503).json({ 
              error: 'Unable to verify your subscription details. Please try again.' 
            });
          }
        }
      }
      
      const tierValue = { starter: 1, pro: 2, business: 3 };
      const billingValue = { monthly: 1, annual: 2 };
      
      const currentTierValue = tierValue[currentTier] || 0;
      const newTierValue = tierValue[tierId] || 0;
      const currentBillingValue = billingValue[currentBilling] || 1;
      const newBillingValue = billingValue[billingCycle] || 1;
      
      // Same plan = already have it
      if (currentTier === tierId && currentBilling === billingCycle) {
        return res.status(400).json({ 
          error: `You already have the ${tierId.charAt(0).toUpperCase() + tierId.slice(1)} ${billingCycle} plan active.`
        });
      }
      
      // Downgrade = must cancel first
      const isDowngrade = newTierValue < currentTierValue || 
                          (newTierValue === currentTierValue && newBillingValue < currentBillingValue);
      
      if (isDowngrade) {
        return res.status(400).json({ 
          error: `To downgrade, please cancel your current subscription in Settings first.`
        });
      }
      
      console.log(`🚀 UPGRADE detected: ${currentTier} (${currentBilling}) → ${tierId} (${billingCycle})`);
    }

    // Create or retrieve Stripe customer
    let customerId = user.stripeCustomerId;
    
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId }
      });
    }
    
    const firstCycleDiscountCents = Math.max(recurringUnitAmountCents - firstInvoiceAmountCents, 0);
    const firstCycleCoupon = firstCycleDiscountCents > 0
      ? await createSingleCycleDiscountCoupon({
          amountOffCents: firstCycleDiscountCents,
          customerId,
          codeLabel: referrerUserId ? 'Referral first-cycle discount' : 'Discount code first-cycle discount',
        })
      : null;

    // Create a Stripe Price on-the-fly for this subscription
    const price = await stripe.prices.create({
      unit_amount: recurringUnitAmountCents,
      currency: 'usd',
      recurring: {
        interval: billingCycle === 'annual' ? 'year' : 'month',
      },
      product_data: {
        name: `${tierId.charAt(0).toUpperCase() + tierId.slice(1)} Plan`,
      },
    });
    
    // Create subscription with payment_behavior: 'default_incomplete'
    // This creates the subscription but waits for payment confirmation
    const subscriptionMetadata = {
      userId: user.id,
      tierId,
      billingCycle,
      credits: pricing.credits.toString(),
      recurringAmountCents: recurringUnitAmountCents.toString(),
      firstInvoiceAmountCents: firstInvoiceAmountCents.toString(),
      type: 'subscription-embedded',
      referralId: safeReferralId || '',
      ...(referrerUserId ? { referrerUserId } : {}),
      ...(appliedDiscountCodeId ? { discountCodeId: appliedDiscountCodeId } : {}),
    };

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: price.id }],
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription',
      },
      metadata: subscriptionMetadata,
      ...(firstCycleCoupon ? { discounts: [{ coupon: firstCycleCoupon.id }] } : {}),
      expand: ['latest_invoice.payment_intent'],
    });

    // Copy metadata to the payment intent so webhook safety net works
    // Stripe does NOT auto-copy subscription metadata to payment intents
    const latestPI = subscription.latest_invoice?.payment_intent;
    if (latestPI && typeof latestPI === 'object' && latestPI.id) {
      try {
        await stripe.paymentIntents.update(latestPI.id, {
          metadata: subscriptionMetadata,
        });
        console.log('✅ Copied metadata to payment intent:', latestPI.id);
      } catch (metaErr) {
        console.warn('⚠️ Failed to copy metadata to PI (non-fatal):', metaErr.message);
      }
    }
    
    const latestInvoice = subscription.latest_invoice;
    const paymentIntent = latestInvoice?.payment_intent;
    
    if (!paymentIntent || typeof paymentIntent === 'string') {
      console.error('❌ No payment intent on subscription');
      return res.status(500).json({ error: 'Failed to create subscription payment' });
    }
    
    console.log('✅ Embedded subscription created:', subscription.id, 'PI:', paymentIntent.id);
    
    res.json({ 
      clientSecret: paymentIntent.client_secret,
      subscriptionId: subscription.id,
      amount: firstInvoiceAmountCents,
      credits: pricing.credits,
      tierId,
      billingCycle
    });
  } catch (error) {
    console.error('❌ Embedded subscription error:', error.message);
    res.status(500).json({ error: 'Failed to create subscription. Please try again.' });
  }
});

// Confirm payment and add credits (for embedded checkout - bypasses webhook)
router.post('/confirm-payment', authMiddleware, async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    const userId = req.user.userId;
    
    console.log('💳 Confirming payment...', { paymentIntentId, userId });
    
    if (!paymentIntentId) {
      return res.status(400).json({ error: 'Payment intent ID is required' });
    }
    
    // Retrieve the payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (paymentIntent.status !== 'succeeded') {
      console.error('❌ Payment not succeeded:', paymentIntent.status);
      return res.status(400).json({ error: 'Payment has not succeeded' });
    }
    
    // Verify the payment belongs to this user
    if (paymentIntent.metadata.userId !== userId) {
      console.error('❌ Payment user mismatch:', paymentIntent.metadata.userId, '!=', userId);
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const credits = normalizeCreditUnits(paymentIntent.metadata.credits);
    const type = paymentIntent.metadata.type;
    
    // Atomic idempotency: insert transaction first (UNIQUE paymentSessionId)
    // If duplicate arrives (webhook + client confirm race), P2002 is handled below.
    let user;
    try {
      user = await prisma.$transaction(async (tx) => {
        await tx.creditTransaction.create({
          data: {
            userId,
            amount: credits,
            type: 'purchase',
            description: type === 'subscription-embedded' 
              ? `Subscription payment: ${paymentIntent.metadata.tierId} (${paymentIntent.metadata.billingCycle})`
              : `Credit pack purchase: ${credits} credits`,
            paymentSessionId: paymentIntentId
          }
        });

        return await tx.user.update({
          where: { id: userId },
          data: {
            purchasedCredits: { increment: credits }
          }
        });
      });
    } catch (error) {
      if (error.code === 'P2002') {
        console.log('⚠️ Credits already added for this payment:', paymentIntentId);
        return res.json({ 
          success: true, 
          message: 'Credits already added',
          credits: credits,
          alreadyProcessed: true
        });
      }
      throw error;
    }
    
    console.log('✅ Credits added successfully:', { userId, credits, paymentIntentId });
    const referrerUserId = paymentIntent.metadata.referrerUserId || null;
    if (referrerUserId) {
      await linkReferrerOnFirstPurchase(userId, referrerUserId);
    }
    await recordReferralCommissionFromPayment({
      referredUserId: userId,
      purchaseAmountCents: paymentIntent.amount_received || paymentIntent.amount || 0,
      sourceType: "stripe_payment_intent",
      sourceId: paymentIntentId,
    });

    const discountCodeId = paymentIntent.metadata.discountCodeId;
    if (discountCodeId) {
      try {
        await prisma.discountCode.update({
          where: { id: discountCodeId },
          data: { currentUses: { increment: 1 } },
        });
        console.log(`🏷️ Discount code usage incremented (confirm-payment): ${discountCodeId}`);
      } catch (dcErr) {
        console.warn('⚠️ Failed to increment discount code usage (non-fatal):', dcErr.message);
      }
    }
    
    res.json({ 
      success: true, 
      credits: credits,
      totalCredits: (user.credits || 0) + (user.subscriptionCredits || 0) + user.purchasedCredits
    });
  } catch (error) {
    console.error('❌ Confirm payment error:', error.message);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

// Confirm embedded subscription after payment succeeds
// With retry logic to handle Stripe's eventual consistency after 3D Secure
router.post('/confirm-subscription', authMiddleware, async (req, res) => {
  try {
    const { subscriptionId } = req.body;
    const userId = req.user.userId;
    
    console.log('💳 Confirming embedded subscription...', { subscriptionId, userId });
    
    if (!subscriptionId) {
      return res.status(400).json({ error: 'Subscription ID is required' });
    }
    
    // Retry logic for Stripe eventual consistency (especially after 3D Secure)
    const MAX_RETRIES = 5;
    const RETRY_DELAYS = [1000, 2000, 3000, 5000, 8000]; // Exponential-ish backoff
    
    let subscription = null;
    let paymentSucceeded = false;
    
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Retrieve the subscription from Stripe
      subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['latest_invoice.payment_intent']
      });
      
      const paymentIntent = subscription.latest_invoice?.payment_intent;
      const piStatus = typeof paymentIntent === 'object' ? paymentIntent.status : null;
      
      console.log(`📋 Attempt ${attempt + 1}: subscription.status=${subscription.status}, paymentIntent.status=${piStatus}`);
      
      // Check if payment succeeded (this is the key indicator, not subscription.status)
      if (piStatus === 'succeeded') {
        paymentSucceeded = true;
        break;
      }
      
      // Also accept if subscription is already active (rare but possible)
      if (['active', 'trialing'].includes(subscription.status)) {
        paymentSucceeded = true;
        break;
      }
      
      // If still processing, wait and retry
      if (attempt < MAX_RETRIES - 1) {
        console.log(`⏳ Payment not yet confirmed, waiting ${RETRY_DELAYS[attempt]}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
      }
    }
    
    if (!paymentSucceeded) {
      console.error('❌ Payment not confirmed after retries. Status:', subscription.status);
      return res.status(400).json({ 
        error: 'Payment is still processing. Please wait a moment and try again, or check your email for confirmation.',
        status: 'processing'
      });
    }
    
    // Verify the subscription belongs to this user via metadata
    if (subscription.metadata.userId !== userId) {
      console.error('❌ Subscription user mismatch:', subscription.metadata.userId, '!=', userId);
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const tierId = subscription.metadata.tierId;
    const billingCycle = resolveSubscriptionBillingCycle(subscription);
    const credits = normalizeCreditUnits(subscription.metadata.credits);
    
    // Check if this subscription was already processed
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (user.stripeSubscriptionId === subscriptionId) {
      console.log('⚠️ Subscription already confirmed:', subscriptionId);
      return res.json({ 
        success: true, 
        message: 'Subscription already active',
        alreadyProcessed: true,
        credits: normalizeCreditUnits(subscription.metadata.credits),
      });
    }
    
    // Store old subscription ID for cancellation AFTER successful update
    const oldSubscriptionId = user.stripeSubscriptionId && user.stripeSubscriptionId !== subscriptionId 
      ? user.stripeSubscriptionId 
      : null;
    
    // Calculate expiry date based on billing cycle
    const expiryDate = new Date();
    if (billingCycle === 'annual') {
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    } else {
      expiryDate.setMonth(expiryDate.getMonth() + 1);
    }

    // Atomic idempotency: create transaction first (UNIQUE paymentSessionId),
    // then update subscription + credits in one transaction.
    let updatedUser;
    try {
      updatedUser = await prisma.$transaction(async (tx) => {
        await tx.creditTransaction.create({
          data: {
            userId,
            amount: credits,
            type: 'subscription',
            description: `${tierId.charAt(0).toUpperCase() + tierId.slice(1)} subscription (${billingCycle})`,
            paymentSessionId: subscriptionId
          }
        });

        const priorConfirm = await tx.user.findUnique({
          where: { id: userId },
          select: { subscriptionCredits: true },
        });
        const rolloverConfirm = rolloverSubPoolToPurchasedUpdate(priorConfirm?.subscriptionCredits);
        if (Object.keys(rolloverConfirm).length) {
          console.log(
            `💾 confirm-subscription: rolling ${priorConfirm?.subscriptionCredits || 0} subscription credits → purchased`,
          );
        }

        return await tx.user.update({
          where: { id: userId },
          data: {
            ...rolloverConfirm,
            stripeSubscriptionId: subscriptionId,
            subscriptionTier: tierId,
            subscriptionBillingCycle: billingCycle,
            subscriptionStatus: 'active',
            subscriptionCredits: credits,
            creditsExpireAt: expiryDate,
          }
        });
      });
    } catch (error) {
      if (error.code === 'P2002') {
        console.log('⚠️ Subscription already confirmed:', subscriptionId);
        return res.json({ 
          success: true, 
          message: 'Subscription already active',
          alreadyProcessed: true,
          credits
        });
      }
      throw error;
    }
    
    console.log('✅ Subscription confirmed:', { userId, subscriptionId, tierId, billingCycle, credits });
    const latestPi = subscription.latest_invoice?.payment_intent;
    const latestPiId = typeof latestPi === "object" && latestPi?.id ? latestPi.id : null;

    // Resolve amount: prefer the expanded PI object, then fall back to the invoice amount_paid.
    // When latest_invoice.payment_intent is an unexpanded string (not an object), fetch the
    // invoice explicitly so we always have a real dollar amount for the commission record.
    let purchaseAmountCents = typeof latestPi === "object"
      ? (latestPi.amount_received || latestPi.amount || 0)
      : 0;

    if (!purchaseAmountCents && subscription.latest_invoice) {
      try {
        const invoiceId = typeof subscription.latest_invoice === "string"
          ? subscription.latest_invoice
          : subscription.latest_invoice.id;
        if (invoiceId) {
          const invoice = await stripe.invoices.retrieve(invoiceId);
          purchaseAmountCents = invoice.amount_paid || 0;
        }
      } catch (invoiceFetchErr) {
        console.warn("⚠️ Could not fetch invoice for referral commission amount:", invoiceFetchErr.message);
      }
    }

    const referrerUserId = subscription.metadata.referrerUserId || null;
    if (referrerUserId) {
      await linkReferrerOnFirstPurchase(userId, referrerUserId);
    }
    await recordReferralCommissionFromPayment({
      referredUserId: userId,
      purchaseAmountCents,
      sourceType: latestPiId ? "stripe_payment_intent" : "stripe_subscription",
      sourceId: latestPiId || subscriptionId,
    });
    
    const discountCodeId = subscription.metadata.discountCodeId;
    if (discountCodeId) {
      try {
        await prisma.discountCode.update({
          where: { id: discountCodeId },
          data: { currentUses: { increment: 1 } },
        });
        console.log(`🏷️ Discount code usage incremented (confirm-subscription): ${discountCodeId}`);
      } catch (dcErr) {
        console.warn('⚠️ Failed to increment discount code usage (non-fatal):', dcErr.message);
      }
    }

    // Cancel old subscription ONLY AFTER new subscription is fully confirmed
    if (oldSubscriptionId) {
      try {
        console.log('🔄 Cancelling previous subscription (after new is active):', oldSubscriptionId);
        await stripe.subscriptions.cancel(oldSubscriptionId);
      } catch (cancelError) {
        // Non-fatal - log but don't fail
        console.warn('⚠️ Could not cancel previous subscription:', cancelError.message);
      }
    }
    
    res.json({ 
      success: true, 
      subscriptionId,
      tierId,
      billingCycle,
      credits,
      totalCredits: (updatedUser.credits || 0) + (updatedUser.subscriptionCredits || 0) + (updatedUser.purchasedCredits || 0)
    });
  } catch (error) {
    console.error('❌ Confirm subscription error:', error.message);
    res.status(500).json({ error: 'Failed to confirm subscription' });
  }
});

// Create special offer Payment Intent for embedded checkout ($6 instead of $10)
router.post('/create-special-offer-intent', authMiddleware, async (req, res) => {
  try {
    debugStripe('🎁 Creating special offer payment intent');
    const { referenceUrl, aiConfig, referralId } = req.body;
    const safeReferralId = sanitizeReferralId(referralId);
    const userId = req.user.userId;
    
    if (!referenceUrl) {
      return res.status(400).json({ error: 'Reference image URL is required' });
    }
    
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user) {
      console.error('❌ User not found:', userId);
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if user already purchased special offer (production only - bypass in dev for testing)
    if (process.env.NODE_ENV === 'production') {
      const existingOffer = await prisma.creditTransaction.findFirst({
        where: {
          userId,
          description: { contains: 'Special Offer: AI Model' }
        }
      });
      
      if (existingOffer) {
        return res.status(400).json({ error: 'You have already used the special offer' });
      }
    }
    
    // Special offer price: $6 (normally $10 for AI model)
    const specialOfferPrice = 600; // in cents
    const bonusCredits = 250; // Bonus credits with special offer
    
    // Create or retrieve Stripe customer
    let customerId = user.stripeCustomerId;
    
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId }
      });
    }
    
    const soMetadata = {
      userId: user.id,
      type: 'special-offer-ai-model',
      bonusCredits: bonusCredits.toString(),
      referralId: safeReferralId || '',
    };
    setChunkedString(soMetadata, 'referenceUrl', referenceUrl);
    setChunkedString(soMetadata, 'aiConfig', JSON.stringify(aiConfig || {}));

    // Create payment intent for special offer
    const paymentIntent = await stripe.paymentIntents.create({
      amount: specialOfferPrice,
      currency: 'usd',
      customer: customerId,
      metadata: soMetadata,
      automatic_payment_methods: {
        enabled: true,
      },
    });
    
    console.log('✅ Special offer payment intent created:', paymentIntent.id);
    res.json({ 
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: specialOfferPrice,
      bonusCredits
    });
  } catch (error) {
    console.error('❌ Special offer intent error:', error.message);
    res.status(500).json({ error: 'Failed to create payment. Please try again.' });
  }
});

// Confirm special offer payment and create AI model
router.post('/confirm-special-offer', authMiddleware, async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    const userId = req.user.userId;
    
    console.log('💳 Confirming special offer payment...', { paymentIntentId, userId });
    
    if (!paymentIntentId) {
      return res.status(400).json({ error: 'Payment intent ID is required' });
    }
    
    // Retrieve the payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (paymentIntent.status !== 'succeeded') {
      console.error('❌ Payment not succeeded:', paymentIntent.status);
      return res.status(400).json({ error: 'Payment has not succeeded' });
    }
    
    // Verify the payment belongs to this user (convert both to strings for comparison)
    if (String(paymentIntent.metadata.userId) !== String(userId)) {
      console.error('❌ Payment user mismatch:', paymentIntent.metadata.userId, '!=', userId);
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    if (paymentIntent.metadata.type !== 'special-offer-ai-model') {
      return res.status(400).json({ error: 'Invalid payment type' });
    }
    
    const referenceUrl = paymentIntent.metadata.referenceUrl;
    let aiConfig = {};
    try { aiConfig = JSON.parse(paymentIntent.metadata.aiConfig || '{}'); } catch (e) { console.error('⚠️ Failed to parse aiConfig:', e.message); }
    const bonusCredits = parseInt(paymentIntent.metadata.bonusCredits || '250');
    const modelName = aiConfig.modelName || 'My AI Model';
    const parsedAge = Number.parseInt(aiConfig?.age, 10);
    const safeAge = Number.isFinite(parsedAge) && parsedAge >= 1 && parsedAge <= 120 ? parsedAge : null;
    const safeAppearance = {
      gender: aiConfig?.gender || "",
      hairColor: aiConfig?.hairColor || "",
      hairLength: aiConfig?.hairLength || "",
      hairTexture: aiConfig?.hairTexture || "",
      lipSize: aiConfig?.lipSize || "",
      faceType: aiConfig?.faceType || "",
      eyeColor: aiConfig?.eyeColor || "",
      style: aiConfig?.style || "",
      bodyType: aiConfig?.bodyType || "",
      heritage: aiConfig?.heritage || "",
    };

    // Check if already processed (prevents double API calls)
    const existingTransaction = await prisma.creditTransaction.findFirst({
      where: { paymentSessionId: paymentIntentId }
    });
    
    if (existingTransaction) {
      console.log('✅ Special offer already processed for payment', paymentIntentId);
      let model = await prisma.savedModel.findFirst({
        where: { userId, paymentIntentId }
      });
      if (!model) {
        model = await prisma.savedModel.findFirst({
          where: { userId },
          orderBy: { createdAt: 'desc' }
        });
      }
      return res.json({ 
        success: true, 
        message: 'Offer already processed',
        alreadyProcessed: true,
        model,
        modelStatus: model?.status || 'ready',
        credits: bonusCredits
      });
    }

    const photo1Url = referenceUrl;
    
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        await tx.creditTransaction.create({
          data: {
            userId,
            amount: 0,
            type: 'special_offer_model_fulfillment',
            description: 'Special Offer: AI Model fulfillment',
            paymentSessionId: paymentIntentId
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
            paymentIntentId,
            savedAppearance: safeAppearance,
            ...(safeAge ? { age: safeAge } : {}),
          }
        });

        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: {
            onboardingCompleted: true,
            hasUsedFreeTrial: true
          }
        });

        return { model, user: updatedUser };
      });

      console.log('✅ Credits awarded, model created:', result.model.id);
      await recordReferralCommissionFromPayment({
        referredUserId: userId,
        purchaseAmountCents: paymentIntent.amount_received || paymentIntent.amount || 0,
        sourceType: "stripe_payment_intent",
        sourceId: paymentIntentId,
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

      res.json({ 
        success: true, 
        model: result.model,
        modelStatus: 'generating',
        totalCredits: (result.user.credits || 0) + (result.user.subscriptionCredits || 0) + result.user.purchasedCredits,
        bonusCreditsPending: bonusCredits
      });
      
    } catch (txError) {
      if (txError.code === 'P2002') {
        console.log('⚠️ Duplicate processing attempt, returning success');
        let model = await prisma.savedModel.findFirst({
          where: { userId, paymentIntentId }
        });
        if (!model) {
          model = await prisma.savedModel.findFirst({
            where: { userId },
            orderBy: { createdAt: 'desc' }
          });
        }
        return res.json({ 
          success: true, 
          message: 'Offer already processed',
          alreadyProcessed: true,
          model,
          modelStatus: model?.status || 'ready',
          credits: bonusCredits
        });
      }
      throw txError;
    }
    
    // STEP 2: Generate full 3-photo model using the same pipeline as basic AI model generation.
    // Flow: reference -> generate photo1 selfie -> generate photo2/photo3 from [reference, photo1].
    console.log('🎨 Starting background full model generation (same pipeline as basic AI generate)...');
    
    generateModelPosesFromReference(referenceUrl, {
      ...aiConfig,
      outfitType: aiConfig?.style || 'casual',
      poseStyle: aiConfig?.poseStyle || 'natural',
    }).then(async (posesResult) => {
      try {
        if (posesResult.success && posesResult.photos) {
          // Update model with full 3-photo output from the consistency pipeline.
          const readyResult = await finalizeSpecialOfferModelReady(result.model.id, {
            photo1Url: posesResult.photos.photo1Url || photo1Url,
            photo2Url: posesResult.photos.photo2Url || photo1Url,
            photo3Url: posesResult.photos.photo3Url || photo1Url,
          });
          console.log(`🎁 Special offer completion bonus awarded: ${readyResult.awarded}`);
          console.log('✅ Model updated with full 3-photo output:', result.model.id);
        } else {
          // Generation failed, keep reference placeholders but mark as ready.
          const readyResult = await finalizeSpecialOfferModelReady(result.model.id);
          console.log(`🎁 Special offer completion bonus awarded: ${readyResult.awarded}`);
          console.warn('⚠️ Full model generation failed, model ready with reference photos:', posesResult.error);
        }
      } catch (updateError) {
        console.error('❌ Failed to update model with poses:', updateError.message);
      }
    }).catch((error) => {
      console.error('❌ Background pose generation error:', error.message);
      // Mark model as ready even if generation failed
      finalizeSpecialOfferModelReady(result.model.id).catch(console.error);
    });
  } catch (error) {
    console.error('❌ Confirm special offer error:', error.message);
    res.status(500).json({ error: 'Failed to process payment' });
  }
});

// Create special offer checkout for AI model ($6 instead of $10) - Legacy redirect flow
router.post('/create-special-offer-checkout', authMiddleware, async (req, res) => {
  try {
    debugStripe('🎁 Creating special offer checkout');
    const { referenceUrl, aiConfig, referralId } = req.body;
    const safeReferralId = sanitizeReferralId(referralId);
    const userId = req.user.userId;
    
    if (!referenceUrl) {
      return res.status(400).json({ error: 'Reference image URL is required' });
    }
    
    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user) {
      console.error('❌ User not found:', userId);
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if user already purchased special offer (production only - bypass in dev for testing)
    if (process.env.NODE_ENV === 'production') {
      const existingOffer = await prisma.creditTransaction.findFirst({
        where: {
          userId,
          description: { contains: 'Special Offer: AI Model' }
        }
      });
      
      if (existingOffer) {
        return res.status(400).json({ error: 'You have already used the special offer' });
      }
    }
    
    // Special offer price: $6 (normally $10 for AI model)
    const specialOfferPrice = 600; // in cents
    const bonusCredits = 250; // Bonus credits with special offer
    
    // Create or retrieve Stripe customer
    let customerId = user.stripeCustomerId;
    
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          userId: user.id,
        },
      });
      customerId = customer.id;
      
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId }
      });
    }
    
    // Auto-detect correct frontend URL
    const frontendUrl = getTrustedFrontendUrl(req);
    
    // Create one-time payment checkout session for special offer
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      client_reference_id: safeReferralId || undefined,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'AI Model Creation - Special Offer',
              description: `Create your AI model + ${bonusCredits} bonus credits (Save $4!)`,
            },
            unit_amount: specialOfferPrice,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${frontendUrl}/onboarding?session_id={CHECKOUT_SESSION_ID}&offer=success`,
      cancel_url: `${frontendUrl}/onboarding?offer=cancelled`,
      metadata: (() => {
        const m = {
          userId: user.id,
          type: 'special-offer-ai-model',
          bonusCredits: bonusCredits.toString(),
        };
        setChunkedString(m, 'referenceUrl', referenceUrl);
        setChunkedString(m, 'aiConfig', JSON.stringify(aiConfig || {}));
        return m;
      })(),
    });

    console.log('✅ Special offer checkout session created:', session.id);
    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('❌ Special offer checkout error:', error.message);
    res.status(500).json({ error: 'Failed to create checkout session. Please try again.' });
  }
});

// Verify special offer session and create AI model
router.post('/verify-special-offer', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.body;
    const userId = req.user.userId;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    console.log('🔍 Verifying special offer session:', sessionId);

    // Retrieve session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    if (String(session.metadata.userId) !== String(userId)) {
      return res.status(403).json({ error: 'Session does not belong to this user' });
    }

    if (session.metadata.type !== 'special-offer-ai-model') {
      return res.status(400).json({ error: 'Invalid session type' });
    }

    const referenceUrl = getChunkedString(session.metadata, 'referenceUrl');
    const aiConfig = parseSpecialOfferAiConfigFromMetadata(session.metadata);
    const bonusCredits = parseInt(session.metadata.bonusCredits || '250');
    const modelName = aiConfig.modelName || 'My AI Model';
    const parsedAge = Number.parseInt(aiConfig?.age, 10);
    const safeAge = Number.isFinite(parsedAge) && parsedAge >= 1 && parsedAge <= 120 ? parsedAge : null;
    const safeAppearance = {
      gender: aiConfig?.gender || "",
      hairColor: aiConfig?.hairColor || "",
      hairLength: aiConfig?.hairLength || "",
      hairTexture: aiConfig?.hairTexture || "",
      lipSize: aiConfig?.lipSize || "",
      faceType: aiConfig?.faceType || "",
      eyeColor: aiConfig?.eyeColor || "",
      style: aiConfig?.style || "",
      bodyType: aiConfig?.bodyType || "",
      heritage: aiConfig?.heritage || "",
    };

    // Check if already processed (prevents double API calls)
    const existingTransaction = await prisma.creditTransaction.findFirst({
      where: { paymentSessionId: sessionId }
    });
    
    if (existingTransaction) {
      console.log('✅ Special offer already processed for session', sessionId);
      let model = await prisma.savedModel.findFirst({
        where: { userId, paymentIntentId: sessionId }
      });
      if (!model) {
        model = await prisma.savedModel.findFirst({
          where: { userId },
          orderBy: { createdAt: 'desc' }
        });
      }
      return res.json({ 
        success: true, 
        message: 'Offer already processed',
        alreadyProcessed: true,
        model
      });
    }

    const photo1Url = referenceUrl;
    
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        await tx.creditTransaction.create({
          data: {
            userId,
            amount: 0,
            type: 'special_offer_model_fulfillment',
            description: 'Special Offer: AI Model fulfillment',
            paymentSessionId: sessionId
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
            paymentIntentId: sessionId,
            savedAppearance: safeAppearance,
            ...(safeAge ? { age: safeAge } : {}),
          }
        });

        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: {
            onboardingCompleted: true,
            hasUsedFreeTrial: true
          }
        });

        return { model, user: updatedUser };
      });

      console.log('✅ Special offer fulfilled! Model created:', result.model.id);
      await recordReferralCommissionFromPayment({
        referredUserId: userId,
        purchaseAmountCents: session.amount_total || 0,
        sourceType: "stripe_checkout_session",
        sourceId: sessionId,
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

      res.json({ 
        success: true, 
        model: result.model,
        modelStatus: 'generating',
        credits: result.user.purchasedCredits + (result.user.subscriptionCredits || 0) + (result.user.credits || 0),
        bonusCreditsPending: bonusCredits
      });
    } catch (error) {
      if (error.code === 'P2002') {
        console.log('✅ Special offer already processed for session', sessionId);
        
        let model = await prisma.savedModel.findFirst({
          where: { userId, paymentIntentId: sessionId }
        });
        if (!model) {
          model = await prisma.savedModel.findFirst({
            where: { userId },
            orderBy: { createdAt: 'desc' }
          });
        }
        
        return res.json({ 
          success: true, 
          message: 'Offer already processed',
          alreadyProcessed: true,
          model
        });
      }
      throw error;
    }
    
    console.log('🎨 Starting background full model generation (same pipeline as basic AI generate)...');
    
    generateModelPosesFromReference(referenceUrl, {
      ...aiConfig,
      outfitType: aiConfig?.style || 'casual',
      poseStyle: aiConfig?.poseStyle || 'natural',
    }).then(async (posesResult) => {
      try {
        if (posesResult.success && posesResult.photos) {
          const readyResult = await finalizeSpecialOfferModelReady(result.model.id, {
            photo1Url: posesResult.photos.photo1Url || photo1Url,
            photo2Url: posesResult.photos.photo2Url || photo1Url,
            photo3Url: posesResult.photos.photo3Url || photo1Url,
          });
          console.log(`🎁 Special offer completion bonus awarded: ${readyResult.awarded}`);
          console.log('✅ Model updated with full 3-photo output:', result.model.id);
        } else {
          const readyResult = await finalizeSpecialOfferModelReady(result.model.id);
          console.log(`🎁 Special offer completion bonus awarded: ${readyResult.awarded}`);
          console.warn('⚠️ Full model generation failed, model ready with reference photos:', posesResult.error);
        }
      } catch (updateError) {
        console.error('❌ Failed to update model with poses:', updateError.message);
      }
    }).catch((error) => {
      console.error('❌ Background pose generation error:', error.message);
      finalizeSpecialOfferModelReady(result.model.id).catch(console.error);
    });

  } catch (error) {
    console.error('❌ Special offer verification error:', error.message);
    res.status(500).json({ error: 'Failed to verify payment. Please contact support.' });
  }
});

// NOTE: Webhook handler moved to stripe.webhook.js
// It needs to be mounted BEFORE express.json() in server.js
// to preserve raw body for signature verification

// Get subscription status
router.get('/subscription-status', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get full user from database
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.stripeSubscriptionId) {
      return res.json({ 
        hasSubscription: false,
        status: null,
        tier: null
      });
    }

    const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);

    res.json({
      hasSubscription: true,
      status: subscription.status,
      tier: user.subscriptionTier,
      currentPeriodEnd: subscription.current_period_end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end
    });
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    res.status(500).json({ error: 'Failed to fetch subscription status' });
  }
});

// Cancel subscription
router.post('/cancel-subscription', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    console.log('🔴 Cancel subscription request for user:', userId);
    
    // Get full user from database
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user) {
      console.log('❌ User not found:', userId);
      return res.status(404).json({ error: 'User not found' });
    }

    console.log('📋 User subscription ID:', user.stripeSubscriptionId);

    if (!user.stripeSubscriptionId) {
      console.log('❌ No subscription ID found');
      return res.status(400).json({ error: 'No active subscription found' });
    }

    // Cancel at period end (don't immediately revoke access)
    console.log('🔄 Calling Stripe to cancel subscription:', user.stripeSubscriptionId);
    const subscription = await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: true
    });

    console.log('✅ Subscription cancelled successfully:', {
      id: subscription.id,
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodEnd: subscription.current_period_end
    });

    res.json({ 
      success: true,
      message: 'Subscription will be cancelled at the end of the billing period',
      currentPeriodEnd: subscription.current_period_end
    });
  } catch (error) {
    console.error('❌ Error cancelling subscription:', error.message);
    console.error('❌ Full error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Create Customer Portal session for subscription management
router.post('/create-portal-session', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.stripeCustomerId) {
      return res.status(400).json({ error: 'No Stripe customer found' });
    }

    // Auto-detect correct return URL
    const returnUrl = getTrustedFrontendUrl(req);

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${returnUrl}/settings`,
    });

    console.log('✅ Customer Portal session created:', portalSession.url);
    res.json({ url: portalSession.url });
  } catch (error) {
    console.error('❌ Error creating portal session:', error.message);
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// Verify checkout session and add credits (for when webhooks don't work in dev)
router.post('/verify-session', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.body;
    const userId = req.user.userId;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    console.log('🔍 Verifying Stripe session:', sessionId);

    // Retrieve session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    console.log('📋 Session status:', session.payment_status, 'Type:', session.metadata.type, 'Subscription:', session.subscription);

    // Check if payment was successful
    if (session.payment_status !== 'paid') {
      const statusMessages = {
        'unpaid': 'Payment failed or was declined. Please try again with a different card.',
        'processing': 'Your payment is being processed. Please wait a moment and refresh the page.',
        'no_payment_required': 'No payment required for this session.'
      };
      
      const errorMessage = statusMessages[session.payment_status] || `Payment not completed (status: ${session.payment_status})`;
      return res.status(400).json({ error: errorMessage, paymentStatus: session.payment_status });
    }

    // Check if session belongs to this user
    if (String(session.metadata.userId) !== String(userId)) {
      return res.status(403).json({ error: 'Session does not belong to this user' });
    }

    // Get user to check if credits already added
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    const credits = normalizeCreditUnits(session.metadata.credits);
    const paymentType = session.metadata.type;
    const tierId = session.metadata.tierId;
    let billingCycle = session.metadata.billingCycle;
    if (
      paymentType !== "one-time" &&
      !billingCycle &&
      session.subscription &&
      typeof session.subscription === "string"
    ) {
      try {
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        billingCycle = resolveSubscriptionBillingCycle(sub);
      } catch (e) {
        console.warn("⚠️ verify-session: could not load subscription for billingCycle:", e.message);
      }
    }

    if (paymentType === 'one-time') {
      // ONE-TIME PURCHASE
      // Use atomic transaction with UNIQUE constraint to prevent race conditions
      try {
        const updatedUser = await prisma.$transaction(async (tx) => {
          // Insert transaction with UNIQUE session ID (fails if duplicate)
          await tx.creditTransaction.create({
            data: {
              userId,
              amount: credits,
              type: 'purchase',
              description: `One-time purchase: ${credits} credits`,
              paymentSessionId: sessionId  // UNIQUE constraint prevents duplicates
            }
          });

          // Only add credits if transaction insert succeeded
          return await tx.user.update({
            where: { id: userId },
            data: {
              purchasedCredits: {
                increment: credits
              }
            }
          });
        });

        console.log('✅ One-time credits added! New purchased balance:', updatedUser.purchasedCredits);
        const referrerUserId = session.metadata.referrerUserId || null;
        if (referrerUserId) {
          await linkReferrerOnFirstPurchase(userId, referrerUserId);
        }
        await recordReferralCommissionFromPayment({
          referredUserId: userId,
          purchaseAmountCents: session.amount_total || 0,
          sourceType: "stripe_checkout_session",
          sourceId: sessionId,
        });

        res.json({ 
          success: true, 
          credits: (updatedUser.credits || 0) + (updatedUser.subscriptionCredits || 0) + (updatedUser.purchasedCredits || 0),
          addedCredits: credits,
          paymentType: 'one-time'
        });
      } catch (error) {
        // If unique constraint violation, payment already processed
        if (error.code === 'P2002') {
          console.log('✅ Credits already added for this one-time purchase');
          return res.json({ 
            success: true, 
            message: 'Credits already added',
            alreadyProcessed: true,
            credits: (user.credits || 0) + (user.subscriptionCredits || 0) + (user.purchasedCredits || 0)
          });
        } else {
          throw error; // Re-throw other errors
        }
      }

    } else {
      // SUBSCRIPTION PURCHASE
      // Check if user has an old subscription (this is an upgrade)
      let oldSubscriptionId = null;
      if (user.stripeSubscriptionId && user.stripeSubscriptionId !== session.subscription) {
        oldSubscriptionId = user.stripeSubscriptionId;
        console.log(`🚀 UPGRADE: User had ${user.subscriptionTier}, upgrading to ${tierId}`);
        console.log(`📝 Old subscription to cancel: ${oldSubscriptionId}`);
      }

      // Use atomic transaction with UNIQUE constraint to prevent race conditions
      try {
        const subscriptionIdempotencyKey =
          typeof session.subscription === "string" && session.subscription
            ? session.subscription
            : sessionId;
        const updatedUser = await prisma.$transaction(async (tx) => {
          // Insert transaction with UNIQUE session ID (fails if duplicate)
          await tx.creditTransaction.create({
            data: {
              userId,
              amount: credits,
              type: 'purchase',
              description: `Subscription: ${tierId} plan`,
              paymentSessionId: subscriptionIdempotencyKey // align with webhook and confirm-subscription
            }
          });

          // Calculate credit expiration date based on billing cycle
          const expiryDate = new Date();
          if (billingCycle === 'annual') {
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);
          } else {
            expiryDate.setMonth(expiryDate.getMonth() + 1);
          }

          const priorVerify = await tx.user.findUnique({
            where: { id: userId },
            select: { subscriptionCredits: true },
          });
          const rolloverVerify = rolloverSubPoolToPurchasedUpdate(priorVerify?.subscriptionCredits);
          if (Object.keys(rolloverVerify).length) {
            console.log(
              `💾 verify-session subscription: rolling ${priorVerify?.subscriptionCredits || 0} subscription credits → purchased`,
            );
          }

          // Only update user if transaction insert succeeded
          return await tx.user.update({
            where: { id: userId },
            data: {
              ...rolloverVerify,
              stripeSubscriptionId: session.subscription,
              subscriptionTier: tierId,
              subscriptionStatus: 'active',
              subscriptionBillingCycle: billingCycle || 'monthly',
              subscriptionCredits: credits,
              creditsExpireAt: expiryDate,
            }
          });
        });

        console.log('✅ Subscription credits added! New subscription pool:', updatedUser.subscriptionCredits);
        const referrerUserId = session.metadata.referrerUserId || null;
        if (referrerUserId) {
          await linkReferrerOnFirstPurchase(userId, referrerUserId);
        }
        await recordReferralCommissionFromPayment({
          referredUserId: userId,
          purchaseAmountCents: session.amount_total || 0,
          sourceType: "stripe_checkout_session",
          sourceId: sessionId,
        });

        // NOW cancel the old subscription (AFTER new payment succeeded)
        if (oldSubscriptionId) {
          try {
            await stripe.subscriptions.cancel(oldSubscriptionId);
            console.log(`✅ Cancelled old subscription ${oldSubscriptionId} after successful upgrade`);
          } catch (cancelError) {
            console.error(`⚠️ Failed to cancel old subscription ${oldSubscriptionId}:`, cancelError.message);
            // Don't fail the response - the new subscription is already active
          }
        }

        res.json({ 
          success: true, 
          credits: (updatedUser.credits || 0) + (updatedUser.subscriptionCredits || 0) + (updatedUser.purchasedCredits || 0),
          addedCredits: credits,
          paymentType: 'subscription'
        });
      } catch (error) {
        // If unique constraint violation, payment already processed
        if (error.code === 'P2002') {
          console.log('✅ Credits already added for this subscription');
          return res.json({ 
            success: true, 
            message: 'Credits already added',
            alreadyProcessed: true,
            credits: (user.credits || 0) + (user.subscriptionCredits || 0) + (user.purchasedCredits || 0)
          });
        } else {
          throw error; // Re-throw other errors
        }
      }
    }

  } catch (error) {
    console.error('❌ Session verification error:', error.message);
    res.status(500).json({ error: 'Failed to verify payment. Please contact support if credits were not added.' });
  }
});

// Force sync subscription status from Stripe (safety valve)
router.get('/sync-subscription', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.stripeSubscriptionId) {
      return res.json({
        synced: true,
        subscriptionStatus: user.subscriptionStatus,
        subscriptionTier: user.subscriptionTier,
        message: 'No active Stripe subscription ID in DB'
      });
    }

    try {
      const stripeSubscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      const isReallyActive = ['active', 'trialing'].includes(stripeSubscription.status);

      if (!isReallyActive) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            subscriptionStatus: 'cancelled',
            stripeSubscriptionId: null,
            subscriptionTier: null,
            subscriptionBillingCycle: null,
            subscriptionCredits: 0,
            creditsExpireAt: null,
            subscriptionCancelledAt: new Date(),
          },
        });
        return res.json({
          synced: true,
          subscriptionStatus: 'cancelled',
          subscriptionTier: null,
          message: `Stripe subscription was ${stripeSubscription.status} — DB updated`
        });
      }

      return res.json({
        synced: true,
        subscriptionStatus: 'active',
        subscriptionTier: user.subscriptionTier,
        message: 'Subscription is active in Stripe — no changes needed'
      });
    } catch (syncError) {
      if (syncError.code === 'resource_missing') {
        await prisma.user.update({
          where: { id: userId },
          data: {
            subscriptionStatus: 'cancelled',
            stripeSubscriptionId: null,
            subscriptionTier: null,
            subscriptionBillingCycle: null,
            subscriptionCredits: 0,
            creditsExpireAt: null,
            subscriptionCancelledAt: new Date(),
          },
        });
        return res.json({
          synced: true,
          subscriptionStatus: 'cancelled',
          subscriptionTier: null,
          message: 'Subscription not found in Stripe (deleted) — DB cleared'
        });
      }
      throw syncError;
    }
  } catch (error) {
    console.error('❌ Sync subscription error:', error.message);
    res.status(500).json({ error: 'Failed to sync subscription status' });
  }
});

// Recovery: re-trigger model fulfillment for a paid but unfulfilled special offer
router.post('/recover-special-offer', authMiddleware, async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    const userId = req.user.userId;

    if (!paymentIntentId) {
      return res.status(400).json({ error: 'paymentIntentId is required' });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment was not successful' });
    }
    if (String(paymentIntent.metadata.userId) !== String(userId)) {
      return res.status(403).json({ error: 'This payment does not belong to your account' });
    }
    if (paymentIntent.metadata.type !== 'special-offer-ai-model') {
      return res.status(400).json({ error: 'This payment is not a special offer purchase' });
    }

    const existingModel = await prisma.savedModel.findFirst({
      where: { userId, paymentIntentId }
    });
    if (existingModel) {
      return res.json({
        success: true,
        message: 'Model already exists for this payment',
        model: existingModel,
        alreadyProcessed: true
      });
    }

    const referenceUrl = getChunkedString(paymentIntent.metadata, 'referenceUrl');
    const aiConfig = parseSpecialOfferAiConfigFromMetadata(paymentIntent.metadata);
    const bonusCredits = parseInt(paymentIntent.metadata.bonusCredits || '250');
    const modelName = aiConfig.modelName || 'My AI Model';
    const parsedAge = Number.parseInt(aiConfig?.age, 10);
    const safeAge = Number.isFinite(parsedAge) && parsedAge >= 1 && parsedAge <= 120 ? parsedAge : null;
    const safeAppearance = {
      gender: aiConfig?.gender || "",
      hairColor: aiConfig?.hairColor || "",
      hairLength: aiConfig?.hairLength || "",
      hairTexture: aiConfig?.hairTexture || "",
      lipSize: aiConfig?.lipSize || "",
      faceType: aiConfig?.faceType || "",
      eyeColor: aiConfig?.eyeColor || "",
      style: aiConfig?.style || "",
      bodyType: aiConfig?.bodyType || "",
      heritage: aiConfig?.heritage || "",
    };
    const photo1Url = referenceUrl;

    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        await tx.creditTransaction.create({
          data: {
            userId,
            amount: 0,
            type: 'special_offer_model_fulfillment',
            description: 'Special Offer: AI Model fulfillment (recovered)',
            paymentSessionId: paymentIntentId
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
            paymentIntentId,
            savedAppearance: safeAppearance,
            ...(safeAge ? { age: safeAge } : {}),
          }
        });

        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: {
            onboardingCompleted: true,
            hasUsedFreeTrial: true
          }
        });

        return { model, user: updatedUser };
      });
    } catch (txError) {
      if (txError.code === 'P2002') {
        const existingModel2 = await prisma.savedModel.findFirst({
          where: { userId, paymentIntentId }
        });
        return res.json({
          success: true,
          message: 'Model already exists for this payment',
          model: existingModel2,
          alreadyProcessed: true
        });
      }
      throw txError;
    }

    console.log(`✅ Special offer recovered for user ${userId}, model: ${result.model.id}`);

    try {
      const userRecord = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true }
      });
      if (userRecord?.email) {
        await sendSpecialOfferConfirmationEmail({
          to: userRecord.email,
          name: userRecord.name || 'there',
          modelName,
          creditsAwarded: bonusCredits,
        });
      }
    } catch (emailError) {
      console.error('⚠️ Failed to send recovery confirmation email:', emailError.message);
    }

    generateModelPosesFromReference(referenceUrl, {
      ...aiConfig,
      outfitType: aiConfig?.style || 'casual',
      poseStyle: aiConfig?.poseStyle || 'natural',
    }).then(async (posesResult) => {
      try {
        if (posesResult.success && posesResult.photos) {
          const readyResult = await finalizeSpecialOfferModelReady(result.model.id, {
            photo1Url: posesResult.photos.photo1Url || photo1Url,
            photo2Url: posesResult.photos.photo2Url || photo1Url,
            photo3Url: posesResult.photos.photo3Url || photo1Url,
          });
          console.log(`🎁 Special offer completion bonus awarded: ${readyResult.awarded}`);
        } else {
          const readyResult = await finalizeSpecialOfferModelReady(result.model.id);
          console.log(`🎁 Special offer completion bonus awarded: ${readyResult.awarded}`);
        }
      } catch (e) {
        console.error('❌ Recovery pose generation update failed:', e.message);
      }
    }).catch(() => {
      finalizeSpecialOfferModelReady(result.model.id).catch(console.error);
    });

    res.json({
      success: true,
      model: result.model,
      bonusCreditsPending: bonusCredits,
      message: 'Model creation recovered successfully'
    });
  } catch (error) {
    console.error('❌ Recovery error:', error.message);
    res.status(500).json({ error: 'Failed to recover special offer. Please contact support.' });
  }
});

export default router;
