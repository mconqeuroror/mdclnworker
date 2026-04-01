# Editable Figma Import (ModelClone)

Use this flow when you want the **most editable** import path:
- Export HTML snapshots for each route.
- Import those routes into Figma with `html.to.design`.

## 1) One-time setup

From repo root:

```bash
npm install
npx playwright install chromium
```

## 2) Export public routes

Run your app locally first (default base URL is `http://localhost:5173`), then:

```bash
npm run figma:export:html
```

Output goes to:
- `figma-static/export-YYYYMMDD-HHMMSS/`
- Includes `manifest.json`, per-route `index.html`, and `preview.png`.

## 3) Include auth-only routes (dashboard/admin/pro)

1. Create Playwright storage state after logging in:

```bash
npm run figma:auth-state
```

2. Export with auth routes:

```bash
npm run figma:export:html:auth
```

This uses:
- `--include-auth`
- `--storage-state scripts/figma-auth-state.json`

## 4) Import into Figma (most editable option)

1. Install Figma plugin: **html.to.design**.
2. Start a static server from the export folder:

```bash
npx serve "figma-static/export-YYYYMMDD-HHMMSS"
```

3. In Figma plugin, import each page URL:
- `http://localhost:3000/<route-label>/index.html`

You can get exact route labels from `manifest.json`.

## Notes / limitations

- This is the most editable auto-import path, but still not perfect 1:1 with production code.
- Complex dynamic behavior may need manual cleanup in Figma.
- For highest consistency, keep route viewport fixed during exports.
