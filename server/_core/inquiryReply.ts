/**
 * inquiryReply — shared admin-reply send + thread write-back (P1-a/P1-d).
 *
 * The single helper BOTH callers funnel an admin reply through:
 *   1. server/routers/inquiries.ts `addMessage` — when an admin types a reply
 *      directly in the Inbox.
 *   2. server/agents/autonomous/inquiryReplyExecutor.ts — when an admin
 *      approves an InquiryAgent draft in the 指揮中心 審核箱.
 *
 * Both paths must do EXACTLY the same thing, so the logic lives here once
 * instead of being copy-pasted (and drifting) in two places:
 *   - persist the reply as an `admin` message on the thread (so the customer
 *     sees it on the website + it shows in the conversation history),
 *   - email the customer the branded reply (best-effort),
 *   - advance the thread to "replied" ONLY on a successful send.
 *
 * Contract (mirrors the original addMessage semantics verbatim):
 *   - NEVER throws for an expected failure — a bounced email or a missing
 *     inquiry resolves to `{ emailSent: false, ... }`. (The executor relies on
 *     this: ApprovalExecutor must not throw for expected failures.)
 *   - The message is persisted BEFORE the send, so a send failure still leaves
 *     the reply on record (identical to the pre-extraction behavior).
 *   - A failed send does NOT advance status — the Inbox keeps showing it as
 *     needing attention.
 *
 * Lives in server/_core/* so it can be imported by both the router layer and
 * the autonomous agent layer without a cross-domain dependency. Uses the
 * module `logger` (NOT console.*) per CLAUDE.md §4.2.
 */

import * as db from "../db";
import { createChildLogger } from "./logger";
import type { ReplyAttachmentRef } from "./replyAttachments";
import { reportFunnelError } from "./errorFunnel";

const log = createChildLogger({ module: "inquiryReply" });

export interface SendAdminInquiryReplyInput {
  /** Thread to reply on. */
  inquiryId: number;
  /** The admin's (or approved draft's) reply body. */
  body: string;
  /**
   * users.id to stamp on the persisted message. Optional: the 審核箱 executor
   * may pass the approving admin's id; null is acceptable (schema allows it).
   */
  senderId?: number | null;
  /**
   * 2026-06-15 reply-attachments — optional R2 attachment refs. Resolved
   * through the SAME shared splitter as the escalation path (inline vs
   * >25MB→link) so both send paths stay consistent (design.md). The inquiry
   * Inbox composer UI lands in a later PR; the param exists now so the two
   * paths don't drift.
   */
  attachments?: ReplyAttachmentRef[];
}

export interface SendAdminInquiryReplyResult {
  /** True only when the customer email actually went out. */
  emailSent: boolean;
  /** The persisted inquiryMessages row id, or undefined if the thread/db was missing. */
  messageId?: number;
  /** Set when the helper could not proceed (inquiry/db missing); never thrown. */
  errorMessage?: string;
}

/**
 * Persist an admin reply on a thread + email the customer + advance status.
 *
 * Returns a result object; never throws for expected failures (missing
 * inquiry, db unavailable, email bounce). An unexpected programming error
 * (e.g. db.createInquiryMessage rejecting) WILL propagate — callers that must
 * never throw (the executor) wrap this in their own try/catch as the spine
 * router does, but in practice the persisted-first ordering means the common
 * failure (email send) is already swallowed here.
 */
export async function sendAdminInquiryReply(
  input: SendAdminInquiryReplyInput,
): Promise<SendAdminInquiryReplyResult> {
  const inquiry = await db.getInquiryById(input.inquiryId);
  if (!inquiry) {
    log.warn({ inquiryId: input.inquiryId }, "[inquiryReply] inquiry not found");
    return { emailSent: false, errorMessage: "inquiry not found" };
  }

  // 1. Persist the reply as an admin message FIRST, so a later send failure
  //    still leaves the reply on record (matches pre-extraction behavior).
  const created = await db.createInquiryMessage({
    inquiryId: input.inquiryId,
    senderId: input.senderId ?? null,
    senderType: "admin",
    message: input.body,
  });

  // 2. Email the customer the branded reply. Best-effort: a bounce must NOT
  //    fail the operation (the reply is already persisted above).
  let emailSent = false;
  if (inquiry.customerEmail) {
    try {
      const { sendInquiryReply } = await import("../emailService");
      // Resolve attachments through the shared splitter (inline vs link),
      // identical to the escalation path.
      let emailBody = input.body;
      let inlineAttachments:
        | { filename: string; content: Buffer; contentType: string }[]
        | undefined;
      if (input.attachments && input.attachments.length > 0) {
        const {
          resolveReplyAttachments,
          appendDownloadLinksToBody,
          DOWNLOAD_LINK_TTL_SECONDS,
        } = await import("./replyAttachments");
        const { storageGetBytes, getSecureDocumentUrl } = await import("../storage");
        const resolved = await resolveReplyAttachments(input.attachments, {
          getBytes: (key) => storageGetBytes(key),
          makeLink: (key) => getSecureDocumentUrl(key, DOWNLOAD_LINK_TTL_SECONDS),
        });
        inlineAttachments =
          resolved.inline.length > 0
            ? resolved.inline.map((a) => ({
                filename: a.filename,
                content: a.content,
                contentType: a.mimeType,
              }))
            : undefined;
        emailBody = appendDownloadLinksToBody(input.body, resolved.links);
      }
      emailSent = await sendInquiryReply({
        to: inquiry.customerEmail,
        customerName: inquiry.customerName,
        subject: inquiry.subject,
        body: emailBody,
        inquiryId: input.inquiryId,
        attachments: inlineAttachments,
      });
    } catch (err) {
      log.error(
        { err, inquiryId: input.inquiryId },
        "[inquiryReply] sendInquiryReply threw",
      );
      reportFunnelError({ source: "fail-open:inquiryReply:sendInquiryReply", err, context: { inquiryId: input.inquiryId } }).catch(() => {});
    }
  }

  // 2.5 客戶往來時間軸補「我方回覆」(2026-06-12 流程閉環;best-effort,
  //     絕不讓記帳失敗污染已成功的寄送結果)。
  if (emailSent && inquiry.customerEmail) {
    const { recordOutboundEmailInteraction } = await import(
      "./outboundInteraction"
    );
    await recordOutboundEmailInteraction({
      customerEmail: inquiry.customerEmail,
      body: input.body,
      summary: `回覆:${inquiry.subject || "(無主旨)"}(你核准寄出)`,
      generatedBy: "ai_draft_human_approved",
    });
  }

  // 3. On a successful send, advance the thread to "replied" so the Inbox
  //    reflects state. Best-effort — never block on it.
  if (emailSent && inquiry.status !== "replied") {
    try {
      await db.updateInquiry(input.inquiryId, { status: "replied" });
    } catch (err) {
      log.error(
        { err, inquiryId: input.inquiryId },
        "[inquiryReply] status update failed",
      );
    }
  }

  // 4. Fire-and-forget: extract customer preferences from the conversation.
  if (inquiry.customerEmail) {
    resolveAndExtract(inquiry.customerEmail).catch((err) =>
      log.warn({ err }, "preference extraction background failed"),
    );
  }

  return { emailSent, messageId: created?.id };
}

async function resolveAndExtract(email: string): Promise<void> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return;
  const { customerProfiles } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await d
    .select({ id: customerProfiles.id })
    .from(customerProfiles)
    .where(eq(customerProfiles.email, email))
    .limit(1);
  if (!row) return;
  // 0109:被併走的卡 → 偏好萃取跑在合併後的最終卡上。
  const { followMergePointer } = await import("./mergedProfile");
  const canonicalId = await followMergePointer(d, row.id);
  const { extractAfterReply } = await import("./customerPreferenceExtractor");
  await extractAfterReply(canonicalId);
}
