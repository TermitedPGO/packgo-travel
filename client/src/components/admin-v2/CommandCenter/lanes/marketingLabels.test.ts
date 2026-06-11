/**
 * Guard: marketing lane label maps stay i18n-complete.
 *
 * marketingLane.tsx renders contentType/platform badges via the i18n-key maps
 * in marketingLabels.ts (the old maps hardcoded Chinese — i18n red line).
 * This test fails if:
 *   (a) a map value points at a key missing from zh-TW or en (it would
 *       silently render the raw key string at runtime), or
 *   (b) the producer's MarketingContentType enum gains a value the type map
 *       does not cover (the badge would fall back to the raw enum value).
 */
import { describe, expect, it } from "vitest";
import { zhTW } from "@/i18n/zh-TW";
import { en } from "@/i18n/en";
import { MKT_PLATFORM_I18N, MKT_TYPE_I18N } from "./marketingLabels";

/**
 * Every MarketingContentType value the producer can emit — keep in sync with
 * server/agents/autonomous/marketingProducer.ts (not imported: that module
 * pulls in server-only deps like the db + logger).
 */
const PRODUCER_CONTENT_TYPES = [
  "xhs_post",
  "wechat_article",
  "edm",
  "poster_copy",
  "social_post",
  "other",
] as const;

function lookup(bundle: Record<string, unknown>, dotted: string): unknown {
  return dotted
    .split(".")
    .reduce<unknown>(
      (o, k) =>
        o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined,
      bundle,
    );
}

describe("marketing lane label maps", () => {
  it("MKT_TYPE_I18N covers every producer contentType enum value", () => {
    expect(Object.keys(MKT_TYPE_I18N).sort()).toEqual(
      [...PRODUCER_CONTENT_TYPES].sort(),
    );
  });

  const allKeys = [
    ...Object.values(MKT_TYPE_I18N),
    ...Object.values(MKT_PLATFORM_I18N),
  ].sort();

  it.each(allKeys)("%s exists in zh-TW and en", (key) => {
    expect(lookup(zhTW, key), `${key} missing in zh-TW`).toBeTypeOf("string");
    expect(lookup(en, key), `${key} missing in en`).toBeTypeOf("string");
  });
});
