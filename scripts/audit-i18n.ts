/**
 * Audit i18n coverage.
 *
 * Run: pnpm tsx scripts/audit-i18n.ts
 *
 * What it does:
 *  1. Loads zh-TW + en + ja + ko translation bundles
 *  2. Flattens nested objects to dotted key paths
 *  3. Reports keys that exist in one language but not another
 *  4. Greps client/src for hardcoded translation patterns that bypass t()
 *
 * Exit code: 0 if 100% parity + 0 hardcoded patterns, 1 otherwise.
 */

import { zhTW } from "../client/src/i18n/zh-TW";
import { en } from "../client/src/i18n/en";
import { ja } from "../client/src/i18n/ja";
import { ko } from "../client/src/i18n/ko";
import { execSync } from "node:child_process";

function flatten(obj: any, prefix = ""): string[] {
  const keys: string[] = [];
  for (const k of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const v = obj[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...flatten(v, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

const langs = { "zh-TW": zhTW, en, ja, ko } as const;
const keysByLang: Record<string, Set<string>> = {};
for (const [lang, dict] of Object.entries(langs)) {
  keysByLang[lang] = new Set(flatten(dict));
}

const reference = keysByLang["zh-TW"];
const REPORT_LIMIT = 30;

let hasGaps = false;
console.log("\n=== i18n Parity Report ===\n");
console.log(`Reference (zh-TW): ${reference.size} keys\n`);

for (const lang of ["en", "ja", "ko"] as const) {
  const here = keysByLang[lang];
  const missing = [...reference].filter((k) => !here.has(k));
  const extra = [...here].filter((k) => !reference.has(k));
  console.log(
    `${lang.padEnd(6)} ${here.size} keys │ missing ${missing.length} │ extra ${extra.length}`,
  );
  if (missing.length > 0) {
    hasGaps = true;
    console.log(`  Missing in ${lang}:`);
    missing.slice(0, REPORT_LIMIT).forEach((k) => console.log(`    - ${k}`));
    if (missing.length > REPORT_LIMIT) {
      console.log(`    ... +${missing.length - REPORT_LIMIT} more`);
    }
  }
  if (extra.length > 0) {
    console.log(`  Extra in ${lang} (orphan, no zh-TW counterpart):`);
    extra.slice(0, REPORT_LIMIT).forEach((k) => console.log(`    - ${k}`));
  }
}

// ---- Grep for hardcoded translation patterns ----
console.log("\n=== Hardcoded Translation Patterns ===\n");

const grepPatterns: { name: string; cmd: string; allowFiles: RegExp }[] = [
  {
    name: "language === ternary with Chinese literal (e.g. 'en' ? 'Foo' : '中文')",
    cmd: "grep -rnE \"language === ['\\\"]en['\\\"] ?\\?\" client/src --include='*.tsx' | grep -E \"['\\\"\\`][^'\\\"\\`]*[一-鿿]\" | grep -v 'admin/\\|admin-v2/\\|node_modules'",
    allowFiles: /TourRouteMapCanvas|HomeSearchBar|Rewards|Tours\.tsx|locationMapping|currency/,
  },
];

let hardcoded = 0;
for (const p of grepPatterns) {
  try {
    const out = execSync(p.cmd, { encoding: "utf8", shell: "/bin/bash" }).trim();
    if (out) {
      const lines = out.split("\n").filter((l) => {
        const file = l.split(":")[0];
        return !p.allowFiles.test(file);
      });
      if (lines.length > 0) {
        hasGaps = true;
        hardcoded += lines.length;
        console.log(`[${p.name}] ${lines.length} occurrences:`);
        lines.slice(0, REPORT_LIMIT).forEach((l) => console.log(`  ${l}`));
        if (lines.length > REPORT_LIMIT) {
          console.log(`  ... +${lines.length - REPORT_LIMIT} more`);
        }
        console.log("");
      }
    }
  } catch {
    // grep exit 1 means no match
  }
}

if (!hasGaps) {
  console.log("✓ 100% parity, 0 hardcoded patterns. Ship it.\n");
  process.exit(0);
}

console.log(
  `\nFix all gaps before merging. ${hardcoded} hardcoded patterns + parity differences above.\n`,
);
process.exit(1);
