/**
 * Guard: every `workspace.*` i18n key referenced by workspace components
 * exists in BOTH zh-TW and en bundles.
 *
 * audit-i18n.ts (pre-commit) checks zh↔en key parity but cannot see keys the
 * CODE references — a typo'd key silently renders as the raw key string at
 * runtime. This test closes that gap for the whole /workspace redesign
 * (batches 1-8): any new component in this folder is scanned automatically.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { zhTW } from "../../i18n/zh-TW";
import { en } from "../../i18n/en";

const COMPONENT_DIRS = [
  __dirname, // client/src/components/workspace
  join(__dirname, "..", "..", "pages"), // Workspace.tsx lives here
];

/** Literals that match the workspace.* pattern but are NOT i18n keys. */
const NOT_I18N_KEYS = new Set([
  "workspace.sidebar.collapsed", // localStorage key (WorkspaceSidebar)
]);

function collectReferencedKeys(): Set<string> {
  const keys = new Set<string>();
  const re = /["'`](workspace\.[A-Za-z0-9_.]+)["'`]/g;
  for (const dir of COMPONENT_DIRS) {
    for (const f of readdirSync(dir)) {
      if (!/\.(tsx?|ts)$/.test(f) || f.endsWith(".test.ts")) continue;
      // pages/ holds the whole app — only scan Workspace.tsx there
      if (dir.endsWith("pages") && f !== "Workspace.tsx") continue;
      const src = readFileSync(join(dir, f), "utf8");
      for (const m of src.matchAll(re)) {
        if (!NOT_I18N_KEYS.has(m[1])) keys.add(m[1]);
      }
    }
  }
  return keys;
}

function lookup(bundle: Record<string, unknown>, dotted: string): unknown {
  return dotted
    .split(".")
    .reduce<unknown>(
      (o, k) =>
        o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined,
      bundle,
    );
}

describe("workspace i18n key references", () => {
  const referenced = [...collectReferencedKeys()].sort();

  it("finds at least the known core keys (scanner sanity)", () => {
    expect(referenced).toContain("workspace.today");
    expect(referenced).toContain("workspace.handled");
  });

  it.each(referenced)("%s exists in zh-TW and en", (key) => {
    expect(lookup(zhTW, key), `${key} missing in zh-TW`).toBeTypeOf("string");
    expect(lookup(en, key), `${key} missing in en`).toBeTypeOf("string");
  });
});
