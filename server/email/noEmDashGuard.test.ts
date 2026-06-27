/**
 * No-em-dash guard for outbound email (feedback_no_em_dashes — absolute rule:
 * customer-facing text never uses — / – / ― / ‒; ASCII hyphen "-" is fine).
 *
 * The customOrder templates already enforce this by rendering + asserting; this
 * widens the net to EVERY email template + the gmail reply builder by scanning
 * their source string literals (comments are stripped first, since the file
 * headers legitimately use em dashes in prose). A regression breaks the suite.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const EM_DASH = /[—–―‒]/;

/**
 * Strip the parts that are NOT customer-facing copy so only the subject / body /
 * sign-off strings are checked: block + line comments (header prose), and
 * internal log lines (console.* and our "[gmail]" / "[Email]" tagged logger
 * strings) which never reach a customer.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/^.*console\.(log|warn|error|info).*$/gm, "")
    .replace(/^.*\[(gmail|Email)\].*$/gm, "");
}

const root = process.cwd();
const tplDir = join(root, "server/email/templates");
// supplierNotification is B2B (sent to suppliers, not customers) — out of scope
// for the customer no-em-dash rule.
const EXEMPT = new Set(["supplierNotification.ts"]);
const files = [
  join(root, "server/_core/gmail.ts"),
  ...readdirSync(tplDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !EXEMPT.has(f))
    .map((f) => join(tplDir, f)),
];

describe("outbound email templates use no em dash", () => {
  for (const file of files) {
    const rel = file.slice(root.length + 1);
    it(rel, () => {
      const stripped = stripComments(readFileSync(file, "utf-8"));
      const offending = stripped
        .split("\n")
        .map((l, i) => ({ n: i + 1, l: l.trim() }))
        .filter((x) => EM_DASH.test(x.l));
      expect(
        offending,
        `em dash in ${rel}:\n${offending.map((x) => `  L${x.n}: ${x.l}`).join("\n")}`,
      ).toEqual([]);
    });
  }
});
