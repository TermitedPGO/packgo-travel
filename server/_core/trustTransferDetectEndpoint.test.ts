/**
 * trustTransferDetectEndpoint 紅綠測試 — B1.1(Codex 6.5 P0.1)。
 *
 * 釘死:寫入模式(confirm / manual_backfill)一律 403 且不呼叫 runDetection;
 * 只有 dry_run 放行回偵測報表;mode 非法 400;verifyAuth 失敗短路不再送 response。
 * 純測 factory(注入假 verifyAuth / runDetection),不起 express。
 */
import { describe, it, expect, vi } from "vitest";
import {
  makeTrustTransferDetectHandler,
  TRUST_TRANSFER_WRITE_BLOCKED_MESSAGE,
} from "./trustTransferDetectEndpoint";

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => {
    res.statusCode = c;
    return res;
  });
  res.json = vi.fn((b: unknown) => {
    res.body = b;
    return res;
  });
  return res;
}

const OK_REPORT = {
  eligibleRows: 0,
  scannedTxns: 0,
  pairsFound: 0,
  backfills: [],
  suggestions: [],
  backfilled: 0,
  overdueCount: 0,
  overdueTotal: 0,
  reminderPosted: false,
};

const okAuth = vi.fn(async () => "127.0.0.1");

describe("makeTrustTransferDetectHandler — 寫模式 403 / dry_run 放行", () => {
  it("mode=confirm → 403,不呼叫 runDetection", async () => {
    const runDetection = vi.fn(async () => OK_REPORT);
    const handler = makeTrustTransferDetectHandler({ verifyAuth: okAuth, runDetection });
    const res = mockRes();
    await handler({ body: { mode: "confirm" } } as any, res as any);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe(TRUST_TRANSFER_WRITE_BLOCKED_MESSAGE);
    expect(runDetection).not.toHaveBeenCalled();
  });

  it("mode=manual_backfill → 403,不呼叫 runDetection", async () => {
    const runDetection = vi.fn(async () => OK_REPORT);
    const handler = makeTrustTransferDetectHandler({ verifyAuth: okAuth, runDetection });
    const res = mockRes();
    await handler(
      { body: { mode: "manual_backfill", deferredIds: [1], bankTransactionId: 9 } } as any,
      res as any,
    );
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe(TRUST_TRANSFER_WRITE_BLOCKED_MESSAGE);
    expect(runDetection).not.toHaveBeenCalled();
  });

  it("mode=dry_run → 200 + 偵測報表(唯一放行)", async () => {
    const runDetection = vi.fn(async () => OK_REPORT);
    const handler = makeTrustTransferDetectHandler({ verifyAuth: okAuth, runDetection });
    const res = mockRes();
    await handler({ body: { mode: "dry_run" } } as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(OK_REPORT);
    expect(runDetection).toHaveBeenCalledTimes(1);
  });

  it("mode 非法 → 400,不呼叫 runDetection", async () => {
    const runDetection = vi.fn(async () => OK_REPORT);
    const handler = makeTrustTransferDetectHandler({ verifyAuth: okAuth, runDetection });
    const res = mockRes();
    await handler({ body: { mode: "bogus" } } as any, res as any);
    expect(res.statusCode).toBe(400);
    expect(runDetection).not.toHaveBeenCalled();
  });

  it("verifyAuth 回 null → 短路:不呼叫 runDetection、不再送 response", async () => {
    const failAuth = vi.fn(async () => null);
    const runDetection = vi.fn(async () => OK_REPORT);
    const handler = makeTrustTransferDetectHandler({ verifyAuth: failAuth, runDetection });
    const res = mockRes();
    await handler({ body: { mode: "dry_run" } } as any, res as any);
    expect(runDetection).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
