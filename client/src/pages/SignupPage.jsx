import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Zap, Shield, CheckCircle, Mail, Lock, User, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { SiGoogle } from 'react-icons/si';
import toast from 'react-hot-toast';
import { authAPI, referralAPI } from '../services/api';
import { useAuthStore } from '../store';
import { signInWithGoogle } from '../lib/firebase';
import { generateFingerprint } from '../utils/fingerprint';

const LOCALE_STORAGE_KEY = 'app_locale';

const COPY = {
  en: {
    toastGoogleFailed: 'Google sign-in failed',
    toastAccountCreated: 'Account created!',
    toastWelcomeBack: 'Welcome back!',
    toastSignupFailed: 'Signup failed',
    toastFillAllFields: 'Please fill in all fields',
    toastAcceptPolicies: 'You must accept the Terms, Privacy Policy, and Cookie Policy to register',
    toastPasswordsMismatch: 'Passwords do not match',
    toastPasswordMin: 'Password must be at least 8 characters',
    toastVerifyEmailSent: 'Account created! Check your email for verification code',
    toastSignupFailedRetry: 'Signup failed. Please try again.',
    title: 'Create Account',
    subtitle: 'Start creating AI content today',
    benefit1: 'One-click signup with Google',
    benefit2: 'No password to remember',
    benefit3: 'Secure authentication by Google',
    googleButtonLoading: 'Creating account...',
    googleButtonContinue: 'Continue with Google',
    or: 'or',
    emailButton: 'Sign up with Email',
    placeholderName: 'Full Name',
    placeholderEmail: 'Email Address',
    placeholderPassword: 'Password (min. 8 characters)',
    placeholderConfirmPassword: 'Confirm Password',
    emailSubmitLoading: 'Creating account...',
    emailSubmit: 'Create Account',
    backToGoogle: '← Back to Google signup',
    legalNotice:
      'We use device verification for fraud prevention.',
    agreePrefix: 'I agree to the',
    agreeTerms: 'Terms of Service',
    agreePrivacy: 'Privacy Policy',
    agreeCookies: 'Cookie Policy',
    agreeAnd: 'and',
    alreadyHaveAccount: 'Already have an account?',
    signIn: 'Sign In',
    backHome: 'Back to Home',
  },
  ru: {
    toastGoogleFailed: 'Ошибка входа через Google',
    toastAccountCreated: 'Учётная запись создана!',
    toastWelcomeBack: 'С возвращением!',
    toastSignupFailed: 'Ошибка регистрации',
    toastFillAllFields: 'Пожалуйста, заполните все поля',
    toastAcceptPolicies: 'Чтобы зарегистрироваться, нужно принять Условия, Политику конфиденциальности и Политику cookie',
    toastPasswordsMismatch: 'Пароли не совпадают',
    toastPasswordMin: 'Пароль должен содержать не менее 8 символов',
    toastVerifyEmailSent: 'Учётная запись создана! Проверьте почту — мы отправили код подтверждения',
    toastSignupFailedRetry: 'Ошибка регистрации. Пожалуйста, попробуйте ещё раз.',
    title: 'Создать учётную запись',
    subtitle: 'Начните создавать ИИ-контент уже сегодня',
    benefit1: 'Быстрая регистрация через Google',
    benefit2: 'Не нужно запоминать пароль',
    benefit3: 'Безопасная аутентификация через Google',
    googleButtonLoading: 'Создание учётной записи...',
    googleButtonContinue: 'Продолжить через Google',
    or: 'или',
    emailButton: 'Зарегистрироваться по email',
    placeholderName: 'Полное имя',
    placeholderEmail: 'Адрес электронной почты',
    placeholderPassword: 'Пароль (мин. 8 символов)',
    placeholderConfirmPassword: 'Подтвердите пароль',
    emailSubmitLoading: 'Создание учётной записи...',
    emailSubmit: 'Создать учётную запись',
    backToGoogle: '← Вернуться к регистрации через Google',
    legalNotice:
      'Мы используем верификацию устройства для защиты от мошенничества.',
    agreePrefix: 'Я принимаю',
    agreeTerms: 'Условия использования',
    agreePrivacy: 'Политику конфиденциальности',
    agreeCookies: 'Политику cookie',
    agreeAnd: 'и',
    alreadyHaveAccount: 'Уже есть учётная запись?',
    signIn: 'Войти',
    backHome: 'На главную',
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

export default function SignupPage() {
  const [locale] = useState(resolveLocale);
  const copy = COPY[locale] || COPY.en;
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const navigate = useNavigate();
  const location = useLocation();
  const setAuth = useAuthStore((state) => state.setAuth);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ref = params.get("ref");
    if (ref) {
      localStorage.setItem("pendingReferralCode", ref.trim().toLowerCase());
      (async () => {
        try {
          const fp = await generateFingerprint();
          await referralAPI.captureHint(
            ref.trim().toLowerCase(),
            fp?.visitorId || "no-fingerprint-available",
            navigator.userAgent || "Unknown",
          );
        } catch {
          // Best-effort referral capture only.
        }
      })();
    }
  }, [location.search]);

  const getPendingReferralCode = () =>
    localStorage.getItem("pendingReferralCode") || null;

  const handleGoogleSignup = async () => {
    if (!acceptedPolicies) {
      toast.error(copy.toastAcceptPolicies);
      return;
    }
    setGoogleLoading(true);
    try {
      const googleResult = await signInWithGoogle();
      if (!googleResult.success) {
        toast.error(googleResult.error || copy.toastGoogleFailed);
        return;
      }

      let fingerprintValue = "no-fingerprint-available";
      try {
        const fp = await generateFingerprint();
        fingerprintValue = fp?.visitorId || fingerprintValue;
      } catch {
        // Keep fallback fingerprint value.
      }

      const data = await authAPI.googleAuth(
        googleResult.idToken,
        googleResult.user.email,
        googleResult.user.displayName,
        googleResult.user.uid,
        'signup',
        getPendingReferralCode(),
        fingerprintValue,
        navigator.userAgent || "Unknown",
        true,
      );

      if (data.success) {
        if (data.isNewUser) {
          localStorage.removeItem("pendingReferralCode");
        }
        setAuth(data.user, data.token);
        toast.success(data.isNewUser ? copy.toastAccountCreated : copy.toastWelcomeBack);
        const redirectTo = localStorage.getItem("redirectAfterLogin");
        if (redirectTo) {
          localStorage.removeItem("redirectAfterLogin");
          navigate(redirectTo);
        } else if (data.isNewUser || !data.user.onboardingCompleted) {
          navigate('/onboarding');
        } else {
          navigate('/dashboard');
        }
      } else {
        toast.error(data.message || copy.toastSignupFailed);
      }
    } catch (error) {
      console.error('Google signup error:', error);
      toast.error(error.response?.data?.message || copy.toastGoogleFailed);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleEmailSignup = async (e) => {
    e.preventDefault();
    if (!acceptedPolicies) {
      toast.error(copy.toastAcceptPolicies);
      return;
    }
    
    if (!formData.name || !formData.email || !formData.password || !formData.confirmPassword) {
      toast.error(copy.toastFillAllFields);
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      toast.error(copy.toastPasswordsMismatch);
      return;
    }

    if (formData.password.length < 8) {
      toast.error(copy.toastPasswordMin);
      return;
    }

    setLoading(true);
    
    try {
      let fingerprintValue = "no-fingerprint-available";
      try {
        const fp = await generateFingerprint();
        fingerprintValue = fp?.visitorId || fingerprintValue;
      } catch {
        // Keep fallback fingerprint value.
      }

      const data = await authAPI.signup(
        formData.email,
        formData.password,
        formData.name,
        fingerprintValue,
        navigator.userAgent || "Unknown",
        getPendingReferralCode(),
        true,
      );
      
      if (data.success) {
        localStorage.removeItem("pendingReferralCode");
        toast.success(copy.toastVerifyEmailSent);
        navigate('/verify', { state: { email: formData.email } });
      } else {
        toast.error(data.message || copy.toastSignupFailed);
      }
    } catch (error) {
      console.error('Signup error:', error);
      const errorData = error.response?.data;
      toast.error(errorData?.message || copy.toastSignupFailedRetry);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6 relative overflow-hidden">
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-white/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative"
      >
        <Link to="/" className="flex items-center justify-center gap-2 mb-8">
          <img src="/logo-512.png" alt="ModelClone" className="w-12 h-12 rounded-xl object-cover" />
          <span className="text-2xl font-bold">ModelClone</span>
        </Link>

        <div className="glass rounded-3xl p-8">
          <div className="text-center mb-6">
            <h1 className="text-3xl font-bold mb-2">{copy.title}</h1>
            <p className="text-gray-400">{copy.subtitle}</p>
          </div>

          {!showEmailForm ? (
            <>
              <div className="space-y-3 mb-6">
                <div className="flex items-center gap-3 text-sm text-gray-300">
                  <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                  <span>{copy.benefit1}</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-300">
                  <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                  <span>{copy.benefit2}</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-300">
                  <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                  <span>{copy.benefit3}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleGoogleSignup}
                disabled={googleLoading || !acceptedPolicies}
                className="w-full py-4 rounded-xl bg-white text-gray-900 font-bold flex items-center justify-center gap-3 hover:bg-gray-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="button-google-signup"
              >
                {googleLoading ? (
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-5 border-2 border-gray-400 border-t-gray-900 rounded-full animate-spin" />
                    <span>{copy.googleButtonLoading}</span>
                  </div>
                ) : (
                  <>
                    <SiGoogle className="w-5 h-5" />
                    {copy.googleButtonContinue}
                  </>
                )}
              </button>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/10" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-4 bg-black text-gray-400">{copy.or}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowEmailForm(true)}
                className="w-full py-3 rounded-xl glass hover:bg-white/10 transition font-semibold flex items-center justify-center gap-2"
                data-testid="button-show-email-form"
              >
                <Mail className="w-5 h-5" />
                {copy.emailButton}
              </button>
            </>
          ) : (
            <>
              <form onSubmit={handleEmailSignup} className="space-y-4">
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    placeholder={copy.placeholderName}
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full pl-12 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-white/40 transition"
                    data-testid="input-name"
                  />
                </div>

                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="email"
                    placeholder={copy.placeholderEmail}
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full pl-12 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-white/40 transition"
                    data-testid="input-email"
                  />
                </div>

                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder={copy.placeholderPassword}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full pl-12 pr-12 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-white/40 transition"
                    data-testid="input-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>

                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder={copy.placeholderConfirmPassword}
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                    className="w-full pl-12 pr-12 py-3 rounded-xl bg-white/5 border border-white/10 focus:border-white/40 transition"
                    data-testid="input-confirm-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition"
                  >
                    {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={loading || !acceptedPolicies}
                  className="w-full py-3 rounded-xl bg-white text-black hover:bg-white/90 transition font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid="button-email-signup"
                >
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                      <span>{copy.emailSubmitLoading}</span>
                    </div>
                  ) : (
                    <>
                      {copy.emailSubmit}
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>
              </form>

              <button
                type="button"
                onClick={() => setShowEmailForm(false)}
                className="w-full mt-4 py-2 text-gray-400 hover:text-white transition text-sm"
              >
                {copy.backToGoogle}
              </button>
            </>
          )}

          <div className="flex items-start gap-3 p-4 rounded-xl bg-white/5 border border-white/10 mt-6">
            <Shield className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={acceptedPolicies}
                  onChange={(e) => setAcceptedPolicies(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border border-white/30 bg-black/40 text-white focus:ring-1 focus:ring-white/50"
                  data-testid="checkbox-accept-policies"
                />
                <span>
                  {copy.agreePrefix}{" "}
                  <Link to="/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">
                    {copy.agreeTerms}
                  </Link>{" "}
                  {copy.agreeAnd}{" "}
                  <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">
                    {copy.agreePrivacy}
                  </Link>{" "}
                  {copy.agreeAnd}{" "}
                  <Link to="/cookies" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">
                    {copy.agreeCookies}
                  </Link>
                  .
                </span>
              </label>
              <p className="text-xs text-gray-400">{copy.legalNotice}</p>
            </div>
          </div>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-black text-gray-400">{copy.alreadyHaveAccount}</span>
            </div>
          </div>

          <Link
            to="/login"
            className="block w-full py-3 rounded-xl glass hover:bg-white/10 transition font-semibold text-center"
          >
            {copy.signIn}
          </Link>
        </div>

        <div className="text-center mt-6">
          <Link to="/" className="text-gray-400 hover:text-white transition">
            {copy.backHome}
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
