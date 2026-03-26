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
