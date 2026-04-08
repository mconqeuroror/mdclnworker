import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from './store';
import { queryClient } from './lib/queryClient';
import ErrorBoundary from './components/ErrorBoundary';
import { ErrorDisplay, showErrorDetails } from './components/ErrorDisplay';
import { setErrorDisplay, stripeAPI } from './services/api';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Info, X, Gift } from 'lucide-react';
import SplashScreen from './components/SplashScreen';
import { useBranding } from './hooks/useBranding';
import { sound } from './utils/sounds';
import { ThemeProvider } from './hooks/useTheme.jsx';

// Hook to check if Zustand has hydrated
function useHasHydrated() {
  return useSyncExternalStore(
    (callback) => useAuthStore.persist.onFinishHydration(callback),
    () => useAuthStore.persist.hasHydrated(),
    () => false
  );
}

// Pages
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import DashboardPage from './pages/DashboardPage';
import AdminPage from './pages/AdminPage';
import DesignerStudioPage from './pages/DesignerStudioPage';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';
import CookiesPage from './pages/CookiesPage';
import CreateAIModelLandingPageSk from './pages/CreateAIModelLandingPageSk';
import ReferralCapturePage from './pages/ReferralCapturePage';
import VoiceTestPage from './pages/VoiceTestPage';
import OnboardingPage from './pages/OnboardingPage';
import ReplicateTestPage from './pages/ReplicateTestPage';
import FaceRefTestPage from './pages/FaceRefTestPage';
import NSFWPage from './pages/NSFWPage';
import FreeCourseFunnelPage from './pages/FreeCourseFunnelPage';
import ContentReformatterPage from './pages/ContentReformatterPage';
import UpscalerPage from './pages/UpscalerPage';
import LanderNewPage from './pages/LanderNewPage';
import AdminLanderEditorPage from './pages/AdminLanderEditorPage';
import AdminLanderPreviewFrame from './pages/AdminLanderPreviewFrame';
import AdminAffiliateLanderEditorPage from './pages/AdminAffiliateLanderEditorPage';
import AdminAffiliateLanderPreviewFrame from './pages/AdminAffiliateLanderPreviewFrame';
import AffiliateLanderPublicPage from './pages/AffiliateLanderPublicPage';
import SupportChatButton from './components/SupportChatButton';
import AdminLoginPage from './pages/AdminLoginPage';
import ProLayout from './pages/Pro/ProLayout';
import ProDashboardPage from './pages/Pro/ProDashboardPage';
import ProModelsPage from './pages/Pro/ProModelsPage';
import ProNSFWPage from './pages/Pro/ProNSFWPage';
import ProGenerationPage from './pages/Pro/ProGenerationPage';
import toast from 'react-hot-toast';
import SeoRobotsMeta from './components/SeoRobotsMeta';

const LOCALE_STORAGE_KEY = "app_locale";
const APP_COPY = {
  en: {
    promoTitle: "New NSFW Model Launched",
    promoBodyPrefix: "Highest quality AI model on the market. Train your first LoRA and get",
    promoBodyHighlight: "free credits",
    promoBodySuffix: "instantly.",
    promoBonusPrefix: "Train your first LoRA =",
    promoBonusHighlight: "free credits bonus",
    promoDontShow: "Don't show again",
    promoTryNow: "Try it now",
    paymentComplete: "Payment complete! Your credits have been added.",
    bankVerificationFailed: "Bank verification failed. Please try payment again.",
    paymentConfirmFailed: "Payment confirmation failed. Please refresh your dashboard.",
  },
  ru: {
    promoTitle: "Запущена новая NSFW-модель",
    promoBodyPrefix: "Самая качественная ИИ-модель на рынке. Обучите первую LoRA и получите",
    promoBodyHighlight: "бесплатные кредиты",
    promoBodySuffix: "сразу.",
    promoBonusPrefix: "Обучите первую LoRA =",
    promoBonusHighlight: "бонус бесплатных кредитов",
    promoDontShow: "Больше не показывать",
    promoTryNow: "Попробовать",
    paymentComplete: "Платеж завершен! Кредиты добавлены на ваш баланс.",
    bankVerificationFailed: "Проверка банка не прошла. Пожалуйста, попробуйте оплату снова.",
    paymentConfirmFailed: "Не удалось подтвердить оплату. Обновите панель управления.",
  },
};

function resolveLocale() {
  try {
    const qsLang = new URLSearchParams(window.location.search).get("lang");
    const normalizedQs = String(qsLang || "").toLowerCase();
    if (normalizedQs === "ru" || normalizedQs === "en") {
      localStorage.setItem(LOCALE_STORAGE_KEY, normalizedQs);
      return normalizedQs;
    }
    const saved = String(localStorage.getItem(LOCALE_STORAGE_KEY) || "").toLowerCase();
    if (saved === "ru" || saved === "en") return saved;
    const browser = String(navigator.language || "").toLowerCase();
    return browser.startsWith("ru") ? "ru" : "en";
  } catch {
    return "en";
  }
}

function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage-denied/quota errors (common on strict mobile privacy modes).
  }
}

function safeLocalStorageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore
  }
}

function LoraPromoBanner() {
  const copy = APP_COPY[resolveLocale()] || APP_COPY.en;
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const [visible, setVisible] = useState(false);

  const userPromoDismissKey = user?.id ? `loraPromo_dismissed_${user.id}` : null;

  useEffect(() => {
    if (!isAuthenticated) return;
    // Only show on /dashboard
    if (!window.location.pathname.startsWith("/dashboard")) return;
    const dismissedLegacy = safeLocalStorageGet("loraPromo_dismissed");
    const dismissedPerUser = userPromoDismissKey ? safeLocalStorageGet(userPromoDismissKey) : null;
    const dismissed = dismissedLegacy === "true" || dismissedPerUser === "true";
    if (!dismissed) {
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, userPromoDismissKey]);

  // Both X and "Don't show again" persist the dismissal
  const handleDismiss = () => {
    safeLocalStorageSet("loraPromo_dismissed", "true");
    if (userPromoDismissKey) safeLocalStorageSet(userPromoDismissKey, "true");
    setVisible(false);
  };

  const handleDontShowAgain = () => {
    safeLocalStorageSet("loraPromo_dismissed", "true");
    if (userPromoDismissKey) safeLocalStorageSet(userPromoDismissKey, "true");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, x: 100, y: 0 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, x: 100 }}
      className="fixed bottom-4 right-4 z-[9999] w-[320px] max-w-[calc(100vw-2rem)]"
    >
      <div
        className="rounded-xl border border-white/10 p-4 backdrop-blur-2xl"
        style={{
          background: "linear-gradient(135deg, rgba(30,20,40,0.6) 0%, rgba(20,15,30,0.65) 100%)",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.18), 0 0 18px 2px rgba(255,255,255,0.12), inset 0 1px 0 rgba(255,255,255,0.09)",
        }}
      >
        <button
          onClick={handleDismiss}
          className="absolute top-2.5 right-2.5 p-1 rounded-lg hover:bg-white/10 transition-colors"
          data-testid="button-promo-dismiss"
        >
          <X className="w-4 h-4 text-slate-400" />
        </button>

        <div className="flex items-start gap-3 mb-3">
          <div className="p-2 rounded-lg shrink-0" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
            <Info className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white mb-0.5">{copy.promoTitle}</h3>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {copy.promoBodyPrefix} <span className="text-emerald-400 font-semibold">{copy.promoBodyHighlight}</span> {copy.promoBodySuffix}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 mb-3 backdrop-blur-md bg-white/[0.04] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] border-white/10">
          <Gift className="w-4 h-4 text-emerald-400 shrink-0" />
          <p className="text-[11px] font-medium">
            <span className="text-white">{copy.promoBonusPrefix} </span>
            <span className="text-emerald-300">{copy.promoBonusHighlight}</span>
          </p>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            onClick={handleDontShowAgain}
            className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
            data-testid="button-promo-dont-show"
          >
            {copy.promoDontShow}
          </button>
          <a
            href="/nsfw"
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-black bg-white hover:bg-slate-100 transition-all"
            data-testid="link-promo-try-now"
          >
            {copy.promoTryNow}
          </a>
        </div>
      </div>
    </motion.div>
  );
}

// Protected Route - waits for hydration before evaluating auth
function ProtectedRoute({ children }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hasHydrated = useHasHydrated();
  
  if (!hasHydrated) {
    return null;
  }
  
  return isAuthenticated ? children : <Navigate to="/login" />;
}

function AdminRoute({ children }) {
  const { isAuthenticated, user } = useAuthStore();
  const hasHydrated = useHasHydrated();
  
  if (!hasHydrated) {
    return null;
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }
  
  if (user?.role !== "admin") {
    return <Navigate to="/dashboard" />;
  }
  
  return children;
}

// Pro Studio route - requires auth + user.proAccess (set via mdlcln admin)
function ProRoute({ children }) {
  const { isAuthenticated, user } = useAuthStore();
  const hasHydrated = useHasHydrated();
  if (!hasHydrated) return null;
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (!user?.proAccess) return <Navigate to="/dashboard" />;
  return children;
}

// Protected Route with Onboarding check - waits for hydration
function ProtectedRouteWithOnboarding({ children }) {
  const { isAuthenticated, user } = useAuthStore();
  const hasHydrated = useHasHydrated();
  
  // Wait for Zustand to hydrate from localStorage before redirecting
  if (!hasHydrated) {
    return null; // Or return a loading spinner
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }
  
  // Redirect to onboarding ONLY for new accounts that are eligible and haven't locked the offer
  // Existing users (specialOfferEligible=false) go directly to dashboard
  if (user && user.specialOfferEligible && !user.specialOfferLockedAt && !user.onboardingCompleted) {
    return <Navigate to="/onboarding" />;
  }
  
  return children;
}

const LOGOUT_NAV_KEY = "auth_logout_nav_ts";
const LOGOUT_NAV_THROTTLE_MS = 12000;
const isLocalHost =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

// Listen for force-logout from API layer (client-side nav to avoid full-page reload loop)
function ForceLogoutListener() {
  const navigate = useNavigate();
  useEffect(() => {
    const handler = () => {
      if (isLocalHost) return; // never redirect on localhost to avoid dev refresh loop
      try {
        const last = parseInt(sessionStorage.getItem(LOGOUT_NAV_KEY) || "0", 10);
        if (Date.now() - last < LOGOUT_NAV_THROTTLE_MS) return;
        sessionStorage.setItem(LOGOUT_NAV_KEY, String(Date.now()));
      } catch (_) {}
      useAuthStore.setState({ user: null, isAuthenticated: false });
      navigate('/login', { replace: true });
    };
    window.addEventListener('auth:force-logout', handler);
    return () => window.removeEventListener('auth:force-logout', handler);
  }, [navigate]);
  return null;
}

// When user returns from Stripe 3DS redirect, refresh credits and clean URL
function Stripe3DSReturnHandler() {
  const copy = APP_COPY[resolveLocale()] || APP_COPY.en;
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const PENDING_KEY = "pendingStripeConfirmation";
    const params = new URLSearchParams(location.search);
    const clientSecret = params.get('payment_intent_client_secret');
    const paymentIntentId = params.get('payment_intent');
    const status = params.get('redirect_status');
    if (!clientSecret || !status) return;

    const finish = () => {
      const clean = new URLSearchParams(params);
      clean.delete('payment_intent');
      clean.delete('payment_intent_client_secret');
      clean.delete('redirect_status');
      const newSearch = clean.toString();
      const newPath = location.pathname + (newSearch ? `?${newSearch}` : '');
      navigate(newPath, { replace: true });
    };

    (async () => {
      try {
        const auth = useAuthStore.getState();
        if (!auth.isAuthenticated) {
          finish();
          return;
        }

        const pendingRaw = safeLocalStorageGet(PENDING_KEY);
        let pending = null;
        if (pendingRaw) {
          try {
            pending = JSON.parse(pendingRaw);
          } catch {
            pending = null;
          }
        }
        const createdAt = Number(pending?.createdAt || 0);
        const isFresh = createdAt > 0 && Date.now() - createdAt < 30 * 60 * 1000;

        if (status === 'succeeded') {
          if (isFresh && pending?.kind === 'subscription' && pending?.subscriptionId) {
            await stripeAPI.confirmSubscription(pending.subscriptionId);
          } else if (isFresh && pending?.kind === 'special-offer' && (pending?.paymentIntentId || paymentIntentId)) {
            await stripeAPI.confirmSpecialOffer(pending.paymentIntentId || paymentIntentId);
          } else if (paymentIntentId || pending?.paymentIntentId) {
            await stripeAPI.confirmPayment(paymentIntentId || pending.paymentIntentId);
          }
          await auth.refreshUserCredits?.();
          toast.success(copy.paymentComplete);
        } else if (status === 'failed') {
          toast.error(copy.bankVerificationFailed);
        }
      } catch (error) {
        console.error("Stripe return confirmation failed:", error);
        toast.error(error?.response?.data?.error || error?.message || copy.paymentConfirmFailed);
      } finally {
        safeLocalStorageRemove(PENDING_KEY);
        finish();
      }
    })();
  }, [location.search, location.pathname, navigate]);
  return null;
}

let _lastClick = 0;

function useClickSound() {
  useEffect(() => {
    const handle = (e) => {
      const now = Date.now();
      if (now - _lastClick < 40) return;
      _lastClick = now;
      const el = e.target;
      const interactive = el.closest('button, a, input, select, textarea, label, [role="button"], [role="tab"], [role="checkbox"], [role="switch"]');
      if (interactive) sound.playClick();
    };
    window.addEventListener('mousedown', handle, { passive: true });
    return () => window.removeEventListener('mousedown', handle);
  }, []);
}

function generationToastLabel(type) {
  if (!type) return "Generation";
  const map = {
    "image": "Image",
    "image-identity": "Identity image",
    "prompt-image": "Prompt image",
    "face-swap-image": "Face-swap image",
    "advanced-image": "Advanced image",
    "video": "Video",
    "prompt-video": "Prompt video",
    "face-swap": "Face-swap video",
    "recreate-video": "Recreate video",
    "talking-head": "Talking-head video",
    "creator-studio": "Creator Studio image",
    "creator-studio-video": "Creator Studio video",
    "nsfw": "NSFW image",
    "nsfw-video": "NSFW video",
    "nsfw-video-extend": "NSFW extend",
  };
  return map[type] || "Generation";
}

function GlobalGenerationNotifier() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const initialLoadedRef = useRef(false);
  const seenRef = useRef(new Set());
  const prevStatusRef = useRef(new Map());

  useEffect(() => {
    if (!isAuthenticated) {
      initialLoadedRef.current = false;
      seenRef.current = new Set();
      prevStatusRef.current = new Map();
    }
  }, [isAuthenticated]);

  const { data: notifiedGenerations = [] } = useQuery({
    queryKey: ["global-generation-notifier"],
    queryFn: async () => {
      if (!isAuthenticated) return [];
      const response = await api.get("/generations?limit=80");
      return Array.isArray(response?.data?.generations) ? response.data.generations : [];
    },
    enabled: isAuthenticated,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    staleTime: 2500,
  });

  useEffect(() => {
    if (!isAuthenticated || !Array.isArray(notifiedGenerations) || notifiedGenerations.length === 0) return;

    if (!initialLoadedRef.current) {
      notifiedGenerations.forEach((gen) => {
        seenRef.current.add(gen.id);
        prevStatusRef.current.set(gen.id, gen.status);
      });
      initialLoadedRef.current = true;
      return;
    }

    notifiedGenerations.forEach((gen) => {
      const prevStatus = prevStatusRef.current.get(gen.id);
      const currentStatus = gen.status;
      const isTerminal = currentStatus === "completed" || currentStatus === "failed";
      const transitionedFromPending = prevStatus === "processing" || prevStatus === "pending";
      const unseen = !seenRef.current.has(gen.id);

      if (isTerminal && unseen && transitionedFromPending) {
        const label = generationToastLabel(gen.type);
        if (currentStatus === "completed") {
          toast.success(`${label} finished`, { duration: 3500 });
        } else {
          toast.error(`${label} failed${gen.errorMessage ? `: ${gen.errorMessage}` : ""}`, { duration: 4500 });
        }
        seenRef.current.add(gen.id);
      }

      prevStatusRef.current.set(gen.id, currentStatus);
    });
  }, [isAuthenticated, notifiedGenerations]);

  return null;
}

function App() {
  const [showSplash, setShowSplash] = useState(true);
  const branding = useBranding();
  useClickSound();
  
  useEffect(() => {
    setErrorDisplay(showErrorDetails);
  }, []);

  // Hide splash after hydration. Do NOT call refreshUserCredits here — it can 401 with stale
  // session and trigger forceLogout → redirect loop. Let protected pages (e.g. Dashboard) fetch on mount.
  useEffect(() => {
    const hideSplash = () => setTimeout(() => setShowSplash(false), 300);

    if (useAuthStore.persist.hasHydrated()) {
      hideSplash();
      return;
    }
    const unsubscribe = useAuthStore.persist.onFinishHydration(hideSplash);
    return unsubscribe;
  }, []);

  useEffect(() => {
    let lastRefreshAt = 0;
    const MIN_REFRESH_INTERVAL_MS = 15_000;

    const refreshOnReturn = () => {
      if (document.visibilityState && document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefreshAt < MIN_REFRESH_INTERVAL_MS) return;
      lastRefreshAt = now;

      const state = useAuthStore.getState();
      if (state.isAuthenticated) {
        void state.refreshUserCredits();
      }
    };

    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, []);

  useEffect(() => {
    if (branding?.appName) {
      document.title = branding.appName;
    }
    if (branding?.faviconUrl) {
      let link = document.querySelector("link[rel='icon']");
      if (!link) {
        link = document.createElement("link");
        link.setAttribute("rel", "icon");
        document.head.appendChild(link);
      }
      link.setAttribute("href", branding.faviconUrl);
    }
  }, [branding]);

  return (
    <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <AnimatePresence mode="wait">
          {showSplash && <SplashScreen logoUrl={branding?.logoUrl} appName={branding?.appName || "ModelClone"} />}
        </AnimatePresence>
        <ErrorDisplay />
        <LoraPromoBanner />
        <BrowserRouter>
          <SeoRobotsMeta />
          <ForceLogoutListener />
          <Stripe3DSReturnHandler />
          <GlobalGenerationNotifier />
          <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: 'var(--bg-surface)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
            },
            success: {
              iconTheme: {
                primary: 'var(--text-primary)',
                secondary: 'var(--bg-page)',
              },
            },
          }}
        />
        
        <Routes>
          <Route path="/" element={<LanderNewPage />} />
          <Route path="/landing" element={<Navigate to="/" replace />} />
          <Route path="/admin-login" element={<AdminLoginPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/verify" element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/cookies" element={<CookiesPage />} />
          <Route path="/create-ai-model" element={<LanderNewPage />} />
          <Route path="/sk/vytvor-ai-model" element={<CreateAIModelLandingPageSk />} />
          <Route path="/r/:suffix" element={<ReferralCapturePage />} />
          <Route path="/free-course" element={<FreeCourseFunnelPage />} />
          <Route path="/lander-new" element={<Navigate to="/" replace />} />
          {/* Preview frame loaded inside editor iframe — must be public (no AdminRoute) */}
          <Route path="/admin/lander-preview-frame" element={<AdminLanderPreviewFrame />} />
          <Route path="/admin/affiliate-lander-preview-frame" element={<AdminAffiliateLanderPreviewFrame />} />
          <Route path="/aff/:suffix" element={<AffiliateLanderPublicPage />} />
          <Route
            path="/voice-test"
            element={
              <AdminRoute>
                <VoiceTestPage />
              </AdminRoute>
            }
          />
          <Route
            path="/test-replicate"
            element={
              <AdminRoute>
                <ReplicateTestPage />
              </AdminRoute>
            }
          />
          <Route
            path="/test-face-ref"
            element={
              <AdminRoute>
                <FaceRefTestPage />
              </AdminRoute>
            }
          />
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <OnboardingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRouteWithOnboarding>
                <DashboardPage />
              </ProtectedRouteWithOnboarding>
            }
          />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <AdminPage />
              </AdminRoute>
            }
          />
          <Route
            path="/designer-studio"
            element={
              <AdminRoute>
                <DesignerStudioPage />
              </AdminRoute>
            }
          />
          <Route
            path="/admin/lander-editor"
            element={
              <AdminRoute>
                <AdminLanderEditorPage />
              </AdminRoute>
            }
          />
          <Route
            path="/admin/affiliate-lander-editor/:suffix"
            element={
              <AdminRoute>
                <AdminAffiliateLanderEditorPage />
              </AdminRoute>
            }
          />
          <Route
            path="/nsfw"
            element={
              <ProtectedRouteWithOnboarding>
                <NSFWPage />
              </ProtectedRouteWithOnboarding>
            }
          />
          <Route
            path="/reformatter"
            element={
              <ProtectedRouteWithOnboarding>
                <ContentReformatterPage />
              </ProtectedRouteWithOnboarding>
            }
          />
          <Route
            path="/upscaler"
            element={
              <ProtectedRouteWithOnboarding>
                <UpscalerPage />
              </ProtectedRouteWithOnboarding>
            }
          />
          <Route
            path="/pro"
            element={
              <ProRoute>
                <ProLayout />
              </ProRoute>
            }
          >
            <Route index element={<ProDashboardPage />} />
            <Route path="models" element={<ProModelsPage />} />
            <Route path="nsfw" element={<ProNSFWPage />} />
            <Route path="generation" element={<ProGenerationPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <SupportChatButton />
      </BrowserRouter>
    </ErrorBoundary>
    </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
