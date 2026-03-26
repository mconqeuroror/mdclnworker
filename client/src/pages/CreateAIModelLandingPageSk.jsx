import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { 
  Zap, Shield, ArrowRight, Check, 
  Clock, Wand2, Image, Video, Palette,
  User, Settings, Menu, X, Play, DollarSign, Star, Users, TrendingUp, Volume2, VolumeX
} from 'lucide-react';
import { SiDiscord } from 'react-icons/si';
import { useState, useEffect, useRef } from 'react';
import OptimizedGalleryImage from '../components/OptimizedGalleryImage';

const socialProofMessages = [
  { name: 'Mária', city: 'Bratislava', flag: '🇸🇰', action: 'práve začala zarábať s AI Influencerkami', time: 'pred 2 sekundami' },
  { name: 'Jakub', city: 'Košice', flag: '🇸🇰', action: 'zarobil €850 tento týždeň', time: 'pred 15 sekundami' },
  { name: 'Lucia', city: 'Žilina', flag: '🇸🇰', action: 'vytvorila svoju prvú AI influencerku', time: 'pred 30 sekundami' },
  { name: 'Peter', city: 'Nitra', flag: '🇸🇰', action: 'práve sa zaregistroval', time: 'pred 45 sekundami' },
  { name: 'Anna', city: 'Trnava', flag: '🇸🇰', action: 'získala prvých 10 odberateľov', time: 'pred 1 minútou' },
  { name: 'Martin', city: 'Prešov', flag: '🇸🇰', action: 'zarobil €1,200 za 2 týždne', time: 'pred 2 minútami' },
  { name: 'Eva', city: 'Banská Bystrica', flag: '🇸🇰', action: 'práve začala zarábať s AI Influencerkami', time: 'pred 3 minútami' },
  { name: 'Tomáš', city: 'Praha', flag: '🇨🇿', action: 'zarobil €2,500 tento mesiac', time: 'pred 5 minútami' },
  { name: 'Katarína', city: 'Trenčín', flag: '🇸🇰', action: 'práve bola overená', time: 'pred 6 minútami' },
  { name: 'Michal', city: 'Poprad', flag: '🇸🇰', action: 'zarobil €720 v prvom týždni', time: 'pred 7 minútami' },
  { name: 'Zuzana', city: 'Martin', flag: '🇸🇰', action: 'vytvorila 3 AI influencerky', time: 'pred 8 minútami' },
  { name: 'Patrik', city: 'Považská Bystrica', flag: '🇸🇰', action: 'práve sa zaregistroval', time: 'pred 9 minútami' },
  { name: 'Simona', city: 'Brno', flag: '🇨🇿', action: 'zarobila €1,850 tento týždeň', time: 'pred 10 minútami' },
  { name: 'Ondrej', city: 'Piešťany', flag: '🇸🇰', action: 'získal 50 nových odberateľov dnes', time: 'pred 11 minútami' },
  { name: 'Lenka', city: 'Ružomberok', flag: '🇸🇰', action: 'práve začala zarábať s AI Influencerkami', time: 'pred 12 minútami' },
  { name: 'Marek', city: 'Dunajská Streda', flag: '🇸🇰', action: 'zarobil €3,200 tento mesiac', time: 'pred 13 minútami' },
];

const avatarGradients = [
  'from-purple-400 to-pink-400',
  'from-cyan-400 to-blue-400',
  'from-yellow-400 to-orange-400',
  'from-green-400 to-emerald-400',
  'from-pink-400 to-rose-400',
  'from-indigo-400 to-purple-400',
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

function SocialProofPopup() {
  const [isVisible, setIsVisible] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Initial delay before first popup
    const initialDelay = setTimeout(() => {
      setIsVisible(true);
    }, 3000);

    return () => clearTimeout(initialDelay);
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    // Show popup for 4 seconds, then hide for 5 seconds
    const hideTimeout = setTimeout(() => {
      setIsExiting(true);
      setTimeout(() => {
        setIsExiting(false);
        setIsVisible(false);
        setCurrentIndex((prev) => (prev + 1) % socialProofMessages.length);
        
        // Show next popup after delay
        setTimeout(() => {
          setIsVisible(true);
        }, 7000);
      }, 300);
    }, 5000);

    return () => clearTimeout(hideTimeout);
  }, [isVisible, currentIndex]);

  const message = socialProofMessages[currentIndex];
  const avatarGradient = avatarGradients[currentIndex % avatarGradients.length];

  if (!isVisible && !isExiting) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, x: -20 }}
      animate={{ opacity: isExiting ? 0 : 1, y: isExiting ? 20 : 0, x: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="fixed bottom-24 md:bottom-6 left-4 z-[60] max-w-[320px]"
    >
      <div className="bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl p-3">
        <div className="flex items-start gap-3">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${avatarGradient} flex items-center justify-center text-white font-bold text-lg`}>
              {message.name.charAt(0)}
            </div>
            <div className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center border-2 border-slate-900">
              <Zap className="w-2.5 h-2.5 text-white" />
            </div>
          </div>
          
          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm leading-snug">
              <span className="font-semibold">{message.name}</span> z {message.flag} {message.city} {message.action}
            </p>
            <div className="flex items-center justify-between mt-2">
              <span className="text-gray-500 text-xs">{message.time}</span>
              <Link 
                to="/signup"
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500 transition-all"
              >
                Začni teraz
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

const earningsDataSk = [
  { month: 1, earnings: 1400, label: 'Mesiac 1' },
  { month: 2, earnings: 4500, label: 'Mesiac 2' },
  { month: 3, earnings: 7500, label: 'Mesiac 3' },
  { month: 4, earnings: 9500, label: 'Mesiac 4' },
  { month: 5, earnings: 11500, label: 'Mesiac 5' },
  { month: 6, earnings: 14000, label: 'Mesiac 6' },
];

function EarningsGrowthSlider({ currency = '€', data = earningsDataSk, slideText = 'Posuň a pozri rast zárobkov' }) {
  const [selectedMonth, setSelectedMonth] = useState(3);
  const maxEarnings = Math.max(...data.map(d => d.earnings));
  
  const chartHeight = 120;
  const chartWidth = 280;
  const padding = 20;
  
  const points = data.map((d, i) => ({
    x: padding + (i * (chartWidth - 2 * padding) / (data.length - 1)),
    y: chartHeight - padding - ((d.earnings / maxEarnings) * (chartHeight - 2 * padding)),
    ...d
  }));
  
  const pathD = points.reduce((acc, point, i) => {
    if (i === 0) return `M ${point.x} ${point.y}`;
    const prev = points[i - 1];
    const cp1x = prev.x + (point.x - prev.x) / 3;
    const cp2x = prev.x + 2 * (point.x - prev.x) / 3;
    return `${acc} C ${cp1x} ${prev.y}, ${cp2x} ${point.y}, ${point.x} ${point.y}`;
  }, '');
  
  const areaD = `${pathD} L ${points[points.length - 1].x} ${chartHeight - padding} L ${padding} ${chartHeight - padding} Z`;

  const currentData = data[selectedMonth - 1];
  const currentPoint = points[selectedMonth - 1];

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="text-center mb-4">
        <p className="text-xs text-gray-500 mb-1">Priemerné zárobky klientov</p>
        <motion.div
          key={currentData.earnings}
          initial={{ scale: 0.9, opacity: 0.5 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-400"
        >
          {currency}{currentData.earnings.toLocaleString()}
          <span className="text-lg text-gray-400">/mes</span>
        </motion.div>
        <motion.p 
          key={currentData.label}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="text-sm text-gray-400 mt-1"
        >
          {currentData.label}
        </motion.p>
      </div>

      <div className="relative bg-white/[0.03] rounded-2xl p-4 border border-white/5">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-auto">
          <defs>
            <linearGradient id="areaGradientSk" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgb(34, 197, 94)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="rgb(34, 197, 94)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="lineGradientSk" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgb(34, 197, 94)" />
              <stop offset="100%" stopColor="rgb(16, 185, 129)" />
            </linearGradient>
            <filter id="glowSk">
              <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
          
          <path d={areaD} fill="url(#areaGradientSk)" />
          <path d={pathD} fill="none" stroke="url(#lineGradientSk)" strokeWidth="2.5" strokeLinecap="round" />
          
          {points.map((point, i) => (
            <motion.circle
              key={i}
              cx={point.x}
              cy={point.y}
              animate={{
                r: i === selectedMonth - 1 ? 6 : 3,
                fill: i === selectedMonth - 1 ? '#22c55e' : '#4b5563'
              }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          ))}
          
          <motion.circle
            animate={{ cx: currentPoint.x, cy: currentPoint.y }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            r="12"
            fill="transparent"
            stroke="#22c55e"
            strokeWidth="2"
            strokeOpacity="0.5"
            filter="url(#glowSk)"
          />
          <motion.circle
            animate={{ cx: currentPoint.x, cy: currentPoint.y }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            r="8"
            fill="#22c55e"
            fillOpacity="0.2"
          />
        </svg>

        <div className="mt-4 px-2">
          <input
            type="range"
            min="1"
            max="6"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
            className="w-full h-3 bg-gray-800 rounded-full appearance-none cursor-pointer smooth-slider"
            style={{ '--value-percent': `${((selectedMonth - 1) / 5) * 100}%` }}
            data-testid="earnings-slider"
          />
          <div className="flex justify-between mt-2 text-[10px] text-gray-500">
            {data.map((d) => (
              <motion.span 
                key={d.month} 
                animate={{ 
                  color: d.month === selectedMonth ? '#4ade80' : '#6b7280',
                  scale: d.month === selectedMonth ? 1.1 : 1
                }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className="font-medium"
              >
                M{d.month}
              </motion.span>
            ))}
          </div>
        </div>
      </div>
      
      <p className="text-center text-[10px] text-gray-600 mt-3">
        {slideText}
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

export default function CreateAIModelLandingPageSk() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [landerDemoVideoUrl, setLanderDemoVideoUrl] = useState('');

  useEffect(() => {
    fetch('/api/brand', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.branding?.landerDemoVideoUrl) setLanderDemoVideoUrl(d.branding.landerDemoVideoUrl);
      })
      .catch(() => {});
  }, []);

  const testimonials = [
    { name: 'Jakub', earnings: '€2,500/mes', text: 'Vytvoril som AI influencerku za 5 minút. Teraz zarábam pasívne počas spánku.' },
    { name: 'Michal', earnings: '€1,900/mes', text: 'Discord komunita ma naučila všetko zadarmo. Zmena hry!' },
    { name: 'Dávid', earnings: '€3,200/mes', text: 'Najlepšia investícia môjho času. AI vyzerá super realisticky.' },
    { name: 'Kristián', earnings: '€1,000/mes', text: 'Začal som pred mesiacom, už mám platiacich odberateľov.' },
    { name: 'Alex', earnings: '€2,200/mes', text: 'Nepotrebuješ žiadne technické zručnosti. Platforma robí všetko.' },
    { name: 'Roman', earnings: '€1,500/mes', text: 'ModelClone + Discord = perfektná kombinácia pre začiatočníkov.' },
    { name: 'Jozef', earnings: '€4,200/mes', text: 'Mám 3 AI influencerky. Každá zarába nezávisle.' },
    { name: 'Tomáš', earnings: '€1,200/mes', text: 'Najprv som bol skeptický, ale výsledky hovoria za všetko.' },
  ];

  return (
    <div className="min-h-screen bg-black text-white" data-testid="page-create-ai-model-sk">
      <Helmet>
        <title>Vytvor si AI Influencerku Zadarmo | ModelClone</title>
        <meta name="description" content="Vytvor si svoju AI influencerku za 60 sekúnd. 100% zadarmo na začiatok. Zarábaj €10,000+ mesačne s AI obsahom." />
      </Helmet>

      <style>{`
        .smooth-slider {
          -webkit-appearance: none;
          background: linear-gradient(to right, #22c55e 0%, #22c55e var(--value-percent, 50%), #374151 var(--value-percent, 50%), #374151 100%);
          transition: background 0.15s ease;
        }
        .smooth-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: linear-gradient(135deg, #22c55e, #10b981);
          cursor: pointer;
          transition: transform 0.15s ease;
        }
        .smooth-slider::-webkit-slider-thumb:hover {
          transform: scale(1.1);
        }
        .smooth-slider::-webkit-slider-thumb:active {
          transform: scale(0.95);
        }
        .smooth-slider::-moz-range-thumb {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: linear-gradient(135deg, #22c55e, #10b981);
          cursor: pointer;
          border: none;
          transition: transform 0.15s ease;
        }
        .smooth-slider::-moz-range-thumb:hover {
          transform: scale(1.1);
        }
        .smooth-slider::-moz-range-track {
          background: transparent;
        }
      `}</style>

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
                className="text-gray-400 hover:text-white transition-colors px-4 py-2 text-sm"
                data-testid="link-login-nav"
              >
                Prihlásenie
              </Link>
              <Link 
                to="/signup" 
                className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 px-5 py-2 rounded-full font-semibold text-sm transition-all"
                data-testid="link-signup-nav"
              >
                Začni Zadarmo
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
                Prihlásenie
              </Link>
              <Link 
                to="/signup" 
                className="bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-3 rounded-full font-semibold text-center"
                data-testid="link-signup-mobile"
              >
                Začni Zadarmo
              </Link>
            </div>
          </motion.div>
        )}
      </nav>

      {/* Hero Section - Mobile First */}
      <section className="pt-20 pb-6 px-4">
        <div className="max-w-lg mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center"
          >
            {/* Social Proof Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs mb-4">
              <div className="flex -space-x-1.5">
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 border-2 border-black" />
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-cyan-400 to-blue-400 border-2 border-black" />
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-yellow-400 to-orange-400 border-2 border-black" />
              </div>
              <span className="text-gray-300"><strong className="text-white">2,847</strong> sa pridalo tento týždeň</span>
            </div>
            
            {/* Main Headline */}
            <h1 className="text-3xl sm:text-4xl font-bold mb-3 leading-tight">
              Vytvor si AI Influencerku
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-400">
                Zarábaj €10K+ Mesačne
              </span>
            </h1>
            
            <p className="text-gray-400 text-sm mb-5 max-w-xs mx-auto">
              Navrhni si dokonalú AI influencerku za 60 sekúnd. 
              <span className="text-white"> 100% zadarmo na začiatok.</span>
            </p>

            {/* CTA Button */}
            <Link 
              to="/signup"
              className="inline-flex items-center justify-center gap-2 w-full max-w-xs bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 px-6 py-4 rounded-2xl font-bold text-lg transition-all active:scale-[0.98]"
              data-testid="button-hero-signup"
            >
              Začni Zadarmo
              <ArrowRight className="w-5 h-5" />
            </Link>

            {/* Trust Row */}
            <div className="flex items-center justify-center gap-4 mt-4 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <Check className="w-3.5 h-3.5 text-green-500" />
                Bez karty
              </span>
              <span className="flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-yellow-500" />
                Hotové za 60s
              </span>
            </div>
          </motion.div>

          {/* Demo Video */}
          <DemoVideo />
        </div>
      </section>

      {/* Earnings Growth Slider */}
      <section className="py-8 px-4">
        <div className="max-w-lg mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="text-center mb-4">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-medium mb-2">
                <TrendingUp className="w-3 h-3" />
                Reálne Výsledky
              </div>
            </div>
            <EarningsGrowthSlider 
              currency="€" 
              data={earningsDataSk}
              slideText="Posuň a pozri rast zárobkov"
            />
          </motion.div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="py-6 px-4 border-y border-white/5 bg-white/[0.02]">
        <div className="max-w-lg mx-auto">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
                <AnimatedCounter end={2500} suffix="+" />
              </div>
              <p className="text-gray-500 text-[10px]">Influenceriek</p>
            </div>
            <div>
              <div className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
                <AnimatedCounter end={50} suffix="K+" />
              </div>
              <p className="text-gray-500 text-[10px]">Fotiek</p>
            </div>
            <div>
              <div className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
                <AnimatedCounter end={99} suffix="%" />
              </div>
              <p className="text-gray-500 text-[10px]">Spokojnosť tvorcov</p>
            </div>
          </div>
        </div>
      </section>

      {/* Gallery - Ashley */}
      <section className="py-8 px-4 overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-5">
            <p className="text-xs text-purple-400 font-medium mb-1">AI-GENEROVANÉ</p>
            <h2 className="text-2xl font-bold">
              Zoznám sa s <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">Ashley</span>
            </h2>
            <p className="text-gray-500 text-sm mt-1">Každá fotka vytvorená cez ModelClone</p>
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
            <h2 className="text-2xl font-bold">
              Zoznám sa s <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400">Laurou</span>
            </h2>
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
            <h2 className="text-2xl font-bold">
              Zoznám sa s <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-400">Natašou</span>
            </h2>
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
            <h2 className="text-2xl font-bold mb-2">Ako to funguje</h2>
            <p className="text-gray-500 text-sm">3 jednoduché kroky, žiadne zručnosti</p>
          </div>

          <div className="space-y-4">
            {[
              { num: '1', icon: User, title: 'Vyber meno', desc: 'Daj AI unikátnu identitu' },
              { num: '2', icon: Settings, title: 'Nastav vlastnosti', desc: 'Vek, vlasy, oči, postava' },
              { num: '3', icon: Zap, title: 'Generuj', desc: 'Klikni a AI je hotové' },
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
      <section className="py-10 px-4 bg-gradient-to-b from-transparent to-purple-950/10">
        <div className="max-w-lg mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold mb-2">Prečo AI Influencerky?</h2>
            <p className="text-gray-500 text-sm">Chytrejší spôsob tvorby obsahu</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: Zap, title: '100% Zisky', desc: 'Všetko čo zarobíš je tvoje' },
              { icon: Clock, title: 'Pracuje 24/7', desc: 'Obsah počas spánku' },
              { icon: Shield, title: 'Žiadna Dráma', desc: 'Vždy spoľahlivé, vždy pripravené' },
              { icon: Palette, title: 'Neobmedzene', desc: 'Generuj koľko len chceš' },
            ].map((benefit, i) => (
              <motion.div
                key={benefit.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
                className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 text-center"
              >
                <benefit.icon className="w-6 h-6 text-purple-400 mx-auto mb-2" />
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
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-medium mb-2">
              <DollarSign className="w-3 h-3" />
              Úspešné Príbehy
            </div>
            <h2 className="text-2xl font-bold">Reálne Zárobky</h2>
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
          <div className="bg-[#5865F2]/10 border border-[#5865F2]/30 rounded-2xl p-5 text-center">
            <SiDiscord className="w-8 h-8 text-[#5865F2] mx-auto mb-3" />
            <h3 className="font-bold text-lg mb-1">Bezplatné Školenie</h3>
            <p className="text-gray-400 text-sm mb-4">Pridaj sa k 2,000+ tvorcom, ktorí sa učia zarábať s AI</p>
            <a
              href="https://discord.gg/vpwGygjEaB"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 bg-[#5865F2] hover:bg-[#4752C4] px-6 py-3 rounded-xl font-semibold transition-all"
              data-testid="button-discord"
            >
              <SiDiscord className="w-4 h-4" />
              Pridaj sa Zadarmo
            </a>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-10 px-4 pb-32 md:pb-10">
        <div className="max-w-lg mx-auto">
          <div className="bg-gradient-to-br from-purple-900/30 to-pink-900/30 border border-purple-500/20 rounded-2xl p-6 text-center">
            <Zap className="w-10 h-10 text-purple-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Pripravený začať?</h2>
            <p className="text-gray-400 text-sm mb-5">Vytvor si prvú AI influencerku za menej ako 60 sekúnd</p>
            
            <Link 
              to="/signup"
              className="inline-flex items-center justify-center gap-2 w-full bg-white text-black hover:bg-gray-100 px-6 py-4 rounded-xl font-bold text-lg transition-all"
              data-testid="button-cta-signup"
            >
              Vytvor si AI Influencerku Zadarmo
              <ArrowRight className="w-5 h-5" />
            </Link>
            
            <Link 
              to="/login"
              className="block text-gray-500 hover:text-white mt-3 text-sm transition-colors"
              data-testid="button-cta-login"
            >
              Už máš účet? Prihlásiť sa
            </Link>
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
            <Link to="/terms" className="hover:text-white transition-colors" data-testid="link-terms">Podmienky</Link>
            <Link to="/privacy" className="hover:text-white transition-colors" data-testid="link-privacy">Súkromie</Link>
            <Link to="/cookies" className="hover:text-white transition-colors" data-testid="link-cookies">Cookies</Link>
          </div>
        </div>
      </footer>

      {/* Sticky Mobile CTA */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-black/95 backdrop-blur-lg border-t border-white/10 md:hidden z-50">
        <Link 
          to="/signup"
          className="flex items-center justify-center gap-2 w-full bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-4 rounded-xl font-bold text-lg"
          data-testid="button-sticky-cta"
        >
          Začni Zadarmo
          <ArrowRight className="w-5 h-5" />
        </Link>
      </div>

      {/* Social Proof Popup */}
      <SocialProofPopup />
    </div>
  );
}
