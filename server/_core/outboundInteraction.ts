/**
 * recordOutboundEmailInteraction — 把「我方回覆」寫進客戶往來時間軸。
 *
 * 起因(2026-06-12 Jeff 流程確認):客戶頁的來信往來只看得到客人來信,
 * 看不到我們回了什麼 — 兩條人工核准寄信路(審核卡核准 sendAdminInquiryReply、
 * 編輯並回覆 sendEscalationReply)都沒寫 customerInteractions;只有 pipeline
 * 的 auto_replied 路有寫。這個 helper 補齊:寄出成功後 best-effort 記一筆
 * outbound,讓客戶/訪客頁的對話記錄雙向完整。
 *
 * Failure semantics: NEVER throws — the email is already sent; a bookkeeping
 * failure must not turn a successful send into an error. Logs and returns.
 */
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "../db";
import { customerProfiles, customerInteractions } from "../../drizzle/schema";
import { createChildLogger } from "./logger";
import { reportFunnelError } from "./errorFunnel";

const log = createChildLogger({ module: "outboundInteraction" });

export async function recordOutboundEmailInteraction(args: {
  customerEmail: string;
  body: string;
  /** one-liner for the timeline (e.g. 「回覆:行程比較(你核准)」). */
  summary: string;
  /** who produced the text — human-approved drafts vs pure auto. */
  generatedBy: "human" | "ai_auto" | "ai_draft_human_approved";
  /**
   * F5(e2e-sweep-20260705 §F5):外寄回信沿同 gmailThreadId 既有歸屬繼承
   * customOrderId,與 inbound 規則①對稱 —— 一封回信不該和它回的那封 inbound 分屬
   * 不同 order 狀態。給了才查/繼承;thread 無歸屬、或沒給 threadId → customOrderId
   * 留 NULL(絕不猜)。
   */
  gmailThreadId?: string | null;
}): Promise<{ recorded: boolean; interactionId?: number; customerProfileId?: number; customOrderId?: number | null }> {
  try {
    const db = await getDb();
    if (!db) return { recorded: false };
    const email = args.customerEmail.trim().toLowerCase();
    if (!email) return { recorded: false };

    const [profile] = await db
      .select({ id: customerProfiles.id })
      .from(customerProfiles)
      .where(eq(customerProfiles.email, email))
      .limit(1);
    if (profile) {
      // 0109:被併走的卡 → 檔到合併後的最終卡上。
      const { followMergePointer } = await import("./mergedProfile");
      profile.id = await followMergePointer(db, profile.id);
    }
    if (!profile) {
      // No profile yet (e.g. website-form inquiry from an address that never
      // hit the gmail pipeline) — nothing to attach to; honest skip.
      return { recorded: false };
    }

    // F5:同 thread 既有歸屬繼承(rule ① 對稱)。ORDER BY id ASC 取最早掛的那筆,
    // 與 gmailPipeline resolveInboundInteractionOrderId 的「first wins」tiebreak 一致。
    const gmailThreadId = args.gmailThreadId?.trim() || null;
    let inheritedOrderId: number | null = null;
    if (gmailThreadId) {
      const [sibling] = await db
        .select({ customOrderId: customerInteractions.customOrderId })
        .from(customerInteractions)
        .where(
          and(
            eq(customerInteractions.customerProfileId, profile.id),
            eq(customerInteractions.gmailThreadId, gmailThreadId),
            isNotNull(customerInteractions.customOrderId),
          ),
        )
        .orderBy(asc(customerInteractions.id))
        .limit(1);
      inheritedOrderId = sibling?.customOrderId ?? null;
    }

    const result = await db.insert(customerInteractions).values({
      customerProfileId: profile.id,
      channel: "email",
      direction: "outbound",
      content: args.body.slice(0, 10_000),
      contentSummary: args.summary.slice(0, 500),
      generatedBy: args.generatedBy,
      agentName: "inquiry",
      // 記上 threadId 讓後續同 thread 回信也能繼承;歸屬沿用該 thread 既有 order。
      gmailThreadId: gmailThreadId ?? undefined,
      customOrderId: inheritedOrderId ?? undefined,
    });
    // ResultSetHeader.insertId — same accessor pattern as server/db.ts /
    // auditLog.ts. Returned so callers (e.g. escalationBox promise
    // extraction) can attach to *this* row instead of re-querying "latest
    // interaction for this profile", which races under concurrent writes.
    const interactionId = Number((result as unknown as [{ insertId: number }])[0]?.insertId ?? 0) || undefined;
    return { recorded: true, interactionId, customerProfileId: profile.id, customOrderId: inheritedOrderId };
  } catch (err) {
    log.warn(
      { err, customerEmail: args.customerEmail },
      "[outboundInteraction] record failed (non-fatal — email already sent)",
    );
    reportFunnelError({ source: "fail-open:outboundInteraction:recordFailed", err, context: { customerEmail: args.customerEmail } }).catch(() => {});
    return { recorded: false };
  }
}
