import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Shield, FileText, Cookie, CreditCard, AlertTriangle, X, TrendingUp, Lock, Eye, EyeOff, ShieldCheck, Smartphone, CheckCircle, ExternalLink, Key } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store';
import { useQuery, useMutation } from '@tanstack/react-query';
import api, { stripeAPI, authAPI } from '../services/api';
import toast from 'react-hot-toast';
import { queryClient } from '../lib/queryClient';
import { hasBillingAccess, hasPremiumAccess } from '../utils/premiumAccess';
import { resolveLocale } from '../components/generateAIModelFormCopy';
import { SETTINGS_PAGE_COPY, formatSettingsCopy } from '../data/settingsPageCopy';
import { copyTextToClipboard, selectElementContents } from '../utils/clipboard.js';
import { hasBusinessApiAccess } from '../utils/apiAccess.js';

const TELEGRAM_ENROLL_URL = 'https://t.me/selenabythesea';

const fmtApiDate = (d) =>
  d
    ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

export default function SettingsPage() {
  const { user, refreshUserCredits, updateUser } = useAuthStore();
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showRetentionModal, setShowRetentionModal] = useState(false);
  const canAccessPremium = hasPremiumAccess(user);
  const canAccessBilling = hasBillingAccess(user);
  const t = SETTINGS_PAGE_COPY[resolveLocale()] || SETTINGS_PAGE_COPY.en;
  
  // Change password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  
  // Portal loading state
  const [openingPortal, setOpeningPortal] = useState(false);
  
  // 2FA state
  const [show2FASetup, setShow2FASetup] = useState(false);
  const [twoFactorSecret, setTwoFactorSecret] = useState(null);
  const [twoFactorQR, setTwoFactorQR] = useState(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [setting2FA, setSetting2FA] = useState(false);
  const [showDisable2FA, setShowDisable2FA] = useState(false);
  const [displayName, setDisplayName] = useState(user?.name || '');
  const [savingName, setSavingName] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailChangeToken, setEmailChangeToken] = useState('');
  const [requestingEmailChange, setRequestingEmailChange] = useState(false);
  const [verifyingEmailChange, setVerifyingEmailChange] = useState(false);
  const [region, setRegion] = useState(user?.region || '');
  const [marketingLanguage, setMarketingLanguage] = useState(user?.marketingLanguage || '');
  const [savingPrefs, setSavingPrefs] = useState(false);

  const [myApiKeysList, setMyApiKeysList] = useState([]);
  const [myApiKeysLoading, setMyApiKeysLoading] = useState(false);
  const [newUserApiKeyPlain, setNewUserApiKeyPlain] = useState(null);
  const [userApiKeyNameDraft, setUserApiKeyNameDraft] = useState('');
  const [userApiKeyWorkingId, setUserApiKeyWorkingId] = useState(null);
  const [showApiEnrollModal, setShowApiEnrollModal] = useState(false);
  const newUserApiKeyTextareaRef = useRef(null);

  const apiAccess = hasBusinessApiAccess(user);

  const loadMyApiKeys = useCallback(async () => {
    if (!user?.id) return;
    setMyApiKeysLoading(true);
    try {
      const r = await api.get('/user/api-keys');
      if (r.data?.success) setMyApiKeysList(r.data.keys || []);
      else setMyApiKeysList([]);
    } catch {
      setMyApiKeysList([]);
    } finally {
      setMyApiKeysLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadMyApiKeys();
  }, [loadMyApiKeys]);

  useEffect(() => {
    if (!newUserApiKeyPlain) return;
    const id = requestAnimationFrame(() => {
      selectElementContents(newUserApiKeyTextareaRef.current);
    });
    return () => cancelAnimationFrame(id);
  }, [newUserApiKeyPlain]);

  useEffect(() => {
    setDisplayName(user?.name || '');
  }, [user?.name]);
  useEffect(() => {
    setRegion(user?.region ?? '');
    setMarketingLanguage(user?.marketingLanguage ?? '');
  }, [user?.region, user?.marketingLanguage]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await authAPI.getProfile();
        if (!cancelled && data?.success && data.user) {
          updateUser(data.user);
        }
      } catch {
        // Best-effort refresh so billing/subscription controls don't disappear from stale client state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [updateUser]);

  // Fetch subscription status
  const { data: subscription, isLoading: subscriptionLoading } = useQuery({
    queryKey: ['/api/stripe/subscription-status'],
    queryFn: () => stripeAPI.getSubscriptionStatus(),
    enabled: canAccessBilling
  });

  // Fetch 2FA status
  const { data: twoFactorStatus, isLoading: twoFactorLoading } = useQuery({
    queryKey: ['/api/auth/2fa/status'],
    queryFn: authAPI.get2FAStatus,
  });

  // Cancel subscription mutation
  const cancelMutation = useMutation({
    mutationFn: () => stripeAPI.cancelSubscription(),
    onSuccess: () => {
      toast.success(t.toastCancelScheduled);
      queryClient.invalidateQueries({ queryKey: ['/api/stripe/subscription-status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/profile'] });
      refreshUserCredits();
      setShowCancelModal(false);
      setShowRetentionModal(false);
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || t.toastCancelFailed);
    }
  });

  const handleCancelClick = () => {
    setShowCancelModal(false);
    setShowRetentionModal(true);
  };

  const handleConfirmCancel = () => {
    cancelMutation.mutate();
  };

  const getTierName = (tier) => {
    if (!tier) return t.tierFree;
    const k = String(tier).toLowerCase();
    if (k === 'starter') return t.tierStarter;
    if (k === 'pro') return t.tierPro;
    if (k === 'business') return t.tierBusiness;
    return tier.charAt(0).toUpperCase() + tier.slice(1);
  };

  const subscriptionStatusLabel = (status) => {
    if (!status) return '';
    const k = String(status).toLowerCase();
    if (k === 'active') return t.statusActive;
    if (k === 'trial') return t.statusTrial;
    if (k === 'canceled' || k === 'cancelled') return t.statusCanceled;
    return status;
  };

  const getTierPrice = (tier) => {
    const prices = {
      starter: '$29',
      pro: '$79',
      business: '$199'
    };
    return prices[tier] || '$0';
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    
    if (newPassword !== confirmPassword) {
      toast.error(t.toastPasswordMismatch);
      return;
    }
    
    if (newPassword.length < 6) {
      toast.error(t.toastPasswordShort);
      return;
    }
    
    setChangingPassword(true);
    try {
      const response = await api.post('/auth/change-password', {
        currentPassword,
        newPassword
      });
      
      if (response.data.success) {
        toast.success(t.toastPasswordChanged);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (error) {
      toast.error(error.response?.data?.message || t.toastPasswordFailed);
    } finally {
      setChangingPassword(false);
    }
  };

  // 2FA handlers
  const handleSetup2FA = async () => {
    setSetting2FA(true);
    try {
      const data = await authAPI.generate2FASecret();
      if (data.success) {
        setTwoFactorSecret(data.secret);
        setTwoFactorQR(data.qrCode);
        setShow2FASetup(true);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || t.toast2FAGenFailed);
    } finally {
      setSetting2FA(false);
    }
  };

  const handleVerify2FA = async () => {
    if (verifyCode.length !== 6) {
      toast.error(t.toast2FAEnterCode);
      return;
    }
    
    setSetting2FA(true);
    try {
      const data = await authAPI.verify2FA(verifyCode);
      if (data.success) {
        toast.success(t.toast2FAEnabled);
        setShow2FASetup(false);
        setVerifyCode('');
        setTwoFactorSecret(null);
        setTwoFactorQR(null);
        queryClient.invalidateQueries({ queryKey: ['/api/auth/2fa/status'] });
      }
    } catch (error) {
      toast.error(error.response?.data?.message || t.toast2FAInvalid);
      setVerifyCode('');
    } finally {
      setSetting2FA(false);
    }
  };

  const handleDisable2FA = async () => {
    if (disableCode.length !== 6) {
      toast.error(t.toast2FAEnterCode);
      return;
    }
    
    setSetting2FA(true);
    try {
      const data = await authAPI.disable2FA(disableCode);
      if (data.success) {
        toast.success(t.toast2FADisabled);
        setShowDisable2FA(false);
        setDisableCode('');
        queryClient.invalidateQueries({ queryKey: ['/api/auth/2fa/status'] });
      }
    } catch (error) {
      toast.error(error.response?.data?.message || t.toast2FAInvalidDisable);
      setDisableCode('');
    } finally {
      setSetting2FA(false);
    }
  };

  const handleUpdateName = async () => {
    const nextName = displayName.trim();
    if (!nextName) {
      toast.error(t.toastNameRequired);
      return;
    }
    setSavingName(true);
    try {
      const data = await authAPI.updateProfile(nextName);
      if (data.success && data.user) {
        updateUser({ name: data.user.name });
        toast.success(t.toastNameUpdated);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || t.toastNameFailed);
    } finally {
      setSavingName(false);
    }
  };

  const handleRequestEmailChange = async () => {
    if (!newEmail.trim() || !emailPassword) {
      toast.error(t.toastEmailFields);
      return;
    }
    setRequestingEmailChange(true);
    try {
      const data = await authAPI.requestEmailChange(newEmail.trim(), emailPassword);
      if (data.success) {
        setEmailChangeToken(data.emailChangeToken);
        toast.success(t.toastEmailCodeSent);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || t.toastEmailChangeFailed);
    } finally {
      setRequestingEmailChange(false);
    }
  };

  const handleVerifyEmailChange = async () => {
    if (!emailCode || emailCode.length !== 6 || !emailChangeToken) {
      toast.error(t.toastEmailCodeEnter);
      return;
    }
    setVerifyingEmailChange(true);
    try {
      const data = await authAPI.verifyEmailChange(emailCode, emailChangeToken);
      if (data.success && data.user) {
        updateUser({ email: data.user.email, isVerified: true });
        setNewEmail('');
        setEmailPassword('');
        setEmailCode('');
        setEmailChangeToken('');
        toast.success(t.toastEmailUpdated);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || t.toastEmailVerifyFailed);
    } finally {
      setVerifyingEmailChange(false);
    }
  };

  const handleCreateMyApiKey = async () => {
    if (!apiAccess) return;
    setUserApiKeyWorkingId('create');
    try {
      const r = await api.post('/user/api-keys', {
        name: userApiKeyNameDraft.trim() || null,
      });
      if (r.data?.success && r.data.key) {
        setNewUserApiKeyPlain(r.data.key);
        toast.success(t.toastApiKeyCreated);
        setUserApiKeyNameDraft('');
        await loadMyApiKeys();
      } else {
        toast.error(r.data?.message || 'Failed to create key');
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to create key');
    } finally {
      setUserApiKeyWorkingId(null);
    }
  };

  const handleRevokeMyApiKey = async (keyId) => {
    if (!keyId) return;
    if (!window.confirm('Revoke this API key? Integrations using it will stop working immediately.')) return;
    setUserApiKeyWorkingId(keyId);
    try {
      await api.delete(`/user/api-keys/${keyId}`);
      toast.success(t.toastApiKeyRevoked);
      setNewUserApiKeyPlain(null);
      await loadMyApiKeys();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to revoke');
    } finally {
      setUserApiKeyWorkingId(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-6">
      <h1 className="text-2xl sm:text-4xl font-bold mb-4 sm:mb-8">{t.pageTitle}</h1>

      <div className="space-y-4 sm:space-y-6">
        {/* Account Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel rounded-xl sm:rounded-2xl p-4 sm:p-6"
        >
          <h2 className="text-lg sm:text-xl font-bold mb-3 sm:mb-4 flex items-center gap-2">
            <User className="w-4 h-4 sm:w-5 sm:h-5" />
            {t.accountInfo}
          </h2>
          
          <div className="space-y-2 sm:space-y-3">
            <div>
              <label className="text-xs sm:text-sm text-gray-400">{t.name}</label>
              <div className="mt-1 flex flex-col sm:flex-row gap-2">
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg glass-card focus:border-white/20 focus:outline-none text-white"
                  data-testid="input-settings-name"
                />
                <button
                  onClick={handleUpdateName}
                  disabled={savingName || displayName.trim() === (user?.name || '')}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-lg font-semibold text-black bg-white hover:bg-slate-100 transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                  data-testid="button-update-name"
                >
                  {savingName ? t.saving : t.saveName}
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs sm:text-sm text-gray-400">{t.email}</label>
              <p className="text-base sm:text-lg break-all">{user?.email}</p>
              {user?.authProvider === 'email' ? (
                <div className="mt-3 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl glass-card focus:border-white/20 focus:outline-none text-white"
                      placeholder={t.placeholderNewEmail}
                      data-testid="input-settings-new-email"
                    />
                    <input
                      type="password"
                      value={emailPassword}
                      onChange={(e) => setEmailPassword(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl glass-card focus:border-white/20 focus:outline-none text-white"
                      placeholder={t.placeholderCurrentPassword}
                      data-testid="input-settings-email-password"
                    />
                  </div>
                  <button
                    onClick={handleRequestEmailChange}
                    disabled={requestingEmailChange}
                    className="inline-flex items-center gap-2 px-5 py-2 rounded-lg font-semibold text-black bg-white hover:bg-slate-100 transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                    data-testid="button-request-email-change"
                  >
                    {requestingEmailChange ? t.sending : t.verifyNewEmail}
                  </button>
                  {emailChangeToken && (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={emailCode}
                        onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        className="w-full px-4 py-2.5 rounded-xl glass-card focus:border-white/20 focus:outline-none text-white tracking-widest"
                        placeholder={t.placeholderEmailCode}
                        data-testid="input-settings-email-code"
                      />
                      <button
                        onClick={handleVerifyEmailChange}
                        disabled={verifyingEmailChange || emailCode.length !== 6}
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-black bg-white hover:bg-slate-100 transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                        data-testid="button-confirm-email-change"
                      >
                        {verifyingEmailChange ? t.verifying : t.confirmEmail}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-400">
                  {t.emailOAuthOnly}
                </p>
              )}
            </div>
            <div>
              <label className="text-xs sm:text-sm text-gray-400">{t.accountStatus}</label>
              <p className="text-base sm:text-lg flex items-center gap-2">
                {user?.isVerified ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    {t.verified}
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-yellow-500" />
                    {t.pending}
                  </>
                )}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Communication preferences (region + marketing language) */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel rounded-xl sm:rounded-2xl p-4 sm:p-6"
        >
          <h2 className="text-lg sm:text-xl font-bold mb-3 sm:mb-4 flex items-center gap-2">
            <FileText className="w-4 h-4 sm:w-5 sm:h-5" />
            {t.commPrefsTitle}
          </h2>
          <p className="text-xs sm:text-sm text-gray-400 mb-4">
            {t.commPrefsHint}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs sm:text-sm text-gray-400 block mb-1">{t.regionLabel}</label>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg glass-card focus:border-white/20 focus:outline-none text-white"
              >
                <option value="">{t.optionNotSet}</option>
                <option value="US">United States</option>
                <option value="GB">United Kingdom</option>
                <option value="DE">Germany</option>
                <option value="SK">Slovakia</option>
                <option value="CZ">Czech Republic</option>
                <option value="PL">Poland</option>
                <option value="AT">Austria</option>
                <option value="FR">France</option>
                <option value="ES">Spain</option>
                <option value="IT">Italy</option>
                <option value="NL">Netherlands</option>
                <option value="CA">Canada</option>
                <option value="AU">Australia</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="text-xs sm:text-sm text-gray-400 block mb-1">{t.marketingLangLabel}</label>
              <select
                value={marketingLanguage}
                onChange={(e) => setMarketingLanguage(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg glass-card focus:border-white/20 focus:outline-none text-white"
              >
                <option value="">{t.optionAnyDefault}</option>
                <option value="en">English</option>
                <option value="sk">Slovenčina</option>
                <option value="de">Deutsch</option>
                <option value="es">Español</option>
                <option value="fr">Français</option>
                <option value="pl">Polski</option>
                <option value="cs">Čeština</option>
              </select>
            </div>
          </div>
          <button
            onClick={async () => {
              setSavingPrefs(true);
              try {
                const data = await authAPI.updateProfile({ region: region || null, marketingLanguage: marketingLanguage || null });
                if (data?.success && data?.user) {
                  updateUser(data.user);
                  queryClient.invalidateQueries({ queryKey: ['/api/auth/profile'] });
                  toast.success(t.toastPrefsSaved);
                }
              } catch (e) {
                toast.error(e?.response?.data?.message || t.toastPrefsFailed);
              } finally {
                setSavingPrefs(false);
              }
            }}
            disabled={savingPrefs}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg font-semibold text-black bg-white hover:bg-slate-100 transition-all hover:scale-[1.02] disabled:opacity-50"
          >
            {savingPrefs ? t.savingPrefs : t.savePreferences}
          </button>
        </motion.div>

        {/* HTTP API keys */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel rounded-xl sm:rounded-2xl p-4 sm:p-6"
        >
          <h2 className="text-lg sm:text-xl font-bold mb-2 flex items-center gap-2">
            <Key className="w-4 h-4 sm:w-5 sm:h-5 text-slate-300" />
            {t.apiSectionTitle}
          </h2>
          <p className="text-xs sm:text-sm text-gray-400 mb-4">{t.apiSectionIntro}</p>

          {!apiAccess && (
            <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-100/90">
              {t.apiRequiresBusiness}
            </div>
          )}

          {newUserApiKeyPlain && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-4 mb-4">
              <p className="text-xs text-amber-200 mb-2 font-medium">
                {t.apiCopySecretHint}{' '}
                <span className="text-amber-100/80">({newUserApiKeyPlain.length} characters)</span>
              </p>
              <textarea
                ref={newUserApiKeyTextareaRef}
                readOnly
                rows={5}
                spellCheck={false}
                value={newUserApiKeyPlain}
                onFocus={(e) => selectElementContents(e.target)}
                onClick={(e) => selectElementContents(e.target)}
                className="w-full mb-3 px-3 py-2 rounded-lg bg-black/40 border border-amber-500/25 text-xs text-amber-100 font-mono break-all whitespace-pre-wrap resize-y min-h-[6rem] max-h-48 overflow-y-auto"
                aria-label="New API key — full secret"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await copyTextToClipboard(newUserApiKeyPlain);
                    if (ok) toast.success('Full key copied');
                    else toast.error(t.toastApiCopyFailed);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-black bg-white hover:bg-slate-100"
                >
                  {t.apiCopyToClipboard}
                </button>
                <button
                  type="button"
                  onClick={() => selectElementContents(newUserApiKeyTextareaRef.current)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold glass-card hover:bg-white/10"
                >
                  {t.apiSelectAll}
                </button>
              </div>
            </div>
          )}

          {apiAccess && (
            <div className="space-y-3 mb-6">
              <div>
                <label className="text-xs sm:text-sm text-gray-400">{t.apiKeyLabelOptional}</label>
                <input
                  value={userApiKeyNameDraft}
                  onChange={(e) => setUserApiKeyNameDraft(e.target.value)}
                  placeholder={t.apiKeyPlaceholder}
                  className="mt-1 w-full px-3.5 py-2 rounded-lg glass-card focus:border-white/20 focus:outline-none text-white text-sm"
                />
              </div>
              <button
                type="button"
                disabled={userApiKeyWorkingId === 'create'}
                onClick={handleCreateMyApiKey}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg font-semibold text-black bg-white hover:bg-slate-100 transition-all disabled:opacity-50"
              >
                {userApiKeyWorkingId === 'create' ? t.apiCreatingKey : t.apiCreateKey}
              </button>
            </div>
          )}

          {!apiAccess && (
            <div className="mb-6">
              <button
                type="button"
                onClick={() => setShowApiEnrollModal(true)}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg font-semibold text-white bg-violet-600 hover:bg-violet-500 transition-all"
              >
                <ExternalLink className="w-4 h-4" />
                {t.apiEnrollButton}
              </button>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-2">{t.apiActiveKeys}</h3>
            <p className="text-xs text-gray-500 mb-3">{t.apiKeyPrefixOnlyHint}</p>
            {myApiKeysLoading ? (
              <p className="text-sm text-gray-500">{t.loadingGeneric}</p>
            ) : myApiKeysList.filter((k) => !k.revokedAt).length === 0 ? (
              <p className="text-sm text-gray-500">{t.apiNoKeys}</p>
            ) : (
              <ul className="space-y-2">
                {myApiKeysList
                  .filter((k) => !k.revokedAt)
                  .map((k) => (
                    <li
                      key={k.id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-gray-200">{k.name || '—'}</div>
                        <div className="text-xs font-mono text-gray-500 mt-0.5 break-all">
                          {k.keyPrefix}…
                        </div>
                        {k.lastUsedAt && (
                          <div className="text-[11px] text-gray-600 mt-1">
                            {t.apiLastUsed} {fmtApiDate(k.lastUsedAt)}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={async () => {
                            const ok = await copyTextToClipboard(k.keyPrefix);
                            if (ok) toast.success(t.apiCopiedPrefix);
                            else toast.error(t.toastApiCopyFailed);
                          }}
                          className="text-xs px-3 py-1.5 rounded-lg glass-card hover:bg-white/10"
                        >
                          {t.apiCopyPrefix}
                        </button>
                        <button
                          type="button"
                          disabled={userApiKeyWorkingId === k.id}
                          onClick={() => handleRevokeMyApiKey(k.id)}
                          className="text-xs text-red-400 hover:text-red-300 px-2 py-1.5"
                        >
                          {userApiKeyWorkingId === k.id ? '…' : t.apiRevoke}
                        </button>
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </motion.div>

        {/* Two-Factor Authentication */}
        <div className="glass-panel rounded-xl sm:rounded-2xl p-4 sm:p-6">
          <h2 className="text-lg sm:text-xl font-bold mb-3 sm:mb-4 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 text-slate-300" />
            {t.twoFactorTitle}
          </h2>
          
          {twoFactorLoading ? (
            <p className="text-gray-400 text-sm">{t.twoFactorLoading}</p>
          ) : twoFactorStatus?.twoFactorEnabled ? (
            // 2FA is enabled
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 rounded-xl bg-green-500/10 border border-green-500/20">
                <CheckCircle className="w-6 h-6 text-green-400" />
                <div>
                  <p className="font-semibold text-green-400">{t.twoFactorEnabledTitle}</p>
                  <p className="text-sm text-gray-400">{t.twoFactorEnabledHint}</p>
                </div>
              </div>
              
              {showDisable2FA ? (
                <div className="space-y-4 p-4 rounded-xl bg-red-500/5 border border-red-500/20">
                  <p className="text-sm text-gray-300">{t.twoFactorDisablePrompt}</p>
                  <input
                    type="text"
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full px-4 py-3 rounded-xl glass-card focus:border-white/20 focus:outline-none text-white text-center tracking-widest font-mono"
                    placeholder={t.placeholderCode6}
                    maxLength={6}
                    data-testid="input-disable-2fa-code"
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setShowDisable2FA(false); setDisableCode(''); }}
                      className="flex-1 px-4 py-2 rounded-xl glass-card transition font-semibold"
                    >
                      {t.cancel}
                    </button>
                    <button
                      onClick={handleDisable2FA}
                      disabled={setting2FA || disableCode.length !== 6}
                      className="flex-1 px-4 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 transition font-semibold disabled:opacity-50"
                      data-testid="button-confirm-disable-2fa"
                    >
                      {setting2FA ? t.disabling : t.disable2FA}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowDisable2FA(true)}
                  className="text-red-400 hover:text-red-300 transition text-sm"
                  data-testid="button-disable-2fa"
                >
                  {t.disable2FALink}
                </button>
              )}
            </div>
          ) : show2FASetup ? (
            // 2FA setup flow
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <h3 className="font-semibold mb-2 flex items-center gap-2">
                  <Smartphone className="w-5 h-5 text-white/70" />
                  {t.step1ScanQr}
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                  {t.step1Hint}
                </p>
                {twoFactorQR && (
                  <div className="flex justify-center p-4 bg-white rounded-xl">
                    <img src={twoFactorQR} alt={t.twoFactorQrAlt} className="w-48 h-48" />
                  </div>
                )}
                {twoFactorSecret && (
                  <div className="mt-4">
                    <p className="text-xs text-gray-400 mb-1">Or enter this code manually:</p>
                    <p className="font-mono text-sm glass-card px-3 py-2 rounded-lg select-all break-all">
                      {twoFactorSecret}
                    </p>
                  </div>
                )}
              </div>
              
              <div className="p-4 rounded-xl glass-card">
                <h3 className="font-semibold mb-2">{t.step2Verify}</h3>
                <p className="text-sm text-gray-400 mb-4">
                  {t.step2Hint}
                </p>
                <input
                  type="text"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full px-4 py-3 rounded-xl glass-card focus:border-white/20 focus:outline-none text-white text-center tracking-widest font-mono text-lg"
                  placeholder={t.placeholderCode6}
                  maxLength={6}
                  data-testid="input-verify-2fa-code"
                />
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => { setShow2FASetup(false); setVerifyCode(''); setTwoFactorSecret(null); setTwoFactorQR(null); }}
                  className="flex-1 px-4 py-3 rounded-xl glass-card transition font-semibold"
                >
                  {t.cancel}
                </button>
                <button
                  onClick={handleVerify2FA}
                  disabled={setting2FA || verifyCode.length !== 6}
                  className="flex-1 px-4 py-3 rounded-xl font-semibold text-black bg-white hover:bg-white/90 transition-all disabled:opacity-50"
                  data-testid="button-verify-2fa"
                >
                  {setting2FA ? t.verifying : t.enable2FA}
                </button>
              </div>
            </div>
          ) : (
            // 2FA not enabled
            <div className="space-y-4">
              <p className="text-gray-400 text-sm">
                {t.twoFactorIntro}
              </p>
              <button
                onClick={handleSetup2FA}
                disabled={setting2FA}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg font-semibold text-black bg-white hover:bg-slate-100 transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                data-testid="button-setup-2fa"
              >
                {setting2FA ? t.loadingGeneric : t.setup2FA}
              </button>
            </div>
          )}
        </div>

        {/* Change Password */}
        <div
          className="glass-panel rounded-xl sm:rounded-2xl p-4 sm:p-6"
        >
          <h2 className="text-lg sm:text-xl font-bold mb-3 sm:mb-4 flex items-center gap-2">
            <Lock className="w-4 h-4 sm:w-5 sm:h-5" />
            {t.changePasswordTitle}
          </h2>
          
          {user?.authProvider !== 'email' ? (
            <p className="text-sm text-slate-400">
              {t.passwordOAuthOnly}
            </p>
          ) : (
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="text-xs sm:text-sm text-gray-400 block mb-1">{t.currentPassword}</label>
              <div className="relative">
                <input
                  type={showCurrentPassword ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl glass-card focus:border-white/20 focus:outline-none text-white pr-12"
                  placeholder={t.placeholderCurrentPw}
                  data-testid="input-current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                >
                  {showCurrentPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
            
            <div>
              <label className="text-xs sm:text-sm text-gray-400 block mb-1">{t.newPassword}</label>
              <div className="relative">
                <input
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl glass-card focus:border-white/20 focus:outline-none text-white pr-12"
                  placeholder={t.placeholderNewPw}
                  data-testid="input-new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                >
                  {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
            
            <div>
              <label className="text-xs sm:text-sm text-gray-400 block mb-1">{t.confirmPassword}</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl glass-card focus:border-white/20 focus:outline-none text-white"
                placeholder={t.placeholderConfirmPw}
                data-testid="input-confirm-password"
              />
            </div>
            
            <button
              type="submit"
              disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-black bg-white hover:bg-slate-100 transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              data-testid="button-change-password"
            >
              {changingPassword ? t.changingPassword : t.changePassword}
            </button>
          </form>
          )}
        </div>

        {/* Subscription & Billing Management */}
        {canAccessBilling && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="glass-panel rounded-xl sm:rounded-2xl p-4 sm:p-6"
          >
            <h2 className="text-lg sm:text-xl font-bold mb-3 sm:mb-4 flex items-center gap-2">
              <CreditCard className="w-4 h-4 sm:w-5 sm:h-5" />
              {canAccessPremium ? t.subscriptionTitle : t.billingTitle}
            </h2>
            
            {subscriptionLoading && canAccessPremium ? (
              <p className="text-gray-400 text-sm sm:text-base">{t.loadingSubscription}</p>
            ) : (
              <div className="space-y-3 sm:space-y-4">
                {canAccessPremium && (
                  <>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <label className="text-xs sm:text-sm text-gray-400">{t.currentPlan}</label>
                        <p className="text-xl sm:text-2xl font-bold text-white">
                          {getTierName(user.subscriptionTier)}
                        </p>
                      </div>
                      <div className="text-right">
                        <label className="text-xs sm:text-sm text-gray-400">{t.price}</label>
                        <p className="text-xl sm:text-2xl font-bold">
                          {getTierPrice(user.subscriptionTier)}<span className="text-xs sm:text-sm text-gray-400">{t.perMonth}</span>
                        </p>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs sm:text-sm text-gray-400">{t.status}</label>
                      {subscription?.cancelAtPeriodEnd ? (
                        <p className="text-base sm:text-lg flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-orange-500" />
                          <span className="text-orange-400">
                            {formatSettingsCopy(t.cancelsOn, {
                              date: new Date(subscription.currentPeriodEnd * 1000).toLocaleDateString(),
                            })}
                          </span>
                        </p>
                      ) : (
                        <p className="text-base sm:text-lg flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-green-500" />
                          {subscriptionStatusLabel(user.subscriptionStatus)}
                        </p>
                      )}
                    </div>

                    {subscription?.currentPeriodEnd && !subscription?.cancelAtPeriodEnd && (
                      <div>
                        <label className="text-xs sm:text-sm text-gray-400">{t.nextBilling}</label>
                        <p className="text-base sm:text-lg">{new Date(subscription.currentPeriodEnd * 1000).toLocaleDateString()}</p>
                      </div>
                    )}
                  </>
                )}

                {!canAccessPremium && (
                  <p className="text-gray-400 text-sm sm:text-base">
                    {t.billingPortalHint}
                  </p>
                )}

                <div className={`${canAccessPremium ? 'pt-4 border-t border-white/10' : ''} flex flex-col sm:flex-row gap-3`}>
                  <button
                    onClick={async () => {
                      if (openingPortal) return;
                      setOpeningPortal(true);
                      try {
                        const { url } = await stripeAPI.createPortalSession();
                        window.open(url, '_blank');
                      } catch (error) {
                        toast.error(t.toastBillingPortalFailed);
                      } finally {
                        setOpeningPortal(false);
                      }
                    }}
                    disabled={openingPortal}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium text-black bg-white hover:bg-white/90 transition-all hover:scale-[1.02] disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100"
                    data-testid="button-manage-billing"
                  >
                    <CreditCard className="w-4 h-4" />
                    {openingPortal ? t.opening : (canAccessPremium ? t.manageSubscription : t.viewBilling)}
                    {!openingPortal && <ExternalLink className="w-3.5 h-3.5 opacity-70" />}
                  </button>
                  {user?.stripeSubscriptionId && !subscription?.cancelAtPeriodEnd && (
                    <button
                      onClick={() => setShowCancelModal(true)}
                      className="text-red-400 hover:text-red-300 transition flex items-center gap-2 px-4 py-2.5"
                      data-testid="button-cancel-subscription"
                    >
                      <AlertTriangle className="w-4 h-4" />
                      {t.cancelAction}
                    </button>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* Legal */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-panel rounded-xl sm:rounded-2xl p-4 sm:p-6"
        >
          <h2 className="text-lg sm:text-xl font-bold mb-3 sm:mb-4 flex items-center gap-2">
            <Shield className="w-4 h-4 sm:w-5 sm:h-5" />
            {t.legalTitle}
          </h2>
          
          <div className="space-y-3">
            <Link
              to="/terms"
              className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition"
            >
              <FileText className="w-5 h-5 text-gray-400" />
              <span>{t.terms}</span>
            </Link>
            <Link
              to="/privacy"
              className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition"
            >
              <Shield className="w-5 h-5 text-gray-400" />
              <span>{t.privacy}</span>
            </Link>
            <Link
              to="/cookies"
              className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition"
            >
              <Cookie className="w-5 h-5 text-gray-400" />
              <span>{t.cookies}</span>
            </Link>
          </div>
        </motion.div>
      </div>

      {/* Cancel Confirmation Modal */}
      <AnimatePresence>
        {showCancelModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowCancelModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-panel-strong rounded-2xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-red-500/20">
                    <AlertTriangle className="w-6 h-6 text-red-400" />
                  </div>
                  <h3 className="text-xl font-bold">{t.modalCancelTitle}</h3>
                </div>
                <button
                  onClick={() => setShowCancelModal(false)}
                  className="p-2 hover:bg-white/10 rounded-lg transition"
                  data-testid="button-close-cancel-modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-gray-300 mb-6">
                {t.modalCancelBody}
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowCancelModal(false)}
                  className="flex-1 px-6 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-semibold transition"
                  data-testid="button-keep-subscription"
                >
                  {t.keepSubscription}
                </button>
                <button
                  onClick={handleCancelClick}
                  className="flex-1 px-6 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-xl font-semibold transition"
                  data-testid="button-proceed-cancel"
                >
                  {t.proceedCancel}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Retention Modal */}
      <AnimatePresence>
        {showRetentionModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowRetentionModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-panel-strong rounded-2xl p-8 max-w-lg w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg glass-card">
                    <TrendingUp className="w-8 h-8 text-white/70" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold">{t.retentionTitle}</h3>
                    <p className="text-gray-400">{t.retentionSubtitle}</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowRetentionModal(false)}
                  className="p-2 hover:bg-white/10 rounded-lg transition"
                  data-testid="button-close-retention-modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4 mb-6">
                <div className="p-4 rounded-xl glass-card">
                  <h4 className="font-bold text-lg mb-2 flex items-center gap-2">
                    <span className="text-2xl">💎</span>
                    {t.retentionThinkTitle}
                  </h4>
                  <p className="text-gray-300 text-sm">
                    {formatSettingsCopy(t.retentionThinkBody, { tier: getTierName(user.subscriptionTier) })}
                  </p>
                </div>

                <div className="p-4 rounded-xl glass-card">
                  <h4 className="font-bold mb-2">{t.retentionBenefitsTitle}</h4>
                  <ul className="text-sm text-gray-300 space-y-1">
                    <li>
                      {formatSettingsCopy(t.retentionCreditsMonthly, {
                        credits:
                          user.subscriptionTier === 'starter'
                            ? '2,900'
                            : user.subscriptionTier === 'pro'
                              ? '8,900'
                              : '24,900',
                      })}
                    </li>
                    <li>{t.retentionPremiumModels}</li>
                    <li>{t.retentionPrioritySupport}</li>
                    <li>{t.retentionCommercial}</li>
                    {user.subscriptionTier === 'pro' && <li>{t.retentionProLine}</li>}
                    {user.subscriptionTier === 'business' && <li>{t.retentionBusinessLine}</li>}
                  </ul>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleConfirmCancel}
                  disabled={cancelMutation.isPending}
                  className="flex-1 px-6 py-3 glass-card rounded-xl font-semibold transition disabled:opacity-50"
                  data-testid="button-confirm-cancel"
                >
                  {cancelMutation.isPending ? t.cancelling : t.cancelAnyway}
                </button>
                <button
                  onClick={() => {
                    setShowRetentionModal(false);
                    toast.success(t.toastGladYouStay);
                  }}
                  className="flex-1 px-6 py-3 bg-white text-black hover:bg-white/90 rounded-xl font-semibold transition"
                  data-testid="button-stay-subscribed"
                >
                  {t.keepMySubscription}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Enroll for API — Telegram */}
      <AnimatePresence>
        {showApiEnrollModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowApiEnrollModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-panel-strong rounded-2xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-violet-500/20">
                    <Key className="w-6 h-6 text-violet-300" />
                  </div>
                  <h3 className="text-xl font-bold">{t.apiEnrollModalTitle}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowApiEnrollModal(false)}
                  className="p-2 hover:bg-white/10 rounded-lg transition"
                  aria-label={t.apiEnrollClose}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-gray-300 text-sm mb-6">{t.apiEnrollModalBody}</p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => setShowApiEnrollModal(false)}
                  className="flex-1 px-5 py-3 glass-card rounded-xl font-semibold transition"
                >
                  {t.apiEnrollClose}
                </button>
                <a
                  href={TELEGRAM_ENROLL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 px-5 py-3 bg-violet-600 hover:bg-violet-500 text-white text-center rounded-xl font-semibold transition inline-flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  {t.apiEnrollTelegramCta}
                </a>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
