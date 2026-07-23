/**
 * clientBoot —— 1A0a build-marker boot telemetry(plan v4.3 §3.2.9)。
 *
 * 目的:1A0b server-block 的換版硬前置證據 —— Jeff 的 desktop browser 與 iPhone
 * PWA 各上報一筆新 build sha,寫入既有 append-only adminAuditLog(hash chain),
 * 以 audit 列(action="clientBoot.report")逐裝置核實。
 *
 * 邊界:
 * - admin-authenticated(adminProcedure);closed payload(.strict():buildSha
 *   regex + clientKind 二值 enum),拒自由文字/額外欄位/PII。
 * - 去重 = **best-effort**(Codex 7-18 P2-2 誠實降級):select-then-audit 非原子,
 *   併發 mount 可能各寫一列。重複列無害 —— §3.4 換版證據的判準是「每個
 *   clientKind 至少一列新 sha 的 audit 列」,不是恰一列;不宣稱精確去重。
 * - **durable acknowledgement**(Codex 7-18 P2-1):共用 audit() 會吞寫入失敗,
 *   本 router 在回 "reported" 前 exact re-query 證明列已持久化;查不到 → 回
 *   "failed",client 不寫 guard、下次 mount 重試。不改共用 audit 語意。
 * - rate limit:沿 adminProcedure 既有 mutation limiter(trpc.ts)。
 * - 正常 boot 不是 error —— 不走 reportFunnelError(errorFunnel 是 server-internal
 *   高優先錯誤漏斗,冒充會污染告警)。
 */
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { audit } from "../_core/auditLog";
import { getDb } from "../db";
import { adminAuditLog } from "../../drizzle/schema";
import { and, eq, gte, isNotNull, like } from "drizzle-orm";

const BOOT_ACTION = "clientBoot.report";
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export const clientBootRouter = router({
  report: adminProcedure
    .input(
      z
        .object({
          buildSha: z.string().regex(/^[0-9a-f]{7,40}$/),
          clientKind: z.enum(["desktop-browser", "pwa-standalone"]),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      // telemetry 是輔助訊號非財務真值:DB 不可用回 skipped(不偽裝成功寫入,
      // 也不阻塞 admin 頁面)。
      if (!db) return { status: "skipped" as const };

      const since = new Date(Date.now() - DEDUP_WINDOW_MS);
      // durable ack(Codex 7-18 P2-4):audit() 先 insert 再 update previousHash/rowHash,
      // update 失敗會被 auditLog 吞掉。re-query 必須要求 rowHash 非 null —— 只證 row
      // 存在不夠,要證 hash-chain 完成才回 reported;否則回 failed 讓 client 重試。
      const findRow = (requireHash: boolean) =>
        db
          .select({ id: adminAuditLog.id })
          .from(adminAuditLog)
          .where(
            and(
              eq(adminAuditLog.action, BOOT_ACTION),
              eq(adminAuditLog.userId, ctx.user.id),
              gte(adminAuditLog.createdAt, since),
              like(adminAuditLog.changes, `%${input.buildSha}%`),
              like(adminAuditLog.changes, `%${input.clientKind}%`),
              ...(requireHash ? [isNotNull(adminAuditLog.rowHash)] : []),
            ),
          )
          .limit(1);

      // dedup 查既有已完成 hash-chain 的列(requireHash=true)
      const [existing] = await findRow(true);
      if (existing) return { status: "deduped" as const };

      await audit({
        ctx,
        action: BOOT_ACTION,
        targetType: "clientBuild",
        targetId: input.buildSha.slice(0, 7),
        changes: { buildSha: input.buildSha, clientKind: input.clientKind },
      });

      // 證持久化 + hash-chain 完成(rowHash 非 null)才回 reported。
      const [persisted] = await findRow(true);
      if (!persisted) return { status: "failed" as const };
      return { status: "reported" as const };
    }),
});
