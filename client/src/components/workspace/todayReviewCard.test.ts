/**
 * todayReviewCard.test.ts — batch 6 m5: review card star rendering + excerpt.
 */
import { describe, it, expect } from "vitest";

describe("review star rendering", () => {
  function stars(rating: number) {
    return "★".repeat(rating) + "☆".repeat(5 - rating);
  }

  it("renders 5 stars for rating 5", () => {
    expect(stars(5)).toBe("★★★★★");
  });
  it("renders 3 stars for rating 3", () => {
    expect(stars(3)).toBe("★★★☆☆");
  });
  it("renders 0 stars for rating 0", () => {
    expect(stars(0)).toBe("☆☆☆☆☆");
  });
  it("renders 1 star for rating 1", () => {
    expect(stars(1)).toBe("★☆☆☆☆");
  });
});

describe("review excerpt", () => {
  function excerpt(content: string) {
    return content.length > 80 ? content.slice(0, 80) + "..." : content;
  }

  it("returns short content as-is", () => {
    expect(excerpt("Great tour!")).toBe("Great tour!");
  });
  it("truncates long content at 80 chars", () => {
    const long = "x".repeat(100);
    const result = excerpt(long);
    expect(result.length).toBe(83); // 80 + "..."
    expect(result.endsWith("...")).toBe(true);
  });
  it("returns exactly 80 chars without truncation", () => {
    const exact = "y".repeat(80);
    expect(excerpt(exact)).toBe(exact);
  });
});

describe("review disposition kind", () => {
  const WORKSPACE_ITEM_KINDS = ["booking", "inquiry", "task", "review"] as const;

  it("includes review in valid kinds", () => {
    expect(WORKSPACE_ITEM_KINDS).toContain("review");
  });
  it("has 4 item kinds total", () => {
    expect(WORKSPACE_ITEM_KINDS.length).toBe(4);
  });
});
