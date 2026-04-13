import sgMail from '@sendgrid/mail';
import { BRAND } from "../utils/brand.js";
import { getAppBranding } from "./branding.service.js";
import { getWinbackEmailTemplate } from "./winback-email-template.service.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function renderBaseEmailShell({
  subject,
  sectionLabel,
  title,
  introHtml = "",
  contentHtml = "",
  footerNote = "This is an automated message. Please do not reply.",
  preheader = "",
}) {
  const branding = await getAppBranding();
  const brandName = branding.appName || BRAND.name;
  const baseUrl = (branding.baseUrl || BRAND.defaultBaseUrl).replace(/\/$/, "");
  const logoUrl = branding.logoUrl || `${baseUrl}${BRAND.logoPath}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(brandName)} - ${escapeHtml(subject)}</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background-color: #f5f5f3; font-family: 'DM Sans', sans-serif; color: #1a1a1a; padding: 48px 16px 64px; -webkit-font-smoothing: antialiased; }
    .wrapper { max-width: 560px; margin: 0 auto; }
    .brand-bar { margin-bottom: 28px; padding: 0 4px; text-align: center; }
    .brand-mark { width: 42px; height: 42px; border-radius: 10px; overflow: hidden; background: #1a1a1a; display: block; margin: 0 auto 8px; }
    .brand-mark img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .brand-name { font-size: 15px; font-weight: 600; color: #1a1a1a; letter-spacing: -0.2px; display: block; text-align: center; }
    .card { background: #ffffff; border-radius: 4px; border: 1px solid #e2e2de; overflow: hidden; }
    .card-accent { height: 3px; background: #1a1a1a; }
    .card-body { padding: 48px 48px 44px; }
    .section-label { font-size: 11px; font-weight: 500; letter-spacing: 1.4px; text-transform: uppercase; color: #9b9b93; margin-bottom: 20px; }
    h1 { font-size: 24px; font-weight: 600; color: #111; letter-spacing: -0.5px; line-height: 1.3; margin-bottom: 16px; }
    .greeting-text { font-size: 15px; font-weight: 300; color: #555550; line-height: 1.7; margin-bottom: 28px; }
    .divider { height: 1px; background: #e8e8e4; margin: 0 0 24px; }
    .note { font-size: 13px; color: #9b9b93; line-height: 1.65; font-weight: 300; }
    .note + .note { margin-top: 12px; }
    .card-footer { padding: 20px 48px; background: #fafaf8; border-top: 1px solid #e8e8e4; text-align: center; }
    .footer-brand { font-size: 12px; font-weight: 500; color: #1a1a1a; }
    .footer-legal { font-size: 11px; color: #b5b5ae; }
    .meta { margin-top: 24px; padding: 0 4px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; text-align: center; }
    .meta-text { font-size: 11px; color: #b5b5ae; }
    .cta-btn { display: inline-block; text-decoration: none; background: #111; color: #fff !important; font-size: 13px; font-weight: 600; padding: 10px 14px; border-radius: 4px; }
    .code-block { background: #f7f7f5; border: 1px solid #e2e2de; border-radius: 4px; padding: 14px 18px 18px; }
    .code-digits { font-family: 'DM Mono', monospace; font-size: 36px; font-weight: 500; color: #111; letter-spacing: 8px; }
    .code-validity { display: flex; align-items: center; justify-content: flex-start; gap: 6px; font-size: 12px; color: #9b9b93; white-space: nowrap; margin-bottom: 10px; }
    .dot { display: none; }
    @media (max-width: 480px) {
      .card-body { padding: 36px 28px 32px; }
      .card-footer { padding: 18px 28px; }
      .code-digits { font-size: 28px; }
      .code-validity { margin-bottom: 8px; }
    }
  </style>
</head>
<body>
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;visibility:hidden;mso-hide:all;">
    ${escapeHtml(preheader)}
  </div>
  <div class="wrapper">
    <div class="brand-bar">
      <div class="brand-mark"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(brandName)}" /></div>
      <span class="brand-name">${escapeHtml(brandName)}</span>
    </div>
    <div class="card">
      <div class="card-accent"></div>
      <div class="card-body">
        <div class="section-label">${escapeHtml(sectionLabel)}</div>
        <h1>${title}</h1>
        ${introHtml}
        <div class="divider"></div>
        ${contentHtml}
      </div>
      <div class="card-footer">
        <span class="footer-brand">${escapeHtml(brandName)}</span><br />
        <span class="footer-legal">© ${new Date().getFullYear()} ${escapeHtml(brandName)}. All rights reserved.</span>
      </div>
    </div>
    <div class="meta">
      <span class="meta-text">${escapeHtml(footerNote)}</span>
      <span class="meta-text">${escapeHtml(baseUrl.replace(/^https?:\/\//, ""))}</span>
    </div>
  </div>
</body>
</html>`;
}

// Initialize SendGrid with API key
const apiKey = process.env.SENDGRID_API_KEY;
if (!apiKey) {
  console.error('❌ SENDGRID_API_KEY is not set! Emails will fail.');
} else {
  console.log('✅ SendGrid API key configured (length:', apiKey.length, ')');
  sgMail.setApiKey(apiKey);
}

export async function sendVerificationEmail(email, code, name, isPasswordReset = false) {
  try {
    const branding = await getAppBranding();
    const brandName = branding.appName || BRAND.name;
    const subject = isPasswordReset ? `Reset your ${brandName} password` : `Verify your ${brandName} account`;
    const heading = isPasswordReset ? 'Password Reset' : `Welcome${name ? `, ${name}` : ''}!`;
    const message = isPasswordReset 
      ? 'You requested to reset your password. Use the code below to create a new password:'
      : 'Thanks for signing up for ModelClone. To complete your registration, please verify your email address using the code below:';
    const expiry = isPasswordReset ? '15 minutes' : '10 minutes';
    const disclaimer = isPasswordReset
      ? "If you didn't request a password reset, you can safely ignore this email."
      : "If you didn't create an account with ModelClone, you can safely ignore this email.";

    const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'noreply@modelclone.app';
    console.log(`📧 Attempting to send email to: ${email} from: ${fromEmail}`);

    const preheader = isPasswordReset
      ? `Your ${brandName} password reset code: ${code}`
      : `Your ${brandName} verification code: ${code}`;
    
    const msg = {
      to: email,
      from: {
        email: fromEmail,
        name: brandName,
      },
      subject,
      html: await renderBaseEmailShell({
        subject,
        sectionLabel: isPasswordReset ? "Password Reset" : "Email Verification",
        title: escapeHtml(heading),
        introHtml: `<p class="greeting-text">${escapeHtml(message)}</p>`,
        contentHtml: `
          <div style="margin-bottom: 36px;">
            <div style="font-size: 11px; font-weight: 500; letter-spacing: 1px; text-transform: uppercase; color: #9b9b93; margin-bottom: 12px;">One-time code</div>
            <div class="code-block">
              <div class="code-validity"><span class="dot"></span>Expires in ${escapeHtml(expiry)}</div>
              <div class="code-digits" style="text-align:center;">${escapeHtml(code)}</div>
            </div>
          </div>
          <p class="note">Do not share this code with anyone. ${escapeHtml(brandName)} will never ask for it via phone or email.</p>
          <p class="note">${escapeHtml(disclaimer)}</p>
        `,
        preheader,
      }),
    };

    await sgMail.send(msg);

    console.log(`✅ ${isPasswordReset ? 'Password reset' : 'Verification'} email sent to:`, email);
    return { success: true, messageId: email };
  } catch (error) {
    // Enhanced error handling for better diagnostics
    console.error('❌ EMAIL SEND FAILED to:', email);
    console.error('❌ Error code:', error.code);
    console.error('❌ Error message:', error.message);
    
    if (error.response) {
      console.error('❌ SendGrid status code:', error.response.statusCode);
      console.error('❌ SendGrid response body:', JSON.stringify(error.response.body, null, 2));
      
      // Common SendGrid error codes
      const statusCode = error.response.statusCode;
      if (statusCode === 401) {
        console.error('🔑 FIX: SENDGRID_API_KEY is invalid or expired - generate a new one');
      } else if (statusCode === 403) {
        console.error('🔑 FIX: Sender email not verified in SendGrid or permissions issue');
      } else if (statusCode === 429) {
        console.error('🔑 FIX: Rate limit exceeded - sending too many emails');
      }
    }
    
    return { success: false, error: error.message };
  }
}

export function generateVerificationCode() {
  // Generate 6-digit code
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendCreditPurchaseEmail(email, credits, amount, type = 'subscription', tierName = null, sessionId = null) {
  try {
    const branding = await getAppBranding();
    const brandName = branding.appName || BRAND.name;
    const purchaseDate = new Date().toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    
    const subject = type === 'one-time' 
      ? `${brandName} Purchase Confirmation - ${credits} Credits`
      : `${brandName} ${tierName} - Subscription Confirmed`;
    
    const heading = type === 'one-time'
      ? 'Purchase Confirmed'
      : `${tierName} Subscription Active`;
    
    const message = type === 'one-time'
      ? `Your one-time credit purchase was successful. ${credits} credits have been added to your account and are ready to use.`
      : `Your ${tierName} subscription is now active. You've received ${credits} credits to start creating.`;

    const msg = {
      to: email,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL || 'support@modelclone.app',
        name: brandName
      },
      subject,
      html: await renderBaseEmailShell({
        subject,
        sectionLabel: type === 'one-time' ? 'Credit Purchase' : 'Subscription',
        title: escapeHtml(heading),
        introHtml: `<p class="greeting-text">${escapeHtml(message)}</p>`,
        contentHtml: `
          <div style="background:#f7f7f5;border:1px solid #e2e2de;border-radius:4px;padding:20px 22px;margin-bottom:16px;">
            <p style="font-size:13px;color:#9b9b93;margin-bottom:8px;">Credits Added</p>
            <p style="font-size:32px;line-height:1.1;font-weight:600;color:#111;">${credits.toLocaleString()}</p>
          </div>
          <div style="background:#f7f7f5;border:1px solid #e2e2de;border-radius:4px;padding:16px 18px;margin-bottom:18px;">
            <p style="font-size:13px;color:#9b9b93;margin-bottom:8px;">Amount Paid</p>
            <p style="font-size:20px;font-weight:600;color:#111;">$${amount.toFixed(2)} USD</p>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:13px;color:#555550;margin:0 0 20px;">
            <tr><td style="padding:8px 0;border-bottom:1px solid #e8e8e4;">Purchase Date</td><td style="text-align:right;padding:8px 0;border-bottom:1px solid #e8e8e4;">${escapeHtml(purchaseDate)}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e8e8e4;">Type</td><td style="text-align:right;padding:8px 0;border-bottom:1px solid #e8e8e4;">${escapeHtml(type === 'one-time' ? 'One-Time Purchase' : 'Subscription')}</td></tr>
            ${tierName ? `<tr><td style="padding:8px 0;border-bottom:1px solid #e8e8e4;">Plan</td><td style="text-align:right;padding:8px 0;border-bottom:1px solid #e8e8e4;">${escapeHtml(tierName)}</td></tr>` : ''}
            ${sessionId ? `<tr><td style="padding:8px 0;border-bottom:1px solid #e8e8e4;">Reference ID</td><td style="text-align:right;padding:8px 0;border-bottom:1px solid #e8e8e4;font-family:monospace;">${escapeHtml(sessionId.slice(0, 28))}...</td></tr>` : ''}
            <tr><td style="padding:8px 0;">Merchant</td><td style="text-align:right;padding:8px 0;">${escapeHtml(brandName)}</td></tr>
          </table>
          <p style="margin:0 0 16px;"><a href="https://modelclone.app/dashboard" class="cta-btn">Go to Dashboard</a></p>
          <p class="note">Your credits are ready to use.</p>
          <p class="note">${type === 'subscription' ? 'Your subscription renews automatically each billing cycle. You can manage or cancel it from your settings.' : 'These credits never expire and can be used at your own pace.'}</p>
          <p class="note">Need help? Email <a href="mailto:support@modelclone.app" style="color:#1a1a1a;">support@modelclone.app</a>.</p>
        `,
        preheader: `${heading} - ${credits} credits added`,
      }),
    };

    await sgMail.send(msg);

    console.log(`✅ Credit purchase confirmation email sent to:`, email);
    return { success: true, messageId: email };
  } catch (error) {
    console.error('❌ SendGrid error sending credit purchase email:', error);
    if (error.response) {
      console.error('SendGrid response:', error.response.body);
    }
    return { success: false, error: error.message };
  }
}

export const LOGO_BASE64 = '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';

export async function sendPromoEmail(email, userName) {
  try {
    const branding = await getAppBranding();
    const brandName = branding.appName || BRAND.name;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'noreply@modelclone.app';
    const name = userName || 'Creator';
    const subject = 'Prices dropped — all generations up to 50% off';

    const msg = {
      to: email,
      from: {
        email: fromEmail,
        name: brandName
      },
      subject,
      trackingSettings: {
        clickTracking: { enable: false, enableText: false },
        openTracking: { enable: false },
      },
      html: await renderBaseEmailShell({
        subject,
        sectionLabel: "Product Update",
        title: "Up to 50% Off",
        introHtml: `<p class="greeting-text">Hey ${escapeHtml(name)}, we just cut prices on every generation type. Your credits now go further.</p>`,
        contentHtml: `
          <table style="width:100%;border-collapse:collapse;font-size:13px;color:#555550;margin:0 0 18px;">
            <tr><td style="padding:8px 0;border-bottom:1px solid #e8e8e4;">Identity Recreation</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #e8e8e4;"><span style="text-decoration:line-through;color:#9b9b93;">2 cr</span> <strong>1 cr</strong></td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e8e8e4;">Uncensored+ Images</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #e8e8e4;"><span style="text-decoration:line-through;color:#9b9b93;">2 cr</span> <strong>1 cr</strong></td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e8e8e4;">NSFW Prompt Images</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #e8e8e4;"><span style="text-decoration:line-through;color:#9b9b93;">2 cr</span> <strong>1 cr</strong></td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e8e8e4;">Ultra Realism</td><td style="padding:8px 0;text-align:right;border-bottom:1px solid #e8e8e4;"><span style="text-decoration:line-through;color:#9b9b93;">3 cr</span> <strong>2 cr</strong></td></tr>
            <tr><td style="padding:8px 0;">Video Preparation</td><td style="padding:8px 0;text-align:right;"><span style="text-decoration:line-through;color:#9b9b93;">6 cr</span> <strong>3 cr</strong></td></tr>
          </table>
          <p class="note" style="margin-bottom:16px;">New premium NSFW models are now live with higher realism and fewer restrictions.</p>
          <p style="margin:0 0 16px;"><a href="https://modelclone.app" class="cta-btn">Open ${escapeHtml(brandName)}</a></p>
          <p class="note">You received this because you have a ${escapeHtml(brandName)} account.</p>
        `,
        preheader: "Price drop on all generation types",
      }),
    };

    await sgMail.send(msg);
    console.log(`✅ Promo email sent to: ${email}`);
    return { success: true };
  } catch (error) {
    console.error(`❌ Failed to send promo email to ${email}:`, error.message);
    if (error.response) {
      console.error('SendGrid response:', error.response.body);
    }
    return { success: false, error: error.message };
  }
}

export async function sendFirstMembershipDiscountEmail({
  email,
  userName,
  discountCode,
  discountPercent = 15,
  validUntil,
}) {
  try {
    const branding = await getAppBranding();
    const brandName = branding.appName || BRAND.name;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || "noreply@modelclone.app";
    const name = userName || "Creator";
    const baseUrl = (branding.baseUrl || BRAND.defaultBaseUrl).replace(/\/$/, "");
    const expiresAtLabel = validUntil
      ? new Date(validUntil).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "soon";
    const templateVars = {
      NAME: escapeHtml(name),
      DISCOUNT_CODE: escapeHtml(discountCode),
      DISCOUNT_PERCENT: escapeHtml(String(discountPercent)),
      EXPIRES_AT: escapeHtml(expiresAtLabel),
      DASHBOARD_URL: escapeHtml(`${baseUrl}/dashboard`),
      BRAND_NAME: escapeHtml(brandName),
      EMAIL: escapeHtml(email),
    };
    const renderTemplate = (value) => {
      const raw = String(value || "");
      return raw.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_, key) => {
        const k = String(key || "").trim().toUpperCase();
        return Object.prototype.hasOwnProperty.call(templateVars, k) ? templateVars[k] : "";
      });
    };
    const template = await getWinbackEmailTemplate();
    const subject = renderTemplate(template.subject);
    const title = renderTemplate(template.title);
    const intro = renderTemplate(template.intro);
    const content = renderTemplate(template.content);

    const msg = {
      to: email,
      from: {
        email: fromEmail,
        name: brandName,
      },
      subject,
      trackingSettings: {
        clickTracking: { enable: false, enableText: false },
        openTracking: { enable: false },
      },
      html: await renderBaseEmailShell({
        subject,
        sectionLabel: "Membership Offer",
        title,
        introHtml: `<p class="greeting-text">${intro}</p>`,
        contentHtml: content,
        preheader: `${discountPercent}% off your first membership`,
      }),
    };

    await sgMail.send(msg);
    console.log(`✅ First membership discount email sent to: ${email}`);
    return { success: true };
  } catch (error) {
    console.error(`❌ Failed to send first membership discount email to ${email}:`, error.message);
    if (error.response) {
      console.error("SendGrid response:", error.response.body);
    }
    return { success: false, error: error.message };
  }
}

export async function sendReferralPayoutRequestEmail({
  username,
  payoutAmountUsd,
  walletAddress,
}) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.SENDGRID_FROM_EMAIL;
  if (!adminEmail) {
    console.warn("⚠️ ADMIN_EMAIL/SENDGRID_FROM_EMAIL is not configured; payout alert skipped.");
    return { success: false, error: "Admin email not configured" };
  }

  try {
    const branding = await getAppBranding();
    const brandName = branding.appName || BRAND.name;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || adminEmail;
    const subject = `New payout request from ${username}`;
    const msg = {
      to: adminEmail,
      from: {
        email: fromEmail,
        name: brandName,
      },
      subject,
      text: `New payout request from ${username}\n\nUsername: ${username}\nPayout amount: $${payoutAmountUsd}\nWallet address (USDT on Solana): ${walletAddress}`,
      html: await renderBaseEmailShell({
        subject,
        sectionLabel: "Referral Payout",
        title: `New payout request from ${escapeHtml(username)}`,
        introHtml: `<p class="greeting-text">A referral partner submitted a payout request. Review details below and process manually.</p>`,
        contentHtml: `
          <table style="width:100%;border-collapse:collapse;font-size:13px;color:#555550;">
            <tr><td style="padding:8px 0;border-bottom:1px solid #e8e8e4;">Username</td><td style="text-align:right;padding:8px 0;border-bottom:1px solid #e8e8e4;">${escapeHtml(username)}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid #e8e8e4;">Payout amount</td><td style="text-align:right;padding:8px 0;border-bottom:1px solid #e8e8e4;">$${escapeHtml(String(payoutAmountUsd))}</td></tr>
            <tr><td style="padding:8px 0;">Wallet (USDT on Solana)</td><td style="text-align:right;padding:8px 0;font-family:monospace;">${escapeHtml(walletAddress)}</td></tr>
          </table>
        `,
        preheader: `Payout request from ${username}`,
      }),
    };

    await sgMail.send(msg);
    return { success: true };
  } catch (error) {
    console.error("❌ Failed to send referral payout request email:", error.message);
    return { success: false, error: error.message };
  }
}

export async function sendSpecialOfferConfirmationEmail({ to, name, modelName, creditsAwarded }) {
  try {
    const branding = await getAppBranding();
    const brandName = branding.appName || BRAND.name;

    const subject = `Your AI Model is being created`;
    const msg = {
      to,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL || 'support@modelclone.app',
        name: brandName
      },
      subject,
      html: await renderBaseEmailShell({
        subject,
        sectionLabel: 'Special Offer',
        title: 'Your AI Model is Being Created',
        introHtml: `<p class="greeting-text">Hi ${escapeHtml(name)}, your $6 payment was received and your AI model is being set up right now.</p>`,
        contentHtml: `
          <div style="background:#f7f7f5;border:1px solid #e2e2de;border-radius:4px;padding:20px 22px;margin-bottom:16px;">
            <p style="font-size:13px;color:#9b9b93;margin-bottom:8px;">Model Name</p>
            <p style="font-size:20px;font-weight:600;color:#111;">${escapeHtml(modelName)}</p>
          </div>
          <div style="background:#f7f7f5;border:1px solid #e2e2de;border-radius:4px;padding:16px 18px;margin-bottom:18px;">
            <p style="font-size:13px;color:#9b9b93;margin-bottom:8px;">Bonus Credits Awarded</p>
            <p style="font-size:32px;line-height:1.1;font-weight:600;color:#111;">${creditsAwarded}</p>
          </div>
          <p style="margin:0 0 16px;"><a href="https://modelclone.app/dashboard" class="cta-btn">View Your Model</a></p>
          <p class="note">Your model will be ready in a few minutes. Head to your dashboard to see it once it's done.</p>
          <p class="note">Need help? Email <a href="mailto:support@modelclone.app" style="color:#1a1a1a;">support@modelclone.app</a>.</p>
        `,
        preheader: `Your AI model "${modelName}" is being created`,
      }),
    };

    await sgMail.send(msg);
    console.log(`✅ Special offer confirmation email sent to:`, to);
    return { success: true };
  } catch (error) {
    console.error('❌ Failed to send special offer confirmation email:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Notify user that their card was automatically charged to cover a voice hosting fee.
 */
export async function sendVoiceAutoChargeSuccessEmail(email, {
  voiceName,
  credits,
  amountUsd,
  dashboardUrl,
}) {
  try {
    const branding = await getAppBranding();
    const brandName = branding.appName || BRAND.name;
    const baseUrl = (branding.baseUrl || BRAND.defaultBaseUrl).replace(/\/$/, "");
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || process.env.ADMIN_EMAIL;
    if (!fromEmail) {
      console.warn("sendVoiceAutoChargeSuccessEmail: SENDGRID_FROM_EMAIL not set, skipping");
      return { success: false };
    }

    const safeVoice = escapeHtml(voiceName || "your custom voice");
    const safeCredits = escapeHtml(String(credits || 1000));
    const safeAmount = escapeHtml(amountUsd ? `$${Number(amountUsd).toFixed(2)}` : "");
    const ctaUrl = escapeHtml(dashboardUrl || `${baseUrl}/voice-studio`);

    const html = await renderBaseEmailShell({
      subject: "Voice hosting — card charged",
      sectionLabel: "Voice Studio",
      title: "Your voice hosting was renewed",
      preheader: `We charged your card ${safeAmount} to keep "${safeVoice}" active.`,
      introHtml: `<p class="greeting-text">Your saved payment method was automatically charged to cover the monthly hosting fee for <strong>${safeVoice}</strong>.</p>`,
      contentHtml: `
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <tr><td style="padding:8px 0;font-size:14px;color:#555550;font-weight:300;">Voice</td><td style="padding:8px 0;font-size:14px;color:#111;font-weight:500;text-align:right;">${safeVoice}</td></tr>
          <tr style="border-top:1px solid #e8e8e4;"><td style="padding:8px 0;font-size:14px;color:#555550;font-weight:300;">Credits added</td><td style="padding:8px 0;font-size:14px;color:#111;font-weight:500;text-align:right;">${safeCredits} credits</td></tr>
          ${safeAmount ? `<tr style="border-top:1px solid #e8e8e4;"><td style="padding:8px 0;font-size:14px;color:#555550;font-weight:300;">Amount charged</td><td style="padding:8px 0;font-size:14px;color:#111;font-weight:500;text-align:right;">${safeAmount}</td></tr>` : ""}
        </table>
        <a href="${ctaUrl}" class="cta-btn">Go to Voice Studio</a>
        <p class="note" style="margin-top:20px;">To avoid future auto-charges, top up your credit balance before your voice hosting renews each month.</p>
      `,
    });

    await sgMail.send({
      to: email,
      from: { name: brandName, email: fromEmail },
      subject: `Voice hosting renewed — card charged ${safeAmount}`,
      html,
    });
    return { success: true };
  } catch (err) {
    console.error("sendVoiceAutoChargeSuccessEmail error:", err?.message);
    return { success: false };
  }
}

/**
 * Warn user that auto-charge failed and their voice will be deleted in 3 days
 * unless they top up their credit balance.
 */
export async function sendVoiceGracePeriodEmail(email, {
  voiceName,
  graceEndsAt,
  credits,
  topupUrl,
}) {
  try {
    const branding = await getAppBranding();
    const brandName = branding.appName || BRAND.name;
    const baseUrl = (branding.baseUrl || BRAND.defaultBaseUrl).replace(/\/$/, "");
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || process.env.ADMIN_EMAIL;
    if (!fromEmail) {
      console.warn("sendVoiceGracePeriodEmail: SENDGRID_FROM_EMAIL not set, skipping");
      return { success: false };
    }

    const safeVoice = escapeHtml(voiceName || "your custom voice");
    const safeCredits = escapeHtml(String(credits || 1000));
    const deadlineStr = graceEndsAt
      ? escapeHtml(new Date(graceEndsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }))
      : "3 days from now";
    const ctaUrl = escapeHtml(topupUrl || `${baseUrl}/credits`);

    const html = await renderBaseEmailShell({
      subject: "Action required: top up to keep your voice",
      sectionLabel: "Voice Studio · Billing",
      title: `"${safeVoice}" will be deleted on ${deadlineStr}`,
      preheader: `Add ${safeCredits} credits by ${deadlineStr} to keep your voice active.`,
      introHtml: `<p class="greeting-text">We attempted to charge your saved payment method for the monthly hosting fee of <strong>${safeCredits} credits</strong> for <strong>${safeVoice}</strong>, but the payment did not go through.</p>`,
      contentHtml: `
        <p style="font-size:14px;color:#111;font-weight:500;margin-bottom:16px;">⚠️ Your voice will be <strong>permanently deleted</strong> on <strong>${deadlineStr}</strong> if the balance is not resolved.</p>
        <a href="${ctaUrl}" class="cta-btn" style="margin-bottom:20px;display:inline-block;">Add credits now</a>
        <p class="note" style="margin-top:20px;">Once you have enough credits in your account, the hosting fee will be collected automatically the next time you open Voice Studio, or at the next billing cycle.</p>
        <p class="note">If you no longer need this voice, you can delete it from Voice Studio to stop future billing.</p>
      `,
    });

    await sgMail.send({
      to: email,
      from: { name: brandName, email: fromEmail },
      subject: `⚠️ Add credits by ${deadlineStr} or "${safeVoice}" will be deleted`,
      html,
    });
    return { success: true };
  } catch (err) {
    console.error("sendVoiceGracePeriodEmail error:", err?.message);
    return { success: false };
  }
}

/**
 * Notify user that their voice has been deleted due to unpaid hosting.
 */
export async function sendVoiceDeletedDueToNonPaymentEmail(email, {
  voiceName,
  topupUrl,
}) {
  try {
    const branding = await getAppBranding();
    const brandName = branding.appName || BRAND.name;
    const baseUrl = (branding.baseUrl || BRAND.defaultBaseUrl).replace(/\/$/, "");
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || process.env.ADMIN_EMAIL;
    if (!fromEmail) {
      console.warn("sendVoiceDeletedDueToNonPaymentEmail: SENDGRID_FROM_EMAIL not set, skipping");
      return { success: false };
    }

    const safeVoice = escapeHtml(voiceName || "your custom voice");
    const ctaUrl = escapeHtml(topupUrl || `${baseUrl}/credits`);

    const html = await renderBaseEmailShell({
      subject: "Your voice has been deleted",
      sectionLabel: "Voice Studio · Billing",
      title: `"${safeVoice}" has been deleted`,
      preheader: `The grace period expired and "${safeVoice}" was removed.`,
      introHtml: `<p class="greeting-text">The 3-day grace period for <strong>${safeVoice}</strong> has ended and the voice has been permanently deleted from your account because the monthly hosting fee could not be collected.</p>`,
      contentHtml: `
        <p style="font-size:14px;color:#555550;margin-bottom:20px;">You can create a new voice at any time by adding credits to your account and visiting Voice Studio.</p>
        <a href="${ctaUrl}" class="cta-btn">Add credits</a>
      `,
    });

    await sgMail.send({
      to: email,
      from: { name: brandName, email: fromEmail },
      subject: `Your voice "${safeVoice}" has been deleted`,
      html,
    });
    return { success: true };
  } catch (err) {
    console.error("sendVoiceDeletedDueToNonPaymentEmail error:", err?.message);
    return { success: false };
  }
}

export async function sendFrontendErrorAlert({
  message,
  stack,
  componentStack,
  url,
  userId,
  userEmail,
  userAgent,
  timestamp,
}) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.SENDGRID_FROM_EMAIL;
  if (!adminEmail) {
    console.warn("⚠️ ADMIN_EMAIL not set — frontend error alert skipped.");
    return { success: false };
  }

  const fromEmail = process.env.SENDGRID_FROM_EMAIL || adminEmail;
  const appName = process.env.APP_NAME || "ModelClone";

  const escapeHtml = (str) =>
    String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: monospace; background: #0a0a0a; color: #e0e0e0; padding: 24px; }
    h2 { color: #f87171; margin-bottom: 4px; }
    .meta { color: #888; font-size: 12px; margin-bottom: 20px; }
    .section { margin-bottom: 16px; }
    .label { color: #a78bfa; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
    pre { background: #111; border: 1px solid #333; border-radius: 6px; padding: 12px; font-size: 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; color: #fca5a5; }
    .info-row { display: flex; gap: 8px; margin-bottom: 6px; font-size: 13px; }
    .info-key { color: #9ca3af; min-width: 120px; }
    .info-val { color: #e5e7eb; }
  </style>
</head>
<body>
  <h2>🚨 Frontend Error — ${escapeHtml(appName)}</h2>
  <p class="meta">Captured at ${escapeHtml(timestamp || new Date().toISOString())}</p>

  <div class="section">
    <div class="label">Error Message</div>
    <pre>${escapeHtml(message)}</pre>
  </div>

  <div class="section">
    <div class="label">Context</div>
    <div class="info-row"><span class="info-key">Page URL:</span><span class="info-val">${escapeHtml(url)}</span></div>
    <div class="info-row"><span class="info-key">User ID:</span><span class="info-val">${escapeHtml(userId || "anonymous")}</span></div>
    <div class="info-row"><span class="info-key">User Email:</span><span class="info-val">${escapeHtml(userEmail || "—")}</span></div>
    <div class="info-row"><span class="info-key">User Agent:</span><span class="info-val">${escapeHtml(userAgent)}</span></div>
  </div>

  ${stack ? `<div class="section"><div class="label">JavaScript Stack Trace</div><pre>${escapeHtml(stack)}</pre></div>` : ""}
  ${componentStack ? `<div class="section"><div class="label">React Component Stack</div><pre>${escapeHtml(componentStack)}</pre></div>` : ""}
</body>
</html>`;

  try {
    await sgMail.send({
      to: adminEmail,
      from: { name: `${appName} Alerts`, email: fromEmail },
      subject: `🚨 [${appName}] Frontend Error: ${String(message || "Unknown").slice(0, 80)}`,
      html,
    });
    return { success: true };
  } catch (err) {
    console.error("❌ Failed to send frontend error alert email:", err.message);
    return { success: false };
  }
}
