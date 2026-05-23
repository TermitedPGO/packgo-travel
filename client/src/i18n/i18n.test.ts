/**
 * i18n parity test — guarantees zh-TW / en / ja / ko always have identical key sets.
 *
 * If you add a key to zh-TW.ts, you MUST add it to en.ts (and let ja/ko fall through
 * the spread). This test will fail until parity is restored.
 *
 * 2026-05-22: created to enforce "100% i18n coverage" guarantee Jeff asked for.
 */
import { describe, expect, it } from "vitest";
import { zhTW } from "./zh-TW";
import { en } from "./en";
import { ja } from "./ja";
import { ko } from "./ko";

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

describe("i18n parity", () => {
  const zhKeys = new Set(flatten(zhTW));

  it("en.ts has every zh-TW key (no English user sees Chinese fallback)", () => {
    const enKeys = new Set(flatten(en));
    const missing = [...zhKeys].filter((k) => !enKeys.has(k));
    if (missing.length > 0) {
      console.error(
        `[i18n parity] ${missing.length} key(s) missing in en.ts:\n` +
          missing.map((k) => `  - ${k}`).join("\n"),
      );
    }
    expect(missing).toEqual([]);
  });

  it("en.ts has no orphan keys (every en key has a zh-TW counterpart)", () => {
    const enKeys = new Set(flatten(en));
    const orphan = [...enKeys].filter((k) => !zhKeys.has(k));
    if (orphan.length > 0) {
      console.error(
        `[i18n parity] ${orphan.length} orphan key(s) in en.ts (no zh-TW source):\n` +
          orphan.map((k) => `  - ${k}`).join("\n"),
      );
    }
    expect(orphan).toEqual([]);
  });

  it("ja.ts inherits full key set via en.ts spread", () => {
    const jaKeys = new Set(flatten(ja));
    const missing = [...zhKeys].filter((k) => !jaKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("ko.ts inherits full key set via en.ts spread", () => {
    const koKeys = new Set(flatten(ko));
    const missing = [...zhKeys].filter((k) => !koKeys.has(k));
    expect(missing).toEqual([]);
  });
});
