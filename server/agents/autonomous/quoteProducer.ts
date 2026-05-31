/**
 * quoteProducer — 指揮中心 報價頁 producer (P2).
 *
 * Turns one quote request (tour + optional supplier departure + customer info)
 * into a pending approval task in the 審核箱. Mirrors the P1 cs producer
 * (inquiryReplyProducer.ts): a pure `buildQuoteDraftTaskInput` shapes the row,
 * `produceQuoteDraftTask` writes it through the shared createApprovalTask
 * funnel. The router (commandCenter.ts) resolves the DB data (tour title,
 * supplier price) and calls produceQuoteDraftTask.
 *
 * Two paths (Jeff Q&A):
 *   - 供應商團 (isCustomTrip=false): only tours with a supplierDepartures row
 *     get an AI-drafted quote. payload carries the supplier price so Jeff can
 *     compare it against the (future) AI estimate side-by-side.
 *   - 客製遊 (isCustomTrip=true): NO AI draft — the task is just a 待辦
 *     ("需手動報價"); payload holds customer info + tour title only, title is
 *     prefixed 📋, and prices are omitted.
 *
 * Pricing source (Jeff 2026-05-31, overriding the work-package's agentPrice):
 *   supplierPrice = supplierDepartures.retailPrice (直客價 / customer-facing),
 *   NOT agentPrice (同業成本). The review compares the price Jeff would quote
 *   the customer against the AI estimate.
 *
 * aiEstimate is left undefined in v1 — aiQuotes has no clean per-tour link
 * (only a recommendedTours JSON array), so the router does not resolve it yet.
 * The field stays in the payload shape so wiring an aiQuoteService lookup later
 * is a one-line change with no UI churn.
 *
 * riskLevel always comes from classifyQuoteRisk → ALWAYS "hard_gate" (money +
 * CST §17550). The router blocks bulk-approve of hard_gate, so every quote is
 * reviewed per item.
 */

import {
  createApprovalTask,
  type CreateApprovalTaskInput,
  type ApprovalAuditCtx,
} from "../../_core/approvalTasks";
import { createChildLogger } from "../../_core/logger";
import { classifyQuoteRisk } from "./quoteClassifier";
import { QUOTE_DRAFT_TASK_TYPE } from "./quoteExecutor";

const log = createChildLogger({ module: "quoteProducer" });

/** Where the quote request originated. Mirrors the customerChannel enum. */
export type QuoteCustomerChannel = "ai_assistant" | "gmail" | "wechat" | "line";

/**
 * The JSON shape written into approvalTasks.payload. The preview/editor parse
 * this; the executor reads tourId/tourTitle (+ the edited finalPrice).
 */
export interface QuoteDraftPayload {
  tourId: number;
  departureId?: number;
  tourTitle: string;
  customerName?: string;
  customerEmail?: string;
  /** "ai_assistant" | "gmail" | "wechat" | "line" — kept as string for forward-compat. */
  customerChannel?: string;
  /** Supplier retail price (直客價 / retailPrice). Omitted for custom trips. */
  supplierPrice?: number;
  /** AI estimate — undefined in v1 (router does not resolve it). */
  aiEstimate?: number;
  /** The price Jeff decides to quote — edited in the inbox; seeded from supplierPrice. */
  finalPrice?: number;
  /** ISO currency, defaults "USD". */
  currency?: string;
  /** Internal business note. */
  notes?: string;
  /** true = 客製遊 (待辦 only, no AI draft); false = 供應商團. */
  isCustomTrip: boolean;
}

/** The resolved quote context the producer needs (router fills it in). */
export interface QuoteProducerInput {
  tourId: number;
  departureId?: number;
  tourTitle: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerChannel?: string | null;
  /** Supplier retail price (直客價), already coerced to a number by the router. */
  supplierPrice?: number | null;
  aiEstimate?: number | null;
  currency?: string | null;
  notes?: string | null;
  isCustomTrip?: boolean;
}

/** Coerce a maybe-null maybe-NaN price into a clean number | undefined. */
function cleanPrice(v: number | null | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Build the createApprovalTask input from a resolved quote request WITHOUT
 * touching the DB. Exposed separately so tests can assert the exact row shape
 * (payload fields + hard_gate + custom-vs-supplier branching) without mocking
 * the DB layer.
 */
export function buildQuoteDraftTaskInput(
  input: QuoteProducerInput,
): CreateApprovalTaskInput {
  const isCustomTrip = input.isCustomTrip ?? false;
  const currency = input.currency?.trim() || "USD";
  const supplierPrice = cleanPrice(input.supplierPrice);
  const aiEstimate = cleanPrice(input.aiEstimate);
  const who =
    input.customerName?.trim() || input.customerEmail?.trim() || "—";

  const risk = classifyQuoteRisk({ isCustomTrip, supplierPrice, aiEstimate });

  let payload: QuoteDraftPayload;
  let title: string;
  let summary: string;

  if (isCustomTrip) {
    // 客製遊：只產待辦，不草擬 — payload 只含客戶資訊 + tour title，無價格。
    payload = {
      tourId: input.tourId,
      departureId: input.departureId,
      tourTitle: input.tourTitle,
      customerName: input.customerName?.trim() || undefined,
      customerEmail: input.customerEmail?.trim() || undefined,
      customerChannel: input.customerChannel?.trim() || undefined,
      currency,
      notes: input.notes?.trim() || undefined,
      isCustomTrip: true,
    };
    title = `📋 ${input.tourTitle} · ${who}`;
    summary = "客製遊 · 需手動報價";
  } else {
    // 供應商團：帶供應商直客價（+ 未來的 AI 估價）供並排比較。
    payload = {
      tourId: input.tourId,
      departureId: input.departureId,
      tourTitle: input.tourTitle,
      customerName: input.customerName?.trim() || undefined,
      customerEmail: input.customerEmail?.trim() || undefined,
      customerChannel: input.customerChannel?.trim() || undefined,
      supplierPrice,
      aiEstimate,
      currency,
      notes: input.notes?.trim() || undefined,
      isCustomTrip: false,
    };
    title =
      supplierPrice !== undefined
        ? `${input.tourTitle} · ${who} · $${supplierPrice}`
        : `${input.tourTitle} · ${who}`;
    summary =
      supplierPrice !== undefined
        ? `${currency} ${supplierPrice}`
        : input.tourTitle;
  }

  return {
    lane: "quote",
    taskType: QUOTE_DRAFT_TASK_TYPE,
    riskLevel: risk.riskLevel,
    title: title.slice(0, 255),
    summary,
    payload: JSON.stringify(payload),
    relatedType: "tour",
    relatedId: String(input.tourId),
    createdBy: "QuoteAgent",
  };
}

/**
 * Produce a pending quote approval task. Writes one row via the shared
 * createApprovalTask funnel and returns its id + riskLevel.
 *
 * ctx is optional — when called from an admin trigger, pass the admin ctx so
 * the create is audited; system producers omit it.
 */
export async function produceQuoteDraftTask(
  input: QuoteProducerInput,
  ctx?: ApprovalAuditCtx,
): Promise<{ id: number; riskLevel: CreateApprovalTaskInput["riskLevel"] }> {
  const taskInput = buildQuoteDraftTaskInput(input);
  const { id } = await createApprovalTask(taskInput, ctx);
  log.info(
    {
      id,
      tourId: input.tourId,
      departureId: input.departureId,
      riskLevel: taskInput.riskLevel,
      isCustomTrip: input.isCustomTrip ?? false,
    },
    "[quoteProducer] created quote approval task",
  );
  return { id, riskLevel: taskInput.riskLevel };
}
