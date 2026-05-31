/**
 * marketingProducer — 指揮中心 行銷頁 producer (P3).
 *
 * Receives a marketing draft (from the manual produceMarketingDraft mutation or
 * in the future from existing AI tools like generateCopy / marketingAgent) and
 * turns it into a pending approval task in the 審核箱.
 *
 * Flow:
 *   trigger (admin click / AI tool) → MarketingDraftInput
 *     → buildMarketingDraftTaskInput(input)  [risk via P3 classifier]
 *       → createApprovalTask({ lane:"marketing", taskType:"marketing_draft", ... })
 *
 * The payload JSON (MarketingDraftPayload) carries everything the marketing
 * preview + executor need: contentType, title, body, platform, audience,
 * related tour, image, hashtags, and the source router that produced it.
 */

import {
  createApprovalTask,
  type CreateApprovalTaskInput,
  type ApprovalAuditCtx,
} from "../../_core/approvalTasks";
import { createChildLogger } from "../../_core/logger";
import { classifyMarketingRisk } from "./marketingClassifier";
import { MARKETING_DRAFT_TASK_TYPE } from "./marketingExecutor";

const log = createChildLogger({ module: "marketingProducer" });

// ── Payload shape ───────────────────────────────────────────────────────────

export type MarketingContentType =
  | "xhs_post"
  | "wechat_article"
  | "edm"
  | "poster_copy"
  | "social_post"
  | "other";

export interface MarketingDraftPayload {
  contentType: MarketingContentType;
  title: string;
  body: string;
  platform?: string;
  targetAudience?: string;
  tourId?: number;
  tourTitle?: string;
  imageUrl?: string;
  hashtags?: string[];
  sourceRouter?: string;
  /** Supplier original text (for Jeff's comparison when reviewing). */
  supplierText?: string;
  /** Supplier poster image URL (for Jeff's comparison when reviewing). */
  supplierImageUrl?: string;
}

// ── Producer input ──────────────────────────────────────────────────────────

export interface MarketingDraftInput {
  contentType: MarketingContentType;
  title: string;
  body: string;
  platform?: string;
  targetAudience?: string;
  tourId?: number;
  tourTitle?: string;
  imageUrl?: string;
  hashtags?: string[];
  sourceRouter?: string;
  /** Whether this draft contains pricing (triggers hard_gate). */
  hasPrice?: boolean;
  /** Supplier original text (for Jeff's comparison when reviewing). */
  supplierText?: string;
  /** Supplier poster image URL (for Jeff's comparison when reviewing). */
  supplierImageUrl?: string;
}

// ── Content type display names (used in title construction) ─────────────────

const CONTENT_TYPE_LABELS: Record<MarketingContentType, string> = {
  xhs_post: "小紅書貼文",
  wechat_article: "公眾號文章",
  edm: "EDM",
  poster_copy: "海報文案",
  social_post: "社群貼文",
  other: "行銷內容",
};

const PLATFORM_LABELS: Record<string, string> = {
  xiaohongshu: "小紅書",
  wechat: "微信",
  email: "Email",
  instagram: "IG",
  facebook: "FB",
};

/**
 * Build the createApprovalTask input from a marketing draft WITHOUT touching
 * the DB. Exposed separately so tests can assert the exact row shape (payload
 * fields + riskLevel) without mocking the DB layer.
 */
export function buildMarketingDraftTaskInput(
  input: MarketingDraftInput,
): CreateApprovalTaskInput {
  const risk = classifyMarketingRisk({
    contentType: input.contentType,
    hasPrice: input.hasPrice ?? false,
  });

  const payload: MarketingDraftPayload = {
    contentType: input.contentType,
    title: input.title,
    body: input.body,
    platform: input.platform,
    targetAudience: input.targetAudience,
    tourId: input.tourId,
    tourTitle: input.tourTitle,
    imageUrl: input.imageUrl,
    hashtags: input.hashtags,
    sourceRouter: input.sourceRouter,
    supplierText: input.supplierText,
    supplierImageUrl: input.supplierImageUrl,
  };

  // Title format: [平台] {contentType中文} · {tourTitle或標題前20字}
  const platformLabel = input.platform
    ? PLATFORM_LABELS[input.platform] || input.platform
    : undefined;
  const typeLabel = CONTENT_TYPE_LABELS[input.contentType] || input.contentType;
  const suffix = input.tourTitle || input.title.slice(0, 20);
  const titleParts = [
    platformLabel ? `[${platformLabel}]` : null,
    typeLabel,
    "·",
    suffix,
  ]
    .filter(Boolean)
    .join(" ");

  const summary = input.targetAudience
    ? `${typeLabel} — ${input.targetAudience}`
    : typeLabel;

  return {
    lane: "marketing",
    taskType: MARKETING_DRAFT_TASK_TYPE,
    riskLevel: risk.riskLevel,
    title: titleParts.slice(0, 255),
    summary,
    payload: JSON.stringify(payload),
    relatedType: input.tourId ? "tour" : undefined,
    relatedId: input.tourId ? String(input.tourId) : undefined,
    createdBy: input.sourceRouter
      ? `marketing:${input.sourceRouter}`
      : "admin:manual",
  };
}

/**
 * Produce a pending marketing approval task. Writes one row via the shared
 * createApprovalTask funnel and returns its id.
 *
 * ctx is optional — when called from an admin trigger, pass the admin ctx so
 * the create is audited; system producers omit it.
 */
export async function produceMarketingDraftTask(
  input: MarketingDraftInput,
  ctx?: ApprovalAuditCtx,
): Promise<{ id: number; riskLevel: CreateApprovalTaskInput["riskLevel"] }> {
  const taskInput = buildMarketingDraftTaskInput(input);
  const { id } = await createApprovalTask(taskInput, ctx);
  log.info(
    {
      id,
      contentType: input.contentType,
      riskLevel: taskInput.riskLevel,
      platform: input.platform,
    },
    "[marketingProducer] created marketing approval task",
  );
  return { id, riskLevel: taskInput.riskLevel };
}
