/**
 * Vitest cases for the withAutonomousSafety wrapper (module 3.11).
 *
 * Four cases:
 *   1. Success → passes through; notifyOwner NOT called
 *   2. Throw → notifyOwner called with agentName + error message,
 *              and the original error re-throws
 *   3. Throw + notifyOwner ALSO throws → original error still
 *              propagates; stderr writes a "notifyOwner failed" line
 *   4. Throw with context → notification body includes JSON context
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const notifyOwnerSpy = vi.fn();
vi.mock("../../_core/notification", () => ({
  notifyOwner: (...args: unknown[]) => notifyOwnerSpy(...args),
}));

import { withAutonomousSafety } from "./safety";

describe("withAutonomousSafety (module 3.11)", () => {
  beforeEach(() => {
    notifyOwnerSpy.mockReset();
    notifyOwnerSpy.mockResolvedValue(undefined);
  });

  it("(case 1) success → passes through, notifyOwner not called", async () => {
    const fn = vi.fn(async (x: number) => x * 2);
    const wrapped = withAutonomousSafety({ agentName: "test-agent" }, fn);
    const result = await wrapped(21);
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(notifyOwnerSpy).not.toHaveBeenCalled();
  });

  it("(case 2) throw → notifyOwner called, original error re-throws", async () => {
    const wrapped = withAutonomousSafety(
      { agentName: "review" },
      async () => {
        throw new Error("LLM timeout");
      },
    );
    await expect(wrapped()).rejects.toThrow("LLM timeout");
    expect(notifyOwnerSpy).toHaveBeenCalledTimes(1);
    const callArg = notifyOwnerSpy.mock.calls[0][0];
    expect(callArg.title).toContain("review");
    expect(callArg.title).toContain("失敗");
    expect(callArg.content).toContain("LLM timeout");
    expect(callArg.content).toContain("Agent: review");
  });

  it("(case 3) throw + notifyOwner also throws → original error still propagates, stderr logs", async () => {
    notifyOwnerSpy.mockRejectedValueOnce(new Error("SMTP outage"));
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const wrapped = withAutonomousSafety(
      { agentName: "followup" },
      async () => {
        throw new Error("primary failure");
      },
    );

    await expect(wrapped()).rejects.toThrow("primary failure");
    expect(notifyOwnerSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalled();
    expect(stderrSpy.mock.calls[0][0]).toContain("notifyOwner ALSO failed");
    expect(stderrSpy.mock.calls[0][0]).toContain("followup");
    expect(stderrSpy.mock.calls[0][0]).toContain("SMTP outage");

    stderrSpy.mockRestore();
  });

  it("(case 4) throw with context → notification body includes JSON context", async () => {
    const wrapped = withAutonomousSafety(
      {
        agentName: "marketing",
        context: { campaignId: 42, segment: "vip-en" },
      },
      async () => {
        throw new Error("template render failed");
      },
    );
    await expect(wrapped()).rejects.toThrow("template render failed");
    expect(notifyOwnerSpy).toHaveBeenCalledTimes(1);
    const callArg = notifyOwnerSpy.mock.calls[0][0];
    expect(callArg.content).toContain("Context:");
    expect(callArg.content).toContain("campaignId");
    expect(callArg.content).toContain("42");
    expect(callArg.content).toContain("vip-en");
  });

  it("(case 5) wraps signature transparently — multi-arg variadic preserved", async () => {
    const fn = vi.fn(async (a: string, b: number, c: boolean) => `${a}-${b}-${c}`);
    const wrapped = withAutonomousSafety({ agentName: "x" }, fn);
    const result = await wrapped("hi", 7, true);
    expect(result).toBe("hi-7-true");
    expect(fn).toHaveBeenCalledWith("hi", 7, true);
  });

  it("(case 6) Error stack included (truncated to 2000 chars max)", async () => {
    const longStack = "Error: x\n" + "    at frame\n".repeat(500);
    const err = new Error("x");
    err.stack = longStack;
    const wrapped = withAutonomousSafety({ agentName: "review" }, async () => {
      throw err;
    });
    await expect(wrapped()).rejects.toThrow();
    const callArg = notifyOwnerSpy.mock.calls[0][0];
    expect(callArg.content).toContain("Stack:");
    // Find the stack section and assert size cap
    const stackMatch = callArg.content.match(/Stack:\n([\s\S]+)$/);
    expect(stackMatch).toBeTruthy();
    expect(stackMatch![1].length).toBeLessThanOrEqual(2000);
  });
});
