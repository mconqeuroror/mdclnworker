import { useState, useEffect, useCallback, useRef } from 'react';
import { X, CreditCard, Lock, Zap, Check, Loader2, Sparkles, Bitcoin, ExternalLink, Tag } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, PaymentRequestButtonElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import confetti from 'canvas-confetti';
import api, { stripeAPI, cryptoAPI } from '../services/api';
import { useAuthStore } from '../store';
import { sound } from '../utils/sounds';
import { pollModelUntilReady } from '../utils/modelStatusPolling';

const stripePublicKey = import.meta.env.MODE === 'production'
  ? import.meta.env.VITE_STRIPE_PUBLIC_KEY
  : (import.meta.env.VITE_STRIPE_TEST_PUBLIC_KEY || import.meta.env.VITE_STRIPE_PUBLIC_KEY);

console.log('Stripe mode:', import.meta.env.MODE, 'Using key:', stripePublicKey?.substring(0, 12) + '...');

const stripePromise = loadStripe(stripePublicKey);
const PENDING_STRIPE_CONFIRMATION_KEY = "pendingStripeConfirmation";

function setPendingStripeConfirmation(payload) {
  try {
    localStorage.setItem(
      PENDING_STRIPE_CONFIRMATION_KEY,
      JSON.stringify({ ...payload, createdAt: Date.now() }),
    );
  } catch {
    // Ignore storage errors (private mode, quota exceeded, etc.)
  }
}

function clearPendingStripeConfirmation() {
  try {
    localStorage.removeItem(PENDING_STRIPE_CONFIRMATION_KEY);
  } catch {
    // Ignore
  }
}

const cardElementOptions = {
  style: {
    base: {
      fontSize: '16px',
      color: '#ffffff',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSmoothing: 'antialiased',
      '::placeholder': {
        color: '#6b7280',
      },
      iconColor: '#a855f7',
    },
    invalid: {
      color: '#ef4444',
      iconColor: '#ef4444',
    },
  },
  hidePostalCode: true,
};

function CheckoutForm({ item, itemType, onSuccess, onClose, paymentMethod, onSwitchMethod, referralCode: initialReferralCode = null }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cardComplete, setCardComplete] = useState(false);
  const [paymentRequest, setPaymentRequest] = useState(null);
  const [canMakePayment, setCanMakePayment] = useState(false);
  const [walletCheckComplete, setWalletCheckComplete] = useState(false);
  const [cryptoAvailable, setCryptoAvailable] = useState(false);
  const [generatingModel, setGeneratingModel] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [paymentAttempted, setPaymentAttempted] = useState(false);
  const [cardElementReady, setCardElementReady] = useState(false);
  const [stripeLoadTimedOut, setStripeLoadTimedOut] = useState(false);
  const [fallbackLoading, setFallbackLoading] = useState(false);
  const [referralCodeInput, setReferralCodeInput] = useState(initialReferralCode || '');
  const [discountCodeInput, setDiscountCodeInput] = useState('');
  const [discountValidation, setDiscountValidation] = useState(null);
  const [discountValidating, setDiscountValidating] = useState(false);
  const discountDebounceRef = useRef(null);
  const refreshUserCredits = useAuthStore((state) => state.refreshUserCredits);
  
  // Ref-based guard to prevent double-submission (faster than state update)
  const isSubmittingRef = useRef(false);

  // Store subscription ID for confirm step — declared early so it's available in all callbacks below
  const [pendingSubscriptionId, setPendingSubscriptionId] = useState(null);

  const displayPrice = itemType === 'subscription' 
    ? (item.billingCycle === 'annual' ? item.annualPrice : item.price)
    : item.price;
  const displayCredits = item.credits + (item.bonusCredits || 0);
  
  // Check if crypto is available (only for credit purchases, not subscriptions or special offer)
  const canUseCrypto = itemType === 'credits';

  // Helper to safely reset all payment states — declared before the useEffect that uses it
  const resetPaymentState = useCallback(() => {
    setLoading(false);
    setGeneratingModel(false);
    setPaymentSuccess(false);
    isSubmittingRef.current = false;
  }, []);

  // Helper to show error and reset state (so user can retry)
  const handlePaymentError = useCallback((message) => {
    console.error('❌ Payment error:', message);
    isSubmittingRef.current = false;
    setError(message);
    resetPaymentState();
  }, [resetPaymentState]);

  // Helper to finalize successful payment
  const finalizePayment = useCallback(async (confirmResult, isSpecialOffer = false) => {
    try {
      sound.playCashRegister();
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#a855f7', '#06b6d4', '#22c55e'],
      });
      
      await refreshUserCredits();
      
      const message = isSpecialOffer
        ? `Your AI Model is ready! ${confirmResult.credits} bonus credits added.`
        : itemType === 'subscription'
          ? `Welcome to ${item.name}! ${confirmResult.credits} credits added.`
          : `${confirmResult.credits} credits added!`;
      
      toast.success(message);
      isSubmittingRef.current = false;
      onSuccess?.(confirmResult);
      onClose();
    } catch (e) {
      // Even if toast/confetti fails, payment succeeded — just close
      console.warn('Finalize error (non-critical):', e);
      isSubmittingRef.current = false;
      onSuccess?.(confirmResult);
      onClose();
    }
  }, [refreshUserCredits, itemType, item, onSuccess, onClose]);

  useEffect(() => {
    if (canUseCrypto) {
      cryptoAPI.checkStatus().then(data => {
        setCryptoAvailable(data.available);
      }).catch(() => setCryptoAvailable(false));
    }
  }, [canUseCrypto]);

  useEffect(() => {
    if (!stripe || !displayPrice) return;

    const label = itemType === 'subscription'
      ? `${item.name} Plan`
      : itemType === 'special-offer'
        ? 'AI Model + Credits'
        : `${displayCredits} Credits`;

    const pr = stripe.paymentRequest({
      country: 'US',
      currency: 'usd',
      total: {
        label,
        amount: Math.round(displayPrice * 100),
      },
      requestPayerName: true,
      requestPayerEmail: true,
      // Prefer Apple Pay / Google Pay surfaces over Link for wallet flow.
      disableWallets: ['link'],
    });

    pr.canMakePayment().then(result => {
      setWalletCheckComplete(true);
      if (result) {
        console.log('Apple Pay / Google Pay available:', result);
        setPaymentRequest(pr);
        setCanMakePayment(true);
      } else {
        console.log('Apple Pay / Google Pay not available in this browser');
      }
    }).catch(() => setWalletCheckComplete(true));

    pr.on('paymentmethod', async (ev) => {
      // Hide wallet button after any attempt to prevent stale UI
      setPaymentAttempted(true);
      setLoading(true);
      setError(null);

      try {
        // PHASE 1: Create payment intent or subscription
        console.log('📝 Wallet: Creating payment...');
        let clientSecret;
        let subscriptionId = null;
        let paymentIntentId = null;

        if (itemType === 'subscription') {
          const response = await stripeAPI.createEmbeddedSubscription(item.id, item.billingCycle, referralCode || undefined, discountCode || undefined);
          clientSecret = response.clientSecret;
          subscriptionId = response.subscriptionId;
          setPendingSubscriptionId(subscriptionId);
          setPendingStripeConfirmation({ kind: "subscription", subscriptionId });
          console.log('📝 Wallet: Created embedded subscription:', subscriptionId);
        } else if (itemType === 'special-offer') {
          const response = await stripeAPI.createSpecialOfferIntent(item.referenceUrl, item.aiConfig);
          clientSecret = response.clientSecret;
          paymentIntentId = response.paymentIntentId || null;
          setPendingStripeConfirmation({ kind: "special-offer", paymentIntentId });
        } else {
          const response = await stripeAPI.createPaymentIntent(item.credits, referralCode || undefined, discountCode || undefined);
          clientSecret = response.clientSecret;
          paymentIntentId = response.paymentIntentId || null;
          setPendingStripeConfirmation({ kind: "payment", paymentIntentId });
        }

        if (!clientSecret) {
          ev.complete('fail');
          setError('Failed to create payment. Please try again.');
          setLoading(false);
          return;
        }

        // PHASE 2: Confirm payment with wallet
        console.log('🔄 Wallet: Confirming payment...');
        let { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(
          clientSecret,
          { payment_method: ev.paymentMethod.id },
          { handleActions: false }
        );

        if (confirmError) {
          ev.complete('fail');
          setError(confirmError.message || 'Payment failed.');
          setLoading(false);
          return;
        }

        // Complete the wallet UI immediately
        ev.complete('success');

        // Handle 3D Secure if required (retry so Stripe can show the challenge)
        if (paymentIntent?.status === 'requires_action') {
          console.log('🔐 Wallet: 3D Secure required...');
          const returnUrl = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname || '/'}${window.location.search || ''}` : undefined;
          const { error: actionError, paymentIntent: confirmedIntent } = await stripe.confirmCardPayment(clientSecret, { return_url: returnUrl });
          if (actionError) {
            setError(actionError.message || 'Bank authentication failed.');
            setLoading(false);
            return;
          }
          paymentIntent = confirmedIntent;
          console.log('✅ Wallet: 3D Secure completed, status:', paymentIntent?.status);
        }

        if (!paymentIntent) {
          setError('Payment failed. Please try again.');
          setLoading(false);
          return;
        }

        // PHASE 3: Handle result
        console.log('🎯 Wallet: Processing result, status:', paymentIntent.status);

        if (paymentIntent.status === 'succeeded') {
          setPaymentSuccess(true);
          setLoading(false);

          let confirmResult;
          if (itemType === 'subscription' && subscriptionId) {
            confirmResult = await stripeAPI.confirmSubscription(subscriptionId);
          } else if (itemType === 'special-offer') {
            setGeneratingModel(true);
            confirmResult = await stripeAPI.confirmSpecialOffer(paymentIntent.id);
          } else {
            confirmResult = await stripeAPI.confirmPayment(paymentIntent.id);
          }
          console.log('Wallet payment confirmed:', confirmResult);

          clearPendingStripeConfirmation();
          await finalizePayment(confirmResult, itemType === 'special-offer');

        } else if (paymentIntent.status === 'processing') {
          setError('Your payment is being processed. Credits will be added automatically once confirmed.');
          setLoading(false);
        } else if (paymentIntent.status === 'requires_payment_method') {
          setError('Payment failed. Please try a different payment method.');
          setLoading(false);
        } else {
          setError(`Payment status: ${paymentIntent.status}. Please contact support if credits are not added.`);
          setLoading(false);
        }

      } catch (err) {
        console.error('Wallet payment error:', err);
        ev.complete('fail');
        const errorMsg = err.response?.data?.error || err.message || 'Payment failed';
        clearPendingStripeConfirmation();
        setError(errorMsg);
        setLoading(false);
        setGeneratingModel(false);
        setPaymentSuccess(false);
      }
    });

    return () => {
      pr.off('paymentmethod');
    };
  }, [stripe, displayPrice, itemType, item, displayCredits, finalizePayment]);

  const referralCode = referralCodeInput.trim() || null;
  const discountCode = discountValidation?.valid ? discountCodeInput.trim() : null;

  useEffect(() => {
    if (discountDebounceRef.current) clearTimeout(discountDebounceRef.current);
    const code = discountCodeInput.trim();
    if (!code) {
      setDiscountValidation(null);
      setDiscountValidating(false);
      return;
    }
    if (code.length < 3) return;
    setDiscountValidating(true);
    discountDebounceRef.current = setTimeout(async () => {
      try {
        const purchaseType = itemType === 'subscription' ? 'subscription' : 'credits';
        const amountCents = Math.round(displayPrice * 100);
        const result = await stripeAPI.validateDiscountCode(code, purchaseType, amountCents);
        setDiscountValidation({ valid: true, ...result });
      } catch (err) {
        setDiscountValidation({ valid: false, error: err.response?.data?.error || 'Invalid code' });
      } finally {
        setDiscountValidating(false);
      }
    }, 600);
    return () => { if (discountDebounceRef.current) clearTimeout(discountDebounceRef.current); };
  }, [discountCodeInput, itemType, displayPrice]);

  useEffect(() => {
    // If Stripe hasn't loaded after a short window, expose hosted-checkout fallback.
    if (paymentMethod !== 'card' || paymentSuccess || generatingModel) return;
    if (stripe) {
      setStripeLoadTimedOut(false);
      return;
    }
    const t = setTimeout(() => {
      setStripeLoadTimedOut(true);
    }, 5000);
    return () => clearTimeout(t);
  }, [stripe, paymentMethod, paymentSuccess, generatingModel]);

  const handleCardSubmit = async (e) => {
    e.preventDefault();
    
    // Synchronous guard to prevent double-submission (before React state updates)
    if (isSubmittingRef.current) {
      console.log('⚠️ Payment already in progress, ignoring duplicate submit');
      return;
    }
    isSubmittingRef.current = true;
    
    if (!stripe || !elements) {
      isSubmittingRef.current = false;
      return;
    }

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      isSubmittingRef.current = false;
      return;
    }

    // PHASE 1: Initialize and create payment intent or subscription
    setLoading(true);
    setError(null);
    setPaymentAttempted(true);

    let clientSecret;
    let subscriptionId = null;
    let paymentIntentId = null;

    try {
      console.log('📝 Phase 1: Creating payment/subscription...');
      
      if (itemType === 'subscription') {
        const response = await stripeAPI.createEmbeddedSubscription(item.id, item.billingCycle, referralCode || undefined, discountCode || undefined);
        clientSecret = response.clientSecret;
        subscriptionId = response.subscriptionId;
        setPendingSubscriptionId(subscriptionId);
        setPendingStripeConfirmation({ kind: "subscription", subscriptionId });
        console.log('📝 Created embedded subscription:', subscriptionId);
      } else if (itemType === 'special-offer') {
        const response = await stripeAPI.createSpecialOfferIntent(item.referenceUrl, item.aiConfig);
        clientSecret = response.clientSecret;
        paymentIntentId = response.paymentIntentId || null;
        setPendingStripeConfirmation({ kind: "special-offer", paymentIntentId });
      } else {
        const response = await stripeAPI.createPaymentIntent(item.credits, referralCode || undefined, discountCode || undefined);
        clientSecret = response.clientSecret;
        paymentIntentId = response.paymentIntentId || null;
        setPendingStripeConfirmation({ kind: "payment", paymentIntentId });
      }

      if (!clientSecret) {
        clearPendingStripeConfirmation();
        throw new Error('Failed to create payment. Please try again.');
      }
    } catch (err) {
      console.error('❌ Phase 1 failed:', err);
      const data = err.response?.data;
      const errorMsg =
        (typeof data?.error === 'string' && data.error) ||
        (typeof data?.message === 'string' && data.message) ||
        err.message ||
        'Failed to create payment. Please try again.';
      clearPendingStripeConfirmation();
      handlePaymentError(errorMsg);
      return;
    }

    // PHASE 2: Confirm payment with Stripe (handles 3D Secure in-modal or redirect)
    let paymentIntent;

    try {
      console.log('🔄 Phase 2: Confirming card payment...');
      const confirmOptions = {
        payment_method: { card: cardElement },
        return_url: typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname || '/'}${window.location.search || ''}` : undefined,
      };
      let result = await stripe.confirmCardPayment(clientSecret, confirmOptions);

      if (result.error) {
        let errorMessage = result.error.message;
        if (result.error.code === 'payment_intent_authentication_failure') {
          errorMessage = 'Bank authentication failed. Please try again or use a different card.';
        } else if (result.error.code === 'card_declined') {
          errorMessage = 'Your card was declined. Please try a different card.';
        }
        handlePaymentError(errorMessage);
        return;
      }

      paymentIntent = result.paymentIntent;

      if (!paymentIntent) {
        handlePaymentError('Payment failed. Please try again.');
        return;
      }

      // If 3D Secure was required but the challenge didn't complete (e.g. popup blocked), retry once
      // so Stripe can show the authentication modal again
      if (paymentIntent.status === 'requires_action') {
        console.log('🔐 3D Secure required – retrying to show bank verification...');
        result = await stripe.confirmCardPayment(clientSecret, {
          return_url: typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname || '/'}${window.location.search || ''}` : undefined,
        });
        if (result.error) {
          handlePaymentError(result.error.message || 'Bank verification failed. Please allow popups or try hosted checkout.');
          return;
        }
        paymentIntent = result.paymentIntent;
      }

      console.log('📋 Phase 2 complete - Status:', paymentIntent.status);

    } catch (err) {
      console.error('❌ Phase 2 failed:', err);
      handlePaymentError(err.message || 'Payment failed. Please try again.');
      return;
    }

    // PHASE 3: Handle payment result based on status
    try {
      console.log('🎯 Phase 3: Processing payment result...');

      switch (paymentIntent.status) {
        case 'succeeded':
          // Payment complete! Now add credits
          console.log('✅ Payment succeeded! Confirming credits...');
          
          // Show success state immediately (prevents "stuck" feeling)
          setPaymentSuccess(true);
          setLoading(false);

          if (itemType === 'subscription' && subscriptionId) {
            // Confirm embedded subscription - updates user record with subscription details
            console.log('📝 Confirming subscription:', subscriptionId);
            const confirmResult = await stripeAPI.confirmSubscription(subscriptionId);
            console.log('Subscription confirmed:', confirmResult);
            clearPendingStripeConfirmation();
            await finalizePayment(confirmResult, false);
          } else if (itemType === 'special-offer') {
            // Special offer: create AI model
            await new Promise(resolve => setTimeout(resolve, 1000));
            setGeneratingModel(true);

            const confirmResult = await stripeAPI.confirmSpecialOffer(paymentIntent.id);
            console.log('Special offer confirmed:', confirmResult);

            // Poll for model if needed
            if (confirmResult.modelStatus === 'generating' && confirmResult.model?.id) {
              const modelId = confirmResult.model.id;
              const pollResult = await pollModelUntilReady({
                apiClient: api,
                modelId,
                maxAttempts: 240,
                intervalMs: 2000,
              });
              if (pollResult.ready && pollResult.model) {
                confirmResult.model = pollResult.model;
              }
            }

            await finalizePayment(confirmResult, true);

          } else {
            // Regular credits
            const confirmResult = await stripeAPI.confirmPayment(paymentIntent.id);
            console.log('Payment confirmed:', confirmResult);
            clearPendingStripeConfirmation();
            await finalizePayment(confirmResult, false);
          }
          break;

        case 'processing':
          // Payment is processing async - inform user
          handlePaymentError('Your payment is being processed. Credits will be added automatically once confirmed.');
          break;

        case 'requires_action':
          handlePaymentError(
            'Bank authentication (3D Secure) is required. Please allow popups for this site and try again, or use "Continue in Secure Hosted Checkout" below.'
          );
          break;

        case 'requires_payment_method':
          // Card declined
          handlePaymentError('Payment failed. Please try a different card.');
          break;

        default:
          // Unknown status
          handlePaymentError(`Payment status: ${paymentIntent.status}. Please contact support if credits are not added.`);
      }

    } catch (err) {
      console.error('❌ Phase 3 failed:', err);
      // Payment may have succeeded but confirmation failed - inform user
      const message = paymentIntent?.status === 'succeeded'
        ? 'Payment received but confirmation failed. Please check your credits or contact support.'
        : err.message || 'Payment failed. Please try again.';
      handlePaymentError(message);
    }
  };

  const [cryptoPending, setCryptoPending] = useState(false);
  const [cryptoInvoiceUrl, setCryptoInvoiceUrl] = useState(null);

  const handleCryptoSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await cryptoAPI.createPayment(
        item.credits, 
        itemType === 'special-offer' ? 'special-offer' : 'credits'
      );

      if (response.success && response.invoiceUrl) {
        // Store pending payment info
        localStorage.setItem('pendingCryptoPayment', JSON.stringify({
          invoiceId: response.invoiceId,
          credits: item.credits,
          type: itemType,
          timestamp: Date.now()
        }));
        
        setCryptoInvoiceUrl(response.invoiceUrl);
        setCryptoPending(true);
        window.open(response.invoiceUrl, '_blank');
      } else {
        setError('Failed to create crypto payment');
      }
    } catch (err) {
      console.error('Crypto payment error:', err);
      setError(err.response?.data?.error || 'Failed to create crypto payment');
    } finally {
      setLoading(false);
    }
  };

  const handleCryptoComplete = async () => {
    // Refresh credits to check if payment was completed
    await refreshUserCredits();
    localStorage.removeItem('pendingCryptoPayment');
    toast.success('Credits will be added once payment is confirmed!');
    onClose();
  };

  const handleHostedCheckoutFallback = async () => {
    setFallbackLoading(true);
    setError(null);

    try {
      if (itemType === 'subscription') {
        const response = await stripeAPI.createCheckoutSession(item.id, item.billingCycle, referralCode || undefined, discountCode || undefined);
        if (!response?.url) throw new Error('No checkout URL returned');
        window.location.href = response.url;
        return;
      }

      if (itemType === 'credits') {
        const response = await stripeAPI.createOneTimeCheckout(item.credits, referralCode || undefined, discountCode || undefined);
        if (!response?.url) throw new Error('No checkout URL returned');
        window.location.href = response.url;
        return;
      }

      throw new Error('Fallback checkout is unavailable for this product type');
    } catch (err) {
      console.error('Hosted checkout fallback error:', err);
      setError(err.response?.data?.error || err.message || 'Failed to redirect to secure checkout');
      setFallbackLoading(false);
    }
  };

  // Handle subscription checkout - redirect to Stripe Checkout
  const handleSubscriptionCheckout = async () => {
    setLoading(true);
    setError(null);
    
    try {
      console.log('🔷 Creating Stripe Checkout session for subscription...');
      const response = await stripeAPI.createCheckoutSession(item.id, item.billingCycle, referralCode || undefined, discountCode || undefined);
      
      if (response.url) {
        // Redirect to Stripe Checkout
        window.location.href = response.url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      console.error('Subscription checkout error:', err);
      setError(err.response?.data?.error || err.message || 'Failed to start checkout. Please try again.');
      setLoading(false);
    }
  };

  return (
    <form onSubmit={paymentMethod === 'crypto' ? handleCryptoSubmit : handleCardSubmit} className="space-y-4 sm:space-y-6" translate="no">
      <div className="bg-white/[0.03] border border-white/10 rounded-xl sm:rounded-2xl p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3 sm:mb-4">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-white">
              {itemType === 'subscription' ? item.name : itemType === 'special-offer' ? 'Special Offer' : 'Credit Pack'}
            </h3>
            <p className="text-xs sm:text-sm text-slate-400">
              {itemType === 'subscription' 
                ? `${item.billingCycle === 'annual' ? 'Annual' : 'Monthly'} plan`
                : itemType === 'special-offer' 
                  ? 'AI Model + Credits'
                  : 'One-time purchase'}
            </p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1 sm:gap-1.5">
              <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-cyan-400" />
              <span className="text-xl sm:text-2xl font-bold text-white">{displayCredits.toLocaleString()}</span>
            </div>
            <p className="text-[10px] sm:text-xs text-slate-500">credits</p>
          </div>
        </div>
        
        <div className="border-t border-white/10 pt-3 sm:pt-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm sm:text-base text-slate-400">Total</span>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl sm:text-3xl font-bold text-white">${displayPrice}</span>
              {itemType === 'subscription' && (
                <span className="text-xs sm:text-sm text-slate-500">
                  /{item.billingCycle === 'annual' ? 'yr' : 'mo'}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Payment Method Selector - Wallet (Apple Pay / Google Pay), Card, and optionally Crypto */}
      {!paymentSuccess && !generatingModel && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onSwitchMethod('wallet')}
            className={`flex-1 min-w-0 py-2.5 px-3 rounded-lg border transition-all flex items-center justify-center gap-2 text-sm font-medium ${
              paymentMethod === 'wallet'
                ? 'bg-white/15 border-white/40 text-white'
                : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20'
            }`}
            data-testid="button-pay-wallet"
          >
            <span className="truncate">Apple Pay / Google Pay</span>
          </button>
          <button
            type="button"
            onClick={() => onSwitchMethod('card')}
            className={`flex-1 min-w-0 py-2.5 px-3 rounded-lg border transition-all flex items-center justify-center gap-2 text-sm font-medium ${
              paymentMethod === 'card'
                ? 'bg-white/15 border-white/40 text-white'
                : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20'
            }`}
            data-testid="button-pay-card"
          >
            <CreditCard className="w-4 h-4 flex-shrink-0" />
            Card
          </button>
          {canUseCrypto && cryptoAvailable && (
            <button
              type="button"
              onClick={() => onSwitchMethod('crypto')}
              className={`flex-1 min-w-0 py-2.5 px-3 rounded-lg border transition-all flex items-center justify-center gap-2 text-sm font-medium ${
                paymentMethod === 'crypto'
                  ? 'bg-orange-500/20 border-orange-500 text-white'
                  : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20'
              }`}
              data-testid="button-pay-crypto"
            >
              <Bitcoin className="w-4 h-4 flex-shrink-0" />
              Crypto
            </button>
          )}
        </div>
      )}

      {/* Payment Success & Model Generation State */}
      {(paymentSuccess || generatingModel) && (
        <div className="bg-white/[0.04] border border-white/15 rounded-xl p-6 space-y-4">
          {paymentSuccess && !generatingModel && (
            <>
              <div className="flex items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
                  <Check className="w-8 h-8 text-green-400" />
                </div>
              </div>
              <div className="text-center">
                {itemType === 'subscription' ? (
                  <>
                    <h4 className="text-lg font-semibold text-white">Welcome to {item.name}!</h4>
                    <p className="text-sm text-slate-400 mt-1">{displayCredits} credits have been added to your account</p>
                  </>
                ) : itemType === 'credits' ? (
                  <>
                    <h4 className="text-lg font-semibold text-white">Credits Added!</h4>
                    <p className="text-sm text-slate-400 mt-1">{displayCredits} credits have been added to your account</p>
                  </>
                ) : (
                  <>
                    <h4 className="text-lg font-semibold text-white">Payment Successful!</h4>
                    <p className="text-sm text-slate-400 mt-1">Preparing to create your AI model...</p>
                  </>
                )}
              </div>
            </>
          )}
          {generatingModel && (
            <>
              <div className="flex items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-white/70 animate-spin" />
                </div>
              </div>
              <div className="text-center">
                <h4 className="text-lg font-semibold text-white">Creating Your AI Model</h4>
                <p className="text-sm text-slate-400 mt-1">This may take 1-2 minutes. Please wait...</p>
              </div>
              <div className="bg-white/5 rounded-lg p-3 space-y-2">
                <p className="text-xs text-slate-300 flex items-center gap-2">
                  <Check className="w-3 h-3 text-green-400" />
                  <span>Payment confirmed</span>
                </p>
                <p className="text-xs text-slate-300 flex items-center gap-2">
                  <Check className="w-3 h-3 text-green-400" />
                  <span>250 bonus credits added</span>
                </p>
                <p className="text-xs text-slate-300 flex items-center gap-2">
                  <Loader2 className="w-3 h-3 text-white/60 animate-spin" />
                  <span>Generating AI model photos...</span>
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Crypto Payment Pending State */}
      {cryptoPending && !(paymentSuccess || generatingModel) && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
              <Loader2 className="w-5 h-5 text-orange-400 animate-spin" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white">Payment Window Opened</h4>
              <p className="text-xs text-slate-400">Complete payment in the new tab</p>
            </div>
          </div>
          
          <div className="bg-white/5 rounded-lg p-3 space-y-2">
            <p className="text-xs text-slate-300">
              <span className="text-orange-400 font-medium">Step 1:</span> Select your cryptocurrency in the payment window
            </p>
            <p className="text-xs text-slate-300">
              <span className="text-orange-400 font-medium">Step 2:</span> Send the exact amount to the provided address
            </p>
            <p className="text-xs text-slate-300">
              <span className="text-orange-400 font-medium">Step 3:</span> Wait for blockchain confirmation (usually 5-30 min)
            </p>
          </div>

          <p className="text-[10px] text-slate-500 text-center">
            Your credits will be added automatically once payment is confirmed. You can close this window.
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => window.open(cryptoInvoiceUrl, '_blank')}
              className="flex-1 py-2.5 rounded-lg bg-orange-500/20 border border-orange-500/30 text-orange-400 text-sm font-medium flex items-center justify-center gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              Reopen Payment
            </button>
            <button
              type="button"
              onClick={handleCryptoComplete}
              className="flex-1 py-2.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-sm font-medium"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Wallet-only view (Apple Pay / Google Pay) - always show this option */}
      {!cryptoPending && !paymentSuccess && !generatingModel && paymentMethod === 'wallet' && (
        <div className="space-y-3">
          {!walletCheckComplete && (
            <div className="py-6 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center gap-2 text-slate-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Checking Apple Pay / Google Pay…
            </div>
          )}
          {walletCheckComplete && canMakePayment && paymentRequest && !paymentAttempted && (
            <div className="space-y-2">
              <p className="text-xs text-slate-400 text-center">One-tap pay with your saved card</p>
              <PaymentRequestButtonElement
                options={{
                  paymentRequest,
                  style: {
                    paymentRequestButton: {
                      type: 'default',
                      theme: 'dark',
                      height: '48px',
                    },
                  },
                }}
              />
            </div>
          )}
          {walletCheckComplete && !canMakePayment && (
            <div className="py-4 px-4 rounded-xl bg-white/5 border border-white/10 text-center">
              <p className="text-sm text-slate-300">Apple Pay / Google Pay not available in this browser.</p>
              <p className="text-xs text-slate-500 mt-1">Use <button type="button" onClick={() => onSwitchMethod('card')} className="underline text-slate-400 hover:text-white">Card</button> or try Safari (Apple Pay) / Chrome with a saved payment method.</p>
            </div>
          )}
          {walletCheckComplete && paymentAttempted && !paymentSuccess && (
            <p className="text-xs text-slate-500 text-center">Payment attempted. Use Card tab to retry or enter details.</p>
          )}
        </div>
      )}

      {/* Card Payment - For subscriptions, one-time credits, and special offer */}
      {!cryptoPending && !paymentSuccess && !generatingModel && paymentMethod === 'card' ? (
        <>
          {canMakePayment && paymentRequest && !error && !paymentAttempted && (
            <div className="space-y-3">
              <PaymentRequestButtonElement
                options={{
                  paymentRequest,
                  style: {
                    paymentRequestButton: {
                      type: 'default',
                      theme: 'dark',
                      height: '48px',
                    },
                  },
                }}
              />
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-xs text-slate-500">or pay with card</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>
            </div>
          )}

          <div className="space-y-2.5 sm:space-y-3">
            <label className="flex items-center gap-2 text-xs sm:text-sm font-medium text-slate-300">
              <CreditCard className="w-4 h-4" />
              Card Details
            </label>
            <div className="mb-3 space-y-2">
              <div>
                <label htmlFor="discount-code" className="block text-xs font-medium text-slate-400 mb-1.5">
                  <Tag className="w-3 h-3 inline mr-1" />
                  Discount code
                </label>
                <div className="relative">
                  <input
                    id="discount-code"
                    type="text"
                    placeholder="Enter promo code"
                    value={discountCodeInput}
                    onChange={(e) => setDiscountCodeInput(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-slate-500 text-sm focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/10 uppercase"
                    data-testid="input-discount-code"
                  />
                  {discountValidating && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 animate-spin" />
                  )}
                  {!discountValidating && discountValidation?.valid && (
                    <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400" />
                  )}
                  {!discountValidating && discountValidation && !discountValidation.valid && (
                    <X className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-400" />
                  )}
                </div>
                {discountValidation?.valid && (
                  <p className="text-xs text-green-400 mt-1" data-testid="text-discount-applied">
                    {discountValidation.discountType === 'percentage'
                      ? `${discountValidation.discountValue}% off applied`
                      : `$${discountValidation.discountValue} off applied`}
                    {' '}&mdash; You pay ${(discountValidation.finalAmountCents / 100).toFixed(2)}
                  </p>
                )}
                {discountValidation && !discountValidation.valid && (
                  <p className="text-xs text-red-400 mt-1" data-testid="text-discount-error">{discountValidation.error}</p>
                )}
              </div>
              <div>
                <label htmlFor="referral-code" className="block text-xs font-medium text-slate-400 mb-1.5">
                  Referral code <span className="text-slate-500 font-normal">(5% off first purchase)</span>
                </label>
                <input
                  id="referral-code"
                  type="text"
                  placeholder="Enter code"
                  value={referralCodeInput}
                  onChange={(e) => setReferralCodeInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-slate-500 text-sm focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/10"
                />
              </div>
            </div>
            <div className="min-h-[46px] bg-white/5 border border-white/10 rounded-lg sm:rounded-xl p-3 sm:p-4 transition-all focus-within:border-white/30 focus-within:ring-1 focus-within:ring-white/10">
              <CardElement 
                options={cardElementOptions} 
                onChange={(e) => setCardComplete(e.complete)}
                onReady={() => {
                  setCardElementReady(true);
                  setStripeLoadTimedOut(false);
                }}
              />
            </div>
            {(stripeLoadTimedOut || (!cardElementReady && !stripe)) && (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3">
                <p className="text-xs text-amber-300">
                  Secure card field did not load. You can continue with hosted checkout.
                </p>
                {(itemType === 'subscription' || itemType === 'credits') && (
                  <button
                    type="button"
                    onClick={handleHostedCheckoutFallback}
                    disabled={fallbackLoading}
                    className="mt-2 w-full py-2.5 rounded-lg bg-amber-400/20 border border-amber-300/40 text-amber-200 text-sm font-semibold disabled:opacity-60"
                    data-testid="button-hosted-checkout-fallback"
                  >
                    {fallbackLoading ? 'Redirecting...' : 'Continue in Secure Hosted Checkout'}
                  </button>
                )}
              </div>
            )}
            {error && (
              <div className="space-y-2">
                <p className="text-xs sm:text-sm text-red-400 flex items-center gap-2">
                  <X className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </p>
                {(itemType === 'subscription' || itemType === 'credits') && (
                  <button
                    type="button"
                    onClick={handleHostedCheckoutFallback}
                    disabled={fallbackLoading}
                    className="w-full py-2 rounded-lg bg-white/5 border border-white/20 text-slate-300 text-xs sm:text-sm hover:bg-white/10 transition disabled:opacity-60"
                  >
                    {fallbackLoading ? 'Redirecting...' : 'Continue in secure hosted checkout instead'}
                  </button>
                )}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={!stripe || !cardComplete || loading}
            className="w-full py-3.5 sm:py-4 rounded-lg sm:rounded-xl font-semibold text-sm sm:text-base bg-white text-black hover:bg-white/90 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            data-testid="button-pay-now"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing...
              </>
            ) : itemType === 'subscription' ? (
              <>
                <Sparkles className="w-4 h-4" />
                Subscribe - ${displayPrice}/{item.billingCycle === 'annual' ? 'yr' : 'mo'}
              </>
            ) : (
              <>
                <Lock className="w-4 h-4" />
                Pay ${displayPrice}
              </>
            )}
          </button>

          {/* Recurring billing notice for subscriptions */}
          {itemType === 'subscription' && (
            <p className="text-xs text-center text-slate-500">
              Your subscription will automatically renew {item.billingCycle === 'annual' ? 'annually' : 'monthly'}. 
              You can cancel anytime in Settings.
            </p>
          )}
        </>
      ) : null}

      {/* Crypto Payment - For one-time only */}
      {!cryptoPending && !paymentSuccess && !generatingModel && paymentMethod === 'crypto' && itemType !== 'subscription' && (
        <>
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Bitcoin className="w-5 h-5 text-orange-400" />
              <span className="text-sm font-medium text-white">Pay with Cryptocurrency</span>
            </div>
            <p className="text-xs text-slate-400">
              Pay with BTC, ETH, USDT, SOL, and 100+ cryptocurrencies. You'll be redirected to complete the payment.
            </p>
            <div className="flex flex-wrap gap-2">
              {['BTC', 'ETH', 'USDT', 'SOL', 'DOGE'].map(coin => (
                <span key={coin} className="px-2 py-1 bg-white/5 rounded text-xs text-slate-300 font-mono">
                  {coin}
                </span>
              ))}
              <span className="px-2 py-1 bg-white/5 rounded text-xs text-slate-400">+100 more</span>
            </div>
          </div>

          {error && (
            <p className="text-xs sm:text-sm text-red-400 flex items-center gap-2">
              <X className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 sm:py-4 rounded-lg sm:rounded-xl font-semibold text-sm sm:text-base bg-gradient-to-r from-orange-500 to-yellow-500 text-white transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            data-testid="button-pay-crypto"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Creating payment...
              </>
            ) : (
              <>
                <ExternalLink className="w-4 h-4" />
                Pay ${displayPrice} with Crypto
              </>
            )}
          </button>
        </>
      )}

      {!cryptoPending && (
        <div className="flex items-center justify-center gap-3 sm:gap-4 text-[10px] sm:text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <Lock className="w-3 h-3" />
            Secure payment
          </span>
          <span className="flex items-center gap-1">
            <Check className="w-3 h-3" />
            {paymentMethod === 'crypto' ? 'No KYC required' : paymentMethod === 'wallet' ? 'Apple Pay · Google Pay' : '256-bit encryption'}
          </span>
        </div>
      )}
    </form>
  );
}

export default function CheckoutModal({ isOpen, onClose, item, itemType, onSuccess }) {
  const [isVisible, setIsVisible] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('card');

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setIsVisible(true));
      document.body.style.overflow = 'hidden';
      setPaymentMethod('card'); // Reset to card when opening
    } else {
      setIsVisible(false);
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const initialReferralCode = isOpen ? (() => {
    try { return localStorage.getItem('pendingReferralCode') || ''; } catch { return ''; }
  })() : '';

  const handleClose = useCallback(() => {
    setIsVisible(false);
    setTimeout(onClose, 200);
  }, [onClose]);

  if (!isOpen || !item) return null;

  const modalContent = (
    <div className="fixed inset-0 z-[100]" translate="no" onClick={(e) => e.target === e.currentTarget && handleClose()}>
      <div 
        className={`absolute inset-0 bg-black/90 backdrop-blur-sm transition-opacity duration-200 pointer-events-none ${isVisible ? 'opacity-100' : 'opacity-0'}`}
      />
      
      <div 
        className="absolute inset-0 overflow-y-auto overscroll-contain z-10"
        onClick={(e) => e.target === e.currentTarget && handleClose()}
      >
        <div className="min-h-full flex items-center justify-center p-3 sm:p-4">
          <div 
            className={`relative w-full max-w-md transition-all duration-300 ${
              isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-white/5 rounded-2xl sm:rounded-3xl blur-xl pointer-events-none" />
            
            <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl border border-white/15 bg-[#0b0f24]/92 backdrop-blur-2xl shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_10%_0%,rgba(139,92,246,0.22),transparent_45%),radial-gradient(90%_70%_at_100%_100%,rgba(56,189,248,0.14),transparent_45%)]" />
              <div className={`absolute top-0 left-0 right-0 h-1 ${
                paymentMethod === 'crypto' 
                  ? 'bg-gradient-to-r from-orange-500 to-yellow-500'
                  : 'bg-gradient-to-r from-violet-500/90 via-fuchsia-400/90 to-cyan-400/90'
              }`} />
              
              <div className="relative p-4 sm:p-6">
                <div className="flex items-center justify-between mb-4 sm:mb-6">
                  <div className="flex items-center gap-2.5 sm:gap-3">
                    <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0 ${
                      paymentMethod === 'crypto'
                        ? 'bg-gradient-to-br from-orange-500 to-yellow-500'
                        : 'bg-white/12 border border-white/20'
                    }`}>
                      {paymentMethod === 'crypto' ? (
                        <Bitcoin className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                      ) : (
                        <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                      )}
                    </div>
                    <div>
                      <h2 className="text-lg sm:text-xl font-bold text-white">Complete Purchase</h2>
                      <p className="text-[10px] sm:text-xs text-slate-500">Secure checkout</p>
                    </div>
                  </div>
                  <button
                    onClick={handleClose}
                    className="w-10 h-10 sm:w-9 sm:h-9 rounded-lg bg-white/8 border border-white/15 flex items-center justify-center active:bg-white/12 transition-colors flex-shrink-0"
                    data-testid="button-close-checkout"
                  >
                    <X className="w-5 h-5 text-slate-400" />
                  </button>
                </div>

                <Elements stripe={stripePromise}>
                  <CheckoutForm 
                    item={item} 
                    itemType={itemType}
                    onSuccess={onSuccess}
                    onClose={handleClose}
                    paymentMethod={paymentMethod}
                    onSwitchMethod={setPaymentMethod}
                    referralCode={initialReferralCode}
                  />
                </Elements>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
