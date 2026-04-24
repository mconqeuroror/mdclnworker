/**
 * One-shot: rewrite ../src/ and ../modelclone links in bundled markdown for standalone repo.
 * Run from repo root: node api-documentation-bundle/scripts/strip-monorepo-links.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.resolve(__dirname, "..");

const files = [
  "API.md",
  "API_USERS.md",
  "API_INTEGRATORS_REFERENCE.md",
  "ADMIN_PUBLIC_API.md",
  "STORAGE_AND_MIRRORING.md",
  "VERCEL_API_WRAPPER.md",
  "API_FULL_INTEGRATOR_SINGLE_FILE.md",
  "WRAPPER_VERCEL.md",
];

for (const name of files) {
  const p = path.join(bundle, name);
  if (!fs.existsSync(p)) continue;
  let s = fs.readFileSync(p, "utf8");
  // [label](../src/foo/bar.js) -> `src/foo/bar.js`
  s = s.replace(/\[([^\]]*)\]\(\.\.\/src\/([^)]+)\)/g, (_, _label, rel) => `\`${rel}\``);
  // [label](../docs/foo) in case
  s = s.replace(/\[([^\]]*)\]\(\.\.\/docs\/([^)]+)\)/g, (_, _label, rel) => `[${rel}](./${rel})`);
  // modelclone-api README
  s = s.replace(/\]\(\.\.\/modelclone-api\/README\.md\)/g, "](./WRAPPER_VERCEL.md)");
  s = s.replace(/\]\(\.\.\/\.\.\/modelclone-api\/README\.md\)/g, "](./WRAPPER_VERCEL.md)");
  fs.writeFileSync(p, s, "utf8");
  console.error("Patched", name);
}
