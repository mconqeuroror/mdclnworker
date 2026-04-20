import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  Home,
  Users,
  Clock,
  Settings as SettingsIcon,
  DollarSign,
  Share2,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Coins,
  Plus,
  Shield,
  MessageCircle,
  Flame,
  Lock,
  Briefcase,
  BookOpen,
  Shuffle,
  TrendingUp,
  User,
  ChevronDown,
  CreditCard,
  FileType2,
  Clapperboard,
  Mic,
  Sun,
  Moon,
  ZoomIn,
  Wand2,
  Image as ImageIcon,
  Pin,
  PinOff,
  Volume2,
  VolumeX,
  Eye,
  EyeOff,
} from "lucide-react";
import { SiTelegram, SiDiscord, SiInstagram } from "react-icons/si";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useBranding } from "../hooks/useBranding";
import { useTheme } from "../hooks/useTheme.jsx";
import { usePrivateMode } from "../hooks/usePrivateMode.js";
import { hasPremiumAccess } from "../utils/premiumAccess";
import { sound } from "../utils/sounds";

const LOCALE_STORAGE_KEY = "app_locale";
const SUPPORTED_LOCALES = ["en", "ru"];
const hasRestrictedFeatureAccess = (user) => {
  if (!user) return false;
  if (user?.role === "admin") return true;
  const sub = String(user?.subscriptionStatus || "").toLowerCase();
  if (sub === "active" || sub === "trialing" || sub === "trial") return true;
  if (Boolean(user?.premiumFeaturesUnlocked)) return true;
  if (user?.stripeSubscriptionId || user?.stripeCustomerId) return true;

  const paidSignals = [
    user?.spent,
    user?.totalSpent,
    user?.totalSpentCents,
    user?.totalCreditsUsed,
    user?.purchasedCredits,
  ];
  return paidSignals.some((v) => Number(v) > 0);
};
const SIDEBAR_COPY = {
  en: {
    dashboard: "Dashboard",
    myModels: "My Avatars",
    generate: "Create with Avatar",
    creatorStudio: "Creator Studio",
    voiceStudio: "Voice Studio",
    reformatter: "Reformatter",
    firstFrameExtractor: "First Frame Extractor",
    upscaler: "Upscaler",
    modelcloneX: "ModelClone-X",
    history: "History",
    settings: "Settings",
    courses: "Courses",
    repurposer: "Photo/Video Repurposer",
    reelFinder: "Reel Finder",
    earnWithAi: "Earn With AI",
    referAndEarn: "Refer And Earn",
    addCredits: "Add Credits",
    changePassword: "Change Password",
    referralProgram: "Referral Program",
    logout: "Logout",
    navigation: "Navigation",
    monetize: "Monetize",
    socials: "Socials",
    soon: "Soon",
    jobBoard: "Job Board",
    adminPanel: "Admin Panel",
    collapse: "Collapse",
    proStudio: "Pro Studio",
    pinSidebar: "Pin sidebar open",
    unpinSidebar: "Unpin sidebar",
    soundOn: "Click sound on",
    soundOff: "Click sound off",
    privateModeOn: "Private Mode · On",
    privateModeOff: "Private Mode · Off",
    privateModeHint: "Blur all photos & videos (history, inputs, outputs)",
  },
  ru: {
    dashboard: "Панель",
    myModels: "Мои аватары",
    generate: "Создать с аватаром",
    creatorStudio: "Студия автора",
    voiceStudio: "Голосовая студия",
    reformatter: "Конвертер",
    firstFrameExtractor: "Первый кадр",
    upscaler: "Апскейлер",
    modelcloneX: "ModelClone-X",
    history: "История",
    settings: "Настройки",
    courses: "Курсы",
    repurposer: "Переработка фото/видео",
    reelFinder: "Поиск рилс",
    earnWithAi: "Заработок с ИИ",
    referAndEarn: "Приглашай и зарабатывай",
    addCredits: "Пополнить кредиты",
    changePassword: "Сменить пароль",
    referralProgram: "Реферальная программа",
    logout: "Выйти",
    navigation: "Навигация",
    monetize: "Монетизация",
    socials: "Соцсети",
    soon: "Скоро",
    jobBoard: "Биржа заказов",
    adminPanel: "Админ панель",
    collapse: "Свернуть",
    proStudio: "Pro Studio",
    pinSidebar: "Закрепить открытую панель",
    unpinSidebar: "Открепить панель",
    soundOn: "Звук клика включен",
    soundOff: "Звук клика выключен",
    privateModeOn: "Приватный режим · Вкл",
    privateModeOff: "Приватный режим · Выкл",
    privateModeHint: "Размыть все фото и видео (история, входы, результаты)",
  },
};

function getCurrentLocale() {
  try {
    const qsLang = new URLSearchParams(window.location.search).get("lang");
    const normalizedQs = String(qsLang || "").toLowerCase();
    if (SUPPORTED_LOCALES.includes(normalizedQs)) return normalizedQs;
    const saved = String(localStorage.getItem(LOCALE_STORAGE_KEY) || "").toLowerCase();
    if (SUPPORTED_LOCALES.includes(saved)) return saved;
    const browser = String(navigator.language || "").toLowerCase();
    return browser.startsWith("ru") ? "ru" : "en";
  } catch {
    return "en";
  }
}

export default function AppSidebar({
  activeTab,
  setActiveTab,
  user,
  hideRestrictedTabs: hideRestrictedTabsProp,
  onLogout,
  onOpenCredits,
  onOpenEarn,
  onOpenReferral,
  onOpenAdmin,
  collapsed: collapsedProp,
  setCollapsed: setCollapsedProp,
  sidebarPinned: sidebarPinnedProp,
  setSidebarPinned: setSidebarPinnedProp,
  onDesktopHoverChange,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const branding = useBranding();
  const { theme, toggleTheme } = useTheme();
  const canAccessPremium = hasPremiumAccess(user);
  const hideRestrictedTabs =
    typeof hideRestrictedTabsProp === "boolean"
      ? hideRestrictedTabsProp
      : !hasRestrictedFeatureAccess(user);
  const [localCollapsed, setLocalCollapsed] = useState(true);
  const collapsed = typeof collapsedProp === "boolean" ? collapsedProp : localCollapsed;
  const setCollapsed = setCollapsedProp || setLocalCollapsed;
  const [localSidebarPinned, setLocalSidebarPinned] = useState(false);
  const sidebarPinned = typeof sidebarPinnedProp === "boolean" ? sidebarPinnedProp : localSidebarPinned;
  const setSidebarPinned = setSidebarPinnedProp || setLocalSidebarPinned;
  /** Desktop: expand visually while pinned collapsed (rail + hover) */
  const [desktopHovered, setDesktopHovered] = useState(false);
  const [canHoverExpand, setCanHoverExpand] = useState(false);
  const visuallyCollapsed = collapsed && !desktopHovered;
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [locale, setLocale] = useState(getCurrentLocale);
  const [soundEnabled, setSoundEnabled] = useState(() => sound.isEnabled());
  const [privateMode, setPrivateMode] = usePrivateMode();
  const copy = SIDEBAR_COPY[locale] || SIDEBAR_COPY.en;
  const collapsedRow = visuallyCollapsed ? "justify-center px-0 gap-0 min-h-[44px]" : "";
  const collapsedProfileRow = visuallyCollapsed ? "justify-center px-0 gap-0 min-h-[48px]" : "";

  useEffect(() => {
    const computeCanHoverExpand = () => {
      if (typeof window === "undefined") return false;
      const desktopHoverCapable = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
      const isLargeDesktopViewport = window.innerWidth >= 1024;
      return desktopHoverCapable && isLargeDesktopViewport;
    };

    const update = () => {
      const allowed = computeCanHoverExpand();
      setCanHoverExpand(allowed);
      if (!allowed) {
        setDesktopHovered(false);
        onDesktopHoverChange?.(false);
      }
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [onDesktopHoverChange]);

  useEffect(() => {
    if (sidebarPinned && collapsed) {
      setCollapsed(false);
    }
    if (sidebarPinned) {
      setDesktopHovered(false);
      onDesktopHoverChange?.(false);
    }
  }, [sidebarPinned, collapsed, setCollapsed, onDesktopHoverChange]);

  useEffect(() => {
    if (!collapsed) {
      setDesktopHovered(false);
      onDesktopHoverChange?.(false);
    }
  }, [collapsed, onDesktopHoverChange]);

  const handleAsidePointerEnter = () => {
    if (sidebarPinned || !collapsed || !canHoverExpand) return;
    setDesktopHovered(true);
    onDesktopHoverChange?.(true);
  };

  const handleAsidePointerLeave = () => {
    if (sidebarPinned || !canHoverExpand) return;
    setDesktopHovered(false);
    onDesktopHoverChange?.(false);
  };

  const handleLocaleChange = (nextLocale) => {
    if (!SUPPORTED_LOCALES.includes(nextLocale)) return;
    if (nextLocale === locale) return;
    setLocale(nextLocale);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    } catch {
      // Ignore storage errors
    }
    const params = new URLSearchParams(location.search);
    params.set("lang", nextLocale);
    const nextSearch = params.toString();
    const nextUrl = `${location.pathname}${nextSearch ? `?${nextSearch}` : ""}${location.hash || ""}`;
    window.location.assign(nextUrl);
  };

  const mainNavItems = [
    { id: "home", label: copy.dashboard, icon: Home },
    { id: "models", label: copy.myModels, icon: Users },
    { id: "generate", label: copy.generate, icon: Zap },
    { id: "creator-studio", label: copy.creatorStudio, icon: Clapperboard, isCreatorStudio: true },
    { id: "voice-studio", label: copy.voiceStudio, icon: Mic, premium: true },
    { id: "reformatter", label: copy.reformatter, icon: FileType2 },
    { id: "frame-extractor", label: copy.firstFrameExtractor, icon: ImageIcon },
    { id: "upscaler", label: copy.upscaler, icon: ZoomIn },
    { id: "modelclone-x", label: copy.modelcloneX, icon: Wand2 },
    { id: "history", label: copy.history, icon: Clock },
    { id: "settings", label: copy.settings, icon: SettingsIcon },
    { id: "course", label: copy.courses, icon: BookOpen, premium: true },
    { id: "nsfw", label: "NSFW", icon: Flame, isNsfw: true },
    { id: "repurposer", label: copy.repurposer, icon: Shuffle, premium: true },
    { id: "reelfinder", label: copy.reelFinder, icon: SiInstagram, premium: true },
  ];
  const visibleMainNavItems = mainNavItems.filter((item) => {
    if (!hideRestrictedTabs) return true;
    return item.id !== "nsfw" && item.id !== "course";
  });

  const promoItems = [
    {
      id: "earn",
      label: copy.earnWithAi,
      icon: DollarSign,
      action: onOpenEarn,
    },
    {
      id: "share",
      label: copy.referAndEarn,
      icon: Share2,
      action: onOpenReferral,
    },
  ];

  return (
    <motion.aside
      initial={false}
      animate={{ width: visuallyCollapsed ? 80 : 260 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      className="fixed left-0 top-0 h-screen z-50 flex flex-col max-md:pointer-events-auto md:overflow-visible backdrop-blur-2xl rounded-r-[2rem] overflow-hidden"
      style={{
        background:
          theme === "light"
            ? "linear-gradient(180deg, rgba(255,255,255,0.72) 0%, rgba(241,245,249,0.62) 100%)"
            : "linear-gradient(180deg, rgba(15,15,23,0.78) 0%, rgba(10,10,18,0.82) 100%)",
        borderTop: "1px solid var(--border-subtle)",
        borderBottom: "1px solid var(--border-subtle)",
        borderLeft: "1px solid var(--border-subtle)",
        borderRight: "none",
        boxShadow:
          theme === "light"
            ? "0 12px 32px rgba(15,23,42,0.12), inset 0 1px 0 rgba(255,255,255,0.55)"
            : "0 14px 34px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 38px rgba(139,92,246,0.12)",
      }}
      onPointerEnter={handleAsidePointerEnter}
      onPointerLeave={handleAsidePointerLeave}
    >
      {/* Subtle purple glow under glass panel */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 120% 75% at 0% 0%, rgba(139,92,246,0.16) 0%, rgba(139,92,246,0.06) 38%, transparent 72%)",
        }}
      />

      {/* Logo Section — always returns to dashboard home (same tab stack as /dashboard) */}
      <div className="p-5 mb-2">
        <Link
          to="/dashboard"
          onClick={() => setActiveTab("home")}
          className={`flex items-center gap-3 hover:opacity-80 transition-opacity ${visuallyCollapsed ? "justify-center" : ""}`}
        >
          <div className="relative flex-shrink-0">
            <img
              src={branding.logoUrl}
              alt={branding.appName}
              className="w-11 h-11 rounded-xl object-contain"
              style={{ transform: 'translateZ(0)', backfaceVisibility: 'hidden', imageRendering: 'auto' }}
            />
          </div>
          <AnimatePresence>
            {!visuallyCollapsed && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
              >
                <span className="text-lg font-bold text-white">
                  {branding.appName}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </Link>
      </div>

      {/* User Profile - above Credits */}
      <div className="px-4 mb-3">
        <div className="relative">
          <button
            onClick={() => {
              setShowProfileMenu(!showProfileMenu);
            }}
            className={`w-full flex items-center gap-3 rounded-xl transition-all hover:bg-white/5 px-3 py-2.5 ${
              collapsedProfileRow
            }`}
            data-testid="button-profile-menu"
          >
            <div className="w-8 h-8 rounded-full border border-white/20 flex items-center justify-center flex-shrink-0" style={{ background: 'transparent' }}>
              <User className="w-4 h-4 text-white" />
            </div>
            <AnimatePresence>
              {!visuallyCollapsed && (
                <motion.div
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -6 }}
                  className="flex items-center gap-2 flex-1 min-w-0"
                >
                  <span className="text-sm font-medium text-white truncate">
                    {user?.name || user?.email?.split("@")[0] || "Profile"}
                  </span>
                  <div
                    className="ml-auto inline-flex items-center rounded-md border border-white/10 bg-white/[0.03] p-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {SUPPORTED_LOCALES.map((code) => {
                      const active = locale === code;
                      return (
                        <button
                          key={code}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLocaleChange(code);
                          }}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase transition ${
                            active
                              ? "bg-white text-black"
                              : "text-slate-400 hover:text-white hover:bg-white/[0.08]"
                          }`}
                          data-testid={`locale-switch-${code}`}
                        >
                          {code}
                        </button>
                      );
                    })}
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${
                      showProfileMenu ? "rotate-180" : ""
                    }`}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </button>

          {/* Profile dropdown */}
          <AnimatePresence>
            {showProfileMenu && !visuallyCollapsed && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowProfileMenu(false)}
                  aria-hidden="true"
                />
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute left-0 right-0 top-full mt-1 w-full min-w-[200px] rounded-xl overflow-hidden z-50 glass-panel"
                >
                  <div className="px-4 py-3 border-b border-white/10">
                    <p className="text-sm font-medium text-white truncate">{user?.email}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-xs text-slate-400 font-semibold inline-flex items-center gap-1">
                        {user?.credits || 0} <Coins className="w-3.5 h-3.5 text-yellow-400" />
                      </span>
                    </div>
                  </div>
                  <div className="py-2">
                    <button
                      onClick={() => {
                        setShowProfileMenu(false);
                        onOpenCredits();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                      data-testid="menu-add-credits"
                    >
                      <CreditCard className="w-4 h-4 text-slate-400" />
                      {copy.addCredits}
                    </button>
                    <button
                      onClick={() => {
                        setShowProfileMenu(false);
                        setActiveTab("settings");
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                      data-testid="menu-change-password"
                    >
                      <Lock className="w-4 h-4 text-slate-400" />
                      {copy.changePassword}
                    </button>
                    <button
                      onClick={() => {
                        setShowProfileMenu(false);
                        setActiveTab("settings");
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                      data-testid="menu-settings"
                    >
                      <SettingsIcon className="w-4 h-4 text-slate-400" />
                      {copy.settings}
                    </button>
                    <button
                      onClick={() => {
                        setShowProfileMenu(false);
                        setActiveTab("referral");
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                      data-testid="menu-referral-program"
                    >
                      <Share2 className="w-4 h-4 text-slate-400" />
                      {copy.referralProgram}
                    </button>
                  </div>
                  <div className="py-2 border-t border-white/10">
                    <button
                      onClick={() => {
                        setShowProfileMenu(false);
                        onLogout();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                      data-testid="menu-logout"
                    >
                      <LogOut className="w-4 h-4" />
                      {copy.logout}
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 px-3 overflow-y-auto scrollbar-hide">
        <AnimatePresence>
          {!visuallyCollapsed && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-[10px] uppercase tracking-[0.25em] text-slate-400 font-medium px-3 mb-3"
            >
              {copy.navigation}
            </motion.p>
          )}
        </AnimatePresence>

        <div className="space-y-1">
          {visibleMainNavItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                if (item.id === "home") {
                  navigate("/dashboard");
                }
                setActiveTab(item.id);
              }}
          className={`w-full relative flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group backdrop-blur-xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] ${
                collapsedRow
              } ${
                activeTab === item.id
                    ? "bg-white/[0.08] text-white"
                    : "text-slate-400 hover:text-white hover:bg-white/[0.04]"
              }`}
              data-testid={`sidebar-${item.id}`}
            >
              {/* Active indicator bar */}
              {activeTab === item.id && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-white/90 to-white/45"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                />
              )}
              
              <item.icon
                className={`w-5 h-5 flex-shrink-0 transition-colors duration-200 ${
                  item.isNsfw
                    ? "text-rose-400"
                    : item.isCreatorStudio
                      ? "text-purple-400"
                      : item.id === "home"
                        ? "text-white"
                        : item.id === "generate"
                          ? "text-yellow-400"
                          : item.id === "settings"
                            ? "text-slate-400"
                            : (activeTab === item.id ? "text-white" : "group-hover:text-white/70")
                }`}
              />
              <AnimatePresence>
                {!visuallyCollapsed && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-2 flex-1"
                  >
                    <span className="text-sm font-medium">{item.label}</span>
                    {item.premium && !canAccessPremium && (
                      <Lock className="ml-auto w-3.5 h-3.5 text-slate-500" />
                    )}
                    {item.comingSoon && (
                      <span className="ml-auto px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider rounded-full bg-gradient-to-r from-rose-500/20 to-orange-500/20 text-rose-300 border border-rose-500/30">
                        {copy.soon}
                      </span>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </button>
          ))}
        </div>

        {/* Pro Studio link - only when user has proAccess */}
        {user?.proAccess && (
          <div className="mt-2">
            <Link
              to="/pro"
              className={`w-full relative flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group backdrop-blur-xl border border-purple-500/20 hover:border-purple-500/40 hover:bg-purple-500/10 ${collapsedRow}`}
              data-testid="sidebar-pro"
            >
              <Zap className="w-5 h-5 flex-shrink-0 text-purple-400" />
              <AnimatePresence>
                {!visuallyCollapsed && (
                  <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-sm font-medium text-purple-300">
                    {copy.proStudio}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
          </div>
        )}

        {/* Divider */}
        <div className="my-5 mx-3 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />

        {/* Monetize Section */}
        <AnimatePresence>
          {!visuallyCollapsed && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-[10px] uppercase tracking-[0.25em] text-slate-400 font-medium px-3 mb-3"
            >
              {copy.monetize}
            </motion.p>
          )}
        </AnimatePresence>

        <div className="space-y-1">
          {promoItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                item.action();
              }}
              className={`w-full relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.04] font-medium transition-all duration-200 active:scale-[0.98] border border-emerald-400/30 shadow-[0_0_12px_rgba(52,211,153,0.15)] hover:shadow-[0_0_18px_rgba(52,211,153,0.25)] ${
                collapsedRow
              }`}
              data-testid={`sidebar-${item.id}`}
            >
              <item.icon className="w-5 h-5 flex-shrink-0 text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.5)]" />
              <AnimatePresence>
                {!visuallyCollapsed && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-sm"
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          ))}

          {/* Socials Section */}
          <AnimatePresence>
            {!visuallyCollapsed && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-[10px] uppercase tracking-[0.25em] text-slate-400 font-medium px-3 mt-4 mb-3"
              >
                {copy.socials}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Telegram */}
          <a
            href="https://t.me/modelclonechat"
            target="_blank"
            rel="noopener noreferrer"
            
            className={`w-full relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.04] font-medium transition-all duration-200 active:scale-[0.98] ${
              collapsedRow
            }`}
            data-testid="sidebar-contact"
          >
            <SiTelegram className="w-5 h-5 flex-shrink-0 text-[#26A5E4]" />
            <AnimatePresence>
              {!visuallyCollapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-sm"
                >
                  Telegram
                </motion.span>
              )}
            </AnimatePresence>
          </a>

          {/* Discord Community */}
          <a
            href="https://discord.gg/vpwGygjEaB"
            target="_blank"
            rel="noopener noreferrer"
            
            className={`w-full relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.04] font-medium transition-all duration-200 active:scale-[0.98] ${
              collapsedRow
            }`}
            data-testid="sidebar-discord"
          >
            <SiDiscord className="w-5 h-5 flex-shrink-0 text-[#5865F2]" />
            <AnimatePresence>
              {!visuallyCollapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-sm"
                >
                  Discord
                </motion.span>
              )}
            </AnimatePresence>
          </a>

          {/* Job Board - Coming Soon */}
          <div
            className={`w-full relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-500 font-medium cursor-not-allowed opacity-50 ${
              collapsedRow
            }`}
            data-testid="sidebar-jobs"
          >
            <Briefcase className="w-5 h-5 flex-shrink-0" />
            <AnimatePresence>
              {!visuallyCollapsed && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2"
                >
                  <span className="text-sm">{copy.jobBoard}</span>
                  <span className="px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider rounded-full bg-white/5 text-slate-400 border border-white/10">
                    {copy.soon}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Admin Link */}
        {user?.role === "admin" && (
          <>
            <div className="my-5 mx-3 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
            <button
              onClick={() => {
                onOpenAdmin();
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.04] font-medium transition-all duration-200 active:scale-[0.98] ${
                collapsedRow
              }`}
              data-testid="sidebar-admin"
            >
              <Shield className="w-5 h-5 flex-shrink-0 text-red-400" />
              <AnimatePresence>
                {!visuallyCollapsed && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-sm"
                  >
                    {copy.adminPanel}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </>
        )}
      </nav>

      {/* Bottom Section */}
      <div className="p-4 space-y-2">
        <div className={`w-full flex items-center gap-2 ${visuallyCollapsed ? "justify-center" : ""}`}>
          <button
            onClick={() => {
              const next = !sidebarPinned;
              setSidebarPinned(next);
              if (next) {
                setCollapsed(false);
                setDesktopHovered(false);
                onDesktopHoverChange?.(false);
              }
            }}
            className="h-10 w-10 rounded-xl inline-flex items-center justify-center text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] transition-all duration-200"
            title={sidebarPinned ? copy.unpinSidebar : copy.pinSidebar}
            aria-label={sidebarPinned ? copy.unpinSidebar : copy.pinSidebar}
            data-testid="sidebar-pin-toggle"
          >
            {sidebarPinned ? <PinOff className="w-5 h-5" /> : <Pin className="w-5 h-5" />}
          </button>
          <button
            onClick={() => {
              const next = sound.toggle();
              setSoundEnabled(next);
            }}
            className="h-10 w-10 rounded-xl inline-flex items-center justify-center text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] transition-all duration-200"
            title={soundEnabled ? copy.soundOn : copy.soundOff}
            aria-label={soundEnabled ? copy.soundOn : copy.soundOff}
            data-testid="sidebar-sound-toggle"
          >
            {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>
        </div>

        {/* Private Mode — persists across reloads, blurs history / input / output media */}
        <button
          onClick={() => setPrivateMode(!privateMode)}
          role="switch"
          aria-checked={privateMode}
          title={privateMode ? copy.privateModeOn : copy.privateModeOff}
          data-testid="sidebar-private-mode-toggle"
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 border ${
            visuallyCollapsed ? "justify-center px-0 gap-0 min-h-[44px]" : ""
          } ${
            privateMode
              ? "bg-violet-500/15 text-violet-100 border-violet-500/35 shadow-[0_0_18px_rgba(139,92,246,0.18)]"
              : "bg-white/[0.02] text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] border-white/[0.06]"
          }`}
        >
          {privateMode ? (
            <EyeOff className="w-5 h-5 flex-shrink-0 text-violet-300" />
          ) : (
            <Eye className="w-5 h-5 flex-shrink-0" />
          )}
          <AnimatePresence>
            {!visuallyCollapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 min-w-0 text-left"
              >
                <div className="text-sm font-semibold truncate">
                  {privateMode ? copy.privateModeOn : copy.privateModeOff}
                </div>
                <div className="text-[10px] text-slate-500 truncate leading-tight">
                  {copy.privateModeHint}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {!visuallyCollapsed && (
            <span
              className={`ml-auto relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 shrink-0 ${
                privateMode
                  ? "bg-gradient-to-r from-violet-600 to-indigo-600"
                  : "bg-white/[0.08]"
              }`}
              aria-hidden
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
                  privateMode ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </span>
          )}
        </button>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-500 hover:text-slate-300 transition-all duration-200 ${collapsedRow}`}
          style={{ background: theme === "light" ? "var(--bg-elevated)" : undefined }}
          data-testid="sidebar-theme-toggle"
        >
          {theme === "dark" ? <Sun className="w-5 h-5 flex-shrink-0" /> : <Moon className="w-5 h-5 flex-shrink-0" />}
          <AnimatePresence>
            {!visuallyCollapsed && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-sm font-medium">
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </motion.span>
            )}
          </AnimatePresence>
        </button>

        {/* Collapse Toggle */}
        <button
          onClick={() => {
            if (sidebarPinned) return;
            if (visuallyCollapsed) {
              setCollapsed(false);
            } else {
              setDesktopHovered(false);
              onDesktopHoverChange?.(false);
              setCollapsed(true);
            }
          }}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] transition-all duration-200 ${
            collapsedRow
          }`}
          disabled={sidebarPinned}
          aria-disabled={sidebarPinned}
          data-testid="sidebar-collapse"
        >
          {visuallyCollapsed ? (
            <ChevronRight className="w-5 h-5" />
          ) : (
            <>
              <ChevronLeft className="w-5 h-5" />
              <span className="text-sm font-medium">{copy.collapse}</span>
            </>
          )}
        </button>

        {/* Logout */}
        <button
          onClick={() => {
            onLogout();
          }}
          className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-all duration-200 group ${
            collapsedRow
          }`}
          data-testid="sidebar-logout"
        >
          <LogOut className="w-5 h-5 flex-shrink-0 group-hover:translate-x-0.5 transition-transform" />
          <AnimatePresence>
            {!visuallyCollapsed && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-sm font-medium"
              >
                {copy.logout}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </motion.aside>
  );
}
