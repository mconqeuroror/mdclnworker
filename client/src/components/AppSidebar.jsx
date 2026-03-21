import { useState } from "react";
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
} from "lucide-react";
import { SiTelegram, SiDiscord, SiInstagram } from "react-icons/si";
import { Link } from "react-router-dom";
import { useBranding } from "../hooks/useBranding";
import { hasPremiumAccess } from "../utils/premiumAccess";

export default function AppSidebar({
  activeTab,
  setActiveTab,
  user,
  onLogout,
  onOpenCredits,
  onOpenEarn,
  onOpenReferral,
  onOpenAdmin,
  collapsed: collapsedProp,
  setCollapsed: setCollapsedProp,
}) {
  const branding = useBranding();
  const canAccessPremium = hasPremiumAccess(user);
  const [localCollapsed, setLocalCollapsed] = useState(false);
  const collapsed = typeof collapsedProp === "boolean" ? collapsedProp : localCollapsed;
  const setCollapsed = setCollapsedProp || setLocalCollapsed;
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const collapsedRow = collapsed ? "justify-center px-0 gap-0 min-h-[44px]" : "";
  const collapsedProfileRow = collapsed ? "justify-center px-0 gap-0 min-h-[48px]" : "";

  const mainNavItems = [
    { id: "home", label: "Dashboard", icon: Home },
    { id: "models", label: "My Models", icon: Users },
    { id: "generate", label: "Generate", icon: Zap },
    { id: "reformatter", label: "Reformatter", icon: FileType2 },
    { id: "history", label: "History", icon: Clock },
    { id: "settings", label: "Settings", icon: SettingsIcon },
    { id: "course", label: "Courses", icon: BookOpen, premium: true },
    { id: "nsfw", label: "NSFW", icon: Flame, isNsfw: true },
    { id: "repurposer", label: "Photo/Video Repurposer", icon: Shuffle, premium: true },
    { id: "reelfinder", label: "Reel Finder", icon: SiInstagram, premium: true },
  ];

  const promoItems = [
    {
      id: "earn",
      label: "Earn With AI",
      icon: DollarSign,
      action: onOpenEarn,
    },
    {
      id: "share",
      label: "Refer And Earn",
      icon: Share2,
      action: onOpenReferral,
    },
  ];

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 80 : 260 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      className="fixed left-0 top-0 h-screen z-50 flex flex-col"
      style={{
        background: "linear-gradient(180deg, rgba(15,15,23,0.98) 0%, rgba(10,10,18,0.99) 50%, rgba(5,5,12,1) 100%)",
      }}
    >
      {/* Subtle right border */}
      <div className="absolute right-0 top-0 bottom-0 w-px bg-gradient-to-b from-white/[0.08] via-white/[0.04] to-transparent" />

      {/* Logo Section */}
      <div className="p-5 mb-2">
        <Link to="/dashboard" className={`flex items-center gap-3 hover:opacity-80 transition-opacity ${collapsed ? "justify-center" : ""}`}>
          <div className="relative">
            <img
              src={branding.logoUrl}
              alt={branding.appName}
              className="w-11 h-11 rounded-xl object-cover"
            />
          </div>
          <AnimatePresence>
            {!collapsed && (
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
              {!collapsed && (
                <motion.div
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -6 }}
                  className="flex items-center gap-2 flex-1 min-w-0"
                >
                  <span className="text-sm font-medium text-white truncate">
                    {user?.name || user?.email?.split("@")[0] || "Profile"}
                  </span>
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
            {showProfileMenu && !collapsed && (
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
                      Add Credits
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
                      Change Password
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
                      Settings
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
                      Referral Program
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
                      Logout
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 px-3 overflow-y-auto">
        <AnimatePresence>
          {!collapsed && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-[10px] uppercase tracking-[0.25em] text-slate-400 font-medium px-3 mb-3"
            >
              Navigation
            </motion.p>
          )}
        </AnimatePresence>

        <div className="space-y-1">
          {mainNavItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
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
                {!collapsed && (
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
                        Soon
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
                {!collapsed && (
                  <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-sm font-medium text-purple-300">
                    Pro Studio
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
          {!collapsed && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-[10px] uppercase tracking-[0.25em] text-slate-400 font-medium px-3 mb-3"
            >
              Monetize
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
                {!collapsed && (
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
            {!collapsed && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-[10px] uppercase tracking-[0.25em] text-slate-400 font-medium px-3 mt-4 mb-3"
              >
                Socials
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
              {!collapsed && (
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
              {!collapsed && (
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
              {!collapsed && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2"
                >
                  <span className="text-sm">Job Board</span>
                  <span className="px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider rounded-full bg-white/5 text-slate-400 border border-white/10">
                    Soon
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
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-sm"
                  >
                    Admin Panel
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </>
        )}
      </nav>

      {/* Bottom Section */}
      <div className="p-4 space-y-2">
        {/* Collapse Toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] transition-all duration-200 ${
            collapsedRow
          }`}
          data-testid="sidebar-collapse"
        >
          {collapsed ? (
            <ChevronRight className="w-5 h-5" />
          ) : (
            <>
              <ChevronLeft className="w-5 h-5" />
              <span className="text-sm font-medium">Collapse</span>
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
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-sm font-medium"
              >
                Logout
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </motion.aside>
  );
}
