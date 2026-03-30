# ModelClone — Lander pages (code handoff for design)

Use this document to understand current structure, copy, layout, and styling before proposing visual redesigns.

## Tech context

- **Framework:** React (Vite), React Router
- **Styling:** Tailwind CSS utility classes + inline `style={{}}` for gradients/glass
- **Motion:** framer-motion
- **Icons:** lucide-react, some react-icons (e.g. SiTrustpilot, SiDiscord)
- **Shared components:** `CursorGlow`, `OptimizedGalleryImage` (under `client/src/components/`)

## Routes (see `client/src/App.jsx`)

| URL | Component file |
|-----|----------------|
| `/` | `SelectUserTypePage.jsx` — path picker (Creator / Agency / Create AI Model) |
| `/landing?type=creator` or `?type=agency` | `LandingPage.jsx` — long-form marketing lander (same file; copy and sections switch on `type`) |
| `/create-ai-model` | `CreateAIModelLandingPage.jsx` — AI model creation funnel |

---

## 1. Main lander (home)

**Route:** `/`  
**Source file:** `client/src/pages/SelectUserTypePage.jsx`

```jsx
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import CursorGlow from '../components/CursorGlow';
import { useNavigate, Navigate } from 'react-router-dom';
import { User, Users, ArrowRight, Check, Wand2 } from 'lucide-react';
import { useState, useSyncExternalStore, useEffect, useRef } from 'react';
import { useAuthStore } from '../store';

function useHasHydrated() {
  return useSyncExternalStore(
    (callback) => useAuthStore.persist.onFinishHydration(callback),
    () => useAuthStore.persist.hasHydrated(),
    () => false
  );
}

const KEYS = ['creator', 'agency', 'createModel'];
const LOCALE_STORAGE_KEY = 'app_locale';

const PAGE_COPY = {
  en: {
    loading: 'Loading…',
    hero_welcome: 'Welcome',
    hero_title: 'How are you using ModelClone?',
    hero_subtitle: "Select your path — we'll tailor the experience for you.",
    creator_title: "I'm a Creator",
    creator_subtitle: 'Content Creator / Influencer',
    creator_description:
      'Scale your content output without the burnout of constant filming. One setup, unlimited content.',
    creator_benefit_1: 'Create 10× more content',
    creator_benefit_2: 'Stop filming 4+ hours daily',
    creator_benefit_3: 'Grow your audience 3–5× faster',
    creator_benefit_4: 'Keep your privacy',
    creator_stat_1_label: 'Time Saved',
    creator_stat_2_label: 'Content Output',
    creator_stat_3_label: 'Audience Growth',
    agency_title: "I'm an Agency",
    agency_subtitle: 'Talent Management / Agency Owner',
    agency_description:
      'Scale your roster without creator dependency or the overhead of hiring more staff.',
    agency_benefit_1: 'Manage 10+ creators efficiently',
    agency_benefit_2: 'Never depend on unreliable creators',
    agency_benefit_3: 'Scale without hiring costs',
    agency_benefit_4: 'Increase growth per creator 3×',
    agency_stat_1_label: 'Creators Managed',
    agency_stat_2_label: 'Cost Reduction',
    agency_stat_3_label: 'Growth Per Creator',
    create_model_title: 'Create AI Model',
    create_model_subtitle: 'Build an AI Model from Scratch',
    create_model_description:
      'Design a unique AI model in seconds — choose attributes, generate, and start creating content immediately.',
    create_model_benefit_1: 'Ready in seconds',
    create_model_benefit_2: 'No technical knowledge needed',
    create_model_benefit_3: 'Choose any attributes',
    create_model_benefit_4: 'Unlimited creative possibilities',
    create_model_stat_1_label: 'Setup Time',
    create_model_stat_2_label: 'Attributes',
    create_model_stat_3_label: 'AI Accuracy',
    what_you_get: 'What you get',
    cta_learn_more: 'Learn More',
    cta_continue_as: 'Continue as {{role}}',
    role_creator: 'Creator',
    role_agency: 'Agency',
    not_sure_text: 'Not sure? Pick one to explore — you can always switch later.',
    already_member: 'Already a member?',
    log_in: 'Log in',
  },
  ru: {
    loading: 'Загрузка…',
    hero_welcome: 'Добро пожаловать',
    hero_title: 'Как вы используете ModelClone?',
    hero_subtitle: 'Выберите свой путь — мы подберем для вас индивидуальный подход.',
    creator_title: 'Я — контент-мейкер',
    creator_subtitle: 'Контент-мейкер / Инфлюенсер',
    creator_description:
      'Увеличьте объем создаваемого контента, не переутомляясь постоянными съемками. Одна настройка — неограниченное количество контента.',
    creator_benefit_1: 'Создавайте в 10 раз больше контента',
    creator_benefit_2: 'Перестаньте снимать по 4 и более часов в день',
    creator_benefit_3: 'Увеличивайте свою аудиторию в 3–5 раз быстрее',
    creator_benefit_4: 'Сохраняйте свою конфиденциальность',
    creator_stat_1_label: 'Сэкономленное время',
    creator_stat_2_label: 'Объем контента',
    creator_stat_3_label: 'Рост аудитории',
    agency_title: 'Я агентство',
    agency_subtitle: 'Управление талантами / Владелец агентства',
    agency_description:
      'Расширяйте свой список авторов без зависимости от них и без затрат на наем дополнительного персонала.',
    agency_benefit_1: 'Эффективно управляйте более чем 10 авторами',
    agency_benefit_2: 'Никогда не зависите от ненадежных авторов',
    agency_benefit_3: 'Расширяйте масштабы без затрат на найм',
    agency_benefit_4: 'Увеличьте рост на одного автора в 3 раза',
    agency_stat_1_label: 'Количество авторов под управлением',
    agency_stat_2_label: 'Сокращение затрат',
    agency_stat_3_label: 'Рост на одного автора',
    create_model_title: 'Создать модель ИИ',
    create_model_subtitle: 'Создать модель ИИ с нуля',
    create_model_description:
      'Разработайте уникальную модель ИИ за считанные секунды — выберите атрибуты, сгенерируйте и сразу же начните создавать контент.',
    create_model_benefit_1: 'Готово за секунды',
    create_model_benefit_2: 'Не требуется технических знаний',
    create_model_benefit_3: 'Выберите любые атрибуты',
    create_model_benefit_4: 'Неограниченные творческие возможности',
    create_model_stat_1_label: 'Время настройки',
    create_model_stat_2_label: 'Атрибуты',
    create_model_stat_3_label: 'Точность ИИ',
    what_you_get: 'Что вы получаете',
    cta_learn_more: 'Узнать больше',
    cta_continue_as: 'Продолжить в качестве {{role}}',
    role_creator: 'Креативщик',
    role_agency: 'Агентство',
    not_sure_text: 'Не уверены? Выберите один вариант, чтобы ознакомиться — вы всегда сможете сменить его позже.',
    already_member: 'Уже являетесь участником?',
    log_in: 'Войти',
  },
};

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

export default function SelectUserTypePage() {
  const navigate = useNavigate();
  const [selectedType, setSelectedType] = useState('creator');
  const [locale] = useState(resolveLocale);
  const [sessionValid, setSessionValid] = useState(null);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hasHydrated = useHasHydrated();
  const checkedRef = useRef(false);
  const copy = PAGE_COPY[locale] || PAGE_COPY.en;

  // Gate: never redirect or run session check before hydration (avoids dev loop from auth redirect before session ready)
  if (!hasHydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="animate-pulse text-white/50 text-sm">{copy.loading}</div>
      </div>
    );
  }

  // Verify session before redirecting to dashboard — avoids loop from stale auth → dashboard → 401 → login → /
  useEffect(() => {
    if (!isAuthenticated || checkedRef.current) return;
    checkedRef.current = true;
    (async () => {
      try {
        const { authAPI } = await import('../services/api');
        const res = await authAPI.getProfile();
        if (res?.success) setSessionValid(true);
        else setSessionValid(false);
      } catch {
        setSessionValid(false);
        try {
          useAuthStore.setState({ user: null, isAuthenticated: false });
        } catch (_) {}
      }
    })();
  }, [isAuthenticated]); // hasHydrated stable true after gate above

  if (isAuthenticated && sessionValid === true) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleContinue = () => {
    if (selectedType === 'createModel') {
      navigate('/create-ai-model');
    } else {
      localStorage.setItem('userType', selectedType);
      navigate(`/landing?type=${selectedType}`);
    }
  };

  const userTypes = {
    creator: {
      type: 'creator',
      icon: User,
      title: copy.creator_title,
      subtitle: copy.creator_subtitle,
      description: copy.creator_description,
      benefits: [copy.creator_benefit_1, copy.creator_benefit_2, copy.creator_benefit_3, copy.creator_benefit_4],
      stats: [
        { label: copy.creator_stat_1_label, value: '90%' },
        { label: copy.creator_stat_2_label, value: '10\u00d7' },
        { label: copy.creator_stat_3_label, value: '3\u20135\u00d7' },
      ],
    },
    agency: {
      type: 'agency',
      icon: Users,
      title: copy.agency_title,
      subtitle: copy.agency_subtitle,
      description: copy.agency_description,
      benefits: [copy.agency_benefit_1, copy.agency_benefit_2, copy.agency_benefit_3, copy.agency_benefit_4],
      stats: [
        { label: copy.agency_stat_1_label, value: '10+' },
        { label: copy.agency_stat_2_label, value: '80%' },
        { label: copy.agency_stat_3_label, value: '3\u00d7' },
      ],
    },
    createModel: {
      type: 'createModel',
      icon: Wand2,
      title: copy.create_model_title,
      subtitle: copy.create_model_subtitle,
      description: copy.create_model_description,
      benefits: [copy.create_model_benefit_1, copy.create_model_benefit_2, copy.create_model_benefit_3, copy.create_model_benefit_4],
      stats: [
        { label: copy.create_model_stat_1_label, value: '30s' },
        { label: copy.create_model_stat_2_label, value: '5+' },
        { label: copy.create_model_stat_3_label, value: '99%' },
      ],
      isSpecial: true,
    },
  };

  const currentType = userTypes[selectedType];

  const selectedIdx = KEYS.indexOf(selectedType);
  const displayOrder = [
    KEYS[(selectedIdx + 2) % 3],
    KEYS[selectedIdx],
    KEYS[(selectedIdx + 1) % 3],
  ];

  return (
    <div
      className="min-h-screen text-white flex items-center justify-center px-4 sm:px-6 py-12 overflow-x-hidden relative"
      style={{ background: '#07070b' }}
    >
      <CursorGlow />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full opacity-[0.12]"
          style={{ background: 'radial-gradient(ellipse at center, #7c3aed 0%, transparent 70%)' }}
        />
        <div
          className="absolute bottom-0 right-1/4 w-[400px] h-[300px] rounded-full opacity-[0.07]"
          style={{ background: 'radial-gradient(ellipse at center, #a78bfa 0%, transparent 70%)' }}
        />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      <div className="relative z-10 max-w-3xl mx-auto w-full">

        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-center gap-2.5 mb-10"
        >
          <div className="relative">
            <div className="absolute inset-0 rounded-xl blur-md opacity-60" style={{ background: 'rgba(139,92,246,0.4)' }} />
            <img src="/logo-512.png" alt="ModelClone" className="relative w-9 h-9 rounded-xl object-cover ring-1 ring-white/10" />
          </div>
          <span className="text-xl font-bold tracking-tight">ModelClone</span>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="text-center mb-8"
        >
          <p className="text-[10px] font-medium tracking-[0.22em] uppercase mb-3 text-white/30">
            {copy.hero_welcome}
          </p>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-2 tracking-tight text-white">
            {copy.hero_title}
          </h1>
          <p className="text-sm max-w-md mx-auto text-white/40">
            {copy.hero_subtitle}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.14 }}
          className="grid grid-cols-3 gap-2.5 mb-5"
        >
          <LayoutGroup id="tabs">
            {displayOrder.map((typeKey, position) => {
              const type = userTypes[typeKey];
              const isCenter = position === 1;

              return (
                <motion.button
                  key={typeKey}
                  layout
                  onClick={() => setSelectedType(typeKey)}
                  animate={{
                    scale: isCenter ? 1 : 0.82,
                    opacity: isCenter ? 1 : 0.42,
                  }}
                  transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                  className="relative p-4 sm:p-5 rounded-2xl text-left overflow-hidden origin-center"
                  style={isCenter ? {
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.16)',
                    boxShadow: '0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.08)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                  } : {
                    background: 'rgba(255,255,255,0.025)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                  }}
                  data-testid={`tab-${typeKey}`}
                >
                  {isCenter && (
                    <span
                      className="pointer-events-none absolute top-0 left-0 rounded-full"
                      style={{
                        width: '140px',
                        height: '140px',
                        transform: 'translate(-50%, -50%)',
                        background: 'radial-gradient(circle, rgba(255,255,255,0.08) 0%, rgba(139,92,246,0.1) 40%, transparent 70%)',
                      }}
                    />
                  )}

                  <div className="relative flex flex-col items-center gap-2.5 text-center">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center"
                      style={isCenter ? {
                        background: 'rgba(255,255,255,0.08)',
                        border: '1px solid rgba(255,255,255,0.14)',
                      } : {
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.07)',
                      }}
                    >
                      <type.icon className="w-4 h-4" style={{ color: isCenter ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)' }} />
                    </div>
                    <div>
                      <p className="font-semibold text-sm leading-tight" style={{ color: isCenter ? '#fff' : 'rgba(255,255,255,0.55)' }}>
                        {type.title}
                      </p>
                      <p className="text-[10px] hidden sm:block mt-0.5 text-white/30">
                        {type.subtitle}
                      </p>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </LayoutGroup>
        </motion.div>

        <AnimatePresence mode="wait">
          <motion.div
            key={selectedType}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22 }}
            className="relative rounded-2xl p-5 sm:p-7 mb-6 overflow-hidden"
            style={{
              background: 'rgba(20,16,32,0.6)',
              border: '1px solid rgba(255,255,255,0.09)',
              boxShadow: '0 1px 0 rgba(255,255,255,0.06) inset, 0 8px 40px rgba(0,0,0,0.4), 0 0 60px rgba(139,92,246,0.07)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
            }}
          >
            <span
              className="pointer-events-none absolute"
              style={{
                top: 0,
                left: 0,
                width: '320px',
                height: '320px',
                transform: 'translate(-30%, -30%)',
                background: 'radial-gradient(circle at 30% 30%, rgba(139,92,246,0.18) 0%, rgba(139,92,246,0.06) 40%, transparent 65%)',
                borderRadius: '50%',
              }}
            />
            <div
              className="pointer-events-none absolute top-0 left-0 right-0 h-px"
              style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.12) 40%, rgba(255,255,255,0.18) 50%, rgba(255,255,255,0.12) 60%, transparent 100%)' }}
            />

            <p className="relative text-sm leading-relaxed mb-6 text-white/60">
              {currentType.description}
            </p>

            <div className="grid grid-cols-3 gap-2.5 mb-6 relative">
              {currentType.stats.map((stat) => (
                <div
                  key={stat.label}
                  className="text-center p-3 rounded-xl"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.07)',
                  }}
                >
                  <div className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                    {stat.value}
                  </div>
                  <div className="text-[10px] mt-0.5 text-white/35 uppercase tracking-wider">{stat.label}</div>
                </div>
              ))}
            </div>

            <div className="mb-6 relative">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] mb-3 text-white/30">
                {copy.what_you_get}
              </p>
              <ul className="grid sm:grid-cols-2 gap-2">
                {currentType.benefits.map((benefit) => (
                  <li key={benefit} className="flex items-center gap-2.5 text-sm text-white/75">
                    <span
                      className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
                    >
                      <Check className="w-2.5 h-2.5 text-white/70" />
                    </span>
                    {benefit}
                  </li>
                ))}
              </ul>
            </div>

            <button
              onClick={handleContinue}
              className="relative mx-auto block py-3 px-10 rounded-xl font-semibold text-black bg-white hover:bg-slate-50 transition-all flex items-center justify-center gap-2 overflow-hidden"
              style={{ boxShadow: '0 0 0 1px rgba(255,255,255,0.9), 0 0 32px 8px rgba(139,92,246,0.4), inset 0 1px 0 rgba(255,255,255,1)' }}
              data-testid={`button-continue-${selectedType}`}
            >
              <span
                className="pointer-events-none absolute top-0 left-0 rounded-full"
                style={{
                  width: '100px',
                  height: '100px',
                  transform: 'translate(-35%, -45%)',
                  background: 'radial-gradient(circle, rgba(139,92,246,0.5) 0%, transparent 70%)',
                }}
              />
              <span className="relative z-10">
                {selectedType === 'createModel'
                  ? copy.cta_learn_more
                  : copy.cta_continue_as.replace(
                      '{{role}}',
                      currentType.type === 'creator' ? copy.role_creator : copy.role_agency,
                    )}
              </span>
              <ArrowRight className="w-4 h-4 relative z-10" />
            </button>
          </motion.div>
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center space-y-3"
        >
          <p className="text-xs text-white/50">
            {copy.not_sure_text}
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <span className="text-white/70">{copy.already_member}</span>
            <a
              href="/login"
              className="font-semibold transition hover:text-white"
              style={{ color: '#e2d9ff' }}
              data-testid="link-login"
            >
              {copy.log_in}
            </a>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

```

---

## 2. Marketing lander — Creator & Agency

**Route:** `/landing?type=creator | /landing?type=agency`  
**Source file:** `client/src/pages/LandingPage.jsx`

```jsx
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

```

---

## 3. Create AI Model lander

**Route:** `/create-ai-model`  
**Source file:** `client/src/pages/CreateAIModelLandingPage.jsx`

```jsx
import { motion, AnimatePresence, useSpring, useTransform } from 'framer-motion';
import { Link, useLocation } from 'react-router-dom';
import { 
  Zap, Shield, ArrowRight, Check, 
  Clock, Wand2, Image, Palette,
  User, Settings, Menu, X, Volume2, VolumeX, TrendingUp
} from 'lucide-react';
import { SiDiscord } from 'react-icons/si';
import { useState, useEffect, useRef, useMemo } from 'react';
import OptimizedGalleryImage from '../components/OptimizedGalleryImage';
import CursorGlow from '../components/CursorGlow';
import { referralAPI } from '../services/api';
import { generateFingerprint } from '../utils/fingerprint';

const LOCALE_STORAGE_KEY = 'app_locale';

const COPY = {
  en: {
    socialProofFrom: 'from',
    socialProofCta: 'Start Now',
    socialProofActionStartedMoney: 'just started making money with AI Influencers',
    socialProofActionEarned950Week: 'earned $950 this week',
    socialProofActionCreatedFirstInfluencer: 'created her first AI influencer',
    socialProofActionJustSignedUp: 'just signed up',
    socialProofActionFirst10Subscribers: 'got her first 10 subscribers',
    socialProofActionEarned1400TwoWeeks: 'earned $1,400 in 2 weeks',
    socialProofActionEarned2800Month: 'earned $2,800 this month',
    socialProofActionJustVerified: 'just got verified',
    socialProofActionEarned720FirstWeek: 'earned $720 in his first week',
    socialProofActionCreated3Influencers: 'created 3 AI influencers',
    socialProofActionEarned1850Week: 'earned $1,850 this week',
    socialProofAction50SubscribersToday: 'got 50 new subscribers today',
    socialProofActionEarned3200Month: 'earned $3,200 this month',
    socialProofTime2Seconds: '2 seconds ago',
    socialProofTime15Seconds: '15 seconds ago',
    socialProofTime30Seconds: '30 seconds ago',
    socialProofTime45Seconds: '45 seconds ago',
    socialProofTime1Minute: '1 minute ago',
    socialProofTime2Minutes: '2 minutes ago',
    socialProofTime3Minutes: '3 minutes ago',
    socialProofTime5Minutes: '5 minutes ago',
    socialProofTime6Minutes: '6 minutes ago',
    socialProofTime7Minutes: '7 minutes ago',
    socialProofTime8Minutes: '8 minutes ago',
    socialProofTime9Minutes: '9 minutes ago',
    socialProofTime10Minutes: '10 minutes ago',
    socialProofTime11Minutes: '11 minutes ago',
    socialProofTime12Minutes: '12 minutes ago',
    socialProofTime13Minutes: '13 minutes ago',
    earningsMonth1: 'Month 1',
    earningsMonth2: 'Month 2',
    earningsMonth3: 'Month 3',
    earningsMonth4: 'Month 4',
    earningsMonth5: 'Month 5',
    earningsMonth6: 'Month 6',
    earningsHeader: 'Projected Monthly Earnings',
    earningsPerMonthSuffix: '/mo',
    earningsChartHint: 'Tap any month to explore projected earnings growth',
    testimonial1: 'Created my AI model in 5 minutes. Now I earn passively while I sleep.',
    testimonial2: 'The Discord community taught me everything for free. Game changer!',
    testimonial3: 'Best investment of my time. The AI looks super realistic.',
    testimonial4: 'Started a month ago, already have paying subscribers.',
    testimonial5: 'Zero technical skills needed. The platform does everything.',
    testimonial6: 'ModelClone + Discord = perfect combo for beginners.',
    testimonial7: 'I run 3 AI models now. Each one earns independently.',
    testimonial8: 'Was skeptical at first, but the results speak for themselves.',
    navLogin: 'Login',
    navStartFree: 'Start Free',
    badgeJoinedWeek: 'joined this week',
    heroTitle: 'Create Your AI Model',
    heroSubtitle: 'Creators earn from $10K+ monthly',
    heroDescription: 'Design your perfect AI influencer in 60 seconds.',
    heroDescriptionHighlight: '100% free to start.',
    trustNoCard: 'No credit card',
    trustReady60s: 'Ready in 60s',
    realResultsLabel: 'Real Results',
    realResultsTitle: 'Average AI content creator earnings over 6 months',
    statsModelsCreated: 'Models Created',
    statsImagesMade: 'Images Made',
    statsSatisfaction: 'Creator satisfaction',
    galleryLabel: 'AI-Generated',
    galleryMeetAshley: 'Meet Ashley',
    galleryAshleyCaption: 'Every photo generated with ModelClone',
    galleryMeetLaura: 'Meet Laura',
    galleryMeetNatasha: 'Meet Natasha',
    howItWorksTitle: 'How It Works',
    howItWorksSubtitle: '3 simple steps, no skills needed',
    step1Title: 'Choose a Name',
    step1Desc: 'Give your AI a unique identity',
    step2Title: 'Select Features',
    step2Desc: 'Pick age, hair, eyes, body type',
    step3Title: 'Generate',
    step3Desc: 'Click and your AI is ready',
    whyTitle: 'Why AI Models?',
    whySubtitle: 'The smarter way to create content',
    benefit1Title: '100% Profits',
    benefit1Desc: 'Keep everything you earn',
    benefit2Title: 'Work 24/7',
    benefit2Desc: 'Content while you sleep',
    benefit3Title: 'No Drama',
    benefit3Desc: 'Always reliable, always ready',
    benefit4Title: 'Unlimited',
    benefit4Desc: 'Generate as much as you want',
    successStoriesLabel: 'Success Stories',
    successStoriesTitle: 'Real Earnings',
    discordTitle: 'Free Training Community',
    discordSubtitle: 'Join 2,000+ creators learning how to earn with AI',
    discordButton: 'Join Discord Free',
    finalCtaTitle: 'Ready to Start?',
    finalCtaSubtitle: 'Create your first AI model in under 60 seconds',
    finalCtaPrimary: 'Create Free AI Model',
    finalCtaSecondary: 'Already have an account? Login',
    footerTerms: 'Terms',
    footerPrivacy: 'Privacy',
    footerCookies: 'Cookies',
  },
  ru: {
    socialProofFrom: 'из',
    socialProofCta: 'Начать',
    socialProofActionStartedMoney: 'только что начала зарабатывать с ИИ-инфлюенсерами',
    socialProofActionEarned950Week: 'заработала $950 за эту неделю',
    socialProofActionCreatedFirstInfluencer: 'создала своего первого ИИ-инфлюенсера',
    socialProofActionJustSignedUp: 'только что зарегистрировалась',
    socialProofActionFirst10Subscribers: 'получила первых 10 подписчиков',
    socialProofActionEarned1400TwoWeeks: 'заработала $1 400 за 2 недели',
    socialProofActionEarned2800Month: 'заработала $2 800 за этот месяц',
    socialProofActionJustVerified: 'только что прошла верификацию',
    socialProofActionEarned720FirstWeek: 'заработал $720 за первую неделю',
    socialProofActionCreated3Influencers: 'создал 3 ИИ-инфлюенсера',
    socialProofActionEarned1850Week: 'заработала $1 850 за эту неделю',
    socialProofAction50SubscribersToday: 'получила 50 новых подписчиков сегодня',
    socialProofActionEarned3200Month: 'заработала $3 200 за этот месяц',
    socialProofTime2Seconds: '2 секунды назад',
    socialProofTime15Seconds: '15 секунд назад',
    socialProofTime30Seconds: '30 секунд назад',
    socialProofTime45Seconds: '45 секунд назад',
    socialProofTime1Minute: '1 минуту назад',
    socialProofTime2Minutes: '2 минуты назад',
    socialProofTime3Minutes: '3 минуты назад',
    socialProofTime5Minutes: '5 минут назад',
    socialProofTime6Minutes: '6 минут назад',
    socialProofTime7Minutes: '7 минут назад',
    socialProofTime8Minutes: '8 минут назад',
    socialProofTime9Minutes: '9 минут назад',
    socialProofTime10Minutes: '10 минут назад',
    socialProofTime11Minutes: '11 минут назад',
    socialProofTime12Minutes: '12 минут назад',
    socialProofTime13Minutes: '13 минут назад',
    earningsMonth1: 'Месяц 1',
    earningsMonth2: 'Месяц 2',
    earningsMonth3: 'Месяц 3',
    earningsMonth4: 'Месяц 4',
    earningsMonth5: 'Месяц 5',
    earningsMonth6: 'Месяц 6',
    earningsHeader: 'Прогнозируемый ежемесячный доход',
    earningsPerMonthSuffix: '/мес',
    earningsChartHint: 'Нажмите на любой месяц, чтобы увидеть прогноз роста доходов',
    testimonial1: 'Создала ИИ-модель за 5 минут. Теперь зарабатываю пассивно, пока сплю.',
    testimonial2: 'Сообщество в Discord научило меня всему бесплатно. Это меняет всё!',
    testimonial3: 'Лучшее вложение времени. ИИ выглядит очень реалистично.',
    testimonial4: 'Начал месяц назад — уже есть платные подписчики.',
    testimonial5: 'Никаких технических навыков не нужно. Платформа делает всё сама.',
    testimonial6: 'ModelClone + Discord = идеальное сочетание для новичков.',
    testimonial7: 'Сейчас веду 3 ИИ-модели. Каждая зарабатывает самостоятельно.',
    testimonial8: 'Сначала сомневался, но результаты говорят сами за себя.',
    navLogin: 'Войти',
    navStartFree: 'Начать бесплатно',
    badgeJoinedWeek: 'присоединились на этой неделе',
    heroTitle: 'Создайте свою ИИ-модель',
    heroSubtitle: 'Креаторы зарабатывают от $10 000+ в месяц',
    heroDescription: 'Создайте идеального ИИ-инфлюенсера за 60 секунд.',
    heroDescriptionHighlight: 'Старт полностью бесплатный.',
    trustNoCard: 'Без кредитной карты',
    trustReady60s: 'Готово за 60 сек',
    realResultsLabel: 'Реальные результаты',
    realResultsTitle: 'Средний доход AI-креаторов за 6 месяцев',
    statsModelsCreated: 'Создано моделей',
    statsImagesMade: 'Создано изображений',
    statsSatisfaction: 'Удовлетворённость креаторов',
    galleryLabel: 'Сгенерировано ИИ',
    galleryMeetAshley: 'Познакомьтесь с Эшли',
    galleryAshleyCaption: 'Каждое фото создано с помощью ModelClone',
    galleryMeetLaura: 'Познакомьтесь с Лорой',
    galleryMeetNatasha: 'Познакомьтесь с Наташей',
    howItWorksTitle: 'Как это работает',
    howItWorksSubtitle: '3 простых шага — без специальных навыков',
    step1Title: 'Выберите имя',
    step1Desc: 'Дайте своему ИИ уникальную личность',
    step2Title: 'Задайте параметры',
    step2Desc: 'Выберите возраст, цвет волос, глаз и тип фигуры',
    step3Title: 'Генерировать',
    step3Desc: 'Нажмите — и ваш ИИ готов',
    whyTitle: 'Зачем ИИ-модели?',
    whySubtitle: 'Умный способ создавать контент',
    benefit1Title: '100% прибыли',
    benefit1Desc: 'Весь заработок остаётся вам',
    benefit2Title: 'Работа 24/7',
    benefit2Desc: 'Контент создаётся, пока вы спите',
    benefit3Title: 'Без проблем',
    benefit3Desc: 'Всегда надёжно, всегда готово',
    benefit4Title: 'Без ограничений',
    benefit4Desc: 'Генерируйте столько, сколько хотите',
    successStoriesLabel: 'Истории успеха',
    successStoriesTitle: 'Реальные доходы',
    discordTitle: 'Бесплатное обучающее сообщество',
    discordSubtitle: 'Присоединяйтесь к 2 000+ авторам, которые учатся зарабатывать с ИИ',
    discordButton: 'Вступить в Discord бесплатно',
    finalCtaTitle: 'Готовы начать?',
    finalCtaSubtitle: 'Создайте свою первую ИИ-модель менее чем за 60 секунд',
    finalCtaPrimary: 'Создать ИИ-модель бесплатно',
    finalCtaSecondary: 'Уже есть аккаунт? Войти',
    footerTerms: 'Условия использования',
    footerPrivacy: 'Конфиденциальность',
    footerCookies: 'Файлы cookie',
  },
};

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

// Neutral monochrome avatar tints — no rainbow colours
const avatarTints = [
  'rgba(255,255,255,0.08)',
  'rgba(255,255,255,0.06)',
  'rgba(255,255,255,0.10)',
  'rgba(255,255,255,0.07)',
  'rgba(255,255,255,0.09)',
  'rgba(255,255,255,0.08)',
];

const DEFAULT_LANDER_DEMO_VIDEO_URL =
  'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/AI_model_main_video.mp4';

function DemoVideo({ videoUrl }) {
  const videoRef = useRef(null);
  const [isMuted, setIsMuted] = useState(true);
  const src = videoUrl?.trim() || DEFAULT_LANDER_DEMO_VIDEO_URL;

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="mt-6"
    >
      <div className="relative aspect-video rounded-2xl overflow-hidden bg-gradient-to-br from-purple-900/30 to-pink-900/30 border border-white/10">
        <video 
          key={src}
          ref={videoRef}
          autoPlay 
          loop 
          playsInline
          muted
          className="w-full h-full object-cover"
          data-testid="video-demo"
        >
          <source src={src} type="video/mp4" />
        </video>
        <button
          onClick={toggleMute}
          className="absolute bottom-3 right-3 w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center hover:bg-black/70 transition-colors"
          data-testid="button-video-mute"
        >
          {isMuted ? (
            <VolumeX className="w-5 h-5 text-white" />
          ) : (
            <Volume2 className="w-5 h-5 text-white" />
          )}
        </button>
      </div>
    </motion.div>
  );
}

function SocialProofPopup({ messages, copy }) {
  const [isVisible, setIsVisible] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const initialDelay = setTimeout(() => {
      setIsVisible(true);
    }, 3000);

    return () => clearTimeout(initialDelay);
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    const hideTimeout = setTimeout(() => {
      setIsExiting(true);
      setTimeout(() => {
        setIsExiting(false);
        setIsVisible(false);
        setCurrentIndex((prev) => (prev + 1) % messages.length);
        
        setTimeout(() => {
          setIsVisible(true);
        }, 7000);
      }, 300);
    }, 5000);

    return () => clearTimeout(hideTimeout);
  }, [isVisible, currentIndex]);

  const message = messages[currentIndex];
  const avatarBg = avatarTints[currentIndex % avatarTints.length];

  if (!isVisible && !isExiting) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, x: -8 }}
      animate={{ opacity: isExiting ? 0 : 1, y: isExiting ? 12 : 0, x: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      className="fixed bottom-24 md:bottom-6 left-4 z-[60] max-w-[300px]"
    >
      <div
        className="rounded-2xl p-3 relative overflow-hidden"
        style={{
          background: 'rgba(10,10,14,0.88)',
          border: '1px solid rgba(255,255,255,0.09)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        {/* subtle top-left corner glow */}
        <span
          className="pointer-events-none absolute top-0 left-0 w-24 h-24 rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)',
            transform: 'translate(-40%,-40%)',
          }}
        />

        <div className="relative flex items-start gap-2.5">
          {/* Avatar — neutral glass monogram */}
          <div
            className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center text-sm font-semibold text-white/70"
            style={{
              background: avatarBg,
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            {message.name.charAt(0)}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-white/85 text-xs leading-snug">
              <span className="font-semibold text-white">{message.name}</span>
              {' '}<span style={{ color: 'rgba(255,255,255,0.4)' }}>{copy.socialProofFrom} {message.flag} {message.city}</span>
              {' '}{message.action}
            </p>
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                {message.time}
              </span>
              <Link
                to="/signup"
                className="text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-all hover:bg-white/[0.08]"
                style={{
                  color: 'rgba(255,255,255,0.6)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.04)',
                }}
              >
                {copy.socialProofCta} →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function AnimatedCounter({ end, duration = 2000, suffix = '' }) {
  const [count, setCount] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasStarted) {
          setHasStarted(true);
        }
      },
      { threshold: 0.3 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [hasStarted]);

  useEffect(() => {
    if (!hasStarted) return;

    let startTime;
    const animate = (currentTime) => {
      if (!startTime) startTime = currentTime;
      const progress = Math.min((currentTime - startTime) / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(easeOut * end));

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, [hasStarted, end, duration]);

  return (
    <span ref={ref} className="tabular-nums">
      {count.toLocaleString()}{suffix}
    </span>
  );
}

const E_DATA = [
  { month: 1, earnings: 1500,  label: 'Month 1' },
  { month: 2, earnings: 4200,  label: 'Month 2' },
  { month: 3, earnings: 7800,  label: 'Month 3' },
  { month: 4, earnings: 10500, label: 'Month 4' },
  { month: 5, earnings: 13200, label: 'Month 5' },
  { month: 6, earnings: 16000, label: 'Month 6' },
];

// SVG coordinate space — PY must be > tooltip offset (32) to keep M6 label inside panel
const VW = 460, VH = 220, PX = 42, PY = 52;
const E_MAX = Math.max(...E_DATA.map(d => d.earnings));

const E_POINTS = E_DATA.map((d, i) => ({
  x: PX + (i * (VW - 2 * PX) / (E_DATA.length - 1)),
  y: VH - PY - (d.earnings / E_MAX) * (VH - 2 * PY),
  ...d,
}));

const E_PATH = E_POINTS.reduce((acc, p, i) => {
  if (i === 0) return `M ${p.x} ${p.y}`;
  const prev = E_POINTS[i - 1];
  const cp1x = prev.x + (p.x - prev.x) * 0.45;
  const cp2x = p.x  - (p.x - prev.x) * 0.45;
  return `${acc} C ${cp1x} ${prev.y}, ${cp2x} ${p.y}, ${p.x} ${p.y}`;
}, '');

const E_AREA = `${E_PATH} L ${E_POINTS[E_POINTS.length - 1].x} ${VH - PY} L ${PX} ${VH - PY} Z`;

const E_GRID = [0.25, 0.5, 0.75, 1].map(r => ({
  y:     VH - PY - r * (VH - 2 * PY),
  label: `$${(r * 16).toFixed(0)}k`,
}));

// Slow, heavy spring — silky glide for point, rings & tooltip
const SP = { stiffness: 38, damping: 14, mass: 2.2 };

function EarningsGrowthSlider({ currency = '$', copy }) {
  const [selected, setSelected]           = useState(1);
  const [visible, setVisible]             = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const wrapRef = useRef(null);

  // Spring values tracking active point in SVG coordinate space
  const springX = useSpring(E_POINTS[0].x, { stiffness: 38, damping: 14, mass: 2.2 });
  const springY = useSpring(E_POINTS[0].y, { stiffness: 38, damping: 14, mass: 2.2 });

  // Drive springs whenever selected changes
  useEffect(() => {
    springX.set(E_POINTS[selected - 1].x);
    springY.set(E_POINTS[selected - 1].y);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Map SVG coords → percentage strings for the HTML tooltip overlay
  const tooltipLeft = useTransform(springX, v => `${(v / VW) * 100}%`);
  const tooltipTop  = useTransform(springY, v => `${((v - 32) / VH) * 100}%`);

  // Intersection observer — triggers draw animation
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.25 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Auto-advance once visible (stops when user taps)
  useEffect(() => {
    if (!visible || hasInteracted || selected >= E_DATA.length) return;
    const t = setTimeout(() => setSelected(s => Math.min(s + 1, E_DATA.length)), 1500);
    return () => clearTimeout(t);
  }, [visible, selected, hasInteracted]);

  const cur = E_DATA[selected - 1];
  const prev = selected > 1 ? E_DATA[selected - 2] : null;
  const pct  = prev ? Math.round(((cur.earnings - prev.earnings) / prev.earnings) * 100) : null;
  const pt   = E_POINTS[selected - 1];

  return (
    <div className="w-full" ref={wrapRef}>

      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-4 px-1">
        <div>
          <p className="text-[9px] uppercase tracking-[0.18em] mb-1.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {copy.earningsHeader}
          </p>
          <AnimatePresence mode="wait">
            <motion.div
              key={cur.earnings}
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -5, opacity: 0 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="text-4xl font-bold text-white leading-none tabular-nums"
              style={{ textShadow: '0 0 28px rgba(74,222,128,0.2)' }}
            >
              {currency}{cur.earnings.toLocaleString()}
              <span className="text-base font-normal ml-1.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{copy.earningsPerMonthSuffix}</span>
            </motion.div>
          </AnimatePresence>
          <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {[copy.earningsMonth1, copy.earningsMonth2, copy.earningsMonth3, copy.earningsMonth4, copy.earningsMonth5, copy.earningsMonth6][selected - 1]}
          </p>
        </div>

        <AnimatePresence mode="wait">
          {pct !== null && (
            <motion.div
              key={pct}
              initial={{ scale: 0.75, opacity: 0 }}
              animate={{ scale: 1,    opacity: 1 }}
              exit={{ scale: 0.75,    opacity: 0 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold"
              style={{
                background: 'rgba(74,222,128,0.08)',
                border: '1px solid rgba(74,222,128,0.22)',
                color: '#4ade80',
              }}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              +{pct}%
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Chart panel ────────────────────────────────── */}
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }}
      >
        {/* green ambient glow top-right */}
        <div className="pointer-events-none absolute top-0 right-0 w-48 h-48 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(74,222,128,0.07) 0%, transparent 70%)', transform: 'translate(35%,-35%)' }} />

        {/* SVG chart */}
        <div className="relative px-2 pt-2 pb-1">
          <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full h-auto overflow-visible" style={{ display: 'block' }}>
            <defs>
              <linearGradient id="eg-area" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%"   stopColor="#22c55e" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0.01" />
              </linearGradient>
              <linearGradient id="eg-line" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%"   stopColor="#4ade80" />
                <stop offset="100%" stopColor="#34d399" />
              </linearGradient>
              <filter id="eg-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="3.5" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {/* Grid lines */}
            {E_GRID.map(({ y, label }, i) => (
              <g key={i}>
                <line x1={PX} y1={y} x2={VW - PX * 0.3} y2={y}
                  stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="4 5" />
                <text x={PX - 6} y={y + 4} textAnchor="end"
                  fill="rgba(255,255,255,0.2)" fontSize="9" fontFamily="monospace">
                  {label}
                </text>
              </g>
            ))}

            {/* Area fill */}
            <motion.path d={E_AREA} fill="url(#eg-area)"
            initial={{ opacity: 0 }}
            animate={{ opacity: visible ? 1 : 0 }}
            transition={{ duration: 2.4, ease: [0.22, 1, 0.36, 1], delay: 0.5 }}
            />

            {/* Animated line draw */}
            <motion.path
              d={E_PATH} fill="none"
              stroke="url(#eg-line)" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: visible ? 1 : 0, opacity: visible ? 1 : 0 }}
            transition={{ duration: 3.2, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
            />

            {/* Inactive dots */}
            {E_POINTS.map((p, i) =>
              i !== selected - 1 ? (
                <circle key={i} cx={p.x} cy={p.y} r={3.5}
                  fill="rgba(74,222,128,0.2)" stroke="rgba(74,222,128,0.4)" strokeWidth="1" />
              ) : null
            )}

            {/* Vertical dashed indicator — springs via cx attributes */}
            <motion.line
              animate={{ x1: pt.x, x2: pt.x, y1: pt.y + 10, y2: VH - PY }}
              transition={{ type: 'spring', stiffness: 38, damping: 14, mass: 2.2 }}
              stroke="rgba(74,222,128,0.18)" strokeWidth="1" strokeDasharray="5 4"
            />

            {/* Active point rings */}
            <motion.circle animate={{ cx: pt.x, cy: pt.y }} transition={{ type: 'spring', ...SP }}
              r={20} fill="rgba(74,222,128,0.04)" stroke="rgba(74,222,128,0.1)" strokeWidth="1" />
            <motion.circle animate={{ cx: pt.x, cy: pt.y }} transition={{ type: 'spring', ...SP }}
              r={11} fill="rgba(74,222,128,0.1)" stroke="rgba(74,222,128,0.3)" strokeWidth="1.5" />
            <motion.circle animate={{ cx: pt.x, cy: pt.y }} transition={{ type: 'spring', ...SP }}
              r={5} fill="#4ade80" filter="url(#eg-glow)" />
          </svg>

          {/* ── HTML tooltip overlay (fixes SVG transform bug) ── */}
          <motion.div
            className="absolute pointer-events-none -translate-x-1/2"
            style={{ left: tooltipLeft, top: tooltipTop, zIndex: 10 }}
          >
            <div
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap"
              style={{
                background: 'rgba(8,14,8,0.92)',
                border: '1px solid rgba(74,222,128,0.4)',
                color: '#4ade80',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
              }}
            >
              {currency}{(cur.earnings / 1000).toFixed(1)}k/mo
            </div>
            {/* stem */}
            <div className="w-px h-2 mx-auto" style={{ background: 'rgba(74,222,128,0.35)' }} />
          </motion.div>
        </div>

        {/* ── Month pills ──────────────────────────────── */}
        <div className="flex justify-between px-4 pb-4 pt-1">
          {E_DATA.map(d => (
            <button
              key={d.month}
              onClick={() => { setHasInteracted(true); setSelected(d.month); }}
              className="flex flex-col items-center gap-1.5 cursor-pointer"
              data-testid={`month-${d.month}`}
            >
              <motion.div
                animate={{
                  width:        d.month === selected ? 22 : 6,
                  height:       6,
                  borderRadius: d.month === selected ? 3 : 99,
                  background:   d.month === selected ? '#4ade80' : 'rgba(255,255,255,0.1)',
                }}
                transition={{ type: 'spring', stiffness: 110, damping: 20, mass: 1.4 }}
              />
              <motion.span
                animate={{ color: d.month === selected ? '#4ade80' : 'rgba(255,255,255,0.25)' }}
                transition={{ duration: 0.6, ease: 'easeInOut' }}
                className="text-[10px] font-semibold tabular-nums"
              >
                M{d.month}
              </motion.span>
            </button>
          ))}
        </div>
      </div>

      <p className="text-center text-[10px] mt-2" style={{ color: 'rgba(255,255,255,0.2)' }}>
        {copy.earningsChartHint}
      </p>
    </div>
  );
}

const ashleyRooftop = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/ashleyRooftop.jpg';
const ashleyBeachSunset = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/ashleyBeachSunset.jpg';
const ashleyCafe = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/ashleyCafe.jpg';
const ashleyBeachWalk = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/ashleyBeachWalk.jpg';
const ashleyPinkHair = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/ashleyPinkHair.jpg';
const ashleyCity = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/ashleyCity.jpg';
const ashleyBeachBikini = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/ashleyBeachBikini.jpg';
const ashleyGlamDress = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/ashleyGlamDress.jpg';
const ashleyFitness = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/ashleyFitness.jpg';

const lauraBeach1 = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/lauraBeach1.jpg';
const lauraBeach2 = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/lauraBeach2.jpg';
const lauraBed = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/lauraBed.jpg';
const lauraPool = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/lauraPool.jpg';
const lauraBeach3 = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/lauraBeach3.jpg';
const lauraLibrary = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/lauraLibrary.jpg';
const lauraBedNight = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/lauraBedNight.jpg';
const lauraCafe = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/lauraCafe.jpg';
const lauraHome = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/lauraHome.jpg';

const natashaPark = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/natashaPark.jpg';
const natashaCar1 = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/natashaCar1.jpg';
const natashaYoga1 = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/natashaYoga1.jpg';
const natashaYoga2 = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/natashaYoga2.jpg';
const natashaStreet = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/natashaStreet.jpg';
const natashaCar2 = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/natashaCar2.jpg';
const natashaYoga3 = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/natashaYoga3.jpg';
const natashaYoga4 = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/natashaYoga4.jpg';
const natashaMirror = 'https://pub-deb24e74d34c49a3a2e474e11dbf5a64.r2.dev/gallery/natashaMirror.jpg';

export default function CreateAIModelLandingPage() {
  const [locale] = useState(resolveLocale);
  const copy = COPY[locale] || COPY.en;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [landerDemoVideoUrl, setLanderDemoVideoUrl] = useState('');
  const location = useLocation();

  useEffect(() => {
    fetch('/api/brand', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.branding?.landerDemoVideoUrl) setLanderDemoVideoUrl(d.branding.landerDemoVideoUrl);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ref = params.get("ref")?.trim().toLowerCase();
    if (!ref) return;

    try {
      localStorage.setItem("pendingReferralCode", ref);
    } catch {
      // Ignore local storage failures
    }

    (async () => {
      try {
        const fp = await generateFingerprint();
        await referralAPI.captureHint(
          ref,
          fp?.visitorId || "no-fingerprint-available",
          navigator.userAgent || "Unknown",
        );
      } catch {
        // Best-effort capture; do not block page.
      }
    })();
  }, [location.search]);

  const socialProofMessages = useMemo(() => [
    { name: 'Sarah', city: 'Miami', flag: '🇺🇸', action: copy.socialProofActionStartedMoney, time: copy.socialProofTime2Seconds },
    { name: 'Jake', city: 'Los Angeles', flag: '🇺🇸', action: copy.socialProofActionEarned950Week, time: copy.socialProofTime15Seconds },
    { name: 'Emily', city: 'New York', flag: '🇺🇸', action: copy.socialProofActionCreatedFirstInfluencer, time: copy.socialProofTime30Seconds },
    { name: 'Mike', city: 'Austin', flag: '🇺🇸', action: copy.socialProofActionJustSignedUp, time: copy.socialProofTime45Seconds },
    { name: 'Jessica', city: 'Chicago', flag: '🇺🇸', action: copy.socialProofActionFirst10Subscribers, time: copy.socialProofTime1Minute },
    { name: 'David', city: 'Denver', flag: '🇺🇸', action: copy.socialProofActionEarned1400TwoWeeks, time: copy.socialProofTime2Minutes },
    { name: 'Ashley', city: 'Seattle', flag: '🇺🇸', action: copy.socialProofActionStartedMoney, time: copy.socialProofTime3Minutes },
    { name: 'Chris', city: 'Phoenix', flag: '🇺🇸', action: copy.socialProofActionEarned2800Month, time: copy.socialProofTime5Minutes },
    { name: 'Brittany', city: 'San Diego', flag: '🇺🇸', action: copy.socialProofActionJustVerified, time: copy.socialProofTime6Minutes },
    { name: 'Tyler', city: 'Nashville', flag: '🇺🇸', action: copy.socialProofActionEarned720FirstWeek, time: copy.socialProofTime7Minutes },
    { name: 'Amanda', city: 'Portland', flag: '🇺🇸', action: copy.socialProofActionCreated3Influencers, time: copy.socialProofTime8Minutes },
    { name: 'Brandon', city: 'Atlanta', flag: '🇺🇸', action: copy.socialProofActionJustSignedUp, time: copy.socialProofTime9Minutes },
    { name: 'Nicole', city: 'Boston', flag: '🇺🇸', action: copy.socialProofActionEarned1850Week, time: copy.socialProofTime10Minutes },
    { name: 'Justin', city: 'Las Vegas', flag: '🇺🇸', action: copy.socialProofAction50SubscribersToday, time: copy.socialProofTime11Minutes },
    { name: 'Samantha', city: 'San Francisco', flag: '🇺🇸', action: copy.socialProofActionStartedMoney, time: copy.socialProofTime12Minutes },
    { name: 'Ryan', city: 'Dallas', flag: '🇺🇸', action: copy.socialProofActionEarned3200Month, time: copy.socialProofTime13Minutes },
  ], [copy]);

  const testimonials = useMemo(() => [
    { name: 'James', earnings: '$2,800/mo', text: copy.testimonial1 },
    { name: 'Michael', earnings: '$2,100/mo', text: copy.testimonial2 },
    { name: 'David', earnings: '$3,500/mo', text: copy.testimonial3 },
    { name: 'Chris', earnings: '$1,100/mo', text: copy.testimonial4 },
    { name: 'Alex', earnings: '$2,400/mo', text: copy.testimonial5 },
    { name: 'Ryan', earnings: '$1,700/mo', text: copy.testimonial6 },
    { name: 'Jake', earnings: '$4,600/mo', text: copy.testimonial7 },
    { name: 'Tyler', earnings: '$1,300/mo', text: copy.testimonial8 },
  ], [copy]);

  return (
    <div className="min-h-screen bg-black text-white" data-testid="page-create-ai-model">
      <CursorGlow />
      {/* Navigation - Minimal */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-black/90 backdrop-blur-lg border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            <Link to="/" className="flex items-center gap-2" data-testid="link-home">
              <img src="/logo-512.png" alt="ModelClone" className="w-7 h-7 rounded-lg object-cover" />
              <span className="text-lg font-bold">ModelClone</span>
            </Link>
            
            <div className="hidden md:flex items-center gap-3">
              <Link 
                to="/login" 
                className="text-slate-400 hover:text-white transition-colors px-4 py-2 text-sm"
                data-testid="link-login-nav"
              >
                {copy.navLogin}
              </Link>
              <Link 
                to="/signup" 
                className="relative px-5 py-2 rounded-full font-semibold text-sm text-black bg-white hover:bg-slate-100 transition-all overflow-hidden"
                style={{ boxShadow: '0 0 16px 3px rgba(139,92,246,0.3), inset 0 1px 0 rgba(255,255,255,0.8)' }}
                data-testid="link-signup-nav"
              >
                <span className="pointer-events-none absolute top-0 left-0 w-10 h-10 rounded-full bg-purple-400/30 blur-xl -translate-x-3 -translate-y-3" />
                <span className="relative z-10">{copy.navStartFree}</span>
              </Link>
            </div>

            <button 
              className="md:hidden p-2"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              data-testid="button-mobile-menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="md:hidden bg-black/95 border-b border-white/10 px-4 py-4"
          >
            <div className="flex flex-col gap-3">
              <Link 
                to="/login" 
                className="text-gray-400 hover:text-white transition-colors py-2 text-center"
                data-testid="link-login-mobile"
              >
                {copy.navLogin}
              </Link>
              <Link 
                to="/signup" 
                className="relative px-6 py-3 rounded-full font-semibold text-center text-black bg-white overflow-hidden"
                style={{ boxShadow: '0 0 16px 3px rgba(139,92,246,0.3)' }}
                data-testid="link-signup-mobile"
              >
                <span className="pointer-events-none absolute top-0 left-0 w-10 h-10 rounded-full bg-purple-400/30 blur-xl -translate-x-3 -translate-y-3" />
                <span className="relative z-10">{copy.navStartFree}</span>
              </Link>
            </div>
          </motion.div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="pt-20 pb-6 px-4 relative">
        {/* ambient glow */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] rounded-full bg-purple-600/[0.12] blur-[120px]" />
        </div>
        <div className="max-w-lg mx-auto relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center"
          >
            {/* Social Proof Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/[0.07] text-xs mb-4" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div className="flex -space-x-1.5">
                <div className="w-4 h-4 rounded-full bg-white/20 border border-white/10" />
                <div className="w-4 h-4 rounded-full bg-white/15 border border-white/10" />
                <div className="w-4 h-4 rounded-full bg-white/10 border border-white/10" />
              </div>
              <span className="text-slate-400"><strong className="text-white">2,847</strong> {copy.badgeJoinedWeek}</span>
            </div>

            {/* Main Headline */}
            <h1 className="text-3xl sm:text-4xl font-bold mb-3 leading-tight tracking-tight">
              {copy.heroTitle}
              <span className="block text-slate-300 font-semibold text-2xl sm:text-3xl mt-1">
                {copy.heroSubtitle}
              </span>
            </h1>

            <p className="text-slate-500 text-sm mb-6 max-w-xs mx-auto leading-relaxed">
              {copy.heroDescription}{' '}
              <span className="text-slate-300">{copy.heroDescriptionHighlight}</span>
            </p>

            {/* CTA Button */}
            <Link
              to="/signup"
              className="relative inline-flex items-center justify-center gap-2 w-full max-w-xs px-6 py-4 rounded-2xl font-bold text-base text-black bg-white hover:bg-slate-100 transition-all active:scale-[0.98] overflow-hidden"
              style={{ boxShadow: '0 0 28px 6px rgba(139,92,246,0.28), inset 0 1px 0 rgba(255,255,255,0.9)' }}
              data-testid="button-hero-signup"
            >
              <span className="pointer-events-none absolute top-0 left-0 w-16 h-16 rounded-full bg-purple-400/30 blur-xl -translate-x-5 -translate-y-5" />
              <span className="relative z-10">{copy.navStartFree}</span>
              <ArrowRight className="w-4 h-4 relative z-10" />
            </Link>

            {/* Trust Row */}
            <div className="flex items-center justify-center gap-5 mt-4 text-xs text-slate-600">
              <span className="flex items-center gap-1.5">
                <Check className="w-3 h-3 text-white/30" strokeWidth={1.25} aria-hidden />
                {copy.trustNoCard}
              </span>
              <span className="flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-white/30" strokeWidth={1.25} aria-hidden />
                {copy.trustReady60s}
              </span>
            </div>
          </motion.div>

          {/* Demo Video (URL from Admin → Brand Settings → Create AI Model lander demo) */}
          <DemoVideo videoUrl={landerDemoVideoUrl} />
        </div>
      </section>

      {/* Earnings Growth Slider */}
      <section className="py-10 px-5">
        <div className="max-w-xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="text-center mb-5">
              <p className="text-[9px] font-semibold uppercase tracking-[0.2em] mb-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
                {copy.realResultsLabel}
              </p>
              <h2 className="text-xl font-bold text-white">{copy.realResultsTitle}</h2>
            </div>
            <EarningsGrowthSlider currency="$" copy={copy} />
          </motion.div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="py-6 px-4 border-y border-white/[0.06]" style={{ background: 'rgba(255,255,255,0.02)' }}>
        <div className="max-w-lg mx-auto">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-xl font-bold text-white">
                <AnimatedCounter end={2500} suffix="+" />
              </div>
              <p className="text-slate-600 text-[10px] mt-0.5">{copy.statsModelsCreated}</p>
            </div>
            <div>
              <div className="text-xl font-bold text-white">
                <AnimatedCounter end={50} suffix="K+" />
              </div>
              <p className="text-slate-600 text-[10px] mt-0.5">{copy.statsImagesMade}</p>
            </div>
            <div>
              <div className="text-xl font-bold text-white">
                <AnimatedCounter end={99} suffix="%" />
              </div>
              <p className="text-slate-600 text-[10px] mt-0.5">{copy.statsSatisfaction}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Gallery - Ashley */}
      <section className="py-8 px-4 overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-5">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">{copy.galleryLabel}</p>
            <h2 className="text-2xl font-bold tracking-tight">{copy.galleryMeetAshley}</h2>
            <p className="text-slate-600 text-sm mt-1">{copy.galleryAshleyCaption}</p>
          </div>

          <div className="relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-black to-transparent z-10 pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-black to-transparent z-10 pointer-events-none" />
            
            <div className="flex animate-scroll-infinite">
              {[
                { src: ashleyRooftop, alt: 'Ashley rooftop' },
                { src: ashleyBeachSunset, alt: 'Ashley beach' },
                { src: ashleyCafe, alt: 'Ashley cafe' },
                { src: ashleyBeachWalk, alt: 'Ashley walking' },
                { src: ashleyPinkHair, alt: 'Ashley pink hair' },
                { src: ashleyCity, alt: 'Ashley city' },
                { src: ashleyBeachBikini, alt: 'Ashley bikini' },
                { src: ashleyGlamDress, alt: 'Ashley dress' },
                { src: ashleyFitness, alt: 'Ashley fitness' },
              ].map((image, index) => (
                <div key={`first-${index}`} className="flex-shrink-0 px-1.5">
                  <div className="w-[140px] sm:w-[200px] aspect-[3/4] rounded-xl overflow-hidden">
                    <OptimizedGalleryImage 
                      src={image.src} 
                      alt={image.alt}
                      className="w-full h-full object-cover"
                      testId={`ashley-image-${index}`}
                    />
                  </div>
                </div>
              ))}
              {[
                { src: ashleyRooftop, alt: 'Ashley rooftop' },
                { src: ashleyBeachSunset, alt: 'Ashley beach' },
                { src: ashleyCafe, alt: 'Ashley cafe' },
                { src: ashleyBeachWalk, alt: 'Ashley walking' },
                { src: ashleyPinkHair, alt: 'Ashley pink hair' },
                { src: ashleyCity, alt: 'Ashley city' },
                { src: ashleyBeachBikini, alt: 'Ashley bikini' },
                { src: ashleyGlamDress, alt: 'Ashley dress' },
                { src: ashleyFitness, alt: 'Ashley fitness' },
              ].map((image, index) => (
                <div key={`second-${index}`} className="flex-shrink-0 px-1.5">
                  <div className="w-[140px] sm:w-[200px] aspect-[3/4] rounded-xl overflow-hidden">
                    <OptimizedGalleryImage 
                      src={image.src} 
                      alt={image.alt}
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Gallery - Laura */}
      <section className="py-6 overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-5 px-4">
            <h2 className="text-2xl font-bold tracking-tight">{copy.galleryMeetLaura}</h2>
          </div>

          <div className="relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-black to-transparent z-10 pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-black to-transparent z-10 pointer-events-none" />
            
            <div className="flex animate-scroll-infinite-reverse">
              {[
                { src: lauraBeach1, alt: 'Laura beach' },
                { src: lauraBeach2, alt: 'Laura sunset' },
                { src: lauraBed, alt: 'Laura selfie' },
                { src: lauraPool, alt: 'Laura pool' },
                { src: lauraBeach3, alt: 'Laura smile' },
                { src: lauraLibrary, alt: 'Laura reading' },
                { src: lauraBedNight, alt: 'Laura evening' },
                { src: lauraCafe, alt: 'Laura cafe' },
                { src: lauraHome, alt: 'Laura home' },
              ].map((image, index) => (
                <div key={`laura-first-${index}`} className="flex-shrink-0 px-1.5">
                  <div className="w-[140px] sm:w-[200px] aspect-[3/4] rounded-xl overflow-hidden">
                    <OptimizedGalleryImage 
                      src={image.src} 
                      alt={image.alt}
                      className="w-full h-full object-cover"
                      testId={`laura-image-${index}`}
                    />
                  </div>
                </div>
              ))}
              {[
                { src: lauraBeach1, alt: 'Laura beach' },
                { src: lauraBeach2, alt: 'Laura sunset' },
                { src: lauraBed, alt: 'Laura selfie' },
                { src: lauraPool, alt: 'Laura pool' },
                { src: lauraBeach3, alt: 'Laura smile' },
                { src: lauraLibrary, alt: 'Laura reading' },
                { src: lauraBedNight, alt: 'Laura evening' },
                { src: lauraCafe, alt: 'Laura cafe' },
                { src: lauraHome, alt: 'Laura home' },
              ].map((image, index) => (
                <div key={`laura-second-${index}`} className="flex-shrink-0 px-1.5">
                  <div className="w-[140px] sm:w-[200px] aspect-[3/4] rounded-xl overflow-hidden">
                    <OptimizedGalleryImage 
                      src={image.src} 
                      alt={image.alt}
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Gallery - Natasha */}
      <section className="py-6 overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-5 px-4">
            <h2 className="text-2xl font-bold tracking-tight">{copy.galleryMeetNatasha}</h2>
          </div>

          <div className="relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-black to-transparent z-10 pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-black to-transparent z-10 pointer-events-none" />
            
            <div className="flex animate-scroll-infinite">
              {[
                { src: natashaPark, alt: 'Natasha park' },
                { src: natashaCar1, alt: 'Natasha car' },
                { src: natashaYoga1, alt: 'Natasha yoga' },
                { src: natashaYoga2, alt: 'Natasha pose' },
                { src: natashaStreet, alt: 'Natasha street' },
                { src: natashaCar2, alt: 'Natasha driving' },
                { src: natashaYoga3, alt: 'Natasha fitness' },
                { src: natashaYoga4, alt: 'Natasha workout' },
                { src: natashaMirror, alt: 'Natasha mirror' },
              ].map((image, index) => (
                <div key={`natasha-first-${index}`} className="flex-shrink-0 px-1.5">
                  <div className="w-[140px] sm:w-[200px] aspect-[3/4] rounded-xl overflow-hidden">
                    <OptimizedGalleryImage 
                      src={image.src} 
                      alt={image.alt}
                      className="w-full h-full object-cover"
                      testId={`natasha-image-${index}`}
                    />
                  </div>
                </div>
              ))}
              {[
                { src: natashaPark, alt: 'Natasha park' },
                { src: natashaCar1, alt: 'Natasha car' },
                { src: natashaYoga1, alt: 'Natasha yoga' },
                { src: natashaYoga2, alt: 'Natasha pose' },
                { src: natashaStreet, alt: 'Natasha street' },
                { src: natashaCar2, alt: 'Natasha driving' },
                { src: natashaYoga3, alt: 'Natasha fitness' },
                { src: natashaYoga4, alt: 'Natasha workout' },
                { src: natashaMirror, alt: 'Natasha mirror' },
              ].map((image, index) => (
                <div key={`natasha-second-${index}`} className="flex-shrink-0 px-1.5">
                  <div className="w-[140px] sm:w-[200px] aspect-[3/4] rounded-xl overflow-hidden">
                    <OptimizedGalleryImage 
                      src={image.src} 
                      alt={image.alt}
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How It Works - Simple */}
      <section className="py-10 px-4" id="how-it-works">
        <div className="max-w-lg mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold mb-2">{copy.howItWorksTitle}</h2>
            <p className="text-gray-500 text-sm">{copy.howItWorksSubtitle}</p>
          </div>

          <div className="space-y-4">
            {[
              { num: '1', icon: User, title: copy.step1Title, desc: copy.step1Desc },
              { num: '2', icon: Settings, title: copy.step2Title, desc: copy.step2Desc },
              { num: '3', icon: Zap, title: copy.step3Title, desc: copy.step3Desc },
            ].map((step, i) => (
              <motion.div
                key={step.num}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="flex items-center gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/5"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-lg font-bold text-purple-400">{step.num}</span>
                </div>
                <div>
                  <h3 className="font-semibold text-white">{step.title}</h3>
                  <p className="text-gray-500 text-sm">{step.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Why AI Models - Benefits */}
      <section className="py-10 px-4">
        <div className="max-w-lg mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold mb-2">{copy.whyTitle}</h2>
            <p className="text-gray-500 text-sm">{copy.whySubtitle}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: Zap, title: copy.benefit1Title, desc: copy.benefit1Desc },
              { icon: Clock, title: copy.benefit2Title, desc: copy.benefit2Desc },
              { icon: Shield, title: copy.benefit3Title, desc: copy.benefit3Desc },
              { icon: Palette, title: copy.benefit4Title, desc: copy.benefit4Desc },
            ].map((benefit, i) => (
              <motion.div
                key={benefit.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
                className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] text-center"
              >
                <span className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03]">
                  <benefit.icon className="w-[18px] h-[18px] text-white/40" strokeWidth={1.25} aria-hidden />
                </span>
                <h3 className="font-semibold text-sm mb-1">{benefit.title}</h3>
                <p className="text-gray-500 text-xs">{benefit.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-10 px-4 overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-6">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">{copy.successStoriesLabel}</p>
            <h2 className="text-2xl font-bold tracking-tight">{copy.successStoriesTitle}</h2>
          </div>

          <div className="relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-black to-transparent z-10 pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-black to-transparent z-10 pointer-events-none" />
            
            <div className="flex animate-scroll-infinite-reverse">
              {testimonials.map((t, i) => (
                <div key={`t1-${i}`} className="flex-shrink-0 px-2">
                  <div className="w-[260px] bg-white/[0.03] border border-white/5 rounded-2xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white text-sm font-bold">
                        {t.name[0]}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{t.name}</p>
                        <p className="text-green-400 text-xs font-medium">{t.earnings}</p>
                      </div>
                    </div>
                    <p className="text-gray-400 text-xs leading-relaxed">"{t.text}"</p>
                  </div>
                </div>
              ))}
              {testimonials.map((t, i) => (
                <div key={`t2-${i}`} className="flex-shrink-0 px-2">
                  <div className="w-[260px] bg-white/[0.03] border border-white/5 rounded-2xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white text-sm font-bold">
                        {t.name[0]}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{t.name}</p>
                        <p className="text-green-400 text-xs font-medium">{t.earnings}</p>
                      </div>
                    </div>
                    <p className="text-gray-400 text-xs leading-relaxed">"{t.text}"</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Discord CTA */}
      <section className="py-8 px-4">
        <div className="max-w-lg mx-auto">
          <div className="glass-panel-strong rounded-2xl p-5 text-center relative overflow-hidden">
            <span className="pointer-events-none absolute top-0 left-0 w-24 h-24 rounded-full bg-indigo-500/10 blur-2xl -translate-x-6 -translate-y-6" />
            <div className="relative">
              <div className="w-10 h-10 rounded-xl border border-white/[0.08] flex items-center justify-center mx-auto mb-3" style={{ background: 'rgba(88,101,242,0.12)' }}>
                <SiDiscord className="w-5 h-5 text-[#7289da]" />
              </div>
              <h3 className="font-bold text-base mb-1 tracking-tight">{copy.discordTitle}</h3>
              <p className="text-slate-500 text-sm mb-4">{copy.discordSubtitle}</p>
              <a
                href="https://discord.gg/vpwGygjEaB"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm border border-white/[0.07] hover:bg-white/[0.06] transition-all"
                style={{ background: 'rgba(255,255,255,0.04)' }}
                data-testid="button-discord"
              >
                <SiDiscord className="w-4 h-4 text-[#7289da]" />
                {copy.discordButton}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-10 px-4 pb-32 md:pb-10">
        <div className="max-w-lg mx-auto">
          <div className="glass-panel-strong rounded-2xl p-6 text-center relative overflow-hidden">
            {/* top edge gradient line */}
            <div className="pointer-events-none absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            {/* corner glow */}
            <span className="pointer-events-none absolute top-0 left-0 w-32 h-32 rounded-full bg-purple-500/15 blur-3xl -translate-x-8 -translate-y-8" />

            <div className="relative">
              <div className="w-10 h-10 rounded-xl border border-white/10 flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <Zap className="w-5 h-5 text-white" />
              </div>
              <h2 className="text-2xl font-bold mb-2 tracking-tight">{copy.finalCtaTitle}</h2>
              <p className="text-slate-400 text-sm mb-5">{copy.finalCtaSubtitle}</p>

              <Link
                to="/signup"
                className="relative inline-flex items-center justify-center gap-2 w-full px-6 py-4 rounded-xl font-bold text-base text-black bg-white hover:bg-slate-100 transition-all overflow-hidden"
                style={{ boxShadow: '0 0 24px 4px rgba(139,92,246,0.25), inset 0 1px 0 rgba(255,255,255,0.9)' }}
                data-testid="button-cta-signup"
              >
                <span className="pointer-events-none absolute top-0 left-0 w-16 h-16 rounded-full bg-purple-400/30 blur-xl -translate-x-5 -translate-y-5" />
                <span className="relative z-10">{copy.finalCtaPrimary}</span>
                <ArrowRight className="w-4 h-4 relative z-10" />
              </Link>

              <Link
                to="/login"
                className="block text-slate-600 hover:text-slate-300 mt-3 text-sm transition-colors"
                data-testid="button-cta-login"
              >
                {copy.finalCtaSecondary}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-6 px-4 border-t border-white/5">
        <div className="max-w-lg mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-600">
          <div className="flex items-center gap-2">
            <img src="/logo-512.png" alt="ModelClone" className="w-5 h-5 rounded object-cover" />
            <span>ModelClone</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/terms" className="hover:text-white transition-colors" data-testid="link-terms">{copy.footerTerms}</Link>
            <Link to="/privacy" className="hover:text-white transition-colors" data-testid="link-privacy">{copy.footerPrivacy}</Link>
            <Link to="/cookies" className="hover:text-white transition-colors" data-testid="link-cookies">{copy.footerCookies}</Link>
          </div>
        </div>
      </footer>

      {/* Sticky Mobile CTA */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-black/90 backdrop-blur-xl border-t border-white/[0.07] md:hidden z-50">
        <Link
          to="/signup"
          className="relative flex items-center justify-center gap-2 w-full px-6 py-4 rounded-xl font-bold text-base text-black bg-white overflow-hidden"
          style={{ boxShadow: '0 0 20px 4px rgba(139,92,246,0.25)' }}
          data-testid="button-sticky-cta"
        >
          <span className="pointer-events-none absolute top-0 left-0 w-14 h-14 rounded-full bg-purple-400/30 blur-xl -translate-x-4 -translate-y-4" />
          <span className="relative z-10">{copy.navStartFree}</span>
          <ArrowRight className="w-4 h-4 relative z-10" />
        </Link>
      </div>

      {/* Social Proof Popup */}
      <SocialProofPopup messages={socialProofMessages} copy={copy} />
    </div>
  );
}

```

---

