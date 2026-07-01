/**
 * Regression — 串客 guard (2026-07-01): CustomerChat often does NOT unmount on
 * customer switch (AdminCustomers renders it without a key, and a cached query
 * skips the skeleton), so the scope-reset effect is the only thing standing
 * between "Jeff dropped A's passport, switched to B, hit send" and A's passport
 * being filed into B's 文件 tab. The effect cleared messages/busy/error but NOT
 * the unsent attachments or the typed draft.
 *
 * The repo has no React component/hook test rig (vitest env=node, no
 * testing-library), so this follows the source-scan precedent
 * (workspaceI18n.test.ts / noEmDashGuard.test.ts): parse the reset effect out
 * of CustomerChat.tsx and assert it clears BOTH — red before the fix, green
 * after, and red again if a refactor drops either line.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "CustomerChat.tsx"), "utf8");

// The scope-reset effect is the ONE useEffect keyed on
// [customer?.id, customer?.kind, activeProjectId].
const m = src.match(
  /useEffect\(\(\) => \{([\s\S]*?)\}, \[customer\?\.id, customer\?\.kind, activeProjectId\]\)/,
);
const body = m?.[1] ?? "";

describe("CustomerChat scope-reset effect (串客 regression)", () => {
  it("finds the reset effect keyed on customer+project (scanner sanity)", () => {
    expect(m, "reset effect [customer?.id, customer?.kind, activeProjectId] not found").toBeTruthy();
    expect(body).toContain("setMessages([])");
    expect(body).toContain("setBusy(false)");
  });

  it("clears unsent attachments on customer/project switch (A 的護照不歸進 B)", () => {
    expect(body).toContain("setAttachments([])");
  });

  it("clears the typed draft on customer/project switch", () => {
    expect(body).toContain('setInput("")');
  });
});
