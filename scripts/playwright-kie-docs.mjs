/**
 * Headed Playwright: browse official KIE API docs only (https://docs.kie.ai).
 *
 * Run: npm run pw:kie-docs
 * Stop: Ctrl+C (closes the browser).
 */
import { chromium } from "playwright";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openNavIfNeeded(page) {
  const navBtn = page.getByRole("button", { name: /open navigation drawer/i });
  if (await navBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await navBtn.click();
    await sleep(400);
  }
}

async function clickSidebarLink(page, nameRegex) {
  await openNavIfNeeded(page);
  const link = page.getByRole("link", { name: nameRegex });
  if (await link.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    await link.first().click();
    await page.waitForLoadState("domcontentloaded");
    return true;
  }
  return false;
}

async function main() {
  const browser = await chromium.launch({
    headless: false,
    args: ["--window-size=1280,900", "--window-position=80,40"],
  });
  const page = await browser.newPage();

  const stop = async () => {
    await browser.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log("\n[KIE docs] Opening https://docs.kie.ai …\n");
  await page.goto("https://docs.kie.ai/", { waitUntil: "domcontentloaded", timeout: 90_000 });

  const title = await page.title();
  const h1 = await page.locator("h1").first().innerText().catch(() => "");
  console.log(`[KIE docs] Page: ${title}`);
  console.log(`[KIE docs] H1: ${h1?.slice(0, 120) || "(none)"}`);
  console.log(`[KIE docs] URL: ${page.url()}`);

  const bearer = await page.getByText(/Authorization:\s*Bearer/i).first().isVisible().catch(() => false);
  console.log(`[KIE docs] §4 Bearer header visible on home: ${bearer}`);

  if (await clickSidebarLink(page, /^Create volcanic assets$/i)) {
    console.log(`[KIE docs] Opened: ${page.url()}`);
  } else {
    const fallback = "https://docs.kie.ai/market/bytedance/create-volcanic-assets";
    await page.goto(fallback, { waitUntil: "domcontentloaded" }).catch(() => {});
    console.log(`[KIE docs] Sidebar miss — tried: ${page.url()}`);
  }

  await sleep(800);
  await page.goto("https://docs.kie.ai/", { waitUntil: "domcontentloaded" });
  if (await clickSidebarLink(page, /^Ideogram V3 Edit$/i)) {
    console.log(`[KIE docs] Opened: ${page.url()}`);
  } else {
    await page.goto("https://docs.kie.ai/market/ideogram/v3-edit", { waitUntil: "domcontentloaded" }).catch(() => {});
    console.log(`[KIE docs] Ideogram fallback: ${page.url()}`);
  }

  await page.goto("https://docs.kie.ai/", { waitUntil: "domcontentloaded" });
  console.log("\n[KIE docs] Browser stays on docs home. Use the UI to explore; Ctrl+C to exit.\n");

  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
