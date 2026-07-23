/**
 * spamBox — 疑似垃圾匣 domain helper(批1 m3a,design.md §2 rule 4).
 *
 * The InquiryAgent classifies some inbound email as "spam"; gmailPipeline
 * stores every such row in customerInteractions (nothing is ever deleted)
 * but until now Jeff had no surface to review them. This module is that
 * surface's spine:
 *
 *   listSpamInteractions  — newest-first list of spam-classified inbound rows
 *                           (with the profile email + Jeff's verdict)
 *   rescueSpamInteraction — 「其實是客人,救回」: creates a REAL inquiry from
 *                           the stored content, then runs the InquiryAgent →
 *                           cs approval task — the exact same review path a
 *                           normal inbound takes (Jeff 2026-06-09 拍板).
 *                           Verdict is set to 'rescued' BEFORE the LLM call so
 *                           a crashed agent can never cause a double inquiry;
 *                           an agent failure is reported honestly, the inquiry
 *                           still exists in the customer's inbox.
 *   confirmSpamInteraction — 「確定是垃圾」: verdict = confirmed_spam. The row
 *                           is muted, NEVER deleted.
 */
import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../db";
import {
  customerInteractions,
  customerProfiles,
} from "../../drizzle/schema";
import { audit } from "./auditLog";
import { createChildLogger } from "./logger";
import type { ApprovalAuditCtx } from "./approvalTasks";

const log = createChildLogger({ module: "spamBox" });

export interface SpamBoxRow {
  id: number;
  customerProfileId: number;
  /** profile email when known (spam rows come from Gmail, usually present). */
  email: string | null;
  channel: string;
  /** agent's one-line summary of the message (intent). */
  summary: string | null;
  verdict: "rescued" | "confirmed_spam" | null;
  createdAt: Date;
}

/** Spam-classified inbound rows, newest first. Includes decided rows so the
 *  匣 always shows what happened (muted ones render dimmed, never vanish). */
export async function listSpamInteractions(
  limit = 50,
): Promise<SpamBoxRow[]> {
  const db = await getDb();
  if (!db) {
    log.warn("[spamBox] listSpamInteractions: database not available");
    return [];
  }
  const rows = await db
    .select({
      id: customerInteractions.id,
      customerProfileId: customerInteractions.customerProfileId,
      email: customerProfiles.email,
      channel: customerInteractions.channel,
      summary: customerInteractions.contentSummary,
      verdict: customerInteractions.spamVerdict,
      createdAt: customerInteractions.createdAt,
    })
    .from(customerInteractions)
    .leftJoin(
      customerProfiles,
      eq(customerProfiles.id, customerInteractions.customerProfileId),
    )
    .where(
      and(
        eq(customerInteractions.classification, "spam"),
        eq(customerInteractions.direction, "inbound"),
      ),
    )
    .orderBy(desc(customerInteractions.createdAt))
    .limit(limit);
  return rows as SpamBoxRow[];
}

export interface RescueResult {
  inquiryId: number;
  /** cs approval task id, or null when the agent draft failed. */
  taskId: number | null;
  riskLevel?: string;
  /** honest failure detail when the LLM/producer step failed. */
  agentError?: string;
}

/**
 * Codex 14:07 P1-3 — rebuild attachment EXISTENCE evidence from a stored
 * interaction content blob for the rescue replay. gmailPipeline appends a
 * 【附件】 summary block ("N. filename (kind, size, status)" per line) to the
 * interaction content at filing time; the parsed text itself is never stored.
 * Each summary line becomes a not_processed sentinel: the replayed agent run
 * can't read the attachment, so the reply gate must escalate — never draft
 * as if the attachments were read (or absent). Pure; exported for tests.
 */
export function rebuildAttachmentSentinelsFromContent(content: string): Array<{
  filename: string;
  kind: string;
  sizeBytes: number;
  text: string;
  parseStatus: string;
  parseError: string;
}> {
  const block = content.match(/【附件】\n([\s\S]*)$/);
  if (!block) return [];
  const out: Array<{
    filename: string;
    kind: string;
    sizeBytes: number;
    text: string;
    parseStatus: string;
    parseError: string;
  }> = [];
  for (const line of block[1].split("\n")) {
    // "1. trip.pdf (pdf, 141KB, ok)" — filename may itself contain spaces or
    // parens; anchor on the LAST parenthetical (kind, size, status).
    const m = line.match(/^\d+\.\s+(.+)\s\(([^()]*)\)\s*$/);
    if (!m) {
      if (out.length > 0) break; // past the summary block
      continue;
    }
    const meta = m[2].split(",").map((s) => s.trim());
    out.push({
      filename: m[1],
      kind: meta[0] || "unknown",
      sizeBytes: 0,
      text: "",
      parseStatus: "not_processed",
      parseError:
        "spam-rescue replay: attachment content was not stored at filing time — not re-parsed",
    });
  }
  return out;
}

/**
 * 救回: spam row → real inquiry → InquiryAgent draft → cs approval task.
 * Throws when the row is missing, not spam-classified, or already rescued.
 */
export async function rescueSpamInteraction(
  interactionId: number,
  ctx?: ApprovalAuditCtx,
): Promise<RescueResult> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const rows = await db
    .select({
      id: customerInteractions.id,
      customerProfileId: customerInteractions.customerProfileId,
      content: customerInteractions.content,
      summary: customerInteractions.contentSummary,
      verdict: customerInteractions.spamVerdict,
      classification: customerInteractions.classification,
      email: customerProfiles.email,
    })
    .from(customerInteractions)
    .leftJoin(
      customerProfiles,
      eq(customerProfiles.id, customerInteractions.customerProfileId),
    )
    .where(eq(customerInteractions.id, interactionId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`Interaction ${interactionId} not found`);
  }
  if (row.classification !== "spam") {
    throw new Error(`Interaction ${interactionId} is not spam-classified`);
  }
  if (row.verdict === "rescued") {
    throw new Error(`Interaction ${interactionId} already rescued`);
  }

  const email = row.email?.trim() || "";
  const name = email || "未知寄件人";
  const subject = (row.summary?.trim() || row.content.slice(0, 80)).slice(
    0,
    255,
  );
  // Codex 14:07 P1-3 — the rescue replay only has the interaction row's
  // TEXT (body + attachment summary); the parsed attachment contents were
  // never stored. Rebuild sentinel entries from the summary so the agent's
  // attachment gate still sees the attachments EXIST (not_processed →
  // force escalation, no auto-send) instead of drafting as if the email
  // had no attachments.
  const replayAttachments = rebuildAttachmentSentinelsFromContent(row.content);

  // 1. Create the real inquiry first — even if the agent below dies, the
  //    customer now exists in the normal inbox flow (never lost again).
  const { createInquiry } = await import("../db");
  const inquiry = await createInquiry({
    inquiryType: "general",
    customerName: name,
    customerEmail: email,
    subject,
    message: row.content,
    status: "new",
  });

  // 2. Mark rescued BEFORE the LLM call: a crashed agent must not allow a
  //    second 救回 click to create a duplicate inquiry.
  await db
    .update(customerInteractions)
    .set({ spamVerdict: "rescued" })
    .where(eq(customerInteractions.id, interactionId));

  // 3. Same draft path as a normal inbound (produceInquiryReply): agent →
  //    producer → pending cs task in the 審核箱 / 今日待辦.
  let taskId: number | null = null;
  let riskLevel: string | undefined;
  let agentError: string | undefined;
  try {
    const { runInquiryAgent } = await import(
      "../agents/autonomous/inquiryAgent"
    );
    const { produceInquiryReplyTask } = await import(
      "../agents/autonomous/inquiryReplyProducer"
    );
    const agent = await runInquiryAgent({
      rawMessage: `${subject}\n\n${row.content}`,
      channel: "email",
      attachments: replayAttachments.length > 0 ? replayAttachments : undefined,
      customerProfile: email
        ? { id: row.customerProfileId, email }
        : undefined,
    });
    const produced = await produceInquiryReplyTask(
      {
        inquiryId: inquiry.id,
        customerEmail: email || null,
        customerName: name,
        subject,
        inquiryText: `${subject}\n${row.content}`,
      },
      agent,
      ctx,
    );
    taskId = produced.id;
    riskLevel = produced.riskLevel;
  } catch (err) {
    agentError = err instanceof Error ? err.message : String(err);
    log.warn(
      { interactionId, inquiryId: inquiry.id, err },
      "[spamBox] rescue: inquiry created but agent draft failed",
    );
  }

  if (ctx?.user) {
    audit({
      ctx,
      action: "spamBox.rescue",
      targetType: "customerInteraction",
      targetId: interactionId,
      changes: { inquiryId: inquiry.id, taskId, agentError },
    });
  }

  log.info(
    { interactionId, inquiryId: inquiry.id, taskId },
    "[spamBox] interaction rescued",
  );
  return { inquiryId: inquiry.id, taskId, riskLevel, agentError };
}

/** 確定是垃圾 — verdict = confirmed_spam. Idempotent; the row is kept. */
export async function confirmSpamInteraction(
  interactionId: number,
  ctx?: ApprovalAuditCtx,
): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }
  const rows = await db
    .select({
      id: customerInteractions.id,
      classification: customerInteractions.classification,
      verdict: customerInteractions.spamVerdict,
    })
    .from(customerInteractions)
    .where(eq(customerInteractions.id, interactionId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`Interaction ${interactionId} not found`);
  }
  if (row.classification !== "spam") {
    throw new Error(`Interaction ${interactionId} is not spam-classified`);
  }
  if (row.verdict === "rescued") {
    throw new Error(
      `Interaction ${interactionId} was rescued — cannot confirm as spam`,
    );
  }

  if (row.verdict !== "confirmed_spam") {
    await db
      .update(customerInteractions)
      .set({ spamVerdict: "confirmed_spam" })
      .where(eq(customerInteractions.id, interactionId));
    if (ctx?.user) {
      audit({
        ctx,
        action: "spamBox.confirm",
        targetType: "customerInteraction",
        targetId: interactionId,
        changes: { verdict: "confirmed_spam" },
      });
    }
    log.info({ interactionId }, "[spamBox] interaction confirmed as spam");
  }
  return { id: interactionId };
}
