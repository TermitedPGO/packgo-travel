/**
 * inquiryReplyProducer — 指揮中心 客服頁 producer (P1-b).
 *
 * Consumes an InquiryAgent decision and turns it into a pending approval task
 * in the 審核箱. This is the NEW module the design calls for — inquiryAgent.ts
 * stays pure (no DB writes / no createApprovalTask), and this producer is the
 * seam that bridges "agent decided a draft" → "Jeff has something to approve".
 *
 * Flow (design.md §3 P1-b):
 *   runInquiryAgent(...) → InquiryAgentOutput
 *     → buildInquiryReplyTaskInput(inquiry, output)  [risk via P1-c classifier]
 *       → createApprovalTask({ lane:"cs", taskType:"inquiry_reply", ... })
 *
 * The payload JSON carries everything the cs preview + executor need:
 *   { inquiryId, draftBody, customerEmail, customerName, subject,
 *     classification, confidence, language }
 * draftBody is the agent's draftReply; the admin may edit it in the inbox
 * before approving (editedPayload replaces the stored payload).
 *
 * riskLevel comes from classifyInquiryRisk — NEVER "auto" in v1 (Jeff has not
 * enabled cs auto-send). hard_gate when the inquiry hits a sensitive keyword /
 * complaint / refund / critical urgency, else review.
 */

import {
  createApprovalTask,
  type CreateApprovalTaskInput,
  type ApprovalAuditCtx,
} from "../../_core/approvalTasks";
import { createChildLogger } from "../../_core/logger";
import type { InquiryAgentOutput } from "./inquiryAgent";
import { classifyInquiryRisk } from "./inquiryReplyClassifier";
import { INQUIRY_REPLY_TASK_TYPE } from "./inquiryReplyExecutor";

const log = createChildLogger({ module: "inquiryReplyProducer" });

/** The inquiry context the producer needs (a subset of the inquiries row). */
export interface InquiryReplyProducerInput {
  inquiryId: number;
  customerEmail?: string | null;
  customerName?: string | null;
  subject: string;
  /**
   * The raw inbound text used for sensitive-keyword scanning. Pass the
   * customer's subject + message; falls back to subject if omitted.
   */
  inquiryText?: string;
}

/**
 * Build the createApprovalTask input from an inquiry + agent output WITHOUT
 * touching the DB. Exposed separately so tests can assert the exact row shape
 * (payload fields + riskLevel) without mocking the DB layer.
 */
export function buildInquiryReplyTaskInput(
  inquiry: InquiryReplyProducerInput,
  agent: InquiryAgentOutput,
): CreateApprovalTaskInput {
  const inquiryText =
    inquiry.inquiryText ?? inquiry.subject ?? "";

  const risk = classifyInquiryRisk({
    inquiryText,
    classification: agent.classification,
    urgency: agent.urgency,
  });

  const payload = JSON.stringify({
    inquiryId: inquiry.inquiryId,
    draftBody: agent.draftReply,
    customerEmail: inquiry.customerEmail ?? undefined,
    customerName: inquiry.customerName ?? undefined,
    subject: inquiry.subject,
    classification: agent.classification,
    confidence: agent.confidence,
    language: agent.draftLanguage,
  });

  // Human-readable inbox row. The customer name (or email) + subject gives
  // Jeff enough to triage from the list without opening every item.
  const who = inquiry.customerName?.trim() || inquiry.customerEmail || `#${inquiry.inquiryId}`;
  const title = `${who} · ${inquiry.subject}`;

  // Short preview line under the title in the review dialog.
  const summary = `${agent.intent} (${agent.classification}, confidence ${agent.confidence})`;

  return {
    lane: "cs",
    taskType: INQUIRY_REPLY_TASK_TYPE,
    riskLevel: risk.riskLevel,
    title: title.slice(0, 255),
    summary,
    payload,
    relatedType: "inquiry",
    relatedId: String(inquiry.inquiryId),
    createdBy: "InquiryAgent",
  };
}

/**
 * Produce a pending cs approval task for an inquiry reply. Writes one row via
 * the shared createApprovalTask funnel and returns its id.
 *
 * ctx is optional — when called from an admin trigger, pass the admin ctx so
 * the create is audited; system/nightly producers omit it.
 */
export async function produceInquiryReplyTask(
  inquiry: InquiryReplyProducerInput,
  agent: InquiryAgentOutput,
  ctx?: ApprovalAuditCtx,
): Promise<{ id: number; riskLevel: CreateApprovalTaskInput["riskLevel"] }> {
  const taskInput = buildInquiryReplyTaskInput(inquiry, agent);
  const { id } = await createApprovalTask(taskInput, ctx);
  log.info(
    {
      id,
      inquiryId: inquiry.inquiryId,
      riskLevel: taskInput.riskLevel,
      classification: agent.classification,
    },
    "[inquiryReplyProducer] created cs approval task",
  );
  return { id, riskLevel: taskInput.riskLevel };
}
