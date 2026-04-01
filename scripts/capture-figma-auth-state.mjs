#!/usr/bin/env node
import path from "path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
function getArg(flag, fallback = null) {
  const idx = args.indexOf(flag);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
}

const BASE_URL = getArg("--base-url", "http://localhost:5173");
const LOGIN_PATH = getArg("--login-path", "/login");
const OUT = getArg("--out", path.join(process.cwd(), "scripts", "figma-auth-state.json"));
const AUTO_DETECT = args.includes("--auto-detect-auth");
const AUTO_TIMEOUT_MS = Number(getArg("--timeout-ms", "300000"));

async function run() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  const loginUrl = `${String(BASE_URL).replace(/\/+$/, "")}${String(LOGIN_PATH).startsWith("/") ? LOGIN_PATH : `/${LOGIN_PATH}`}`;
  console.log(`Open login page: ${loginUrl}`);
  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });

  if (AUTO_DETECT) {
    console.log("\nLog in manually in the opened browser.");
    console.log(`Auto-detect mode is ON (timeout ${Math.round(AUTO_TIMEOUT_MS / 1000)}s).`);
    console.log("Storage state will be saved automatically when auth is detected.\n");
    const started = Date.now();
    let authenticated = false;
    while (Date.now() - started < AUTO_TIMEOUT_MS) {
      try {
        const currentUrl = page.url();
        const pathOnly = new URL(currentUrl).pathname.toLowerCase();
        const hasAuthStorage = await page.evaluate(() => {
          try {
            const keys = Object.keys(localStorage || {});
            return keys.some((k) => k.toLowerCase().includes("auth") || k.toLowerCase().includes("token"));
          } catch {
            return false;
          }
        });
        if (
          hasAuthStorage
          || (pathOnly !== "/login" && !pathOnly.startsWith("/signup") && !pathOnly.startsWith("/forgot-password"))
        ) {
          authenticated = true;
          break;
        }
      } catch {
        // Ignore transient navigation/read errors and keep polling.
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!authenticated) {
      console.warn("Auth auto-detect timed out. Saving current storage state anyway.");
    }
  } else {
    console.log("\nLog in manually in the opened browser.");
    console.log("After you land in an authenticated page, press ENTER here to save storage state.\n");
    await new Promise((resolve) => {
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      process.stdin.once("data", () => resolve());
    });
  }

  await context.storageState({ path: OUT });
  await browser.close();
  console.log(`Saved auth storage state to: ${OUT}`);
}

run().catch((error) => {
  console.error("Failed to capture auth state:", error);
  process.exit(1);
});
