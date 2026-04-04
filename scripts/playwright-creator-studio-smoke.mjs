import { chromium } from "playwright";

const BASE_URL = process.env.PLAYWRIGHT_APP_URL || "https://modelclone.app";
const TARGET_URL = `${BASE_URL.replace(/\/$/, "")}/dashboard?tab=creator-studio`;
const PROFILE_DIR = "scripts/.pw-modelclone-profile";
const WAIT = 500;

function now() {
  return new Date().toISOString();
}

function log(msg, data = null) {
  if (data) {
    console.log(`${now()} ${msg}`, data);
    return;
  }
  console.log(`${now()} ${msg}`);
}

async function safeCount(locator) {
  try {
    return await locator.count();
  } catch {
    return 0;
  }
}

async function firstVisible(page, locators) {
  for (const locator of locators) {
    if ((await safeCount(locator)) > 0 && (await locator.first().isVisible().catch(() => false))) {
      return locator.first();
    }
  }
  return null;
}

async function clickByText(page, texts) {
  for (const txt of texts) {
    const loc = page.getByText(txt, { exact: false }).first();
    if ((await safeCount(loc)) > 0) {
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await loc.click({ timeout: 7000 });
      await page.waitForTimeout(WAIT);
      return true;
    }
  }
  return false;
}

async function dismissBlockingOverlays(page) {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Escape").catch(() => {});
    const closeCandidates = [
      page.getByRole("button", { name: /close|dismiss|got it|skip|not now|maybe later|continue/i }).first(),
      page.locator('button:has-text("Close")').first(),
      page.locator('button:has-text("Skip")').first(),
    ];
    for (const btn of closeCandidates) {
      if ((await safeCount(btn)) > 0 && (await btn.isVisible().catch(() => false))) {
        await btn.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(300);
      }
    }
  }
}

async function clickControl(page, regexes) {
  for (const rx of regexes) {
    const candidates = [
      page.getByRole("button", { name: rx }).first(),
      page.getByRole("tab", { name: rx }).first(),
      page.locator(`button:has-text("${String(rx).replace(/^\/|\/[a-z]*$/g, "")}")`).first(),
    ];
    for (const loc of candidates) {
      if ((await safeCount(loc)) > 0 && (await loc.isVisible().catch(() => false))) {
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        await loc.click({ timeout: 7000 });
        await page.waitForTimeout(WAIT);
        return true;
      }
    }
  }
  return false;
}

async function run() {
  log("Launching headed browser");
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1600, height: 1000 },
  });
  const page = context.pages()[0] || (await context.newPage());

  const checks = [];
  const push = (name, ok, details = {}) => checks.push({ name, ok, details });
  const clickGenerateAndCheckToast = async (messageRegex) => {
    const genBtn = await firstVisible(page, [
      page.getByRole("button", { name: /Generate/i }),
      page.locator('button:has-text("Generate")').first(),
    ]);
    if (!genBtn) return { clicked: false, toastCount: 0 };
    await genBtn.click({ timeout: 7000 }).catch(() => {});
    await page.waitForTimeout(700);
    const toastCount = await safeCount(page.getByText(messageRegex));
    return { clicked: true, toastCount };
  };

  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1500);
  log("Opened Creator Studio", { url: page.url() });

  const loginSignals =
    (await safeCount(page.getByText(/sign in|log in|login/i))) +
    (await safeCount(page.locator('input[type="password"]')));
  if (loginSignals > 0) {
    log("Login required. Please sign in in the opened browser window.");
    await page.waitForURL(/dashboard|creator-studio/i, { timeout: 180_000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  await dismissBlockingOverlays(page);
  const dontShowAgain = page.getByRole("button", { name: /Don't show again/i }).first();
  if ((await safeCount(dontShowAgain)) > 0 && (await dontShowAgain.isVisible().catch(() => false))) {
    await dontShowAgain.click().catch(() => {});
    await page.waitForTimeout(400);
  }

  // Ensure we're on the Image/Generate tab for model chips.
  const photoTab = page.getByRole("button", { name: /^Photo$/i }).first();
  if ((await safeCount(photoTab)) > 0) {
    await photoTab.click({ timeout: 7000 });
  } else {
    await clickByText(page, [/^Photo$/i, /^Generate$/i]);
  }
  await page.waitForTimeout(1200);
  await page.waitForSelector("text=Nano Banana", { timeout: 10000 }).catch(() => {});

  // 1) Flux Kontext Pro should require input image.
  const fluxClicked = await clickByText(page, [/Flux Kontext Pro/i, /Flux Kontext/i]);
  const fluxValidation = await clickGenerateAndCheckToast(/requires an input image/i);
  push("Flux Kontext requires input image", fluxClicked && fluxValidation.toastCount > 0, {
    fluxClicked,
    ...fluxValidation,
  });

  // 2) Ideogram V3 Edit should expose mask controls.
  const ideEditClicked = await clickByText(page, [/Ideogram V3 Edit/i]);
  const drawMaskBtn = await safeCount(page.getByRole("button", { name: /Draw mask/i }));
  push("Ideogram Edit shows mask UI", ideEditClicked && drawMaskBtn > 0, { ideEditClicked, drawMaskBtn });

  // 3) Ideogram V3 Remix should still require input image (no mask requirement).
  const ideRemixClicked = await clickByText(page, [/Ideogram V3 Remix/i]);
  const ideRemixValidation = await clickGenerateAndCheckToast(/Ideogram Remix requires input image/i);
  push("Ideogram Remix requires input image", ideRemixClicked && ideRemixValidation.toastCount > 0, {
    ideRemixClicked,
    ...ideRemixValidation,
  });

  // 4) Wan 2.7 Image Pro should show advanced fields.
  const wanClicked = await clickByText(page, [/Wan 2\.7 Image Pro/i, /Wan 2.7/i]);
  const wanColor = await safeCount(page.getByPlaceholder(/color_palette/i));
  const wanBbox = await safeCount(page.getByPlaceholder(/bbox_list/i));
  push("Wan 2.7 shows advanced palette/bbox fields", wanClicked && wanColor > 0 && wanBbox > 0, {
    wanClicked,
    wanColor,
    wanBbox,
  });

  // 5) Seedream v4.5 Edit should require at least one input image/reference.
  const seedreamClicked = await clickByText(page, [/Seedream v4\.5 Edit/i, /Seedream/i]);
  const seedreamValidation = await clickGenerateAndCheckToast(/Seedream v4\.5 Edit needs at least one input image/i);
  push("Seedream v4.5 Edit enforces input image requirement in UI", seedreamClicked && seedreamValidation.toastCount > 0, {
    seedreamClicked,
    ...seedreamValidation,
  });

  // 6) Video tab: Seedance asset modal should use file upload wording.
  const videoTab = await firstVisible(page, [
    page.getByRole("button", { name: /^Video$/i }),
    page.getByText(/^Video$/i),
  ]);
  let videoOpened = false;
  if (videoTab) {
    await dismissBlockingOverlays(page);
    await videoTab.click({ timeout: 7000 });
    await page.waitForTimeout(700);
    videoOpened = true;
  }
  await clickByText(page, [/Seedance 2\.0/i, /Seedance/i]);
  const assetsBtn = await firstVisible(page, [
    page.getByRole("button", { name: /Open assets/i }),
    page.getByRole("button", { name: /assets/i }),
    page.getByText(/Open assets/i),
  ]);
  let assetsOpened = false;
  if (assetsBtn) {
    await assetsBtn.click({ timeout: 7000 });
    await page.waitForTimeout(700);
    assetsOpened = true;
  }
  const uploadSource = await safeCount(page.getByText(/Upload source image|Upload source video|Upload source audio/i));
  const urlPrompt = await safeCount(page.getByPlaceholder(/https?:\/\//i));
  push("Seedance assets modal uses upload flow (not URL input)", videoOpened && assetsOpened && uploadSource > 0 && urlPrompt === 0, {
    videoOpened,
    assetsOpened,
    uploadSource,
    urlPrompt,
  });

  log("Creator Studio smoke results:");
  let passed = 0;
  for (const c of checks) {
    if (c.ok) passed += 1;
    console.log(`${c.ok ? "PASS" : "FAIL"} - ${c.name} ${JSON.stringify(c.details)}`);
  }
  console.log(`Summary: ${passed}/${checks.length} passed, ${checks.length - passed} failed`);

  await page.waitForTimeout(3000);
  await context.close();
}

run().catch((err) => {
  console.error("Smoke run failed:", err);
  process.exit(1);
});
