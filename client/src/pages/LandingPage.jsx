import { motion, AnimatePresence } from 'framer-motion';
import { Link, useLocation } from 'react-router-dom';
import {
  Shield,
  ArrowRight, Check, Star, Clock,
  DollarSign, Crown, Camera,
  BarChart, UserCheck, RefreshCw, Menu, X, ChevronDown,
  Briefcase, TrendingUp, GraduationCap, Repeat, BookOpen
} from 'lucide-react';
import { SiTrustpilot } from 'react-icons/si';
import { useState, useEffect, useRef, useCallback } from 'react';
import OptimizedGalleryImage from '../components/OptimizedGalleryImage';
import CursorGlow from '../components/CursorGlow';

const LOCALE_STORAGE_KEY = 'app_locale';
function resolveLocale() {
  try {
    const qsLang = new URLSearchParams(window.location.search).get('lang');
    const normalizedQs = String(qsLang || '').toLowerCase();
    if (normalizedQs === 'ru' || normalizedQs === 'en') {
      localStorage.setItem(LOCALE_STORAGE_KEY, normalizedQs);
      return normalizedQs;
    }
    const saved = String(localStorage.getItem(LOCALE_STORAGE_KEY) || '').toLowerCase();
    if (saved === 'ru' || saved === 'en') return saved;
    const browser = String(navigator.language || '').toLowerCase();
    return browser.startsWith('ru') ? 'ru' : 'en';
  } catch {
    return 'en';
  }
}

// ── Live activity data ────────────────────────────────────────────────────────
const ACTIVITY_CREATOR = [
  { avatar: 'SL', name: 'Sofia L.',          action: 'generated 47 posts in one session',   location: 'Miami, FL',   time: '2m ago' },
  { avatar: 'JM', name: 'Jake M.',            action: 'saved 28 filming hours this week',    location: 'London, UK',  time: '4m ago' },
  { avatar: 'AK', name: 'Aria K.',            action: 'just hit 250K followers',             location: 'LA, CA',      time: '6m ago' },
  { avatar: 'MD', name: 'Marcus D.',          action: 'just signed up for free',             location: 'Toronto, CA', time: '1m ago' },
  { avatar: 'PS', name: 'Priya S.',           action: 'published 30 reels in under an hour', location: 'Dubai, UAE',  time: '5m ago' },
  { avatar: 'JR', name: 'Jennifer R.',        action: 'tripled her posting frequency',       location: 'Sydney, AU',  time: '9m ago' },
  { avatar: 'RK', name: 'Riley K.',           action: 'grew 120K followers in 3 months',     location: 'Austin, TX',  time: '11m ago'},
  { avatar: 'CW', name: 'Chloe W.',           action: 'created a full week of content today', location: 'Paris, FR',  time: '7m ago' },
];
const ACTIVITY_AGENCY = [
  { avatar: 'ME', name: 'Miami Elite Agency', action: 'onboarded 3 new AI creators',         location: 'Miami, FL',  time: '3m ago' },
  { avatar: 'PT', name: 'Premium Talent Co.', action: 'scaled to 22 creators this month',    location: 'NYC, NY',    time: '6m ago' },
  { avatar: 'DW', name: 'Digital Wave',       action: 'cut production costs by 70%',         location: 'Chicago, IL',time: '8m ago' },
  { avatar: 'EC', name: 'Elite Creators Grp', action: 'processed 500+ posts last week',      location: 'LA, CA',     time: '2m ago' },
  { avatar: 'NS', name: 'NovaStar Agency',    action: 'just signed up for agency plan',      location: 'London, UK', time: '1m ago' },
  { avatar: 'VT', name: 'Vibe Talent Mgmt',  action: 'grew client revenue by 3× this month',location: 'Toronto, CA',time: '5m ago' },
];

// ── Live Activity Toast ───────────────────────────────────────────────────────
function LiveActivityToast({ isCreator }) {
  const list = isCreator ? ACTIVITY_CREATOR : ACTIVITY_AGENCY;
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const show = setTimeout(() => setVisible(true), 4000);
    return () => clearTimeout(show);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % list.length);
        setVisible(true);
      }, 500);
    }, 5000);
    return () => clearInterval(timer);
  }, [visible, list.length]);

  const item = list[idx];

  return (
    <AnimatePresence mode="wait">
      {visible && (
        <motion.div
          key={idx}
          initial={{ opacity: 0, x: -24, y: 8 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, x: -16, y: 4 }}
          transition={{ type: 'spring', stiffness: 280, damping: 26 }}
          className="fixed bottom-6 left-4 z-40 hidden md:flex items-center gap-3 px-4 py-3 rounded-2xl max-w-[280px]"
          style={{
            background: 'rgba(12,10,18,0.88)',
            border: '1px solid rgba(255,255,255,0.09)',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)',
          }}
        >
          <div className="relative flex-shrink-0">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold text-white/80"
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}>
              {item.avatar}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-black" />
          </div>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-white leading-tight truncate">{item.name}</p>
            <p className="text-[11px] text-white/45 leading-snug">{item.action}</p>
            <p className="text-[10px] text-white/25 mt-0.5">{item.location} · {item.time}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Count-up hook ─────────────────────────────────────────────────────────────
function useCountUp(target, duration = 1600) {
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !started) setStarted(true); },
      { threshold: 0.4 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    const startTime = Date.now();
    const tick = () => {
      const progress = Math.min((Date.now() - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * target));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [started, target, duration]);

  return { count, ref };
}

// ── Animated stat card ────────────────────────────────────────────────────────
function AnimatedStat({ stat }) {
  // Parse value like "500K+", "10K+", "2,500+", "$2.5M+", "85%", "150+"
  const raw = stat.value;
  let prefix = '', suffix = '', target = 0, formatted = raw;
  const m = raw.match(/^(\$?)(\d[\d,.]*)([KMB%+×]*)(\+?)$/);
  if (m) {
    prefix  = m[1];
    const num = parseFloat(m[2].replace(/,/g, ''));
    const mult = m[3].includes('K') ? 1000 : m[3].includes('M') ? 1000000 : 1;
    target  = Math.round(num * mult);
    suffix  = m[3].replace('K','').replace('M','').replace('B','') + m[4];
    const displayMult = m[3].includes('M') ? 1000000 : m[3].includes('K') ? 1000 : 1;
    const _ = displayMult; // used below
    formatted = null; // will be computed
  }

  const { count, ref } = useCountUp(target);

  const display = useCallback((n) => {
    if (raw.includes('M')) return `${prefix}${(n / 1000000).toFixed(1)}M${suffix}`;
    if (raw.includes('K') && n >= 1000) return `${prefix}${Math.round(n / 1000)}K${suffix}`;
    if (raw.includes(',')) return `${prefix}${n.toLocaleString()}${suffix}`;
    return `${prefix}${n}${suffix}`;
  }, [raw, prefix, suffix]);

  return (
    <div ref={ref} className="rounded-xl p-4 border border-white/[0.07] text-left" style={{ background: 'rgba(255,255,255,0.03)' }}>
      <div className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
        {formatted === null ? display(count) : raw}
      </div>
      <div className="text-[11px] text-slate-500 mt-1 uppercase tracking-wider">{stat.label}</div>
    </div>
  );
}

const ashleyRooftop      = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/ashleyRooftop.jpg';
const ashleyBeachSunset  = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/ashleyBeachSunset.jpg';
const ashleyCafe         = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/ashleyCafe.jpg';
const ashleyBeachWalk    = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/ashleyBeachWalk.jpg';
const ashleyPinkHair     = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/ashleyPinkHair.jpg';
const ashleyCity         = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/ashleyCity.jpg';
const ashleyBeachBikini  = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/ashleyBeachBikini.jpg';
const ashleyGlamDress    = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/ashleyGlamDress.jpg';
const ashleyFitness      = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/ashleyFitness.jpg';

const lauraBeach1   = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/lauraBeach1.jpg';
const lauraBeach2   = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/lauraBeach2.jpg';
const lauraBed      = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/lauraBed.jpg';
const lauraPool     = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/lauraPool.jpg';
const lauraBeach3   = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/lauraBeach3.jpg';
const lauraLibrary  = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/lauraLibrary.jpg';
const lauraBedNight = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/lauraBedNight.jpg';
const lauraCafe     = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/lauraCafe.jpg';
const lauraHome     = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/lauraHome.jpg';

const natashaPark   = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/natashaPark.jpg';
const natashaCar1   = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/natashaCar1.jpg';
const natashaYoga1  = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/natashaYoga1.jpg';
const natashaYoga2  = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/natashaYoga2.jpg';
const natashaStreet = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/natashaStreet.jpg';
const natashaCar2   = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/natashaCar2.jpg';
const natashaYoga3  = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/natashaYoga3.jpg';
const natashaYoga4  = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/natashaYoga4.jpg';
const natashaMirror = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/natashaMirror.jpg';

const ashleyImages  = [
  { src: ashleyRooftop, alt: 'Ashley at rooftop lounge' },
  { src: ashleyBeachSunset, alt: 'Ashley at the beach sunset' },
  { src: ashleyCafe, alt: 'Ashley at cafe' },
  { src: ashleyBeachWalk, alt: 'Ashley walking on beach' },
  { src: ashleyPinkHair, alt: 'Ashley pink hair' },
  { src: ashleyCity, alt: 'Ashley in the city' },
  { src: ashleyBeachBikini, alt: 'Ashley beach bikini' },
  { src: ashleyGlamDress, alt: 'Ashley glamorous dress' },
  { src: ashleyFitness, alt: 'Ashley fitness' },
];
const lauraImages   = [
  { src: lauraBeach1, alt: 'Laura at beach' },
  { src: lauraBeach2, alt: 'Laura beach sunset' },
  { src: lauraBed, alt: 'Laura selfie' },
  { src: lauraPool, alt: 'Laura poolside' },
  { src: lauraBeach3, alt: 'Laura beach smile' },
  { src: lauraLibrary, alt: 'Laura reading' },
  { src: lauraBedNight, alt: 'Laura evening' },
  { src: lauraCafe, alt: 'Laura cafe selfie' },
  { src: lauraHome, alt: 'Laura at home' },
];
const natashaImages = [
  { src: natashaPark, alt: 'Natasha in the park' },
  { src: natashaCar1, alt: 'Natasha car selfie' },
  { src: natashaYoga1, alt: 'Natasha yoga class' },
  { src: natashaYoga2, alt: 'Natasha yoga pose' },
  { src: natashaStreet, alt: 'Natasha street style' },
  { src: natashaCar2, alt: 'Natasha driving' },
  { src: natashaYoga3, alt: 'Natasha fitness' },
  { src: natashaYoga4, alt: 'Natasha workout' },
  { src: natashaMirror, alt: 'Natasha mirror selfie' },
];

// ── Hero primary CTA — breathing pulse + hover text swap ──────────────────────
function HeroCTA() {
  const [hovered, setHovered] = useState(false);
  return (
    <motion.div
      animate={{ scale: hovered ? 1 : [1, 1.018, 1] }}
      transition={hovered ? { duration: 0.15 } : { duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
    >
      <Link
        to="/signup"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="relative px-7 py-3.5 rounded-2xl font-semibold text-black bg-white hover:bg-slate-100 transition-colors inline-flex items-center gap-2.5 overflow-hidden"
        style={{ boxShadow: '0 0 32px 6px rgba(139,92,246,0.35), inset 0 1px 0 rgba(255,255,255,0.8)' }}
        data-testid="button-hero-signup"
      >
        <span className="pointer-events-none absolute top-0 left-0 w-20 h-20 rounded-full bg-purple-400/30 blur-xl -translate-x-6 -translate-y-6" />
        <AnimatePresence mode="wait">
          <motion.span
            key={hovered ? 'hover' : 'default'}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="relative z-10 whitespace-nowrap"
          >
            {hovered ? 'Claim My 250 Free Credits' : 'Get Started — It\'s Free'}
          </motion.span>
        </AnimatePresence>
        <ArrowRight className="w-4 h-4 relative z-10 flex-shrink-0" />
      </Link>
    </motion.div>
  );
}

// ── Live joined signal below CTA ──────────────────────────────────────────────
// Stable daily seed — deterministic per calendar day, no Math.random drift
function dailySeed() {
  const d = new Date();
  // Integer like 20260302 — different every day, stable within the day
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
function seededInt(seed, min, max) {
  // Park-Miller LCG — predictable, stays in range
  const h = ((seed * 1664525 + 1013904223) & 0x7fffffff);
  return min + (h % (max - min + 1));
}

// Per-day rotating label — no multipliers, raw n is always the displayed number
// dow: 0=Sun … 6=Sat
const DAY_LABEL = {
  creator: [
    'creators joined today',
    'creators signed up today',
    'new creators this week',
    'creators joined today',
    'creators active today',
    'creators joined this week',
    'creators signed up today',
  ],
  agency: [
    'agencies joined today',
    'agencies signed up today',
    'new agencies this week',
    'agencies joined today',
    'agencies active today',
    'agencies joined this week',
    'agencies signed up today',
  ],
};

// Realistic ranges — weekdays 15-35 creators / 4-9 agencies, weekends half that
//                    [Sun, Mon, Tue, Wed, Thu, Fri, Sat]
const CREATOR_RANGE = [[8,14],[22,31],[20,28],[19,27],[21,30],[27,36],[11,17]];
const AGENCY_RANGE  = [[2, 4], [5, 8], [4, 7], [4, 7], [5, 8], [6, 9], [2, 4]];

function LiveJoinedSignal({ isCreator }) {
  const dow = new Date().getDay();
  const seed = dailySeed();
  const [lo, hi] = isCreator ? CREATOR_RANGE[dow] : AGENCY_RANGE[dow];
  const base = seededInt(seed, lo, hi);

  const [count, setCount] = useState(base);

  // Ticks up very slowly — roughly +1 every 4–8 minutes
  useEffect(() => {
    const t = setInterval(() => {
      if (Math.random() < 0.2) setCount((c) => c + 1);
    }, 25000);
    return () => clearInterval(t);
  }, []);

  const label = DAY_LABEL[isCreator ? 'creator' : 'agency'][dow];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 1.2 }}
      className="flex items-center justify-center gap-2 mt-4"
    >
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
      <span className="text-xs text-white/35">
        <span className="text-white/55 font-semibold">{count}</span>{' '}{label}
      </span>
    </motion.div>
  );
}

// ── Loss aversion section ─────────────────────────────────────────────────────
function LossAversionSection({ isCreator }) {
  const ref = useRef(null);
  const [seconds, setSeconds] = useState(0);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setActive(true); else setActive(false); },
      { threshold: 0.3 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [active]);

  const hoursPerWeek = isCreator ? 25 : 40;
  const revenuePerHour = isCreator ? 12 : 28;
  const minutesLost = Math.floor(seconds / 60);
  const secondsDisplay = seconds % 60;

  return (
    <motion.section
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="py-12 px-4 sm:px-6"
    >
      <div className="max-w-3xl mx-auto">
        <div
          className="relative rounded-2xl p-6 sm:p-8 overflow-hidden border border-white/[0.07]"
          style={{ background: 'rgba(255,255,255,0.02)' }}
        >
          <div className="pointer-events-none absolute top-0 left-0 right-0 h-px"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08) 50%, transparent)' }} />

          <div className="text-center mb-6">
            <p className="text-[11px] font-medium uppercase tracking-widest text-white/25 mb-3">The cost of waiting</p>
            <h3 className="text-2xl sm:text-3xl font-bold text-white">
              Since you opened this page
            </h3>
          </div>

          <div className="grid sm:grid-cols-3 gap-3 mb-6">
            {[
              {
                value: `${minutesLost}:${String(secondsDisplay).padStart(2,'0')}`,
                label: 'min of filming time lost',
                sub: "you'll never get back",
              },
              {
                value: `${Math.floor(seconds * (hoursPerWeek / (7 * 24 * 3600)) * revenuePerHour * 100) / 100 < 0.01 ? '<$0.01' : `$${(seconds * (hoursPerWeek / (7 * 24 * 3600)) * revenuePerHour).toFixed(2)}`}`,
                label: 'in potential earnings',
                sub: `at ${hoursPerWeek}h/week on content`,
              },
              {
                value: `${Math.floor(seconds / (7 * 24 * 3600 / (isCreator ? 10 : 50)) * 10) / 10 || 0}`,
                label: 'posts your competitors made',
                sub: 'while you were reading this',
              },
            ].map((item, i) => (
              <div key={i} className="text-center rounded-xl p-4 border border-white/[0.06]"
                style={{ background: 'rgba(255,255,255,0.02)' }}>
                <div className="text-2xl sm:text-3xl font-bold text-white tabular-nums tracking-tight">{item.value}</div>
                <div className="text-xs text-white/45 mt-1">{item.label}</div>
                <div className="text-[10px] text-white/20 mt-0.5">{item.sub}</div>
              </div>
            ))}
          </div>

          <div className="text-center">
            <Link
              to="/signup"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-black bg-white hover:bg-slate-100 transition-all text-sm"
              style={{ boxShadow: '0 0 24px 4px rgba(139,92,246,0.25)' }}
            >
              Stop losing time — Start free
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

function SectionBadge({ children }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium tracking-widest uppercase text-slate-500 border border-white/[0.07] mb-4">
      {children}
    </span>
  );
}

function GlowDot({ className = '' }) {
  return (
    <span className={`pointer-events-none absolute rounded-full blur-3xl opacity-30 ${className}`} />
  );
}

// ── Scroll progress bar ───────────────────────────────────────────────────────
function ScrollProgress() {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const update = () => {
      const el = document.documentElement;
      const scrolled = el.scrollTop || document.body.scrollTop;
      const total = el.scrollHeight - el.clientHeight;
      setPct(total > 0 ? (scrolled / total) * 100 : 0);
    };
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  return (
    <div className="fixed top-0 left-0 right-0 h-[2px] z-[60] pointer-events-none">
      <div
        className="h-full transition-all duration-75"
        style={{
          width: `${pct}%`,
          background: 'linear-gradient(90deg, rgba(139,92,246,0.6) 0%, rgba(255,255,255,0.4) 100%)',
        }}
      />
    </div>
  );
}

export default function LandingPage() {
  const location = useLocation();
  const [locale] = useState(resolveLocale);
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [userType, setUserType] = useState('creator');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(location.search);

    // Capture referral code from ?ref= on any landing page visit and persist it
    const refCode = params.get('ref');
    if (refCode) {
      localStorage.setItem('pendingReferralCode', refCode.trim().toLowerCase());
    }

    const typeFromUrl = params.get('type');
    const typeFromStorage = localStorage.getItem('userType');
    const finalType = typeFromUrl || typeFromStorage || 'creator';
    setUserType(finalType);
    if (typeFromUrl) localStorage.setItem('userType', typeFromUrl);
  }, [location.search]);

  const isCreator = userType === 'creator';

  const content = {
    creator: {
      stats: [
        { value: '500K+', label: 'Posts Created' },
        { value: '10K+', label: 'Video Ads Generated' },
        { value: '2,500+', label: 'Active Creators' },
        { value: '$2.5M+', label: 'Revenue Generated' },
      ],
      hero: {
        badge: 'Trusted by 2,500+ Content Creators & Influencers',
        headline1: 'Stop Filming.',
        headline2: 'Start Posting.',
        description: 'You spend 4+ hours daily doing makeup, setting up cameras, and filming the same content. Your audience wants MORE — but you\'re already burned out.',
        subheading: 'Create unlimited content for Instagram, TikTok, YouTube without filming. Upload 3 photos once.',
        pain: '❌ Hours of makeup & filming → ✅ 30 minutes to create a week of content',
      },
      benefits: [
        { icon: Camera, title: 'No More Filming Burnout', description: 'Stop spending 20-30 hours/week filming. Create a month of Instagram Reels, TikToks, and YouTube Shorts in one afternoon.' },
        { icon: DollarSign, title: 'Grow Your Audience 3-5× Faster', description: 'Post 10× more content = 10× more engagement. More consistent posting = better algorithm performance.' },
        { icon: Shield, title: 'Keep Your Privacy', description: 'Create content without showing your home, surroundings, or location. No more strangers recognizing your bedroom.' },
        { icon: Clock, title: 'Save 25+ Hours Per Week', description: 'No makeup. No lighting setup. No camera angles. Just upload a video template, click generate, and post.' },
      ],
      testimonials: [
        { name: 'Sophia L.', role: 'Fitness Influencer', earnings: '250K followers', avatar: 'SL', content: 'Went from posting 3×/week to daily content. Gained 150K followers in 90 days. My engagement rate tripled.', rating: 5 },
        { name: 'Jessica M.', role: 'Beauty Creator', earnings: '180K followers', avatar: 'JM', content: 'I was burned out filming 3-4 hours daily. Now I create weeks of Reels and TikToks in one afternoon.', rating: 5 },
        { name: 'Riley K.', role: 'Lifestyle Influencer', earnings: '420K followers', avatar: 'RK', content: 'The time savings alone is worth it. But growing 4× faster while working less? This changed everything.', rating: 5 },
      ],
      faqs: [
        { q: 'How realistic are the results?', a: 'Our AI achieves 99%+ accuracy. Results are indistinguishable from real footage. Thousands of creators use this daily and followers never notice.' },
        { q: 'Can I really stop filming completely?', a: 'Most creators do 70-80% AI-generated content and 20-30% real filming for authenticity. This balance keeps your feed authentic while maximising growth.' },
        { q: 'How fast can I create content?', a: 'Videos: 2-5 minutes. Images: 30-60 seconds. You can create 20-30 posts per hour. Most creators batch a full week of content in one session.' },
        { q: 'Is this legal for commercial use?', a: 'YES — 100% legal when using YOUR OWN face. You own all generated content with full commercial rights for social media, advertising, and marketing.' },
        { q: "Will this work if I'm not tech-savvy?", a: 'Yes! Upload 3 photos once, then just drag & drop videos you want your face on. If you can post to Instagram, you can use ModelClone.' },
        { q: 'How do I ensure my data stays private?', a: 'Your photos are encrypted with bank-level security. We never share, sell, or use your data for anything except YOUR content.' },
      ],
    },
    agency: {
      stats: [
        { value: '150+', label: 'Agencies Using Us' },
        { value: '1,200+', label: 'Creators Managed' },
        { value: '$8M+', label: 'Client Revenue' },
        { value: '85%', label: 'Cost Reduction' },
      ],
      hero: {
        badge: 'Trusted by 150+ Talent & Influencer Management Agencies',
        headline1: 'Stop Depending',
        headline2: 'On Unreliable Creators.',
        description: "Your creators cancel shoots. Show up late. Get lazy after gaining followers. Every agency knows: you can't scale when you're dependent on creator availability.",
        subheading: 'Generate content for 10+ creators from one office. No filming. No creator drama. Just results.',
        pain: '❌ Creator-dependent results → ✅ Predictable, scalable content production',
      },
      benefits: [
        { icon: BarChart, title: 'Scale Without Hiring', description: 'Manage 10+ creators with the same team size. Reduce operating costs by 60% while increasing output 10×.' },
        { icon: UserCheck, title: 'Never Depend on Creators Again', description: "Creator sick? Lazy? Quit? Doesn't matter. Generate their content anyway. Your growth never stops." },
        { icon: RefreshCw, title: 'Increase Growth Per Creator 3×', description: 'Post 10× more content per creator = 10× more engagement. Average follower growth jumps from 5K to 50K monthly.' },
        { icon: Briefcase, title: 'Enterprise-Grade Tools', description: 'Bulk processing, multi-creator dashboard, API access, white-label options. Built for agencies at scale.' },
      ],
      testimonials: [
        { name: 'Miami Elite Agency', role: 'Talent Management', models: '23 creators', avatar: 'ME', content: "We manage 23 creators and ModelClone 10×'d our content output. Follower growth per creator increased 285%.", rating: 5 },
        { name: 'Premium Talent Co', role: 'Agency Owner', models: '17 creators', avatar: 'PM', content: 'Before: dependent on creator mood. After: consistent content regardless of creator participation.', rating: 5 },
        { name: 'Elite Creators Group', role: 'Multi-Creator Agency', models: '31 creators', avatar: 'EC', content: "Same team, 5× the output, 3× the growth. ModelClone solved our biggest scaling problem.", rating: 5 },
      ],
      faqs: [
        { q: 'How many creators can we manage?', a: 'Enterprise plans support 10+ creators. Most agencies manage 15-30 creators efficiently with our Business plan.' },
        { q: 'What if a creator leaves our agency?', a: 'Delete their face model instantly. All data permanently erased within 24 hours. Add new creators anytime.' },
        { q: 'Can we white-label this?', a: 'Yes! Enterprise plans include white-label options, custom branding, and dedicated infrastructure.' },
        { q: 'How does bulk processing work?', a: 'Upload 50+ videos at once, select creators, process everything overnight. Wake up to hundreds of posts ready to publish.' },
        { q: 'Do creators need to know we\'re using AI?', a: "No. This is your business tool. Most agencies use AI for 60-80% of content. You control what's created." },
        { q: 'What kind of support do agencies get?', a: 'Dedicated account manager, 24/7 priority support, onboarding training, and direct Slack channel for urgent issues.' },
      ],
    },
  };

  const contentRu = {
    creator: {
      stats: [
        { value: '500K+', label: 'Создано постов' },
        { value: '10K+', label: 'Сгенерировано видеорекламы' },
        { value: '2,500+', label: 'Активных авторов' },
        { value: '$2.5M+', label: 'Сгенерировано дохода' },
      ],
      hero: {
        badge: 'Доверяют 2 500+ авторов контента и инфлюенсеров',
        headline1: 'Хватит снимать.',
        headline2: 'Начните публиковать.',
        description:
          'Вы тратите 4+ часа в день на макияж, настройку камеры и съёмку одного и того же контента. Ваша аудитория хочет БОЛЬШЕГО — но вы уже на грани выгорания.',
        subheading:
          'Создавайте безлимитный контент для Instagram, TikTok и YouTube без съёмок. Загрузите 3 фото один раз.',
        pain: '❌ Часы макияжа и съёмок → ✅ 30 минут на целую неделю контента',
      },
      benefits: [
        {
          icon: Camera,
          title: 'Никакого выгорания от съёмок',
          description:
            'Перестаньте тратить 20–30 часов в неделю на съёмки. Создайте месяц Instagram Reels, TikTok и YouTube Shorts за один вечер.',
        },
        {
          icon: DollarSign,
          title: 'Растите аудиторию в 3–5 раз быстрее',
          description:
            'Публикуйте в 10 раз больше контента = в 10 раз больше вовлечённости. Стабильные публикации = лучшая работа алгоритмов.',
        },
        {
          icon: Shield,
          title: 'Сохраняйте приватность',
          description:
            'Создавайте контент, не показывая свой дом, окружение или местоположение. Никаких незнакомцев, узнающих вашу спальню.',
        },
        {
          icon: Clock,
          title: 'Экономьте 25+ часов в неделю',
          description:
            'Никакого макияжа. Никакой настройки освещения. Никаких ракурсов. Просто загрузите видеошаблон, нажмите «Создать» и публикуйте.',
        },
      ],
      testimonials: [
        {
          name: 'Sophia L.',
          role: 'Фитнес-инфлюенсер',
          earnings: '250K followers',
          avatar: 'SL',
          content:
            'Перешла с 3 постов в неделю на ежедневный контент. Набрала 150 тыс. подписчиков за 90 дней. Вовлечённость утроилась.',
          rating: 5,
        },
        {
          name: 'Jessica M.',
          role: 'Бьюти-блогер',
          earnings: '180K followers',
          avatar: 'JM',
          content:
            'Я выгорела, снимая по 3–4 часа каждый день. Теперь создаю недели Reels и TikTok за один вечер.',
          rating: 5,
        },
        {
          name: 'Riley K.',
          role: 'Лайфстайл-инфлюенсер',
          earnings: '420K followers',
          avatar: 'RK',
          content:
            'Экономия времени сама по себе того стоит. Но расти в 4 раза быстрее, работая меньше? Это изменило всё.',
          rating: 5,
        },
      ],
      faqs: [
        {
          q: 'Насколько реалистичны результаты?',
          a: 'Наш ИИ достигает точности 99%+. Результаты неотличимы от настоящих видео. Тысячи авторов используют это ежедневно — подписчики ничего не замечают.',
        },
        {
          q: 'Могу ли я полностью перестать снимать?',
          a: 'Большинство авторов используют 70–80% ИИ-контента и 20–30% реальных съёмок для аутентичности. Этот баланс сохраняет искренность ленты и максимизирует рост.',
        },
        {
          q: 'Как быстро можно создавать контент?',
          a: 'Видео: 2–5 минут. Изображения: 30–60 секунд. Можно создавать 20–30 постов в час. Большинство авторов собирают целую неделю контента за одну сессию.',
        },
        {
          q: 'Это законно для коммерческого использования?',
          a: 'ДА — на 100% законно при использовании ВАШЕГО СОБСТВЕННОГО лица. Вы владеете всем созданным контентом с полными коммерческими правами для соцсетей, рекламы и маркетинга.',
        },
        {
          q: 'Подойдёт ли это, если я не разбираюсь в технологиях?',
          a: 'Да! Загрузите 3 фото один раз, затем просто перетаскивайте видео, на которые хотите наложить своё лицо. Если вы умеете постить в Instagram — значит, справитесь с ModelClone.',
        },
        {
          q: 'Как обеспечить конфиденциальность моих данных?',
          a: 'Ваши фотографии зашифрованы с банковским уровнем защиты. Мы никогда не передаём, не продаём и не используем ваши данные ни для чего, кроме создания ВАШЕГО контента.',
        },
      ],
    },
    agency: {
      stats: [
        { value: '150+', label: 'Агентств используют нас' },
        { value: '1,200+', label: 'Авторов под управлением' },
        { value: '$8M+', label: 'Доход клиентов' },
        { value: '85%', label: 'Снижение затрат' },
      ],
      hero: {
        badge: 'Доверяют 150+ агентств по управлению талантами и инфлюенсерами',
        headline1: 'Перестаньте зависеть',
        headline2: 'От ненадёжных авторов.',
        description:
          'Ваши авторы отменяют съёмки. Опаздывают. Ленятся после набора подписчиков. Каждое агентство знает: масштабироваться невозможно, когда зависишь от доступности авторов.',
        subheading:
          'Создавайте контент для 10+ авторов из одного офиса. Без съёмок. Без проблем с авторами. Только результаты.',
        pain: '❌ Зависимость от авторов → ✅ Предсказуемое, масштабируемое производство контента',
      },
      benefits: [
        {
          icon: BarChart,
          title: 'Масштабируйтесь без найма',
          description:
            'Управляйте 10+ авторами с той же командой. Сократите операционные расходы на 60%, увеличив производительность в 10 раз.',
        },
        {
          icon: UserCheck,
          title: 'Больше никакой зависимости от авторов',
          description:
            'Автор заболел? Ленится? Ушёл? Не важно. Создавайте их контент в любом случае. Ваш рост не останавливается никогда.',
        },
        {
          icon: RefreshCw,
          title: 'Увеличьте рост каждого автора в 3×',
          description:
            'Публикуйте в 10 раз больше контента на автора = в 10 раз больше вовлечённости. Средний прирост подписчиков вырастает с 5 тыс. до 50 тыс. в месяц.',
        },
        {
          icon: Briefcase,
          title: 'Инструменты корпоративного уровня',
          description:
            'Пакетная обработка, мультиавторская панель управления, доступ к API, возможность белой метки. Создано для агентств любого масштаба.',
        },
      ],
      testimonials: [
        {
          name: 'Miami Elite Agency',
          role: 'Управление талантами',
          models: '23 creators',
          avatar: 'ME',
          content:
            'Мы управляем 23 авторами, и ModelClone увеличил наш выпуск контента в 10 раз. Прирост подписчиков на автора вырос на 285%.',
          rating: 5,
        },
        {
          name: 'Premium Talent Co',
          role: 'Владелец агентства',
          models: '17 creators',
          avatar: 'PM',
          content:
            'До: зависели от настроения авторов. После: стабильный контент вне зависимости от участия авторов.',
          rating: 5,
        },
        {
          name: 'Elite Creators Group',
          role: 'Мультиавторское агентство',
          models: '31 creators',
          avatar: 'EC',
          content:
            'Та же команда, выпуск в 5 раз больше, рост в 3 раза выше. ModelClone решил нашу главную проблему масштабирования.',
          rating: 5,
        },
      ],
      faqs: [
        {
          q: 'Сколькими авторами мы можем управлять?',
          a: 'Корпоративные планы поддерживают 10+ авторов. Большинство агентств эффективно управляют 15–30 авторами на нашем бизнес-плане.',
        },
        {
          q: 'Что если автор покинет наше агентство?',
          a: 'Удалите их модель лица мгновенно. Все данные безвозвратно стираются в течение 24 часов. Новые авторы добавляются в любое время.',
        },
        {
          q: 'Можем ли мы использовать белую метку?',
          a: 'Да! Корпоративные планы включают возможность белой метки, собственный брендинг и выделенную инфраструктуру.',
        },
        {
          q: 'Как работает пакетная обработка?',
          a: 'Загрузите 50+ видео за раз, выберите авторов и обрабатывайте всё в ночное время. Просыпайтесь с сотнями постов, готовых к публикации.',
        },
        {
          q: 'Нужно ли авторам знать, что мы используем ИИ?',
          a: 'Нет. Это ваш бизнес-инструмент. Большинство агентств используют ИИ для 60–80% контента. Вы контролируете всё, что создаётся.',
        },
        {
          q: 'Какую поддержку получают агентства?',
          a: 'Выделенный менеджер по работе с клиентами, приоритетная поддержка 24/7, обучение при подключении и прямой Slack-канал для срочных вопросов.',
        },
      ],
    },
  };

  const activeContent = (locale === 'ru' ? contentRu : content)[userType];

  const howItWorks = [
    {
      step: '01',
      title: isCreator
        ? (locale === 'ru' ? 'Загрузите 3 фото лица' : 'Upload 3 Face Photos')
        : (locale === 'ru' ? 'Загрузите фото авторов' : 'Upload Creator Photos'),
      description: isCreator
        ? (
          locale === 'ru'
            ? 'Отправьте нам 3 чёткие фотографии с разных ракурсов. Ваша ИИ-модель будет готова через 24 часа. Данные лица зашифрованы и никогда не передаются третьим лицам.'
            : 'Send us 3 clear photos from different angles. Your AI model is ready in 24 hours. Face data is encrypted and never shared.'
        )
        : (
          locale === 'ru'
            ? 'Загрузите по 3 фотографии на каждого автора. ИИ-модели готовы через 24 часа. Все данные зашифрованы и изолированы для каждого автора.'
            : 'Upload 3 photos per creator. AI models are ready in 24 hours. All data encrypted and isolated per creator.'
        ),
    },
    {
      step: '02',
      title: locale === 'ru' ? 'Создавайте безлимитный контент' : 'Generate Unlimited Content',
      description: isCreator
        ? (
          locale === 'ru'
            ? 'Загрузите любое видео или опишите, что хотите. ИИ идеально накладывает ваше лицо. Reels, TikToks, YouTube Shorts — всё что угодно.'
            : 'Upload any video or describe what you want. AI puts your face on it perfectly. Reels, TikToks, YouTube Shorts — anything.'
        )
        : (
          locale === 'ru'
            ? 'Загружайте видео пакетами или используйте текстовые запросы. Выбирайте авторов. Обрабатывайте 100+ видео за ночь.'
            : 'Upload videos in bulk or use prompts. Select creators. Process 100+ videos overnight.'
        ),
    },
    {
      step: '03',
      title: isCreator
        ? (locale === 'ru' ? 'Публикуйте и растите' : 'Post & Grow')
        : (locale === 'ru' ? 'Распространяйте и масштабируйтесь' : 'Distribute & Scale'),
      description: isCreator
        ? (
          locale === 'ru'
            ? 'Скачайте в HD/4K, добавьте свой брендинг и публикуйте на всех платформах. Увеличивайте аудиторию без ограничений.'
            : 'Download in HD/4K, add your branding, and post to all platforms. Grow your audience infinitely.'
        )
        : (
          locale === 'ru'
            ? 'Скачайте контент, организованный по авторам. Распространяйте на всех платформах. Отслеживайте результаты и масштабируйте то, что работает.'
            : 'Download content organised by creator. Distribute to all platforms. Track performance and scale what works.'
        ),
    },
  ];

  const pricingTiers = [
    { name: 'Pay As You Go', price: { monthly: 0, annual: 0 }, credits: null, pricePerCredit: 0.012, popular: false, payAsYouGo: true, bonusCredits: 0 },
    { name: 'Starter',       price: { monthly: 29, annual: 289 }, credits: 2900,  pricePerCredit: 0.010,  popular: false, bonusCredits: 0 },
    { name: 'Pro',           price: { monthly: 79, annual: 787 }, credits: 8900,  pricePerCredit: 0.0089, popular: true,  bonusCredits: 1000 },
    { name: 'Business',      price: { monthly: 199, annual: 1982 }, credits: 24900, pricePerCredit: 0.0080, popular: false, bonusCredits: 5000 },
  ];

  const calculateSavings = (tier) => Math.round(tier.price.monthly * 12 - tier.price.annual);
  const formatPerCredit = (value) => value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden relative">
      <CursorGlow />
      <div className="aurora-bg" />
      <ScrollProgress />
      <LiveActivityToast isCreator={isCreator} />

      {/* ── NAV ─────────────────────────────────────────────── */}
      <motion.nav
        initial={{ y: -80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="fixed top-0 w-full z-50 px-3 pt-3"
      >
        <div
          className="max-w-7xl mx-auto px-5 sm:px-6 py-3 flex items-center justify-between rounded-[20px] border border-white/[0.1]"
          style={{ background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', boxShadow: '0 4px 30px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)' }}
        >
          <Link to="/" className="flex items-center gap-2.5 hover:opacity-80 transition">
            <img src="/logo-512.png" alt="ModelClone" className="w-9 h-9 rounded-xl object-cover" />
            <span className="text-lg font-bold tracking-tight">ModelClone</span>
          </Link>

          <div className="hidden md:flex items-center gap-1">
            {[
              { label: 'How It Works', href: '#how-it-works' },
              { label: 'Results', href: '#results' },
              { label: 'Pricing', href: '#pricing' },
            ].map((item) => (
              <a key={item.label} href={item.href} className="px-3 py-2 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-white/[0.06] transition">
                {item.label}
              </a>
            ))}
            <Link to="/" className="px-3 py-2 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-white/[0.06] transition" data-testid="link-switch-view">
              {isCreator ? 'For Agencies' : 'For Creators'}
            </Link>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Link to="/login" className="px-4 py-2 rounded-xl text-sm text-slate-300 hover:text-white transition">
              Login
            </Link>
            <Link
              to="/signup"
              className="px-4 py-2 rounded-xl text-sm font-semibold text-black bg-white hover:bg-slate-100 transition-all"
              style={{ boxShadow: '0 0 16px 2px rgba(139,92,246,0.3)' }}
              data-testid="button-nav-signup"
            >
              Start Free
            </Link>
          </div>

          <button onClick={() => setMobileMenuOpen(true)} className="md:hidden p-2 hover:bg-white/10 rounded-lg transition" data-testid="button-mobile-menu" aria-label="Open menu">
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </motion.nav>

      {/* ── MOBILE MENU ─────────────────────────────────────── */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileMenuOpen(false)} className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] md:hidden" data-testid="mobile-menu-backdrop" />
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 bottom-0 w-full max-w-xs z-[70] md:hidden overflow-y-auto glass-panel-strong"
              data-testid="mobile-menu-panel"
            >
              <div className="flex items-center justify-between p-5 border-b border-white/[0.07]">
                <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity" onClick={() => setMobileMenuOpen(false)}>
                  <img src="/logo-512.png" alt="ModelClone" className="w-8 h-8 rounded-lg object-cover" />
                  <span className="font-bold">ModelClone</span>
                </Link>
                <button onClick={() => setMobileMenuOpen(false)} className="p-1.5 hover:bg-white/10 rounded-lg transition" data-testid="button-close-mobile-menu">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex flex-col p-5 space-y-1">
                {['#how-it-works', '#results', '#pricing'].map((href, i) => (
                  <a key={href} href={href} onClick={() => setMobileMenuOpen(false)} className="px-3 py-2.5 hover:bg-white/[0.06] rounded-lg transition text-sm font-medium text-slate-300 hover:text-white">
                    {['How It Works', 'Results', 'Pricing'][i]}
                  </a>
                ))}
                <div className="border-t border-white/[0.07] my-3" />
                <Link to="/login" onClick={() => setMobileMenuOpen(false)} className="px-3 py-2.5 hover:bg-white/[0.06] rounded-lg transition text-sm font-medium text-slate-300">
                  Login
                </Link>
                <Link to="/signup" onClick={() => setMobileMenuOpen(false)} className="px-3 py-3 rounded-xl text-sm font-semibold text-black bg-white text-center mt-2" data-testid="button-mobile-signup">
                  Start Creating Free
                </Link>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center justify-center px-4 sm:px-6 pt-20">
        {/* ambient glow — single restrained purple */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[420px] rounded-full bg-purple-600/[0.07] blur-[140px]" />
        </div>

        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="relative max-w-5xl mx-auto text-center z-10">

          {/* badge */}
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.5 }}
            className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full mb-8"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}
          >
            <SiTrustpilot className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#00b67a' }} />
            <span className="text-xs text-slate-400 tracking-wide">{activeContent.hero.badge}</span>
          </motion.div>


          {/* headline */}
          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold leading-[1.05] mb-6 tracking-tight"
          >
            {activeContent.hero.headline1}
            <br />
            <span className="gradient-text">{activeContent.hero.headline2}</span>
          </motion.h1>

          <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="text-base sm:text-lg text-slate-400 mb-3 max-w-2xl mx-auto leading-relaxed"
          >
            {activeContent.hero.description}
          </motion.p>

          <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
            className="text-base sm:text-lg text-white font-medium mb-6 max-w-2xl mx-auto"
          >
            {activeContent.hero.subheading}
          </motion.p>

          {/* stats — count up on scroll */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mx-auto mb-10"
          >
            {activeContent.stats.map((stat, i) => (
              <AnimatedStat key={i} stat={stat} />
            ))}
          </motion.div>

          {/* CTAs */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}
            className="flex flex-col sm:flex-row gap-3 justify-center items-center"
          >
            <HeroCTA />
            <Link
              to="/free-course"
              className="px-7 py-3.5 rounded-2xl font-semibold inline-flex items-center gap-2.5 border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.08] transition-all"
              data-testid="button-free-course"
            >
              <BookOpen className="w-4 h-4 text-white/40 shrink-0" strokeWidth={1.25} aria-hidden />
              Free course: how to scale with AI
            </Link>
          </motion.div>

          {/* micro trust row */}
          <div className="flex items-center gap-4 justify-center mt-5 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-500" />No filming required</span>
            <span className="w-px h-3 bg-white/10" />
            <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-500" />Setup in 24 hours</span>
            <span className="w-px h-3 bg-white/10" />
            <span className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-500" />No credit card needed</span>
          </div>

          {/* live urgency signal */}
          <LiveJoinedSignal isCreator={isCreator} />
        </motion.div>
      </section>

      {/* ── GALLERY — ASHLEY ─────────────────────────────────── */}
      <section className="py-16 sm:py-20 px-4 overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-8">
            <SectionBadge>AI Portfolio</SectionBadge>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold">
              Meet <span className="gradient-text">Ashley</span>
            </h2>
            <p className="text-slate-500 mt-2 text-sm">Every photo generated using our platform.</p>
          </div>
          <div className="relative overflow-hidden">
            <div className="absolute left-0 inset-y-0 w-24 bg-gradient-to-r from-black to-transparent z-10 pointer-events-none" />
            <div className="absolute right-0 inset-y-0 w-24 bg-gradient-to-l from-black to-transparent z-10 pointer-events-none" />
            <div className="flex animate-scroll-infinite">
              {[...ashleyImages, ...ashleyImages].map((image, index) => (
                <div key={index} className="flex-shrink-0 px-2">
                  <div className="w-[180px] sm:w-[220px] md:w-[260px] aspect-[3/4] rounded-2xl overflow-hidden border border-white/[0.07]">
                    <OptimizedGalleryImage src={image.src} alt={image.alt} className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" testId={`ashley-${index}`} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── GALLERY — LAURA ──────────────────────────────────── */}
      <section className="py-16 sm:py-20 px-4 overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-8">
            <SectionBadge>AI Portfolio</SectionBadge>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold">
              Meet <span className="gradient-text">Laura</span>
            </h2>
            <p className="text-slate-500 mt-2 text-sm">Another stunning AI model. The possibilities are endless.</p>
          </div>
          <div className="relative overflow-hidden">
            <div className="absolute left-0 inset-y-0 w-24 bg-gradient-to-r from-black to-transparent z-10 pointer-events-none" />
            <div className="absolute right-0 inset-y-0 w-24 bg-gradient-to-l from-black to-transparent z-10 pointer-events-none" />
            <div className="flex animate-scroll-infinite-reverse">
              {[...lauraImages, ...lauraImages].map((image, index) => (
                <div key={index} className="flex-shrink-0 px-2">
                  <div className="w-[180px] sm:w-[220px] md:w-[260px] aspect-[3/4] rounded-2xl overflow-hidden border border-white/[0.07]">
                    <OptimizedGalleryImage src={image.src} alt={image.alt} className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" testId={`laura-${index}`} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── GALLERY — NATASHA ────────────────────────────────── */}
      <section className="py-16 sm:py-20 px-4 overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-8">
            <SectionBadge>AI Portfolio</SectionBadge>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold">
              Meet <span className="gradient-text">Natasha</span>
            </h2>
            <p className="text-slate-500 mt-2 text-sm">Fitness, lifestyle, and everything in between.</p>
          </div>
          <div className="relative overflow-hidden">
            <div className="absolute left-0 inset-y-0 w-24 bg-gradient-to-r from-black to-transparent z-10 pointer-events-none" />
            <div className="absolute right-0 inset-y-0 w-24 bg-gradient-to-l from-black to-transparent z-10 pointer-events-none" />
            <div className="flex animate-scroll-infinite">
              {[...natashaImages, ...natashaImages].map((image, index) => (
                <div key={index} className="flex-shrink-0 px-2">
                  <div className="w-[180px] sm:w-[220px] md:w-[260px] aspect-[3/4] rounded-2xl overflow-hidden border border-white/[0.07]">
                    <OptimizedGalleryImage src={image.src} alt={image.alt} className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" testId={`natasha-${index}`} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── BENEFITS ─────────────────────────────────────────── */}
      <section className="py-20 sm:py-32 px-4 sm:px-6 relative">
        <div className="max-w-6xl mx-auto relative">
          <div className="text-center mb-14">
            <SectionBadge>Why ModelClone</SectionBadge>
            <h2 className="text-4xl sm:text-5xl font-bold">
              Why {isCreator ? 'Top Creators' : 'Leading Agencies'}{' '}
              <span className="gradient-text">Choose ModelClone</span>
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {activeContent.benefits.map((benefit, index) => (
              <motion.div
                key={benefit.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.08 }}
                className="relative rounded-2xl p-6 border border-white/[0.07] overflow-hidden"
                style={{ background: 'rgba(255,255,255,0.03)' }}
              >
                <div className="flex items-start gap-4 relative">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border border-white/[0.07]" style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <benefit.icon className="w-4 h-4 text-white/70" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white mb-1.5 tracking-tight">{benefit.title}</h3>
                    <p className="text-sm text-slate-500 leading-relaxed">{benefit.description}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────── */}
      <section id="how-it-works" className="py-20 sm:py-32 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <SectionBadge>3 Simple Steps</SectionBadge>
            <h2 className="text-4xl sm:text-5xl font-bold">
              Start Creating in{' '}
              <span className="gradient-text">Minutes</span>
            </h2>
            <p className="text-slate-400 mt-3 max-w-xl mx-auto">
              From setup to your first {isCreator ? 'post' : 'bulk campaign'} in under 30 minutes
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {howItWorks.map((step, index) => (
              <motion.div
                key={step.step}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="relative rounded-2xl p-6 border border-white/[0.07] overflow-hidden"
                style={{ background: 'rgba(255,255,255,0.03)' }}
              >
                <div
                  className="text-[40px] font-black mb-3 leading-none tracking-tight"
                  style={{
                    background: 'linear-gradient(160deg, rgba(255,255,255,0.55) 0%, rgba(180,188,200,0.28) 60%, rgba(140,150,165,0.12) 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >{step.step}</div>
                <h3 className="text-sm font-semibold text-white mb-2 tracking-tight">{step.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{step.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── LOSS AVERSION ────────────────────────────────────── */}
      <LossAversionSection isCreator={isCreator} />

      {/* ── TESTIMONIALS ─────────────────────────────────────── */}
      <section id="results" className="py-20 sm:py-32 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <SectionBadge>Success Stories</SectionBadge>
            <h2 className="text-4xl sm:text-5xl font-bold">
              Real Results from{' '}
              <span className="gradient-text">Real Creators</span>
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            {activeContent.testimonials.map((t, index) => (
              <motion.div
                key={t.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.08 }}
                className="rounded-2xl p-5 border border-white/[0.07] flex flex-col"
                style={{ background: 'rgba(255,255,255,0.03)' }}
              >
                <div className="flex gap-0.5 mb-4">
                  {[...Array(t.rating)].map((_, i) => (
                    <Star key={i} className="w-3.5 h-3.5 fill-emerald-500 text-emerald-500" />
                  ))}
                </div>
                <p className="text-sm text-slate-400 leading-relaxed flex-1 mb-5">"{t.content}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full border border-white/[0.08] flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    {t.avatar}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">{t.name}</div>
                    <div className="text-xs text-slate-500">{t.role} · <span className="text-slate-400">{t.earnings || t.models}</span></div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ──────────────────────────────────────────── */}
      <section id="pricing" className="py-20 sm:py-32 px-4 sm:px-6 relative">
        <div className="max-w-6xl mx-auto relative">
          <div className="text-center mb-12">
            <SectionBadge>Pricing</SectionBadge>
            <h2 className="text-4xl sm:text-5xl font-bold mb-3">
              Pricing That <span className="gradient-text">Scales With You</span>
            </h2>
            <p className="text-slate-400 mb-8">{isCreator ? 'Start small, scale as you grow' : 'Built for agencies of all sizes'}</p>

            {/* billing toggle */}
            <div className="inline-flex items-center p-1 rounded-xl border border-white/[0.08]" style={{ background: 'rgba(255,255,255,0.04)' }}>
              {['monthly', 'annual'].map((cycle) => (
                <button
                  key={cycle}
                  onClick={() => setBillingCycle(cycle)}
                  className={`relative px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
                    billingCycle === cycle ? 'bg-white text-black' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {cycle.charAt(0).toUpperCase() + cycle.slice(1)}
                  {cycle === 'annual' && billingCycle !== 'annual' && (
                    <span className="absolute -top-2 -right-2 px-1.5 py-0.5 bg-emerald-500 text-white rounded-full text-[10px] font-bold leading-none">-17%</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {pricingTiers.map((tier, index) => {
              const price = billingCycle === 'monthly' ? tier.price.monthly : tier.price.annual;
              const savings = calculateSavings(tier);

              return (
                <motion.div
                  key={tier.name}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.07 }}
                  className={`relative rounded-2xl overflow-hidden flex flex-col border ${
                    tier.popular ? 'border-white/40' : 'border-white/[0.07]'
                  }`}
                  style={{
                    background: tier.popular
                      ? 'rgba(255,255,255,0.06)'
                      : 'rgba(255,255,255,0.03)',
                    boxShadow: tier.popular
                      ? '0 0 0 1px rgba(255,255,255,0.1), 0 0 40px 4px rgba(139,92,246,0.15)'
                      : undefined,
                  }}
                >
                  {tier.popular && (
                    <>
                      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
                      <span className="pointer-events-none absolute top-0 left-0 w-24 h-24 rounded-full bg-purple-500/15 blur-2xl -translate-x-6 -translate-y-6" />
                    </>
                  )}

                  <div className="relative p-5 flex flex-col flex-1">
                    {/* header */}
                    <div className="flex items-center justify-between mb-5">
                      <span className={`text-sm font-semibold ${tier.popular ? 'text-white' : 'text-slate-300'}`}>{tier.name}</span>
                      {tier.popular && (
                        <span
                          className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                          style={{
                            background: 'linear-gradient(135deg, rgba(251,191,36,0.18) 0%, rgba(245,158,11,0.10) 100%)',
                            border: '1px solid rgba(251,191,36,0.35)',
                            color: '#fbbf24',
                            boxShadow: '0 0 8px 1px rgba(251,191,36,0.15)',
                          }}
                        >
                          <Crown className="w-3 h-3" style={{ color: '#fbbf24' }} /> Popular
                        </span>
                      )}
                    </div>

                    {/* credits */}
                    <div className="mb-5 pb-5 border-b border-white/[0.07]">
                      {tier.payAsYouGo ? (
                        <div className="text-3xl font-bold text-slate-300">Flexible</div>
                      ) : (
                        <>
                          <div className="text-3xl font-bold text-white">{tier.credits?.toLocaleString()}</div>
                          <div className="text-xs text-slate-500 mt-0.5">credits / month</div>
                          {tier.bonusCredits > 0 && (
                            <span className="mt-2 inline-block text-[11px] font-semibold text-white/70 bg-white/[0.07] border border-white/10 px-2 py-0.5 rounded-full">
                              +{tier.bonusCredits} BONUS
                            </span>
                          )}
                        </>
                      )}
                    </div>

                    {/* price */}
                    <div className="mb-5 flex-1">
                      {tier.payAsYouGo ? (
                        <>
                          <div className="text-2xl font-bold text-white">${tier.pricePerCredit}<span className="text-sm text-slate-500 font-normal">/credit</span></div>
                          <div className="text-xs text-slate-500 mt-1">No subscription needed</div>
                        </>
                      ) : (
                        <>
                          <div className="text-2xl font-bold text-white">${price}<span className="text-sm text-slate-500 font-normal">/{billingCycle === 'monthly' ? 'mo' : 'yr'}</span></div>
                          <div className="text-xs text-slate-500 mt-1">${formatPerCredit(tier.pricePerCredit)} per credit</div>
                          {billingCycle === 'annual' && savings > 0 && (
                            <div className="text-xs text-slate-400 mt-0.5">Save ${savings}/year</div>
                          )}
                        </>
                      )}
                    </div>

                    <Link
                      to="/signup"
                      className={`block w-full py-2.5 rounded-xl text-sm font-semibold text-center transition-all ${
                        tier.popular
                          ? 'text-black bg-white hover:bg-slate-100'
                          : 'border border-white/10 bg-white/[0.05] hover:bg-white/10 text-white'
                      }`}
                      data-testid={`button-pricing-${tier.name.toLowerCase().replace(' ', '-')}`}
                    >
                      Get Started
                    </Link>
                  </div>
                </motion.div>
              );
            })}
          </div>

          <div className="flex items-center justify-center gap-6 sm:gap-10 mt-8 flex-wrap">
            {[
              { icon: GraduationCap, label: 'Free Course' },
              { icon: Repeat, label: 'Free Photo/Video Repurposer' },
              { icon: TrendingUp, label: 'Free Viral Reel Finder' },
            ].map((perk) => {
              const PerkIcon = perk.icon;
              return (
                <span key={perk.label} className="flex items-center gap-1.5 text-xs sm:text-sm text-slate-400 font-medium">
                  <PerkIcon className="w-3.5 h-3.5 text-white/35 shrink-0" strokeWidth={1.25} aria-hidden />
                  {perk.label}
                </span>
              );
            })}
          </div>
          <p className="text-center text-[11px] text-slate-500 mt-2">Included free with every subscription plan</p>

          <div className="text-center mt-6 space-y-1.5">
            <p className="text-xs text-slate-600 uppercase tracking-wider">
              Credits reset monthly · Bonus credits never expire · Full commercial rights included
            </p>
            <p className="text-sm text-slate-400">New {isCreator ? 'creators' : 'agencies'} get 250 free credits — no credit card required</p>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────── */}
      <section className="py-20 sm:py-32 px-4 sm:px-6">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-12">
            <SectionBadge>FAQ</SectionBadge>
            <h2 className="text-4xl sm:text-5xl font-bold">Common <span className="gradient-text">Questions</span></h2>
          </div>
          <div className="space-y-2">
            {activeContent.faqs.map((faq, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.05 }}
                className="rounded-2xl border border-white/[0.07] overflow-hidden"
                style={{ background: 'rgba(255,255,255,0.03)' }}
              >
                <button
                  onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-white/[0.03] transition"
                >
                  <span className="text-sm font-medium text-white">{faq.q}</span>
                  <ChevronDown className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${openFaq === index ? 'rotate-180' : ''}`} />
                </button>
                <AnimatePresence>
                  {openFaq === index && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <p className="px-5 pb-4 text-sm text-slate-400 leading-relaxed border-t border-white/[0.05] pt-3">{faq.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ────────────────────────────────────────── */}
      <section className="py-20 sm:py-32 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="relative rounded-3xl p-10 sm:p-16 text-center overflow-hidden border border-white/[0.1]"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          >
            <span className="pointer-events-none absolute top-0 left-0 w-56 h-56 rounded-full bg-purple-500/15 blur-3xl -translate-x-12 -translate-y-12" />
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

            <div className="relative z-10 flex flex-col items-center">
              <h2 className="text-4xl sm:text-5xl font-bold mb-4">
                Ready to <span className="gradient-text">{isCreator ? 'Stop Filming' : 'Scale Your Agency'}</span>?
              </h2>
              <p className="text-slate-400 mb-8 max-w-xl mx-auto">
                {isCreator
                  ? 'Join 2,500+ creators growing 3-5× faster without filming burnout.'
                  : 'Join 150+ agencies managing multiple creators profitably.'}
              </p>

              <Link
                to="/signup"
                className="relative inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-2xl font-semibold text-black bg-white hover:bg-slate-100 transition-all overflow-hidden"
                style={{ boxShadow: '0 0 32px 8px rgba(139,92,246,0.3), inset 0 1px 0 rgba(255,255,255,0.8)' }}
                data-testid="button-cta-signup"
              >
                <span className="pointer-events-none absolute top-0 left-0 w-20 h-20 rounded-full bg-purple-400/30 blur-xl -translate-x-6 -translate-y-6" />
                <span className="relative z-10">Start Creating Today</span>
                <ArrowRight className="w-4 h-4 relative z-10" />
              </Link>

              <div className="flex flex-wrap items-center justify-center gap-5 mt-6 text-xs text-slate-500">
                {['Unlimited scaling potential', 'Setup in 24 hours', 'Cancel anytime'].map((item) => (
                  <span key={item} className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-emerald-500" />{item}
                  </span>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.07] py-12 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                  <img src="/logo-512.png" alt="ModelClone" className="w-8 h-8 rounded-lg object-cover" />
                  <span className="font-bold">ModelClone</span>
                </Link>
              </div>
              <p className="text-sm text-slate-500">
                AI content creation for {isCreator ? 'creators & influencers' : 'agencies'}.
              </p>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white mb-3">Product</h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li><a href="#how-it-works" className="hover:text-white transition">How It Works</a></li>
                <li><a href="#pricing" className="hover:text-white transition">Pricing</a></li>
                <li><a href="#results" className="hover:text-white transition">Results</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white mb-3">Legal</h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li><Link to="/terms" className="hover:text-white transition">Terms of Service</Link></li>
                <li><Link to="/privacy" className="hover:text-white transition">Privacy Policy</Link></li>
                <li><Link to="/cookies" className="hover:text-white transition">Cookie Policy</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white mb-3">Support</h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li><Link to="/login" className="hover:text-white transition">Login</Link></li>
                <li><Link to="/signup" className="hover:text-white transition">Sign Up</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/[0.07] pt-6 text-center text-slate-600 text-xs">
            © 2025 ModelClone. All rights reserved.
          </div>
        </div>
      </footer>

      {/* ── MOBILE STICKY CTA ────────────────────────────────── */}
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1.2 }}
        className="fixed bottom-5 left-4 right-4 z-50 md:hidden"
      >
        <Link
          to="/signup"
          className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl font-semibold text-black bg-white"
          style={{ boxShadow: '0 0 24px 4px rgba(139,92,246,0.35)' }}
          data-testid="button-sticky-cta"
        >
          Start Creating Free
          <ArrowRight className="w-4 h-4" />
        </Link>
      </motion.div>
    </div>
  );
}
