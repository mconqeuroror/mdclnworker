import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import LegalMarkdownProse from '../components/LegalMarkdownProse';
import { brandingAPI } from '../services/api';

const LOCALE_STORAGE_KEY = 'app_locale';

const COPY = {
  en: {
    backDashboard: 'Back to Dashboard',
    title: 'Terms of Service',
    lastUpdated: 'Last updated: October 26, 2025',
    section1Title: '1. Acceptance of Terms',
    section1Body:
      'By accessing and using ModelClone ("Service"), you accept and agree to be bound by the terms and provision of this agreement.',
    section2Title: '2. Use License',
    section2Body:
      'Permission is granted to temporarily use the Service for personal or commercial purposes. This is the grant of a license, not a transfer of title.',
    section3Title: '3. Content Ownership',
    section3Body:
      'You retain all rights to the content you upload. However, by uploading content, you grant ModelClone a worldwide, non-exclusive license to use, process, and display your content solely for the purpose of providing the Service.',
    section4Title: '4. AI-Generated Content',
    section4Body:
      'You own the AI-generated content created using our Service. You are responsible for ensuring you have the rights to use any reference images or videos you upload.',
    section5Title: '5. Prohibited Uses',
    section5Intro: 'You may not use the Service to:',
    section5Item1: 'Create deepfakes or misleading content',
    section5Item2: "Violate anyone's intellectual property or privacy rights",
    section5Item3: 'Generate illegal, harmful, or offensive content',
    section5Item4: 'Impersonate others without consent',
    section6Title: '6. Credits and Payments',
    section6Body:
      'Credits are non-refundable. Unused credits do not expire. Prices are subject to change with notice.',
    section7Title: '7. Service Availability',
    section7Body:
      'We strive for 99.9% uptime but do not guarantee uninterrupted service. We may suspend service for maintenance with notice when possible.',
    section8Title: '8. Limitation of Liability',
    section8Body:
      'ModelClone shall not be liable for any indirect, incidental, special, consequential or punitive damages resulting from your use of the Service.',
    section9Title: '9. Termination',
    section9Body:
      'We may terminate or suspend your account immediately, without prior notice, for conduct that we believe violates these Terms or is harmful to other users.',
    section10Title: '10. Changes to Terms',
    section10Body:
      'We reserve the right to modify these terms at any time. Continued use of the Service after changes constitutes acceptance of the new terms.',
    section11Title: '11. Contact',
    section11Body: 'For questions about these Terms, contact us at: support@modelclone.app',
  },
  ru: {
    backDashboard: 'Вернуться в панель управления',
    title: 'Условия использования',
    lastUpdated: 'Последнее обновление: 26 октября 2025 г.',
    section1Title: '1. Принятие условий',
    section1Body:
      'Получая доступ к ModelClone («Сервис») и используя его, вы принимаете и соглашаетесь соблюдать условия и положения настоящего соглашения.',
    section2Title: '2. Лицензия на использование',
    section2Body:
      'Вам предоставляется разрешение на временное использование Сервиса в личных или коммерческих целях. Это предоставление лицензии, а не передача права собственности.',
    section3Title: '3. Право собственности на контент',
    section3Body:
      'Вы сохраняете все права на загружаемый вами контент. Однако, загружая контент, вы предоставляете ModelClone всемирную неисключительную лицензию на использование, обработку и отображение вашего контента исключительно в целях предоставления Сервиса.',
    section4Title: '4. Контент, созданный ИИ',
    section4Body:
      'Вам принадлежит контент, созданный ИИ с помощью нашего Сервиса. Вы несёте ответственность за то, чтобы у вас были права на использование любых загружаемых референсных изображений или видео.',
    section5Title: '5. Запрещённые виды использования',
    section5Intro: 'Вам запрещается использовать Сервис для:',
    section5Item1: 'Создания дипфейков или вводящего в заблуждение контента',
    section5Item2:
      'Нарушения прав интеллектуальной собственности или права на неприкосновенность частной жизни',
    section5Item3: 'Создания незаконного, вредоносного или оскорбительного контента',
    section5Item4: 'Выдачи себя за других лиц без их согласия',
    section6Title: '6. Кредиты и платежи',
    section6Body:
      'Кредиты не подлежат возврату. Неиспользованные кредиты не сгорают. Цены могут быть изменены с предварительным уведомлением.',
    section7Title: '7. Доступность сервиса',
    section7Body:
      'Мы стремимся обеспечить время безотказной работы 99,9%, однако не гарантируем бесперебойную работу Сервиса. Мы можем приостанавливать работу Сервиса для технического обслуживания, по возможности заблаговременно уведомляя об этом.',
    section8Title: '8. Ограничение ответственности',
    section8Body:
      'ModelClone не несёт ответственности за какой-либо косвенный, случайный, специальный, последующий или штрафной ущерб, возникший в результате использования вами Сервиса.',
    section9Title: '9. Прекращение действия',
    section9Body:
      'Мы вправе немедленно, без предварительного уведомления, заблокировать или приостановить действие вашей учётной записи в случае поведения, которое, по нашему мнению, нарушает настоящие Условия или наносит вред другим пользователям.',
    section10Title: '10. Изменения условий',
    section10Body:
      'Мы оставляем за собой право изменять настоящие условия в любое время. Продолжение использования Сервиса после внесения изменений означает принятие новых условий.',
    section11Title: '11. Контакты',
    section11Body: 'По вопросам, связанным с настоящими Условиями, свяжитесь с нами: support@modelclone.app',
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

export default function TermsPage() {
  const [locale] = useState(resolveLocale);
  const copy = COPY[locale] || COPY.en;
  const [customMd, setCustomMd] = useState(null);
  const [mdLoading, setMdLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await brandingAPI.getPublicBranding();
        const md = r?.branding?.termsMarkdown?.trim();
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
          <p>
            {copy.section1Body}
          </p>

          <h2>{copy.section2Title}</h2>
          <p>
            {copy.section2Body}
          </p>

          <h2>{copy.section3Title}</h2>
          <p>
            {copy.section3Body}
          </p>

          <h2>{copy.section4Title}</h2>
          <p>
            {copy.section4Body}
          </p>

          <h2>{copy.section5Title}</h2>
          <p>{copy.section5Intro}</p>
          <ul>
            <li>{copy.section5Item1}</li>
            <li>{copy.section5Item2}</li>
            <li>{copy.section5Item3}</li>
            <li>{copy.section5Item4}</li>
          </ul>

          <h2>{copy.section6Title}</h2>
          <p>
            {copy.section6Body}
          </p>

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

          <h2>{copy.section11Title}</h2>
          <p>
            {copy.section11Body}
          </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
