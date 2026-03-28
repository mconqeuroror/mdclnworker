import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import LegalMarkdownProse from '../components/LegalMarkdownProse';
import { brandingAPI } from '../services/api';

const LOCALE_STORAGE_KEY = 'app_locale';

const COPY = {
  en: {
    backDashboard: 'Back to Dashboard',
    title: 'Cookie Policy',
    lastUpdated: 'Last updated: October 26, 2025',
    section1Title: '1. What Are Cookies',
    section1Body:
      'Cookies are small text files stored on your device when you visit our website. They help us provide you with a better experience.',
    section2Title: '2. How We Use Cookies',
    section2Sub1Title: 'Essential Cookies',
    section2Sub1Intro: 'Required for the service to function:',
    section2Sub1Item1: 'auth-storage:',
    section2Sub1Item1Tail: 'Keeps you logged in',
    section2Sub1Item2: 'session:',
    section2Sub1Item2Tail: 'Maintains your session',
    section2Sub2Title: 'Analytics Cookies',
    section2Sub2Intro: 'Help us understand how you use our service (optional):',
    section2Sub2Item1: 'Page views and navigation',
    section2Sub2Item2: 'Feature usage statistics',
    section2Sub2Item3: 'Error tracking',
    section3Title: '3. Third-Party Cookies',
    section3Intro: 'We may use cookies from:',
    section3Item1: 'Media Delivery Provider:',
    section3Item1Tail: 'For content delivery',
    section3Item2: 'Payment Processor:',
    section3Item2Tail: 'For payment processing',
    section4Title: '4. Managing Cookies',
    section4Body:
      'You can control cookies through your browser settings. Note that disabling essential cookies may affect functionality.',
    section4SubTitle: 'Browser Instructions',
    section4SubItem1: 'Chrome:',
    section4SubItem1Tail: 'Settings → Privacy → Cookies',
    section4SubItem2: 'Firefox:',
    section4SubItem2Tail: 'Preferences → Privacy → Cookies',
    section4SubItem3: 'Safari:',
    section4SubItem3Tail: 'Preferences → Privacy → Cookies',
    section5Title: '5. Cookie Duration',
    section5Item1: 'Session cookies:',
    section5Item1Tail: 'Deleted when you close browser',
    section5Item2: 'Persistent cookies:',
    section5Item2Tail: 'Stored up to 30 days',
    section6Title: '6. Updates',
    section6Body: 'We may update this Cookie Policy. Check this page periodically for changes.',
    section7Title: '7. Contact',
    section7Body: 'Questions about cookies? Contact: privacy@modelclone.ai',
  },
  ru: {
    backDashboard: 'Вернуться в панель управления',
    title: 'Политика использования файлов cookie',
    lastUpdated: 'Последнее обновление: 26 октября 2025 г.',
    section1Title: '1. Что такое файлы cookie',
    section1Body:
      'Файлы cookie — это небольшие текстовые файлы, сохраняемые на вашем устройстве при посещении нашего сайта. Они помогают нам обеспечивать вам более качественный опыт использования.',
    section2Title: '2. Как мы используем файлы cookie',
    section2Sub1Title: 'Обязательные файлы cookie',
    section2Sub1Intro: 'Необходимы для работы Сервиса:',
    section2Sub1Item1: 'auth-storage:',
    section2Sub1Item1Tail: 'поддерживает активность вашей сессии',
    section2Sub1Item2: 'session:',
    section2Sub1Item2Tail: 'сохраняет параметры вашей сессии',
    section2Sub2Title: 'Аналитические файлы cookie',
    section2Sub2Intro: 'Помогают нам понять, как вы используете Сервис (необязательные):',
    section2Sub2Item1: 'Просмотры страниц и навигация',
    section2Sub2Item2: 'Статистика использования функций',
    section2Sub2Item3: 'Отслеживание ошибок',
    section3Title: '3. Сторонние файлы cookie',
    section3Intro: 'Мы можем использовать файлы cookie от:',
    section3Item1: 'Провайдера доставки медиаконтента:',
    section3Item1Tail: 'для доставки контента',
    section3Item2: 'Платёжного процессора:',
    section3Item2Tail: 'для обработки платежей',
    section4Title: '4. Управление файлами cookie',
    section4Body:
      'Вы можете управлять файлами cookie через настройки браузера. Обратите внимание, что отключение обязательных файлов cookie может повлиять на работу Сервиса.',
    section4SubTitle: 'Инструкции для браузеров',
    section4SubItem1: 'Chrome:',
    section4SubItem1Tail: 'Настройки → Конфиденциальность → Файлы cookie',
    section4SubItem2: 'Firefox:',
    section4SubItem2Tail: 'Настройки → Приватность → Файлы cookie',
    section4SubItem3: 'Safari:',
    section4SubItem3Tail: 'Настройки → Конфиденциальность → Файлы cookie',
    section5Title: '5. Срок хранения файлов cookie',
    section5Item1: 'Сессионные файлы cookie:',
    section5Item1Tail: 'удаляются при закрытии браузера',
    section5Item2: 'Постоянные файлы cookie:',
    section5Item2Tail: 'хранятся до 30 дней',
    section6Title: '6. Обновления',
    section6Body:
      'Мы можем обновлять настоящую Политику использования файлов cookie. Периодически проверяйте эту страницу на наличие изменений.',
    section7Title: '7. Контакты',
    section7Body: 'Вопросы о файлах cookie? Свяжитесь с нами: privacy@modelclone.ai',
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

export default function CookiesPage() {
  const [locale] = useState(resolveLocale);
  const copy = COPY[locale] || COPY.en;
  const [customMd, setCustomMd] = useState(null);
  const [mdLoading, setMdLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await brandingAPI.getPublicBranding();
        const md = r?.branding?.cookiesMarkdown?.trim();
        if (!cancelled) setCustomMd(md || null);
      } catch {
        if (!cancelled) setCustomMd(null);
      } finally {
        if (!cancelled) setMdLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <Link to="/dashboard" className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition mb-8">
          <ArrowLeft className="w-4 h-4" />
          {copy.backDashboard}
        </Link>

        <h1 className="text-4xl font-bold mb-8">{copy.title}</h1>

        <div className="glass rounded-3xl p-8 max-w-none">
          {mdLoading ? (
            <p className="text-gray-500 text-sm">Loading…</p>
          ) : customMd ? (
            <LegalMarkdownProse>{customMd}</LegalMarkdownProse>
          ) : (
            <div className="prose prose-invert max-w-none">
              <p className="text-gray-400 mb-6">{copy.lastUpdated}</p>

              <h2>{copy.section1Title}</h2>
              <p>{copy.section1Body}</p>

              <h2>{copy.section2Title}</h2>

              <h3>{copy.section2Sub1Title}</h3>
              <p>{copy.section2Sub1Intro}</p>
              <ul>
                <li>
                  <strong>{copy.section2Sub1Item1}</strong> {copy.section2Sub1Item1Tail}
                </li>
                <li>
                  <strong>{copy.section2Sub1Item2}</strong> {copy.section2Sub1Item2Tail}
                </li>
              </ul>

              <h3>{copy.section2Sub2Title}</h3>
              <p>{copy.section2Sub2Intro}</p>
              <ul>
                <li>{copy.section2Sub2Item1}</li>
                <li>{copy.section2Sub2Item2}</li>
                <li>{copy.section2Sub2Item3}</li>
              </ul>

              <h2>{copy.section3Title}</h2>
              <p>{copy.section3Intro}</p>
              <ul>
                <li>
                  <strong>{copy.section3Item1}</strong> {copy.section3Item1Tail}
                </li>
                <li>
                  <strong>{copy.section3Item2}</strong> {copy.section3Item2Tail}
                </li>
              </ul>

              <h2>{copy.section4Title}</h2>
              <p>{copy.section4Body}</p>

              <h3>{copy.section4SubTitle}</h3>
              <ul>
                <li>
                  <strong>{copy.section4SubItem1}</strong> {copy.section4SubItem1Tail}
                </li>
                <li>
                  <strong>{copy.section4SubItem2}</strong> {copy.section4SubItem2Tail}
                </li>
                <li>
                  <strong>{copy.section4SubItem3}</strong> {copy.section4SubItem3Tail}
                </li>
              </ul>

              <h2>{copy.section5Title}</h2>
              <ul>
                <li>
                  <strong>{copy.section5Item1}</strong> {copy.section5Item1Tail}
                </li>
                <li>
                  <strong>{copy.section5Item2}</strong> {copy.section5Item2Tail}
                </li>
              </ul>

              <h2>{copy.section6Title}</h2>
              <p>{copy.section6Body}</p>

              <h2>{copy.section7Title}</h2>
              <p>{copy.section7Body}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
