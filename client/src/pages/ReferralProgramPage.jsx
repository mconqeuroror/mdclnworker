import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Copy, RefreshCw } from "lucide-react";
import { referralAPI } from "../services/api";
import { resolveLocale } from "../components/generateAIModelFormCopy";
import { REFERRAL_PAGE_COPY, formatReferralCopy } from "../data/referralProgramCopy";

const formatUsd = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;

export default function ReferralProgramPage() {
  const t = REFERRAL_PAGE_COPY[resolveLocale()] || REFERRAL_PAGE_COPY.en;
  const [loading, setLoading] = useState(true);
  const [savingCode, setSavingCode] = useState(false);
  const [requestingPayout, setRequestingPayout] = useState(false);
  const [overview, setOverview] = useState(null);
  const [suffix, setSuffix] = useState("");
  const [walletAddress, setWalletAddress] = useState("");

  const loadOverview = async () => {
    setLoading(true);
    try {
      const data = await referralAPI.getOverview();
      if (data.success) {
        setOverview(data);
        setSuffix(data.referralCode || "");
      } else {
        toast.error(data.message || "Failed to load referral program");
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load referral program");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const handleSaveSuffix = async () => {
    if (!suffix.trim()) {
      toast.error(t.enterSuffix);
      return;
    }
    setSavingCode(true);
    try {
      const data = await referralAPI.setMyCode(suffix.trim());
      if (data.success) {
        toast.success("Referral link updated");
        await loadOverview();
      } else {
        toast.error(data.message || "Could not save suffix");
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not save suffix");
    } finally {
      setSavingCode(false);
    }
  };

  const handleCopyLink = async () => {
    if (!overview?.referralLink) return;
    await navigator.clipboard.writeText(overview.referralLink);
    toast.success(t.copied);
  };

  const handleRequestPayout = async () => {
    if (!walletAddress.trim()) {
      toast.error("Enter your USDT (Solana) wallet address");
      return;
    }
    setRequestingPayout(true);
    try {
      const data = await referralAPI.requestPayout(walletAddress.trim());
      if (data.success) {
        toast.success(t.payoutSubmitted);
        setWalletAddress("");
        await loadOverview();
      } else {
        toast.error(data.message || t.payoutFailed);
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || t.payoutFailed);
    } finally {
      setRequestingPayout(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 rounded-2xl border border-white/10 bg-white/5 text-center text-gray-300">
        Loading referral program...
      </div>
    );
  }

  const summary = overview?.summary || {};

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <h2 className="text-xl font-semibold text-white">{t.title}</h2>
        <p className="text-sm text-gray-400 mt-1">
          {formatReferralCopy(t.intro, { amount: formatUsd(summary.minPayoutCents) })}
        </p>
        <p className="text-xs text-gray-500 mt-2">{t.trackingNote}</p>

        <div className="grid md:grid-cols-5 gap-3 mt-4">
          <StatCard label={t.statRegistered} value={String(summary.registeredReferralsCount || 0)} />
          <StatCard label={t.statSpend} value={formatUsd(summary.totalReferredSpendCents)} />
          <StatCard label={t.statReward} value={formatUsd(summary.totalRewardCents)} />
          <StatCard label={t.statPaid} value={formatUsd(summary.totalPaidCents)} />
          <StatCard
            label={summary.eligibleCents < 0 ? t.statBalanceOwed : t.statEligibleNow}
            value={formatUsd(summary.eligibleCents)}
          />
        </div>
      </div>

      {overview?.referralVideoUrl && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <h3 className="font-semibold text-white mb-2">How Kuba earned his first $1k without having to work</h3>
          <div className="rounded-xl overflow-hidden bg-black/40 border border-white/10">
            <video
              src={overview.referralVideoUrl}
              controls
              className="w-full max-h-[50vh]"
              playsInline
              preload="metadata"
            >
              {t.videoUnsupported}
            </video>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <h3 className="font-semibold text-white">Your Referral Link</h3>
        <div className="flex flex-col md:flex-row gap-3 mt-3">
          <input
            value={suffix}
            onChange={(e) => setSuffix(e.target.value)}
            placeholder="custom-suffix"
            className="flex-1 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-white"
          />
          <button
            onClick={handleSaveSuffix}
            disabled={savingCode}
            className="px-4 py-2 rounded-xl border border-white/35 bg-white text-black hover:bg-white/90 transition-all disabled:opacity-45 disabled:cursor-not-allowed"
          >
            {savingCode ? t.saving : t.saveSuffix}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Allowed: 4-30 chars, lowercase letters, numbers, "-" or "_". Some suffixes are reserved.
        </p>
        <p className="text-xs text-emerald-300/90 mt-1">
          Your suffix is also your referral checkout code - users can paste it directly at checkout.
        </p>

        {overview?.referralLink && (
          <div className="mt-3 flex flex-col md:flex-row gap-2">
            <input
              readOnly
              value={overview.referralLink}
              className="flex-1 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-gray-300"
            />
            <button
              onClick={handleCopyLink}
              className="px-3 py-2 rounded-xl border border-white/35 bg-white text-black hover:bg-white/90 flex items-center gap-2 justify-center transition-all"
            >
              <Copy className="w-4 h-4" />
              {t.copy}
            </button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <h3 className="font-semibold text-white">Payout</h3>
        {overview?.pendingRequest ? (
          <p className="text-sm text-yellow-300 mt-2">
            You already have a pending payout request ({formatUsd(overview.pendingRequest.amountCents)}). You can request another payout after admin marks it as paid.
          </p>
        ) : (
          <>
            <p className="text-sm text-gray-400 mt-2">
              Enter your USDT (SPL on Solana) wallet address and request payout when eligible.
            </p>
            <div className="flex flex-col md:flex-row gap-3 mt-3">
              <input
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                placeholder="Solana wallet (base58, 32-44 chars)"
                className="flex-1 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-white"
              />
              <button
                onClick={handleRequestPayout}
                disabled={requestingPayout || !summary.canRequestPayout}
                className="px-4 py-2 rounded-xl border border-emerald-400/35 bg-emerald-500/15 backdrop-blur-xl text-emerald-200 hover:bg-emerald-500/25 transition-all disabled:opacity-45 disabled:cursor-not-allowed"
              >
                {requestingPayout ? t.submitting : t.getPaid}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Do not use exchange memo/deposit addresses. Use a wallet that can receive USDT on Solana.
            </p>
          </>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white">{t.referredHeading}</h3>
          <button
            onClick={loadOverview}
            className="p-2 rounded-lg border border-white/10 hover:bg-white/10"
            title={t.refreshTitle}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-white/10">
                <th className="py-2">User</th>
                <th className="py-2">Spend</th>
                <th className="py-2">Your Reward</th>
              </tr>
            </thead>
            <tbody>
              {(overview?.referrals || []).map((u) => (
                <tr key={u.id} className="border-b border-white/5">
                  <td className="py-2 text-gray-200">{u.name || u.email}</td>
                  <td className="py-2">{formatUsd(u.spendCents)}</td>
                  <td className="py-2 text-emerald-300">{formatUsd(u.rewardCents)}</td>
                </tr>
              ))}
              {(!overview?.referrals || overview.referrals.length === 0) && (
                <tr>
                  <td colSpan={3} className="py-4 text-gray-500">
                    {t.noReferrals}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-lg font-semibold text-white mt-1">{value}</p>
    </div>
  );
}
