/**
 * Catastrophe user discovery: emails from Vercel (including auth/signup `message` lines) + Stripe
 * customers (since), then create missing users in prod with a temporary password and optional email.
 * **Signup:** production logs can include the registering email in `message` (e.g. `📍 Fingerprint: user@...`)
 * for `POST /api/auth/signup` — use `extractEmailsFromAuthSignupVercelRows` (high trust) in addition
 * to the full-row loose regex.
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma.js";
import { getStripeForAccount } from "../lib/stripeClients.js";
import { sendCatastropheRestoredAccountEmail } from "./email.service.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BAD = [
  "w3.org", "example.com", "sentry", "schema.org", "test@test", "localhost", "vercel.com",
  "github.com", "noreply@",
];

const RE_SIGNUP_PATH = /\/api\/auth\/signup/i;
/** Matches app log: `Fingerprint: user@host` or `📍 Fingerprint: user@...` */
const RE_FINGERPRINT_EMAIL = /Fingerprint:\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24})/i;

/**
 * Emails from signup-related Vercel rows where the server printed the address in `message`
 * (fingerprint / registration logging — high precision vs loose JSON scan).
 * @param {object[]|null|undefined} rows
 * @returns {string[]}
 */
export function extractEmailsFromAuthSignupVercelRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const out = new Set();
  const fallbackRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/i;
  for (const row of rows) {
    if (!RE_SIGNUP_PATH.test(String(row?.requestPath || ""))) continue;
    const msg = String(row?.message || "");
    const fp = msg.match(RE_FINGERPRINT_EMAIL);
    if (fp?.[1]) {
      out.add(fp[1].toLowerCase().trim());
      continue;
    }
    const m = msg.match(fallbackRe);
    if (m?.[0] && !BAD.some((b) => m[0].toLowerCase().includes(b))) {
      out.add(m[0].toLowerCase());
    }
  }
  return [...out].sort();
}

/**
 * @param {object[]|null|undefined} rows
 * @returns {string[]}
 */
export function extractLooseEmailsFromVercelExport(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const re = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;
  const out = new Set();
  for (const row of rows) {
    const s = JSON.stringify(row);
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      const e = m[0].toLowerCase();
      if (e.length < 6 || e.length > 100) continue;
      if (BAD.some((b) => e.includes(b))) continue;
      if (/\.(png|jpe?g|gif|webp|svg)@/i.test(e)) continue;
      if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/.test(e)) continue;
      if (e.endsWith("@modelclone.app") && (e.startsWith("onboarding@") || e.startsWith("noreply@"))) {
        continue;
      }
      out.add(e);
    }
  }
  return [...out].sort();
}

/**
 * @param {object} p
 * @param {Date} p.since
 * @param {number} p.maxPerAccount
 */
export async function listStripeCustomersForRecovery(p) {
  const since = p.since;
  const maxPerAccount = p.maxPerAccount;
  const sinceSec = Math.floor(since.getTime() / 1000);
  const all = [];
  for (const account of ["new", "legacy"]) {
    const client = getStripeForAccount(account);
    if (!client) continue;
    let startingAfter = null;
    let n = 0;
    for (;;) {
      if (n >= maxPerAccount) break;
      const take = Math.min(100, maxPerAccount - n);
      if (take <= 0) break;
      const page = await client.customers.list({
        created: { gte: sinceSec },
        limit: take,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const c of page.data) {
        n += 1;
        if (!c?.email) continue;
        all.push({
          account,
          customerId: c.id,
          email: c.email.toLowerCase().trim(),
          name: c.name || null,
          metadataUserId: c.metadata?.userId || c.metadata?.user_id || null,
          created: c.created,
        });
        if (n >= maxPerAccount) break;
      }
      if (!page.has_more || page.data.length === 0) break;
      startingAfter = page.data[page.data.length - 1].id;
    }
  }
  const byEmail = new Map();
  for (const c of all) {
    const prev = byEmail.get(c.email);
    if (!prev || (c.metadataUserId && !prev.metadataUserId)) {
      byEmail.set(c.email, c);
    }
  }
  return [...byEmail.values()];
}

function randomTempPassword() {
  return randomBytes(18).toString("base64url").slice(0, 22);
}

/**
 * @param {object} opts
 * @param {any[]|null} [opts.vercelLogRows]
 * @param {Date} opts.since
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.sendCatastropheAccountEmail] — default true
 * @param {number} [opts.maxStripeCustomers=2000]
 * @param {string} [opts.temporaryPasswordStyle] — "email_plaintext" (default) or "create_only" (set password, no email)
 */
export async function runCatastropheUserAccountPhase(opts = {}) {
  const dryRun = opts.dryRun !== false;
  const since = opts.since instanceof Date ? opts.since : new Date(0);
  const vercelRows = Array.isArray(opts.vercelLogRows) ? opts.vercelLogRows : [];
  const fromSignupFingerprint = extractEmailsFromAuthSignupVercelRows(vercelRows);
  const fromLogs = extractLooseEmailsFromVercelExport(vercelRows);
  const maxC = Math.min(10_000, Math.max(100, parseInt(String(opts.maxStripeCustomers || 2000), 10) || 2000));
  const fromStripe = await listStripeCustomersForRecovery({ since, maxPerAccount: maxC });
  const sendCatastrophe = opts.temporaryPasswordStyle === "create_only" ? false : opts.sendCatastropheAccountEmail !== false;

  const byEmail = new Map();
  for (const e of fromSignupFingerprint) {
    if (!e) continue;
    byEmail.set(e, { source: "vercel_signup_fingerprint" });
  }
  for (const e of fromLogs) {
    if (!e) continue;
    if (!byEmail.has(e)) {
      byEmail.set(e, { source: "vercel_loose" });
    } else {
      const prev = byEmail.get(e);
      byEmail.set(e, { ...prev, alsoInLooseScan: true });
    }
  }
  for (const c of fromStripe) {
    const ex = byEmail.get(c.email);
    if (ex) {
      byEmail.set(c.email, { ...ex, stripe: c, source: "stripe_and_vercel" });
    } else {
      byEmail.set(c.email, { source: "stripe_customer", stripe: c });
    }
  }

  const existing = [];
  const wouldCreate = [];
  const created = [];
  const errors = [];

  for (const [email, info] of byEmail) {
    const u = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, email: true, createdAt: true },
    });
    if (u) {
      existing.push({ email, userId: u.id, source: info.source, note: "prod_exists_defer" });
      continue;
    }
    if (dryRun) {
      const s = info.stripe;
      const suggested =
        s?.metadataUserId && UUID_RE.test(String(s.metadataUserId)) ? String(s.metadataUserId) : null;
      wouldCreate.push({
        email,
        source: info.source,
        suggestedUserId: suggested,
        stripeCustomerId: s?.customerId || null,
        stripeAccount: s?.account || null,
      });
      continue;
    }
    const tempPass = randomTempPassword();
    const hash = await bcrypt.hash(tempPass, 10);
    const s = info.stripe;
    const useId = s?.metadataUserId && UUID_RE.test(String(s.metadataUserId)) ? String(s.metadataUserId) : undefined;
    const name = s?.name || null;
    const sa = s?.account || "new";
    const data = {
      ...(useId ? { id: useId } : {}),
      email,
      name,
      password: hash,
      isVerified: true,
      authProvider: "email",
      role: "user",
      subscriptionStatus: "trial",
      stripeAccount: sa,
    };
    if (s?.account === "new" && s.customerId) {
      data.stripeCustomerId = s.customerId;
    }
    if (s?.account === "legacy" && s.customerId) {
      data.legacyStripeCustomerId = s.customerId;
    }
    try {
      const user = await prisma.user.create({ data });
      let em = { success: !sendCatastrophe };
      if (sendCatastrophe) {
        em = await sendCatastropheRestoredAccountEmail(user.email, tempPass, name || "there");
      }
      created.push({ email, userId: user.id, emailSent: Boolean(em?.success) });
    } catch (e) {
      const code = e?.code;
      if (code === "P2002") {
        errors.push({ email, error: e?.message || "unique_conflict", code });
      } else {
        errors.push({ email, error: e?.message || String(e), code });
      }
    }
  }

  return {
    dryRun,
    fromSignupFingerprintCount: fromSignupFingerprint.length,
    fromLooseVercelCount: fromLogs.length,
    fromStripeCount: fromStripe.length,
    totalCandidates: byEmail.size,
    existing,
    wouldCreate,
    created,
    errors: errors.length ? errors : null,
  };
}
