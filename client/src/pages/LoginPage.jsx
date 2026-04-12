import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Mail, Lock, ArrowRight, Zap, ShieldCheck } from 'lucide-react';
import { SiGoogle, SiTelegram } from 'react-icons/si';
import toast from 'react-hot-toast';
import { authAPI, referralAPI } from '../services/api';
import { useAuthStore } from '../store';
import { signInWithGoogle } from '../lib/firebase';
import { generateFingerprint } from '../utils/fingerprint';
import { getRawInitData, getTelegramUser, isTelegram } from '../lib/telegram.js';
const LOCALE_STORAGE_KEY = 'app_locale';

function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage-denied/quota errors.
  }
}

function safeLocalStorageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage-denied/quota errors.
  }
}

const COPY = {
  en: {
    googleFailed: 'Google sign-in failed',
    welcome: 'Welcome!',
    allFieldsRequired: 'Please fill in all fields',
    enter2fa: 'Please enter your 2FA code',
    googleAccountHint: 'This account uses Google sign-in. Please use the Google button below.',
    welcomeBackToast: 'Welcome back!',
    enterAuthCodeToast: 'Enter your 2FA code from your authenticator app',
    verifyEmailFirst: 'Please verify your email first',
    invalid2fa: 'Invalid 2FA code. Please try again.',
    title: 'Welcome Back',
    subtitle: 'Sign in to continue creating',
    labelEmail: 'Email',
    labelPassword: 'Password',
    forgotPassword: 'Forgot password?',
    label2fa: 'Two-Factor Authentication Code',
    help2fa: 'Enter the 6-digit code from your authenticator app',
    buttonSigningIn: 'Signing in...',
    buttonSignIn: 'Sign In',
    dividerOr: 'or',
    continueWithGoogle: 'Continue with Google',
    noAccount: "Don't have an account?",
    createAccount: 'Create Account',
    backHome: '← Back to Home',
  },
  ru: {
    googleFailed: 'Ошибка входа через Google',
    welcome: 'Добро пожаловать!',
    allFieldsRequired: 'Пожалуйста, заполните все поля',
    enter2fa: 'Введите код 2FA',
    googleAccountHint: 'Для этой учетной записи используется вход через Google. Пожалуйста, воспользуйтесь кнопкой Google ниже.',
    welcomeBackToast: 'Снова с вами!',
    enterAuthCodeToast: 'Введите код 2FA из приложения-аутентификатора',
    verifyEmailFirst: 'Сначала подтвердите свой адрес электронной почты',
    invalid2fa: 'Неверный код 2FA. Попробуйте еще раз.',
    title: 'Добро пожаловать обратно',
    subtitle: 'Войдите, чтобы продолжить создание',
    labelEmail: 'Электронная почта',
    labelPassword: 'Пароль',
    forgotPassword: 'Забыли пароль?',
    label2fa: 'Код двухфакторной аутентификации',
    help2fa: 'Введите 6-значный код из приложения-аутентификатора',
    buttonSigningIn: 'Вход...',
    buttonSignIn: 'Войти',
    dividerOr: 'или',
    continueWithGoogle: 'Продолжить с Google',
    noAccount: 'У вас нет учетной записи?',
    createAccount: 'Создать учетную запись',
    backHome: '← Назад на главную',
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

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [requires2FA, setRequires2FA] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [locale] = useState(resolveLocale);
  const copy = COPY[locale] || COPY.en;
  const navigate = useNavigate();
  const location = useLocation();
  const setAuth = useAuthStore((state) => state.setAuth);
  const setTelegramUser = useAuthStore((state) => state.setTelegramUser);
  const inTelegramMiniApp = isTelegram();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ref = params.get('ref');
    if (ref) {
      safeLocalStorageSet('pendingReferralCode', ref.trim().toLowerCase());
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

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    try {
      const googleResult = await signInWithGoogle();
      if (!googleResult.success) {
        toast.error(googleResult.error || copy.googleFailed);
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
        'login',
        safeLocalStorageGet('pendingReferralCode'),
        fingerprintValue,
        navigator.userAgent || "Unknown",
      );

      if (data.success) {
        setAuth(data.user, data.token);
        toast.success(copy.welcome);
        const redirectTo = safeLocalStorageGet("redirectAfterLogin");
        if (redirectTo) {
          safeLocalStorageRemove("redirectAfterLogin");
          navigate(redirectTo);
        } else if (data.isNewUser) {
          navigate('/onboarding');
        } else {
          navigate('/dashboard');
        }
      } else {
        toast.error(data.message || 'Login failed');
      }
    } catch (error) {
      console.error('Google login error:', error);
      const errorData = error.response?.data;
      toast.error(errorData?.message || copy.googleFailed);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleTelegramLogin = async () => {
    if (!inTelegramMiniApp) return;

    setTelegramLoading(true);
    try {
      const initData = getRawInitData();
      if (!initData) {
        toast.error('Telegram session payload is missing.');
        return;
      }

      const data = await authAPI.telegramAuth(initData);
      if (!data?.success || !data?.user || !data?.token) {
        toast.error(data?.message || 'Telegram sign-in failed');
        return;
      }

      setAuth(data.user, data.token);
      setTelegramUser(getTelegramUser());
      toast.success(copy.welcomeBackToast);
      navigate('/dashboard');
    } catch (error) {
      const errorData = error.response?.data;
      toast.error(errorData?.message || 'Telegram sign-in failed');
    } finally {
      setTelegramLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    
    if (!email || !password) {
      toast.error(copy.allFieldsRequired);
      return;
    }

    if (requires2FA && !twoFactorCode) {
      toast.error(copy.enter2fa);
      return;
    }

    setLoading(true);
    
    try {
      // Check if user exists and what auth provider they use
      let authProvider = null;
      try {
        const checkResult = await authAPI.checkEmail(email);
        authProvider = checkResult.authProvider;
        
        // If user signed up with Google, prompt them to use Google login
        if (authProvider === 'google' || authProvider === 'firebase') {
          toast.error(copy.googleAccountHint);
          setLoading(false);
          return;
        }
      } catch (checkError) {
        // Continue with login attempt
      }

      // Use legacy login for email/password users
      const data = await authAPI.login(email, password, twoFactorCode || undefined);
      
      if (data.success) {
        setAuth(data.user, data.token);
        toast.success(copy.welcomeBackToast);
        const redirectTo = safeLocalStorageGet("redirectAfterLogin");
        if (redirectTo) {
          safeLocalStorageRemove("redirectAfterLogin");
          navigate(redirectTo);
        } else {
          navigate('/dashboard');
        }
      } else if (data.requires2FA) {
        setRequires2FA(true);
        toast(copy.enterAuthCodeToast);
      } else {
        if (data.requiresVerification) {
          toast.error(copy.verifyEmailFirst);
          navigate('/verify', { state: { email } });
        } else {
          toast.error(data.message || 'Login failed');
        }
      }
    } catch (error) {
      const errorData = error.response?.data;
      
      if (errorData?.requires2FA) {
        setRequires2FA(true);
        if (errorData.message === 'Invalid 2FA code') {
          toast.error(copy.invalid2fa);
          setTwoFactorCode('');
        }
      } else if (errorData?.requiresVerification) {
        toast.error(copy.verifyEmailFirst);
        navigate('/verify', { state: { email: errorData.email || email } });
      } else {
        toast.error(errorData?.message || 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6 relative overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative"
      >
        {/* Logo */}
        <Link to="/" className="flex items-center justify-center gap-2 mb-8">
          <img src="/logo-512.png" alt="ModelClone" className="w-12 h-12 rounded-xl object-cover" />
          <span className="text-2xl font-bold">ModelClone</span>
        </Link>

        {/* Login Card */}
        <div className="glass-premium rounded-3xl p-10 shadow-2xl">
          <div className="text-center mb-10">
            <h1 className="text-4xl font-bold mb-3 tracking-tight">{copy.title}</h1>
            <p className="text-gray-400 text-lg">{copy.subtitle}</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            {/* Email */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-300">
                {copy.labelEmail}
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 bg-white/5 border border-white/10 rounded-xl focus:border-purple-500 transition input-premium text-base"
                  placeholder="you@example.com"
                  disabled={loading}
                  data-testid="input-email"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-300">
                  {copy.labelPassword}
                </label>
                <Link 
                  to="/forgot-password" 
                  className="text-sm text-slate-400 hover:text-white transition"
                  data-testid="link-forgot-password"
                >
                  {copy.forgotPassword}
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 bg-white/5 border border-white/10 rounded-xl focus:border-purple-500 transition input-premium text-base"
                  placeholder="••••••••"
                  disabled={loading || requires2FA}
                  data-testid="input-password"
                />
              </div>
            </div>

            {/* 2FA Code */}
            {requires2FA && (
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-300">
                  {copy.label2fa}
                </label>
                <div className="relative">
                  <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-purple-400" />
                  <input
                    type="text"
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full pl-12 pr-4 py-3.5 bg-white/5 border border-purple-500/50 rounded-xl focus:border-purple-500 transition input-premium text-base text-center tracking-widest font-mono"
                    placeholder="000000"
                    maxLength={6}
                    autoFocus
                    disabled={loading}
                    data-testid="input-2fa-code"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  {copy.help2fa}
                </p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || googleLoading || telegramLoading}
              className="w-full py-4 rounded-xl bg-white text-black hover:bg-slate-100 btn-magnetic btn-ripple font-bold flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed group text-lg"
              data-testid="button-submit"
            >
              {loading ? (
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{copy.buttonSigningIn}</span>
                </div>
              ) : (
                <>
                  {copy.buttonSignIn}
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

          {inTelegramMiniApp && (
            <button
              type="button"
              onClick={handleTelegramLogin}
              disabled={loading || googleLoading || telegramLoading}
              className="w-full py-4 rounded-xl bg-[#26A5E4] text-white font-bold flex items-center justify-center gap-3 hover:bg-[#1f95cf] transition disabled:opacity-50 disabled:cursor-not-allowed mt-6"
              data-testid="button-telegram-login"
            >
              {telegramLoading ? (
                <div className="flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  <span>Signing in...</span>
                </div>
              ) : (
                <>
                  <SiTelegram className="w-5 h-5" />
                  Continue with Telegram
                </>
              )}
            </button>
          )}

          {/* Or divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-black text-gray-400">{copy.dividerOr}</span>
            </div>
          </div>

          {/* Google Login Button */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading || googleLoading || telegramLoading}
            className="w-full py-4 rounded-xl bg-white text-gray-900 font-bold flex items-center justify-center gap-3 hover:bg-gray-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="button-google-login"
          >
            {googleLoading ? (
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-gray-400 border-t-gray-900 rounded-full animate-spin" />
                <span>Signing in...</span>
              </div>
            ) : (
              <>
                <SiGoogle className="w-5 h-5" />
                {copy.continueWithGoogle}
              </>
            )}
          </button>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-black text-gray-400">{copy.noAccount}</span>
            </div>
          </div>

          {/* Sign Up Link */}
          <Link
            to="/signup"
            className="block w-full py-3.5 rounded-xl glass-premium btn-magnetic font-bold text-center text-base"
            data-testid="button-create-account"
          >
            {copy.createAccount}
          </Link>
        </div>

        {/* Back to Home */}
        <div className="text-center mt-6">
          <Link to="/" className="text-gray-400 hover:text-white transition">
            {copy.backHome}
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
