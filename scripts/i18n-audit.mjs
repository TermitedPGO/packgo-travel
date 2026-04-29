#!/usr/bin/env node
/**
 * i18n-audit.mjs — v78p Sprint 8: Find hardcoded Chinese strings in client/src
 * that aren't routed through the t('...') i18n function.
 *
 * Why: the translator agent only translates DB content (tours table). Frontend
 * hardcoded strings like "貼我問問題！", "編輯首頁", "本週精選" stay Chinese on
 * the EN site because they're not in the locale files. This script catches them.
 *
 * Usage:
 *   node scripts/i18n-audit.mjs                # report to stdout
 *   node scripts/i18n-audit.mjs --json         # JSON output for CI
 *   node scripts/i18n-audit.mjs --max=50       # limit results
 *   node scripts/i18n-audit.mjs --fix          # write a starter en.ts patch
 *
 * Heuristics (tunable):
 *   - String literal contains any CJK character (一-鿿)
 *   - Not inside a //, /* *​/ comment
 *   - Not inside an import path
 *   - Not the source/native side of a t() call (e.g. zh-TW.ts file itself)
 *   - Not a known-allowed file (locale files, tests, dist)
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "client/src");

// File patterns to skip (already i18n source, tests, generated, etc.)
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", ".next", "__tests__",
]);
const SKIP_FILE_PATTERNS = [
  /\/i18n\//,
  /\/locales\//,
  /\.test\./,
  /\.spec\./,
  /\.d\.ts$/,
  /utils\/locationMapping\.ts$/, // dictionary file — Chinese is intentional
];

// File extensions to scan
const SCAN_EXTS = new Set([".tsx", ".ts", ".jsx", ".js"]);

const CJK_RANGE = /[一-鿿㐀-䶿]/;
// Match string literals that contain CJK chars
const STRING_LITERAL_REGEX = /(?:"((?:[^"\\]|\\.)*[一-鿿][^"\\]*)"|'((?:[^'\\]|\\.)*[一-鿿][^'\\]*)'|`((?:[^`\\]|\\.)*[一-鿿][^`\\]*)`)/g;

const args = process.argv.slice(2);
const FLAG_JSON = args.includes("--json");
const FLAG_FIX = args.includes("--fix");
const MAX_RESULTS = (() => {
  const m = args.find((a) => a.startsWith("--max="));
  return m ? parseInt(m.split("=")[1], 10) : Infinity;
})();

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (SCAN_EXTS.has(path.extname(e.name))) {
      yield full;
    }
  }
}

function isInComment(line, columnIndex) {
  // Single-line comment before this column?
  const slashIdx = line.indexOf("//");
  if (slashIdx >= 0 && slashIdx < columnIndex) return true;
  return false;
}

function isImportLine(line) {
  return /^\s*(import|export)\s/.test(line) || /from\s+["']/.test(line);
}

/**
 * Score a Chinese-containing string by likelihood of being user-facing UI text
 * vs. an intentional comment / aria-label / data field.
 *  10 = definitely visible UI; 5 = borderline; <3 = probably a false positive
 */
function classifyContext(line, text) {
  const L = line;
  const T = text;
  let score = 5;
  let reason = "";

  // ========== STRONG NEGATIVES (likely false positive) ==========
  // Bilingual pair pattern: { zh: "X", en: "Y" } or { zh: ..., en: ... }
  // These ARE i18n-correct — they explicitly provide both languages
  if (/\{\s*zh\s*:\s*["'`].*?["'`]\s*,\s*en\s*:/.test(L) ||
      /\bzh\s*:\s*["'`][一-鿿]/.test(L) ||
      /\ben\s*:\s*["'`][^"'`]+["'`]\s*,\s*zh\s*:/.test(L)) {
    score -= 10; reason += "bilingual-pair;";
  }
  // ternary `isEN ? "..." : "中文"` — already locale-conditional
  if (/isEN\s*\?\s*["'`].*?["'`]\s*:\s*["'`].*?[一-鿿]/.test(L) ||
      /language\s*===\s*["'`]en["'`]\s*\?/.test(L)) {
    score -= 8; reason += "ternary-locale;";
  }
  // Console / error / log / warn — internal logging, not UI
  if (/console\.(log|warn|error|info|debug)\s*\(/.test(L)) {
    score -= 7; reason += "console;";
  }
  if (/^\s*[*#/]/.test(L)) { score -= 8; reason += "comment;"; }
  // throw new Error("...") — error message, often dev-facing
  if (/throw\s+new\s+\w*Error\s*\(/.test(L)) { score -= 4; reason += "throw;"; }
  // JSDoc continuation lines (start with *)
  if (/^\s*\*/.test(L)) { score -= 8; reason += "jsdoc;"; }

  // ========== POSITIVES (likely real UI) ==========
  // Toast / alert / confirm — definitely user-facing
  if (/\b(toast|alert|confirm)\.[a-z]+\s*\(/.test(L)) {
    score += 4; reason += "toast/alert;";
  }
  // JSX content: > "中文" < or > {"中文"} <
  if (/>\s*["'`][^"'`]*[一-鿿][^"'`]*["'`]/.test(L) ||
      />\s*\{\s*["'`][^"'`]*[一-鿿]/.test(L)) {
    score += 3; reason += "jsx-content;";
  }
  // Inside fallback || pattern WITH t() before the || (means key is missing/wrong)
  if (/t\s*\(\s*["'`][^)]+\)\s*\|\|\s*["'`].*?[一-鿿]/.test(L)) {
    score += 4; reason += "missing-i18n-key;";
  }
  // UI-attribute prefixes (placeholder=, label=, title=, alt=, aria-label=)
  if (/\b(placeholder|aria-label|alt|title)\s*=\s*\{?\s*["'`]/.test(L)) {
    score += 2; reason += "ui-attr;";
  }

  // Length: very short text or single char is likely UI keyword that's hard to translate; mid score
  if (T.length <= 1) { score -= 8; reason += "single-char;"; }
  if (T.length >= 2 && T.length <= 10) score += 1;

  // URL or path
  if (T.includes("/") && (T.startsWith(".") || T.startsWith("/") || T.startsWith("http"))) {
    score -= 8; reason += "url-path;";
  }

  return { score, reason };
}

/**
 * Load en.ts and return a Set of LEAF identifiers (e.g. "intent1Title").
 *
 * Why leaves only: TS object literal parsing is fragile (inline objects, `} as const`,
 * etc.). Since i18n key collisions across namespaces are rare for the leaf name
 * itself, just checking "is this leaf identifier defined anywhere in en.ts?" gives
 * a 95%-accurate signal for "is this key valid". Good enough to triage dead-code
 * fallbacks vs. true leaks.
 */
async function loadI18nKeys() {
  try {
    const enText = await fs.readFile(path.join(SRC, "i18n/en.ts"), "utf8");
    const keys = new Set();
    // Match `identifier:` at the start of any whitespace-led line, with a string or { value
    const lineRe = /^\s*(['"]?)([A-Za-z_$][\w$]*)\1\s*:/gm;
    let m;
    while ((m = lineRe.exec(enText)) !== null) {
      keys.add(m[2]);
    }
    return keys;
  } catch (err) {
    console.warn("[audit] could not load en.ts keys:", err.message);
    return new Set();
  }
}

/** Detect `t('some.key')` calls on the same line as the suspicious string */
function findTKeyCall(line) {
  const m = line.match(/\bt\s*\(\s*['"`]([^'"`]+)['"`]/);
  return m ? m[1] : null;
}

async function audit() {
  const i18nKeys = await loadI18nKeys();
  const issues = [];
  for await (const file of walk(SRC)) {
    if (SKIP_FILE_PATTERNS.some((p) => p.test(file))) continue;
    const rel = path.relative(ROOT, file);
    const content = await fs.readFile(file, "utf8");
    const lines = content.split("\n");
    let inBlockComment = false;
    lines.forEach((line, idx) => {
      // Track block comments
      if (inBlockComment) {
        if (line.includes("*/")) inBlockComment = false;
        return;
      }
      if (/^\s*\/\*/.test(line) && !line.includes("*/")) inBlockComment = true;
      if (inBlockComment) return;
      if (isImportLine(line)) return;
      if (!CJK_RANGE.test(line)) return;
      // Find string literals in this line
      let m;
      const re = new RegExp(STRING_LITERAL_REGEX);
      while ((m = re.exec(line)) !== null) {
        const text = m[1] || m[2] || m[3];
        if (!text || !CJK_RANGE.test(text)) continue;
        const colIdx = m.index;
        if (isInComment(line, colIdx)) continue;
        let { score, reason } = classifyContext(line, text);

        // Dead-code fallback: `t('a.b.leaf') || "中文"` — if the leaf name
        // exists in en.ts the fallback never displays. Strong negative.
        const tKey = findTKeyCall(line);
        if (tKey) {
          const leaf = tKey.split(".").pop();
          if (leaf && i18nKeys.has(leaf)) {
            score -= 6;
            reason += "leaf-exists(" + leaf + ");";
          } else {
            score += 3;
            reason += "leaf-MISSING(" + leaf + ");";
          }
        }

        if (score >= 5) {
          issues.push({
            file: rel,
            line: idx + 1,
            col: colIdx + 1,
            text,
            score,
            reason,
            context: line.trim().slice(0, 200),
          });
        }
      }
    });
  }
  // Sort by score descending, then by file
  issues.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  return issues;
}

function reportText(issues) {
  if (issues.length === 0) {
    console.log("✅ No hardcoded CJK strings found in client/src");
    return;
  }
  console.log(`Found ${issues.length} potential i18n leak${issues.length > 1 ? "s" : ""} (showing up to ${Math.min(MAX_RESULTS, issues.length)}):\n`);
  // Group by file
  const byFile = new Map();
  for (const i of issues.slice(0, MAX_RESULTS)) {
    if (!byFile.has(i.file)) byFile.set(i.file, []);
    byFile.get(i.file).push(i);
  }
  for (const [file, arr] of byFile) {
    console.log(`\n📂 ${file} (${arr.length})`);
    for (const i of arr) {
      const tag = i.score >= 9 ? "🔴" : i.score >= 7 ? "🟡" : "⚪";
      console.log(`   ${tag} L${i.line}:${i.col}  "${i.text}"`);
      console.log(`      ${i.context}`);
    }
  }
  // Summary
  const high = issues.filter((i) => i.score >= 9).length;
  const med = issues.filter((i) => i.score >= 7 && i.score < 9).length;
  const low = issues.filter((i) => i.score < 7).length;
  console.log(`\nSummary: 🔴 ${high} high-confidence  🟡 ${med} medium  ⚪ ${low} low/maybe`);
  console.log(`Run: node scripts/i18n-audit.mjs --json > /tmp/i18n-leaks.json   for machine output`);
}

async function main() {
  const issues = await audit();
  if (FLAG_JSON) {
    console.log(JSON.stringify(issues.slice(0, MAX_RESULTS), null, 2));
    return;
  }
  reportText(issues);
  if (FLAG_FIX) {
    console.log("\n--fix not implemented yet (would write i18n key suggestions)");
  }
  // Exit non-zero in CI when high-severity leaks exist
  const high = issues.filter((i) => i.score >= 9).length;
  if (high > 0 && process.env.CI) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(2);
});
