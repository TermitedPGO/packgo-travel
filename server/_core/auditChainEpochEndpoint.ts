/**
 * auditChainEpochEndpoint — /api/admin/audit-chain-epoch 的可測 handler
 * (audit-chain-repair R6-2;照 catalogRebuildEndpoint 的 factory 範式)。
 *
 * script-token 端點:safe-deploy 在證實所有機器同一新 release 後呼叫,觸發
 * 一次性鏈錨定並回鏈驗證摘要。不在 startup 錨定(rolling window 內舊 release
 * 仍可能寫舊口徑列,污染 post-epoch 段)。
 *
 * 合約:
 *   POST /api/admin/audit-chain-epoch
 *   Headers: Authorization: Bearer <LOCAL_SCRIPT_TOKEN>
 *   Returns: {
 *     ensure: "written" | "exists" | "skipped" | "failed",
 *     verify: { ok, epochStartId, epochCount, legacyRows, anomalyCount },
 *     anchor: { id, rowHash } | null    ← 首錨憑證(repo 外封存核對用)
 *   }
 *   回應零客戶資料 — 只有鏈統計與錨列 id/hash。
 *
 * 為什麼拆 factory:index.ts 的 verifyInternalAuth 是 registerRoutes 閉包內
 * 函式(不可 import);auth 與 auditLog 依賴注入,route/auth/shape 才能純測。
 */
import type { Request, Response } from "express";
import { logger } from "./logger";
import type { ChainVerifyResult } from "./auditLog";

export interface AuditChainEpochDeps {
  /** index.ts 的 verifyInternalAuth 閉包;回 null 代表已回 4xx(短路)。 */
  verifyAuth: (req: Request, res: Response) => Promise<string | null>;
  ensure: () => Promise<"written" | "exists" | "skipped" | "failed">;
  verify: () => Promise<ChainVerifyResult>;
  /** 依 id 取錨列 {id,rowHash};查不到或無 hash 回 null。 */
  getAnchorRow: (id: number) => Promise<{ id: number; rowHash: string } | null>;
}

export interface AuditChainEpochResponse {
  ensure: "written" | "exists" | "skipped" | "failed";
  verify: {
    ok: boolean;
    epochStartId: number | null;
    epochCount: number;
    legacyRows: number;
    anomalyCount: number;
  };
  anchor: { id: number; rowHash: string } | null;
}

export function makeAuditChainEpochHandler(deps: AuditChainEpochDeps) {
  return async function handleAuditChainEpoch(req: Request, res: Response): Promise<void> {
    try {
      const ip = await deps.verifyAuth(req, res);
      if (!ip) return; // verifyAuth 已回 401/403/429
      const ensure = await deps.ensure();
      const v = await deps.verify();
      const anchor = v.epochStartId !== null ? await deps.getAnchorRow(v.epochStartId) : null;
      const body: AuditChainEpochResponse = {
        ensure,
        verify: {
          ok: v.ok,
          epochStartId: v.epochStartId,
          epochCount: v.epochCount,
          legacyRows: v.legacyRows,
          anomalyCount: v.anomalies.length,
        },
        anchor,
      };
      res.json(body);
    } catch (err) {
      logger.error({ err }, "[admin/audit-chain-epoch] error");
      res.status(500).json({ error: (err as Error).message });
    }
  };
}
