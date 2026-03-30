import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const pagesDir = path.join(repoRoot, "client", "src", "pages");
const outPath = path.join(repoRoot, "docs", "designer-landers-handoff.md");

const intro = `# ModelClone — Lander pages (code handoff for design)

Use this document to understand current structure, copy, layout, and styling before proposing visual redesigns.

## Tech context

- **Framework:** React (Vite), React Router
- **Styling:** Tailwind CSS utility classes + inline \`style={{}}\` for gradients/glass
- **Motion:** framer-motion
- **Icons:** lucide-react, some react-icons (e.g. SiTrustpilot, SiDiscord)
- **Shared components:** \`CursorGlow\`, \`OptimizedGalleryImage\` (under \`client/src/components/\`)

## Routes (see \`client/src/App.jsx\`)

| URL | Component file |
|-----|----------------|
| \`/\` | \`SelectUserTypePage.jsx\` — path picker (Creator / Agency / Create AI Model) |
| \`/landing?type=creator\` or \`?type=agency\` | \`LandingPage.jsx\` — long-form marketing lander (same file; copy and sections switch on \`type\`) |
| \`/create-ai-model\` | \`CreateAIModelLandingPage.jsx\` — AI model creation funnel |

---

`;

function section(title, route, file, code) {
  return (
    `## ${title}\n\n` +
    `**Route:** \`${route}\`  \n` +
    `**Source file:** \`${file}\`\n\n` +
    "```jsx\n" +
    code +
    "\n```\n\n---\n\n"
  );
}

const p1 = fs.readFileSync(path.join(pagesDir, "SelectUserTypePage.jsx"), "utf8");
const p2 = fs.readFileSync(path.join(pagesDir, "LandingPage.jsx"), "utf8");
const p3 = fs.readFileSync(path.join(pagesDir, "CreateAIModelLandingPage.jsx"), "utf8");

const out =
  intro +
  section("1. Main lander (home)", "/", "client/src/pages/SelectUserTypePage.jsx", p1) +
  section(
    "2. Marketing lander — Creator & Agency",
    "/landing?type=creator | /landing?type=agency",
    "client/src/pages/LandingPage.jsx",
    p2,
  ) +
  section("3. Create AI Model lander", "/create-ai-model", "client/src/pages/CreateAIModelLandingPage.jsx", p3);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out, "utf8");
console.log("Wrote", outPath, `(${Math.round(out.length / 1024)} KB)`);
