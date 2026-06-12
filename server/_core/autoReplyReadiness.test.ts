/**
 * Tests for computeReadiness (email-auto-reply m3) — 拍板門檻 20 封 + 95%。
 */
import { describe, it, expect } from "vitest";
import { computeReadiness } from "./autoReplyReadiness";

const d = (classification: string, status: string, edited = false) => ({
  classification,
  status,
  edited,
});

describe("computeReadiness", () => {
  it("counts unchanged / edited / rejected per class", () => {
    const [c] = computeReadiness(
      [
        d("general_info", "sent"),
        d("general_info", "approved"),
        d("general_info", "sent", true),
        d("general_info", "rejected"),
      ],
      {},
    );
    expect(c.classification).toBe("general_info");
    expect(c.sample).toBe(4);
    expect(c.approvedUnchanged).toBe(2);
    expect(c.approvedEdited).toBe(1);
    expect(c.rejected).toBe(1);
    expect(c.unchangedRate).toBe(0.5);
  });

  it("拍板門檻:19 封 100% 不達標,20 封 95% 達標,20 封 94% 不達標", () => {
    const mk = (n: number, unchanged: number) => [
      ...Array.from({ length: unchanged }, () => d("x", "sent")),
      ...Array.from({ length: n - unchanged }, () => d("x", "sent", true)),
    ];
    expect(computeReadiness(mk(19, 19), {})[0].qualified).toBe(false);
    expect(computeReadiness(mk(20, 19), {})[0].qualified).toBe(true); // 95%
    expect(computeReadiness(mk(20, 18), {})[0].qualified).toBe(false); // 90%
  });

  it("sent/failed/approved 都算「核准決定」(failed 是執行結果不是判斷)", () => {
    const [c] = computeReadiness(
      [d("x", "sent"), d("x", "failed"), d("x", "approved")],
      {},
    );
    expect(c.approvedUnchanged).toBe(3);
  });

  it("shadow-only class 也出現(sample 0,給影子數可見性)", () => {
    const out = computeReadiness([], { general_info: 7 });
    expect(out).toHaveLength(1);
    expect(out[0].shadowCount).toBe(7);
    expect(out[0].sample).toBe(0);
    expect(out[0].qualified).toBe(false);
  });

  it("null classification 歸 (unknown);排序 sample 大在前", () => {
    const out = computeReadiness(
      [d("b", "sent"), d("b", "sent"), { classification: null, status: "sent", edited: false }],
      {},
    );
    expect(out[0].classification).toBe("b");
    expect(out[1].classification).toBe("(unknown)");
  });
});
