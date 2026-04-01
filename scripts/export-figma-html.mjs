#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";

const cwd = process.cwd();
const args = process.argv.slice(2);

function getArg(flag, fallback = null) {
  const idx = args.indexOf(flag);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
}

function hasFlag(flag) {
  return args.includes(flag);
}

function nowStamp() {
  const d = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function sanitizeName(value) {
  return String(value || "route")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "route";
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function resolveUrl(baseUrl, routePath) {
  const normalizedBase = String(baseUrl || "").replace(/\/+$/, "");
  const normalizedPath = String(routePath || "").startsWith("/") ? routePath : `/${routePath}`;
  return `${normalizedBase}${normalizedPath}`;
}

function buildDocWithDoctype(html) {
  if (String(html || "").toLowerCase().startsWith("<!doctype")) return html;
  return `<!doctype html>\n${html}`;
}

const BASE_URL = getArg("--base-url", "http://localhost:5173");
const ROUTES_FILE = getArg("--routes-file", path.join(cwd, "scripts", "figma-export-routes.json"));
const OUTPUT_DIR = getArg("--out-dir", path.join(cwd, "figma-static", `export-${nowStamp()}`));
const VIEWPORT_WIDTH = Number(getArg("--width", "1512"));
const VIEWPORT_HEIGHT = Number(getArg("--height", "982"));
const INCLUDE_AUTH = hasFlag("--include-auth");
const STORAGE_STATE = getArg("--storage-state", null);
const PAUSE_MS = Number(getArg("--pause-ms", "800"));
const WAIT_UNTIL = getArg("--wait-until", "domcontentloaded");

async function run() {
  const routes = await readJson(ROUTES_FILE);
  await ensureDir(OUTPUT_DIR);

  const browser = await chromium.launch({ headless: true });
  const contextOptions = {
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
  };
  if (STORAGE_STATE) {
    contextOptions.storageState = STORAGE_STATE;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  const exported = [];
  const skipped = [];

  for (const route of routes) {
    const routePath = String(route?.path || "").trim();
    if (!routePath) continue;

    if (route.requiresAuth && !INCLUDE_AUTH) {
      skipped.push({ path: routePath, reason: "requiresAuth=true and --include-auth not set" });
      continue;
    }

    const label = sanitizeName(route.label || routePath);
    const url = resolveUrl(BASE_URL, routePath);
    const dir = path.join(OUTPUT_DIR, label);
    await ensureDir(dir);

    try {
      console.log(`Exporting ${routePath} -> ${url}`);
      await page.goto(url, { waitUntil: WAIT_UNTIL, timeout: 120_000 });
      await page.waitForTimeout(PAUSE_MS);

      // Build a static-ish HTML snapshot: inline same-origin CSS + strip scripts.
      const snapshot = await page.evaluate(() => {
        const clone = document.documentElement.cloneNode(true);
        const head = clone.querySelector("head");
        const body = clone.querySelector("body");

        // Remove scripts from snapshot to keep it deterministic for import.
        clone.querySelectorAll("script").forEach((el) => el.remove());

        // Inline readable CSS rules from same-origin sheets.
        const collectedRules = [];
        for (const sheet of Array.from(document.styleSheets)) {
          try {
            if (!sheet.cssRules) continue;
            for (const rule of Array.from(sheet.cssRules)) {
              collectedRules.push(rule.cssText);
            }
          } catch {
            // Ignore cross-origin/inaccessible stylesheets.
          }
        }

        if (head) {
          const styleTag = document.createElement("style");
          styleTag.setAttribute("data-export-inline-css", "true");
          styleTag.textContent = collectedRules.join("\n");
          head.appendChild(styleTag);

          const baseTag = document.createElement("base");
          baseTag.setAttribute("href", `${window.location.origin}/`);
          head.prepend(baseTag);
        }

        if (body) {
          body.setAttribute("data-exported-from", window.location.href);
        }

        return `<!doctype html>\n${clone.outerHTML}`;
      });

      const html = buildDocWithDoctype(snapshot);
      await fs.writeFile(path.join(dir, "index.html"), html, "utf8");
      await page.screenshot({ path: path.join(dir, "preview.png"), fullPage: true });
      exported.push({ path: routePath, label, url, file: `${label}/index.html` });
    } catch (error) {
      skipped.push({ path: routePath, reason: error?.message || "unknown error" });
    }
  }

  const manifest = {
    exportedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    includeAuth: INCLUDE_AUTH,
    storageState: STORAGE_STATE || null,
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    routesFile: path.relative(cwd, ROUTES_FILE),
    exported,
    skipped,
  };

  await fs.writeFile(path.join(OUTPUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  await browser.close();

  console.log(`\nDone. Exported ${exported.length} route(s), skipped ${skipped.length}.`);
  console.log(`Output: ${OUTPUT_DIR}`);
}

run().catch((error) => {
  console.error("Export failed:", error);
  process.exit(1);
});
