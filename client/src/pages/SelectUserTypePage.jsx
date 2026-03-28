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
    <div className="min-h-screen text-white flex items-center justify-center px-4 sm:px-6 py-12 overflow-x-hidden relative bg-[var(--mc-page-select)]">
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
          <span className="text-xl font-display tracking-tight">ModelClone</span>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="text-center mb-8"
        >
          <p className="text-[10px] font-medium tracking-[0.26em] uppercase mb-3 text-white/30">
            {copy.hero_welcome}
          </p>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-display font-bold mb-2 tracking-tight text-white">
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
                  className={`relative p-4 sm:p-5 rounded-2xl text-left overflow-hidden origin-center ${isCenter ? 'mc-glass-tab-active' : 'mc-glass-dim'}`}
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
            className="relative rounded-2xl p-5 sm:p-7 mb-6 overflow-hidden mc-card-deep mc-edge-line"
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
            <p className="relative text-sm leading-relaxed mb-6 text-white/60">
              {currentType.description}
            </p>

            <div className="grid grid-cols-3 gap-2.5 mb-6 relative">
              {currentType.stats.map((stat) => (
                <div key={stat.label} className="text-center p-3 rounded-xl mc-glass-card">
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
              className="relative mx-auto block py-3 px-10 rounded-xl font-semibold text-black bg-white hover:bg-slate-50 transition-all flex items-center justify-center gap-2 overflow-hidden mc-cta-primary"
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
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm mc-glass border border-white/10">
            <span className="text-white/70">{copy.already_member}</span>
            <a
              href="/login"
              className="font-semibold transition hover:text-white mc-text-link-soft"
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
