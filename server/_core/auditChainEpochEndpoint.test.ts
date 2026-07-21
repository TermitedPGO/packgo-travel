/**
 * auditChainEpochEndpoint 純測(audit-chain-repair R6-2 P2-2)。
 * auth 短路、成功形狀、anchor null 分支、內部錯誤 500 —— 不起 express app。
 */
import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { makeAuditChainEpochHandler } from "./auditChainEpochEndpoint";
import type { ChainVerifyResult } from "./auditLog";

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

const VERIFY_GREEN: ChainVerifyResult = {
  totalRows: 340, hashedRows: 3, ungatedRows: 0, legacyRows: 337,
  epochStartId: 1000, epochCount: 1, anomalies: [], ok: true,
};

describe("auditChainEpochEndpoint", () => {
  it("auth 失敗(verifyAuth 回 null)→ 短路,不碰 ensure/verify", async () => {
    const ensure = vi.fn();
    const handler = makeAuditChainEpochHandler({
      verifyAuth: async () => null,
      ensure,
      verify: vi.fn(),
      getAnchorRow: vi.fn(),
    });
    const res = makeRes();
    await handler({} as Request, res);
    expect(ensure).not.toHaveBeenCalled();
    expect(res.body).toBeUndefined();
  });
  it("成功 → 回 {ensure, verify 摘要, anchor} 完整形狀", async () => {
    const handler = makeAuditChainEpochHandler({
      verifyAuth: async () => "1.2.3.4",
      ensure: async () => "written",
      verify: async () => VERIFY_GREEN,
      getAnchorRow: async (id) => ({ id, rowHash: "a".repeat(64) }),
    });
    const res = makeRes();
    await handler({} as Request, res);
    expect(res.body).toEqual({
      ensure: "written",
      verify: { ok: true, epochStartId: 1000, epochCount: 1, legacyRows: 337, anomalyCount: 0 },
      anchor: { id: 1000, rowHash: "a".repeat(64) },
    });
  });
  it("無錨(epochStartId null)→ anchor null,不查錨列", async () => {
    const getAnchorRow = vi.fn();
    const handler = makeAuditChainEpochHandler({
      verifyAuth: async () => "1.2.3.4",
      ensure: async () => "failed",
      verify: async () => ({ ...VERIFY_GREEN, ok: false, epochStartId: null, epochCount: 0, anomalies: [{ rowId: 1, kind: "missing-hash" }] }),
      getAnchorRow,
    });
    const res = makeRes();
    await handler({} as Request, res);
    expect(getAnchorRow).not.toHaveBeenCalled();
    expect((res.body as { anchor: unknown }).anchor).toBeNull();
    expect((res.body as { verify: { anomalyCount: number } }).verify.anomalyCount).toBe(1);
  });
  it("內部錯誤 → 500 + error message", async () => {
    const handler = makeAuditChainEpochHandler({
      verifyAuth: async () => "1.2.3.4",
      ensure: async () => {
        throw new Error("db exploded");
      },
      verify: vi.fn(),
      getAnchorRow: vi.fn(),
    });
    const res = makeRes();
    await handler({} as Request, res);
    expect(res.statusCode).toBe(500);
    expect((res.body as { error: string }).error).toBe("db exploded");
  });
});
