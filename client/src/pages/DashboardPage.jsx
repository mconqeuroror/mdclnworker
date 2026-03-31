import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Zap,
  LogOut,
  Coins,
  Home,
  Users,
  Image as ImageIcon,
  Video,
  Settings as SettingsIcon,
  Plus,
  Clock,
  ArrowRight,
  DollarSign,
  ExternalLink,
  Share2,
  Gift,
  MoreHorizontal,
  X,
  Menu,
  Upload,
  FileType2,
  User,
  ChevronDown,
  CreditCard,
  Lock,
  Flame,
  Briefcase,
  HelpCircle,
  BookOpen,
  Shuffle,
  TrendingUp,
  Wand2,
  Mic,
} from "lucide-react";
import { SiTelegram, SiDiscord } from "react-icons/si";
import toast from "react-hot-toast";
import { useAuthStore } from "../store";
import { systemAPI } from "../services/api";
import { hasPremiumAccess } from "../utils/premiumAccess";
import ModelsPage from "./ModelsPage";
import GeneratePage from "./GeneratePage";
import HistoryPage from "./HistoryPage";
import SettingsPage from "./SettingsPage";
import NSFWPage from "./NSFWPage";
import JobBoardPage from "./JobBoardPage";
import CoursePage from "./CoursePage";
import VideoRepurposerPage from "./VideoRepurposerPage";
import ReferralProgramPage from "./ReferralProgramPage";
import ViralReelFinderPage from "./ViralReelFinderPage";
import ContentReformatterPage from "./ContentReformatterPage";
import CreatorStudioPage from "./CreatorStudioPage";
import AddCreditsModal from "../components/AddCreditsModal";
import PurchaseSuccessModal from "../components/PurchaseSuccessModal";
import CreateModelModal from "../components/CreateModelModal";
import AppSidebar from "../components/AppSidebar";
import { useBranding } from "../hooks/useBranding";

const LOCALE_STORAGE_KEY = "app_locale";
const getUserSpendMetric = (user) => {
  const raw =
    user?.spent ??
    user?.totalSpent ??
    user?.totalSpentCents ??
    user?.totalCreditsUsed ??
    0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
};

const COPY = {
  en: {
    toastCreditsAlreadyAdded: "Your credits have already been added to your account.",
    toastVerifyPaymentFailed: "Failed to verify payment",
    toastProcessVerificationFailed: "Failed to process payment verification",
    toastLoggedOut: "Logged out successfully",
    mobileNavDashboard: "Dashboard",
    mobileNavModels: "My Avatars",
    mobileNavGenerate: "Create with Avatar",
    mobileNavCreatorStudio: "Creator Studio",
    mobileNavVoiceStudio: "Voice Studio",
    mobileNavReformatter: "Reformatter",
    mobileNavHistory: "History",
    mobileNavSettings: "Settings",
    mobileNavCourses: "Courses",
    mobileNavNsfw: "NSFW",
    mobileNavPhotoVideoRepurposer: "Photo/Video Repurposer",
    mobileNavReelFinder: "Reel Finder",
    badgeSoon: "Soon",
    mobileEarnWithAi: "Earn With AI",
    mobileReferAndEarn: "Refer And Earn",
    mobileTelegram: "Telegram",
    mobileDiscord: "Discord",
    mobileJobBoard: "Job Board",
    badgeNew: "New",
    mobileAdmin: "Admin",
    mobileLogout: "Logout",
    premiumGateTitle: "Premium Feature",
    premiumGateDescription:
      "Purchase a subscription to gain access to premium features including Courses, Photo/Video Repurposer, and Reel Finder.",
    premiumGateViewPlans: "View Subscription Plans",
    premiumGateMaybeLater: "Maybe Later",
    earnModalTitle: "Earn With Your AI Model",
    earnModalBody1:
      "Monetize your AI-generated content on Fanvue - a platform where you can have AI models and sell their content.",
    earnModalBody2: "AI models are officially allowed! Keep 100% of your revenue with no model drama.",
    earnModalChipKeepProfits: "Keep all profits",
    earnModalChipNoRealModels: "No real models",
    earnModalChipEarn247: "Earn 24/7",
    earnModalCta: "Start Earning on Fanvue",
    earnModalDiscordText: "Learn how to market your AI model completely for free",
    earnModalDiscordCta: "Join ModelClone Discord",
    referralModalTitle: "Referral Program",
    referralModalSubtitle: "Earn 15% from each referred user's first purchase",
    referralModalHowItWorks: "How it works",
    referralModalStep1: "Create your unique referral link",
    referralModalStep2: "Share it and bring new users",
    referralModalStep3: "Request payout once your eligible reward reaches $100+",
    referralModalCta: "Open Referral Program",
    referralModalChipCommission: "15% first-purchase commission",
    referralModalChipPayouts: "Manual admin payouts",
    referralModalChipUnlimited: "Unlimited referrals",
    whatsNewTitle: "New Feature Added!",
    whatsNewSubtitle: "February 2026 Update",
    whatsNewFeatureTitle: "NSFW Studio",
    whatsNewFeatureBody:
      "Create adult content with your AI models. Train custom LoRA models and generate explicit images with face swap technology.",
    whatsNewNote: "Access requires verified models. Check the sidebar for the new NSFW tab.",
    whatsNewCta: "Explore NSFW Studio",
    whatsNewMaybeLater: "Maybe Later",
    homeWelcomeBack: "Welcome back,",
    homeFallbackCreator: "Creator",
    homeSubtitle: "Your AI content creation hub",
    statsCredits: "Credits",
    statsAddCredits: "Add Credits",
    statsImages: "Images",
    statsVideos: "Videos",
    statsThisMonth: "this month",
    mainCreateModelTitle: "Create AI Avatar",
    mainCreateModelBody: "Set name, attributes & upload 3 photos",
    mainUploadRealTitle: "Clone a Real Avatar",
    mainUploadRealBody: "Upload photos of a real person",
    tutorialTitle: "Quick Tutorial",
    recentCreations: "Recent Creations",
    viewAll: "View All",
    quickActionsTitle: "Quick Actions",
    quickCreateModelTitle: "Create Avatar",
    quickCreateModelBody: "Upload 3 photos to train your model",
    quickGetStarted: "Get Started",
    quickStartEarningTitle: "Start Earning",
    quickStartEarningBody: "Monetize your content on Fanvue",
    quickLearnMore: "Learn More",
    quickAffiliateTitle: "Affiliate",
    quickAffiliateBody: "Get 15% commission on each referral's first purchase",
    ctaReadyTitle: "Ready to Create?",
    ctaReadyBody: "Generate stunning AI images and videos",
    ctaStartGenerating: "Start Generating",
    purchaseTierFallback: "Your Plan",
  },
  ru: {
    toastCreditsAlreadyAdded: "Кредиты уже зачислены на ваш счёт.",
    toastVerifyPaymentFailed: "Не удалось подтвердить платёж",
    toastProcessVerificationFailed: "Не удалось обработать подтверждение платежа",
    toastLoggedOut: "Вы успешно вышли из системы",
    mobileNavDashboard: "Панель управления",
    mobileNavModels: "Мои аватары",
    mobileNavGenerate: "Создать с аватаром",
    mobileNavCreatorStudio: "Студия автора",
    mobileNavVoiceStudio: "Голосовая студия",
    mobileNavReformatter: "Рефоматер",
    mobileNavHistory: "История",
    mobileNavSettings: "Настройки",
    mobileNavCourses: "Курсы",
    mobileNavNsfw: "NSFW",
    mobileNavPhotoVideoRepurposer: "Переработка фото/видео",
    mobileNavReelFinder: "Поиск рилс",
    badgeSoon: "Скоро",
    mobileEarnWithAi: "Заработок с ИИ",
    mobileReferAndEarn: "Приглашай и зарабатывай",
    mobileTelegram: "Telegram",
    mobileDiscord: "Discord",
    mobileJobBoard: "Биржа заказов",
    badgeNew: "Новое",
    mobileAdmin: "Администратор",
    mobileLogout: "Выйти",
    premiumGateTitle: "Премиум-функция",
    premiumGateDescription:
      "Оформите подписку, чтобы получить доступ к премиум-функциям: Курсам, Переработке фото/видео и Поиску рилс.",
    premiumGateViewPlans: "Посмотреть планы подписки",
    premiumGateMaybeLater: "Позже",
    earnModalTitle: "Зарабатывайте с вашей ИИ-моделью",
    earnModalBody1:
      "Монетизируйте ваш ИИ-контент на Fanvue — платформе, где вы можете создавать ИИ-модели и продавать их контент.",
    earnModalBody2:
      "ИИ-модели официально разрешены! Сохраняйте 100% дохода без проблем с реальными моделями.",
    earnModalChipKeepProfits: "Забирайте всю прибыль",
    earnModalChipNoRealModels: "Без реальных моделей",
    earnModalChipEarn247: "Зарабатывайте 24/7",
    earnModalCta: "Начать зарабатывать на Fanvue",
    earnModalDiscordText: "Узнайте, как продвигать вашу ИИ-модель совершенно бесплатно",
    earnModalDiscordCta: "Вступить в Discord ModelClone",
    referralModalTitle: "Реферальная программа",
    referralModalSubtitle: "Зарабатывайте 15% с первой покупки каждого приглашённого пользователя",
    referralModalHowItWorks: "Как это работает",
    referralModalStep1: "Создайте уникальную реферальную ссылку",
    referralModalStep2: "Поделитесь ею и привлекайте новых пользователей",
    referralModalStep3: "Запросите выплату, когда ваше вознаграждение достигнет $100+",
    referralModalCta: "Открыть реферальную программу",
    referralModalChipCommission: "15% комиссия с первой покупки",
    referralModalChipPayouts: "Выплаты через администратора",
    referralModalChipUnlimited: "Неограниченное количество рефералов",
    whatsNewTitle: "Добавлена новая функция!",
    whatsNewSubtitle: "Обновление февраля 2026",
    whatsNewFeatureTitle: "NSFW-студия",
    whatsNewFeatureBody:
      "Создавайте контент для взрослых с вашими ИИ-моделями. Обучайте собственные LoRA-модели и генерируйте откровенные изображения с технологией замены лица.",
    whatsNewNote: "Доступ требует верифицированных моделей. Найдите новую вкладку NSFW на боковой панели.",
    whatsNewCta: "Открыть NSFW-студию",
    whatsNewMaybeLater: "Позже",
    homeWelcomeBack: "С возвращением,",
    homeFallbackCreator: "Автор",
    homeSubtitle: "Ваш центр создания ИИ-контента",
    statsCredits: "Кредиты",
    statsAddCredits: "Пополнить кредиты",
    statsImages: "Изображения",
    statsVideos: "Видео",
    statsThisMonth: "в этом месяце",
    mainCreateModelTitle: "Создать ИИ-модель",
    mainCreateModelBody: "Укажите имя, характеристики и загрузите 3 фото",
    mainUploadRealTitle: "Загрузить реальную модель",
    mainUploadRealBody: "Загрузите фотографии реального человека",
    tutorialTitle: "Быстрое руководство",
    recentCreations: "Последние работы",
    viewAll: "Смотреть все",
    quickActionsTitle: "Быстрые действия",
    quickCreateModelTitle: "Создать аватар",
    quickCreateModelBody: "Загрузите 3 фото для обучения модели",
    quickGetStarted: "Начать",
    quickStartEarningTitle: "Начать зарабатывать",
    quickStartEarningBody: "Монетизируйте контент на Fanvue",
    quickLearnMore: "Узнать больше",
    quickAffiliateTitle: "Партнёрская программа",
    quickAffiliateBody: "Получайте 15% комиссии с первой покупки каждого реферала",
    ctaReadyTitle: "Готовы создавать?",
    ctaReadyBody: "Генерируйте впечатляющие ИИ-изображения и видео",
    ctaStartGenerating: "Начать генерацию",
    purchaseTierFallback: "Ваш план",
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
    // Ignore storage-denied/quota errors.
  }
}

export default function DashboardPage() {
  const [locale] = useState(resolveLocale);
  const copy = COPY[locale] || COPY.en;
  const { user, logout, updateUser, refreshUserCredits } = useAuthStore();
  const branding = useBranding();
  const navigate = useNavigate();
  const canAccessPremiumTabs = hasPremiumAccess(user);
  const hideRestrictedTabs = getUserSpendMetric(user) <= 0;
  const premiumTabs = ["course", "repurposer", "reelfinder", "voice-studio"];

  const [activeTab, setActiveTab] = useState("home");
  const [showPremiumGate, setShowPremiumGate] = useState(false);
  const [showAddCredits, setShowAddCredits] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [purchaseDetails, setPurchaseDetails] = useState(null);
  const [showEarnModal, setShowEarnModal] = useState(false);
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showCreateModelModal, setShowCreateModelModal] = useState(false);
  const [uploadRealMode, setUploadRealMode] = useState(false);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [courseVideoId, setCourseVideoId] = useState(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [sidebarDesktopHovered, setSidebarDesktopHovered] = useState(false);
  /** Narrow rail (80px) only when pinned collapsed and not hovering the sidebar on desktop */
  const sidebarNarrow = isSidebarCollapsed && !sidebarDesktopHovered;
  const [voiceStudioInitialModelId, setVoiceStudioInitialModelId] = useState(null);

  // What's New popup - version key for tracking updates
  const WHATS_NEW_VERSION = "nsfw-feb-2026";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const freshUser = await loadUserProfile();
      if (cancelled) return;
      checkStripeSession();

      // Check for query params (tab navigation from other pages, openCredits from onboarding)
      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = urlParams.get("tab");
      if (tabParam && ["home", "models", "generate", "creator-studio", "voice-studio", "reformatter", "history", "settings", "nsfw", "course", "repurposer", "reelfinder", "referral"].includes(tabParam)) {
        if (premiumTabs.includes(tabParam)) {
          const hasAccess = hasPremiumAccess(freshUser);
          if (!hasAccess) {
            setActiveTab("home");
            setShowPremiumGate(true);
          } else {
            setActiveTab(tabParam);
          }
        } else {
          setActiveTab(tabParam);
        }
        window.history.replaceState({}, document.title, "/dashboard");
      }
      if (urlParams.get("openCredits") === "true") {
        setShowAddCredits(true);
        window.history.replaceState({}, "", "/dashboard");
      }
    })();

    // Check if user has seen the What's New popup
    const seenVersion = safeLocalStorageGet("whats-new-seen");
    if (seenVersion !== WHATS_NEW_VERSION) {
      setTimeout(() => setShowWhatsNew(true), 500);
    }
    return () => { cancelled = true; };
  }, []);

  /** Mobile bottom tab bar height + safe area — support FAB and scroll padding read this */
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--dashboard-mobile-tab-stack",
      "calc(3.5rem + env(safe-area-inset-bottom))",
    );
    return () => {
      document.documentElement.style.removeProperty("--dashboard-mobile-tab-stack");
    };
  }, []);

  useEffect(() => {
    if (premiumTabs.includes(activeTab) && !canAccessPremiumTabs) {
      setActiveTab("home");
      setShowPremiumGate(true);
    }
  }, [activeTab, canAccessPremiumTabs]);

  useEffect(() => {
    if (!hideRestrictedTabs) return;
    if (activeTab === "nsfw" || activeTab === "course") {
      setActiveTab("home");
    }
  }, [activeTab, hideRestrictedTabs]);

  const loadUserProfile = async () => {
    await refreshUserCredits();
    return useAuthStore.getState().user;
  };

  const checkStripeSession = async () => {
    // Check for Stripe session ID in URL (after redirect from checkout)
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get("session_id");

    if (sessionId) {
      try {
        const response = await fetch("/api/stripe/verify-session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({ sessionId }),
        });

        const data = await response.json();

        if (data.success) {
          if (data.alreadyProcessed) {
            // Payment was already processed - just notify user
            toast.success(
              copy.toastCreditsAlreadyAdded,
            );
            await loadUserProfile();
          } else {
            // Show success modal with purchase details
            const purchaseType = data.type || "one-time";
            setPurchaseDetails({
              credits: data.addedCredits || 0,
              type: purchaseType,
              tierName:
                data.tierName ||
                (purchaseType === "subscription" ? copy.purchaseTierFallback : null),
            });
            setShowSuccessModal(true);

            // Reload user profile to show new credits
            await loadUserProfile();
          }
        } else {
          toast.error(data.error || copy.toastVerifyPaymentFailed);
        }
      } catch (error) {
        console.error("Failed to verify Stripe session:", error);
        toast.error(copy.toastProcessVerificationFailed);
      }

      // Remove session_id from URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/");
    toast.success(copy.toastLoggedOut);
  };
  
  const handleCloseWhatsNew = () => {
    safeLocalStorageSet("whats-new-seen", WHATS_NEW_VERSION);
    setShowWhatsNew(false);
  };

  const handleTabChange = (tabId) => {
    if (hideRestrictedTabs && (tabId === "nsfw" || tabId === "course")) {
      setActiveTab("home");
      return;
    }
    if (premiumTabs.includes(tabId) && !canAccessPremiumTabs) {
      setShowPremiumGate(true);
      return;
    }
    setActiveTab(tabId);
  };

  const openVoiceStudioForModel = (modelId = null) => {
    setVoiceStudioInitialModelId(modelId || null);
    setActiveTab("voice-studio");
  };

  const mobileMenuItems = [
    { id: 'home', label: copy.mobileNavDashboard, icon: Home },
    { id: 'models', label: copy.mobileNavModels, icon: Users },
    { id: 'generate', label: copy.mobileNavGenerate, icon: Zap },
    { id: 'creator-studio', label: copy.mobileNavCreatorStudio, icon: Wand2 },
    { id: 'voice-studio', label: copy.mobileNavVoiceStudio, icon: Mic, premium: true },
    { id: 'reformatter', label: copy.mobileNavReformatter, icon: FileType2 },
    { id: 'history', label: copy.mobileNavHistory, icon: Clock },
    { id: 'settings', label: copy.mobileNavSettings, icon: SettingsIcon },
    ...(hideRestrictedTabs ? [] : [{ id: 'course', label: copy.mobileNavCourses, icon: BookOpen, premium: true }]),
    ...(hideRestrictedTabs ? [] : [{ id: 'nsfw', label: copy.mobileNavNsfw, icon: Flame }]),
    { id: 'repurposer', label: copy.mobileNavPhotoVideoRepurposer, icon: Shuffle, premium: true },
    { id: 'reelfinder', label: copy.mobileNavReelFinder, icon: TrendingUp, premium: true },
  ];

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      {/* Desktop Sidebar - hidden on mobile */}
      <div className="hidden md:block">
        <AppSidebar
          activeTab={activeTab}
          setActiveTab={handleTabChange}
          user={user}
          hideRestrictedTabs={hideRestrictedTabs}
          onLogout={handleLogout}
          onOpenCredits={() => setShowAddCredits(true)}
          onOpenEarn={() => setShowEarnModal(true)}
          onOpenReferral={() => setActiveTab("referral")}
          onOpenAdmin={() => navigate("/admin")}
          collapsed={isSidebarCollapsed}
          setCollapsed={setIsSidebarCollapsed}
          onDesktopHoverChange={setSidebarDesktopHovered}
        />
      </div>

      {/* Desktop Top Header - hidden on mobile (empty; profile moved to sidebar) */}


      {/* Mobile Header — floating glass pill (10% fill + blur); logged-in app shell only */}
      <header
        className="md:hidden fixed z-50 top-3 left-3 right-3 pointer-events-none"
        aria-label="App bar"
      >
        <div
          className="pointer-events-auto rounded-2xl border border-white/25 bg-white/[0.1] shadow-[0_12px_40px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.14)] backdrop-blur-2xl backdrop-saturate-150"
          style={{
            WebkitBackdropFilter: "blur(28px) saturate(1.2)",
          }}
        >
        <div className="px-3.5 py-2.5 sm:px-4 sm:py-3">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <div className="flex items-center gap-2">
              <img src={branding.logoUrl} alt={branding.appName} className="w-8 h-8 rounded-lg object-cover" />
              <span className="text-base font-bold text-white">{branding.appName}</span>
            </div>

            {/* Right Actions */}
            <div className="flex items-center gap-2">
              {/* Credits - clickable to add more */}
              <button
                onClick={() => {
                 
                  setShowAddCredits(true);
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 border border-white/35 active:scale-[0.98] active:bg-white/20 transition-all"
                data-testid="mobile-credits"
              >
                <Coins className="w-4 h-4 text-yellow-400" />
                <span className="font-bold text-sm tabular-nums text-white">{user?.credits || 0}</span>
                <div className="w-px h-3 bg-white/20" />
                <Plus className="w-3.5 h-3.5 text-yellow-300 rounded-full p-[1px] border border-yellow-300/90 bg-yellow-400/10 shadow-[0_0_10px_rgba(250,204,21,0.95)] drop-shadow-[0_0_8px_rgba(250,204,21,0.75)]" />
              </button>

              {/* Menu Toggle */}
              <button
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                className="p-2.5 rounded-xl bg-white/5 border border-white/10 active:bg-white/10 transition-all"
                data-testid="mobile-menu-toggle"
              >
                {showMobileMenu ? <X className="w-5 h-5 text-white" /> : <Menu className="w-5 h-5 text-white" />}
              </button>
            </div>
          </div>
        </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
      {showMobileMenu && (
        <>
          <div 
            className="md:hidden fixed inset-0 bg-black/70 backdrop-blur-sm z-40"
            onClick={() => setShowMobileMenu(false)}
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="md:hidden fixed right-0 top-0 h-full w-[min(92vw,20rem)] z-50 p-4"
            style={{ background: "linear-gradient(180deg, rgba(15,15,23,0.98) 0%, rgba(10,10,18,0.99) 50%, rgba(5,5,12,1) 100%)" }}
          >
            <div className="absolute left-0 top-0 bottom-0 w-px bg-gradient-to-b from-white/[0.08] via-white/[0.04] to-transparent" />
            <div className="flex justify-end mb-4">
              <button
                onClick={() => setShowMobileMenu(false)}
                className="p-2.5 rounded-xl bg-white/5 border border-white/10 active:bg-white/10 transition-all"
              >
                <X className="w-5 h-5 text-white" />
              </button>
            </div>

            <nav className="space-y-1 relative max-h-[calc(100vh-96px)] overflow-y-auto pr-1">
              {mobileMenuItems.map((item) => (
                <button
                  key={item.id}
                  onClick={async () => {
                    if (item.premium && !canAccessPremiumTabs) {
                      setShowMobileMenu(false);
                      // On mobile, user state can be stale (persisted). Refetch profile and re-check before showing gate.
                      const freshUser = await loadUserProfile();
                      const hasAccess = hasPremiumAccess(freshUser);
                      if (hasAccess) {
                        setActiveTab(item.id);
                      } else {
                        setShowPremiumGate(true);
                      }
                      return;
                    }
                    setActiveTab(item.id);
                    setShowMobileMenu(false);
                  }}
                  className={`w-full relative overflow-hidden flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group backdrop-blur-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] ${
                    activeTab === item.id
                        ? "text-white bg-white/[0.08]"
                        : "text-slate-400 hover:text-white hover:bg-white/[0.04]"
                  }`}
                  data-testid={`mobile-nav-${item.id}`}
                >
                  {activeTab === item.id && (
                    <>
                      <div className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45" />
                      <div
                        className="absolute top-0 left-0 w-20 h-20 pointer-events-none"
                        style={{ background: "radial-gradient(circle at top left, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 35%, transparent 70%)" }}
                      />
                    </>
                  )}
                  <item.icon className={`w-5 h-5 flex-shrink-0 transition-colors duration-200 ${activeTab === item.id ? "text-white" : ""}`} />
                  <span className="font-medium">{item.label}</span>
                  {item.premium && !canAccessPremiumTabs && (
                    <Lock className="ml-auto w-3.5 h-3.5 text-slate-500" />
                  )}
                  {item.comingSoon && (
                    <span className="ml-auto px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider rounded-full bg-gradient-to-r from-rose-500/20 to-orange-500/20 text-rose-300 border border-rose-500/30">
                      {copy.badgeSoon}
                    </span>
                  )}
                </button>
              ))}

              <div className="my-4 h-px bg-white/10" />

              {/* Promo buttons */}
              <button
                onClick={() => {
                  setShowEarnModal(true);
                  setShowMobileMenu(false);
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.04] font-medium transition-all"
                data-testid="mobile-earn"
              >
                <DollarSign className="w-5 h-5 text-slate-300" />
                {copy.mobileEarnWithAi}
              </button>

              <button
                onClick={() => {
                  setActiveTab("referral");
                  setShowMobileMenu(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-all ${
                  activeTab === "referral" ? "text-white bg-white/[0.08]" : "text-slate-400 hover:text-white hover:bg-white/[0.04]"
                }`}
                data-testid="mobile-referral"
              >
                <Gift className="w-5 h-5 text-slate-300" />
                {copy.mobileReferAndEarn}
              </button>

              {/* Telegram & Discord (match desktop sidebar socials) */}
              <a
                href="https://t.me/modelclonechat"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.04] font-medium transition-all"
                data-testid="mobile-telegram"
              >
                <SiTelegram className="w-5 h-5 text-slate-300" />
                {copy.mobileTelegram}
              </a>

              <a
                href="https://discord.gg/vpwGygjEaB"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.04] font-medium transition-all"
                data-testid="mobile-discord"
              >
                <SiDiscord className="w-5 h-5 text-slate-300" />
                {copy.mobileDiscord}
              </a>

              <button
                onClick={() => {
                 
                  setActiveTab("jobs");
                  setShowMobileMenu(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.04] font-medium transition-all ${
                  activeTab === "jobs" ? "bg-white/[0.08] text-white border border-white/15" : ""
                }`}
                data-testid="mobile-jobs"
              >
                <Briefcase className="w-5 h-5 text-slate-300" />
                <span>{copy.mobileJobBoard}</span>
                <span className="ml-auto px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider rounded-full bg-white/10 text-white/90 border border-white/25">
                  {copy.badgeNew}
                </span>
              </button>

              {user?.role === "admin" && (
                <button
                  onClick={() => {
                   
                    navigate("/admin");
                    setShowMobileMenu(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/15 border border-rose-500/20 text-slate-200 font-medium transition-all"
                  data-testid="mobile-admin"
                >
                  <SettingsIcon className="w-5 h-5 text-rose-400" />
                  {copy.mobileAdmin}
                </button>
              )}

              <div className="my-4 h-px bg-white/10" />

              <button
                onClick={() => {
                 
                  handleLogout();
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-gray-400 hover:text-red-400 hover:bg-red-500/10"
                data-testid="mobile-logout"
              >
                <LogOut className="w-5 h-5" />
                {copy.mobileLogout}
              </button>
            </nav>
          </motion.div>
        </>
      )}
      </AnimatePresence>

      {/* Mobile bottom nav (Instagram-style): NSFW · Home · Generate — desktop uses sidebar */}
      <nav
        className="md:hidden fixed bottom-2 left-2 right-2 z-[45] flex items-center justify-around gap-1 border border-white/20 rounded-2xl px-2 min-h-[3.5rem] py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur-2xl"
        style={{
          background: "rgba(255,255,255,0.10)",
        }}
        aria-label="Primary navigation"
      >
        {!hideRestrictedTabs && (
          <button
            type="button"
            onClick={() => handleTabChange("nsfw")}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 max-w-[5.5rem] transition-colors active:scale-[0.97] ${
              activeTab === "nsfw" ? "text-rose-400" : "text-slate-500 hover:text-slate-300"
            }`}
            aria-label={copy.mobileNavNsfw}
            aria-current={activeTab === "nsfw" ? "page" : undefined}
            data-testid="mobile-tab-nsfw"
          >
            <Flame className={`w-6 h-6 ${activeTab === "nsfw" ? "drop-shadow-[0_0_10px_rgba(251,113,133,0.45)]" : ""}`} />
            <span className="text-[10px] font-semibold tracking-wide">{copy.mobileNavNsfw}</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => handleTabChange("home")}
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl py-2 max-w-[6rem] border transition-all active:scale-[0.97] scale-[1.05] ${
            activeTab === "home"
              ? "text-white bg-white/[0.14] border-white/25 shadow-[0_0_20px_rgba(139,92,246,0.18)]"
              : "text-slate-300 border-white/12 bg-white/[0.06] hover:text-white hover:bg-white/[0.09]"
          }`}
          aria-label={copy.mobileNavDashboard}
          aria-current={activeTab === "home" ? "page" : undefined}
          data-testid="mobile-tab-home"
        >
          <Home className="w-7 h-7" />
          <span className="text-[10px] font-semibold tracking-wide">{copy.mobileNavDashboard}</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange("generate")}
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 max-w-[5.5rem] transition-colors active:scale-[0.97] ${
            activeTab === "generate" ? "text-amber-300" : "text-slate-500 hover:text-slate-300"
          }`}
          aria-label={copy.mobileNavGenerate}
          aria-current={activeTab === "generate" ? "page" : undefined}
          data-testid="mobile-tab-generate"
        >
          <Zap className={`w-6 h-6 ${activeTab === "generate" ? "drop-shadow-[0_0_10px_rgba(252,211,77,0.45)]" : ""}`} />
          <span className="text-[10px] font-semibold tracking-wide">{copy.mobileNavGenerate}</span>
        </button>
      </nav>

      {/* Content - with left margin for sidebar on desktop; bottom padding clears mobile tab bar */}
      <main
        className={`relative z-10 pt-[5.5rem] md:pt-14 max-md:pb-[calc(3.5rem+env(safe-area-inset-bottom)+1.5rem)] md:pb-12 min-h-screen transition-[margin] duration-300 ease-out overflow-x-hidden ${sidebarNarrow ? "md:ml-[80px]" : "md:ml-[260px]"}`}
      >
        <div className={`relative z-10 p-3 sm:p-4 md:p-6 ${sidebarNarrow ? "mx-auto w-full max-w-[1600px]" : ""}`}>
          {activeTab === "home" && <HomePage copy={copy} setActiveTab={setActiveTab} setShowEarnModal={setShowEarnModal} setShowReferralModal={setShowReferralModal} onOpenCreateModel={() => { setUploadRealMode(false); setShowCreateModelModal(true); }} onOpenUploadReal={() => { setUploadRealMode(true); setShowCreateModelModal(true); }} onOpenCredits={() => setShowAddCredits(true)} />}
          {activeTab === "models" && <ModelsPage sidebarCollapsed={sidebarNarrow} openVoiceStudioForModel={openVoiceStudioForModel} />}
{activeTab === "generate" && <GeneratePage setActiveTab={setActiveTab} openVoiceStudioForModel={openVoiceStudioForModel} />}
        {activeTab === "creator-studio" && <CreatorStudioPage sidebarCollapsed={sidebarNarrow} initialTab="generate" initialModelId={voiceStudioInitialModelId} />}
        {activeTab === "voice-studio" && <CreatorStudioPage sidebarCollapsed={sidebarNarrow} initialTab="voices" initialModelId={voiceStudioInitialModelId} />}
        {activeTab === "reformatter" && <ContentReformatterPage />}
          {activeTab === "history" && <HistoryPage />}
          {activeTab === "settings" && <SettingsPage />}
          {!hideRestrictedTabs && activeTab === "nsfw" && <NSFWPage embedded sidebarCollapsed={sidebarNarrow} setDashboardTab={(tab, videoId) => { setActiveTab(tab); if (videoId) setCourseVideoId(videoId); }} />}
          {!hideRestrictedTabs && activeTab === "course" && <CoursePage setActiveTab={setActiveTab} onOpenCredits={() => setShowAddCredits(true)} initialVideoId={courseVideoId} onVideoIdConsumed={() => setCourseVideoId(null)} />}
          {activeTab === "jobs" && <JobBoardPage />}
          {activeTab === "repurposer" && <VideoRepurposerPage embedded />}
          {activeTab === "reelfinder" && <ViralReelFinderPage embedded sidebarCollapsed={sidebarNarrow} onUpgrade={() => setActiveTab("settings")} />}
          {activeTab === "referral" && <ReferralProgramPage />}
        </div>
      </main>

      {/* Add Credits Modal */}
      <AddCreditsModal
        isOpen={showAddCredits}
        onClose={() => setShowAddCredits(false)}
        sidebarCollapsed={sidebarNarrow}
      />

      {/* Purchase Success Modal */}
      {purchaseDetails && (
        <PurchaseSuccessModal
          isOpen={showSuccessModal}
          onClose={() => setShowSuccessModal(false)}
          credits={purchaseDetails.credits}
          type={purchaseDetails.type}
          tierName={purchaseDetails.tierName}
        />
      )}

      {/* Premium Feature Gate Popup */}
      <AnimatePresence>
        {showPremiumGate && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div 
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setShowPremiumGate(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md rounded-2xl overflow-hidden"
              style={{ background: 'rgba(15,15,25,0.98)', border: '1px solid rgba(255,255,255,0.1)' }}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-transparent to-violet-500/5 pointer-events-none" />
              <div className="relative p-6 sm:p-8 text-center">
                <button
                  onClick={() => setShowPremiumGate(false)}
                  className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
                  data-testid="button-close-premium-gate"
                >
                  <X className="w-5 h-5" />
                </button>
                <div className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)' }}>
                  <Lock className="w-8 h-8 text-violet-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2" data-testid="text-premium-gate-title">{copy.premiumGateTitle}</h3>
                <p className="text-slate-400 text-sm mb-6" data-testid="text-premium-gate-description">
                  {copy.premiumGateDescription}
                </p>
                <button
                  onClick={() => {
                    setShowPremiumGate(false);
                    setShowAddCredits(true);
                  }}
                  className="w-full py-3 rounded-xl font-semibold text-black transition-all hover:scale-[1.02]"
                  style={{ background: 'linear-gradient(135deg, #a78bfa, #7c3aed)' }}
                  data-testid="button-premium-subscribe"
                >
                  {copy.premiumGateViewPlans}
                </button>
                <button
                  onClick={() => setShowPremiumGate(false)}
                  className="w-full mt-3 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white transition-colors"
                  data-testid="button-premium-dismiss"
                >
                  {copy.premiumGateMaybeLater}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Earn Money Modal */}
      <AnimatePresence>
      {showEarnModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4">
          <div 
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setShowEarnModal(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative w-full max-w-lg max-h-[90vh] rounded-2xl sm:rounded-3xl overflow-hidden glass-panel-strong"
          >
            {/* Subtle emerald tint */}
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-emerald-500/5 pointer-events-none" />
            <div className="relative p-4 sm:p-8 max-h-[90vh] overflow-y-auto">
              <button
                onClick={() => setShowEarnModal(false)}
                className="absolute top-3 right-3 sm:top-4 sm:right-4 text-gray-500 hover:text-white transition-colors z-10"
                data-testid="button-close-earn-modal"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              <div className="text-center mb-4 sm:mb-6">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-3 sm:mb-4">
                  <DollarSign className="w-7 h-7 sm:w-8 sm:h-8 text-emerald-400" />
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold text-white mb-1 sm:mb-2">
                  {copy.earnModalTitle}
                </h2>
              </div>

              <div className="space-y-3 sm:space-y-4 text-gray-300 mb-4 sm:mb-6">
                <p className="text-base sm:text-lg leading-relaxed">
                  {copy.earnModalBody1}
                </p>
                <p className="text-base sm:text-lg leading-relaxed">
                  {copy.earnModalBody2}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 sm:gap-3 text-xs sm:text-sm text-emerald-400 mb-4 sm:mb-8 justify-center">
                <span className="flex items-center gap-1 sm:gap-1.5 bg-white/[0.06] px-2 sm:px-3 py-1 sm:py-1.5 rounded-full border border-white/10">
                  <DollarSign className="w-3 h-3 sm:w-4 sm:h-4" /> {copy.earnModalChipKeepProfits}
                </span>
                <span className="flex items-center gap-1 sm:gap-1.5 bg-white/[0.06] px-2 sm:px-3 py-1 sm:py-1.5 rounded-full border border-white/10">
                  <Users className="w-3 h-3 sm:w-4 sm:h-4" /> {copy.earnModalChipNoRealModels}
                </span>
                <span className="flex items-center gap-1 sm:gap-1.5 bg-white/[0.06] px-2 sm:px-3 py-1 sm:py-1.5 rounded-full border border-white/10">
                  <Clock className="w-3 h-3 sm:w-4 sm:h-4" /> {copy.earnModalChipEarn247}
                </span>
              </div>

              <a
                href="https://www.fanvue.com/signup?referral=FV-WLIDG6"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 px-4 sm:px-6 py-3 sm:py-4 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 font-bold text-base sm:text-lg rounded-xl transition-all mb-3 sm:mb-4"
                data-testid="button-fanvue-affiliate-modal"
              >
                {copy.earnModalCta}
                <ExternalLink className="w-4 h-4 sm:w-5 sm:h-5" />
              </a>

              <div className="text-center pt-3 sm:pt-4 border-t border-white/5">
                <p className="text-gray-400 text-xs sm:text-sm mb-2 sm:mb-3">
                  {copy.earnModalDiscordText}
                </p>
                <a
                  href="https://discord.gg/vpwGygjEaB"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-indigo-400 hover:text-indigo-300 font-semibold transition-colors text-sm sm:text-base"
                  data-testid="button-discord-modal"
                >
                  <svg className="w-4 h-4 sm:w-5 sm:h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                  </svg>
                  {copy.earnModalDiscordCta}
                </a>
              </div>
            </div>
          </motion.div>
        </div>
      )}
      </AnimatePresence>

      {/* Affiliate Program Modal */}
      <AnimatePresence>
      {showReferralModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4">
          <div 
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setShowReferralModal(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative w-full max-w-lg max-h-[90vh] rounded-2xl sm:rounded-3xl overflow-hidden glass-panel-strong"
          >
            {/* Subtle pink tint */}
            <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 via-transparent to-pink-500/5 pointer-events-none" />
            <div className="relative p-4 sm:p-8 max-h-[90vh] overflow-y-auto">
              <button
                onClick={() => setShowReferralModal(false)}
                className="absolute top-3 right-3 sm:top-4 sm:right-4 text-gray-500 hover:text-white transition-colors z-10"
                data-testid="button-close-referral-modal"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              <div className="text-center mb-4 sm:mb-6">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-3 sm:mb-4">
                  <Share2 className="w-7 h-7 sm:w-8 sm:h-8 text-purple-400" />
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold text-white mb-1 sm:mb-2">
                  {copy.referralModalTitle}
                </h2>
                <p className="text-purple-300 text-sm sm:text-base">
                  {copy.referralModalSubtitle}
                </p>
              </div>

              <div className="space-y-3 sm:space-y-4 text-gray-300 mb-4 sm:mb-6">
                <div className="bg-purple-500/5 border border-purple-500/15 rounded-xl p-3 sm:p-4">
                  <h3 className="font-semibold text-white mb-2 flex items-center gap-2 text-sm sm:text-base">
                    <Gift className="w-4 h-4 sm:w-5 sm:h-5 text-purple-400" />
                    {copy.referralModalHowItWorks}
                  </h3>
                  <ul className="space-y-1.5 sm:space-y-2 text-xs sm:text-sm">
                    <li className="flex items-start gap-2">
                      <span className="text-purple-400 font-bold">1.</span>
                      {copy.referralModalStep1}
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-purple-400 font-bold">2.</span>
                      {copy.referralModalStep2}
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-purple-400 font-bold">3.</span>
                      {copy.referralModalStep3}
                    </li>
                  </ul>
                </div>
              </div>

              <button
                onClick={() => {
                  setShowReferralModal(false);
                  setActiveTab("referral");
                }}
                className="w-full inline-flex items-center justify-center gap-2 px-4 sm:px-6 py-3 sm:py-4 bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 font-bold text-base sm:text-lg rounded-xl transition-all mb-3 sm:mb-4"
                data-testid="button-open-referral-program"
              >
                {copy.referralModalCta}
              </button>

              <div className="flex flex-wrap gap-2 sm:gap-3 text-xs sm:text-sm text-purple-300 justify-center">
                <span className="flex items-center gap-1 sm:gap-1.5 bg-purple-500/10 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full border border-purple-500/15">
                  <DollarSign className="w-3 h-3 sm:w-4 sm:h-4" /> {copy.referralModalChipCommission}
                </span>
                <span className="flex items-center gap-1 sm:gap-1.5 bg-purple-500/10 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full border border-purple-500/15">
                  <Clock className="w-3 h-3 sm:w-4 sm:h-4" /> {copy.referralModalChipPayouts}
                </span>
                <span className="flex items-center gap-1 sm:gap-1.5 bg-purple-500/10 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full border border-purple-500/15">
                  <Users className="w-3 h-3 sm:w-4 sm:h-4" /> {copy.referralModalChipUnlimited}
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      )}
      </AnimatePresence>

      {/* Create Model Modal */}
      <CreateModelModal
        isOpen={showCreateModelModal}
        onClose={() => setShowCreateModelModal(false)}
        sidebarCollapsed={sidebarNarrow}
        onSuccess={() => {
          setShowCreateModelModal(false);
          setActiveTab("models");
          loadUserProfile();
        }}
        initialMode={uploadRealMode ? "upload" : "generate"}
      />

      {/* What's New Modal */}
      <AnimatePresence>
      {showWhatsNew && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={handleCloseWhatsNew}
        >
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl overflow-hidden glass-panel-strong"
          >
            <div 
              className="p-5 text-center"
              style={{ 
                background: 'linear-gradient(135deg, rgba(244,63,94,0.15), rgba(236,72,153,0.1))',
                borderBottom: '1px solid rgba(244,63,94,0.2)'
              }}
            >
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500/20 to-pink-500/20 mb-3">
                <Flame className="w-7 h-7 text-rose-400" />
              </div>
              <h2 className="text-xl font-bold text-white mb-1">{copy.whatsNewTitle}</h2>
              <p className="text-sm text-slate-400">{copy.whatsNewSubtitle}</p>
            </div>
            
            <div className="p-5">
              <div className="flex items-start gap-3 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 mb-4">
                <Flame className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-white mb-1">{copy.whatsNewFeatureTitle}</h3>
                  <p className="text-sm text-slate-300">
                    {copy.whatsNewFeatureBody}
                  </p>
                </div>
              </div>
              
              <p className="text-xs text-slate-500 text-center mb-4">
                {copy.whatsNewNote}
              </p>
              
              <button
                onClick={() => {
                  handleCloseWhatsNew();
                  setActiveTab("nsfw");
                }}
                className="w-full py-3 rounded-xl font-semibold text-white transition-all hover:scale-[1.02]"
                style={{ background: 'linear-gradient(135deg, #F43F5E, #EC4899)' }}
              >
                <span className="flex items-center justify-center gap-2">
                  <Flame className="w-4 h-4" />
                  {copy.whatsNewCta}
                </span>
              </button>
              
              <button
                onClick={handleCloseWhatsNew}
                className="w-full mt-2 py-2 text-sm text-slate-400 hover:text-white transition-colors"
              >
                {copy.whatsNewMaybeLater}
              </button>
            </div>
          </motion.div>
        </div>
      )}
      </AnimatePresence>
    </div>
  );
}

function HomePage({ copy, setActiveTab, setShowEarnModal, setShowReferralModal, onOpenCreateModel, onOpenUploadReal, onOpenCredits }) {
  const { user } = useAuthStore();
  const [monthlyStats, setMonthlyStats] = useState({ images: 0, videos: 0 });
  const [showTutorial, setShowTutorial] = useState(() => {
    return safeLocalStorageGet("tutorial-dismissed") !== "true";
  });
  const [tutorialVideoUrl, setTutorialVideoUrl] = useState("https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/static/dashboard_video.mp4");
  const [recentGenerations, setRecentGenerations] = useState([]);

  useEffect(() => {
    fetchMonthlyStats();
    // Load dynamic tutorial video URL from branding API
    fetch("/api/brand", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (d?.branding?.tutorialVideoUrl) setTutorialVideoUrl(d.branding.tutorialVideoUrl); })
      .catch(() => {});
  }, []);

  const fetchMonthlyStats = async () => {
    try {
      const [statsRes, historyRes] = await Promise.all([
        fetch("/api/generations/monthly-stats", { credentials: "include" }),
        fetch("/api/generations?limit=50&status=completed", { credentials: "include" }),
      ]);

      const [statsData, historyData] = await Promise.all([
        statsRes.json(),
        historyRes.json(),
      ]);

      if (statsData.success) {
        setMonthlyStats({ images: statsData.images, videos: statsData.videos });
      }

      if (historyData.success) {
        const recentWithMedia = (historyData.generations || [])
          .filter((g) => g.resultUrl || g.outputUrl)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 6);
        setRecentGenerations(recentWithMedia);
      }
    } catch (error) {
      console.error("Failed to fetch monthly stats:", error);
    }
  };

  const gradientPurple = 'linear-gradient(135deg, #8B5CF6, #3B82F6)';
  const gradientCyan = 'linear-gradient(135deg, #22D3EE, #14B8A6)';
  const gradientPink = 'linear-gradient(135deg, #EC4899, #8B5CF6)';
  const gradientGreen = 'linear-gradient(135deg, #10B981, #22D3EE)';

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header Section */}
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-2">
          <div>
            <h1 className="text-[40px] font-bold text-white">
              {copy.homeWelcomeBack} <span className="text-white">{user?.name || copy.homeFallbackCreator}</span>
            </h1>
            <p className="text-slate-400 text-xl mt-2">{copy.homeSubtitle}</p>
          </div>
        </div>
      </div>

      {/* Spacer */}
      <div className="mb-8" />

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
        {/* Credits card */}
        {(() => {
          const credits = user?.credits || 0;
          const isCritical = credits < 50;
          const accent = isCritical ? '239,68,68' : '234,179,8';
          return (
            <div
              className="rounded-xl p-4 text-center transition-all hover:scale-[1.02] hover:z-10 relative backdrop-blur-xl overflow-hidden"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
              }}
            >
              <div
                className="absolute top-0 left-0 w-28 h-28 pointer-events-none"
                style={{
                  background: `radial-gradient(ellipse 100% 100% at 0% 0%, rgba(${accent},0.22) 0%, rgba(${accent},0.06) 45%, transparent 70%)`,
                }}
              />
              <div className="relative">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <Coins className={`w-4 h-4 ${isCritical ? 'text-red-400' : 'text-yellow-400'}`} />
                  <span className={`text-[10px] uppercase tracking-wider font-medium ${isCritical ? 'text-red-400' : 'text-yellow-400'}`}>{copy.statsCredits}</span>
                </div>
                <p className={`text-2xl sm:text-3xl font-bold tabular-nums ${isCritical ? 'text-red-300' : 'text-yellow-200'}`}>{credits}</p>
                <button
                  onClick={(e) => { e.stopPropagation(); onOpenCredits?.(); }}
                  className={`mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium transition-all hover:scale-105 ${
                    isCritical
                      ? 'bg-red-500/20 border border-red-500/50 text-red-300 hover:bg-red-500/30'
                      : 'bg-yellow-500/20 border border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/30'
                  }`}
                >
                  <Plus className="w-3 h-3" />
                  {copy.statsAddCredits}
                </button>
              </div>
            </div>
          );
        })()}

        {/* Images card */}
        <div
          className="rounded-xl p-4 text-center transition-all hover:scale-[1.02] hover:z-10 relative backdrop-blur-xl overflow-hidden"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          <div
            className="absolute top-0 left-0 w-28 h-28 pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse 100% 100% at 0% 0%, rgba(139,92,246,0.22) 0%, rgba(139,92,246,0.06) 45%, transparent 70%)',
            }}
          />
          <div className="relative">
            <div className="flex items-center justify-center gap-2 mb-1">
              <ImageIcon className="w-4 h-4 text-purple-400" />
              <span className="text-[10px] uppercase tracking-wider text-purple-300 font-medium" style={{ color: 'rgba(208, 171, 247, 1)' }}>{copy.statsImages}</span>
            </div>
            <p className="text-2xl sm:text-3xl font-bold text-purple-200 tabular-nums">{monthlyStats.images}</p>
            <p className="text-[9px] text-slate-500 mt-0.5 uppercase tracking-wide">{copy.statsThisMonth}</p>
          </div>
        </div>

        {/* Videos card */}
        <div
          className="rounded-xl p-4 text-center transition-all hover:scale-[1.02] hover:z-10 relative backdrop-blur-xl overflow-hidden"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          <div
            className="absolute top-0 left-0 w-28 h-28 pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse 100% 100% at 0% 0%, rgba(34,211,238,0.22) 0%, rgba(34,211,238,0.06) 45%, transparent 70%)',
            }}
          />
          <div className="relative">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Video className="w-4 h-4 text-cyan-400" />
              <span className="text-[10px] uppercase tracking-wider text-cyan-300 font-medium">{copy.statsVideos}</span>
            </div>
            <p className="text-2xl sm:text-3xl font-bold text-cyan-200 tabular-nums">{monthlyStats.videos}</p>
            <p className="text-[9px] text-slate-500 mt-0.5 uppercase tracking-wide">{copy.statsThisMonth}</p>
          </div>
        </div>
      </div>

      {/* Content Creation Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <button
          onClick={() => { setActiveTab("creator-studio"); }}
          className="group relative rounded-xl p-5 text-left transition-all hover:scale-[1.02] overflow-hidden"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          <div className="absolute top-0 right-0 w-32 h-32 pointer-events-none rounded-xl" style={{ background: 'radial-gradient(circle at 100% 0%, rgba(255,255,255,0.06) 0%, transparent 70%)' }} />
          <div className="relative flex items-center gap-4">
            <div className="flex-1">
              <h3 className="text-lg font-bold text-white mb-1">Create Content</h3>
              <p className="text-slate-400 text-sm">Use our creator studio to create cinema grade content.</p>
            </div>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 border border-white/20">
              <Wand2 className="w-6 h-6 text-white" />
            </div>
          </div>
        </button>

        <button
          onClick={() => { setActiveTab("generate"); }}
          className="group relative rounded-xl p-5 text-left transition-all hover:scale-[1.02] overflow-hidden"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
        >
          <div className="absolute top-0 right-0 w-32 h-32 pointer-events-none rounded-xl" style={{ background: 'radial-gradient(circle at 100% 0%, rgba(255,255,255,0.06) 0%, transparent 70%)' }} />
          <div className="relative flex items-center gap-4">
            <div className="flex-1">
              <h3 className="text-lg font-bold text-white mb-1">Create Content with Avatar</h3>
              <p className="text-slate-400 text-sm">Create personalised content with your AI avatar.</p>
            </div>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 border border-white/20">
              <User className="w-6 h-6 text-white" />
            </div>
          </div>
        </button>
      </div>

      {/* Main Action Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {/* Create AI Model - Primary CTA */}
        <button
          onClick={() => { setActiveTab("models"); }}
          className="group relative rounded-xl p-5 text-left transition-all hover:scale-[1.02] overflow-hidden"
          style={{ 
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
          data-testid="button-create-ai-model"
        >
          <div className="absolute top-0 right-0 w-32 h-32 pointer-events-none rounded-xl" style={{ background: 'radial-gradient(circle at 100% 0%, rgba(255,255,255,0.06) 0%, transparent 70%)' }} />
          <div className="relative flex items-center gap-4">
            <div className="flex-1">
              <h3 className="text-lg font-bold text-white mb-1">{copy.mainCreateModelTitle}</h3>
              <p className="text-slate-400 text-sm">{copy.mainCreateModelBody}</p>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-200 backdrop-blur-xl border border-white/20 group-hover:border-transparent relative"
              style={{ 
                background: 'rgba(255,255,255,0.05)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
              }}
              data-icon-box
            >
              <div 
                className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-200 border border-white/10"
                style={{ 
                  background: 'rgba(208, 171, 247, 0.12)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
                }}
              />
              <Plus className="w-6 h-6 text-white relative z-[1]" />
            </div>
          </div>
        </button>

        {/* Upload Real Model */}
        <button
          onClick={() => { setActiveTab("models"); }}
          className="group relative rounded-xl p-5 text-left transition-all hover:scale-[1.02] overflow-hidden"
          style={{ 
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
          }}
          data-testid="button-upload-real-model"
        >
          <div className="absolute top-0 right-0 w-32 h-32 pointer-events-none rounded-xl" style={{ background: 'radial-gradient(circle at 100% 0%, rgba(255,255,255,0.06) 0%, transparent 70%)' }} />
          <div className="relative flex items-center gap-4">
            <div className="flex-1">
              <h3 className="text-lg font-bold text-white mb-1">{copy.mainUploadRealTitle}</h3>
              <p className="text-slate-400 text-sm">{copy.mainUploadRealBody}</p>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-200 backdrop-blur-xl border border-white/20 group-hover:border-transparent relative"
              style={{ 
                background: 'rgba(255,255,255,0.05)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
              }}
            >
              <div 
                className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-200 border border-white/10"
                style={{ 
                  background: 'linear-gradient(135deg, rgba(34, 211, 238, 0.12), rgba(20, 184, 166, 0.12))',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
                }}
              />
              <Upload className="w-6 h-6 text-white relative z-[1]" />
            </div>
          </div>
        </button>
      </div>

      {/* Getting Started Video - Dismissable */}
      {showTutorial && (
        <div 
          className="rounded-xl p-4 mb-6 backdrop-blur-xl"
          style={{ 
            background: 'rgba(139,92,246,0.04)',
            border: '1px solid rgba(139,92,246,0.08)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-white" />
              <span className="text-sm font-medium text-slate-300">{copy.tutorialTitle}</span>
            </div>
            <button
              onClick={() => {
                safeLocalStorageSet("tutorial-dismissed", "true");
                setShowTutorial(false);
              }}
              className="text-slate-500 hover:text-slate-300 transition-colors p-1"
              data-testid="button-dismiss-tutorial"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="max-w-2xl mx-auto">
            <div className="aspect-video rounded-lg overflow-hidden border border-white/5">
              <video 
                className="w-full h-full object-cover"
                controls
                playsInline
                data-testid="video-getting-started"
              >
                <source src={tutorialVideoUrl} type="video/mp4" />
              </video>
            </div>
          </div>
        </div>
      )}

      {/* Recent Generations */}
      {recentGenerations.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <label className="block text-[11px] uppercase tracking-[0.15em] text-slate-400 font-medium">{copy.recentCreations}</label>
            <button
              onClick={() => { setActiveTab("history"); }}
              className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors"
              data-testid="button-view-all-history"
            >
              <span>{copy.viewAll}</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {recentGenerations.map((gen) => {
              const isVideo = ["video", "prompt-video", "face-swap", "recreate-video", "talking-head", "nsfw-video", "nsfw-video-extend"].includes(gen.type);
              const rawUrl = gen.resultUrl || gen.outputUrl || "";
              let mediaUrl = rawUrl;
              try {
                const parsed = JSON.parse(rawUrl);
                if (Array.isArray(parsed) && parsed.length > 0) mediaUrl = parsed[0];
              } catch {}
              return (
                <button
                  key={gen.id}
                  onClick={() => { setActiveTab("history"); }}
                  className="group relative aspect-square rounded-lg overflow-hidden border border-white/10 hover:border-purple-500/30 transition-all"
                  data-testid={`recent-gen-${gen.id}`}
                >
                  {isVideo ? (
                    <video
                      src={mediaUrl}
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                      onMouseEnter={(e) => e.target.play().catch(() => {})}
                      onMouseLeave={(e) => { e.target.pause(); e.target.currentTime = 0; }}
                    />
                  ) : (
                    <img
                      src={mediaUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  )}
                  {isVideo && (
                    <div className="absolute top-1 right-1 bg-black/60 rounded px-1 py-0.5">
                      <Video className="w-3 h-3 text-white" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick Actions Grid */}
      <div className="mb-6">
        <label className="block text-[11px] uppercase tracking-[0.15em] text-white font-medium mb-3">{copy.quickActionsTitle}</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Go to Models */}
          <button
            onClick={() => { setActiveTab("models"); }}
            className="group relative rounded-xl p-4 text-left transition-all hover:scale-[1.02] overflow-hidden backdrop-blur-2xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
            style={{ 
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.12)'
            }}
            data-testid="button-quick-models"
          >
            <div className="absolute top-0 right-0 w-20 h-20 pointer-events-none rounded-xl" style={{ background: 'radial-gradient(circle at 100% 0%, rgba(255,255,255,0.05) 0%, transparent 70%)' }} />
            <div className="relative">
              <div className="flex items-center gap-3 mb-2">
                <div 
                  className="w-9 h-9 rounded-lg flex items-center justify-center border border-purple-300 relative"
                  style={{ background: 'transparent' }}
                >
                  <div 
                    className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-200 border border-white/10"
                    style={{ 
                      background: 'rgba(196, 181, 253, 0.12)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
                    }}
                  />
                  <User className="w-4 h-4 text-purple-300 relative z-[1]" />
                </div>
                <span className="text-sm font-semibold text-purple-300">{copy.quickCreateModelTitle}</span>
              </div>
              <p className="text-xs text-slate-400 mb-3">{copy.quickCreateModelBody}</p>
              <div className="flex items-center gap-1 text-purple-400 text-xs font-medium group-hover:gap-2 transition-all">
                <span>{copy.quickGetStarted}</span>
                <ArrowRight className="w-3 h-3" />
              </div>
            </div>
          </button>

          {/* Earn with AI */}
          <button
            onClick={() => { setShowEarnModal(true); }}
            className="group relative rounded-xl p-4 text-left transition-all hover:scale-[1.02] overflow-hidden backdrop-blur-2xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
            style={{ 
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.12)'
            }}
            data-testid="button-quick-earn"
          >
            <div className="absolute top-0 right-0 w-20 h-20 pointer-events-none rounded-xl" style={{ background: 'radial-gradient(circle at 100% 0%, rgba(255,255,255,0.05) 0%, transparent 70%)' }} />
            <div className="relative">
              <div className="flex items-center gap-3 mb-2">
                <div 
                  className="w-9 h-9 rounded-lg flex items-center justify-center border border-emerald-300 relative"
                  style={{ background: 'transparent' }}
                >
                  <div 
                    className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-200 border border-white/10"
                    style={{ 
                      background: 'rgba(110, 231, 183, 0.12)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
                    }}
                  />
                  <DollarSign className="w-4 h-4 text-emerald-300 relative z-[1]" />
                </div>
                <span className="text-sm font-semibold text-emerald-300">{copy.quickStartEarningTitle}</span>
              </div>
              <p className="text-xs text-slate-400 mb-3">{copy.quickStartEarningBody}</p>
              <div className="flex items-center gap-1 text-emerald-400 text-xs font-medium group-hover:gap-2 transition-all">
                <span>{copy.quickLearnMore}</span>
                <ArrowRight className="w-3 h-3" />
              </div>
            </div>
          </button>

          {/* Share & Earn */}
          <button
            onClick={() => { setShowReferralModal(true); }}
            className="group relative rounded-xl p-4 text-left transition-all hover:scale-[1.02] overflow-hidden backdrop-blur-2xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
            style={{ 
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.12)'
            }}
            data-testid="button-quick-share"
          >
            <div className="absolute top-0 right-0 w-20 h-20 pointer-events-none rounded-xl" style={{ background: 'radial-gradient(circle at 100% 0%, rgba(255,255,255,0.05) 0%, transparent 70%)' }} />
            <div className="relative">
              <div className="flex items-center gap-3 mb-2">
                <div 
                  className="w-9 h-9 rounded-lg flex items-center justify-center border border-pink-300 relative"
                  style={{ background: 'transparent' }}
                >
                  <div 
                    className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-200 border border-white/10"
                    style={{ 
                      background: 'rgba(249, 168, 212, 0.12)',
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
                    }}
                  />
                  <Share2 className="w-4 h-4 text-pink-300 relative z-[1]" />
                </div>
                <span className="text-sm font-semibold text-pink-300">{copy.quickAffiliateTitle}</span>
              </div>
              <p className="text-xs text-slate-400 mb-3">{copy.quickAffiliateBody}</p>
              <div className="flex items-center gap-1 text-pink-400 text-xs font-medium group-hover:gap-2 transition-all">
                <span>{copy.quickStartEarningTitle}</span>
                <ArrowRight className="w-3 h-3" />
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Start Creating CTA */}
      <div 
        className="rounded-2xl p-5 backdrop-blur-2xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
        style={{ 
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.12)',
        }}
      >
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-center sm:text-left">
            <div 
              className="w-10 h-10 rounded-xl flex items-center justify-center border border-white/20"
              style={{ background: 'transparent' }}
            >
              <Zap className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">{copy.ctaReadyTitle}</h3>
              <p className="text-slate-400 text-sm">{copy.ctaReadyBody}</p>
            </div>
          </div>
          <button
            onClick={() => { setActiveTab("generate"); }}
            className="w-full sm:w-auto px-6 py-3 rounded-xl font-semibold text-black transition-all hover:bg-slate-100 hover:scale-105"
            style={{ background: '#ffffff' }}
            data-testid="button-start-generating"
          >
            <span className="flex items-center justify-center gap-2">
              <ArrowRight className="w-4 h-4" />
              {copy.ctaStartGenerating}
            </span>
          </button>
        </div>
      </div>
      
    </div>
  );
}
