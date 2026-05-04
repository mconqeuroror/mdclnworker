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
  Bot,
  ShieldOff,
  Workflow,
} from "lucide-react";
import { SiTelegram, SiDiscord, SiInstagram } from "react-icons/si";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useBranding } from "../hooks/useBranding";
import { useTheme } from "../hooks/useTheme.jsx";
import { usePrivateMode } from "../hooks/usePrivateMode.js";
import { hasPremiumAccess } from "../utils/premiumAccess";
import { sound } from "../utils/sounds";
import BrandMark from "./BrandMark.jsx";

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
    synthidRemover: "SynthID Remover",
    modelcloneX: "ModelClone-X",
    gptx: "GPT-X Studio",
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
    synthidRemover: "SynthID Remover",
    modelcloneX: "ModelClone-X",
    gptx: "GPT-X Studio",
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

  // Testing-only tools are auto-hidden on the live `modelclone.app` domain.
  const isTestingOnlyHost =
    typeof window !== "undefined" &&
    !/(^|\.)modelclone\.app$/i.test(window.location.hostname);

  const mainNavItems = [
    { id: "home", label: copy.dashboard, icon: Home },
    { id: "models", label: copy.myModels, icon: Users },
    { id: "generate", label: copy.generate, icon: Zap },
    { id: "creator-studio", label: copy.creatorStudio, icon: Clapperboard, isCreatorStudio: true },
    { id: "voice-studio", label: copy.voiceStudio, icon: Mic, premium: true },
    { id: "reformatter", label: copy.reformatter, icon: FileType2 },
    { id: "frame-extractor", label: copy.firstFrameExtractor, icon: ImageIcon },
    { id: "upscaler", label: copy.upscaler, icon: ZoomIn },
    { id: "synthid-remove", label: copy.synthidRemover, icon: ShieldOff },
    { id: "modelclone-x", label: copy.modelcloneX, icon: Wand2 },
    ...(isTestingOnlyHost ? [{ id: "flows", label: "AI Flows", icon: Workflow }] : []),
    ...(isTestingOnlyHost ? [{ id: "gptx", label: copy.gptx, icon: Bot }] : []),
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
      animate={{ width: visuallyCollapsed ? 72 : 244 }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      className="fixed left-0 top-0 h-screen z-50 flex flex-col max-md:pointer-events-auto md:overflow-visible"
      style={{
        background: "var(--sidebar-bg)",
        borderRight: "1px solid var(--border-subtle)",
      }}
      onPointerEnter={handleAsidePointerEnter}
      onPointerLeave={handleAsidePointerLeave}
    >
      {/* Brand row — always returns to dashboard home (same tab stack as /dashboard) */}
      <div className={`px-4 pt-5 pb-4 ${visuallyCollapsed ? "px-3" : ""}`}>
        <Link
          to="/dashboard"
          onClick={() => setActiveTab("home")}
          className={`flex items-center gap-2.5 transition-opacity hover:opacity-85 ${visuallyCollapsed ? "justify-center" : ""}`}
        >
          <BrandMark size={32} title={branding?.appName || "ModelClone"} />
          <AnimatePresence>
            {!visuallyCollapsed && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.18 }}
                className="text-[15px] font-semibold tracking-tight truncate"
                style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}
              >
                {branding.appName}
              </motion.span>
            )}
          </AnimatePresence>
        </Link>
      </div>

      {/* User Profile */}
      <div className={`px-3 pb-3 ${visuallyCollapsed ? "px-2" : ""}`}>
        <div className="relative">
          <button
            onClick={() => setShowProfileMenu(!showProfileMenu)}
            className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${collapsedProfileRow}`}
            style={{
              color: "var(--text-primary)",
              background: "transparent",
              border: "1px solid transparent",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface)"; e.currentTarget.style.borderColor = "var(--border-subtle)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }}
            data-testid="button-profile-menu"
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
            >
              <User className="w-3.5 h-3.5" style={{ color: "var(--text-secondary)" }} />
            </div>
            <AnimatePresence>
              {!visuallyCollapsed && (
                <motion.div
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -6 }}
                  className="flex items-center gap-2 flex-1 min-w-0"
                >
                  <span className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                    {user?.name || user?.email?.split("@")[0] || "Profile"}
                  </span>
                  <div
                    className="ml-auto inline-flex items-center rounded-md p-0.5"
                    style={{ border: "1px solid var(--border-subtle)", background: "var(--bg-surface)" }}
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
                          className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase transition-colors"
                          style={{
                            color: active ? "var(--accent-foreground)" : "var(--text-muted)",
                            background: active ? "var(--text-primary)" : "transparent",
                          }}
                          data-testid={`locale-switch-${code}`}
                        >
                          {code}
                        </button>
                      );
                    })}
                  </div>
                  <ChevronDown
                    className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${showProfileMenu ? "rotate-180" : ""}`}
                    style={{ color: "var(--text-muted)" }}
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
                  transition={{ duration: 0.14 }}
                  className="absolute left-0 right-0 top-full mt-1 w-full min-w-[208px] rounded-lg overflow-hidden z-50"
                  style={{
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border-medium)",
                    boxShadow: "0 10px 32px var(--shadow-ambient)",
                  }}
                >
                  <div className="px-3 py-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <p className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>{user?.email}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[11px] font-semibold inline-flex items-center gap-1 numeric" style={{ color: "var(--text-secondary)" }}>
                        {user?.credits || 0} <Coins className="w-3 h-3" style={{ color: "var(--warning)" }} />
                      </span>
                    </div>
                  </div>
                  <div className="py-1">
                    {[
                      { icon: CreditCard, label: copy.addCredits, testid: "menu-add-credits", action: () => { setShowProfileMenu(false); onOpenCredits(); } },
                      { icon: Lock, label: copy.changePassword, testid: "menu-change-password", action: () => { setShowProfileMenu(false); setActiveTab("settings"); } },
                      { icon: SettingsIcon, label: copy.settings, testid: "menu-settings", action: () => { setShowProfileMenu(false); setActiveTab("settings"); } },
                      { icon: Share2, label: copy.referralProgram, testid: "menu-referral-program", action: () => { setShowProfileMenu(false); setActiveTab("referral"); } },
                    ].map((row) => (
                      <button
                        key={row.testid}
                        onClick={row.action}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors"
                        style={{ color: "var(--text-secondary)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface)"; e.currentTarget.style.color = "var(--text-primary)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}
                        data-testid={row.testid}
                      >
                        <row.icon className="w-3.5 h-3.5" />
                        {row.label}
                      </button>
                    ))}
                  </div>
                  <div className="py-1" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                    <button
                      onClick={() => { setShowProfileMenu(false); onLogout(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors"
                      style={{ color: "var(--danger)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--danger) 10%, transparent)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      data-testid="menu-logout"
                    >
                      <LogOut className="w-3.5 h-3.5" />
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
      <nav className="flex-1 px-2 overflow-y-auto scrollbar-hide">
        <AnimatePresence>
          {!visuallyCollapsed && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="eyebrow px-3 mb-2"
            >
              {copy.navigation}
            </motion.p>
          )}
        </AnimatePresence>

        <div className="space-y-0.5">
          {visibleMainNavItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === "home") navigate("/dashboard");
                  setActiveTab(item.id);
                }}
                className={`w-full relative flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-colors duration-150 ${collapsedRow}`}
                style={{
                  color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                  background: isActive ? "var(--bg-surface)" : "transparent",
                }}
                onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.background = "var(--bg-surface)"; e.currentTarget.style.color = "var(--text-primary)"; } }}
                onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; } }}
                data-testid={`sidebar-${item.id}`}
              >
                {isActive && (
                  <motion.span
                    layoutId="activeTab"
                    className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full"
                    style={{ background: "var(--accent)" }}
                    transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}
                  />
                )}

                <item.icon
                  className="w-[18px] h-[18px] flex-shrink-0"
                  style={{ color: "currentColor", opacity: isActive ? 1 : 0.75 }}
                />
                <AnimatePresence>
                  {!visuallyCollapsed && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-2 flex-1 min-w-0"
                    >
                      <span className="text-[13px] font-medium truncate">{item.label}</span>
                      {item.premium && !canAccessPremium && (
                        <Lock className="ml-auto w-3 h-3" style={{ color: "var(--text-muted)" }} />
                      )}
                      {item.comingSoon && (
                        <span
                          className="ml-auto px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded"
                          style={{ color: "var(--text-muted)", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
                        >
                          {copy.soon}
                        </span>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </button>
            );
          })}
        </div>

        {/* Pro Studio link - only when user has proAccess */}
        {user?.proAccess && (
          <div className="mt-2">
            <Link
              to="/pro"
              className={`w-full relative flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-colors ${collapsedRow}`}
              style={{
                color: "var(--accent)",
                background: "var(--accent-soft)",
                border: "1px solid transparent",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "transparent"; }}
              data-testid="sidebar-pro"
            >
              <Zap className="w-[18px] h-[18px] flex-shrink-0" />
              <AnimatePresence>
                {!visuallyCollapsed && (
                  <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[13px] font-medium">
                    {copy.proStudio}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
          </div>
        )}

        {/* Divider */}
        <div className="my-4 mx-2 h-px" style={{ background: "var(--border-subtle)" }} />

        {/* Monetize Section */}
        <AnimatePresence>
          {!visuallyCollapsed && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="eyebrow px-3 mb-2"
            >
              {copy.monetize}
            </motion.p>
          )}
        </AnimatePresence>

        <div className="space-y-0.5">
          {promoItems.map((item) => (
            <button
              key={item.id}
              onClick={() => item.action()}
              className={`w-full relative flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-colors ${collapsedRow}`}
              style={{
                color: "var(--text-secondary)",
                background: "transparent",
                border: "1px solid transparent",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface)"; e.currentTarget.style.color = "var(--text-primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}
              data-testid={`sidebar-${item.id}`}
            >
              <item.icon className="w-[18px] h-[18px] flex-shrink-0" style={{ color: "var(--success)" }} />
              <AnimatePresence>
                {!visuallyCollapsed && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-[13px] font-medium"
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
                className="eyebrow px-3 mt-4 mb-2"
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
            className={`w-full relative flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-colors ${collapsedRow}`}
            style={{ color: "var(--text-secondary)", background: "transparent" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface)"; e.currentTarget.style.color = "var(--text-primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}
            data-testid="sidebar-contact"
          >
            <SiTelegram className="w-[18px] h-[18px] flex-shrink-0" style={{ color: "#26A5E4" }} />
            <AnimatePresence>
              {!visuallyCollapsed && (
                <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[13px] font-medium">
                  Telegram
                </motion.span>
              )}
            </AnimatePresence>
          </a>

          {/* Discord */}
          <a
            href="https://discord.gg/vpwGygjEaB"
            target="_blank"
            rel="noopener noreferrer"
            className={`w-full relative flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-colors ${collapsedRow}`}
            style={{ color: "var(--text-secondary)", background: "transparent" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface)"; e.currentTarget.style.color = "var(--text-primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}
            data-testid="sidebar-discord"
          >
            <SiDiscord className="w-[18px] h-[18px] flex-shrink-0" style={{ color: "#5865F2" }} />
            <AnimatePresence>
              {!visuallyCollapsed && (
                <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[13px] font-medium">
                  Discord
                </motion.span>
              )}
            </AnimatePresence>
          </a>

          {/* Job Board - Coming Soon */}
          <div
            className={`w-full relative flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-not-allowed ${collapsedRow}`}
            style={{ color: "var(--text-muted)", opacity: 0.7 }}
            data-testid="sidebar-jobs"
          >
            <Briefcase className="w-[18px] h-[18px] flex-shrink-0" />
            <AnimatePresence>
              {!visuallyCollapsed && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 min-w-0">
                  <span className="text-[13px] font-medium truncate">{copy.jobBoard}</span>
                  <span
                    className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded"
                    style={{ background: "var(--bg-surface)", color: "var(--text-muted)", border: "1px solid var(--border-subtle)" }}
                  >
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
            <div className="my-4 mx-2 h-px" style={{ background: "var(--border-subtle)" }} />
            <button
              onClick={() => onOpenAdmin()}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-colors ${collapsedRow}`}
              style={{ color: "var(--text-secondary)", background: "transparent" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface)"; e.currentTarget.style.color = "var(--text-primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}
              data-testid="sidebar-admin"
            >
              <Shield className="w-[18px] h-[18px] flex-shrink-0" style={{ color: "var(--danger)" }} />
              <AnimatePresence>
                {!visuallyCollapsed && (
                  <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[13px] font-medium">
                    {copy.adminPanel}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </>
        )}
      </nav>

      {/* Bottom Section */}
      <div className="p-3 space-y-1.5" style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <div className={`w-full flex items-center gap-1 ${visuallyCollapsed ? "justify-center" : ""}`}>
          <IconBtn
            onClick={() => {
              const next = !sidebarPinned;
              setSidebarPinned(next);
              if (next) {
                setCollapsed(false);
                setDesktopHovered(false);
                onDesktopHoverChange?.(false);
              }
            }}
            title={sidebarPinned ? copy.unpinSidebar : copy.pinSidebar}
            testid="sidebar-pin-toggle"
          >
            {sidebarPinned ? <PinOff className="w-[16px] h-[16px]" /> : <Pin className="w-[16px] h-[16px]" />}
          </IconBtn>
          <IconBtn
            onClick={() => {
              const next = sound.toggle();
              setSoundEnabled(next);
            }}
            title={soundEnabled ? copy.soundOn : copy.soundOff}
            testid="sidebar-sound-toggle"
          >
            {soundEnabled ? <Volume2 className="w-[16px] h-[16px]" /> : <VolumeX className="w-[16px] h-[16px]" />}
          </IconBtn>
          <IconBtn
            onClick={toggleTheme}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
            testid="sidebar-theme-toggle"
          >
            {theme === "dark" ? <Sun className="w-[16px] h-[16px]" /> : <Moon className="w-[16px] h-[16px]" />}
          </IconBtn>
          <IconBtn
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
            title={copy.collapse}
            disabled={sidebarPinned}
            testid="sidebar-collapse"
          >
            {visuallyCollapsed ? <ChevronRight className="w-[16px] h-[16px]" /> : <ChevronLeft className="w-[16px] h-[16px]" />}
          </IconBtn>
        </div>

        {/* Private Mode toggle */}
        <button
          onClick={() => setPrivateMode(!privateMode)}
          role="switch"
          aria-checked={privateMode}
          title={privateMode ? copy.privateModeOn : copy.privateModeOff}
          data-testid="sidebar-private-mode-toggle"
          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-colors ${visuallyCollapsed ? "justify-center px-0 gap-0 min-h-[40px]" : ""}`}
          style={{
            color: privateMode ? "var(--accent)" : "var(--text-secondary)",
            background: privateMode ? "var(--accent-soft)" : "transparent",
            border: "1px solid " + (privateMode ? "transparent" : "var(--border-subtle)"),
          }}
        >
          {privateMode ? <EyeOff className="w-[16px] h-[16px] flex-shrink-0" /> : <Eye className="w-[16px] h-[16px] flex-shrink-0" />}
          <AnimatePresence>
            {!visuallyCollapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 min-w-0 text-left"
              >
                <div className="text-[12px] font-semibold truncate">
                  {privateMode ? copy.privateModeOn : copy.privateModeOff}
                </div>
                <div className="text-[10px] truncate leading-tight" style={{ color: "var(--text-muted)" }}>
                  {copy.privateModeHint}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {!visuallyCollapsed && (
            <span
              className="ml-auto relative inline-flex h-[18px] w-[32px] items-center rounded-full transition-colors shrink-0"
              style={{ background: privateMode ? "var(--accent)" : "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
              aria-hidden
            >
              <span
                className="inline-block h-3 w-3 rounded-full transition-transform"
                style={{
                  background: privateMode ? "var(--accent-foreground)" : "var(--text-secondary)",
                  transform: privateMode ? "translateX(15px)" : "translateX(2px)",
                }}
              />
            </span>
          )}
        </button>

        {/* Logout */}
        <button
          onClick={() => onLogout()}
          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-colors ${collapsedRow}`}
          style={{ color: "var(--text-secondary)", background: "transparent" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--danger) 10%, transparent)"; e.currentTarget.style.color = "var(--danger)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}
          data-testid="sidebar-logout"
        >
          <LogOut className="w-[16px] h-[16px] flex-shrink-0" />
          <AnimatePresence>
            {!visuallyCollapsed && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-[13px] font-medium"
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

function IconBtn({ children, onClick, title, testid, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-8 w-8 rounded-md inline-flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ color: "var(--text-muted)", background: "transparent", border: "1px solid transparent" }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = "var(--bg-surface)"; e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.borderColor = "var(--border-subtle)"; } }}
      onMouseLeave={(e) => { if (!disabled) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "transparent"; } }}
      title={title}
      aria-label={title}
      data-testid={testid}
    >
      {children}
    </button>
  );
}
