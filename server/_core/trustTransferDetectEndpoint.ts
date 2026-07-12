/**
 * trustTransferDetectEndpoint — /api/admin/trust-transfer-detect 的可測 handler。
 *
 * B1.1(Codex 6.5 P0.1,2026-07-13):兩個寫入模式 fail-closed。
 *   - mode:"dry_run"        → 只算不寫的偵測報表(唯一放行)。
 *   - mode:"confirm"        → 403(回填閉環暫停,等矩陣)。
 *   - mode:"manual_backfill"→ 403(逐筆回填暫停,等矩陣)。
 *   - 其他                  → 400(mode 非法)。
 *
 * 端點層 403 是防禦縱深(除了服務內 isTrustTransferWriteApproved 機械閘之外),
 * 讓「打錯/舊腳本仍打 confirm」在 HTTP 層就被擋、留下明確訊息。
 *
 * 為什麼拆 factory:index.ts 的 verifyInternalAuth 是 registerRoutes 閉包內的函式
 * (不可 import),把 auth 與 runDetection 依賴注入進來,紅綠(壞 token 短路、寫模式
 * 403、dry_run 放行)才能純測,不用起整個 express app。本檔無 raw SQL。
 */

import type { Request, Response } from "express";
import { logger } from "./logger";
import type { TransferDetectionReport } from "../services/trustTransferDetection";

export const TRUST_TRANSFER_WRITE_BLOCKED_MESSAGE =
  "blocked: trust write modes (confirm / manual_backfill) are frozen until the CPA " +
  "recognition matrix and attorney withdrawal matrix are approved — only dry_run is permitted";

export interface TrustTransferDetectHandlerDeps {
  /**
   * token/IP/rate-limit 驗證(index.ts 的 verifyInternalAuth,LOCAL_SCRIPT_TOKEN)。
   * 失敗時它自己已送出 401/403/429/503,回 null → handler 直接短路。
   */
  verifyAuth: (req: Request, res: Response) => Promise<string | null>;
  /** dry-run 偵測(注入以便純測;index.ts 註冊時給 dynamic import 版,硬帶 dryRun:true)。 */
  runDetection: () => Promise<TransferDetectionReport>;
}

/** 組出 express handler(index.ts 註冊用;測試注入假 deps)。 */
export function makeTrustTransferDetectHandler(deps: TrustTransferDetectHandlerDeps) {
  return async (req: Request, res: Response) => {
    try {
      const ip = await deps.verifyAuth(req, res);
      if (!ip) return; // 401/403/429/503 已由 verifyAuth 送出

      const mode = (req.body || {}).mode;
      if (mode !== "dry_run" && mode !== "confirm" && mode !== "manual_backfill") {
        return res
          .status(400)
          .json({ error: "mode must be 'dry_run' | 'confirm' | 'manual_backfill'" });
      }
      // B1.1 fail-closed:兩個寫入模式一律 403,只放行 dry_run。
      if (mode === "confirm" || mode === "manual_backfill") {
        logger.warn({ mode, ip }, "[admin/trust-transfer-detect] write mode blocked (fail-closed)");
        return res.status(403).json({ error: TRUST_TRANSFER_WRITE_BLOCKED_MESSAGE });
      }
      const report = await deps.runDetection();
      return res.json(report);
    } catch (err) {
      logger.error({ err }, "[admin/trust-transfer-detect] error");
      return res.status(500).json({ error: (err as Error).message });
    }
  };
}
