import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import LegalMarkdownProse from '../components/LegalMarkdownProse';
import { brandingAPI } from '../services/api';

const LOCALE_STORAGE_KEY = 'app_locale';

const COPY = {
  en: {
    backDashboard: 'Back to Dashboard',
    title: 'Privacy Policy',
    lastUpdated: 'Last updated: October 26, 2025',
    section1Title: '1. Information We Collect',
    section1Sub1Title: 'Account Information',
    section1Sub1Intro: 'When you create an account, we collect:',
    section1Sub1Item1: 'Email address',
    section1Sub1Item2: 'Name',
    section1Sub1Item3: 'Password (encrypted)',
    section1Sub2Title: 'Content You Upload',
    section1Sub2Intro: 'We process and store:',
    section1Sub2Item1: 'Identity photos (for model creation)',
    section1Sub2Item2: 'Reference images and videos',
    section1Sub2Item3: 'Generated content',
    section1Sub3Title: 'Usage Data',
    section1Sub3Intro: 'We automatically collect:',
    section1Sub3Item1: 'Generation history',
    section1Sub3Item2: 'Credit usage',
    section1Sub3Item3: 'IP address and device information',
    section2Title: '2. How We Use Your Information',
    section2Intro: 'We use your information to:',
    section2Item1: 'Provide and improve our AI generation services',
    section2Item2: 'Process your content through our AI models',
    section2Item3: 'Manage your account and credits',
    section2Item4: 'Send important service updates',
    section2Item5: 'Prevent fraud and abuse',
    section3Title: '3. Data Storage and Security',
    section3Body:
      'Your content is securely stored using encrypted media delivery infrastructure. We use industry-standard security measures including:',
    section3Item1: 'Encrypted data transmission (HTTPS/TLS)',
    section3Item2: 'Encrypted password storage',
    section3Item3: 'Secure database access controls',
    section3Item4: 'Regular security audits',
    section4Title: '4. Third-Party Services',
    section4Intro: 'We use the following third-party services:',
    section4Item1: 'Media Storage Provider:',
    section4Item1Tail: 'For image and video storage',
    section4Item2: 'AI Processing Providers:',
    section4Item2Tail: 'For AI generation processing',
    section4Item3: 'Payment Processor:',
    section4Item3Tail: 'For payment processing (coming soon)',
    section5Title: '5. Data Retention',
    section5Body:
      'We retain your account data and generated content as long as your account is active. You can request account deletion at any time.',
    section6Title: '6. Your Rights',
    section6Intro: 'You have the right to:',
    section6Item1: 'Access your personal data',
    section6Item2: 'Request data correction or deletion',
    section6Item3: 'Export your data',
    section6Item4: 'Opt-out of marketing communications',
    section6Item5: 'Withdraw consent',
    section7Title: "7. Children's Privacy",
    section7Body:
      'Our Service is not intended for users under 18. We do not knowingly collect information from children.',
    section8Title: '8. International Data Transfers',
    section8Body:
      'Your data may be processed in servers located in different countries. We ensure appropriate safeguards are in place.',
    section9Title: '9. Changes to Privacy Policy',
    section9Body:
      'We may update this policy from time to time. We will notify you of significant changes via email.',
    section10Title: '10. Contact Us',
    section10Body: 'For privacy questions or to exercise your rights, contact: privacy@modelclone.ai',
  },
  ru: {
    backDashboard: 'Вернуться в панель управления',
    title: 'Политика конфиденциальности',
    lastUpdated: 'Последнее обновление: 26 октября 2025 г.',
    section1Title: '1. Информация, которую мы собираем',
    section1Sub1Title: 'Данные учётной записи',
    section1Sub1Intro: 'При создании учётной записи мы собираем:',
    section1Sub1Item1: 'Адрес электронной почты',
    section1Sub1Item2: 'Имя',
    section1Sub1Item3: 'Пароль (в зашифрованном виде)',
    section1Sub2Title: 'Загружаемый вами контент',
    section1Sub2Intro: 'Мы обрабатываем и храним:',
    section1Sub2Item1: 'Фотографии для идентификации (для создания модели)',
    section1Sub2Item2: 'Референсные изображения и видео',
    section1Sub2Item3: 'Сгенерированный контент',
    section1Sub3Title: 'Данные об использовании',
    section1Sub3Intro: 'Мы автоматически собираем:',
    section1Sub3Item1: 'Историю генераций',
    section1Sub3Item2: 'Использование кредитов',
    section1Sub3Item3: 'IP-адрес и сведения об устройстве',
    section2Title: '2. Как мы используем вашу информацию',
    section2Intro: 'Мы используем вашу информацию для:',
    section2Item1: 'Предоставления и улучшения наших сервисов ИИ-генерации',
    section2Item2: 'Обработки вашего контента через наши ИИ-модели',
    section2Item3: 'Управления вашей учётной записью и кредитами',
    section2Item4: 'Отправки важных уведомлений о работе Сервиса',
    section2Item5: 'Предотвращения мошенничества и злоупотреблений',
    section3Title: '3. Хранение и безопасность данных',
    section3Body:
      'Ваш контент надёжно хранится с использованием зашифрованной инфраструктуры доставки медиаданных. Мы применяем отраслевые стандарты безопасности, в том числе:',
    section3Item1: 'Шифрование передачи данных (HTTPS/TLS)',
    section3Item2: 'Зашифрованное хранение паролей',
    section3Item3: 'Контроль доступа к защищённым базам данных',
    section3Item4: 'Регулярные аудиты безопасности',
    section4Title: '4. Сторонние сервисы',
    section4Intro: 'Мы используем следующие сторонние сервисы:',
    section4Item1: 'Провайдер хранилища медиаданных:',
    section4Item1Tail: 'для хранения изображений и видео',
    section4Item2: 'Провайдеры ИИ-обработки:',
    section4Item2Tail: 'для обработки ИИ-генераций',
    section4Item3: 'Платёжный процессор:',
    section4Item3Tail: 'для обработки платежей (скоро)',
    section5Title: '5. Хранение данных',
    section5Body:
      'Мы храним данные вашей учётной записи и сгенерированный контент в течение всего времени, пока ваша учётная запись активна. Вы можете запросить удаление учётной записи в любое время.',
    section6Title: '6. Ваши права',
    section6Intro: 'Вы имеете право:',
    section6Item1: 'Получить доступ к своим персональным данным',
    section6Item2: 'Запросить исправление или удаление данных',
    section6Item3: 'Экспортировать свои данные',
    section6Item4: 'Отказаться от маркетинговых рассылок',
    section6Item5: 'Отозвать согласие',
    section7Title: '7. Конфиденциальность детей',
    section7Body:
      'Наш Сервис не предназначен для пользователей младше 18 лет. Мы намеренно не собираем информацию о детях.',
    section8Title: '8. Международная передача данных',
    section8Body:
      'Ваши данные могут обрабатываться на серверах, расположенных в разных странах. Мы обеспечиваем наличие надлежащих мер защиты.',
    section9Title: '9. Изменения политики конфиденциальности',
    section9Body:
      'Мы можем периодически обновлять настоящую политику. О существенных изменениях мы уведомим вас по электронной почте.',
    section10Title: '10. Свяжитесь с нами',
    section10Body:
      'По вопросам конфиденциальности или для реализации своих прав обращайтесь: privacy@modelclone.ai',
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

export default function PrivacyPage() {
  const [locale] = useState(resolveLocale);
  const copy = COPY[locale] || COPY.en;
  const [customMd, setCustomMd] = useState(null);
  const [mdLoading, setMdLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await brandingAPI.getPublicBranding();
        const md = r?.branding?.privacyMarkdown?.trim();
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
          
          <h3>{copy.section1Sub1Title}</h3>
          <p>{copy.section1Sub1Intro}</p>
          <ul>
            <li>{copy.section1Sub1Item1}</li>
            <li>{copy.section1Sub1Item2}</li>
            <li>{copy.section1Sub1Item3}</li>
          </ul>

          <h3>{copy.section1Sub2Title}</h3>
          <p>{copy.section1Sub2Intro}</p>
          <ul>
            <li>{copy.section1Sub2Item1}</li>
            <li>{copy.section1Sub2Item2}</li>
            <li>{copy.section1Sub2Item3}</li>
          </ul>

          <h3>{copy.section1Sub3Title}</h3>
          <p>{copy.section1Sub3Intro}</p>
          <ul>
            <li>{copy.section1Sub3Item1}</li>
            <li>{copy.section1Sub3Item2}</li>
            <li>{copy.section1Sub3Item3}</li>
          </ul>

          <h2>{copy.section2Title}</h2>
          <p>{copy.section2Intro}</p>
          <ul>
            <li>{copy.section2Item1}</li>
            <li>{copy.section2Item2}</li>
            <li>{copy.section2Item3}</li>
            <li>{copy.section2Item4}</li>
            <li>{copy.section2Item5}</li>
          </ul>

          <h2>{copy.section3Title}</h2>
          <p>
            {copy.section3Body}
          </p>
          <ul>
            <li>{copy.section3Item1}</li>
            <li>{copy.section3Item2}</li>
            <li>{copy.section3Item3}</li>
            <li>{copy.section3Item4}</li>
          </ul>

          <h2>{copy.section4Title}</h2>
          <p>{copy.section4Intro}</p>
          <ul>
            <li>
              <strong>{copy.section4Item1}</strong> {copy.section4Item1Tail}
            </li>
            <li>
              <strong>{copy.section4Item2}</strong> {copy.section4Item2Tail}
            </li>
            <li>
              <strong>{copy.section4Item3}</strong> {copy.section4Item3Tail}
            </li>
          </ul>

          <h2>{copy.section5Title}</h2>
          <p>
            {copy.section5Body}
          </p>

          <h2>{copy.section6Title}</h2>
          <p>{copy.section6Intro}</p>
          <ul>
            <li>{copy.section6Item1}</li>
            <li>{copy.section6Item2}</li>
            <li>{copy.section6Item3}</li>
            <li>{copy.section6Item4}</li>
            <li>{copy.section6Item5}</li>
          </ul>

          <h2>{copy.section7Title}</h2>
          <p>
            {copy.section7Body}
          </p>

          <h2>{copy.section8Title}</h2>
          <p>
            {copy.section8Body}
          </p>

          <h2>{copy.section9Title}</h2>
          <p>
            {copy.section9Body}
          </p>

          <h2>{copy.section10Title}</h2>
          <p>
            {copy.section10Body}
          </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
