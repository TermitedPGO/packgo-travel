/**
 * followupDraftOnDemand — produce ONE follow-up draft for a specific customer,
 * on demand, when Jeff asks the customer-page chat to "回信 / 跟進" this person.
 *
 * Mirrors runFollowupDraftScan's per-customer chain (read real conversation →
 * professional drafter → observation row in the 待審草稿 panel) but for a single,
 * explicitly chosen customer with NO staleness gate (Jeff asked, so we draft).
 * Reuses followupDraftProducer's pure helpers + the followupDrafter, so the
 * voice / grounding / A-B arm stay identical to the nightly scan. AI never sends;
 * the draft lands as a card Jeff reviews + one-click sends via escalationReply.
 */
import { createChildLogger } from "../../_core/logger";
import type { Db } from "../../_core/followupScan";
import { stripMarkdownForEmail } from "../../_core/plainTextReply";
import { draftFollowupEnforcingLanguage, type FollowupDrafterInput } from "./followupDrafter";
import {
  buildConversationExcerpt,
  detectDraftSkip,
  pickGmailThreadId,
  pickLatestInboundClassification,
  detectCustomerLanguage,
  buildFollowupDraftRow,
  pickFollowupVariant,
  sanitizeFollowupDraftBody,
  applyFollowupHonestyGate,
  selectReattachDocs,
  FOLLOWUP_DRAFT_AGENT,
  type InteractionDetailRow,
  type DraftSkipReason,
} from "./followupDraftProducer";
import { detectAttachmentClaim } from "./followupDraftHonesty";

const log = createChildLogger({ module: "followupDraftOnDemand" });
const DAY_MS = 24 * 60 * 60 * 1000;
// 批十二-1:re-attach 只撈這麼久內剛產生的 generated 文件(避免掛上舊 PDF)。
const REATTACH_WINDOW_MS = 30 * 60 * 1000;

export type OnDemandDraftResult =
  // subject/body echoed back so the ops chat can quote the draft IN its reply
  // (Jeff, 2026-07-02:「給我草稿」時 AI 只回「在待審區」不算直接回應)。
  | { status: "drafted"; daysSince: number; subject: string; body: string }
  | {
      status: "skipped";
      reason:
        | DraftSkipReason
        | "no_email"
        | "no_history"
        | "empty_draft"
        | "unclean_draft"
        // 誠實度 gate:草稿吹牛(無證據的「已寄」宣稱)或抬頭喊錯人 → 不落卡。
        | "dishonest_draft";
    };

export async function produceFollowupDraftForProfile(
  db: Db,
  profileId: number,
  /** Jeff 在聊天口述的信件內容(「寫信說星期四領事館取件」);有值時草稿必須照做。 */
  jeffInstruction?: string,
): Promise<OnDemandDraftResult> {
  const { agentMessages, customerInteractions, customerProfiles, customerDocuments } = await import(
    "../../../drizzle/schema"
  );
  const { and, eq, desc, ne } = await import("drizzle-orm");

  const prof = (
    await db
      .select({ email: customerProfiles.email })
      .from(customerProfiles)
      .where(eq(customerProfiles.id, profileId))
      .limit(1)
  )[0] as { email: string | null } | undefined;
  const email = prof?.email?.trim();
  if (!email) return { status: "skipped", reason: "no_email" };

  const rows = (await db
    .select({
      direction: customerInteractions.direction,
      content: customerInteractions.content,
      contentSummary: customerInteractions.contentSummary,
      classification: customerInteractions.classification,
      gmailThreadId: customerInteractions.gmailThreadId,
      createdAt: customerInteractions.createdAt,
    })
    .from(customerInteractions)
    .where(
      and(
        eq(customerInteractions.customerProfileId, profileId),
        eq(customerInteractions.channel, "email"),
      ),
    )
    .orderBy(desc(customerInteractions.createdAt))
    .limit(20)) as Array<InteractionDetailRow & { createdAt: Date }>;

  if (rows.length === 0) return { status: "skipped", reason: "no_history" };

  const gmailThreadId = pickGmailThreadId(rows);
  const excerpt = buildConversationExcerpt(rows);
  const skip = detectDraftSkip({
    gmailThreadId,
    lastInboundClassification: pickLatestInboundClassification(rows),
    conversationLen: excerpt.length,
  });
  if (skip) return { status: "skipped", reason: skip };

  const daysSince = Math.max(
    0,
    Math.floor((Date.now() - new Date(rows[0].createdAt).getTime()) / DAY_MS),
  );
  const promptVariant = pickFollowupVariant();
  const drafterInput: FollowupDrafterInput = {
    daysSince,
    language: detectCustomerLanguage(rows),
    conversationExcerpt: excerpt,
    promptVariant,
    jeffInstruction: jeffInstruction?.trim() || null,
  };

  let draft;
  try {
    draft = await draftFollowupEnforcingLanguage(drafterInput);
  } catch (e) {
    log.warn({ err: e, profileId }, "[followupDraftOnDemand] draftFollowup failed");
    return { status: "skipped", reason: "empty_draft" };
  }
  // Same wash as the nightly scan: the stored body is what the one-click send
  // chain sends verbatim, so it must already be clean (no markdown, no em dash).
  // Pass the detected language so en drafts skip the 你/您 rules.
  const cleaned = sanitizeFollowupDraftBody(draft.body, drafterInput.language);
  if (!cleaned.body) return { status: "skipped", reason: "empty_draft" };
  if (cleaned.blocked) {
    log.error(
      { profileId, violations: cleaned.violations },
      "[followupDraftOnDemand] draft still dirty after wash, not storing",
    );
    return { status: "skipped", reason: "unclean_draft" };
  }
  if (cleaned.violations.length > 0) {
    log.warn(
      { profileId, violations: cleaned.violations },
      "[followupDraftOnDemand] draft tripped hard-rule guard",
    );
  }

  // 批十二-1 (P0 根因修):草稿若聲稱附上檔案,撈這位客人最近(REATTACH_WINDOW_MS
  // 內)產生、還掛在 reply-attachments/ 的 generated PDF,依 kind 取最新一份掛進新草稿。
  // 這修好「先出文件→另一輪叫草稿寄」新草稿沒繼承附件的根因(E2E F3)。撈不到就留空
  // → 下方誠實閘會擋掉「說附上卻沒附」的草稿(寧可沒卡)。best-effort:失敗不影響其餘。
  // 粒度註:只查這個 profileId(非合併 scopeIds),萬一文件掛在被合併掉的 profile 上會
  // 漏撈 —— 此時退回誠實閘擋下空寄、由 Jeff 手動掛,安全降級(review D2)。
  let replyAttachments: Array<{ key: string; filename: string }> = [];
  if (detectAttachmentClaim(cleaned.body)) {
    try {
      const docRows = (await db
        .select({
          r2Url: customerDocuments.r2Url,
          fileName: customerDocuments.fileName,
          createdAt: customerDocuments.uploadedAt, // customerDocuments 的時戳欄叫 uploadedAt
        })
        .from(customerDocuments)
        .where(
          and(
            eq(customerDocuments.customerProfileId, profileId),
            eq(customerDocuments.uploadedBy, "generated"),
            eq(customerDocuments.isCurrent, true),
          ),
        )
        .orderBy(desc(customerDocuments.uploadedAt))
        .limit(10)) as Array<{
        r2Url: string | null;
        fileName: string | null;
        createdAt: Date | string | null;
      }>;
      replyAttachments = selectReattachDocs(docRows, Date.now(), REATTACH_WINDOW_MS);
    } catch (e) {
      log.warn({ err: e, profileId }, "[followupDraftOnDemand] re-attach lookup failed (non-fatal)");
    }
  }

  // 誠實度 gate (same shared path as the nightly scan): unverified 已寄 claims
  // or a greeting to someone not in this conversation → no card (寧可沒卡).
  // 附件 gate:文案說附上檔案但 re-attach 沒撈到 PDF(hasAttachment=false)→ 一樣不落卡。
  const honesty = await applyFollowupHonestyGate(db, {
    profileId,
    profileEmail: email,
    rowsNewestFirst: rows,
    draftBody: cleaned.body,
    hasAttachment: replyAttachments.length > 0,
  });
  if (!honesty.ok) return { status: "skipped", reason: "dishonest_draft" };

  const finalSubject = stripMarkdownForEmail(draft.subject) || `跟進:${honesty.counterpartyEmail}`;
  // 重複觸發「給我草稿」不再疊卡(2026-07-06 duplicate cards 實案):INSERT 新草稿 → 退場
  // 這位客人「其他」未讀 followup_draft 卡(排除剛插入的這張)。插入優先確保任何 DB 失敗
  // 都不會讓客人一張草稿都沒有(舊卡還在,呼叫端會提示重試);拿不到 insertId 就不退場
  // (寧可留一張舊的重複,也不誤退新卡)。所有 skip/誠實/清洗 gate 都已在上方通過。
  const inserted = (await db.insert(agentMessages).values(
    buildFollowupDraftRow({
      profileId,
      // The thread's real counterparty (newest inbound From) — display + To:
      // finally agree for merged cards (leslie→Emerald).
      customerEmail: honesty.counterpartyEmail,
      daysSince,
      gmailThreadId: gmailThreadId as string, // non-null past detectDraftSkip
      subject: finalSubject,
      draftBody: cleaned.body,
      promptVariant,
      hasQuoteEvidence: honesty.hasQuoteEvidence,
      // 批十二-1:把剛產生的 PDF 一起寫進草稿 context,一鍵寄出時附件同行。
      replyAttachments,
    }),
  )) as unknown as Array<{ insertId?: number }>;
  const newId = Array.isArray(inserted) ? inserted[0]?.insertId : undefined;
  if (newId != null) {
    await db
      .update(agentMessages)
      .set({ readByJeff: 1 })
      .where(
        and(
          eq(agentMessages.agentName, FOLLOWUP_DRAFT_AGENT),
          eq(agentMessages.relatedCustomerProfileId, profileId),
          eq(agentMessages.readByJeff, 0),
          ne(agentMessages.id, newId),
        ),
      );
  }
  log.info({ profileId, daysSince }, "[followupDraftOnDemand] drafted on demand");
  return { status: "drafted", daysSince, subject: finalSubject, body: cleaned.body };
}
