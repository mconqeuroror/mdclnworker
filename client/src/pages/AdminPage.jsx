import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { 
  Users, Search, Plus, Trash2, DollarSign, Activity, Settings, Shield, Key,
  ChevronDown, ChevronUp, RefreshCw, BarChart3, Palette, Mail, ArrowLeft,
  Copy, Check, AlertTriangle, Zap, Server, Clock, TrendingUp, TrendingDown,
  ChevronLeft, ChevronRight, X, Send, UserX, Download, Loader2, Wallet, ExternalLink,
  Ban,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { adminAPI, adminTelemetryAPI, affiliateLanderAdminAPI, brandingAPI, formatApiError, referralAPI, tutorialsAPI, uploadToCloudinary as uploadFile } from '../services/api';
import AddCreditsAdminModal from '../components/AddCreditsAdminModal';
import EditUserSettingsModal from '../components/EditUserSettingsModal';
import NsfwOverrideModal from '../components/NsfwOverrideModal';
import { copyTextToClipboard, selectElementContents } from '../utils/clipboard.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const getTotalCredits = (u) =>
  (u.subscriptionCredits || 0) + (u.purchasedCredits || 0) + (u.credits || 0);
const fmt$ = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtDurationMs = (ms) => {
  const n = Number(ms || 0);
  if (!Number.isFinite(n) || n <= 0) return '0s';
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)}s`;
  return `${(n / 60_000).toFixed(1)}m`;
};
const PROVIDER_NAME_RE = /\b(heygen|elevenlabs?|kling|nanobanana|nano\s*banana|replicate|fal(?:\.ai)?|wavespeed|openrouter|apify|kie)\b/ig;
const redactProviderText = (value, fallback = '—') => {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  return raw.replace(PROVIDER_NAME_RE, 'provider');
};

const formatPromptTemplateLabel = (key = '') =>
  String(key || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());

const WINBACK_VISUAL_DEFAULTS = {
  codeLabel: "Discount code",
  discountLabel: "Discount",
  appliesLabel: "Applies to",
  appliesValue: "First membership checkout",
  expiresLabel: "Expires",
  ctaText: "Claim membership offer",
  notePrimary: "Code is single-use and tied to your first membership purchase.",
  noteSecondary: "If you've already joined, you can ignore this email.",
};

const buildWinbackVisualHtml = (v = WINBACK_VISUAL_DEFAULTS) => `
<div style="background:#f7f7f5;border:1px solid #e2e2de;border-radius:4px;padding:20px 22px;margin-bottom:16px;">
  <p style="font-size:13px;color:#9b9b93;margin-bottom:8px;">${v.codeLabel || WINBACK_VISUAL_DEFAULTS.codeLabel}</p>
  <p style="font-size:30px;line-height:1.1;font-weight:600;color:#111;font-family:'DM Mono', monospace;">{{DISCOUNT_CODE}}</p>
</div>
<table style="width:100%;border-collapse:collapse;font-size:13px;color:#555550;margin:0 0 18px;">
  <tr><td style="padding:8px 0;border-bottom:1px solid #e8e8e4;">${v.discountLabel || WINBACK_VISUAL_DEFAULTS.discountLabel}</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #e8e8e4;"><strong>{{DISCOUNT_PERCENT}}%</strong></td></tr>
  <tr><td style="padding:8px 0;border-bottom:1px solid #e8e8e4;">${v.appliesLabel || WINBACK_VISUAL_DEFAULTS.appliesLabel}</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #e8e8e4;">${v.appliesValue || WINBACK_VISUAL_DEFAULTS.appliesValue}</td></tr>
  <tr><td style="padding:8px 0;">${v.expiresLabel || WINBACK_VISUAL_DEFAULTS.expiresLabel}</td><td style="padding:8px 0;text-align:right;">{{EXPIRES_AT}}</td></tr>
</table>
<p style="margin:0 0 16px;"><a href="{{DASHBOARD_URL}}" class="cta-btn">${v.ctaText || WINBACK_VISUAL_DEFAULTS.ctaText}</a></p>
<p class="note">${v.notePrimary || WINBACK_VISUAL_DEFAULTS.notePrimary}</p>
<p class="note">${v.noteSecondary || WINBACK_VISUAL_DEFAULTS.noteSecondary}</p>`;

const TELEMETRY_OPTIONS = [
  { value: 1,   label: '1h'  },
  { value: 24,  label: '24h' },
  { value: 72,  label: '72h' },
  { value: 168, label: '7d'  },
];

const TIER_LABELS = {
  free: 'Free', starter: 'Starter', pro: 'Pro', business: 'Business',
  enterprise: 'Enterprise',
};

// All countries (ISO 3166-1 alpha-2) for email audience region filter
const COUNTRY_LIST = [
  { code: 'AF', name: 'Afghanistan' }, { code: 'AL', name: 'Albania' }, { code: 'DZ', name: 'Algeria' }, { code: 'AD', name: 'Andorra' },
  { code: 'AO', name: 'Angola' }, { code: 'AG', name: 'Antigua and Barbuda' }, { code: 'AR', name: 'Argentina' }, { code: 'AM', name: 'Armenia' },
  { code: 'AU', name: 'Australia' }, { code: 'AT', name: 'Austria' }, { code: 'AZ', name: 'Azerbaijan' }, { code: 'BS', name: 'Bahamas' },
  { code: 'BH', name: 'Bahrain' }, { code: 'BD', name: 'Bangladesh' }, { code: 'BB', name: 'Barbados' }, { code: 'BY', name: 'Belarus' },
  { code: 'BE', name: 'Belgium' }, { code: 'BZ', name: 'Belize' }, { code: 'BJ', name: 'Benin' }, { code: 'BT', name: 'Bhutan' },
  { code: 'BO', name: 'Bolivia' }, { code: 'BA', name: 'Bosnia and Herzegovina' }, { code: 'BW', name: 'Botswana' }, { code: 'BR', name: 'Brazil' },
  { code: 'BN', name: 'Brunei' }, { code: 'BG', name: 'Bulgaria' }, { code: 'BF', name: 'Burkina Faso' }, { code: 'BI', name: 'Burundi' },
  { code: 'KH', name: 'Cambodia' }, { code: 'CM', name: 'Cameroon' }, { code: 'CA', name: 'Canada' }, { code: 'CV', name: 'Cape Verde' },
  { code: 'CF', name: 'Central African Republic' }, { code: 'TD', name: 'Chad' }, { code: 'CL', name: 'Chile' }, { code: 'CN', name: 'China' },
  { code: 'CO', name: 'Colombia' }, { code: 'KM', name: 'Comoros' }, { code: 'CG', name: 'Congo' }, { code: 'CR', name: 'Costa Rica' },
  { code: 'HR', name: 'Croatia' }, { code: 'CU', name: 'Cuba' }, { code: 'CY', name: 'Cyprus' }, { code: 'CZ', name: 'Czech Republic' },
  { code: 'DK', name: 'Denmark' }, { code: 'DJ', name: 'Djibouti' }, { code: 'DM', name: 'Dominica' }, { code: 'DO', name: 'Dominican Republic' },
  { code: 'EC', name: 'Ecuador' }, { code: 'EG', name: 'Egypt' }, { code: 'SV', name: 'El Salvador' }, { code: 'GQ', name: 'Equatorial Guinea' },
  { code: 'ER', name: 'Eritrea' }, { code: 'EE', name: 'Estonia' }, { code: 'ET', name: 'Ethiopia' }, { code: 'FJ', name: 'Fiji' },
  { code: 'FI', name: 'Finland' }, { code: 'FR', name: 'France' }, { code: 'GA', name: 'Gabon' }, { code: 'GM', name: 'Gambia' },
  { code: 'GE', name: 'Georgia' }, { code: 'DE', name: 'Germany' }, { code: 'GH', name: 'Ghana' }, { code: 'GR', name: 'Greece' },
  { code: 'GD', name: 'Grenada' }, { code: 'GT', name: 'Guatemala' }, { code: 'GN', name: 'Guinea' }, { code: 'GW', name: 'Guinea-Bissau' },
  { code: 'GY', name: 'Guyana' }, { code: 'HT', name: 'Haiti' }, { code: 'HN', name: 'Honduras' }, { code: 'HK', name: 'Hong Kong' },
  { code: 'HU', name: 'Hungary' }, { code: 'IS', name: 'Iceland' }, { code: 'IN', name: 'India' }, { code: 'ID', name: 'Indonesia' },
  { code: 'IR', name: 'Iran' }, { code: 'IQ', name: 'Iraq' }, { code: 'IE', name: 'Ireland' }, { code: 'IL', name: 'Israel' },
  { code: 'IT', name: 'Italy' }, { code: 'CI', name: 'Ivory Coast' }, { code: 'JM', name: 'Jamaica' }, { code: 'JP', name: 'Japan' },
  { code: 'JO', name: 'Jordan' }, { code: 'KZ', name: 'Kazakhstan' }, { code: 'KE', name: 'Kenya' }, { code: 'KW', name: 'Kuwait' },
  { code: 'KG', name: 'Kyrgyzstan' }, { code: 'LA', name: 'Laos' }, { code: 'LV', name: 'Latvia' }, { code: 'LB', name: 'Lebanon' },
  { code: 'LS', name: 'Lesotho' }, { code: 'LR', name: 'Liberia' }, { code: 'LY', name: 'Libya' }, { code: 'LI', name: 'Liechtenstein' },
  { code: 'LT', name: 'Lithuania' }, { code: 'LU', name: 'Luxembourg' }, { code: 'MO', name: 'Macau' }, { code: 'MG', name: 'Madagascar' },
  { code: 'MW', name: 'Malawi' }, { code: 'MY', name: 'Malaysia' }, { code: 'MV', name: 'Maldives' }, { code: 'ML', name: 'Mali' },
  { code: 'MT', name: 'Malta' }, { code: 'MR', name: 'Mauritania' }, { code: 'MU', name: 'Mauritius' }, { code: 'MX', name: 'Mexico' },
  { code: 'MD', name: 'Moldova' }, { code: 'MC', name: 'Monaco' }, { code: 'MN', name: 'Mongolia' }, { code: 'ME', name: 'Montenegro' },
  { code: 'MA', name: 'Morocco' }, { code: 'MZ', name: 'Mozambique' }, { code: 'MM', name: 'Myanmar' }, { code: 'NA', name: 'Namibia' },
  { code: 'NP', name: 'Nepal' }, { code: 'NL', name: 'Netherlands' }, { code: 'NZ', name: 'New Zealand' }, { code: 'NI', name: 'Nicaragua' },
  { code: 'NE', name: 'Niger' }, { code: 'NG', name: 'Nigeria' }, { code: 'MK', name: 'North Macedonia' }, { code: 'NO', name: 'Norway' },
  { code: 'OM', name: 'Oman' }, { code: 'PK', name: 'Pakistan' }, { code: 'PS', name: 'Palestine' }, { code: 'PA', name: 'Panama' },
  { code: 'PG', name: 'Papua New Guinea' }, { code: 'PY', name: 'Paraguay' }, { code: 'PE', name: 'Peru' }, { code: 'PH', name: 'Philippines' },
  { code: 'PL', name: 'Poland' }, { code: 'PT', name: 'Portugal' }, { code: 'PR', name: 'Puerto Rico' }, { code: 'QA', name: 'Qatar' },
  { code: 'RO', name: 'Romania' }, { code: 'RU', name: 'Russia' }, { code: 'RW', name: 'Rwanda' }, { code: 'SA', name: 'Saudi Arabia' },
  { code: 'SN', name: 'Senegal' }, { code: 'RS', name: 'Serbia' }, { code: 'SG', name: 'Singapore' }, { code: 'SK', name: 'Slovakia' },
  { code: 'SI', name: 'Slovenia' }, { code: 'SO', name: 'Somalia' }, { code: 'ZA', name: 'South Africa' }, { code: 'KR', name: 'South Korea' },
  { code: 'SS', name: 'South Sudan' }, { code: 'ES', name: 'Spain' }, { code: 'LK', name: 'Sri Lanka' }, { code: 'SD', name: 'Sudan' },
  { code: 'SR', name: 'Suriname' }, { code: 'SE', name: 'Sweden' }, { code: 'CH', name: 'Switzerland' }, { code: 'SY', name: 'Syria' },
  { code: 'TW', name: 'Taiwan' }, { code: 'TJ', name: 'Tajikistan' }, { code: 'TZ', name: 'Tanzania' }, { code: 'TH', name: 'Thailand' },
  { code: 'TL', name: 'Timor-Leste' }, { code: 'TG', name: 'Togo' }, { code: 'TT', name: 'Trinidad and Tobago' }, { code: 'TN', name: 'Tunisia' },
  { code: 'TR', name: 'Turkey' }, { code: 'TM', name: 'Turkmenistan' }, { code: 'UG', name: 'Uganda' }, { code: 'UA', name: 'Ukraine' },
  { code: 'AE', name: 'United Arab Emirates' }, { code: 'GB', name: 'United Kingdom' }, { code: 'US', name: 'United States' }, { code: 'UY', name: 'Uruguay' },
  { code: 'UZ', name: 'Uzbekistan' }, { code: 'VE', name: 'Venezuela' }, { code: 'VN', name: 'Vietnam' }, { code: 'YE', name: 'Yemen' },
  { code: 'ZM', name: 'Zambia' }, { code: 'ZW', name: 'Zimbabwe' },
].sort((a, b) => a.name.localeCompare(b.name));

// Spend ranges for email audience.
const SPEND_RANGE_OPTIONS = [
  { value: '', label: 'Any (no filter)', minCents: null, maxCents: null },
  { value: 'spent-zero', label: '$0 only', minCents: 0, maxCents: 0 },
  { value: 'spent-any', label: 'Spent any amount (>$0)', minCents: 1, maxCents: null },
];

// Marketing languages (same as user preferences)
const MARKETING_LANGUAGE_OPTIONS = [
  { code: 'en', name: 'English' }, { code: 'sk', name: 'Slovenčina' }, { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' }, { code: 'fr', name: 'Français' }, { code: 'pl', name: 'Polski' }, { code: 'cs', name: 'Čeština' },
];

/** Admin UI: generation credit costs (keys must match backend DEFAULT_GENERATION_PRICING) */
const GENERATION_PRICING_GROUPS = [
  {
    title: 'AI model workflows',
    fields: [
      { key: 'modelCreateAi', label: 'Full AI model create' },
      { key: 'modelStep1Reference', label: 'Model step 1 — reference' },
      { key: 'modelStep2Poses', label: 'Model step 2 — poses' },
      { key: 'modelFromPhotosAdvanced', label: 'Model from photos (advanced)' },
    ],
  },
  {
    title: 'Images',
    fields: [
      { key: 'imageIdentity', label: 'Image — identity' },
      { key: 'imagePromptCasual', label: 'Image — casual prompt' },
      { key: 'imagePromptNsfw', label: 'Image — NSFW prompt' },
      { key: 'imageFaceSwap', label: 'Image — face swap' },
      { key: 'analyzeLooks', label: 'Analyze looks' },
      { key: 'describeTargetImage', label: 'Describe target image' },
    ],
  },
  {
    title: 'ModelClone-X, Upscaler & LoRA training',
    fields: [
      { key: 'upscalerImage', label: 'Upscaler — per image' },
      { key: 'modelcloneXNoModel1', label: 'ModelClone-X — 1 image (no character)' },
      { key: 'modelcloneXWithModel1', label: 'ModelClone-X — 1 image (with character)' },
      { key: 'modelcloneXNoModel2', label: 'ModelClone-X — 2 images (no character)' },
      { key: 'modelcloneXWithModel2', label: 'ModelClone-X — 2 images (with character)' },
      { key: 'modelcloneXExtraStepsPer10', label: 'ModelClone-X — extra cost per +10 steps over default' },
      { key: 'loraTrainingStandard', label: 'LoRA training — Standard (NSFW + ModelClone-X)' },
      { key: 'loraTrainingPro', label: 'LoRA training — Pro (NSFW + ModelClone-X)' },
    ],
  },
  {
    title: 'NSFW — Nudes pack',
    fields: [
      { key: 'nudesPackCreditsMin', label: 'Nudes pack — credits per image when all poses selected (min rate)' },
      { key: 'nudesPackCreditsMax', label: 'Nudes pack — credits for a single-pose selection (max per image)' },
    ],
  },
  {
    title: 'Creator Studio (Image Generation)',
    fields: [
      { key: 'creatorStudio1K2K', label: 'Creator Studio — 1K / 2K image' },
      { key: 'creatorStudio4K', label: 'Creator Studio — 4K image' },
      { key: 'nanoBananaFlash1K', label: 'Creator Studio — Nano Banana Flash 1K (per image)' },
      { key: 'nanoBanana2Flash4K', label: 'Creator Studio — Nano Banana 2 Flash 4K (per image)' },
      { key: 'nanoBananaPro4K', label: 'Creator Studio — Nano Banana Pro 4K (per image)' },
      { key: 'creatorStudioFluxKontextPro', label: 'Creator Studio — Flux Kontext Pro (per image)' },
      { key: 'creatorStudioFluxKontextMax', label: 'Creator Studio — Flux Kontext Max (per image)' },
      { key: 'creatorStudioWan27Image', label: 'Creator Studio — Wan 2.7 Image (per image)' },
      { key: 'creatorStudioWan27ImagePro', label: 'Creator Studio — Wan 2.7 Image Pro (per image)' },
      { key: 'creatorStudioIdeogramTurbo', label: 'Creator Studio — Ideogram V3 Turbo (per image)' },
      { key: 'creatorStudioIdeogramBalanced', label: 'Creator Studio — Ideogram V3 Balanced (per image)' },
      { key: 'creatorStudioIdeogramQuality', label: 'Creator Studio — Ideogram V3 Quality (per image)' },
      { key: 'creatorStudioSeedream45Edit', label: 'Creator Studio — Seedream 4.5 Edit (per run)' },
      { key: 'creatorStudioAssetCreate', label: 'Creator Studio — Volcanic asset create (per asset)' },
    ],
  },
  {
    title: 'Real Avatars + Voice hosting',
    fields: [
      { key: 'avatarCreation', label: 'Avatar creation (one-time fee)' },
      { key: 'avatarMonthly', label: 'Avatar monthly maintenance' },
      { key: 'avatarVideoPerSec', label: 'Avatar video generation (per second)' },
      { key: 'voiceMonthly', label: 'Custom voice hosting — monthly debit per saved voice' },
    ],
  },
  {
    title: 'Prompt tools',
    fields: [
      { key: 'enhancePromptDefault', label: 'Enhance prompt (default)' },
      { key: 'enhancePromptNsfw', label: 'Enhance prompt (NSFW)' },
    ],
  },
  {
    title: 'Video',
    fields: [
      { key: 'videoRecreateMotionProPerSec', label: 'Video recreate — classic (Motion Control 2.6 · 1080p) credits / sec' },
      { key: 'videoRecreateUltraPerSec', label: 'Video recreate — ultra (Motion Control Pro+ · 1080p) credits / sec' },
      { key: 'wan22AnimateMove480pPerSec', label: 'WAN animate-move recreate — 480p credits / sec' },
      { key: 'wan22AnimateMove580pPerSec', label: 'WAN animate-move recreate — 580p credits / sec' },
      { key: 'wan22AnimateMove720pPerSec', label: 'WAN animate-move recreate — 720p credits / sec' },
      { key: 'wan22AnimateReplace480pPerSec', label: 'WAN animate-replace recreate — 480p credits / sec' },
      { key: 'wan22AnimateReplace580pPerSec', label: 'WAN animate-replace recreate — 580p credits / sec' },
      { key: 'wan22AnimateReplace720pPerSec', label: 'WAN animate-replace recreate — 720p credits / sec' },
      { key: 'wan26T2v720pPerSec', label: 'WAN 2.6 t2v — 720p credits / sec' },
      { key: 'wan26T2v1080pPerSec', label: 'WAN 2.6 t2v — 1080p credits / sec' },
      { key: 'wan26I2v720pPerSec', label: 'WAN 2.6 i2v — 720p credits / sec' },
      { key: 'wan26I2v1080pPerSec', label: 'WAN 2.6 i2v — 1080p credits / sec' },
      { key: 'wan27T2v720pPerSec', label: 'WAN 2.7 t2v — 720p credits / sec' },
      { key: 'wan27T2v1080pPerSec', label: 'WAN 2.7 t2v — 1080p credits / sec' },
      { key: 'wan27I2v720pPerSec', label: 'WAN 2.7 i2v — 720p credits / sec' },
      { key: 'wan27I2v1080pPerSec', label: 'WAN 2.7 i2v — 1080p credits / sec' },
      { key: 'wan27R2v720pPerSec', label: 'WAN 2.7 replace(r2v) — 720p credits / sec' },
      { key: 'wan27R2v1080pPerSec', label: 'WAN 2.7 replace(r2v) — 1080p credits / sec' },
      { key: 'wan27Edit720pPerSec', label: 'WAN 2.7 edit — 720p credits / sec' },
      { key: 'wan27Edit1080pPerSec', label: 'WAN 2.7 edit — 1080p credits / sec' },
      { key: 'videoRecreateStdPerSec', label: 'Video recreate — legacy std (unused; classic uses row above)' },
      { key: 'sora2Standard10Frames', label: 'Sora 2 Pro — standard 10 frames' },
      { key: 'sora2Standard15Frames', label: 'Sora 2 Pro — standard 15 frames' },
      { key: 'sora2High10Frames', label: 'Sora 2 Pro — high 10 frames' },
      { key: 'sora2High15Frames', label: 'Sora 2 Pro — high 15 frames' },
      { key: 'sora2Storyboard10s', label: 'Sora 2 Pro storyboard — 10s' },
      { key: 'sora2Storyboard15To25s', label: 'Sora 2 Pro storyboard — 15 to 25s' },
      { key: 'sora2WatermarkRemoverPerSec', label: 'Sora 2 — KIE watermark remover credits / sec (chained job)' },
      { key: 'kling30StdNoSoundPerSec', label: 'Kling 3.0 std (no sound) credits / sec' },
      { key: 'kling30StdSoundPerSec', label: 'Kling 3.0 std (with sound) credits / sec' },
      { key: 'kling30ProNoSoundPerSec', label: 'Kling 3.0 pro (no sound) credits / sec' },
      { key: 'kling30ProSoundPerSec', label: 'Kling 3.0 pro (with sound) credits / sec' },
      { key: 'kling26NoSound5s', label: 'Kling 2.6 no sound — 5s' },
      { key: 'kling26NoSound10s', label: 'Kling 2.6 no sound — 10s' },
      { key: 'kling26Sound5s', label: 'Kling 2.6 with sound — 5s' },
      { key: 'kling26Sound10s', label: 'Kling 2.6 with sound — 10s' },
      { key: 'veo31GenerateFast1080p8s', label: 'Veo 3.1 generate fast 1080p 8s' },
      { key: 'veo31GenerateQuality1080p8s', label: 'Veo 3.1 generate quality 1080p 8s' },
      { key: 'veo31ExtendFast', label: 'Veo 3.1 extend fast' },
      { key: 'veo31ExtendQuality', label: 'Veo 3.1 extend quality' },
      { key: 'veo31Render1080p', label: 'Veo 3.1 render 1080p' },
      { key: 'veo31Upscale4k', label: 'Veo 3.1 upscale 4K' },
      { key: 'seedance2StandardPerSec', label: 'Seedance 2 — standard mode credits / sec' },
      { key: 'seedance2FastPerSec', label: 'Seedance 2 — fast mode credits / sec' },
      { key: 'videoPrompt5s', label: 'Video from prompt — 5s' },
      { key: 'videoPrompt10s', label: 'Video from prompt — 10s' },
      { key: 'videoFaceSwapPerSec', label: 'Video face swap — credits / sec' },
      { key: 'talkingHeadMin', label: 'Talking head — minimum' },
      { key: 'talkingHeadPerSecondX10', label: 'Talking head — per second ×10' },
    ],
  },
];

// ── Primitive UI components ───────────────────────────────────────────────────

const Section = ({ children, className = '' }) => (
  <div className={`rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4 sm:p-6 ${className}`}>
    {children}
  </div>
);

const SectionHeader = ({ title, actions }) => (
  <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
    <h2 className="text-sm font-semibold text-white tracking-tight">{title}</h2>
    {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
  </div>
);

const KpiCard = ({ label, value, sub, accent = false, trend }) => (
  <div className={`rounded-xl p-4 border ${accent ? 'border-white/10 bg-white/[0.06]' : 'border-white/[0.06] bg-white/[0.03]'}`}>
    <p className="text-[11px] text-gray-500 uppercase tracking-widest mb-1">{label}</p>
    <div className="flex items-end gap-1.5">
      <p className="text-xl font-semibold text-white leading-none">{value}</p>
      {trend !== undefined && (
        trend > 0
          ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400 mb-0.5" />
          : trend < 0
          ? <TrendingDown className="w-3.5 h-3.5 text-red-400 mb-0.5" />
          : null
      )}
    </div>
    {sub && <p className="text-[11px] text-gray-600 mt-1.5">{sub}</p>}
  </div>
);

const PillNav = ({ options, value, onChange }) => (
  <div className="inline-flex items-center rounded-lg border border-white/[0.07] bg-black/40 p-0.5 gap-0.5">
    {options.map((o) => (
      <button
        key={o.value}
        onClick={() => onChange(o.value)}
        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
          value === o.value ? 'bg-white text-black' : 'text-gray-400 hover:text-white hover:bg-white/[0.07]'
        }`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

const GhostBtn = ({ onClick, disabled, children, className = '', ...rest }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`px-3 py-1.5 rounded-lg border border-white/[0.07] bg-white/[0.04] hover:bg-white/[0.08] text-xs text-gray-300 hover:text-white transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 ${className}`}
    {...rest}
  >
    {children}
  </button>
);

const PrimaryBtn = ({ onClick, disabled, children, className = '', ...rest }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`px-3 py-1.5 rounded-lg bg-white text-black text-xs font-semibold hover:bg-gray-100 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 ${className}`}
    {...rest}
  >
    {children}
  </button>
);

const DangerBtn = ({ onClick, disabled, children, className = '', ...rest }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`px-3 py-1.5 rounded-lg border border-red-500/20 bg-red-500/[0.08] hover:bg-red-500/[0.15] text-xs text-red-400 transition disabled:opacity-40 flex items-center gap-1.5 ${className}`}
    {...rest}
  >
    {children}
  </button>
);

const Badge = ({ children, variant = 'default' }) => {
  const cls = {
    default: 'bg-white/[0.06] text-gray-400 border-white/[0.07]',
    green:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    red:     'bg-red-500/10 text-red-400 border-red-500/20',
    yellow:  'bg-amber-500/10 text-amber-400 border-amber-500/20',
    blue:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
    purple:  'bg-purple-500/10 text-purple-400 border-purple-500/20',
  }[variant] || 'bg-white/[0.06] text-gray-400 border-white/[0.07]';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium ${cls}`}>
      {children}
    </span>
  );
};

const CollapseToggle = ({ open, onToggle, label }) => (
  <button
    onClick={onToggle}
    className="inline-flex items-center gap-1.5 text-sm font-semibold hover:text-white/70 transition text-white"
  >
    {label}
    {open ? <ChevronUp className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
  </button>
);

const THead = ({ cols }) => (
  <thead>
    <tr className="border-b border-white/[0.06]">
      {cols.map(({ label, align = 'left' }) => (
        <th key={label} className={`py-2.5 px-3 text-[11px] font-medium text-gray-500 uppercase tracking-wider text-${align} whitespace-nowrap`}>
          {label}
        </th>
      ))}
    </tr>
  </thead>
);

// Copy-to-clipboard button
function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button onClick={copy} className="ml-1 p-0.5 rounded text-gray-600 hover:text-gray-300 transition flex-shrink-0" title="Copy">
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

// Confirm modal for destructive actions
function ConfirmModal({ open, title, message, onConfirm, onCancel, danger = false }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#111] p-6 shadow-2xl">
        <h3 className="text-sm font-semibold mb-2">{title}</h3>
        <p className="text-xs text-gray-400 mb-5 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-2">
          <GhostBtn onClick={onCancel}>Cancel</GhostBtn>
          {danger
            ? <DangerBtn onClick={onConfirm}>Confirm</DangerBtn>
            : <PrimaryBtn onClick={onConfirm}>Confirm</PrimaryBtn>
          }
        </div>
      </div>
    </div>
  );
}

function ManageUserPurchasesModal({ open, user, purchases, loading, refundingId, onClose, onRefund }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-3xl rounded-2xl border border-white/[0.08] bg-[#111] p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold">Manage User Purchases</h3>
            <p className="text-xs text-gray-500 mt-1">{user?.email || '—'}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <div className="overflow-x-auto max-h-[60vh]">
          <table className="w-full text-sm">
            <THead cols={[
              { label: 'Date' },
              { label: 'Type' },
              { label: 'Credits' },
              { label: 'Billing ID' },
              { label: 'Status' },
              { label: 'Action', align: 'right' },
            ]} />
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-gray-500">Loading purchases…</td>
                </tr>
              )}
              {!loading && purchases.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-gray-500">No refundable purchases found.</td>
                </tr>
              )}
              {!loading && purchases.map((p) => (
                <tr key={p.purchaseId} className="border-b border-white/[0.04]">
                  <td className="py-2.5 px-3 text-[11px] text-gray-400 whitespace-nowrap">{fmtDate(p.createdAt)}</td>
                  <td className="py-2.5 px-3 text-xs text-gray-300">{p.type}</td>
                  <td className="py-2.5 px-3 text-xs text-white font-medium">{p.amountCredits}</td>
                  <td className="py-2.5 px-3 text-[11px] text-gray-500 font-mono">{p.paymentSessionId || '—'}</td>
                  <td className="py-2.5 px-3">
                    <Badge variant={p.refunded ? 'yellow' : 'green'}>
                      {p.refunded ? 'Refunded' : 'Paid'}
                    </Badge>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <DangerBtn
                      disabled={p.refunded || refundingId === p.purchaseId}
                      onClick={() => onRefund(p)}
                      className="text-[11px] py-1 px-2"
                    >
                      {refundingId === p.purchaseId ? 'Refunding…' : 'Refund'}
                    </DangerBtn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ── Data state ──────────────────────────────────────────────────────────────
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [usersPagination, setUsersPagination] = useState({ total: 0, totalPages: 1, page: 1 });
  const [referralData, setReferralData] = useState({ users: [], pendingPayoutRequests: [] });
  const [telemetryOverview, setTelemetryOverview] = useState(null);
  const [endpointHealth, setEndpointHealth] = useState({ checkedAt: null, items: [] });
  const [edgeEvents, setEdgeEvents] = useState([]);
  const [reelProfiles, setReelProfiles] = useState([]);
  const [reelLogs, setReelLogs] = useState([]);
  const [stripeRevenue, setStripeRevenue] = useState(null);
  const [stripeRevenueError, setStripeRevenueError] = useState(null);
  const [backupHistory, setBackupHistory] = useState([]);

  // ── Loading state ───────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loadingReferrals, setLoadingReferrals] = useState(false);
  const [reconcileLoading, setReconcileLoading] = useState(false);
  const [reconcileReferralsLoading, setReconcileReferralsLoading] = useState(false);
  const [reconciliationItems, setReconciliationItems] = useState([]);
  const [linkingReferralUserId, setLinkingReferralUserId] = useState(null);
  const [payingReferralUserId, setPayingReferralUserId] = useState(null);
  const [loadingTelemetry, setLoadingTelemetry] = useState(false);
  const [loadingReelFinder, setLoadingReelFinder] = useState(false);
  const [loadingBranding, setLoadingBranding] = useState(false);
  const [savingBranding, setSavingBranding] = useState(false);
  const [stripeRevenueLoading, setStripeRevenueLoading] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [recoverLoading, setRecoverLoading] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  // Unsubscribe list
  const [unsubLoading, setUnsubLoading] = useState(false);
  const [unsubData, setUnsubData] = useState(null);
  const [unsubSearch, setUnsubSearch] = useState("");

  // Discount codes
  const [discountCodes, setDiscountCodes] = useState([]);
  const [discountCodesLoading, setDiscountCodesLoading] = useState(false);
  const [showDiscountCodes, setShowDiscountCodes] = useState(false);
  const [discountForm, setDiscountForm] = useState({ code: '', discountType: 'percentage', discountValue: '', appliesTo: 'both', validUntil: '', maxUses: '', minPurchaseAmount: '' });
  const [discountFormLoading, setDiscountFormLoading] = useState(false);

  // Referral bonus modal
  const [bonusModal, setBonusModal] = useState(null); // { userId, email }
  const [bonusAmount, setBonusAmount] = useState("");
  const [bonusNote, setBonusNote] = useState("");
  const [bonusLoading, setBonusLoading] = useState(false);

  // ── Modal / confirm state ───────────────────────────────────────────────────
  const [selectedUser, setSelectedUser] = useState(null);
  const [showAddCredits, setShowAddCredits] = useState(false);
  const [showEditSettings, setShowEditSettings] = useState(false);
  const [showNsfwOverride, setShowNsfwOverride] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmSendAll, setConfirmSendAll] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(null); // backup object to restore from
  const [confirmReferralPayout, setConfirmReferralPayout] = useState(null); // { userId, email, eligibleCents }
  const [confirmResetGenPricing, setConfirmResetGenPricing] = useState(false);
  const [advancingReferralUserId, setAdvancingReferralUserId] = useState(null); // userId being toggled
  const [emailSendResult, setEmailSendResult] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [activeCampaignId, setActiveCampaignId] = useState(null);
  const [showManagePurchases, setShowManagePurchases] = useState(false);
  const [userPurchases, setUserPurchases] = useState([]);
  const [loadingPurchases, setLoadingPurchases] = useState(false);
  const [refundingPurchaseId, setRefundingPurchaseId] = useState(null);
  const [showImpersonateModal, setShowImpersonateModal] = useState(false);
  const [impersonateLoading, setImpersonateLoading] = useState(false);
  const [impersonatePayload, setImpersonatePayload] = useState(null);
  const [syncingStripeUserId, setSyncingStripeUserId] = useState(null);
  const [showApiKeysModal, setShowApiKeysModal] = useState(false);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [apiKeysList, setApiKeysList] = useState([]);
  const [apiKeyNameDraft, setApiKeyNameDraft] = useState('');
  const [apiKeyCorsDraft, setApiKeyCorsDraft] = useState('');
  const [apiKeyPlanOverride, setApiKeyPlanOverride] = useState(false);
  const [newApiKeyPlain, setNewApiKeyPlain] = useState(null);
  const [apiKeyWorkingId, setApiKeyWorkingId] = useState(null);
  const newApiKeyTextareaRef = useRef(null);

  // ── UI toggle state ─────────────────────────────────────────────────────────
  const [showUsers, setShowUsers] = useState(false);
  const [showDailyTracking, setShowDailyTracking] = useState(false);
  const [showTrackedProfiles, setShowTrackedProfiles] = useState(false);
  const [showScrapeLogs, setShowScrapeLogs] = useState(false);
  const [showBrandSettings, setShowBrandSettings] = useState(true);
  const [showTelemetryDashboard, setShowTelemetryDashboard] = useState(false);
  const [showEdgeEvents, setShowEdgeEvents] = useState(false);
  const [showInfraMetrics, setShowInfraMetrics] = useState(false);
  const [showChildSafetyReports, setShowChildSafetyReports] = useState(false);
  const [showPlanBreakdown, setShowPlanBreakdown] = useState(false);
  const [showBackupPanel, setShowBackupPanel] = useState(false);
  const [showTopSpenders, setShowTopSpenders] = useState(true);

  const [affiliateLanders, setAffiliateLanders] = useState([]);
  const [affiliateLandersLoading, setAffiliateLandersLoading] = useState(false);
  const [newAffLanderSuffix, setNewAffLanderSuffix] = useState('');
  const [creatingAffLander, setCreatingAffLander] = useState(false);

  // ── Filter / control state ──────────────────────────────────────────────────
  const [statsPeriod, setStatsPeriod] = useState('week');
  const [statsYear, setStatsYear] = useState(new Date().getFullYear());
  const [telemetryHours, setTelemetryHours] = useState(24);
  const [search, setSearch] = useState('');
  const [usersPage, setUsersPage] = useState(1);
  const [dailyMonth, setDailyMonth] = useState('');
  const [selectedDailyDate, setSelectedDailyDate] = useState('');
  const [dailyRangeStart, setDailyRangeStart] = useState(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 6);
    return start.toISOString().slice(0, 10);
  });
  const [dailyRangeEnd, setDailyRangeEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [recoverStripeId, setRecoverStripeId] = useState('');
  const [recoverResult, setRecoverResult] = useState(null);
  const [refillAuditForm, setRefillAuditForm] = useState({
    days: 90,
    userId: '',
    email: '',
  });
  const [refillAuditLoading, setRefillAuditLoading] = useState(false);
  const [refillReconcileLoading, setRefillReconcileLoading] = useState(false);
  const [refillAuditResult, setRefillAuditResult] = useState(null);
  const [refillReconcileResult, setRefillReconcileResult] = useState(null);
  const [selectedRefillInvoiceIds, setSelectedRefillInvoiceIds] = useState([]);
  const [loraRecoveryForm, setLoraRecoveryForm] = useState({
    userId: '',
    modelName: '',
    falLoraUrl: '',
    triggerWord: '',
    enableNsfw: true,
  });
  const [loraRecoveryLoading, setLoraRecoveryLoading] = useState(false);
  const [loraRecoveryResult, setLoraRecoveryResult] = useState(null);
  const [lostGenForm, setLostGenForm] = useState({
    userId: '',
    limit: 200,
  });
  const [lostGenLoading, setLostGenLoading] = useState(false);
  const [lostGenResult, setLostGenResult] = useState(null);
  const [lostGenAllLoading, setLostGenAllLoading] = useState(false);
  const [lostGenAllResult, setLostGenAllResult] = useState(null);
  const [runpodBatchLoading, setRunpodBatchLoading] = useState(false);
  const [runpodBatchResult, setRunpodBatchResult] = useState(null);
  const [voiceHostingDue, setVoiceHostingDue] = useState(null);
  const [voiceHostingDueLoading, setVoiceHostingDueLoading] = useState(false);
  const [voiceHostingRunUserId, setVoiceHostingRunUserId] = useState('');
  const [voiceHostingRunLoading, setVoiceHostingRunLoading] = useState(false);
  const [newReelUsername, setNewReelUsername] = useState('');
  const [bulkReelUsernames, setBulkReelUsernames] = useState('');
  const [clearReelsLoading, setClearReelsLoading] = useState(false);
  const [confirmClearReels, setConfirmClearReels] = useState(false);
  const [clearReelsRescrape, setClearReelsRescrape] = useState(true);

  // Generation pricing (credits per action)
  const [showGenerationPricing, setShowGenerationPricing] = useState(false);
  const [genPricing, setGenPricing] = useState(null);
  const [genPricingDefaults, setGenPricingDefaults] = useState(null);
  const [genPricingContract, setGenPricingContract] = useState(null);
  const [loadingGenPricing, setLoadingGenPricing] = useState(false);
  const [savingGenPricing, setSavingGenPricing] = useState(false);
  const [showProviderBalances, setShowProviderBalances] = useState(false);
  const [providerBalances, setProviderBalances] = useState(null);
  const [loadingProviderBalances, setLoadingProviderBalances] = useState(false);
  const [showVoicePlatform, setShowVoicePlatform] = useState(false);
  const [voicePlatformMax, setVoicePlatformMax] = useState(200);
  const [voicePlatformUsed, setVoicePlatformUsed] = useState(0);
  const [loadingVoicePlatform, setLoadingVoicePlatform] = useState(false);
  const [savingVoicePlatform, setSavingVoicePlatform] = useState(false);
  const [cleaningZombieVoices, setCleaningZombieVoices] = useState(false);
  const [zombieVoiceCleanupResult, setZombieVoiceCleanupResult] = useState(null);
  const [showPromptTemplates, setShowPromptTemplates] = useState(false);
  const [promptTemplatesMap, setPromptTemplatesMap] = useState({});
  const [promptTemplatesOverridesMap, setPromptTemplatesOverridesMap] = useState({});
  const [promptTemplateKnownKeys, setPromptTemplateKnownKeys] = useState([]);
  const [promptTemplateSearch, setPromptTemplateSearch] = useState('');
  const [activePromptTemplateKey, setActivePromptTemplateKey] = useState('');
  const [activePromptTemplateDraft, setActivePromptTemplateDraft] = useState('');
  const [loadingPromptTemplates, setLoadingPromptTemplates] = useState(false);
  const [savingPromptTemplates, setSavingPromptTemplates] = useState(false);
  const [showSafetyCheckerConfig, setShowSafetyCheckerConfig] = useState(false);
  const [safetyCheckerConfigText, setSafetyCheckerConfigText] = useState("{}");
  const [loadingSafetyCheckerConfig, setLoadingSafetyCheckerConfig] = useState(false);
  const [savingSafetyCheckerConfig, setSavingSafetyCheckerConfig] = useState(false);
  const [showNudesPackPoseOverrides, setShowNudesPackPoseOverrides] = useState(false);
  const [nudesPackPoseOverridesText, setNudesPackPoseOverridesText] = useState("{}");
  const [nudesPackPoseCatalog, setNudesPackPoseCatalog] = useState([]);
  const [nudesPackPoseViewMode, setNudesPackPoseViewMode] = useState('structured');
  const [nudesPackPoseSearch, setNudesPackPoseSearch] = useState('');
  const [loadingNudesPackPoseOverrides, setLoadingNudesPackPoseOverrides] = useState(false);
  const [savingNudesPackPoseOverrides, setSavingNudesPackPoseOverrides] = useState(false);
  const [reconcileLimit, setReconcileLimit] = useState(250);
  const [reconcileAllUsers, setReconcileAllUsers] = useState(false);
  const [reconcileResult, setReconcileResult] = useState(null);
  const [reconciliationLimit, setReconciliationLimit] = useState(100);
  const [childSafetyIncidents, setChildSafetyIncidents] = useState([]);
  const [childSafetyLoading, setChildSafetyLoading] = useState(false);
  const [childSafetyPage, setChildSafetyPage] = useState(1);
  const [childSafetyPagination, setChildSafetyPagination] = useState({ page: 1, pages: 1, total: 0, limit: 50 });

  // ── Brand / email ───────────────────────────────────────────────────────────
  const [brandSettings, setBrandSettings] = useState({
    appName: 'ModelClone', logoUrl: '', faviconUrl: '', baseUrl: 'https://modelclone.app', tutorialVideoUrl: '', landerDemoVideoUrl: '',
    termsMarkdown: '', privacyMarkdown: '', cookiesMarkdown: '',
  });
  const [tutorialVideoUploading, setTutorialVideoUploading] = useState(false);
  const [landerDemoVideoUploading, setLanderDemoVideoUploading] = useState(false);
  const [tutorialSlots, setTutorialSlots] = useState([]);
  const [loadingTutorialSlots, setLoadingTutorialSlots] = useState(false);
  const [uploadingTutorialSlot, setUploadingTutorialSlot] = useState("");
  const [emailBuilder, setEmailBuilder] = useState({
    subject: 'Important Update from ModelClone',
    headline: 'Important News',
    bodyText: 'Write your update here...\n\nYou can use multiple paragraphs.',
    ctaText: 'Open Dashboard',
    ctaUrl: 'https://modelclone.app/dashboard',
    heroImageUrl: '', imageUrls: [], videoUrl: '', testEmail: '',
  });
  const [winbackEmailTemplate, setWinbackEmailTemplate] = useState({
    subject: '{{DISCOUNT_PERCENT}}% off your first membership is waiting',
    title: '{{DISCOUNT_PERCENT}}% Off Your First Membership',
    intro: 'Hey {{NAME}}, thanks for signing up. We saved a private first-membership discount for you.',
    content: '',
  });
  const [loadingWinbackTemplate, setLoadingWinbackTemplate] = useState(false);
  const [savingWinbackTemplate, setSavingWinbackTemplate] = useState(false);
  const [winbackVisualEditor, setWinbackVisualEditor] = useState(WINBACK_VISUAL_DEFAULTS);
  const [emailAudience, setEmailAudience] = useState({
    verifiedOnly: true,
    subscriptionStatuses: [],
    subscriptionTiers: [],
    spendRange: '',
    minReferrals: '',
    regions: [],
    languages: [],
  });
  
  const requestIdRef = useRef(0);

  // ── Data loaders ─────────────────────────────────────────────────────────────

  const loadStats = async (period = statsPeriod, year = statsYear, date = null) => {
    try {
      const p = new URLSearchParams();
      if (date) { p.set('period', 'date'); p.set('date', date); }
      else { p.set('period', period); if (period === 'year') p.set('year', String(year)); }
      const r = await api.get(`/admin/stats?${p}`);
      if (r.data.success) setStats(r.data.stats);
    } catch (e) {
      if (e.response?.status === 403) toast.error('Access denied');
    }
  };

  const loadStatsRange = async (start, end) => {
    let s = start;
    let e = end;
    if (s > e) [s, e] = [e, s];
    try {
      const p = new URLSearchParams();
      p.set('period', 'range');
      p.set('startDate', s);
      p.set('endDate', e);
      const r = await api.get(`/admin/stats?${p}`);
      if (r.data.success) setStats(r.data.stats);
      else toast.error(r.data.message || 'Invalid date range');
    } catch (err) {
      if (err.response?.status === 403) toast.error('Access denied');
      else if (err.response?.data?.message) toast.error(err.response.data.message);
    }
  };

  const loadStripeRevenue = async (period = statsPeriod, year = statsYear, bust = false, date = null) => {
    setStripeRevenueLoading(true);
    setStripeRevenueError(null);
    try {
      const p = new URLSearchParams();
      if (date) { p.set('period', 'date'); p.set('date', date); }
      else { p.set('period', period); if (period === 'year') p.set('year', String(year)); }
      if (bust) p.set('bust', Date.now());
      const r = await api.get(`/admin/stripe-revenue?${p}`);
      if (r.data.success) setStripeRevenue({ ...r.data.data, _cached: r.data.cached });
      else { setStripeRevenue(null); setStripeRevenueError(r.data.message || 'Failed to load'); }
    } catch (e) {
      console.warn('[admin] stripe-revenue failed:', e?.response?.data || e?.message);
      const msg = e?.response?.data?.message || e?.message || 'Network error';
      setStripeRevenue(null);
      setStripeRevenueError(msg);
    } finally {
      setStripeRevenueLoading(false);
    }
  };

  const loadStripeRevenueRange = async (start, end, bust = false) => {
    let s = start;
    let e = end;
    if (s > e) [s, e] = [e, s];
    setStripeRevenueLoading(true);
    setStripeRevenueError(null);
    try {
      const p = new URLSearchParams();
      p.set('period', 'range');
      p.set('startDate', s);
      p.set('endDate', e);
      if (bust) p.set('bust', Date.now());
      const r = await api.get(`/admin/stripe-revenue?${p}`);
      if (r.data.success) setStripeRevenue({ ...r.data.data, _cached: r.data.cached });
      else { setStripeRevenue(null); setStripeRevenueError(r.data.message || 'Failed to load'); }
    } catch (e) {
      console.warn('[admin] stripe-revenue failed:', e?.response?.data || e?.message);
      const msg = e?.response?.data?.message || e?.message || 'Network error';
      setStripeRevenue(null);
      setStripeRevenueError(msg);
    } finally {
      setStripeRevenueLoading(false);
    }
  };

  const loadAffiliateLanders = async () => {
    setAffiliateLandersLoading(true);
    try {
      const r = await affiliateLanderAdminAPI.list();
      if (r?.success) setAffiliateLanders(r.items || []);
    } catch (e) {
      toast.error(formatApiError(e, 'Failed to load affiliate landers'));
    } finally {
      setAffiliateLandersLoading(false);
    }
  };

  const createAffiliateLander = async () => {
    const raw = newAffLanderSuffix
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (raw.length < 2) {
      toast.error('Enter a path suffix (e.g. summer-promo)');
      return;
    }
    setCreatingAffLander(true);
    try {
      const r = await affiliateLanderAdminAPI.create(raw);
      if (r?.success && r.suffix) {
        toast.success('Affiliate lander created');
        setNewAffLanderSuffix('');
        await loadAffiliateLanders();
        navigate(`/admin/affiliate-lander-editor/${encodeURIComponent(r.suffix)}`);
      }
    } catch (e) {
      toast.error(formatApiError(e, 'Could not create lander'));
    } finally {
      setCreatingAffLander(false);
    }
  };

  const deleteAffiliateLander = async (suf) => {
    if (!window.confirm(`Delete affiliate lander /aff/${suf}? This cannot be undone.`)) return;
    try {
      await affiliateLanderAdminAPI.remove(suf);
      toast.success('Deleted');
      loadAffiliateLanders();
    } catch (e) {
      toast.error(formatApiError(e, 'Delete failed'));
    }
  };

  // ── Initial load & period / range sync ─────────────────────────────────────
  useEffect(() => {
    loadUsers('', 1);
    loadReferrals();
    loadReferralReconciliation();
    loadTelemetry(telemetryHours);
    loadReelFinderAdmin();
    loadBranding();
    loadWinbackEmailTemplate();
    loadTutorialSlots();
    loadBackupHistory();
    loadCampaigns();
    loadAffiliateLanders();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { loadUsers(search, 1); setUsersPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { loadTelemetry(telemetryHours); }, [telemetryHours]);
  useEffect(() => {
    if (showChildSafetyReports) {
      loadChildSafetyIncidents(childSafetyPage);
    }
  }, [showChildSafetyReports, childSafetyPage]);

  useEffect(() => {
    if (showDailyTracking) {
      loadStatsRange(dailyRangeStart, dailyRangeEnd);
      loadStripeRevenueRange(dailyRangeStart, dailyRangeEnd, false);
    } else {
      loadStats(statsPeriod, statsYear, null);
      loadStripeRevenue(statsPeriod, statsYear, false, null);
    }
  }, [statsPeriod, statsYear, showDailyTracking, dailyRangeStart, dailyRangeEnd]);

  useEffect(() => {
    if (showDailyTracking && dailyRangeEnd) {
      setDailyMonth(dailyRangeEnd.slice(0, 7));
    }
  }, [dailyRangeEnd, showDailyTracking]);

  useEffect(() => {
    if (!showDailyTracking) return;
    const series = stats?.dailySeries || [];
    if (!series.length) return;
    setSelectedDailyDate((prev) => {
      if (prev && series.some((r) => r.date === prev)) return prev;
      const sorted = [...series].map((r) => r.date).filter(Boolean).sort();
      return sorted.length ? sorted[sorted.length - 1] : dailyRangeEnd;
    });
  }, [showDailyTracking, stats?.dailySeries, dailyRangeEnd]);

  const loadUsers = async (searchQuery, page = usersPage) => {
    const rid = ++requestIdRef.current;
    try {
      setSearchLoading(true);
      const p = new URLSearchParams({ limit: '50', page: String(page) });
      if (searchQuery.trim()) p.set('search', searchQuery.trim());
      const r = await api.get(`/admin/users?${p}`);
      if (rid !== requestIdRef.current) return;
      if (r.data.success) {
        setUsers(r.data.users);
        setUsersPagination(r.data.pagination || { total: 0, totalPages: 1, page: 1 });
      }
    } catch (e) {
      if (rid === requestIdRef.current && e.response?.status !== 403)
          toast.error('Failed to load users');
    } finally {
      if (rid === requestIdRef.current) { setSearchLoading(false); setLoading(false); }
    }
  };

  const loadTelemetry = async (hours = telemetryHours) => {
    try {
      setLoadingTelemetry(true);
      const [ovRes, epRes, evRes] = await Promise.allSettled([
        adminTelemetryAPI.getOverview(hours),
        adminTelemetryAPI.getEndpointHealth(),
        adminTelemetryAPI.getEdgeEvents(hours, 50),
      ]);
      const ov = ovRes.status === 'fulfilled' ? ovRes.value : null;
      const ep = epRes.status === 'fulfilled' ? epRes.value : null;
      const ev = evRes.status === 'fulfilled' ? evRes.value : null;

      if (ov?.success) setTelemetryOverview(ov.telemetry || null);
      if (ep?.success) setEndpointHealth({ checkedAt: ep.checkedAt, items: ep.items || [] });
      if (ev?.success) setEdgeEvents(ev.events || []);

      const allFailed =
        ovRes.status === 'rejected' &&
        epRes.status === 'rejected' &&
        evRes.status === 'rejected';
      if (allFailed) {
        console.warn('Telemetry endpoints unavailable');
      }
    } catch {
      console.warn('Telemetry load failed');
    }
    finally { setLoadingTelemetry(false); }
  };

  const loadChildSafetyIncidents = async (page = childSafetyPage) => {
    try {
      setChildSafetyLoading(true);
      const p = new URLSearchParams();
      p.set('page', String(page));
      p.set('limit', '50');
      const r = await api.get(`/admin/safety/child-incidents?${p.toString()}`);
      if (r.data?.success) {
        setChildSafetyIncidents(Array.isArray(r.data.items) ? r.data.items : []);
        setChildSafetyPagination(r.data.pagination || { page, pages: 1, total: 0, limit: 50 });
        setChildSafetyPage(page);
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to load child safety incidents');
    } finally {
      setChildSafetyLoading(false);
    }
  };

  const loadBranding = async () => {
    try {
      setLoadingBranding(true);
      const r = await brandingAPI.getAdminBranding();
      if (r?.success && r?.branding) setBrandSettings({
        appName: r.branding.appName || 'ModelClone',
        logoUrl: r.branding.logoUrl || '',
        faviconUrl: r.branding.faviconUrl || '',
        baseUrl: r.branding.baseUrl || 'https://modelclone.app',
        tutorialVideoUrl: r.branding.tutorialVideoUrl || '',
        landerDemoVideoUrl: r.branding.landerDemoVideoUrl || '',
        termsMarkdown: r.branding.termsMarkdown || '',
        privacyMarkdown: r.branding.privacyMarkdown || '',
        cookiesMarkdown: r.branding.cookiesMarkdown || '',
      });
    } catch { toast.error('Failed to load brand settings'); }
    finally { setLoadingBranding(false); }
  };

  const loadWinbackEmailTemplate = async () => {
    try {
      setLoadingWinbackTemplate(true);
      const r = await api.get('/admin/winback-email-template');
      if (r.data?.success && r.data?.template) {
        setWinbackEmailTemplate({
          subject: String(r.data.template.subject || ''),
          title: String(r.data.template.title || ''),
          intro: String(r.data.template.intro || ''),
          content: String(r.data.template.content || ''),
        });
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to load winback email template');
    } finally {
      setLoadingWinbackTemplate(false);
    }
  };

  const saveWinbackEmailTemplate = async () => {
    try {
      setSavingWinbackTemplate(true);
      const payload = {
        template: {
          subject: winbackEmailTemplate.subject,
          title: winbackEmailTemplate.title,
          intro: winbackEmailTemplate.intro,
          content: winbackEmailTemplate.content,
        },
      };
      const r = await api.put('/admin/winback-email-template', payload);
      if (r.data?.success && r.data?.template) {
        setWinbackEmailTemplate({
          subject: String(r.data.template.subject || ''),
          title: String(r.data.template.title || ''),
          intro: String(r.data.template.intro || ''),
          content: String(r.data.template.content || ''),
        });
        toast.success('Winback email template saved');
      } else {
        toast.error('Failed to save winback email template');
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to save winback email template');
    } finally {
      setSavingWinbackTemplate(false);
    }
  };

  const applyWinbackVisualEditorToHtml = () => {
    const visualHtml = buildWinbackVisualHtml(winbackVisualEditor);
    setWinbackEmailTemplate((p) => ({ ...p, content: visualHtml }));
    toast.success('Visual layout applied to HTML');
  };

  const winbackVisualPreviewHtml = buildWinbackVisualHtml(winbackVisualEditor)
    .replaceAll('{{DISCOUNT_CODE}}', 'WELCOME15-ABC123')
    .replaceAll('{{DISCOUNT_PERCENT}}', '15')
    .replaceAll('{{EXPIRES_AT}}', 'Apr 25, 2026')
    .replaceAll('{{DASHBOARD_URL}}', '#');

  const loadTutorialSlots = async () => {
    try {
      setLoadingTutorialSlots(true);
      const r = await tutorialsAPI.getAdminSlots();
      if (r?.success) {
        setTutorialSlots(Array.isArray(r.slots) ? r.slots : []);
      }
    } catch {
      toast.error('Failed to load tutorial slots');
    } finally {
      setLoadingTutorialSlots(false);
    }
  };

  const loadReelFinderAdmin = async () => {
    try {
      setLoadingReelFinder(true);
      const [pr, lr] = await Promise.all([
        api.get('/viral-reels/admin/profiles'),
        api.get('/viral-reels/admin/logs'),
      ]);
      if (pr?.data?.success) setReelProfiles(pr.data.profiles || []);
      if (lr?.data?.success) setReelLogs(lr.data.logs || []);
    } catch { toast.error('Failed to load Reel Finder data'); }
    finally { setLoadingReelFinder(false); }
  };

  const loadDiscountCodes = async () => {
    setDiscountCodesLoading(true);
    try {
      const r = await api.get('/admin/discount-codes');
      if (r.data.success) setDiscountCodes(r.data.codes || []);
    } catch { toast.error('Failed to load discount codes'); }
    finally { setDiscountCodesLoading(false); }
  };

  const createDiscountCode = async () => {
    if (!discountForm.code || !discountForm.discountValue || !discountForm.validUntil) {
      return toast.error('Code, value, and expiry are required');
    }
    setDiscountFormLoading(true);
    try {
      const r = await api.post('/admin/discount-codes', discountForm);
      if (r.data.success) {
        toast.success('Discount code created');
        setDiscountForm({ code: '', discountType: 'percentage', discountValue: '', appliesTo: 'both', validUntil: '', maxUses: '', minPurchaseAmount: '' });
        loadDiscountCodes();
      }
    } catch (e) { toast.error(e.response?.data?.error || 'Failed to create'); }
    finally { setDiscountFormLoading(false); }
  };

  const updateDiscountCode = async (id, updates) => {
    try {
      await api.patch(`/admin/discount-codes/${id}`, updates);
      toast.success('Updated');
      loadDiscountCodes();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed to update'); }
  };

  const deactivateDiscountCode = async (id) => {
    try {
      await api.delete(`/admin/discount-codes/${id}`);
      toast.success('Deactivated');
      loadDiscountCodes();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed to deactivate'); }
  };

  const loadReferrals = async () => {
    try {
      setLoadingReferrals(true);
      const r = await api.get('/referrals/admin/overview');
      if (r.data.success) setReferralData({
        users: r.data.users || [],
        pendingPayoutRequests: r.data.pendingPayoutRequests || [],
      });
    } catch { toast.error('Failed to load referrals'); }
    finally { setLoadingReferrals(false); }
  };

  const loadReferralReconciliation = async (limit = reconciliationLimit) => {
    try {
      setReconcileReferralsLoading(true);
      const r = await referralAPI.getReconciliation(limit);
      if (r?.success) {
        setReconciliationItems(r.items || []);
      } else {
        toast.error(r?.message || 'Failed to load referral reconciliation');
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to load referral reconciliation');
    } finally {
      setReconcileReferralsLoading(false);
    }
  };

  const handleManualReferralLink = async ({ userId, referrerUserId, draftId }) => {
    if (!userId || !referrerUserId) return;
    setLinkingReferralUserId(userId);
    try {
      const r = await referralAPI.linkReconciliation({
        userId,
        referrerUserId,
        draftId,
        note: 'Linked via admin reconciliation panel',
      });
      if (r?.success) {
        toast.success('Referral linked');
        await Promise.all([loadReferrals(), loadReferralReconciliation()]);
      } else {
        toast.error(r?.message || 'Failed to link referral');
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to link referral');
    } finally {
      setLinkingReferralUserId(null);
    }
  };

  const handleAddBonus = async () => {
    if (!bonusModal) return;
    const amt = parseFloat(bonusAmount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }
    setBonusLoading(true);
    try {
      const r = await api.post(`/referrals/admin/users/${bonusModal.userId}/add-bonus`, {
        amountUsd: amt,
        note: bonusNote.trim() || undefined,
      });
      if (r.data.success) {
        toast.success(r.data.message);
        setBonusModal(null);
        setBonusAmount('');
        setBonusNote('');
        loadReferrals();
      } else {
        toast.error(r.data.message || 'Failed to add bonus');
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to add bonus');
    } finally {
      setBonusLoading(false);
    }
  };

  const handleReferralReconcile = async (dryRun = true) => {
    setReconcileLoading(true);
    try {
      const r = await api.post('/admin/referrals/reconcile', {
        dryRun,
        scanAll: reconcileAllUsers,
        limit: reconcileAllUsers ? null : reconcileLimit,
      });
      if (r.data?.success) {
        setReconcileResult(r.data);
        if (dryRun) {
          toast.success(`Dry run complete: ${r.data.summary?.eligibleForBackfill || 0} eligible`);
        } else {
          toast.success(`Reconcile complete: ${r.data.summary?.created || 0} commissions created`);
          loadReferrals();
        }
      } else {
        toast.error(r.data?.message || 'Referral reconcile failed');
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Referral reconcile failed');
    } finally {
      setReconcileLoading(false);
    }
  };

  const loadBackupHistory = async () => {
    try {
      const r = await api.get('/admin/backup/history');
      if (r.data?.backups) setBackupHistory(r.data.backups);
    } catch { /* non-critical */ }
  };

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleDeleteUser = async (user) => {
    setConfirmDelete(null);
    try {
      await api.delete(`/admin/users/${user.id}`);
      toast.success('User deleted');
      loadUsers(search, usersPage);
    } catch { toast.error('Failed to delete user'); }
  };

  const handleMarkPaid = async (id) => {
    try {
      await api.post(`/referrals/admin/payout-requests/${id}/mark-paid`, {});
      toast.success('Payout marked as paid');
      loadReferrals();
    } catch (e) { toast.error(e?.response?.data?.message || 'Failed'); }
  };

  const handleMarkReferrerPaid = async (userId) => {
    if (!userId) return;
    setPayingReferralUserId(userId);
    try {
      const r = await referralAPI.markReferrerPaid(userId);
      if (r?.success) {
        toast.success(`Paid ${fmt$(r.paidAmountCents)}. Remaining eligible: ${fmt$(r.remainingEligibleCents)}`);
        await loadReferrals();
      } else {
        toast.error(r?.message || 'Failed to mark payout as paid');
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to mark payout as paid');
    } finally {
      setPayingReferralUserId(null);
      setConfirmReferralPayout(null);
    }
  };

  const handleToggleReferralAdvanced = async (userId, currentAdvanced) => {
    setAdvancingReferralUserId(userId);
    const next = !currentAdvanced;
    try {
      const r = await referralAPI.setAdvanced(userId, next);
      if (r?.success) {
        toast.success(r.message || (next ? 'Promoted to Advanced Program' : 'Removed from Advanced Program'));
        // Optimistic update in local state
        setReferralData(prev => ({
          ...prev,
          users: (prev.users || []).map(u => u.id === userId ? { ...u, referralAdvanced: next } : u),
        }));
      } else {
        toast.error(r?.message || 'Failed to update program status');
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to update program status');
    } finally {
      setAdvancingReferralUserId(null);
    }
  };

  const handleRecoverPayment = async () => {
    if (!recoverStripeId.trim()) return;
    setRecoverLoading(true); setRecoverResult(null);
    try {
      const r = await api.post('/admin/recover-payment', { stripeId: recoverStripeId.trim() });
      setRecoverResult(r.data);
      if (r.data.success && !r.data.alreadyProcessed) toast.success(r.data.message);
      else if (r.data.alreadyProcessed) toast.success('Already processed');
    } catch (e) {
      const msg = e.response?.data?.message || 'Failed';
      setRecoverResult({ success: false, message: msg });
      toast.error(msg);
    } finally { setRecoverLoading(false); }
  };

  const handleRunRefillAudit = async () => {
    setRefillAuditLoading(true);
    setRefillAuditResult(null);
    setRefillReconcileResult(null);
    setSelectedRefillInvoiceIds([]);
    try {
      const result = await adminAPI.auditSubscriptionRefills({
        days: Math.max(1, Math.min(365, parseInt(refillAuditForm.days || 90, 10) || 90)),
        userId: refillAuditForm.userId.trim(),
        email: refillAuditForm.email.trim(),
      });
      setRefillAuditResult(result);
      const foundIds = (result?.findings || []).map((f) => f.invoiceId).filter(Boolean);
      setSelectedRefillInvoiceIds(foundIds);
      if (result?.success) {
        const progress = result?.summary?.progress || {};
        toast.success(
          foundIds.length
            ? `Found ${foundIds.length} missing refill${foundIds.length === 1 ? '' : 's'} (scanned ${progress.usersProcessed || result?.summary?.scannedUsers || 0} users in ${progress.userBatchesScanned || 0} batches)`
            : `No missing refills found (scanned ${progress.usersProcessed || result?.summary?.scannedUsers || 0} users)`,
        );
      } else {
        toast.error(result?.message || 'Refill audit failed');
      }
    } catch (e) {
      const msg = e?.response?.data?.message || 'Refill audit failed';
      setRefillAuditResult({ success: false, message: msg, findings: [], errors: [] });
      toast.error(msg);
    } finally {
      setRefillAuditLoading(false);
    }
  };

  const toggleRefillInvoiceSelection = (invoiceId) => {
    setSelectedRefillInvoiceIds((prev) =>
      prev.includes(invoiceId)
        ? prev.filter((id) => id !== invoiceId)
        : [...prev, invoiceId],
    );
  };

  const handleReconcileRefills = async ({ dryRun = false, selectedOnly = false } = {}) => {
    if (selectedOnly && selectedRefillInvoiceIds.length === 0) {
      toast.error('Select at least one invoice first');
      return;
    }

    setRefillReconcileLoading(true);
    setRefillReconcileResult(null);
    try {
      const result = await adminAPI.reconcileSubscriptionRefills({
        dryRun,
        days: Math.max(1, Math.min(365, parseInt(refillAuditForm.days || 90, 10) || 90)),
        userId: refillAuditForm.userId.trim(),
        email: refillAuditForm.email.trim(),
        invoiceIds: selectedOnly ? selectedRefillInvoiceIds : [],
      });
      setRefillReconcileResult(result);
      const summary = result?.summary || {};
      if (result?.success) {
        const sourceScan = summary?.sourceScanProgress || {};
        const sourceScanSuffix = sourceScan?.usersProcessed
          ? ` · scanned ${sourceScan.usersProcessed} users (${sourceScan.userBatchesScanned || 0} batches)`
          : '';
        if (dryRun) {
          toast.success(`Dry run complete (${summary.requestedInvoices || 0} invoice candidates${sourceScanSuffix})`);
        } else {
          toast.success(
            `Reconciled ${summary.reconciled || 0}, already ${summary.alreadyProcessed || 0}, skipped ${summary.skipped || 0}${sourceScanSuffix}`,
          );
          await handleRunRefillAudit();
        }
      } else {
        toast.error(result?.message || 'Refill reconciliation failed');
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Refill reconciliation failed');
    } finally {
      setRefillReconcileLoading(false);
    }
  };

  const handleLoraRecovery = async () => {
    const payload = {
      userId: loraRecoveryForm.userId.trim(),
      modelName: loraRecoveryForm.modelName.trim(),
      falLoraUrl: loraRecoveryForm.falLoraUrl.trim(),
      triggerWord: loraRecoveryForm.triggerWord.trim() || undefined,
      enableNsfw: !!loraRecoveryForm.enableNsfw,
    };

    if (!payload.userId || !payload.modelName || !payload.falLoraUrl) {
      toast.error('userId, modelName and falLoraUrl are required');
      return;
    }

    setLoraRecoveryLoading(true);
    setLoraRecoveryResult(null);
    try {
      const result = await adminAPI.loraRecovery(payload);
      setLoraRecoveryResult(result);
      if (result?.success) {
        toast.success(result?.message || 'LoRA recovered');
      } else {
        toast.error(result?.error || result?.message || 'LoRA recovery failed');
      }
    } catch (e) {
      const msg = e?.response?.data?.error || e?.response?.data?.message || 'LoRA recovery failed';
      setLoraRecoveryResult({ success: false, message: msg });
      toast.error(msg);
    } finally {
      setLoraRecoveryLoading(false);
    }
  };

  const handleLostGenerationReconcile = async (dryRun = true) => {
    const userId = lostGenForm.userId.trim();
    const limit = Math.max(1, Math.min(1000, parseInt(lostGenForm.limit || 200, 10) || 200));

    if (!userId) {
      toast.error('User ID, email or username is required');
      return;
    }

    setLostGenLoading(true);
    setLostGenResult(null);
    try {
      const result = await adminAPI.reconcileLostGenerations({ userId, limit, dryRun });
      setLostGenResult(result);
      if (result?.success) {
        toast.success(result?.message || (dryRun ? 'Dry run complete' : 'Reconciliation complete'));
      } else {
        toast.error(result?.error || result?.message || 'Reconciliation failed');
      }
    } catch (e) {
      const msg = e?.response?.data?.error || e?.response?.data?.message || 'Reconciliation failed';
      setLostGenResult({ success: false, message: msg });
      toast.error(msg);
    } finally {
      setLostGenLoading(false);
    }
  };

  const handleVoiceHostingDue = async () => {
    setVoiceHostingDueLoading(true);
    try {
      const r = await adminAPI.getVoiceHostingDue();
      setVoiceHostingDue(r);
      if (r?.success) {
        toast.success(`Voice hosting due: ${r.totalDueItems ?? 0} row(s), ${r.distinctUsers ?? 0} user(s)`);
      } else {
        toast.error(r?.message || 'Failed to load report');
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to load voice hosting report');
    } finally {
      setVoiceHostingDueLoading(false);
    }
  };

  const handleVoiceHostingRunAll = async () => {
    setVoiceHostingRunLoading(true);
    try {
      const r = await adminAPI.runVoiceHostingBilling({});
      if (r?.success) {
        const s = r.summary || {};
        toast.success(
          `Voice billing (all): ${s.users ?? 0} users, ${s.totalChargedCredits ?? 0} cr charged, ${s.totalSuspendedVoices ?? 0} suspended`,
        );
        await handleVoiceHostingDue();
      } else {
        toast.error(r?.message || 'Run failed');
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Run failed');
    } finally {
      setVoiceHostingRunLoading(false);
    }
  };

  const handleVoiceHostingRunUser = async () => {
    const uid = voiceHostingRunUserId.trim();
    if (!uid) {
      toast.error('Enter User ID for single-user billing, or use “Run billing (all users)”.');
      return;
    }
    setVoiceHostingRunLoading(true);
    try {
      const r = await adminAPI.runVoiceHostingBilling({ userId: uid });
      if (r?.success) {
        const res = r.result || {};
        toast.success(
          `Voice billing (user): ${res.charged ?? 0} cr charged, ${res.suspended ?? 0} voice(s) suspended`,
        );
        await handleVoiceHostingDue();
      } else {
        toast.error(r?.message || 'Run failed');
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Run failed');
    } finally {
      setVoiceHostingRunLoading(false);
    }
  };

  const handleLostGenerationReconcileAll = async (dryRun = true) => {
    const limit = Math.max(1, Math.min(2000, parseInt(lostGenForm.limit || 500, 10) || 500));
    setLostGenAllLoading(true);
    setLostGenAllResult(null);
    try {
      const result = await adminAPI.reconcileLostGenerationsAll({ limit, dryRun });
      setLostGenAllResult(result);
      if (result?.success) {
        toast.success(result?.message || (dryRun ? 'Dry run complete' : 'Reconciliation complete'));
      } else {
        toast.error(result?.error || result?.message || 'Reconciliation failed');
      }
    } catch (e) {
      const msg = e?.response?.data?.error || e?.response?.data?.message || 'Reconciliation failed';
      setLostGenAllResult({ success: false, message: msg });
      toast.error(msg);
    } finally {
      setLostGenAllLoading(false);
    }
  };

  const handleRunpodBatchReconcile = async () => {
    const limit = Math.max(1, Math.min(500, parseInt(lostGenForm.limit || 200, 10) || 200));
    setRunpodBatchLoading(true);
    setRunpodBatchResult(null);
    try {
      const result = await adminAPI.runRunpodBatchReconcile({
        limit,
        includeTimedOutFailed: true,
      });
      setRunpodBatchResult(result);
      if (result?.success) {
        const d = result?.data || {};
        toast.success(
          `RunPod batch check: recovered ${d.completedRecovered || 0}/${d.checkedWithRunpodJobId || 0} checked`,
        );
      } else {
        toast.error(result?.error || result?.message || 'RunPod batch check failed');
      }
    } catch (e) {
      const msg = e?.response?.data?.error || e?.response?.data?.message || 'RunPod batch check failed';
      setRunpodBatchResult({ success: false, error: msg });
      toast.error(msg);
    } finally {
      setRunpodBatchLoading(false);
    }
  };

  const handleOpenManagePurchases = async (user) => {
    setSelectedUser(user);
    setShowManagePurchases(true);
    setLoadingPurchases(true);
    try {
      const r = await api.get(`/admin/users/${user.id}/purchases`);
      if (r.data?.success) {
        setUserPurchases(r.data.purchases || []);
      } else {
        setUserPurchases([]);
      }
    } catch (e) {
      setUserPurchases([]);
      toast.error(e?.response?.data?.message || 'Failed to load purchases');
    } finally {
      setLoadingPurchases(false);
    }
  };

  const handleRefundPurchase = async (purchase) => {
    if (!selectedUser?.id || !purchase?.purchaseId) return;
    setRefundingPurchaseId(purchase.purchaseId);
    try {
      const r = await api.post(`/admin/users/${selectedUser.id}/purchases/${purchase.purchaseId}/refund`, {});
      if (r.data?.success) {
        toast.success('Purchase refunded');
        const refreshed = await api.get(`/admin/users/${selectedUser.id}/purchases`);
        setUserPurchases(refreshed.data?.purchases || []);
        await loadUsers(search, usersPage);
      } else {
        toast.error(r.data?.message || 'Refund failed');
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Refund failed');
    } finally {
      setRefundingPurchaseId(null);
    }
  };

  const handleGenerateImpersonationLink = async (user) => {
    if (!user?.id) return;
    setSelectedUser(user);
    setImpersonatePayload(null);
    setShowImpersonateModal(true);
    setImpersonateLoading(true);
    try {
      const r = await api.post('/admin/impersonate', { userId: user.id });
      if (r.data?.success) {
        setImpersonatePayload({
          token: r.data.token,
          loginUrl: r.data.absoluteLoginUrl || r.data.loginUrl || '',
          expiresAt: r.data.expiresAt || null,
          user: r.data.user || user,
        });
      } else {
        toast.error(r.data?.message || 'Failed to generate login payload');
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to generate login payload');
      setShowImpersonateModal(false);
    } finally {
      setImpersonateLoading(false);
    }
  };

  const handleSyncStripeForUser = async (user) => {
    if (!user?.id) return;
    setSyncingStripeUserId(user.id);
    try {
      const r = await api.post(`/admin/users/${user.id}/stripe-sync`, {});
      if (r.data?.success) {
        toast.success(`Billing sync completed for ${user.email}`);
        await loadUsers(search, usersPage);
      } else {
        toast.error(r.data?.message || 'Billing sync failed');
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Billing sync failed');
    } finally {
      setSyncingStripeUserId(null);
    }
  };

  const loadUserApiKeys = async (userId) => {
    if (!userId) return;
    setApiKeysLoading(true);
    setNewApiKeyPlain(null);
    try {
      const r = await api.get(`/admin/users/${userId}/api-keys`);
      if (r.data?.success) setApiKeysList(r.data.keys || []);
      else setApiKeysList([]);
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to load API keys');
      setApiKeysList([]);
    } finally {
      setApiKeysLoading(false);
    }
  };

  const openApiKeysModal = (user) => {
    setSelectedUser(user);
    setShowApiKeysModal(true);
    setApiKeyNameDraft('');
    setApiKeyCorsDraft('');
    setApiKeyPlanOverride(false);
    setNewApiKeyPlain(null);
    void loadUserApiKeys(user.id);
  };

  const handleCreateUserApiKey = async () => {
    if (!selectedUser?.id) return;
    let corsPayload = null;
    const raw = apiKeyCorsDraft.trim();
    if (raw) {
      try {
        corsPayload = JSON.parse(raw);
        if (!Array.isArray(corsPayload)) throw new Error('Must be a JSON array');
      } catch {
        toast.error('CORS origins must be JSON array, e.g. ["https://app.partner.com"]');
        return;
      }
    }
    setApiKeyWorkingId('create');
    try {
      const r = await api.post(`/admin/users/${selectedUser.id}/api-keys`, {
        name: apiKeyNameDraft.trim() || null,
        corsOrigins: corsPayload,
        planOverride: apiKeyPlanOverride,
      });
      if (r.data?.success && r.data.key) {
        setNewApiKeyPlain(r.data.key);
        toast.success('API key created — copy it now; it will not be shown again.');
        await loadUserApiKeys(selectedUser.id);
        setApiKeyNameDraft('');
        setApiKeyCorsDraft('');
      } else {
        toast.error(r.data?.message || 'Failed to create key');
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to create key');
    } finally {
      setApiKeyWorkingId(null);
    }
  };

  const handleRevokeUserApiKey = async (keyId) => {
    if (!selectedUser?.id || !keyId) return;
    if (!window.confirm('Revoke this API key? Clients using it will stop working immediately.')) return;
    setApiKeyWorkingId(keyId);
    try {
      await api.delete(`/admin/users/${selectedUser.id}/api-keys/${keyId}`);
      toast.success('API key revoked');
      await loadUserApiKeys(selectedUser.id);
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to revoke');
    } finally {
      setApiKeyWorkingId(null);
    }
  };

  useEffect(() => {
    if (!newApiKeyPlain) return;
    const id = requestAnimationFrame(() => {
      selectElementContents(newApiKeyTextareaRef.current);
    });
    return () => cancelAnimationFrame(id);
  }, [newApiKeyPlain]);

  const handleSaveBranding = async () => {
    if (!brandSettings.appName?.trim()) { toast.error('App name required'); return; }
    try {
      setSavingBranding(true);
      const r = await brandingAPI.updateAdminBranding({
        appName: brandSettings.appName.trim(),
        logoUrl: brandSettings.logoUrl?.trim() || null,
        faviconUrl: brandSettings.faviconUrl?.trim() || null,
        baseUrl: brandSettings.baseUrl?.trim() || null,
        tutorialVideoUrl: brandSettings.tutorialVideoUrl?.trim() || null,
        landerDemoVideoUrl: brandSettings.landerDemoVideoUrl?.trim() || null,
        termsMarkdown: brandSettings.termsMarkdown?.trim() ? brandSettings.termsMarkdown : null,
        privacyMarkdown: brandSettings.privacyMarkdown?.trim() ? brandSettings.privacyMarkdown : null,
        cookiesMarkdown: brandSettings.cookiesMarkdown?.trim() ? brandSettings.cookiesMarkdown : null,
      });
      if (r?.success) { toast.success('Brand settings updated'); loadBranding(); }
      else toast.error('Failed');
    } catch (e) { toast.error(e?.response?.data?.error || 'Failed'); }
    finally { setSavingBranding(false); }
  };

  const handleUploadBrandLogo = async (file) => {
    if (!file) return;
    try {
      setSavingBranding(true);
      const url = await uploadFile(file);
      setBrandSettings((p) => ({ ...p, logoUrl: url, faviconUrl: p.faviconUrl || url }));
      toast.success('Logo uploaded');
    } catch { toast.error('Upload failed'); }
    finally { setSavingBranding(false); }
  };

  const handleUploadTutorialSlot = async (slotKey, file) => {
    if (!slotKey || !file) return;
    try {
      setUploadingTutorialSlot(slotKey);
      const result = await tutorialsAPI.uploadSlotVideo({ slot: slotKey, file });
      if (result?.success) {
        toast.success('Tutorial slot updated');
        await loadTutorialSlots();
        queryClient.invalidateQueries({ queryKey: ['tutorial-catalog'] });
      } else {
        toast.error(formatApiError({ response: { data: result } }, 'Upload failed'));
      }
    } catch (e) {
      toast.error(formatApiError(e, 'Upload failed'));
    } finally {
      setUploadingTutorialSlot("");
    }
  };

  const handleSendEmail = async (isTest = false) => {
    if (!isTest) { setConfirmSendAll(true); return; }
    _doSendEmail(true);
  };

  const loadUnsubs = async () => {
    setUnsubLoading(true);
    try {
      const r = await api.get('/admin/email-unsubscribes');
      if (r.data?.success) setUnsubData(r.data);
    } catch (e) {
      toast.error('Failed to load unsubscribes');
    } finally {
      setUnsubLoading(false);
    }
  };

  const handleResubscribe = async (email) => {
    try {
      await api.delete(`/admin/email-unsubscribes/${encodeURIComponent(email)}`);
      toast.success(`${email} re-subscribed`);
      loadUnsubs();
    } catch {
      toast.error('Failed to re-subscribe');
    }
  };

  const loadCampaigns = async () => {
    setCampaignsLoading(true);
    try {
      const r = await api.get('/admin/marketing-campaigns?limit=40');
      if (r.data?.success) setCampaigns(r.data.campaigns || []);
    } catch {
      // no-op
    } finally {
      setCampaignsLoading(false);
    }
  };

  const cancelCampaign = async (campaignId) => {
    if (!campaignId) return;
    try {
      await api.post(`/admin/marketing-campaigns/${campaignId}/cancel`);
      toast.success('Campaign cancelled');
      loadCampaigns();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to cancel campaign');
    }
  };

  const _doSendEmail = async (isTest = false) => {
    setConfirmSendAll(false);
      setSendingEmail(true);
    setEmailSendResult(null);
    try {
      const aud = emailAudience;
      const spendOpt = SPEND_RANGE_OPTIONS.find((o) => o.value === aud.spendRange);
      const audience = !isTest ? {
        verifiedOnly: aud.verifiedOnly,
        ...(aud.subscriptionStatuses?.length ? { subscriptionStatuses: aud.subscriptionStatuses } : {}),
        ...(aud.subscriptionTiers?.length ? { subscriptionTiers: aud.subscriptionTiers } : {}),
        ...(aud.minReferrals !== '' && Number(aud.minReferrals) >= 0 ? { minReferrals: Number(aud.minReferrals) } : {}),
        ...(aud.regions?.length ? { regions: aud.regions } : {}),
        ...(aud.languages?.length ? { languages: aud.languages } : {}),
      } : undefined;
      if (audience && spendOpt) {
        if (spendOpt.minCents != null) audience.minSpendCents = spendOpt.minCents;
        if (spendOpt.maxCents != null) audience.maxSpendCents = spendOpt.maxCents;
      }
      const basePayload = {
        subject: emailBuilder.subject,
        headline: emailBuilder.headline,
        bodyText: emailBuilder.bodyText,
        ctaText: emailBuilder.ctaText,
        ctaUrl: emailBuilder.ctaUrl,
        heroImageUrl: emailBuilder.heroImageUrl,
        imageUrls: emailBuilder.imageUrls,
        videoUrl: emailBuilder.videoUrl || undefined,
        ...(Object.keys(audience || {}).length ? { audience } : {}),
        ...(isTest ? { testEmail: emailBuilder.testEmail } : {}),
      };

      if (isTest) {
        const r = await api.post('/admin/send-marketing-email', basePayload);
        if (r.data?.success) {
          setEmailSendResult(r.data);
          toast.success('Test email sent');
        } else {
          toast.error('Send failed');
        }
        return;
      }

      // Production send: create a persisted campaign, then iterate cursor windows.
      const campaignCreate = await api.post('/admin/marketing-campaigns', {
        subject: basePayload.subject,
        headline: basePayload.headline,
        audience: basePayload.audience || {},
      });
      const campaignId = campaignCreate?.data?.campaignId;
      if (!campaignId) throw new Error('Failed to create campaign record');
      setActiveCampaignId(campaignId);
      await loadCampaigns();

      let cursor = 0;
      let totalSent = 0;
      let totalFailed = 0;
      let totalUsers = 0;
      let excluded = 0;
      const allErrors = [];
      const MAX_ERRORS = 200;

      for (let guard = 0; guard < 500; guard++) {
        const r = await api.post('/admin/send-marketing-email', { ...basePayload, cursor, campaignId });
        if (!r.data?.success) throw new Error('Send failed');

        totalSent += Number(r.data.sent || 0);
        totalFailed += Number(r.data.failed || 0);
        totalUsers = Number(r.data.totalUsers || totalUsers);
        excluded = Number(r.data.excluded || excluded);
        if (Array.isArray(r.data.errors)) {
          for (const err of r.data.errors) {
            if (allErrors.length < MAX_ERRORS) allErrors.push(err);
          }
        }

        setEmailSendResult({
          success: true,
          campaignId,
          totalUsers,
          excluded,
          sent: totalSent,
          failed: totalFailed,
          errors: allErrors.length ? allErrors : undefined,
          hasMore: Boolean(r.data.hasMore),
          nextCursor: Number(r.data.nextCursor || 0),
        });
        await loadCampaigns();

        if (!r.data.hasMore) {
          toast.success(`Campaign complete: sent ${totalSent}/${totalUsers}`);
          setActiveCampaignId(null);
          return;
        }
        cursor = Number(r.data.nextCursor || 0);
      }

      throw new Error('Campaign did not finish (guard limit reached)');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Send failed');
    } finally {
      setActiveCampaignId(null);
      setSendingEmail(false);
      loadCampaigns();
    }
  };

  const handleUploadEmailImage = async (file, asHero = false) => {
    if (!file) return;
    try {
      setSendingEmail(true);
      const url = await uploadFile(file);
      setEmailBuilder((p) => asHero
        ? { ...p, heroImageUrl: url }
        : { ...p, imageUrls: [...(p.imageUrls || []), url].slice(0, 8) }
      );
      toast.success('Image uploaded');
    } catch { toast.error('Upload failed'); }
    finally { setSendingEmail(false); }
  };

  const handleUploadEmailVideo = async (file) => {
    if (!file) return;
    try {
      setSendingEmail(true);
      const formData = new FormData();
      formData.append('video', file);
      const r = await api.post('/admin/upload-email-video', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const url = r.data?.url;
      if (url) {
        setEmailBuilder((p) => ({ ...p, videoUrl: url }));
        toast.success('Video uploaded (hosted on R2)');
      } else toast.error('Upload failed');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Video upload failed');
    } finally {
      setSendingEmail(false);
    }
  };

  const handleCreateBackup = async () => {
    try {
      setBackingUp(true);
      const r = await api.post('/admin/backup/create');
      toast.success('Backup created');
      setBackupHistory((prev) => [r.data, ...prev].slice(0, 20));
    } catch { toast.error('Backup failed'); }
    finally { setBackingUp(false); }
  };

  const handleRestoreCredits = async (backup) => {
    if (!backup) return;
    try {
      setRestoring(true);
      // If the backup object has a cloudinaryUrl, fetch the JSON first
      let backupData = backup.backup || backup.data || null;
      if (!backupData && backup.cloudinaryUrl) {
        const raw = await fetch(backup.cloudinaryUrl);
        backupData = await raw.json();
      }
      if (!backupData) throw new Error('No restorable data found in this backup entry. Download it manually from storage.');
      await api.post('/admin/backup/restore-credits', { backupData });
      toast.success('Credits restored from backup');
    } catch (e) {
      toast.error(e?.response?.data?.error || e?.message || 'Restore failed');
    } finally {
      setRestoring(false);
      setConfirmRestore(null);
    }
  };

  // Reel Finder helpers
  const handleAddReelProfile = async () => {
    const u = newReelUsername.trim().replace('@', '');
    if (!u) return;
    try { await api.post('/viral-reels/admin/profiles', { username: u }); setNewReelUsername(''); toast.success('Profile added'); await loadReelFinderAdmin(); }
    catch (e) { toast.error(e?.response?.data?.error || 'Failed'); }
  };
  const handleBulkAddReelProfiles = async () => {
    const us = bulkReelUsernames.split(/[\n,]/g).map((x) => x.trim().replace('@', '')).filter(Boolean);
    if (!us.length) return;
    try {
      const r = await api.post('/viral-reels/admin/profiles/bulk', { usernames: us });
      setBulkReelUsernames(''); toast.success(`Added ${r?.data?.added || 0}, skipped ${r?.data?.skipped || 0}`);
      await loadReelFinderAdmin();
    } catch (e) { toast.error(e?.response?.data?.error || 'Bulk add failed'); }
  };
  const handleToggleReelProfile = async (p) => {
    try { await api.patch(`/viral-reels/admin/profiles/${p.id}`, { isActive: !p.isActive }); toast.success(p.isActive ? 'Disabled' : 'Enabled'); await loadReelFinderAdmin(); }
    catch { toast.error('Failed'); }
  };
  const handleDeleteReelProfile = async (p) => {
    try { await api.delete(`/viral-reels/admin/profiles/${p.id}`); toast.success('Removed'); await loadReelFinderAdmin(); }
    catch { toast.error('Failed'); }
  };
  const handleUpdateReelScrapeGroup = async (p, g) => {
    try { await api.patch(`/viral-reels/admin/profiles/${p.id}`, { scrapeGroup: Number(g) }); await loadReelFinderAdmin(); }
    catch (e) { toast.error(e?.response?.data?.error || 'Failed'); }
  };
  const handleScrapeSingleProfile = async (p) => {
    try { const r = await api.post(`/viral-reels/admin/profiles/${p.id}/scrape`); toast.success(r?.data?.message || `Scraped @${p.username}`); await loadReelFinderAdmin(); }
    catch (e) { toast.error(e?.response?.data?.error || 'Failed'); }
  };
  const handleRunReelAction = async (action) => {
    const map = { scrape: '/viral-reels/admin/trigger-scrape', hot: '/viral-reels/admin/trigger-hot', warm: '/viral-reels/admin/trigger-warm', recalculate: '/viral-reels/admin/recalculate', groups: '/viral-reels/admin/assign-groups' };
    try { const r = await api.post(map[action], action === 'scrape' ? { force: true } : {}); toast.success(r?.data?.message || 'Action started'); setTimeout(loadReelFinderAdmin, 1200); }
    catch (e) { toast.error(e?.response?.data?.error || 'Action failed'); }
  };

  const contractKeys = Array.isArray(genPricingContract?.keys) ? genPricingContract.keys : [];
  const contractKeySet = new Set(contractKeys);
  const mappedKeys = new Set(
    GENERATION_PRICING_GROUPS.flatMap((group) => group.fields.map((field) => field.key)),
  );
  const missingUiMappings = contractKeys.filter((key) => !mappedKeys.has(key));
  const staleUiMappings = [...mappedKeys].filter((key) => !contractKeySet.has(key));

  const loadGenerationPricing = async () => {
    try {
      setLoadingGenPricing(true);
      const r = await api.get('/admin/pricing/generation');
      if (r.data?.success) {
        const contract = r.data.contract || null;
        const keys = Array.isArray(contract?.keys) ? contract.keys : Object.keys(r.data.pricing || {});
        const nextPricing = {};
        const incomingPricing = r.data.pricing || {};
        keys.forEach((key) => {
          nextPricing[key] = Number.isFinite(Number(incomingPricing[key])) ? Number(incomingPricing[key]) : 0;
        });
        setGenPricing(nextPricing);
        setGenPricingDefaults(contract?.defaults ? { ...contract.defaults } : (r.data.defaults ? { ...r.data.defaults } : null));
        setGenPricingContract(contract);
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to load generation pricing');
    } finally {
      setLoadingGenPricing(false);
    }
  };

  const saveGenerationPricing = async () => {
    if (!genPricing) return;
    if (missingUiMappings.length > 0) {
      toast.error(`Cannot save: missing UI mappings for ${missingUiMappings.length} backend pricing key(s).`);
      return;
    }
    try {
      setSavingGenPricing(true);
      const payload = contractKeys.length > 0
        ? contractKeys.reduce((acc, key) => {
            acc[key] = Number.isFinite(Number(genPricing[key])) ? Number(genPricing[key]) : 0;
            return acc;
          }, {})
        : genPricing;
      const r = await api.put('/admin/pricing/generation', { pricing: payload });
      if (r.data?.success) {
        setGenPricing({ ...r.data.pricing });
        toast.success('Generation pricing saved');
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to save pricing');
    } finally {
      setSavingGenPricing(false);
    }
  };

  const resetGenerationPricingAdmin = async () => {
    try {
      setSavingGenPricing(true);
      const r = await api.post('/admin/pricing/generation/reset');
      if (r.data?.success) {
        setConfirmResetGenPricing(false);
        setGenPricing({ ...r.data.pricing });
        if (r.data.contract) setGenPricingContract(r.data.contract);
        toast.success('Pricing reset to defaults');
      } else {
        toast.error(r.data?.error || 'Reset failed');
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Reset failed');
    } finally {
      setSavingGenPricing(false);
    }
  };

  const loadVoicePlatformConfig = async () => {
    try {
      setLoadingVoicePlatform(true);
      const r = await api.get('/admin/voice-platform/config');
      if (r.data?.success) {
        setVoicePlatformMax(Number(r.data.maxCustomElevenLabsVoices) || 200);
        setVoicePlatformUsed(Number(r.data.usedCustomVoices) || 0);
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to load voice platform config');
    } finally {
      setLoadingVoicePlatform(false);
    }
  };

  const saveVoicePlatformConfig = async () => {
    try {
      setSavingVoicePlatform(true);
      const r = await api.put('/admin/voice-platform/config', {
        maxCustomElevenLabsVoices: voicePlatformMax,
      });
      if (r.data?.success) {
        setVoicePlatformMax(Number(r.data.maxCustomElevenLabsVoices) || voicePlatformMax);
        setVoicePlatformUsed(Number(r.data.usedCustomVoices) || 0);
        toast.success('Voice platform cap saved');
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to save');
    } finally {
      setSavingVoicePlatform(false);
    }
  };

  const cleanupZombieVoices = async (dryRun = false) => {
    try {
      setCleaningZombieVoices(true);
      const r = await api.post('/admin/voice-platform/cleanup-zombies', {
        dryRun: Boolean(dryRun),
        limit: 1000,
      });
      if (r.data?.success) {
        setZombieVoiceCleanupResult(r.data);
        if (!dryRun) {
          setVoicePlatformUsed(Number(r.data.usedCustomVoices) || 0);
        }
        if (dryRun) {
          toast.success(`Dry run done: ${r.data.zombieCandidates || 0} zombie candidates found`);
        } else {
          toast.success(`Zombie cleanup done: ${r.data.deleted || 0} deleted`);
        }
      } else {
        toast.error(r.data?.error || 'Zombie cleanup failed');
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Zombie cleanup failed');
    } finally {
      setCleaningZombieVoices(false);
    }
  };

  const loadPromptTemplates = async () => {
    try {
      setLoadingPromptTemplates(true);
      const r = await api.get('/admin/prompt-templates');
      if (r.data?.success) {
        const overrides = { ...(r.data.templates || {}) };
        const base = { ...(r.data.effectiveTemplates || overrides) };
        const keys = Array.isArray(r.data.knownKeys) ? r.data.knownKeys : [];
        keys.forEach((k) => {
          if (!(k in base)) base[k] = "";
        });
        setPromptTemplatesMap(base);
        setPromptTemplatesOverridesMap(overrides);
        setPromptTemplateKnownKeys(keys);
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to load prompt templates');
    } finally {
      setLoadingPromptTemplates(false);
    }
  };

  const savePromptTemplates = async (nextTemplates) => {
    try {
      setSavingPromptTemplates(true);
      const payload = nextTemplates && typeof nextTemplates === 'object'
        ? nextTemplates
        : promptTemplatesOverridesMap;
      const r = await api.put('/admin/prompt-templates', { templates: payload });
      if (r.data?.success) {
        const overrides = { ...(r.data.templates || {}) };
        const next = { ...(r.data.effectiveTemplates || overrides) };
        const keys = Array.isArray(r.data.knownKeys) ? r.data.knownKeys : promptTemplateKnownKeys;
        keys.forEach((k) => {
          if (!(k in next)) next[k] = '';
        });
        setPromptTemplatesMap(next);
        setPromptTemplatesOverridesMap(overrides);
        toast.success('Prompt templates saved');
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to save prompt templates');
    } finally {
      setSavingPromptTemplates(false);
    }
  };

  const openPromptTemplateModal = (key) => {
    const k = String(key || '').trim();
    if (!k) return;
    setActivePromptTemplateKey(k);
    setActivePromptTemplateDraft(String(promptTemplatesMap?.[k] || ''));
  };

  const closePromptTemplateModal = () => {
    setActivePromptTemplateKey('');
    setActivePromptTemplateDraft('');
  };

  const saveActivePromptTemplate = async () => {
    const key = String(activePromptTemplateKey || '').trim();
    if (!key) return;
    const next = { ...promptTemplatesOverridesMap, [key]: String(activePromptTemplateDraft || '') };
    await savePromptTemplates(next);
    closePromptTemplateModal();
  };

  const loadSafetyCheckerConfig = async () => {
    try {
      setLoadingSafetyCheckerConfig(true);
      const r = await api.get('/admin/safety-checker-config');
      if (r.data?.success) {
        setSafetyCheckerConfigText(JSON.stringify(r.data.config || {}, null, 2));
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to load safety checker config');
    } finally {
      setLoadingSafetyCheckerConfig(false);
    }
  };

  const saveSafetyCheckerConfig = async () => {
    try {
      setSavingSafetyCheckerConfig(true);
      const parsed = JSON.parse(safetyCheckerConfigText || '{}');
      const r = await api.put('/admin/safety-checker-config', { config: parsed });
      if (r.data?.success) {
        setSafetyCheckerConfigText(JSON.stringify(r.data.config || {}, null, 2));
        toast.success('Safety checker config saved');
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        toast.error('Invalid JSON in safety checker config');
      } else {
        toast.error(e?.response?.data?.error || 'Failed to save safety checker config');
      }
    } finally {
      setSavingSafetyCheckerConfig(false);
    }
  };

  const loadNudesPackPoseOverrides = async () => {
    try {
      setLoadingNudesPackPoseOverrides(true);
      const r = await api.get('/admin/nudes-pack-poses');
      if (r.data?.success) {
        setNudesPackPoseOverridesText(JSON.stringify(r.data.overrides || {}, null, 2));
        const catalog = Array.isArray(r.data.catalog)
          ? r.data.catalog
          : (Array.isArray(r.data.poses) ? r.data.poses.map((pose) => ({ ...pose, enabled: true })) : []);
        setNudesPackPoseCatalog(catalog);
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to load nudes pack pose overrides');
    } finally {
      setLoadingNudesPackPoseOverrides(false);
    }
  };

  const buildNudesPackOverridesFromCatalog = (catalog) => {
    const out = {};
    (catalog || []).forEach((pose) => {
      const id = String(pose?.id || '').trim();
      if (!id) return;
      out[id] = {
        title: String(pose?.title || ''),
        summary: String(pose?.summary || ''),
        promptFragment: String(pose?.promptFragment || ''),
        category: String(pose?.category || ''),
        enabled: pose?.enabled !== false,
      };
    });
    return out;
  };

  const saveNudesPackPoseOverrides = async () => {
    try {
      setSavingNudesPackPoseOverrides(true);
      const parsed = JSON.parse(nudesPackPoseOverridesText || '{}');
      const r = await api.put('/admin/nudes-pack-poses', { overrides: parsed });
      if (r.data?.success) {
        setNudesPackPoseOverridesText(JSON.stringify(r.data.overrides || {}, null, 2));
        const catalog = Array.isArray(r.data.catalog)
          ? r.data.catalog
          : (Array.isArray(r.data.poses) ? r.data.poses.map((pose) => ({ ...pose, enabled: true })) : []);
        setNudesPackPoseCatalog(catalog);
        toast.success('Nudes pack pose overrides saved');
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        toast.error('Invalid JSON in nudes pack overrides');
      } else {
        toast.error(e?.response?.data?.error || 'Failed to save nudes pack overrides');
      }
    } finally {
      setSavingNudesPackPoseOverrides(false);
    }
  };

  const saveStructuredNudesPackPoses = async () => {
    try {
      setSavingNudesPackPoseOverrides(true);
      const payload = buildNudesPackOverridesFromCatalog(nudesPackPoseCatalog);
      const r = await api.put('/admin/nudes-pack-poses', { overrides: payload });
      if (r.data?.success) {
        setNudesPackPoseOverridesText(JSON.stringify(r.data.overrides || {}, null, 2));
        const catalog = Array.isArray(r.data.catalog)
          ? r.data.catalog
          : (Array.isArray(r.data.poses) ? r.data.poses.map((pose) => ({ ...pose, enabled: true })) : []);
        setNudesPackPoseCatalog(catalog);
        toast.success('Nudes pack pose catalog saved');
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to save nudes pack pose catalog');
    } finally {
      setSavingNudesPackPoseOverrides(false);
    }
  };

  const handleClearReelsConfirm = async () => {
    try {
      setClearReelsLoading(true);
      const r = await api.post('/viral-reels/admin/clear-reels', { rescrape: clearReelsRescrape });
      setConfirmClearReels(false);
      toast.success(r.data?.message || 'Done');
      await loadReelFinderAdmin();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to clear reels');
    } finally {
      setClearReelsLoading(false);
    }
  };

  const loadProviderBalances = async () => {
    try {
      setLoadingProviderBalances(true);
      const r = await api.get('/admin/provider-balances');
      if (r.data?.success && Array.isArray(r.data.providers)) {
        setProviderBalances({ checkedAt: r.data.checkedAt, providers: r.data.providers });
      } else {
        toast.error(r.data?.error || 'Failed to load provider balances');
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Failed to load provider balances');
    } finally {
      setLoadingProviderBalances(false);
    }
  };

  // ── Derived values ────────────────────────────────────────────────────────────
  const dailySeries   = stats?.dailySeries || [];
  const monthValue    = dailyMonth || new Date().toISOString().slice(0, 7);
  const [mY, mM]      = monthValue.split('-').map(Number);
  const safeYear      = Number.isFinite(mY) ? mY : new Date().getFullYear();
  const safeMonth     = Number.isFinite(mM) ? mM : new Date().getMonth() + 1;
  const firstDay      = new Date(safeYear, safeMonth - 1, 1).getDay();
  const daysInMonth   = new Date(safeYear, safeMonth, 0).getDate();
  const dailyMap      = new Map(dailySeries.map((r) => [r.date, r]));
  const monthRows     = dailySeries.filter((r) => r?.date?.startsWith(`${safeYear}-${String(safeMonth).padStart(2, '0')}`));
  const maxCredits    = Math.max(1, ...monthRows.map((r) => Number(r.creditsSpent || 0)));
  const selDayStats   = selectedDailyDate ? dailyMap.get(selectedDailyDate) : null;
  const infra         = telemetryOverview?.infra;

  const periodLabel = showDailyTracking
    ? `${dailyRangeStart} → ${dailyRangeEnd}`
    : statsPeriod === 'day' ? 'Today'
    : statsPeriod === 'week' ? 'Last 7 days'
    : statsPeriod === 'month' ? 'This month'
    : `Year ${statsYear}`;

  const overallStatus = (() => {
    const items = endpointHealth?.items || [];
    const down = items.filter((x) => x.status === 'down').length;
    const deg  = items.filter((x) => x.status === 'degraded' || x.status === 'stale').length;
    const err  = telemetryOverview?.totals?.errorRatePct || 0;
    if (down > 0 || err >= 10) return { label: 'Needs Attention', variant: 'red' };
    if (deg > 0 || err >= 3)   return { label: 'Monitor Closely', variant: 'yellow' };
    return { label: 'Healthy', variant: 'green' };
  })();

  const healthVariant = (s) => s === 'healthy' ? 'green' : s === 'degraded' || s === 'stale' ? 'yellow' : s === 'down' ? 'red' : 'default';

  if (loading) return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-6xl mx-auto px-3 sm:px-5 py-5 sm:py-8 space-y-4">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Admin</h1>
            <p className="text-xs text-gray-500 mt-0.5">Platform management</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            <GhostBtn onClick={() => navigate('/designer-studio')}>
              <Palette className="w-3.5 h-3.5" />
              Designer Studio
            </GhostBtn>
            <button
              onClick={() => navigate('/admin/lander-editor')}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold border border-violet-500/40 bg-violet-600/20 text-violet-300 hover:bg-violet-600/35 hover:text-white transition-colors"
            >
              <Palette className="w-3.5 h-3.5" />
              Lander Editor
            </button>
            <GhostBtn onClick={() => navigate('/dashboard')}>
              <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
            </GhostBtn>
          </div>
        </div>

        {/* ── Affiliate landers ───────────────────────────────────────────── */}
        <Section>
          <SectionHeader
            title="Affiliate landers"
            actions={
              <GhostBtn onClick={() => loadAffiliateLanders()} disabled={affiliateLandersLoading}>
                <RefreshCw className={`w-3 h-3 ${affiliateLandersLoading ? 'animate-spin' : ''}`} /> Refresh
              </GhostBtn>
            }
          />
          <p className="text-xs text-gray-500 mb-3">
            Public URL pattern:{' '}
            <code className="text-violet-300/90">…/aff/your-suffix</code>
            . Uses the same breakpoint, drag, and style tools as the main lander editor. Publish from the editor when ready.
          </p>
          <div className="flex flex-wrap items-end gap-2 mb-4">
            <label className="block text-xs text-gray-400 min-w-[200px] flex-1">
              Path suffix
              <input
                type="text"
                value={newAffLanderSuffix}
                onChange={(e) => setNewAffLanderSuffix(e.target.value)}
                placeholder="e.g. partner-name"
                className="mt-1 w-full rounded-lg border border-white/[0.1] bg-black/50 px-3 py-2 text-sm text-white placeholder:text-gray-600 outline-none focus:border-violet-500/40"
              />
            </label>
            <button
              type="button"
              onClick={createAffiliateLander}
              disabled={creatingAffLander}
              className="rounded-lg border border-violet-500/40 bg-violet-600/25 px-4 py-2 text-xs font-semibold text-violet-200 hover:bg-violet-600/40 disabled:opacity-50"
            >
              {creatingAffLander ? 'Creating…' : 'Create & open editor'}
            </button>
          </div>
          <div className="rounded-xl border border-white/[0.07] overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[520px]">
              <thead>
                <tr className="border-b border-white/[0.07] text-gray-500">
                  <th className="px-3 py-2 font-medium">Suffix</th>
                  <th className="px-3 py-2 font-medium">Updated</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {!affiliateLanders.length && !affiliateLandersLoading && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-gray-600">
                      No affiliate landers yet.
                    </td>
                  </tr>
                )}
                {affiliateLanders.map((row) => (
                  <tr key={row.suffix} className="border-b border-white/[0.05] hover:bg-white/[0.02]">
                    <td className="px-3 py-2 font-mono text-violet-200/90">/aff/{row.suffix}</td>
                    <td className="px-3 py-2 text-gray-500">{fmtDate(row.updatedAt)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => navigate(`/admin/affiliate-lander-editor/${encodeURIComponent(row.suffix)}`)}
                        className="text-violet-400 hover:text-violet-300 mr-3"
                      >
                        Edit
                      </button>
                      <a
                        href={`/aff/${encodeURIComponent(row.suffix)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-gray-400 hover:text-white mr-3"
                      >
                        <ExternalLink className="w-3 h-3" /> Live
                      </a>
                      <button
                        type="button"
                        onClick={() => deleteAffiliateLander(row.suffix)}
                        className="text-red-400/90 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ── Platform Performance ─────────────────────────────────────────── */}
        <Section>
          <SectionHeader
            title="Platform Performance"
            actions={
              <>
                <PillNav
                  options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }]}
                  value={statsPeriod}
                  onChange={setStatsPeriod}
                />
                {statsPeriod === 'year' && (
                  <div className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-black/40 px-2.5 py-1.5">
                    <span className="text-[11px] text-gray-500">Year</span>
                    <input
                      type="number" value={statsYear} min={2020} max={new Date().getFullYear()}
                      onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) setStatsYear(v); }}
                      className="w-14 bg-transparent text-xs text-white font-medium text-center outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                )}
                <GhostBtn onClick={() => {
                  if (showDailyTracking) {
                    loadStatsRange(dailyRangeStart, dailyRangeEnd);
                    loadStripeRevenueRange(dailyRangeStart, dailyRangeEnd, false);
                  } else {
                    loadStats(statsPeriod, statsYear, null);
                    loadStripeRevenue(statsPeriod, statsYear, false, null);
                  }
                }}>
                  <RefreshCw className="w-3 h-3" /> Refresh
                </GhostBtn>
              </>
            }
          />

          {stats && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4">
                <KpiCard label="New Users" value={stats.users?.total || 0} sub="signed up in period" />
                <KpiCard label="Generations" value={stats.generations?.total || 0} sub={`${stats.generations?.images || 0} img · ${stats.generations?.videos || 0} vid`} />
                <KpiCard label="Credits Used" value={stats.credits?.totalUsed || 0} sub={`${stats.credits?.totalRemaining?.toLocaleString() || 0} remaining`} />
                <KpiCard label="Est. Revenue" value={`$${stats.credits?.estimatedRevenue || '0.00'}`} sub="1 credit ≈ $0.01 (usage implied)" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-gray-300">12h Winback Email Performance</span>
                    <span className="text-[11px] text-gray-500">{periodLabel}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2.5 mb-3">
                    <KpiCard
                      label="Sent"
                      value={stats.campaigns?.abandonedSignup?.sent || 0}
                      sub="users without membership in first 12h"
                    />
                    <KpiCard
                      label="Converted"
                      value={stats.campaigns?.abandonedSignup?.converted || 0}
                      sub="later purchased membership"
                    />
                    <KpiCard
                      label="Conv. Rate"
                      value={`${(stats.campaigns?.abandonedSignup?.conversionRatePct || 0).toFixed(2)}%`}
                      sub="converted / sent"
                    />
                  </div>
                  <div className="max-h-40 overflow-auto rounded-lg border border-white/[0.06]">
                    <table className="w-full text-[11px]">
                      <thead className="bg-white/[0.03] text-gray-500">
                        <tr>
                          <th className="text-left px-2 py-1.5 font-medium">Date</th>
                          <th className="text-right px-2 py-1.5 font-medium">Sent</th>
                          <th className="text-right px-2 py-1.5 font-medium">Converted</th>
                          <th className="text-right px-2 py-1.5 font-medium">Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(stats.campaigns?.abandonedSignup?.dailySeries || []).slice().reverse().map((row) => (
                          <tr key={row.date} className="border-t border-white/[0.04]">
                            <td className="px-2 py-1.5 text-gray-400">{row.date}</td>
                            <td className="px-2 py-1.5 text-right text-gray-300">{row.sent || 0}</td>
                            <td className="px-2 py-1.5 text-right text-gray-300">{row.converted || 0}</td>
                            <td className="px-2 py-1.5 text-right text-gray-300">{Number(row.conversionRatePct || 0).toFixed(2)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-gray-300">Generation Tool Revenue & Usage</span>
                    <span className="text-[11px] text-gray-500">sorted by revenue</span>
                  </div>
                  <div className="max-h-64 overflow-auto rounded-lg border border-white/[0.06]">
                    <table className="w-full text-[11px]">
                      <thead className="bg-white/[0.03] text-gray-500">
                        <tr>
                          <th className="text-left px-2 py-1.5 font-medium">Tool</th>
                          <th className="text-right px-2 py-1.5 font-medium">Usage</th>
                          <th className="text-right px-2 py-1.5 font-medium">Credits</th>
                          <th className="text-right px-2 py-1.5 font-medium">Est. Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(stats.generationTools?.topByRevenue || []).map((row) => (
                          <tr key={row.tool} className="border-t border-white/[0.04]">
                            <td className="px-2 py-1.5 text-gray-300">{row.tool}</td>
                            <td className="px-2 py-1.5 text-right text-gray-300">{row.usageCount || 0}</td>
                            <td className="px-2 py-1.5 text-right text-gray-300">{(row.creditsSpent || 0).toLocaleString()}</td>
                            <td className="px-2 py-1.5 text-right text-gray-300">${Number(row.estimatedRevenue || 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Billing Revenue */}
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 mb-4">
                <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
                    <DollarSign className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-xs font-medium text-gray-300">Billing Revenue</span>
                    <span className="text-[11px] text-gray-600 px-1.5 py-0.5 rounded border border-white/[0.06] bg-white/[0.03]">{periodLabel}</span>
                    {stripeRevenueLoading && <RefreshCw className="w-3 h-3 text-gray-600 animate-spin" />}
                    {!stripeRevenueLoading && stripeRevenue?._cached && (
                      <span className="text-[11px] text-gray-600 px-1.5 py-0.5 rounded border border-white/[0.06]">cached</span>
                    )}
                  </div>
                  <GhostBtn onClick={() => (showDailyTracking
                    ? loadStripeRevenueRange(dailyRangeStart, dailyRangeEnd, true)
                    : loadStripeRevenue(statsPeriod, statsYear, true, null))}>
                    <RefreshCw className="w-3 h-3" /> Refresh
                  </GhostBtn>
                </div>

                {!stripeRevenue && !stripeRevenueLoading && (
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-gray-600">
                      {stripeRevenueError || 'Could not load billing data'}
                    </p>
                  <button
                      onClick={() => (showDailyTracking
                        ? loadStripeRevenueRange(dailyRangeStart, dailyRangeEnd, true)
                        : loadStripeRevenue(statsPeriod, statsYear, true, null))}
                      className="text-xs text-gray-400 hover:text-white underline underline-offset-2 transition-colors"
                    >
                      Retry
                  </button>
              </div>
                )}

                {stripeRevenue && (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-3">
                      <KpiCard label="MRR" value={fmt$(stripeRevenue.subscriptions?.mrrCents)} sub="Live Stripe subscriptions with status=active" accent />
                      <KpiCard label="ARR" value={fmt$(stripeRevenue.subscriptions?.arrCents)} sub="MRR × 12" accent />
                      <KpiCard label="Period Revenue" value={fmt$(stripeRevenue.periodRevenue?.amountCents)} sub={`${stripeRevenue.periodRevenue?.chargeCount || 0} charges · ${periodLabel}`} />
                      <KpiCard
                        label="Live Active Subs"
                        value={stripeRevenue.subscriptions?.active || 0}
                        sub={stripeRevenue.subscriptions?.churnInPeriod > 0 ? `${stripeRevenue.subscriptions.churnInPeriod} churned in period` : 'Unique Stripe customers with status=active'}
                        trend={stripeRevenue.subscriptions?.churnInPeriod > 0 ? -1 : 0}
                      />
                    </div>
                    <p className="text-[11px] text-gray-500 -mt-1 mb-3">
                      Live subs: {(stripeRevenue.subscriptions?.activeSubscriptions || 0).toLocaleString()} subscription record(s)
                      {typeof stripeRevenue.subscriptions?.dbActiveUsers === 'number' ? ` · DB-marked active users: ${stripeRevenue.subscriptions.dbActiveUsers.toLocaleString()}` : ''}
                    </p>

                    {stripeRevenue.subscriptions?.plans?.length > 0 && (
                      <div>
              <button
                          onClick={() => setShowPlanBreakdown((v) => !v)}
                          className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300 transition mb-2 uppercase tracking-wider"
              >
                          {showPlanBreakdown ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          Plan Breakdown
              </button>
                        {showPlanBreakdown && (
                          <div className="flex flex-col gap-2 pt-1">
                            {stripeRevenue.subscriptions.plans.map((plan) => {
                              const pct = Math.round((plan.mrrCents / (stripeRevenue.subscriptions.mrrCents || 1)) * 100);
                              return (
                                <div key={plan.name} className="flex items-center gap-3">
                                  <span className="text-xs text-gray-400 w-40 truncate">{plan.name}</span>
                                  <div className="flex-1 h-1 rounded-full bg-white/[0.07] overflow-hidden">
                                    <div className="h-full rounded-full bg-white/30" style={{ width: `${pct}%` }} />
            </div>
                                  <span className="text-xs text-gray-500 w-6 text-right">{plan.count}</span>
                                  <span className="text-xs text-gray-300 w-20 text-right">{fmt$(plan.mrrCents)}/mo</span>
          </div>
                              );
                            })}
              </div>
                        )}
              </div>
                    )}
                    {stripeRevenue.periodRevenue?.refundCents > 0 && (
                      <p className="text-[11px] text-red-400/60 mt-3">Refunds: {fmt$(stripeRevenue.periodRevenue.refundCents)}</p>
                    )}
                  </>
                )}
            </div>

              {/* Daily Tracking */}
            <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                <CollapseToggle
                  open={showDailyTracking}
                  onToggle={() => setShowDailyTracking((v) => !v)}
                  label="Daily Tracking"
                />
              {showDailyTracking && (
                <div className="flex flex-wrap items-center gap-2 justify-end">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wide">From</span>
                    <input
                      type="date"
                      value={dailyRangeStart}
                      max={dailyRangeEnd}
                      onChange={(e) => setDailyRangeStart(e.target.value)}
                      className="px-2 py-1 rounded-lg border border-white/[0.07] bg-black/40 text-[11px] text-white"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wide">To</span>
                    <input
                      type="date"
                      value={dailyRangeEnd}
                      min={dailyRangeStart}
                      onChange={(e) => setDailyRangeEnd(e.target.value)}
                      className="px-2 py-1 rounded-lg border border-white/[0.07] bg-black/40 text-[11px] text-white"
                    />
                  </div>
                  <input
                    type="month"
                    title="Calendar month"
                    value={monthValue}
                    onChange={(e) => setDailyMonth(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border border-white/[0.07] bg-black/40 text-xs text-white"
                  />
                </div>
              )}
            </div>

            {showDailyTracking && (
            <>
                  <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 mb-3">
                    <div className="grid grid-cols-7 gap-1.5 mb-1.5">
                      {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
                        <div key={d} className="text-[10px] text-center text-gray-600 uppercase tracking-wide">{d}</div>
                ))}
              </div>
                    <div className="grid grid-cols-7 gap-1.5">
                      {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} className="h-12 rounded-lg" />)}
                      {Array.from({ length: daysInMonth }).map((_, i) => {
                        const day = i + 1;
                        const key = `${safeYear}-${String(safeMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const row = dailyMap.get(key);
                        const intensity = Math.min(1, Number(row?.creditsSpent || 0) / maxCredits);
                        const sel = selectedDailyDate === key;
                  return (
                    <button
                            key={key}
                            onClick={() => setSelectedDailyDate(key)}
                            className={`h-12 rounded-lg border text-left px-1.5 py-1 transition ${sel ? 'border-white/30 bg-white/10' : 'border-white/[0.05] hover:border-white/20'}`}
                            style={{ background: sel ? undefined : row ? `rgba(255,255,255,${0.03 + intensity * 0.1})` : 'rgba(255,255,255,0.01)' }}
                          >
                            <div className="text-[11px] font-medium text-gray-300">{day}</div>
                            <div className="text-[10px] text-gray-600">{row ? row.creditsSpent : '—'}</div>
                    </button>
                  );
                })}
              </div>
            </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                    <KpiCard label="Date" value={selDayStats?.date || selectedDailyDate || '—'} />
                    <KpiCard label="Users In / Out" value={selDayStats ? `${selDayStats.usersInflow} / ${selDayStats.usersOutflow}` : '—'} />
                    <KpiCard label="Image / Video" value={selDayStats ? `${selDayStats.imageGenerations} / ${selDayStats.videoGenerations}` : '—'} />
                    <KpiCard label="Credits Spent" value={selDayStats?.creditsSpent ?? '—'} />
                    <KpiCard label="Est. Revenue" value={selDayStats ? `$${Number(selDayStats.estimatedRevenue || 0).toFixed(2)}` : '—'} sub="1 cr ≈ 1¢" />
                    <KpiCard label="Status" value={selDayStats ? 'Tracked' : 'No data'} />
            </div>
            </>
          )}
          </>
          )}
        </Section>

        {/* ── Users ────────────────────────────────────────────────────────── */}
        <Section>
          <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <CollapseToggle open={showUsers} onToggle={() => setShowUsers((v) => !v)} label="Users" />
              {usersPagination.total > 0 && (
                <span className="text-[11px] text-gray-600">{usersPagination.total.toLocaleString()} total</span>
              )}
            </div>
            {showUsers && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                  type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search users..."
                  className="pl-8 pr-3 py-1.5 bg-white/[0.04] border border-white/[0.07] rounded-lg text-xs focus:border-white/20 outline-none transition w-52"
              />
              {searchLoading && (
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                    <div className="w-3 h-3 border border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
              )}
              </div>
            )}
          </div>

          {showUsers && (
          <>
          <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <THead cols={[
                    { label: 'Email' }, { label: 'Name' }, { label: 'Plan' }, { label: 'Status' },
                    { label: 'Credits' }, { label: 'Used' }, { label: 'Gens' }, { label: 'Billing' },
                    { label: 'LoRA' }, { label: 'Pro' }, { label: 'Ban' }, { label: 'Joined' }, { label: 'Actions', align: 'right' },
                  ]} />
              <tbody>
                {users.map((user) => (
                      <tr key={user.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition group">
                        <td className="py-2.5 px-3 text-xs text-gray-300 max-w-[180px] truncate">{user.email}</td>
                        <td className="py-2.5 px-3 text-xs text-gray-500">{user.name || '—'}</td>
                        <td className="py-2.5 px-3">
                          <Badge variant={user.subscriptionTier && user.subscriptionTier !== 'free' ? 'purple' : 'default'}>
                            {TIER_LABELS[user.subscriptionTier] || user.subscriptionTier || 'Free'}
                          </Badge>
                    </td>
                        <td className="py-2.5 px-3">
                          <Badge variant={user.isVerified ? 'green' : 'yellow'}>
                            {user.isVerified ? 'Verified' : 'Pending'}
                          </Badge>
                    </td>
                        <td className="py-2.5 px-3 text-xs text-white font-medium" title={`Sub: ${user.subscriptionCredits || 0}, Purch: ${user.purchasedCredits || 0}, Legacy: ${user.credits || 0}`}>
                          {getTotalCredits(user).toLocaleString()}
                    </td>
                        <td className="py-2.5 px-3 text-xs text-gray-500">{(user.totalCreditsUsed || 0).toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-xs text-gray-500">{user._count?.generations || 0}</td>
                        <td className="py-2.5 px-3 text-[11px] text-gray-500">
                          <div className="flex flex-col gap-1">
                            {user.stripeCustomerId ? (
                              <div className="inline-flex items-center gap-1">
                                <span className="font-mono text-[10px] text-gray-400">{user.stripeCustomerId.slice(0, 10)}...</span>
                                <CopyBtn text={user.stripeCustomerId} />
                              </div>
                            ) : (
                              <span>-</span>
                            )}
                            {user.stripeSubscriptionId && (
                              <div className="inline-flex items-center gap-1">
                                <span className="font-mono text-[10px] text-gray-500">{user.stripeSubscriptionId.slice(0, 10)}...</span>
                                <CopyBtn text={user.stripeSubscriptionId} />
                              </div>
                            )}
                          </div>
                    </td>
                        <td className="py-2.5 px-3">
                          <Badge variant={user.allowCustomLoraTrainingPhotos ? 'green' : 'default'}>
                            {user.allowCustomLoraTrainingPhotos ? 'On' : 'Off'}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3">
                          <button
                            onClick={async () => {
                              try {
                                const next = !user.proAccess;
                                await api.post(`/admin/users/${user.id}/pro-access`, { proAccess: next });
                                setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, proAccess: next } : u)));
                                toast.success(next ? 'Pro access granted' : 'Pro access removed');
                              } catch (e) {
                                toast.error(e.response?.data?.error || 'Failed to update');
                              }
                            }}
                            className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${user.proAccess ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-white/[0.06] text-gray-500 border border-white/[0.08] hover:bg-white/[0.1]'}`}
                            title={user.proAccess ? 'Revoke Pro access' : 'Grant Pro access (/pro)'}
                          >
                            {user.proAccess ? 'Pro' : '—'}
                          </button>
                        </td>
                        <td className="py-2.5 px-3">
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const next = !user.banLocked;
                                const msg = next
                                  ? `Ban-lock ${user.email}? They cannot log in or use the API; existing sessions fail on the next request.`
                                  : `Remove ban-lock for ${user.email}?`;
                                if (!window.confirm(msg)) return;
                                await api.post(`/admin/users/${user.id}/ban-lock`, { banLocked: next });
                                setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, banLocked: next } : u)));
                                toast.success(next ? 'User ban-locked' : 'Ban-lock removed');
                              } catch (e) {
                                toast.error(e.response?.data?.error || 'Failed to update');
                              }
                            }}
                            className={`px-2 py-0.5 rounded text-[11px] font-medium transition inline-flex items-center gap-1 ${user.banLocked ? 'bg-red-500/20 text-red-300 border border-red-500/35' : 'bg-white/[0.06] text-gray-500 border border-white/[0.08] hover:bg-white/[0.1]'}`}
                            title={user.banLocked ? 'Remove ban-lock (allow login & API)' : 'Ban-lock (full suspension)'}
                          >
                            <Ban className="w-3 h-3 shrink-0 opacity-80" />
                            {user.banLocked ? 'Locked' : '—'}
                          </button>
                        </td>
                        <td className="py-2.5 px-3 text-[11px] text-gray-500 whitespace-nowrap">{fmtDate(user.createdAt)}</td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            <button onClick={() => { setSelectedUser(user); setShowAddCredits(true); }}
                              className="px-2 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] transition inline-flex items-center gap-1" title="Add Credits">
                              <Plus className="w-3.5 h-3.5 text-gray-300" />
                              <span className="text-[10px] text-gray-300">Credits</span>
                        </button>
                            <button onClick={() => { setSelectedUser(user); setShowNsfwOverride(true); }}
                              className="px-2 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] transition inline-flex items-center gap-1" title="NSFW Override">
                              <Shield className="w-3.5 h-3.5 text-gray-300" />
                              <span className="text-[10px] text-gray-300">NSFW</span>
                        </button>
                            <button onClick={() => { setSelectedUser(user); setShowEditSettings(true); }}
                              className="px-2 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] transition inline-flex items-center gap-1" title="Edit Settings">
                              <Settings className="w-3.5 h-3.5 text-gray-300" />
                              <span className="text-[10px] text-gray-300">Settings</span>
                        </button>
                            <button
                              type="button"
                              onClick={() => openApiKeysModal(user)}
                              className="px-2 py-1.5 rounded-md bg-emerald-500/[0.08] hover:bg-emerald-500/[0.16] border border-emerald-500/[0.18] transition inline-flex items-center gap-1"
                              title="Public API keys (ModelClone API)"
                            >
                              <Key className="w-3.5 h-3.5 text-emerald-300" />
                              <span className="text-[10px] text-emerald-300">API</span>
                            </button>
                            <button onClick={() => handleOpenManagePurchases(user)}
                              className="px-2 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] transition inline-flex items-center gap-1" title="Manage User Purchases">
                              <DollarSign className="w-3.5 h-3.5 text-gray-300" />
                              <span className="text-[10px] text-gray-300">Purchases</span>
                            </button>
                            <button onClick={() => handleSyncStripeForUser(user)}
                              disabled={syncingStripeUserId === user.id}
                              className="px-2 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] transition disabled:opacity-40 inline-flex items-center gap-1"
                              title="Sync billing state">
                              <RefreshCw className={`w-3.5 h-3.5 text-gray-300 ${syncingStripeUserId === user.id ? 'animate-spin' : ''}`} />
                              <span className="text-[10px] text-gray-300">Billing</span>
                            </button>
                            <button onClick={() => handleGenerateImpersonationLink(user)}
                              className="px-2 py-1.5 rounded-md bg-blue-500/[0.08] hover:bg-blue-500/[0.18] border border-blue-500/[0.16] transition inline-flex items-center gap-1" title="Generate Login Payload">
                              <Zap className="w-3.5 h-3.5 text-blue-300" />
                              <span className="text-[10px] text-blue-300">Login</span>
                            </button>
                            <button onClick={() => setConfirmDelete(user)}
                              className="px-2 py-1.5 rounded-md bg-red-500/[0.08] hover:bg-red-500/[0.15] border border-red-500/[0.12] transition inline-flex items-center gap-1" title="Delete User">
                              <Trash2 className="w-3.5 h-3.5 text-red-400/70" />
                              <span className="text-[10px] text-red-300">Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users.length === 0 && !searchLoading && (
                  <p className="text-center py-10 text-xs text-gray-600">
                    {search ? `No users found for "${search}"` : 'No users found'}
                  </p>
            )}
          </div>

              {/* Pagination */}
              {usersPagination.totalPages > 1 && (
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/[0.06]">
                  <p className="text-[11px] text-gray-600">
                    Page {usersPagination.page} of {usersPagination.totalPages} · {usersPagination.total} users
                  </p>
                  <div className="flex items-center gap-1.5">
                    <GhostBtn
                      disabled={usersPage <= 1}
                      onClick={() => { const p = usersPage - 1; setUsersPage(p); loadUsers(search, p); }}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </GhostBtn>
                    <span className="text-xs text-gray-400 px-1">{usersPage}</span>
                    <GhostBtn
                      disabled={usersPage >= usersPagination.totalPages}
                      onClick={() => { const p = usersPage + 1; setUsersPage(p); loadUsers(search, p); }}
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </GhostBtn>
                  </div>
                </div>
              )}
          </>
          )}
        </Section>

        {/* ── Top Spenders ─────────────────────────────────────────────────── */}
        {stats?.topUsers?.length > 0 && (
          <Section>
            <div className="flex items-center justify-between mb-5">
              <CollapseToggle open={showTopSpenders} onToggle={() => setShowTopSpenders((v) => !v)} label={`Top Spenders · ${periodLabel}`} />
                    </div>
            {showTopSpenders && (
              <div className="space-y-2">
                {stats.topUsers.map((user, i) => (
                  <div key={user.id} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-md bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-[11px] font-semibold text-gray-400">{i + 1}</span>
                    <div>
                        <p className="text-xs font-medium">{user.name || user.email}</p>
                        <p className="text-[11px] text-gray-500">{user.email}</p>
                    </div>
                  </div>
                    <div className="flex items-center gap-4">
                      {user.subscriptionTier && user.subscriptionTier !== 'free' && (
                        <Badge variant="purple">{TIER_LABELS[user.subscriptionTier] || user.subscriptionTier}</Badge>
                      )}
                  <div className="text-right">
                        <p className="text-xs font-semibold">{(user.totalCreditsUsed || 0).toLocaleString()} credits</p>
                        <p className="text-[11px] text-gray-500">{user._count?.generations || 0} gens</p>
                      </div>
                  </div>
                </div>
              ))}
            </div>
            )}
          </Section>
        )}

        {/* ── Recover Payment ───────────────────────────────────────────────── */}
        <Section>
          <SectionHeader title="Recover Payment" />
          <p className="text-xs text-gray-500 mb-3">Paste a billing subscription (sub_…) or payment intent ID (pi_…) to re-award credits.</p>
          <div className="flex gap-2 flex-wrap">
            <input
              type="text" value={recoverStripeId} onChange={(e) => setRecoverStripeId(e.target.value)}
              placeholder="sub_xxxxx or pi_xxxxx"
              className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs font-mono focus:border-white/20 outline-none transition"
            />
            <PrimaryBtn onClick={handleRecoverPayment} disabled={recoverLoading || !recoverStripeId.trim()}>
              {recoverLoading ? <><div className="w-3 h-3 border border-black/30 border-t-black rounded-full animate-spin" /> Recovering…</> : <><RefreshCw className="w-3 h-3" /> Recover</>}
            </PrimaryBtn>
          </div>
          {recoverResult && (
            <div className={`mt-3 p-3 rounded-lg border text-xs ${recoverResult.success ? 'border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-400' : 'border-red-500/20 bg-red-500/[0.05] text-red-400'}`}>
              {recoverResult.message}
              {recoverResult.alreadyProcessed && <span className="text-gray-500 ml-1">— already processed.</span>}
          </div>
        )}
        </Section>

        {/* ── Subscription Refill Audit ─────────────────────────────────────── */}
        <Section>
          <SectionHeader title="Subscription Refill Audit & Reconcile" />
          <p className="text-xs text-gray-500 mb-3">
            Audit paid Stripe subscription invoices that did not grant credits, then reconcile missed refills. Scans all users with a Stripe customer ID.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            <input
              type="number"
              min={1}
              max={365}
              value={refillAuditForm.days}
              onChange={(e) => setRefillAuditForm((v) => ({ ...v, days: e.target.value }))}
              placeholder="Days lookback"
              className="px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs focus:border-white/20 outline-none transition"
            />
            <input
              type="text"
              value={refillAuditForm.userId}
              onChange={(e) => setRefillAuditForm((v) => ({ ...v, userId: e.target.value }))}
              placeholder="Filter by userId (optional)"
              className="px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs font-mono focus:border-white/20 outline-none transition"
            />
            <input
              type="email"
              value={refillAuditForm.email}
              onChange={(e) => setRefillAuditForm((v) => ({ ...v, email: e.target.value }))}
              placeholder="Filter by email (optional)"
              className="px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs focus:border-white/20 outline-none transition"
            />
          </div>

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <GhostBtn onClick={handleRunRefillAudit} disabled={refillAuditLoading || refillReconcileLoading}>
              {refillAuditLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
              Run Audit
            </GhostBtn>
            <GhostBtn
              onClick={() => handleReconcileRefills({ dryRun: true, selectedOnly: true })}
              disabled={refillAuditLoading || refillReconcileLoading || selectedRefillInvoiceIds.length === 0}
            >
              {refillReconcileLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
              Dry Run Selected
            </GhostBtn>
            <PrimaryBtn
              onClick={() => handleReconcileRefills({ dryRun: false, selectedOnly: true })}
              disabled={refillAuditLoading || refillReconcileLoading || selectedRefillInvoiceIds.length === 0}
            >
              {refillReconcileLoading ? (
                <>
                  <div className="w-3 h-3 border border-black/30 border-t-black rounded-full animate-spin" />
                  Reconciling…
                </>
              ) : (
                <>
                  <Zap className="w-3 h-3" />
                  Reconcile Selected
                </>
              )}
            </PrimaryBtn>
            <GhostBtn
              onClick={() => handleReconcileRefills({ dryRun: true, selectedOnly: false })}
              disabled={refillAuditLoading || refillReconcileLoading}
            >
              {refillReconcileLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
              Dry Run All Missing
            </GhostBtn>
            <PrimaryBtn
              onClick={() => handleReconcileRefills({ dryRun: false, selectedOnly: false })}
              disabled={refillAuditLoading || refillReconcileLoading}
            >
              {refillReconcileLoading ? (
                <>
                  <div className="w-3 h-3 border border-black/30 border-t-black rounded-full animate-spin" />
                  Reconciling…
                </>
              ) : (
                <>
                  <RefreshCw className="w-3 h-3" />
                  Reconcile All Missing
                </>
              )}
            </PrimaryBtn>
          </div>

          {refillAuditResult?.summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
              <KpiCard label="Scanned Users" value={refillAuditResult.summary.scannedUsers || 0} />
              <KpiCard label="Missing Refills" value={refillAuditResult.summary.missingRefills || 0} />
              <KpiCard label="Errors" value={refillAuditResult.summary.errors || 0} />
              <KpiCard label="Selected" value={selectedRefillInvoiceIds.length} />
            </div>
          )}
          {refillAuditResult?.summary?.progress && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              <KpiCard label="Scan Batches" value={refillAuditResult.summary.progress.userBatchesScanned || 0} />
              <KpiCard label="Subscriptions" value={refillAuditResult.summary.progress.subscriptionsScanned || 0} />
              <KpiCard label="Invoices Seen" value={refillAuditResult.summary.progress.invoicesScanned || 0} />
              <KpiCard label="Scan Time" value={fmtDurationMs(refillAuditResult.summary.progress.durationMs)} />
            </div>
          )}
          {refillReconcileResult?.summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              <KpiCard label="Requested" value={refillReconcileResult.summary.requestedInvoices || 0} />
              <KpiCard label="Reconciled" value={refillReconcileResult.summary.reconciled || 0} />
              <KpiCard label="Already/Skipped" value={(refillReconcileResult.summary.alreadyProcessed || 0) + (refillReconcileResult.summary.skipped || 0)} />
              <KpiCard label="Run Time" value={fmtDurationMs(refillReconcileResult.summary.processingDurationMs)} />
            </div>
          )}

          {Array.isArray(refillAuditResult?.findings) && refillAuditResult.findings.length > 0 && (
            <div className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] uppercase tracking-wider text-gray-500">Missing Refill Invoices</p>
                <div className="flex items-center gap-1.5">
                  <GhostBtn onClick={() => setSelectedRefillInvoiceIds(refillAuditResult.findings.map((f) => f.invoiceId))}>
                    Select All
                  </GhostBtn>
                  <GhostBtn onClick={() => setSelectedRefillInvoiceIds([])}>
                    Clear
                  </GhostBtn>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <THead
                    cols={[
                      { label: '' },
                      { label: 'Invoice' },
                      { label: 'User' },
                      { label: 'Sub' },
                      { label: 'Paid' },
                      { label: 'Credits' },
                      { label: 'Reason' },
                    ]}
                  />
                  <tbody>
                    {refillAuditResult.findings.slice(0, 300).map((f) => {
                      const checked = selectedRefillInvoiceIds.includes(f.invoiceId);
                      return (
                        <tr key={f.invoiceId} className="border-b border-white/[0.04]">
                          <td className="py-2.5 px-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleRefillInvoiceSelection(f.invoiceId)}
                              className="rounded"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-xs text-gray-300">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono">{f.invoiceId}</span>
                              <CopyBtn text={f.invoiceId} />
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-xs text-gray-400">
                            <div>{f?.user?.email || f?.user?.id || '—'}</div>
                            {f?.user?.id && <div className="text-[11px] text-gray-500 font-mono">{f.user.id}</div>}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-gray-500 font-mono">{f.subscriptionId || '—'}</td>
                          <td className="py-2.5 px-3 text-xs text-white">{fmt$(f.amountPaidCents || 0)}</td>
                          <td className="py-2.5 px-3 text-xs text-gray-300">{(f.expectedCredits || 0).toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-xs text-gray-500">{f.billingReason || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {refillAuditResult.findings.length > 300 && (
                <p className="text-[11px] text-gray-500 mt-2">
                  Showing first 300 rows of {refillAuditResult.findings.length}.
                </p>
              )}
            </div>
          )}

          {Array.isArray(refillAuditResult?.errors) && refillAuditResult.errors.length > 0 && (
            <div className="mt-3 p-3 rounded-lg border border-yellow-500/20 bg-yellow-500/[0.05] text-xs text-yellow-300">
              Audit had {refillAuditResult.errors.length} user-level Stripe lookup errors.
            </div>
          )}
        </Section>

        {/* ── LoRA Recovery ─────────────────────────────────────────────────── */}
        <Section>
          <SectionHeader title="LoRA Recovery" />
          <p className="text-xs text-gray-500 mb-3">
            Recover a finished fal LoRA into R2 and attach it to a user model.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <input
              type="text"
              value={loraRecoveryForm.userId}
              onChange={(e) => setLoraRecoveryForm((v) => ({ ...v, userId: e.target.value }))}
              placeholder="User ID"
              className="px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs font-mono focus:border-white/20 outline-none transition"
            />
            <input
              type="text"
              value={loraRecoveryForm.modelName}
              onChange={(e) => setLoraRecoveryForm((v) => ({ ...v, modelName: e.target.value }))}
              placeholder="Model name (contains match)"
              className="px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs focus:border-white/20 outline-none transition"
            />
            <input
              type="text"
              value={loraRecoveryForm.triggerWord}
              onChange={(e) => setLoraRecoveryForm((v) => ({ ...v, triggerWord: e.target.value }))}
              placeholder="Trigger word (optional)"
              className="px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs focus:border-white/20 outline-none transition"
            />
            <input
              type="url"
              value={loraRecoveryForm.falLoraUrl}
              onChange={(e) => setLoraRecoveryForm((v) => ({ ...v, falLoraUrl: e.target.value }))}
              placeholder="fal LoRA URL (.safetensors)"
              className="md:col-span-2 px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs focus:border-white/20 outline-none transition"
            />
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
            <label className="inline-flex items-center gap-2 text-xs text-gray-300 select-none">
              <input
                type="checkbox"
                checked={loraRecoveryForm.enableNsfw}
                onChange={(e) => setLoraRecoveryForm((v) => ({ ...v, enableNsfw: e.target.checked }))}
                className="accent-white"
              />
              Enable NSFW flags on recovered model
            </label>
            <PrimaryBtn onClick={handleLoraRecovery} disabled={loraRecoveryLoading}>
              {loraRecoveryLoading ? (
                <>
                  <div className="w-3 h-3 border border-black/30 border-t-black rounded-full animate-spin" />
                  Recovering…
                </>
              ) : (
                <>
                  <RefreshCw className="w-3 h-3" />
                  Recover LoRA
                </>
              )}
            </PrimaryBtn>
          </div>

          {loraRecoveryResult && (
            <div className={`mt-3 p-3 rounded-lg border text-xs ${loraRecoveryResult.success ? 'border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-400' : 'border-red-500/20 bg-red-500/[0.05] text-red-400'}`}>
              {loraRecoveryResult.message || loraRecoveryResult.error || 'Recovery finished.'}
              {loraRecoveryResult?.data?.loraUrl && (
                <div className="mt-1 break-all text-[11px] text-gray-300">
                  Saved URL: {loraRecoveryResult.data.loraUrl}
                </div>
              )}
            </div>
          )}
        </Section>

        {/* ── Voice hosting (custom ElevenLabs voices) ─────────────────────── */}
        <Section>
          <SectionHeader title="Voice hosting (monthly)" />
          <p className="text-xs text-gray-500 mb-3">
            Rows past the ~30-day window (same logic as automatic billing). Refresh lists who is due; Run charges credits or suspends voices when balance is insufficient.
          </p>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <GhostBtn onClick={handleVoiceHostingDue} disabled={voiceHostingDueLoading}>
              {voiceHostingDueLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
              Refresh due list
            </GhostBtn>
            <input
              type="text"
              value={voiceHostingRunUserId}
              onChange={(e) => setVoiceHostingRunUserId(e.target.value)}
              placeholder="User ID (for single-user run only)"
              className="px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs font-mono min-w-[220px] flex-1 max-w-md focus:border-white/20 outline-none transition"
            />
            <PrimaryBtn onClick={handleVoiceHostingRunUser} disabled={voiceHostingRunLoading}>
              {voiceHostingRunLoading ? (
                <div className="w-3 h-3 border border-black/30 border-t-black rounded-full animate-spin" />
              ) : (
                <Zap className="w-3 h-3" />
              )}
              Run billing (user)
            </PrimaryBtn>
            <PrimaryBtn onClick={handleVoiceHostingRunAll} disabled={voiceHostingRunLoading}>
              {voiceHostingRunLoading ? (
                <div className="w-3 h-3 border border-black/30 border-t-black rounded-full animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              Run billing (all users)
            </PrimaryBtn>
          </div>
          {voiceHostingDue?.success && (
            <p className="text-[11px] text-gray-500 mb-2">
              Cutoff {voiceHostingDue.cutoffAt} · {voiceHostingDue.voiceMonthlyCredits} cr/voice ·{' '}
              <span className="text-gray-300">{voiceHostingDue.totalDueItems}</span> due rows ·{' '}
              <span className="text-gray-300">{voiceHostingDue.distinctUsers}</span> users
            </p>
          )}
          {voiceHostingDue?.success && Array.isArray(voiceHostingDue.items) && voiceHostingDue.items.length > 0 && (
            <div className="max-h-60 overflow-auto rounded-lg border border-white/[0.07] text-[11px]">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-zinc-950/95 text-gray-400 backdrop-blur">
                  <tr>
                    <th className="p-2">User</th>
                    <th className="p-2">Email</th>
                    <th className="p-2">Kind</th>
                    <th className="p-2">Ids</th>
                    <th className="p-2">Last billed</th>
                    <th className="p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {voiceHostingDue.items.map((row, i) => (
                    <tr key={`${row.kind}-${row.voiceId || ''}-${row.modelId || ''}-${i}`} className="border-t border-white/[0.05] text-gray-300">
                      <td className="p-2 font-mono break-all">{row.userId}</td>
                      <td className="p-2 text-gray-500 break-all max-w-[140px]">{row.email || '—'}</td>
                      <td className="p-2">{row.kind}</td>
                      <td className="p-2 font-mono break-all text-[10px] text-gray-500 max-w-[200px]" title={row.kind === 'modelVoice' ? row.voiceId : row.modelId}>
                        {row.kind === 'modelVoice' ? row.voiceId : row.modelId}
                      </td>
                      <td className="p-2 text-gray-500 whitespace-nowrap">{row.lastBilledAt ? fmtDate(row.lastBilledAt) : '—'}</td>
                      <td className="p-2">{row.billingStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {voiceHostingDue?.success && voiceHostingDue.totalDueItems === 0 && (
            <p className="text-xs text-gray-500">No rows due (or press Refresh).</p>
          )}
        </Section>

        {/* ── Lost Generation Reconciliation ──────────────────────────────── */}
        <Section>
          <SectionHeader title="Lost Generation Reconciliation" />
          <p className="text-xs text-gray-500 mb-3">
            Scan failed external jobs, recover finished outputs, mirror to R2, and mark recovered.
          </p>
          <p className="text-xs text-gray-500 mb-3">
            <strong>Single user:</strong> enter User ID/email/username and limit. <strong>All users:</strong> use the buttons below (limit applies to total generations scanned).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <input
              type="text"
              value={lostGenForm.userId}
              onChange={(e) => setLostGenForm((v) => ({ ...v, userId: e.target.value }))}
              placeholder="User ID, email or username (single-user only)"
              className="px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs font-mono focus:border-white/20 outline-none transition"
            />
            <input
              type="number"
              min={1}
              max={2000}
              value={lostGenForm.limit}
              onChange={(e) => setLostGenForm((v) => ({ ...v, limit: e.target.value }))}
              placeholder="Limit (1-2000)"
              className="px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs focus:border-white/20 outline-none transition"
            />
          </div>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <GhostBtn onClick={() => handleLostGenerationReconcile(true)} disabled={lostGenLoading}>
              {lostGenLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
              Dry Run (user)
            </GhostBtn>
            <PrimaryBtn onClick={() => handleLostGenerationReconcile(false)} disabled={lostGenLoading}>
              {lostGenLoading ? (
                <>
                  <div className="w-3 h-3 border border-black/30 border-t-black rounded-full animate-spin" />
                  Reconciling…
                </>
              ) : (
                <>
                  <RefreshCw className="w-3 h-3" />
                  Reconcile user
                </>
              )}
            </PrimaryBtn>
            <span className="text-gray-500 text-xs mx-1">|</span>
            <GhostBtn onClick={() => handleLostGenerationReconcileAll(true)} disabled={lostGenAllLoading}>
              {lostGenAllLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
              Dry Run (all users)
            </GhostBtn>
            <PrimaryBtn onClick={() => handleLostGenerationReconcileAll(false)} disabled={lostGenAllLoading}>
              {lostGenAllLoading ? (
                <>
                  <div className="w-3 h-3 border border-black/30 border-t-black rounded-full animate-spin" />
                  Reconciling…
                </>
              ) : (
                <>
                  <RefreshCw className="w-3 h-3" />
                  Reconcile all users
                </>
              )}
            </PrimaryBtn>
            <span className="text-gray-500 text-xs mx-1">|</span>
            <PrimaryBtn onClick={handleRunpodBatchReconcile} disabled={runpodBatchLoading}>
              {runpodBatchLoading ? (
                <>
                  <div className="w-3 h-3 border border-black/30 border-t-black rounded-full animate-spin" />
                  Checking RunPod…
                </>
              ) : (
                <>
                  <RefreshCw className="w-3 h-3" />
                  RunPod batch callback check
                </>
              )}
            </PrimaryBtn>
          </div>
          {lostGenResult && (
            <div className={`mt-3 p-3 rounded-lg border text-xs ${lostGenResult.success ? 'border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-400' : 'border-red-500/20 bg-red-500/[0.05] text-red-400'}`}>
              {lostGenResult.message || lostGenResult.error || 'Reconciliation finished.'}
              {lostGenResult?.data && (
                <div className="mt-1 text-[11px] text-gray-300">
                  scanned: {lostGenResult.data.scanned} | recoverable: {lostGenResult.data.recoverable} | recovered: {lostGenResult.data.recovered}
                </div>
              )}
            </div>
          )}
          {lostGenAllResult && (
            <div className={`mt-3 p-3 rounded-lg border text-xs ${lostGenAllResult.success ? 'border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-400' : 'border-red-500/20 bg-red-500/[0.05] text-red-400'}`}>
              {lostGenAllResult.message || lostGenAllResult.error || 'Reconciliation finished.'}
              {lostGenAllResult?.data && (
                <div className="mt-1 text-[11px] text-gray-300">
                  scanned: {lostGenAllResult.data.scanned} | users: {lostGenAllResult.data.uniqueUsers} | recoverable: {lostGenAllResult.data.recoverable} | recovered: {lostGenAllResult.data.recovered}
                </div>
              )}
            </div>
          )}
          {runpodBatchResult && (
            <div className={`mt-3 p-3 rounded-lg border text-xs ${runpodBatchResult.success ? 'border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-400' : 'border-red-500/20 bg-red-500/[0.05] text-red-400'}`}>
              {runpodBatchResult.message || runpodBatchResult.error || 'RunPod batch check finished.'}
              {runpodBatchResult?.data && (
                <div className="mt-1 text-[11px] text-gray-300">
                  scanned: {runpodBatchResult.data.scanned || 0} | checked: {runpodBatchResult.data.checkedWithRunpodJobId || 0} | recovered: {runpodBatchResult.data.completedRecovered || 0} | from failed: {runpodBatchResult.data.completedRecoveredFromFailed || 0} | still running: {runpodBatchResult.data.stillRunning || 0}
                </div>
              )}
            </div>
          )}
        </Section>

        {/* ── Referrals ─────────────────────────────────────────────────────── */}
        <Section>
          <SectionHeader title="Referrals" actions={
            <GhostBtn onClick={loadReferrals}><RefreshCw className="w-3 h-3" /> Refresh</GhostBtn>
          } />

          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 mb-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-xs text-gray-300 font-medium">Referral Reconciliation</p>
                <p className="text-[11px] text-gray-500 mt-1">Dry run first, then execute to backfill missed first-purchase referral credits.</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="inline-flex items-center gap-1.5 text-[11px] text-gray-300">
                  <input
                    type="checkbox"
                    checked={reconcileAllUsers}
                    onChange={(e) => setReconcileAllUsers(e.target.checked)}
                    className="rounded"
                  />
                  Scan all users
                </label>
                <input
                  type="number"
                  min={1}
                  max={5000}
                  value={reconcileLimit}
                  onChange={(e) => setReconcileLimit(Math.max(1, Math.min(5000, parseInt(e.target.value || '1', 10))))}
                  disabled={reconcileAllUsers}
                  className="w-24 px-2 py-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs"
                  title={reconcileAllUsers ? 'Disabled when scanning all users' : 'Max users to scan'}
                />
                <GhostBtn onClick={() => handleReferralReconcile(true)} disabled={reconcileLoading}>
                  {reconcileLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                  Dry Run
                </GhostBtn>
                <PrimaryBtn onClick={() => handleReferralReconcile(false)} disabled={reconcileLoading}>
                  {reconcileLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                  Execute
                </PrimaryBtn>
              </div>
            </div>
            {reconcileResult?.summary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                <KpiCard label="Scanned" value={reconcileResult.summary.scanned || 0} />
                <KpiCard label="Eligible" value={reconcileResult.summary.eligibleForBackfill || 0} />
                <KpiCard label="Created" value={reconcileResult.summary.created || 0} />
                <KpiCard label="Skipped/Failed" value={(reconcileResult.summary.skippedNoFirstPurchase || 0) + (reconcileResult.summary.skippedUnsupportedSource || 0) + (reconcileResult.summary.skippedAmountUnresolved || 0) + (reconcileResult.summary.failed || 0)} />
            </div>
          )}
        </div>

          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 mb-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-xs text-gray-300 font-medium">Referral Reconciliation Queue</p>
                <p className="text-[11px] text-gray-500 mt-1">
                  Shows unlinked signups with referral candidates. One click links the user.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={300}
                  value={reconciliationLimit}
                  onChange={(e) =>
                    setReconciliationLimit(
                      Math.max(1, Math.min(300, parseInt(e.target.value || '1', 10))),
                    )
                  }
                  className="w-24 px-2 py-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs"
                  title="Max users to inspect"
                />
                <GhostBtn
                  onClick={() => loadReferralReconciliation(reconciliationLimit)}
                  disabled={reconcileReferralsLoading}
                >
                  <RefreshCw className={`w-3 h-3 ${reconcileReferralsLoading ? 'animate-spin' : ''}`} />
                  Refresh Queue
                </GhostBtn>
              </div>
          </div>

            <div className="overflow-x-auto mt-3">
            <table className="w-full">
                <THead
                  cols={[
                    { label: 'User' },
                    { label: 'Status' },
                    { label: 'Suggested Referrer' },
                    { label: 'Candidates' },
                    { label: 'Action', align: 'right' },
                  ]}
                />
              <tbody>
                  {reconciliationItems.map((item) => {
                    const user = item.user || {};
                    const suggested = item.suggestedReferrer || null;
                    const isLinking = linkingReferralUserId === user.id;
                    return (
                      <tr key={user.id} className="border-b border-white/[0.04]">
                        <td className="py-2.5 px-3 text-xs text-gray-300">
                          <div>{user.name || user.email || user.id}</div>
                          <div className="text-[11px] text-gray-500">{user.email || user.id}</div>
                        </td>
                        <td className="py-2.5 px-3 text-xs">
                          <Badge variant={item.status === 'ambiguous' ? 'yellow' : item.status === 'single_candidate_strong' ? 'green' : 'blue'}>
                            {item.status === 'ambiguous'
                              ? 'Ambiguous'
                              : item.status === 'single_candidate_strong'
                              ? 'Strong Match'
                              : 'Weak Match'}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 text-xs text-gray-400">
                          {suggested ? (
                            <div>
                              <div className="font-mono text-gray-300">{suggested.referralCode || '—'}</div>
                              <div className="text-[11px] text-gray-500">{suggested.referrerUserId}</div>
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-[11px] text-gray-500">
                          {(item.candidates || []).slice(0, 3).map((c) => (
                            <div key={`${user.id}-${c.referrerUserId}`} className="mb-0.5">
                              {c.referralCode} ({c.strongestSignal}, {c.draftCount} draft{c.draftCount > 1 ? 's' : ''})
                            </div>
                          ))}
                          {(item.candidates || []).length === 0 && '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <GhostBtn
                            disabled={!suggested || isLinking}
                            onClick={() =>
                              handleManualReferralLink({
                                userId: user.id,
                                referrerUserId: suggested.referrerUserId,
                                draftId: suggested?.draftIds?.[0] || null,
                              })
                            }
                          >
                            {isLinking ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                            Link Suggested
                          </GhostBtn>
                    </td>
                  </tr>
                    );
                  })}
                  {!reconcileReferralsLoading && reconciliationItems.length === 0 && (
                  <tr>
                      <td colSpan={5} className="py-4 px-3 text-xs text-gray-600">
                        No reconciliation items found.
                      </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>

          <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">Pending Payouts</p>
          <div className="overflow-x-auto mb-6">
            <table className="w-full">
              <THead cols={[{ label: 'User' }, { label: 'Amount' }, { label: 'Wallet' }, { label: 'Requested' }, { label: 'Action', align: 'right' }]} />
              <tbody>
                {referralData.pendingPayoutRequests.map((p) => (
                  <tr key={p.id} className="border-b border-white/[0.04]">
                    <td className="py-2.5 px-3 text-xs text-gray-300">{p.user?.name || p.user?.email}</td>
                    <td className="py-2.5 px-3 text-xs text-white font-medium">{fmt$(p.amountCents)}</td>
                    <td className="py-2.5 px-3 text-[11px] text-gray-500">
                      <div className="flex items-center max-w-[160px]">
                        <span className="truncate">{p.walletAddress}</span>
                        {p.walletAddress && <CopyBtn text={p.walletAddress} />}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-[11px] text-gray-500 whitespace-nowrap">{fmtDate(p.requestedAt)}</td>
                    <td className="py-2.5 px-3 text-right">
                      <GhostBtn onClick={() => handleMarkPaid(p.id)}>Mark Paid</GhostBtn>
                    </td>
                  </tr>
                ))}
                {!loadingReferrals && referralData.pendingPayoutRequests.length === 0 && (
                  <tr><td colSpan={5} className="py-4 px-3 text-xs text-gray-600">No pending payout requests.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Program summary */}
          {referralData.users.length > 0 && (() => {
            const totalReward = referralData.users.reduce((s, u) => s + (u.totalRewardCents || 0), 0);
            const totalPaid   = referralData.users.reduce((s, u) => s + (u.totalPaidCents || 0), 0);
            const totalElig   = referralData.users.reduce((s, u) => s + (u.eligibleCents || 0), 0);
            return (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-4">
                <KpiCard label="Total Rewards" value={fmt$(totalReward)} sub="all time" />
                <KpiCard label="Total Paid" value={fmt$(totalPaid)} sub="disbursed" />
                <KpiCard label="Owed" value={fmt$(totalElig)} sub="eligible, not yet paid" />
        </div>
            );
          })()}

          <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">Participants</p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <THead cols={[{ label: 'User' }, { label: 'Code' }, { label: 'Program' }, { label: 'Referred' }, { label: 'Spend' }, { label: 'Reward' }, { label: 'Paid' }, { label: 'Eligible' }, { label: '' }]} />
              <tbody>
                {referralData.users.map((u) => (
                  <tr key={u.id} className="border-b border-white/[0.04]">
                    <td className="py-2.5 px-3 text-xs text-gray-300">{u.name || u.email}</td>
                    <td className="py-2.5 px-3 text-xs font-mono text-gray-400">{u.referralCode}</td>
                    <td className="py-2.5 px-3">
                      {u.referralAdvanced
                        ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">ADVANCED</span>
                        : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/5 text-gray-500 border border-white/10">Standard</span>
                      }
                    </td>
                    <td className="py-2.5 px-3 text-xs text-gray-400">{u.referredUsersCount}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-400">{fmt$(u.totalReferredSpendCents)}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-400">{fmt$(u.totalRewardCents)}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-400">{fmt$(u.totalPaidCents)}</td>
                    <td className="py-2.5 px-3 text-xs text-white font-medium">{fmt$(u.eligibleCents)}</td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="inline-flex items-center gap-1">
                      <GhostBtn
                        onClick={() =>
                          setConfirmReferralPayout({
                            userId: u.id,
                            email: u.email || u.name || u.id,
                            eligibleCents: u.eligibleCents || 0,
                          })
                        }
                        disabled={(u.eligibleCents || 0) <= 0 || payingReferralUserId === u.id}
                      >
                        {payingReferralUserId === u.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <DollarSign className="w-3 h-3" />}
                        Pay Now
                      </GhostBtn>
              <button
                        onClick={() => { setBonusModal({ userId: u.id, email: u.email || u.name }); setBonusAmount(''); setBonusNote(''); }}
                        className="px-2.5 py-1 rounded-md text-[11px] font-medium border border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-400 hover:bg-emerald-500/[0.14] transition"
              >
                        + Bonus
              </button>
                        <button
                          onClick={() => handleToggleReferralAdvanced(u.id, u.referralAdvanced)}
                          disabled={advancingReferralUserId === u.id}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition disabled:opacity-50 ${
                            u.referralAdvanced
                              ? 'border-purple-500/30 bg-purple-500/[0.07] text-purple-400 hover:bg-purple-500/[0.14]'
                              : 'border-white/20 bg-white/[0.04] text-gray-400 hover:bg-white/[0.08] hover:text-white'
                          }`}
                        >
                          {advancingReferralUserId === u.id
                            ? '...'
                            : u.referralAdvanced ? 'Demote' : 'Promote'}
                        </button>
            </div>
                    </td>
                  </tr>
                ))}
                {!loadingReferrals && referralData.users.length === 0 && (
                  <tr><td colSpan={9} className="py-4 px-3 text-xs text-gray-600">No participants yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ── Telemetry ─────────────────────────────────────────────────────── */}
        <Section>
          <SectionHeader
            title="Telemetry"
            actions={
              <>
                <PillNav options={TELEMETRY_OPTIONS} value={telemetryHours} onChange={setTelemetryHours} />
                <GhostBtn onClick={() => loadTelemetry(telemetryHours)}>
                  <RefreshCw className={`w-3 h-3 ${loadingTelemetry ? 'animate-spin' : ''}`} /> Refresh
                </GhostBtn>
              </>
            }
          />

          {telemetryOverview && (
            <>
              <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                <Badge variant={overallStatus.variant}>{overallStatus.label}</Badge>
                <div className="flex items-center gap-2">
                  <GhostBtn onClick={() => setShowInfraMetrics((v) => !v)}>
                    <Server className="w-3 h-3" />
                    {showInfraMetrics ? 'Hide Infra' : 'Infra'}
                    {showInfraMetrics ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </GhostBtn>
                  <GhostBtn onClick={() => setShowEdgeEvents((v) => !v)}>
                    <AlertTriangle className="w-3 h-3" />
                    {showEdgeEvents ? 'Hide Events' : `Events ${edgeEvents.length > 0 ? `(${edgeEvents.length})` : ''}`}
                    {showEdgeEvents ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </GhostBtn>
                  <GhostBtn onClick={() => setShowTelemetryDashboard((v) => !v)}>
                    {showTelemetryDashboard ? 'Hide Endpoints' : 'Endpoints'}
                    {showTelemetryDashboard ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </GhostBtn>
              </div>
                </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-3">
                <KpiCard label="Requests" value={(telemetryOverview.totals?.requests || 0).toLocaleString()} />
                <KpiCard label="5xx Error Rate" value={`${telemetryOverview.totals?.errorRatePct || 0}%`} trend={-(telemetryOverview.totals?.errorRatePct || 0)} />
                <KpiCard label="Latency p95 / p99" value={`${telemetryOverview.latency?.p95Ms || 0} / ${telemetryOverview.latency?.p99Ms || 0} ms`} />
                <KpiCard label="Unique Users" value={(telemetryOverview.totals?.uniqueUsers || 0).toLocaleString()} />
                </div>

              {/* Top paths */}
              {telemetryOverview.traffic?.topPaths?.length > 0 && (
                <div className="mb-3">
                  <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">Top Paths</p>
                  <div className="flex flex-col gap-1">
                    {telemetryOverview.traffic.topPaths.slice(0, 8).map((p) => {
                      const max = telemetryOverview.traffic.topPaths[0]?.count || 1;
                      return (
                        <div key={p.path} className="flex items-center gap-3">
                          <span className="text-[11px] text-gray-400 font-mono w-56 truncate">{p.path}</span>
                          <div className="flex-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                            <div className="h-full rounded-full bg-white/20" style={{ width: `${(p.count / max) * 100}%` }} />
                </div>
                          <span className="text-[11px] text-gray-500 w-12 text-right">{p.count}</span>
                </div>
                      );
                    })}
              </div>
                </div>
              )}

              {/* Status breakdown */}
              {telemetryOverview.traffic?.statusBreakdown?.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {telemetryOverview.traffic.statusBreakdown.map(({ statusCode, count }) => {
                    const code = String(statusCode);
                    return (
                      <div key={code} className={`px-2 py-1 rounded-md border text-[11px] font-medium ${
                        code.startsWith('5') ? 'border-red-500/20 bg-red-500/[0.08] text-red-400'
                        : code.startsWith('4') ? 'border-amber-500/20 bg-amber-500/[0.08] text-amber-400'
                        : 'border-white/[0.07] bg-white/[0.04] text-gray-400'
                      }`}>
                        {code}: {count}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Infra metrics */}
              {showInfraMetrics && infra && (
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 mb-3">
                  <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-3">System</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    <KpiCard label="Heap Used" value={`${Math.round((infra.heapUsedMb || 0))} MB`} sub={`of ${Math.round(infra.heapTotalMb || 0)} MB`} />
                    <KpiCard label="RSS Memory" value={`${Math.round(infra.rssMb || 0)} MB`} />
                    <KpiCard label="Load Avg (1m)" value={Number(infra.loadAvg1m || 0).toFixed(2)} />
                    <KpiCard label="Uptime" value={infra.uptimeHours != null ? `${Number(infra.uptimeHours).toFixed(1)}h` : '—'} />
                  </div>
                </div>
              )}

              {/* Edge events */}
              {showEdgeEvents && (
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 mb-3">
                  <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-3">Edge Events</p>
                  {edgeEvents.length === 0 ? (
                    <p className="text-xs text-gray-600">No edge events in this window.</p>
                  ) : (
                    <div className="overflow-x-auto">
                <table className="w-full">
                        <THead cols={[{ label: 'Time' }, { label: 'Type' }, { label: 'Severity' }, { label: 'Path' }, { label: 'Message' }]} />
                        <tbody>
                          {edgeEvents.map((ev, i) => (
                            <tr key={ev.id || i} className="border-b border-white/[0.04]">
                              <td className="py-2 px-3 text-[11px] text-gray-500 whitespace-nowrap">{fmtDate(ev.createdAt)}</td>
                              <td className="py-2 px-3 text-[11px] font-mono text-gray-400">{ev.eventType}</td>
                              <td className="py-2 px-3">
                                <Badge variant={ev.severity === 'critical' ? 'red' : ev.severity === 'warning' ? 'yellow' : 'default'}>
                                  {ev.severity}
                                </Badge>
                              </td>
                              <td className="py-2 px-3 text-[11px] text-gray-500 font-mono max-w-[160px] truncate">{ev.routePath || '—'}</td>
                              <td className="py-2 px-3 text-[11px] text-gray-400 max-w-[200px] truncate">{ev.message || '—'}</td>
                    </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Endpoint health */}
              {showTelemetryDashboard && (
                <div>
                  <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">
                    Endpoint Health
                    {endpointHealth.checkedAt && (
                      <span className="ml-2 normal-case font-normal text-gray-600">
                        checked {fmtDate(endpointHealth.checkedAt)}
                      </span>
                    )}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <THead cols={[{ label: 'Endpoint' }, { label: 'Status' }, { label: 'Req' }, { label: 'Error %' }, { label: 'Avg ms' }, { label: 'Note' }]} />
                  <tbody>
                    {endpointHealth.items.map((item) => (
                          <tr key={item.endpointKey} className="border-b border-white/[0.04]">
                            <td className="py-2.5 px-3 text-xs">
                              <span className="text-gray-600 mr-1.5 font-mono text-[11px]">{item.method}</span>
                              <span className="text-gray-300">{item.path}</span>
                            </td>
                            <td className="py-2.5 px-3"><Badge variant={healthVariant(item.status)}>{item.status}</Badge></td>
                            <td className="py-2.5 px-3 text-xs text-gray-500">{item.checksCount ?? 0}</td>
                            <td className="py-2.5 px-3 text-xs text-gray-500">{item.errorRatePct != null ? `${item.errorRatePct}%` : '—'}</td>
                            <td className="py-2.5 px-3 text-xs text-gray-500">{item.avgLatencyMs != null ? `${item.avgLatencyMs}` : '—'}</td>
                            <td className="py-2.5 px-3 text-[11px] text-gray-600 max-w-[180px] truncate">{item.message || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
                </div>
              )}
            </>
          )}
        </Section>

        {/* ── Child safety incidents ─────────────────────────────────────────── */}
        <Section>
          <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
            <CollapseToggle
              open={showChildSafetyReports}
              onToggle={() => {
                const next = !showChildSafetyReports;
                setShowChildSafetyReports(next);
                if (next) loadChildSafetyIncidents(1);
              }}
              label="Child safety incident reports"
            />
            {showChildSafetyReports && (
              <GhostBtn onClick={() => loadChildSafetyIncidents(childSafetyPage)} disabled={childSafetyLoading}>
                <RefreshCw className={`w-3 h-3 ${childSafetyLoading ? 'animate-spin' : ''}`} />
                Refresh
              </GhostBtn>
            )}
          </div>
          {showChildSafetyReports && (
            <div className="space-y-3">
              <p className="text-[11px] text-gray-500 -mt-2">
                Immutable records of blocked CP attempts. Stored independently from user account state/deletion for investigation.
              </p>
              <div className="overflow-x-auto rounded-xl border border-white/[0.07]">
                <table className="w-full text-left text-xs min-w-[980px]">
                  <thead>
                    <tr className="border-b border-white/[0.07] text-gray-500">
                      <th className="px-3 py-2 font-medium">Timestamp</th>
                      <th className="px-3 py-2 font-medium">Username</th>
                      <th className="px-3 py-2 font-medium">Email</th>
                      <th className="px-3 py-2 font-medium">IP</th>
                      <th className="px-3 py-2 font-medium">Region</th>
                      <th className="px-3 py-2 font-medium">Mode</th>
                      <th className="px-3 py-2 font-medium">Route</th>
                      <th className="px-3 py-2 font-medium">Prompt</th>
                      <th className="px-3 py-2 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!childSafetyLoading && childSafetyIncidents.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-3 py-6 text-center text-gray-600">No incidents found.</td>
                      </tr>
                    )}
                    {childSafetyIncidents.map((row) => (
                      <tr key={row.id} className="border-b border-white/[0.05]">
                        <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}</td>
                        <td className="px-3 py-2 text-gray-300">{row.usernameSnapshot || '—'}</td>
                        <td className="px-3 py-2 text-gray-300">{row.emailSnapshot || '—'}</td>
                        <td className="px-3 py-2 text-gray-400 font-mono">{row.ipAddress || '—'}</td>
                        <td className="px-3 py-2 text-gray-400">{row.region || '—'}</td>
                        <td className="px-3 py-2 text-gray-300">{row.generationMode || '—'}</td>
                        <td className="px-3 py-2 text-gray-500 font-mono max-w-[180px] truncate">{row.routePath || '—'}</td>
                        <td className="px-3 py-2 text-gray-400 max-w-[280px] truncate" title={row.promptPreview || ''}>
                          {row.promptPreview || '—'}
                        </td>
                        <td className="px-3 py-2 text-red-300">{row.classifierCode || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between text-[11px] text-gray-500">
                <span>
                  Page {childSafetyPagination.page || 1} / {childSafetyPagination.pages || 1} · {(childSafetyPagination.total || 0).toLocaleString()} total
                </span>
                <div className="flex items-center gap-1">
                  <GhostBtn
                    disabled={(childSafetyPagination.page || 1) <= 1 || childSafetyLoading}
                    onClick={() => setChildSafetyPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="w-3 h-3" /> Prev
                  </GhostBtn>
                  <GhostBtn
                    disabled={(childSafetyPagination.page || 1) >= (childSafetyPagination.pages || 1) || childSafetyLoading}
                    onClick={() =>
                      setChildSafetyPage((p) =>
                        Math.min(childSafetyPagination.pages || 1, p + 1),
                      )
                    }
                  >
                    Next <ChevronRight className="w-3 h-3" />
                  </GhostBtn>
                </div>
              </div>
            </div>
          )}
        </Section>

        {/* ── Generation pricing (credits) ──────────────────────────────────── */}
        <Section>
          <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
            <CollapseToggle
              open={showGenerationPricing}
              onToggle={() => {
                const next = !showGenerationPricing;
                setShowGenerationPricing(next);
                if (next) loadGenerationPricing();
              }}
              label="Generation pricing (credits)"
            />
            {showGenerationPricing && (
              <GhostBtn onClick={loadGenerationPricing} disabled={loadingGenPricing}>
                <RefreshCw className={`w-3 h-3 ${loadingGenPricing ? 'animate-spin' : ''}`} />
                Refresh
              </GhostBtn>
            )}
          </div>
          {showGenerationPricing && (
            <div className="space-y-5">
              <p className="text-[11px] text-gray-500 -mt-2">
                Credit costs charged for generations and model workflows. Values are integers (credits). Changes apply on save; backend caches for a few seconds.
              </p>
              {genPricingContract && (
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 text-xs">
                  <p className="font-medium text-gray-200">Contract check</p>
                  <p className="text-gray-400 mt-1">
                    Backend keys: {contractKeys.length} · UI mapped keys: {mappedKeys.size}
                  </p>
                  {missingUiMappings.length === 0 && staleUiMappings.length === 0 ? (
                    <p className="text-emerald-300 mt-2">All backend pricing keys are mapped in this admin UI.</p>
                  ) : (
                    <div className="mt-2 space-y-1">
                      {missingUiMappings.length > 0 && (
                        <p className="text-amber-300">
                          Missing UI mappings: {missingUiMappings.join(', ')}
                        </p>
                      )}
                      {staleUiMappings.length > 0 && (
                        <p className="text-amber-300">
                          UI keys not in backend contract: {staleUiMappings.join(', ')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
              {loadingGenPricing && !genPricing ? (
                <div className="flex items-center gap-2 text-xs text-gray-500 py-6">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading pricing…
                </div>
              ) : genPricing ? (
                <>
                  {GENERATION_PRICING_GROUPS.map((group) => (
                    <div key={group.title} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                      <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-3">{group.title}</p>
                      <div className="grid sm:grid-cols-2 gap-3">
                        {group.fields.map(({ key, label }) => {
                          const def = genPricingDefaults?.[key];
                          const val = genPricing[key];
                          return (
                            <label key={key} className="flex flex-col gap-1">
                              <span className="text-[11px] text-gray-500">{label}</span>
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={Number.isFinite(Number(val)) ? val : 0}
                                  onChange={(e) => {
                                    const n = parseInt(e.target.value, 10);
                                    setGenPricing((p) => ({ ...p, [key]: Number.isFinite(n) && n >= 0 ? n : 0 }));
                                  }}
                                  className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs text-white outline-none focus:border-white/20 transition [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                                {def != null && def !== val && (
                                  <span className="text-[10px] text-gray-600 whitespace-nowrap" title="Default">
                                    def {def}
                                  </span>
                                )}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-2">
                    <PrimaryBtn onClick={saveGenerationPricing} disabled={savingGenPricing}>
                      {savingGenPricing ? 'Saving…' : 'Save pricing'}
                    </PrimaryBtn>
                    <GhostBtn onClick={() => setConfirmResetGenPricing(true)} disabled={savingGenPricing}>
                      Reset to defaults
                    </GhostBtn>
                  </div>
                </>
              ) : (
                <p className="text-xs text-gray-600">Could not load pricing.</p>
              )}
            </div>
          )}
        </Section>

        <Section>
          <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
            <CollapseToggle
              open={showSafetyCheckerConfig}
              onToggle={() => {
                const next = !showSafetyCheckerConfig;
                setShowSafetyCheckerConfig(next);
                if (next) loadSafetyCheckerConfig();
              }}
              label="AI safety checker config"
            />
            {showSafetyCheckerConfig && (
              <GhostBtn onClick={loadSafetyCheckerConfig} disabled={loadingSafetyCheckerConfig}>
                <RefreshCw className={`w-3 h-3 ${loadingSafetyCheckerConfig ? 'animate-spin' : ''}`} />
                Refresh
              </GhostBtn>
            )}
          </div>
          {showSafetyCheckerConfig && (
            <div className="space-y-3">
              <p className="text-[11px] text-gray-500 -mt-2">
                Override moderation model, AI policy text, and heuristic regex patterns. Invalid regex values fall back to defaults.
              </p>
              <textarea
                value={safetyCheckerConfigText}
                onChange={(e) => setSafetyCheckerConfigText(e.target.value)}
                className="w-full min-h-[220px] rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs text-white p-3 font-mono outline-none focus:border-white/20"
                spellCheck={false}
              />
              <div className="flex items-center gap-2">
                <PrimaryBtn onClick={saveSafetyCheckerConfig} disabled={savingSafetyCheckerConfig}>
                  {savingSafetyCheckerConfig ? 'Saving…' : 'Save safety checker config'}
                </PrimaryBtn>
              </div>
            </div>
          )}
        </Section>

        <Section>
          <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
            <CollapseToggle
              open={showPromptTemplates}
              onToggle={() => {
                const next = !showPromptTemplates;
                setShowPromptTemplates(next);
                if (next) loadPromptTemplates();
              }}
              label="AI prompt templates"
            />
            {showPromptTemplates && (
              <GhostBtn onClick={loadPromptTemplates} disabled={loadingPromptTemplates}>
                <RefreshCw className={`w-3 h-3 ${loadingPromptTemplates ? 'animate-spin' : ''}`} />
                Refresh
              </GhostBtn>
            )}
          </div>
          {showPromptTemplates && (
            <div className="space-y-3">
              <p className="text-[11px] text-gray-500 -mt-2">
                Open each use-case to view the currently stored prompt template, edit it, and save it. Empty value means fallback to code default.
              </p>
              <input
                value={promptTemplateSearch}
                onChange={(e) => setPromptTemplateSearch(e.target.value)}
                placeholder="Filter use-cases by key"
                className="w-full px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs text-white outline-none focus:border-white/20"
              />
              <div className="max-h-[320px] overflow-y-auto rounded-xl border border-white/[0.07]">
                <div className="divide-y divide-white/[0.06]">
                  {(promptTemplateKnownKeys.length ? promptTemplateKnownKeys : Object.keys(promptTemplatesMap))
                    .filter((key) => {
                      const q = promptTemplateSearch.trim().toLowerCase();
                      if (!q) return true;
                      return String(key).toLowerCase().includes(q);
                    })
                    .map((key) => {
                      const value = String(promptTemplatesMap?.[key] || '');
                      const customValue = String(promptTemplatesOverridesMap?.[key] || '');
                      const hasCustom = Boolean(customValue.trim());
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => openPromptTemplateModal(key)}
                          className="w-full text-left px-3 py-2.5 hover:bg-white/[0.03] transition"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-white">{formatPromptTemplateLabel(key)}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/[0.12] text-gray-400 font-mono">{key}</span>
                            <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded border ${hasCustom ? 'border-emerald-500/30 text-emerald-300' : 'border-white/[0.10] text-gray-500'}`}>
                              {hasCustom ? 'Custom prompt' : 'Code default'}
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-500 mt-1 max-h-8 overflow-hidden">
                            {hasCustom ? value : 'No custom value saved. This use-case currently runs on the code fallback prompt.'}
                          </p>
                        </button>
                      );
                    })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-500">
                  {Object.keys(promptTemplatesMap || {}).length} prompt use-cases loaded
                </span>
              </div>
            </div>
          )}
        </Section>

        <Section>
          <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
            <CollapseToggle
              open={showNudesPackPoseOverrides}
              onToggle={() => {
                const next = !showNudesPackPoseOverrides;
                setShowNudesPackPoseOverrides(next);
                if (next) loadNudesPackPoseOverrides();
              }}
              label="Nudes pack pose overrides"
            />
            {showNudesPackPoseOverrides && (
              <GhostBtn onClick={loadNudesPackPoseOverrides} disabled={loadingNudesPackPoseOverrides}>
                <RefreshCw className={`w-3 h-3 ${loadingNudesPackPoseOverrides ? 'animate-spin' : ''}`} />
                Refresh
              </GhostBtn>
            )}
          </div>
          {showNudesPackPoseOverrides && (
            <div className="space-y-3">
              <p className="text-[11px] text-gray-500 -mt-2">
                Manage effective nudes-pack poses. Structured mode supports inline edits; raw JSON mode is kept for bulk import/export.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setNudesPackPoseViewMode('structured')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] border ${nudesPackPoseViewMode === 'structured' ? 'border-white/30 bg-white/10 text-white' : 'border-white/10 text-gray-400 hover:text-white'}`}
                >
                  Structured editor
                </button>
                <button
                  onClick={() => setNudesPackPoseViewMode('raw')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] border ${nudesPackPoseViewMode === 'raw' ? 'border-white/30 bg-white/10 text-white' : 'border-white/10 text-gray-400 hover:text-white'}`}
                >
                  Raw JSON
                </button>
                {nudesPackPoseViewMode === 'structured' && (
                  <input
                    value={nudesPackPoseSearch}
                    onChange={(e) => setNudesPackPoseSearch(e.target.value)}
                    placeholder="Filter poses by id/title/category"
                    className="ml-auto px-3 py-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs text-white outline-none focus:border-white/20 min-w-[220px]"
                  />
                )}
              </div>

              {nudesPackPoseViewMode === 'structured' ? (
                <div className="space-y-3">
                  {nudesPackPoseCatalog
                    .filter((pose) => {
                      const q = nudesPackPoseSearch.trim().toLowerCase();
                      if (!q) return true;
                      return [pose.id, pose.title, pose.category].some((v) => String(v || '').toLowerCase().includes(q));
                    })
                    .map((pose) => (
                      <div key={pose.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-gray-400 font-mono">{pose.id}</span>
                          <label className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-gray-400">
                            <input
                              type="checkbox"
                              checked={pose.enabled !== false}
                              onChange={(e) => setNudesPackPoseCatalog((prev) => prev.map((p) => p.id === pose.id ? { ...p, enabled: e.target.checked } : p))}
                            />
                            Enabled
                          </label>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-2">
                          <input
                            value={pose.title || ''}
                            onChange={(e) => setNudesPackPoseCatalog((prev) => prev.map((p) => p.id === pose.id ? { ...p, title: e.target.value } : p))}
                            placeholder="Title"
                            className="px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs text-white outline-none focus:border-white/20"
                          />
                          <input
                            value={pose.category || ''}
                            onChange={(e) => setNudesPackPoseCatalog((prev) => prev.map((p) => p.id === pose.id ? { ...p, category: e.target.value } : p))}
                            placeholder="Category"
                            className="px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs text-white outline-none focus:border-white/20"
                          />
                        </div>
                        <textarea
                          value={pose.summary || ''}
                          onChange={(e) => setNudesPackPoseCatalog((prev) => prev.map((p) => p.id === pose.id ? { ...p, summary: e.target.value } : p))}
                          placeholder="Summary"
                          rows={2}
                          className="w-full px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs text-white outline-none focus:border-white/20"
                        />
                        <textarea
                          value={pose.promptFragment || ''}
                          onChange={(e) => setNudesPackPoseCatalog((prev) => prev.map((p) => p.id === pose.id ? { ...p, promptFragment: e.target.value } : p))}
                          placeholder="Prompt fragment"
                          rows={4}
                          className="w-full px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs text-white outline-none focus:border-white/20 font-mono"
                        />
                      </div>
                    ))}
                </div>
              ) : (
                <textarea
                  value={nudesPackPoseOverridesText}
                  onChange={(e) => setNudesPackPoseOverridesText(e.target.value)}
                  className="w-full min-h-[220px] rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs text-white p-3 font-mono outline-none focus:border-white/20"
                  spellCheck={false}
                />
              )}
              <div className="flex items-center gap-2">
                <PrimaryBtn
                  onClick={nudesPackPoseViewMode === 'structured' ? saveStructuredNudesPackPoses : saveNudesPackPoseOverrides}
                  disabled={savingNudesPackPoseOverrides}
                >
                  {savingNudesPackPoseOverrides ? 'Saving…' : (nudesPackPoseViewMode === 'structured' ? 'Save pose catalog' : 'Save pose overrides')}
                </PrimaryBtn>
                <GhostBtn onClick={loadNudesPackPoseOverrides} disabled={loadingNudesPackPoseOverrides || savingNudesPackPoseOverrides}>
                  Reset from server
                </GhostBtn>
              </div>
            </div>
          )}
        </Section>

        {/* ── Custom voices (platform cap) ─────────────────────────── */}
        <Section>
          <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
            <CollapseToggle
              open={showVoicePlatform}
              onToggle={() => {
                const next = !showVoicePlatform;
                setShowVoicePlatform(next);
                if (next) loadVoicePlatformConfig();
              }}
              label="Custom voices (platform cap)"
            />
            {showVoicePlatform && (
              <GhostBtn onClick={loadVoicePlatformConfig} disabled={loadingVoicePlatform}>
                <RefreshCw className={`w-3 h-3 ${loadingVoicePlatform ? 'animate-spin' : ''}`} />
                Refresh
              </GhostBtn>
            )}
          </div>
          {showVoicePlatform && (
            <div className="space-y-4 max-w-md">
              <p className="text-[11px] text-gray-500 -mt-2">
                Hard cap on unique custom ElevenLabs voices stored on this platform (design + clone, legacy + Voice Studio).
                Re-selecting an already stored voice does not increase usage.
              </p>
              <p className="text-xs text-gray-400">
                Currently using: <span className="text-white font-mono">{voicePlatformUsed}</span> unique custom voices
              </p>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-gray-500">Max saved model voices (platform-wide)</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={voicePlatformMax}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setVoicePlatformMax(Number.isFinite(n) && n >= 1 ? n : 1);
                  }}
                  className="px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs text-white outline-none focus:border-white/20"
                />
              </label>
              <PrimaryBtn onClick={saveVoicePlatformConfig} disabled={savingVoicePlatform}>
                {savingVoicePlatform ? 'Saving…' : 'Save cap'}
              </PrimaryBtn>
              <GhostBtn onClick={() => cleanupZombieVoices(true)} disabled={cleaningZombieVoices}>
                <Search className={`w-3 h-3 ${cleaningZombieVoices ? 'animate-pulse' : ''}`} />
                Dry run zombies
              </GhostBtn>
              <GhostBtn onClick={() => cleanupZombieVoices(false)} disabled={cleaningZombieVoices}>
                <Trash2 className={`w-3 h-3 ${cleaningZombieVoices ? 'animate-pulse' : ''}`} />
                {cleaningZombieVoices ? 'Cleaning…' : 'Cleanup zombie voices'}
              </GhostBtn>
              {zombieVoiceCleanupResult?.success && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] p-2.5 text-[11px] text-emerald-300">
                  {zombieVoiceCleanupResult?.dryRun ? 'Dry run:' : 'Deleted'}{' '}
                  <span className="font-mono text-emerald-200">
                    {zombieVoiceCleanupResult?.dryRun
                      ? zombieVoiceCleanupResult.zombieCandidates || 0
                      : zombieVoiceCleanupResult.deleted || 0}
                  </span>
                  {' '}
                  {zombieVoiceCleanupResult?.dryRun ? 'zombie candidates found' : 'of'}
                  {!zombieVoiceCleanupResult?.dryRun && (
                    <>
                      {' '}
                      <span className="font-mono text-emerald-200">{zombieVoiceCleanupResult.zombieCandidates || 0}</span>
                      {' '}zombie voices.
                    </>
                  )}
                  {Number(zombieVoiceCleanupResult.failed || 0) > 0 && (
                    <span className="text-amber-300"> Failed: {zombieVoiceCleanupResult.failed}.</span>
                  )}
                </div>
              )}
            </div>
          )}
        </Section>

        {/* ── Service API balances ─────────────────────────────────────────── */}
        <Section>
          <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
            <CollapseToggle
              open={showProviderBalances}
              onToggle={() => {
                const next = !showProviderBalances;
                setShowProviderBalances(next);
                if (next && !providerBalances && !loadingProviderBalances) loadProviderBalances();
              }}
              label="Service API balances"
            />
            {showProviderBalances && (
              <GhostBtn onClick={loadProviderBalances} disabled={loadingProviderBalances}>
                <RefreshCw className={`w-3 h-3 ${loadingProviderBalances ? 'animate-spin' : ''}`} />
                Refresh
              </GhostBtn>
            )}
          </div>
          {showProviderBalances && (
            <div className="space-y-3">
              <p className="text-[11px] text-gray-500 -mt-2 flex items-start gap-2">
                <Wallet className="w-3.5 h-3.5 text-gray-600 shrink-0 mt-0.5" />
                <span>
                  Live balances from connected external services (server env keys only — never exposed here).
                  Some services require dedicated management keys for credits endpoints.
                </span>
              </p>
              {providerBalances?.checkedAt && (
                <p className="text-[10px] text-gray-600">
                  Checked {new Date(providerBalances.checkedAt).toLocaleString()}
                </p>
              )}
              {loadingProviderBalances && !providerBalances?.providers?.length ? (
                <div className="flex items-center gap-2 text-xs text-gray-500 py-6">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading service data…
                </div>
              ) : providerBalances?.providers?.length ? (
                <div className="overflow-x-auto rounded-xl border border-white/[0.07]">
                  <table className="w-full text-xs">
                    <THead cols={[
                      { label: 'Service' },
                      { label: 'Env key' },
                      { label: 'Status' },
                      { label: 'Summary' },
                      { label: 'Detail / error' },
                    ]} />
                    <tbody>
                      {providerBalances.providers.map((p, idx) => (
                        <tr key={p.id} className="border-b border-white/[0.04]">
                          <td className="py-2.5 px-3 text-gray-300 font-medium whitespace-nowrap">{`Service ${idx + 1}`}</td>
                          <td className="py-2.5 px-3">
                            <Badge variant={p.configured ? 'green' : 'default'}>
                              {p.configured ? 'Configured' : 'Missing'}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-3">
                            <Badge variant={p.status === 'ok' ? 'green' : p.status === 'not_configured' ? 'default' : 'red'}>
                              {p.status === 'ok' ? 'OK' : p.status === 'not_configured' ? '—' : 'Error'}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-3 text-gray-200 font-medium whitespace-nowrap">{redactProviderText(p.headline)}</td>
                          <td className="py-2.5 px-3 text-gray-500 max-w-[min(360px,85vw)]">
                            {p.error ? (
                              <span className="text-red-400/90 break-words">{redactProviderText(p.error, 'Error')}</span>
                            ) : (
                              <span className="break-words">
                                {p.lines?.length ? p.lines.map((l) => `${redactProviderText(l.label, 'item')}: ${redactProviderText(l.value, '')}`).join(' · ') : '—'}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <GhostBtn onClick={loadProviderBalances}>Load balances</GhostBtn>
              )}
            </div>
          )}
        </Section>

        {/* ── Reel Finder ───────────────────────────────────────────────────── */}
        <Section>
          <SectionHeader
            title="Reel Finder"
            actions={
              <GhostBtn onClick={loadReelFinderAdmin} disabled={loadingReelFinder}>
                <RefreshCw className={`w-3 h-3 ${loadingReelFinder ? 'animate-spin' : ''}`} />
                {loadingReelFinder ? 'Loading…' : 'Refresh'}
              </GhostBtn>
            }
          />

          {/* Summary row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-4">
            <KpiCard label="Tracked Profiles" value={reelProfiles.length} sub={`${reelProfiles.filter((p) => p.isActive).length} active`} />
            <KpiCard label="Total Reels" value={reelProfiles.reduce((s, p) => s + (p._count?.reels || 0), 0).toLocaleString()} />
            <KpiCard label="Last Log Status" value={reelLogs[0]?.status || '—'} sub={reelLogs[0] ? fmtDate(reelLogs[0].startedAt) : undefined} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4 mb-5">
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-2.5">
              <p className="text-xs font-medium text-gray-300">Add Profiles</p>
              <div className="flex gap-2">
                <input value={newReelUsername} onChange={(e) => setNewReelUsername(e.target.value)} placeholder="@username"
                  className="flex-1 px-3 py-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs outline-none focus:border-white/20 transition" />
                <PrimaryBtn onClick={handleAddReelProfile}>Add</PrimaryBtn>
              </div>
              <textarea value={bulkReelUsernames} onChange={(e) => setBulkReelUsernames(e.target.value)}
                placeholder="@user1, @user2 or one per line" rows={4}
                className="w-full px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs outline-none focus:border-white/20 transition resize-none" />
              <GhostBtn onClick={handleBulkAddReelProfiles}>Bulk Add</GhostBtn>
            </div>

            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
              <p className="text-xs font-medium text-gray-300 mb-3">Actions</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { a: 'scrape', label: 'Force Scrape', primary: true },
                  { a: 'hot', label: 'Hot Re-scrape' },
                  { a: 'warm', label: 'Warm Re-scrape' },
                  { a: 'recalculate', label: 'Recalculate Scores' },
                ].map(({ a, label, primary }) => (
                  <button key={a} onClick={() => handleRunReelAction(a)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition ${primary ? 'bg-white text-black hover:bg-gray-100' : 'border border-white/[0.07] bg-white/[0.04] text-gray-300 hover:bg-white/[0.08]'}`}>
                    {label}
                  </button>
                ))}
                <button onClick={() => handleRunReelAction('groups')}
                  className="col-span-2 px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] text-xs font-medium transition">
                  Assign Scrape Groups
                </button>
              </div>
              <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-2">
                <label className="flex items-center gap-2 text-[11px] text-gray-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={clearReelsRescrape}
                    onChange={(e) => setClearReelsRescrape(e.target.checked)}
                    className="rounded border-white/20 bg-white/5"
                  />
                  After clear, start full rescrape (if external scraper is configured)
                </label>
                <DangerBtn
                  onClick={() => setConfirmClearReels(true)}
                  disabled={clearReelsLoading}
                  className="w-full justify-center"
                >
                  <Trash2 className="w-3 h-3" />
                  {clearReelsLoading ? 'Working…' : 'Clear all cached reels'}
                </DangerBtn>
                <p className="text-[10px] text-gray-600 leading-relaxed">
                  Removes every reel row from the database (thumbnails, scores, video URLs). Tracked profiles are kept. Use when URLs are stale or you need a clean rescrape.
                </p>
              </div>
              <div className="mt-3 p-3 rounded-lg border border-white/[0.05] bg-white/[0.01]">
                <p className="text-[11px] text-gray-400 font-medium mb-1">Rolling Schedule (Groups 0–5)</p>
                <p className="text-[11px] text-gray-600 mb-2">One group scraped daily — each profile every ~6 days.</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                  {[0,1,2,3,4,5].map((g) => (
                    <div key={g} className="flex items-center gap-1.5 text-[11px] text-gray-500">
                      <span className="w-4 h-4 rounded bg-white/[0.05] text-gray-400 font-mono text-[10px] flex items-center justify-center">{g}</span>
                      Day {g + 1}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mb-3"><CollapseToggle open={showTrackedProfiles} onToggle={() => setShowTrackedProfiles((v) => !v)} label="Tracked Profiles" /></div>
          {showTrackedProfiles && (
            <div className="overflow-x-auto mb-6">
            <table className="w-full">
                <THead cols={[{ label: 'Username' }, { label: 'Reels' }, { label: 'Group' }, { label: 'Last Scrape' }, { label: 'Status' }, { label: 'Actions', align: 'right' }]} />
              <tbody>
                {reelProfiles.map((p) => (
                    <tr key={p.id} className="border-b border-white/[0.04]">
                      <td className="py-2.5 px-3 text-xs text-gray-300">@{p.username}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-500">{p._count?.reels || 0}</td>
                      <td className="py-2.5 px-3">
                        <select value={p.scrapeGroup ?? 0} onChange={(e) => handleUpdateReelScrapeGroup(p, e.target.value)}
                          className="px-2 py-1 rounded-md border border-white/[0.07] bg-white/[0.04] text-xs text-gray-300 outline-none">
                          {[0,1,2,3,4,5].map((g) => <option key={g} value={g} className="bg-[#111]">Group {g}</option>)}
                      </select>
                    </td>
                      <td className="py-2.5 px-3 text-[11px] text-gray-500 whitespace-nowrap">{p.lastScrapedAt ? fmtDate(p.lastScrapedAt) : 'Never'}</td>
                      <td className="py-2.5 px-3"><Badge variant={p.isActive ? 'green' : 'default'}>{p.isActive ? 'Active' : 'Disabled'}</Badge></td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <PrimaryBtn onClick={() => handleScrapeSingleProfile(p)} className="py-1 px-2.5 text-[11px]">Scrape</PrimaryBtn>
                          <GhostBtn onClick={() => handleToggleReelProfile(p)} className="py-1 px-2.5 text-[11px]">{p.isActive ? 'Disable' : 'Enable'}</GhostBtn>
                          <button onClick={() => handleDeleteReelProfile(p)} className="p-1.5 rounded-md bg-red-500/[0.08] hover:bg-red-500/[0.15] border border-red-500/[0.12] transition">
                            <Trash2 className="w-3 h-3 text-red-400/70" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loadingReelFinder && reelProfiles.length === 0 && (
                    <tr><td colSpan={6} className="py-4 px-3 text-xs text-gray-600">No profiles yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          )}

          <div className="mt-4 mb-3"><CollapseToggle open={showScrapeLogs} onToggle={() => setShowScrapeLogs((v) => !v)} label="Scrape Logs" /></div>
          {showScrapeLogs && (
          <div className="overflow-x-auto">
            <table className="w-full">
                <THead cols={[{ label: 'Started' }, { label: 'Status' }, { label: 'Profiles' }, { label: 'Reels' }, { label: 'Finished' }]} />
              <tbody>
                {reelLogs.map((log) => (
                    <tr key={log.id} className="border-b border-white/[0.04]">
                      <td className="py-2.5 px-3 text-[11px] text-gray-400 whitespace-nowrap">{fmtDate(log.startedAt)}</td>
                      <td className="py-2.5 px-3"><Badge variant={log.status === 'success' ? 'green' : log.status === 'error' ? 'red' : 'yellow'}>{log.status}</Badge></td>
                      <td className="py-2.5 px-3 text-xs text-gray-500">{log.profilesScraped ?? '—'}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-500">{log.reelsFound ?? '—'}</td>
                      <td className="py-2.5 px-3 text-[11px] text-gray-500 whitespace-nowrap">{log.finishedAt ? fmtDate(log.finishedAt) : 'Running…'}</td>
                  </tr>
                ))}
                {!loadingReelFinder && reelLogs.length === 0 && (
                    <tr><td colSpan={5} className="py-4 px-3 text-xs text-gray-600">No scrape logs yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          )}
        </Section>

        {/* ── Brand Settings ────────────────────────────────────────────────── */}
        <Section>
          <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
            <CollapseToggle open={showBrandSettings} onToggle={() => setShowBrandSettings((v) => !v)} label="Brand Settings" />
            {showBrandSettings && <GhostBtn onClick={loadBranding} disabled={loadingBranding}><RefreshCw className="w-3 h-3" /> Refresh</GhostBtn>}
          </div>
          {showBrandSettings && (
            <div className="grid lg:grid-cols-2 gap-4">
              <div className="space-y-2.5">
                {[{ k: 'appName', ph: 'App name' }, { k: 'logoUrl', ph: 'Logo URL' }, { k: 'faviconUrl', ph: 'Favicon URL (optional)' }, { k: 'baseUrl', ph: 'Base URL' }].map(({ k, ph }) => (
                  <input key={k} value={brandSettings[k]} onChange={(e) => setBrandSettings((p) => ({ ...p, [k]: e.target.value }))}
                    placeholder={ph} className="w-full px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs outline-none focus:border-white/20 transition" />
                ))}
              <div className="flex items-center gap-2">
                  <label className="px-3 py-1.5 rounded-lg border border-white/[0.07] bg-white/[0.04] hover:bg-white/[0.08] text-xs text-gray-300 cursor-pointer transition">
                    Upload Logo
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUploadBrandLogo(e.target.files?.[0])} />
                </label>
                  <PrimaryBtn onClick={handleSaveBranding} disabled={savingBranding}>
                    {savingBranding ? 'Saving…' : 'Save'}
                  </PrimaryBtn>
              </div>

              {/* Tutorial Video */}
              <div className="pt-4 mt-2 border-t border-white/[0.06]">
                <p className="text-xs font-semibold text-gray-300 mb-1">Quick Tutorial Video</p>
                <p className="text-[11px] text-gray-500 mb-3">Shown on the dashboard for new users. Upload an MP4 to replace it.</p>

                {/* Preview */}
                {brandSettings.tutorialVideoUrl && (
                  <div className="mb-3 rounded-xl overflow-hidden border border-white/[0.07] bg-black" style={{ maxHeight: 160 }}>
                    <video
                      key={brandSettings.tutorialVideoUrl}
                      src={brandSettings.tutorialVideoUrl}
                      controls
                      className="w-full h-full object-contain"
                      style={{ maxHeight: 160 }}
                    />
                  </div>
                )}

                {!brandSettings.tutorialVideoUrl && (
                  <div className="mb-3 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] flex items-center justify-center py-6">
                    <p className="text-[11px] text-gray-600">No custom video — using default</p>
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 text-xs text-violet-300 cursor-pointer transition ${tutorialVideoUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                    {tutorialVideoUploading ? (
                      <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10"/></svg>
                    ) : (
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    )}
                    {tutorialVideoUploading ? 'Uploading…' : (brandSettings.tutorialVideoUrl ? 'Replace Video' : 'Upload Video')}
                    <input type="file" accept="video/mp4,video/*" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setTutorialVideoUploading(true);
                      try {
                        const fd = new FormData(); fd.append('video', file);
                        const r = await api.post('/admin/tutorial-video', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
                        if (r.data?.success) { setBrandSettings((p) => ({ ...p, tutorialVideoUrl: r.data.url })); toast.success('Tutorial video updated!'); }
                        else toast.error('Upload failed');
                      } catch (ex) { toast.error(ex?.response?.data?.error || 'Upload failed'); }
                      finally { setTutorialVideoUploading(false); e.target.value = ''; }
                    }} />
                  </label>

                  {brandSettings.tutorialVideoUrl && (
                    <button
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/25 bg-red-500/8 hover:bg-red-500/18 text-xs text-red-400 transition"
                      onClick={async () => {
                        if (!confirm('Reset tutorial video to default?')) return;
                        try {
                          await api.delete('/admin/tutorial-video');
                          setBrandSettings((p) => ({ ...p, tutorialVideoUrl: '' }));
                          toast.success('Tutorial video reset to default');
                        } catch { toast.error('Failed to reset'); }
                      }}
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                      Reset to Default
                    </button>
                  )}
                </div>

                {brandSettings.tutorialVideoUrl && (
                  <p className="text-[10px] text-slate-600 mt-2 truncate">{brandSettings.tutorialVideoUrl}</p>
                )}

                {/* Create AI Model lander — hero demo video */}
                <div className="pt-4 mt-4 border-t border-white/[0.06]">
                  <p className="text-xs font-semibold text-gray-300 mb-1">Create AI Model lander — demo video</p>
                  <p className="text-[11px] text-gray-500 mb-3">
                    Shown below the hero on <code className="text-gray-400">/create-ai-model</code>. Paste an HTTPS MP4 URL or upload (R2).
                  </p>
                  <input
                    value={brandSettings.landerDemoVideoUrl}
                    onChange={(e) => setBrandSettings((p) => ({ ...p, landerDemoVideoUrl: e.target.value }))}
                    placeholder="https://…/your-demo.mp4"
                    className="w-full px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs outline-none focus:border-white/20 transition mb-3"
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 text-xs text-violet-300 cursor-pointer transition ${landerDemoVideoUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                      {landerDemoVideoUploading ? (
                        <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10"/></svg>
                      ) : (
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      )}
                      {landerDemoVideoUploading ? 'Uploading…' : (brandSettings.landerDemoVideoUrl ? 'Replace lander video' : 'Upload lander video')}
                      <input type="file" accept="video/mp4,video/*" className="hidden" onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setLanderDemoVideoUploading(true);
                        try {
                          const fd = new FormData(); fd.append('video', file);
                          const r = await api.post('/admin/lander-demo-video', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
                          if (r.data?.success) { setBrandSettings((p) => ({ ...p, landerDemoVideoUrl: r.data.url })); toast.success('Lander demo video updated'); }
                          else toast.error('Upload failed');
                        } catch (ex) { toast.error(ex?.response?.data?.error || 'Upload failed'); }
                        finally { setLanderDemoVideoUploading(false); e.target.value = ''; }
                      }} />
                    </label>
                    {brandSettings.landerDemoVideoUrl && (
                      <button
                        type="button"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/25 bg-red-500/8 hover:bg-red-500/18 text-xs text-red-400 transition"
                        onClick={async () => {
                          if (!confirm('Reset lander demo video to built-in default?')) return;
                          try {
                            await api.delete('/admin/lander-demo-video');
                            setBrandSettings((p) => ({ ...p, landerDemoVideoUrl: '' }));
                            toast.success('Lander demo reset to default');
                          } catch { toast.error('Failed to reset'); }
                        }}
                      >
                        Reset to default
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-600 mt-2">Save brand settings to persist URL edits; upload applies immediately.</p>
                </div>

                <div className="pt-4 mt-4 border-t border-white/[0.06]">
                  <p className="text-xs font-semibold text-gray-300 mb-1">Legal pages (Markdown)</p>
                  <p className="text-[11px] text-gray-500 mb-3">
                    Optional. When saved, public <code className="text-gray-400">/terms</code>, <code className="text-gray-400">/privacy</code>, <code className="text-gray-400">/cookies</code> use this content instead of built-in text. Upload <code className="text-gray-400">.md</code> or paste below, then Save with the rest of brand settings.
                  </p>
                  {[
                    { key: 'termsMarkdown', label: 'Terms of Service (.md)' },
                    { key: 'privacyMarkdown', label: 'Privacy Policy (.md)' },
                    { key: 'cookiesMarkdown', label: 'Cookie Policy (.md)' },
                  ].map(({ key, label }) => (
                    <div key={key} className="mb-4">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[11px] text-gray-400">{label}</span>
                        <div className="flex items-center gap-2">
                          <label className="text-[10px] px-2 py-1 rounded border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer text-gray-400">
                            Upload .md
                            <input
                              type="file"
                              accept=".md,.markdown,text/markdown,text/plain"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = '';
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onload = () => {
                                  setBrandSettings((p) => ({ ...p, [key]: String(reader.result || '') }));
                                  toast.success(`${label.split('(')[0].trim()} loaded from file`);
                                };
                                reader.readAsText(file);
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            className="text-[10px] px-2 py-1 rounded border border-red-500/20 text-red-400/90 hover:bg-red-500/10"
                            onClick={() => setBrandSettings((p) => ({ ...p, [key]: '' }))}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      <textarea
                        value={brandSettings[key] || ''}
                        onChange={(e) => setBrandSettings((p) => ({ ...p, [key]: e.target.value }))}
                        rows={7}
                        placeholder="# Heading&#10;&#10;Your Markdown…"
                        className="w-full px-3 py-2 rounded-lg border border-white/[0.07] bg-black/40 text-[11px] text-gray-200 font-mono outline-none focus:border-violet-500/35 resize-y min-h-[120px]"
                      />
                    </div>
                  ))}
                  <PrimaryBtn type="button" onClick={handleSaveBranding} disabled={savingBranding} className="mt-1">
                    {savingBranding ? 'Saving…' : 'Save legal pages (with brand settings)'}
                  </PrimaryBtn>
                </div>

                <div className="pt-4 mt-4 border-t border-white/[0.06]">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-xs font-semibold text-gray-300">Page / Mode Tutorial Slots</p>
                    <GhostBtn onClick={loadTutorialSlots} disabled={loadingTutorialSlots} className="py-1 px-2 text-[10px]">
                      {loadingTutorialSlots ? 'Refreshing…' : 'Refresh slots'}
                    </GhostBtn>
                  </div>
                  <p className="text-[11px] text-gray-500 mb-3">
                    Upload videos for My Models, Generate Video modes, Creator Studio, and NSFW mode tutorials.
                  </p>
                  <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                    {tutorialSlots.map((slot) => (
                      <div key={slot.key} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <p className="text-[11px] text-gray-200">{slot.label}</p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${slot.exists ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.08] text-gray-500'}`}>
                            {slot.exists ? 'Set' : 'Not set'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <label className={`px-2.5 py-1 rounded-md border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 text-[11px] text-violet-300 cursor-pointer transition ${uploadingTutorialSlot === slot.key ? 'opacity-50 pointer-events-none' : ''}`}>
                            {uploadingTutorialSlot === slot.key ? 'Uploading…' : 'Upload video'}
                            <input
                              type="file"
                              accept="video/mp4,video/*"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                e.target.value = '';
                                if (!file) return;
                                await handleUploadTutorialSlot(slot.key, file);
                              }}
                            />
                          </label>
                          {slot.url && (
                            <a
                              href={slot.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] text-slate-500 hover:text-slate-300 truncate max-w-[280px]"
                            >
                              {slot.url}
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                    {!loadingTutorialSlots && tutorialSlots.length === 0 && (
                      <p className="text-[11px] text-gray-600">No tutorial slots found.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                <p className="text-[11px] text-gray-500 mb-3">Preview</p>
                <div className="flex items-center gap-3 mb-3">
                  <img src={brandSettings.logoUrl || '/logo-512.png'} alt="" className="w-10 h-10 rounded-xl object-cover border border-white/[0.08]" />
                <div>
                    <p className="text-sm font-semibold">{brandSettings.appName || 'ModelClone'}</p>
                    <p className="text-[11px] text-gray-500">{brandSettings.baseUrl || 'https://modelclone.app'}</p>
                </div>
              </div>
                <p className="text-[11px] text-gray-600">Updates email branding, dashboard logos, and favicon for new sessions.</p>
            </div>
          </div>
          )}
        </Section>

        {/* ── Backup Management ─────────────────────────────────────────────── */}
        <Section>
          <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
            <CollapseToggle open={showBackupPanel} onToggle={() => setShowBackupPanel((v) => !v)} label="Backup Management" />
            {showBackupPanel && (
              <PrimaryBtn onClick={handleCreateBackup} disabled={backingUp}>
                {backingUp ? <><div className="w-3 h-3 border border-black/30 border-t-black rounded-full animate-spin" /> Creating…</> : 'Create Backup'}
              </PrimaryBtn>
          )}
        </div>
          {showBackupPanel && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <THead cols={[{ label: 'Backup ID / File' }, { label: 'Created' }, { label: 'Size' }, { label: 'Status' }, { label: '' }]} />
                <tbody>
                  {backupHistory.map((b, i) => (
                    <tr key={b.id || i} className="border-b border-white/[0.04]">
                      <td className="py-2.5 px-3 text-[11px] text-gray-400 font-mono truncate max-w-[240px]">{b.filename || b.fileName || b.id || '—'}</td>
                      <td className="py-2.5 px-3 text-[11px] text-gray-500 whitespace-nowrap">{fmtDate(b.createdAt)}</td>
                      <td className="py-2.5 px-3 text-[11px] text-gray-500">{b.sizeMb ? `${b.sizeMb} MB` : b.size ? `${(b.size / 1024 / 1024).toFixed(2)} MB` : '—'}</td>
                      <td className="py-2.5 px-3"><Badge variant={b.status === 'success' || b.success ? 'green' : 'default'}>{b.status || (b.success ? 'success' : 'created')}</Badge></td>
                      <td className="py-2.5 px-3 text-right">
                        <DangerBtn
                          onClick={() => setConfirmRestore(b)}
                          disabled={restoring}
                          className="text-[11px] py-1 px-2"
                        >
                          Restore Credits
                        </DangerBtn>
                      </td>
                    </tr>
                  ))}
                  {backupHistory.length === 0 && (
                    <tr><td colSpan={5} className="py-4 px-3 text-xs text-gray-600">No backups yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* ── Mass Email ────────────────────────────────────────────────────── */}
        <Section>
          <SectionHeader title="Mass Email" />
          <div className="mb-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-xs font-medium text-gray-300">Winback Email Template (12h No-Purchase Flow)</p>
              <div className="flex items-center gap-2">
                <GhostBtn onClick={loadWinbackEmailTemplate} disabled={loadingWinbackTemplate || savingWinbackTemplate}>
                  {loadingWinbackTemplate ? 'Refreshing…' : 'Refresh'}
                </GhostBtn>
                <PrimaryBtn onClick={saveWinbackEmailTemplate} disabled={loadingWinbackTemplate || savingWinbackTemplate}>
                  {savingWinbackTemplate ? 'Saving…' : 'Save template'}
                </PrimaryBtn>
              </div>
            </div>
            <p className="text-[11px] text-gray-500 mb-3">
              This is the actual email sent to users who register and do not buy membership in the first 12 hours.
            </p>
            <div className="grid lg:grid-cols-2 gap-3">
              <div className="space-y-2">
                <input
                  value={winbackEmailTemplate.subject}
                  onChange={(e) => setWinbackEmailTemplate((p) => ({ ...p, subject: e.target.value }))}
                  placeholder="Email subject"
                  className="w-full px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs outline-none focus:border-white/20 transition"
                />
                <input
                  value={winbackEmailTemplate.title}
                  onChange={(e) => setWinbackEmailTemplate((p) => ({ ...p, title: e.target.value }))}
                  placeholder="Email title"
                  className="w-full px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs outline-none focus:border-white/20 transition"
                />
                <textarea
                  value={winbackEmailTemplate.intro}
                  onChange={(e) => setWinbackEmailTemplate((p) => ({ ...p, intro: e.target.value }))}
                  placeholder="Intro paragraph"
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs outline-none focus:border-white/20 transition resize-none"
                />
                <div className="mt-2 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-gray-400">Visual content editor</p>
                    <GhostBtn onClick={applyWinbackVisualEditorToHtml} disabled={savingWinbackTemplate}>
                      Apply visual to HTML
                    </GhostBtn>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input value={winbackVisualEditor.codeLabel} onChange={(e) => setWinbackVisualEditor((v) => ({ ...v, codeLabel: e.target.value }))} placeholder="Code label" className="px-2 py-1.5 rounded border border-white/[0.07] bg-black/30 text-[11px]" />
                    <input value={winbackVisualEditor.discountLabel} onChange={(e) => setWinbackVisualEditor((v) => ({ ...v, discountLabel: e.target.value }))} placeholder="Discount label" className="px-2 py-1.5 rounded border border-white/[0.07] bg-black/30 text-[11px]" />
                    <input value={winbackVisualEditor.appliesLabel} onChange={(e) => setWinbackVisualEditor((v) => ({ ...v, appliesLabel: e.target.value }))} placeholder="Applies label" className="px-2 py-1.5 rounded border border-white/[0.07] bg-black/30 text-[11px]" />
                    <input value={winbackVisualEditor.appliesValue} onChange={(e) => setWinbackVisualEditor((v) => ({ ...v, appliesValue: e.target.value }))} placeholder="Applies value" className="px-2 py-1.5 rounded border border-white/[0.07] bg-black/30 text-[11px]" />
                    <input value={winbackVisualEditor.expiresLabel} onChange={(e) => setWinbackVisualEditor((v) => ({ ...v, expiresLabel: e.target.value }))} placeholder="Expires label" className="px-2 py-1.5 rounded border border-white/[0.07] bg-black/30 text-[11px]" />
                    <input value={winbackVisualEditor.ctaText} onChange={(e) => setWinbackVisualEditor((v) => ({ ...v, ctaText: e.target.value }))} placeholder="CTA text" className="px-2 py-1.5 rounded border border-white/[0.07] bg-black/30 text-[11px]" />
                  </div>
                  <textarea value={winbackVisualEditor.notePrimary} onChange={(e) => setWinbackVisualEditor((v) => ({ ...v, notePrimary: e.target.value }))} rows={2} placeholder="Primary note" className="w-full px-2 py-1.5 rounded border border-white/[0.07] bg-black/30 text-[11px] resize-none" />
                  <textarea value={winbackVisualEditor.noteSecondary} onChange={(e) => setWinbackVisualEditor((v) => ({ ...v, noteSecondary: e.target.value }))} rows={2} placeholder="Secondary note" className="w-full px-2 py-1.5 rounded border border-white/[0.07] bg-black/30 text-[11px] resize-none" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <p className="text-[11px] text-gray-400 mb-2">Visual preview</p>
                  <div className="rounded border border-white/[0.08] bg-[#f6f6f4] p-3 text-black text-xs" dangerouslySetInnerHTML={{ __html: winbackVisualPreviewHtml }} />
                </div>
                <textarea
                  value={winbackEmailTemplate.content}
                  onChange={(e) => setWinbackEmailTemplate((p) => ({ ...p, content: e.target.value }))}
                  placeholder="HTML content block"
                  rows={10}
                  className="w-full px-3 py-2 rounded-lg border border-white/[0.07] bg-black/40 text-[11px] text-gray-200 font-mono outline-none focus:border-white/20 transition resize-y"
                />
              </div>
            </div>
            <div className="mt-2 text-[10px] text-gray-500">
              Placeholders: <code>{'{{NAME}}'}</code>, <code>{'{{DISCOUNT_CODE}}'}</code>, <code>{'{{DISCOUNT_PERCENT}}'}</code>, <code>{'{{EXPIRES_AT}}'}</code>, <code>{'{{DASHBOARD_URL}}'}</code>, <code>{'{{BRAND_NAME}}'}</code>, <code>{'{{EMAIL}}'}</code>
            </div>
          </div>
          {emailSendResult && (
            <div className="mb-4 p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] text-xs">
              <p className="text-emerald-400 font-medium">
                Sent to {emailSendResult.sent} users
                {emailSendResult.failed > 0 && <span className="text-red-400 ml-2">· {emailSendResult.failed} failed</span>}
              </p>
              {emailSendResult.errors?.length > 0 && (
                <p className="text-gray-500 mt-1">{emailSendResult.errors.slice(0, 2).join('; ')}</p>
              )}
              <button onClick={() => setEmailSendResult(null)} className="mt-1 text-gray-600 hover:text-gray-400 transition">Dismiss</button>
              </div>
          )}
          <div className="mb-4 p-3 rounded-lg border border-white/[0.08] bg-white/[0.02]">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-300">Campaign Progress</p>
              <button
                onClick={loadCampaigns}
                disabled={campaignsLoading}
                className="px-2 py-1 rounded border border-white/[0.09] bg-white/[0.03] text-[11px] text-gray-300 hover:bg-white/[0.08] transition disabled:opacity-50"
              >
                {campaignsLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {campaigns.map((c) => {
                const total = Math.max(0, Number(c.totalUsers || 0));
                const sent = Math.max(0, Number(c.sent || 0));
                const failed = Math.max(0, Number(c.failed || 0));
                const done = Math.min(total || sent + failed, sent + failed);
                const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
                const status = c.status || 'running';
                return (
                  <div key={c.campaignId} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] text-gray-200 truncate">{c.subject || 'Campaign'}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        status === 'completed' ? 'bg-emerald-500/20 text-emerald-300' :
                        status === 'failed' ? 'bg-red-500/20 text-red-300' :
                        status === 'cancelled' ? 'bg-amber-500/20 text-amber-300' :
                        'bg-violet-500/20 text-violet-300'
                      }`}>{status}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded bg-white/[0.08] overflow-hidden">
                      <div className="h-full bg-violet-400/80" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
                      <span>{sent} sent · {failed} failed · {pct}%</span>
                      <span>{c.updatedAt ? new Date(c.updatedAt).toLocaleString() : ''}</span>
                    </div>
                    {status === 'running' && (
                      <div className="mt-1 flex justify-end">
                        <button
                          onClick={() => cancelCampaign(c.campaignId)}
                          className="px-2 py-1 rounded border border-red-500/30 bg-red-500/10 text-[10px] text-red-300 hover:bg-red-500/20 transition"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {!campaigns.length && <p className="text-[11px] text-gray-500">No campaigns yet.</p>}
            </div>
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="space-y-2.5">
              {[{ k: 'subject', ph: 'Email subject' }, { k: 'headline', ph: 'Headline' }].map(({ k, ph }) => (
                <input key={k} value={emailBuilder[k]} onChange={(e) => setEmailBuilder((p) => ({ ...p, [k]: e.target.value }))}
                  placeholder={ph} className="w-full px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs outline-none focus:border-white/20 transition" />
              ))}
              <textarea value={emailBuilder.bodyText} onChange={(e) => setEmailBuilder((p) => ({ ...p, bodyText: e.target.value }))}
                placeholder="Body text" rows={7}
                className="w-full px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs outline-none focus:border-white/20 transition resize-none" />
              <div className="grid grid-cols-2 gap-2.5">
                {[{ k: 'ctaText', ph: 'CTA text' }, { k: 'ctaUrl', ph: 'CTA URL' }].map(({ k, ph }) => (
                  <input key={k} value={emailBuilder[k]} onChange={(e) => setEmailBuilder((p) => ({ ...p, [k]: e.target.value }))}
                    placeholder={ph} className="px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs outline-none focus:border-white/20 transition" />
                ))}
              </div>
              <input value={emailBuilder.heroImageUrl} readOnly placeholder="Hero image URL (upload below)"
                className="w-full px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.02] text-xs text-gray-500" />
              <div className="flex items-center gap-2 flex-wrap">
                {[{ label: 'Upload Hero', asHero: true }, { label: 'Add Image', asHero: false }].map(({ label, asHero }) => (
                  <label key={label} className="px-3 py-1.5 rounded-lg border border-white/[0.07] bg-white/[0.04] hover:bg-white/[0.08] text-xs text-gray-300 cursor-pointer transition">
                    {label}
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUploadEmailImage(e.target.files?.[0], asHero)} />
                </label>
                ))}
                {!!emailBuilder.imageUrls?.length && (
                  <button onClick={() => setEmailBuilder((p) => ({ ...p, imageUrls: [] }))} className="px-3 py-1.5 rounded-lg border border-white/[0.07] bg-white/[0.04] text-xs text-gray-400 hover:text-white transition">
                    Clear Images
                  </button>
                )}
                <label className="px-3 py-1.5 rounded-lg border border-white/[0.07] bg-white/[0.04] hover:bg-white/[0.08] text-xs text-gray-300 cursor-pointer transition">
                  Upload Video
                  <input type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={(e) => handleUploadEmailVideo(e.target.files?.[0])} />
                </label>
                {emailBuilder.videoUrl && (
                  <button onClick={() => setEmailBuilder((p) => ({ ...p, videoUrl: '' }))} className="px-3 py-1.5 rounded-lg border border-white/[0.07] bg-white/[0.04] text-xs text-gray-400 hover:text-white transition">
                    Clear Video
                  </button>
                )}
              </div>
              {emailBuilder.videoUrl && (
                <div className="mt-2">
                  <p className="text-[11px] text-gray-500 mb-1">Video URL (R2):</p>
                  <input value={emailBuilder.videoUrl} readOnly className="w-full px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.02] text-xs text-gray-500" />
                </div>
              )}
              {!!emailBuilder.imageUrls?.length && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {emailBuilder.imageUrls.map((url, i) => (
                    <img key={`${url}-${i}`} src={url} alt="" className="w-full h-16 object-cover rounded-lg border border-white/[0.07]" />
                  ))}
                </div>
              )}

              {/* Audience filters (for Send All). Leave all empty = send to all (verified) users. */}
              <div className="mt-4 p-3 rounded-lg border border-white/[0.08] bg-white/[0.02] space-y-3">
                <p className="text-[11px] font-medium text-gray-400">Audience filters (Send All). Leave empty to include all.</p>
                <label className="flex items-center gap-2 text-xs text-gray-300">
                  <input type="checkbox" checked={emailAudience.verifiedOnly} onChange={(e) => setEmailAudience((a) => ({ ...a, verifiedOnly: e.target.checked }))} className="rounded" />
                  Verified users only
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <p className="text-[10px] text-gray-500 mb-0.5">Subscription status</p>
                    <div className="flex flex-wrap gap-1.5">
                      {['trial', 'active', 'cancelled', 'past_due'].map((s) => (
                        <label key={s} className="flex items-center gap-1 text-[10px]">
                          <input type="checkbox" checked={emailAudience.subscriptionStatuses.includes(s)} onChange={(e) => setEmailAudience((a) => ({ ...a, subscriptionStatuses: e.target.checked ? [...(a.subscriptionStatuses || []), s] : (a.subscriptionStatuses || []).filter((x) => x !== s) }))} className="rounded" />
                          {s}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-500 mb-0.5">Subscription tier</p>
                    <div className="flex flex-wrap gap-1.5">
                      {['starter', 'pro', 'business'].map((t) => (
                        <label key={t} className="flex items-center gap-1 text-[10px]">
                          <input type="checkbox" checked={emailAudience.subscriptionTiers.includes(t)} onChange={(e) => setEmailAudience((a) => ({ ...a, subscriptionTiers: e.target.checked ? [...(a.subscriptionTiers || []), t] : (a.subscriptionTiers || []).filter((x) => x !== t) }))} className="rounded" />
                          {t}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">Total spend range</label>
                    <select
                      value={emailAudience.spendRange}
                      onChange={(e) => setEmailAudience((a) => ({ ...a, spendRange: e.target.value }))}
                      className="px-2 py-1.5 rounded border border-white/[0.07] bg-white/[0.03] text-xs text-white min-w-[140px]"
                    >
                      {SPEND_RANGE_OPTIONS.map((o) => (
                        <option key={o.value || 'any'} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">Min referrals</label>
                    <input type="number" min={0} value={emailAudience.minReferrals} onChange={(e) => setEmailAudience((a) => ({ ...a, minReferrals: e.target.value }))} placeholder="—" className="w-20 px-2 py-1.5 rounded border border-white/[0.07] bg-white/[0.03] text-xs" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">Countries (multi-select)</label>
                    <select
                      multiple
                      value={emailAudience.regions}
                      onChange={(e) => {
                        const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                        setEmailAudience((a) => ({ ...a, regions: selected }));
                      }}
                      className="w-full min-h-[100px] px-2 py-1.5 rounded border border-white/[0.07] bg-white/[0.03] text-xs text-white"
                    >
                      {COUNTRY_LIST.map((c) => (
                        <option key={c.code} value={c.code}>{c.name}</option>
                      ))}
                    </select>
                    <p className="text-[9px] text-gray-500 mt-0.5">Hold Ctrl/Cmd to select multiple. Empty = all countries.</p>
                    {emailAudience.regions?.length > 0 && (
                      <button type="button" onClick={() => setEmailAudience((a) => ({ ...a, regions: [] }))} className="mt-1 text-[10px] text-gray-400 hover:text-white">Clear ({emailAudience.regions.length} selected)</button>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">Languages (multi-select)</label>
                    <select
                      multiple
                      value={emailAudience.languages}
                      onChange={(e) => {
                        const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                        setEmailAudience((a) => ({ ...a, languages: selected }));
                      }}
                      className="w-full min-h-[100px] px-2 py-1.5 rounded border border-white/[0.07] bg-white/[0.03] text-xs text-white"
                    >
                      {MARKETING_LANGUAGE_OPTIONS.map((l) => (
                        <option key={l.code} value={l.code}>{l.name}</option>
                      ))}
                    </select>
                    <p className="text-[9px] text-gray-500 mt-0.5">Empty = all languages.</p>
                    {emailAudience.languages?.length > 0 && (
                      <button type="button" onClick={() => setEmailAudience((a) => ({ ...a, languages: [] }))} className="mt-1 text-[10px] text-gray-400 hover:text-white">Clear ({emailAudience.languages.length} selected)</button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <input value={emailBuilder.testEmail} onChange={(e) => setEmailBuilder((p) => ({ ...p, testEmail: e.target.value }))}
                  placeholder="Test email address"
                  className="flex-1 px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs outline-none focus:border-white/20 transition" />
                <GhostBtn onClick={() => handleSendEmail(true)} disabled={sendingEmail || !emailBuilder.testEmail}>
                  <Send className="w-3 h-3" /> Test
                </GhostBtn>
                <PrimaryBtn onClick={() => handleSendEmail(false)} disabled={sendingEmail}>
                  <Send className="w-3 h-3" /> {sendingEmail ? (activeCampaignId ? 'Sending…' : 'Starting…') : 'Send All'}
                </PrimaryBtn>
              </div>
            </div>

            {/* Live email preview iframe */}
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] text-gray-500">Email Preview</p>
                <span className="text-[11px] text-gray-600 px-1.5 py-0.5 rounded border border-white/[0.05]">
                  Subject: {emailBuilder.subject || '—'}
                </span>
              </div>
              <div className="rounded-lg overflow-hidden border border-white/[0.06] flex-1 min-h-[520px]">
                <iframe
                  title="email-preview"
                  className="w-full h-full min-h-[520px] block"
                  sandbox="allow-same-origin"
                  srcDoc={(() => {
                    const esc = (v) => String(v || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
                    const hero = emailBuilder.heroImageUrl?.trim() || '';
                    const imgs = (emailBuilder.imageUrls || []).filter(Boolean);
                    const bName = brandSettings.appName || 'ModelClone';
                    const bUrl  = (brandSettings.baseUrl || 'https://modelclone.app').replace(/\/$/, '');
                    const bLogo = brandSettings.logoUrl || '/logo-512.png';
                    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#f5f5f3;font-family:'DM Sans',-apple-system,sans-serif;color:#1a1a1a;padding:32px 16px 48px;-webkit-font-smoothing:antialiased}
.wrapper{max-width:480px;margin:0 auto}.brand-bar{margin-bottom:22px;text-align:center}
.brand-mark{width:38px;height:38px;border-radius:9px;overflow:hidden;background:#1a1a1a;display:block;margin:0 auto 7px}
.brand-mark img{width:100%;height:100%;object-fit:cover;display:block}
.brand-name{font-size:14px;font-weight:600;color:#1a1a1a;letter-spacing:-.2px;display:block}
.card{background:#fff;border-radius:4px;border:1px solid #e2e2de;overflow:hidden}
.card-accent{height:3px;background:#1a1a1a}.card-body{padding:36px}
.section-label{font-size:11px;font-weight:500;letter-spacing:1.4px;text-transform:uppercase;color:#9b9b93;margin-bottom:16px}
h1{font-size:22px;font-weight:600;color:#111;letter-spacing:-.5px;line-height:1.3;margin-bottom:14px}
.body-text{font-size:14px;font-weight:300;color:#555550;line-height:1.7;margin-bottom:20px;white-space:pre-line}
.divider{height:1px;background:#e8e8e4;margin:0 0 20px}
.hero{width:100%;border-radius:4px;margin-bottom:18px;border:1px solid #e2e2de;display:block}
.gallery{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 20px}
.gallery img{width:100%;border:1px solid #e2e2de;border-radius:4px;display:block}
.cta-wrap{margin:14px 0 22px}.cta-btn{display:inline-block;text-decoration:none;background:#111;color:#fff;font-size:13px;font-weight:600;padding:9px 14px;border-radius:4px}
.video-wrap{margin:0 0 20px}.video-wrap video{width:100%;max-height:280px;border:1px solid #e2e2de;border-radius:4px;display:block}.video-link{display:inline-block;margin-top:6px;font-size:13px;font-weight:600;color:#111;text-decoration:underline}
.note{font-size:12px;color:#9b9b93;line-height:1.65;font-weight:300}.note+.note{margin-top:10px}
.card-footer{padding:16px 36px;background:#fafaf8;border-top:1px solid #e8e8e4;text-align:center}
.footer-brand{font-size:12px;font-weight:500;color:#1a1a1a}.footer-legal{font-size:11px;color:#b5b5ae}
.meta{margin-top:18px;display:flex;flex-direction:column;align-items:center;gap:3px;text-align:center}
.meta-text{font-size:11px;color:#b5b5ae}
</style></head><body><div class="wrapper">
<div class="brand-bar"><div class="brand-mark"><img src="${esc(bLogo)}" alt="${esc(bName)}" /></div><span class="brand-name">${esc(bName)}</span></div>
<div class="card"><div class="card-accent"></div><div class="card-body">
<div class="section-label">Platform Update</div>
<h1>${esc(emailBuilder.headline) || 'Your headline here'}</h1>
${hero ? `<img class="hero" src="${esc(hero)}" alt="Hero" />` : ''}
${imgs.length ? `<div class="gallery">${imgs.map((u) => `<img src="${esc(u)}" alt="" />`).join('')}</div>` : ''}
${emailBuilder.videoUrl ? `<div class="video-wrap"><video src="${esc(emailBuilder.videoUrl)}" controls preload="metadata"></video><br /><a class="video-link" href="${esc(emailBuilder.videoUrl)}" target="_blank" rel="noopener">Watch video</a></div>` : ''}
<p class="body-text">${esc(emailBuilder.bodyText) || 'Your message body...'}</p>
${emailBuilder.ctaText && emailBuilder.ctaUrl ? `<div class="cta-wrap"><a class="cta-btn" href="${esc(emailBuilder.ctaUrl)}">${esc(emailBuilder.ctaText)}</a></div>` : ''}
<div class="divider"></div>
<p class="note">Do not share sensitive account details through email links unless you trust the source.</p>
<p class="note">If this message was not expected, you can safely ignore it.</p>
</div><div class="card-footer">
<span class="footer-brand">${esc(bName)}</span><br /><span class="footer-legal">© ${new Date().getFullYear()} ${esc(bName)}. All rights reserved.</span>
</div></div>
<div class="meta"><span class="meta-text">This is an automated message. Please do not reply.</span><span class="meta-text">${esc(bUrl.replace(/^https?:\/\//, ''))}</span><a style="font-size:11px;color:#b5b5ae;text-decoration:underline;" href="#">Unsubscribe</a></div>
</div></body></html>`;
                  })()}
                />
              </div>
            </div>
          </div>

          {/* ── Unsubscribes list ────────────────────────────────────────────── */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-white flex items-center gap-2">
                <UserX className="w-4 h-4 text-rose-400" />
                Unsubscribe List
                {unsubData && (
                  <span className="px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 text-[11px] font-semibold">
                    {unsubData.total}
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={loadUnsubs}
                  disabled={unsubLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs text-gray-300 hover:bg-white/[0.06] transition disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${unsubLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
                {unsubData?.unsubscribes?.length > 0 && (
                <button
                    onClick={() => {
                      const csv = ['email,unsubscribed_at', ...unsubData.unsubscribes.map(r => `${r.email},${r.createdAt}`)].join('\n');
                      const blob = new Blob([csv], { type: 'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a'); a.href = url; a.download = 'unsubscribes.csv'; a.click();
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs text-gray-300 hover:bg-white/[0.06] transition"
                  >
                    <Download className="w-3 h-3" />
                    CSV
                </button>
                )}
              </div>
            </div>

            <div className="mb-2">
              <input
                value={unsubSearch}
                onChange={(e) => setUnsubSearch(e.target.value)}
                placeholder="Search unsubscribes..."
                className="w-full px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs outline-none focus:border-white/20 transition"
              />
            </div>

            {unsubLoading ? (
              <div className="text-center py-8 text-xs text-gray-500">Loading...</div>
            ) : !unsubData ? (
              <div className="text-center py-8 text-xs text-gray-500">Click Refresh to load unsubscribes.</div>
            ) : unsubData.total === 0 ? (
              <div className="text-center py-8 text-xs text-gray-500">No unsubscribes yet.</div>
            ) : (
              <div className="rounded-xl border border-white/[0.07] overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                      <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Email</th>
                      <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Unsubscribed</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {(unsubData.unsubscribes || [])
                      .filter(r => !unsubSearch || r.email.toLowerCase().includes(unsubSearch.toLowerCase()))
                      .map((r) => (
                        <tr key={r.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition">
                          <td className="px-3 py-2.5 text-gray-300 font-mono">{r.email}</td>
                          <td className="px-3 py-2.5 text-gray-500">{new Date(r.createdAt).toLocaleDateString()}</td>
                          <td className="px-3 py-2.5 text-right">
                            <button
                              onClick={() => handleResubscribe(r.email)}
                              className="px-2 py-1 rounded text-[10px] border border-white/[0.07] text-gray-400 hover:text-white hover:border-white/20 transition"
                              title="Remove from unsubscribe list (re-subscribe)"
                            >
                              Re-subscribe
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                  </div>
                )}
              </div>
        </Section>

            </div>

      {/* ── Referral Bonus Modal ─────────────────────────────────────────────── */}
      {bonusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/[0.10] bg-[#0d0d14] p-6 shadow-2xl">
            <h3 className="text-sm font-semibold text-white mb-1">Add Referral Bonus</h3>
            <p className="text-[11px] text-gray-500 mb-4">This amount will be added to <span className="text-gray-300">{bonusModal.email}</span>'s eligible payout balance immediately.</p>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-gray-400 mb-1 block">Amount (USD)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    value={bonusAmount}
                    onChange={e => setBonusAmount(e.target.value)}
                    className="w-full pl-6 pr-3 py-2.5 rounded-lg border border-white/[0.10] bg-white/[0.04] text-white text-sm outline-none focus:border-emerald-500/50 transition"
                    autoFocus
                  />
          </div>
        </div>
              <div>
                <label className="text-[11px] text-gray-400 mb-1 block">Note (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Performance bonus, manual correction..."
                  value={bonusNote}
                  onChange={e => setBonusNote(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-white/[0.10] bg-white/[0.04] text-white text-sm outline-none focus:border-white/20 transition"
                />
        </div>
      </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => { setBonusModal(null); setBonusAmount(''); setBonusNote(''); }}
                disabled={bonusLoading}
                className="flex-1 py-2.5 rounded-xl border border-white/[0.08] text-xs text-gray-400 hover:text-white hover:bg-white/[0.05] transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAddBonus}
                disabled={bonusLoading || !bonusAmount}
                className="flex-1 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              >
                {bonusLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                {bonusLoading ? 'Adding...' : `Add $${parseFloat(bonusAmount || 0).toFixed(2)} Bonus`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      <ConfirmModal
        open={!!confirmDelete}
        title="Delete User"
        message={`Permanently delete ${confirmDelete?.email}? All their data, generations, and models will be removed. This cannot be undone.`}
        danger
        onConfirm={() => handleDeleteUser(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />

      <ConfirmModal
        open={confirmSendAll}
        title="Send to All Users"
        message={`This will send "${emailBuilder.subject}" to every verified user. Are you sure?`}
        onConfirm={() => _doSendEmail(false)}
        onCancel={() => setConfirmSendAll(false)}
      />

      <ConfirmModal
        open={!!confirmRestore}
        title="Restore Credits from Backup"
        message={`This will overwrite every user's current credit balance with the values from backup "${confirmRestore?.filename || confirmRestore?.fileName || confirmRestore?.id || ''}". All other data stays untouched. Continue?`}
        danger
        onConfirm={() => handleRestoreCredits(confirmRestore)}
        onCancel={() => setConfirmRestore(null)}
      />

      <ConfirmModal
        open={!!confirmReferralPayout}
        title="Mark Referral Payout Paid"
        message={`Mark payout as paid for ${confirmReferralPayout?.email}? This records a paid amount in the referral ledger and reduces their eligible balance by the paid amount.`}
        onConfirm={() => handleMarkReferrerPaid(confirmReferralPayout?.userId)}
        onCancel={() => setConfirmReferralPayout(null)}
      />

      <ConfirmModal
        open={confirmClearReels}
        title="Clear all cached reels?"
        message={`This deletes every Reel Finder reel row (${reelProfiles.reduce((s, p) => s + (p._count?.reels || 0), 0)} total). Instagram profiles you track stay in the list.${clearReelsRescrape ? ' A full scrape will be started afterward when possible (scraper token set and no job already running).' : ' No automatic rescrape — use Force Scrape when ready.'}`}
        danger
        onConfirm={handleClearReelsConfirm}
        onCancel={() => setConfirmClearReels(false)}
      />

      <ConfirmModal
        open={confirmResetGenPricing}
        title="Reset generation pricing?"
        message="All credit costs will revert to the built-in defaults from the server. This affects new charges immediately after save."
        danger
        onConfirm={resetGenerationPricingAdmin}
        onCancel={() => setConfirmResetGenPricing(false)}
      />

      {showApiKeysModal && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-[#111] p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold">Public API keys</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Keys authenticate as <span className="text-gray-300">{selectedUser.email}</span> on the ModelClone API (same credits and limits as the web app).
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowApiKeysModal(false);
                  setSelectedUser(null);
                  setApiKeysList([]);
                  setNewApiKeyPlain(null);
                }}
                className="p-1.5 rounded-lg hover:bg-white/10 transition"
              >
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            {newApiKeyPlain && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.08] p-3 mb-4">
                <p className="text-[11px] text-amber-200 mb-2 font-medium">
                  Copy the full key below — it will not be shown again. The entire string is {newApiKeyPlain.length} characters.
                </p>
                <textarea
                  ref={newApiKeyTextareaRef}
                  readOnly
                  rows={5}
                  spellCheck={false}
                  value={newApiKeyPlain}
                  onFocus={(e) => selectElementContents(e.target)}
                  onClick={(e) => selectElementContents(e.target)}
                  className="w-full mb-2 px-2 py-2 rounded-md bg-black/50 border border-amber-500/20 text-[11px] text-amber-100 font-mono break-all whitespace-pre-wrap resize-y min-h-[6rem] max-h-48 overflow-y-auto"
                  aria-label="New API key — full secret"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await copyTextToClipboard(newApiKeyPlain);
                      if (ok) toast.success('Full key copied');
                      else toast.error('Auto-copy failed — tap “Select all”, then Copy from the keyboard menu');
                    }}
                    className="shrink-0 px-2 py-1 rounded-md bg-white/10 text-[10px] text-white hover:bg-white/15"
                  >
                    Copy full key
                  </button>
                  <button
                    type="button"
                    onClick={() => selectElementContents(newApiKeyTextareaRef.current)}
                    className="shrink-0 px-2 py-1 rounded-md bg-white/5 text-[10px] text-amber-200 hover:bg-white/10"
                  >
                    Select all
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-3 mb-4">
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wide">Label (optional)</label>
                <input
                  value={apiKeyNameDraft}
                  onChange={(e) => setApiKeyNameDraft(e.target.value)}
                  placeholder="e.g. Partner integration"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-white/[0.08] bg-black/40 text-xs text-white placeholder:text-gray-600"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wide">CORS origins (optional JSON array)</label>
                <textarea
                  value={apiKeyCorsDraft}
                  onChange={(e) => setApiKeyCorsDraft(e.target.value)}
                  placeholder='["https://partner-app.com"]'
                  rows={2}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-white/[0.08] bg-black/40 text-xs text-white placeholder:text-gray-600 font-mono"
                />
                <p className="text-[10px] text-gray-600 mt-1">Leave empty for server-to-server only.</p>
              </div>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={apiKeyPlanOverride}
                  onChange={(e) => setApiKeyPlanOverride(e.target.checked)}
                  className="mt-0.5 rounded border-white/20"
                />
                <span className="text-[11px] text-gray-400 leading-snug">
                  <span className="text-gray-300 font-medium">Plan override</span>
                  {' — '}
                  Allow creating a key without an active Business plan (e.g. beta partners on other tiers).
                </span>
              </label>
              <button
                type="button"
                disabled={apiKeyWorkingId === 'create'}
                onClick={handleCreateUserApiKey}
                className="w-full py-2 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-xs font-medium text-white disabled:opacity-50"
              >
                {apiKeyWorkingId === 'create' ? 'Creating…' : 'Create new key'}
              </button>
            </div>

            <div className="border-t border-white/[0.06] pt-4">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-2">Active keys</p>
              {apiKeysLoading ? (
                <p className="text-xs text-gray-500">Loading…</p>
              ) : apiKeysList.length === 0 ? (
                <p className="text-xs text-gray-500">No keys yet.</p>
              ) : (
                <ul className="space-y-2">
                  {apiKeysList.map((k) => (
                    <li
                      key={k.id}
                      className="flex items-start justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs text-gray-300">{k.name || 'Unnamed'}</div>
                        <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                          {k.keyPrefix}…
                          {k.revokedAt && (
                            <span className="ml-2 text-red-400">revoked</span>
                          )}
                        </div>
                        {k.lastUsedAt && (
                          <div className="text-[10px] text-gray-600 mt-0.5">
                            Last used {fmtDate(k.lastUsedAt)}
                          </div>
                        )}
                      </div>
                      {!k.revokedAt && (
                        <button
                          type="button"
                          disabled={apiKeyWorkingId === k.id}
                          onClick={() => handleRevokeUserApiKey(k.id)}
                          className="shrink-0 text-[10px] text-red-400 hover:text-red-300"
                        >
                          {apiKeyWorkingId === k.id ? '…' : 'Revoke'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {!!activePromptTemplateKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-4xl rounded-2xl border border-white/[0.08] bg-[#111] p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-white">AI prompt template editor</h3>
                <p className="text-[11px] text-gray-500 mt-1">
                  Use-case: <span className="text-gray-300">{formatPromptTemplateLabel(activePromptTemplateKey)}</span>
                  <span className="ml-2 text-gray-600 font-mono">{activePromptTemplateKey}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={closePromptTemplateModal}
                className="p-1.5 rounded-lg hover:bg-white/10 transition"
                disabled={savingPromptTemplates}
              >
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>
            <div className="space-y-3">
              <p className="text-[11px] text-gray-500">
                Actual configured prompt for this use-case. If empty, backend falls back to code default prompt.
              </p>
              <textarea
                value={activePromptTemplateDraft}
                onChange={(e) => setActivePromptTemplateDraft(e.target.value)}
                className="w-full min-h-[320px] rounded-lg border border-white/[0.07] bg-white/[0.03] text-xs text-white p-3 font-mono outline-none focus:border-white/20"
                spellCheck={false}
                autoFocus
              />
              <div className="flex items-center gap-2 justify-end">
                <GhostBtn onClick={closePromptTemplateModal} disabled={savingPromptTemplates}>
                  Cancel
                </GhostBtn>
                <PrimaryBtn onClick={saveActivePromptTemplate} disabled={savingPromptTemplates}>
                  {savingPromptTemplates ? 'Saving…' : 'Save prompt'}
                </PrimaryBtn>
              </div>
            </div>
          </div>
        </div>
      )}

      <AddCreditsAdminModal
        isOpen={showAddCredits}
        onClose={() => { setShowAddCredits(false); setSelectedUser(null); }}
        user={selectedUser}
        onSuccess={() => loadUsers(search, usersPage)}
      />
      <EditUserSettingsModal
        isOpen={showEditSettings}
        onClose={() => { setShowEditSettings(false); setSelectedUser(null); }}
        user={selectedUser}
        onSuccess={() => loadUsers(search, usersPage)}
      />
      <NsfwOverrideModal
        isOpen={showNsfwOverride}
        onClose={() => { setShowNsfwOverride(false); setSelectedUser(null); }}
        user={selectedUser}
        onSuccess={() => loadUsers(search, usersPage)}
      />
      <ManageUserPurchasesModal
        open={showManagePurchases}
        user={selectedUser}
        purchases={userPurchases}
        loading={loadingPurchases}
        refundingId={refundingPurchaseId}
        onClose={() => {
          setShowManagePurchases(false);
          setUserPurchases([]);
          setRefundingPurchaseId(null);
        }}
        onRefund={handleRefundPurchase}
      />

      {showImpersonateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-2xl rounded-2xl border border-white/[0.08] bg-[#111] p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold">User Session Payload Login</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Generate and use temporary inspection link for {selectedUser?.email || 'selected user'}.
                </p>
              </div>
              <button
                onClick={() => {
                  setShowImpersonateModal(false);
                  setImpersonatePayload(null);
                  setImpersonateLoading(false);
                }}
                className="p-1.5 rounded-lg hover:bg-white/10 transition"
              >
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            {impersonateLoading && (
              <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-4 text-xs text-gray-400">
                Generating login payload...
              </div>
            )}

            {!impersonateLoading && impersonatePayload && (
              <div className="space-y-3">
                <div className="rounded-lg border border-blue-500/20 bg-blue-500/[0.06] p-3">
                  <p className="text-xs text-blue-200">
                    Security: this grants user-account access for troubleshooting. Use only for active support cases.
                  </p>
                </div>

                <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <p className="text-[11px] text-gray-500 mb-1">Expires</p>
                  <p className="text-xs text-gray-300">{impersonatePayload.expiresAt ? new Date(impersonatePayload.expiresAt).toLocaleString() : 'Unknown'}</p>
                </div>

                <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <p className="text-[11px] text-gray-500 mb-1">Login URL</p>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={impersonatePayload.loginUrl}
                      className="flex-1 px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-[11px] text-gray-300 font-mono"
                    />
                    <GhostBtn onClick={() => navigator.clipboard.writeText(impersonatePayload.loginUrl).then(() => toast.success('Login URL copied'))}>
                      <Copy className="w-3 h-3" /> Copy
                    </GhostBtn>
                    <PrimaryBtn onClick={() => window.open(impersonatePayload.loginUrl, '_blank', 'noopener,noreferrer')}>
                      Open
                    </PrimaryBtn>
                  </div>
                </div>

                <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <p className="text-[11px] text-gray-500 mb-1">JWT Payload Token</p>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={impersonatePayload.token}
                      className="flex-1 px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-[11px] text-gray-300 font-mono"
                    />
                    <GhostBtn onClick={() => navigator.clipboard.writeText(impersonatePayload.token).then(() => toast.success('Payload token copied'))}>
                      <Copy className="w-3 h-3" /> Copy
                    </GhostBtn>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

        {/* ── Discount Codes ─────────────────────────────────────────────── */}
        <Section>
          <SectionHeader
            title="Discount Codes"
            actions={
              <>
                <GhostBtn onClick={() => { setShowDiscountCodes(!showDiscountCodes); if (!showDiscountCodes && discountCodes.length === 0) loadDiscountCodes(); }}>
                  {showDiscountCodes ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {showDiscountCodes ? 'Hide' : 'Show'}
                </GhostBtn>
                {showDiscountCodes && (
                  <GhostBtn onClick={loadDiscountCodes} disabled={discountCodesLoading}>
                    <RefreshCw className={`w-3 h-3 ${discountCodesLoading ? 'animate-spin' : ''}`} /> Refresh
                  </GhostBtn>
                )}
              </>
            }
          />

          {showDiscountCodes && (
            <div className="space-y-4">
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">Create New Code</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <input
                    placeholder="Code (e.g. SAVE20)"
                    value={discountForm.code}
                    onChange={(e) => setDiscountForm({ ...discountForm, code: e.target.value.toUpperCase() })}
                    className="col-span-2 sm:col-span-1 px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-sm text-white placeholder-gray-500 uppercase"
                    data-testid="input-admin-discount-code"
                  />
                  <select
                    value={discountForm.discountType}
                    onChange={(e) => setDiscountForm({ ...discountForm, discountType: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-sm text-white"
                    data-testid="select-discount-type"
                  >
                    <option value="percentage">Percentage (%)</option>
                    <option value="fixed">Fixed ($)</option>
                  </select>
                  <input
                    type="number"
                    placeholder={discountForm.discountType === 'percentage' ? 'Value (e.g. 20)' : 'Amount (e.g. 10)'}
                    value={discountForm.discountValue}
                    onChange={(e) => setDiscountForm({ ...discountForm, discountValue: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-sm text-white placeholder-gray-500"
                    data-testid="input-discount-value"
                  />
                  <select
                    value={discountForm.appliesTo}
                    onChange={(e) => setDiscountForm({ ...discountForm, appliesTo: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-sm text-white"
                    data-testid="select-discount-applies"
                  >
                    <option value="both">Both</option>
                    <option value="subscription">Subscription Only</option>
                    <option value="credits">Credits Only</option>
                  </select>
                  <input
                    type="date"
                    placeholder="Expires"
                    value={discountForm.validUntil}
                    onChange={(e) => setDiscountForm({ ...discountForm, validUntil: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-sm text-white placeholder-gray-500 [color-scheme:dark]"
                    data-testid="input-discount-expiry"
                  />
                  <input
                    type="number"
                    placeholder="Max uses (blank = unlimited)"
                    value={discountForm.maxUses}
                    onChange={(e) => setDiscountForm({ ...discountForm, maxUses: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-sm text-white placeholder-gray-500"
                    data-testid="input-discount-max-uses"
                  />
                  <input
                    type="number"
                    placeholder="Min purchase $ (blank = none)"
                    value={discountForm.minPurchaseAmount}
                    onChange={(e) => setDiscountForm({ ...discountForm, minPurchaseAmount: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.03] text-sm text-white placeholder-gray-500"
                    data-testid="input-discount-min-purchase"
                  />
                </div>
                <PrimaryBtn onClick={createDiscountCode} disabled={discountFormLoading} data-testid="button-create-discount">
                  {discountFormLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  Create Code
                </PrimaryBtn>
              </div>

              {discountCodesLoading ? (
                <div className="flex items-center justify-center py-6 gap-2 text-gray-500 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                </div>
              ) : discountCodes.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">No discount codes yet</p>
              ) : (
                <div className="space-y-2">
                  {discountCodes.map((dc) => {
                    const isExpired = new Date(dc.validUntil) < new Date();
                    const isMaxed = dc.maxUses && dc.currentUses >= dc.maxUses;
                    const statusColor = !dc.isActive ? 'text-gray-500' : isExpired ? 'text-red-400' : isMaxed ? 'text-amber-400' : 'text-emerald-400';
                    const statusText = !dc.isActive ? 'Inactive' : isExpired ? 'Expired' : isMaxed ? 'Max Uses' : 'Active';

                    return (
                      <div key={dc.id} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 flex items-center justify-between gap-3 flex-wrap" data-testid={`discount-row-${dc.id}`}>
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="font-mono text-sm font-semibold text-white bg-white/5 px-2 py-1 rounded" data-testid={`text-discount-code-${dc.id}`}>{dc.code}</span>
                          <span className="text-xs text-gray-400">
                            {dc.discountType === 'percentage' ? `${dc.discountValue}%` : `$${dc.discountValue}`} off
                          </span>
                          <span className="text-xs text-gray-500">{dc.appliesTo}</span>
                          <span className="text-xs text-gray-500">
                            {dc.currentUses}{dc.maxUses ? `/${dc.maxUses}` : ''} uses
                          </span>
                          <span className="text-xs text-gray-500">exp {fmtDate(dc.validUntil)}</span>
                          <span className={`text-xs font-medium ${statusColor}`}>{statusText}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {dc.isActive && (
                            <DangerBtn onClick={() => deactivateDiscountCode(dc.id)} data-testid={`button-deactivate-${dc.id}`}>
                              <X className="w-3 h-3" /> Deactivate
                            </DangerBtn>
                          )}
                          {!dc.isActive && (
                            <GhostBtn onClick={() => updateDiscountCode(dc.id, { isActive: true })} data-testid={`button-reactivate-${dc.id}`}>
                              <Check className="w-3 h-3" /> Reactivate
                            </GhostBtn>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </Section>
    </div>
  );
}
