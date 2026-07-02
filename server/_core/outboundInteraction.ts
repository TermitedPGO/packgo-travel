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
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { customerProfiles, customerInteractions } from "../../drizzle/schema";
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "outboundInteraction" });

export async function recordOutboundEmailInteraction(args: {
  customerEmail: string;
  body: string;
  /** one-liner for the timeline (e.g. 「回覆:行程比較(你核准)」). */
  summary: string;
  /** who produced the text — human-approved drafts vs pure auto. */
  generatedBy: "human" | "ai_auto" | "ai_draft_human_approved";
}): Promise<{ recorded: boolean }> {
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

    await db.insert(customerInteractions).values({
      customerProfileId: profile.id,
      channel: "email",
      direction: "outbound",
      content: args.body.slice(0, 10_000),
      contentSummary: args.summary.slice(0, 500),
      generatedBy: args.generatedBy,
      agentName: "inquiry",
    });
    return { recorded: true };
  } catch (err) {
    log.warn(
      { err, customerEmail: args.customerEmail },
      "[outboundInteraction] record failed (non-fatal — email already sent)",
    );
    return { recorded: false };
  }
}
