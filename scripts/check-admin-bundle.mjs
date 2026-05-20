#!/usr/bin/env node
/**
 * v2 Wave 1 Module 1.5 — Admin bundle-size guard.
 *
 * Asserts the Admin shell stays small after Module 1.5's per-tab code-split.
 * Without this guard, a future PR that accidentally re-introduces an eager
 * import (e.g. `import ToursTab from ...`) would silently bloat the shell
 * back to ~1MB and undo the mobile-admin TTI win.
 *
 * Run via:  node scripts/check-admin-bundle.mjs
 * (Intended to be wired as a CI postbuild step in Wave 4 Module 4.26.)
 *
 * Threshold: 200 KB. Module 1.5 landed at ~30 KB so we have ~6× headroom
 * before this fails — leaves room for legitimate growth (shell-level
 * routing primitives, future top bars/sidebars) without nagging.
 *
 * Exits 0 on success, 1 with a clear diagnostic on regression.
 */

import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, "..", "dist", "public", "assets");
const THRESHOLD_BYTES = 200 * 1024; // 200 KB hard limit

function fail(msg) {
  console.error(`\n❌ check-admin-bundle: ${msg}\n`);
  process.exit(1);
}

let entries;
try {
  entries = readdirSync(ASSETS_DIR);
} catch (err) {
  fail(
    `Could not read ${ASSETS_DIR} — run \`pnpm build\` first.\n   Underlying error: ${err.message}`,
  );
}

// Vite output filenames look like `Admin-<hash>.js` (the shell only — each
// lazy chunk has the tab's component name, e.g. `ToursTab-<hash>.js`).
const adminShellFiles = entries.filter(
  (f) => /^Admin-[A-Za-z0-9_-]+\.js$/.test(f) && !f.endsWith(".map"),
);

if (adminShellFiles.length === 0) {
  fail(
    `No Admin shell file found in ${ASSETS_DIR}. Expected something like Admin-<hash>.js.`,
  );
}

if (adminShellFiles.length > 1) {
  fail(
    `Expected exactly one Admin shell file, found ${adminShellFiles.length}: ${adminShellFiles.join(", ")}`,
  );
}

const shellFile = adminShellFiles[0];
const shellSize = statSync(join(ASSETS_DIR, shellFile)).size;
const shellKB = (shellSize / 1024).toFixed(1);
const thresholdKB = (THRESHOLD_BYTES / 1024).toFixed(0);

if (shellSize > THRESHOLD_BYTES) {
  fail(
    `Admin shell ${shellFile} is ${shellKB} KB — exceeds ${thresholdKB} KB limit.\n` +
      `   Most likely cause: a tab import was changed from \`lazy(() => import("..."))\`\n` +
      `   back to a static \`import X from "..."\` in client/src/pages/Admin.tsx.\n` +
      `   Convert it back to a lazy() import to restore the per-tab code-split.`,
  );
}

console.log(
  `✅ check-admin-bundle: ${shellFile} is ${shellKB} KB (limit: ${thresholdKB} KB).`,
);
process.exit(0);
