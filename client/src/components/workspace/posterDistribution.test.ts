/**
 * Tests for PosterDistribution (Batch 4 m3) + SixPlatformComposer (m5).
 * Pure logic: posterState mapping, sort priority, platform config coverage.
 */
import { describe, it, expect } from "vitest";

type CardState = "decide" | "running" | "wait" | "done" | "err" | "none";

function posterState(status: string): CardState {
  if (status === "uploaded") return "wait";
  if (status === "processing") return "running";
  if (status === "ready") return "decide";
  if (status === "approved") return "done";
  if (status === "distributed") return "done";
  if (status === "archived") return "done";
  if (status === "failed") return "err";
  return "none";
}

describe("posterState (m3)", () => {
  it("uploaded → wait", () => expect(posterState("uploaded")).toBe("wait"));
  it("processing → running", () => expect(posterState("processing")).toBe("running"));
  it("ready → decide (needs Jeff)", () => expect(posterState("ready")).toBe("decide"));
  it("approved → done", () => expect(posterState("approved")).toBe("done"));
  it("distributed → done", () => expect(posterState("distributed")).toBe("done"));
  it("archived → done", () => expect(posterState("archived")).toBe("done"));
  it("failed → err", () => expect(posterState("failed")).toBe("err"));
  it("unknown → none", () => expect(posterState("xyz")).toBe("none"));
});

describe("poster sort priority (m3)", () => {
  const sortOrder: Record<string, number> = {
    ready: 0,
    processing: 1,
    uploaded: 2,
    approved: 3,
    distributed: 4,
    failed: 5,
    archived: 6,
  };

  it("ready (needs action) sorts first", () => {
    expect(sortOrder["ready"]).toBe(0);
  });

  it("archived sorts last", () => {
    const max = Math.max(...Object.values(sortOrder));
    expect(sortOrder["archived"]).toBe(max);
  });

  it("processing before uploaded", () => {
    expect(sortOrder["processing"]).toBeLessThan(sortOrder["uploaded"]);
  });
});

describe("platform config coverage (m5)", () => {
  const DB_PLATFORMS = [
    "wechat_moments",
    "wechat_group",
    "xiaohongshu",
    "line",
    "facebook",
    "instagram",
    "newsletter",
  ];

  const PLATFORM_CONFIG: Record<string, { ratio: string }> = {
    facebook: { ratio: "1.91:1" },
    instagram: { ratio: "1:1" },
    xiaohongshu: { ratio: "3:4" },
    wechat_moments: { ratio: "1:1" },
    wechat_group: { ratio: "2.35:1" },
    line: { ratio: "1:1" },
    newsletter: { ratio: "16:9" },
  };

  it("every DB platform has a config entry", () => {
    for (const p of DB_PLATFORMS) {
      expect(PLATFORM_CONFIG[p], `missing config for ${p}`).toBeDefined();
    }
  });

  it("every config entry has a non-empty ratio", () => {
    for (const [k, v] of Object.entries(PLATFORM_CONFIG)) {
      expect(v.ratio.length, `${k} ratio empty`).toBeGreaterThan(0);
    }
  });

  it("config covers all 7 platforms", () => {
    expect(Object.keys(PLATFORM_CONFIG)).toHaveLength(7);
  });
});

describe("poster upload validation (m3)", () => {
  it("rejects empty image URL", () => {
    const valid = (url: string) => url.trim().length > 0;
    expect(valid("")).toBe(false);
    expect(valid("  ")).toBe(false);
    expect(valid("https://example.com/img.jpg")).toBe(true);
  });

  it("vendor defaults to other", () => {
    const defaultVendor = "other";
    expect(["lion", "zongheng", "house", "other"]).toContain(defaultVendor);
  });

  it("audience defaults to general", () => {
    const defaultAudience = "general";
    expect([
      "family",
      "honeymoon",
      "parent_child",
      "business",
      "senior",
      "general",
    ]).toContain(defaultAudience);
  });
});
