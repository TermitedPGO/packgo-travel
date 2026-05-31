/**
 * Tests for the 指揮中��� 行銷頁 producer (P3).
 *
 * Tests the pure buildMarketingDraftTaskInput — asserts payload fields,
 * riskLevel routing, title format, and lane/taskType assignment without
 * needing a DB connection.
 */

import { describe, it, expect } from "vitest";
import {
  buildMarketingDraftTaskInput,
  type MarketingDraftInput,
} from "./marketingProducer";
import { MARKETING_DRAFT_TASK_TYPE } from "./marketingExecutor";

const BASE_INPUT: MarketingDraftInput = {
  contentType: "xhs_post",
  title: "美西自駕 5 天 4 夜攻略",
  body: "第一天：舊金山出發...",
  platform: "xiaohongshu",
  targetAudience: "25-35 歲女性自由行愛好者",
  tourId: 42,
  tourTitle: "美西黃金海岸 5 日遊",
  hashtags: ["美西自駕", "舊金山", "加州"],
  sourceRouter: "marketingContent",
};

describe("buildMarketingDraftTaskInput", () => {
  it("sets lane=marketing and correct taskType", () => {
    const result = buildMarketingDraftTaskInput(BASE_INPUT);
    expect(result.lane).toBe("marketing");
    expect(result.taskType).toBe(MARKETING_DRAFT_TASK_TYPE);
  });

  it("default riskLevel is review (no price)", () => {
    const result = buildMarketingDraftTaskInput(BASE_INPUT);
    expect(result.riskLevel).toBe("review");
  });

  it("hasPrice=true → riskLevel hard_gate", () => {
    const result = buildMarketingDraftTaskInput({
      ...BASE_INPUT,
      hasPrice: true,
    });
    expect(result.riskLevel).toBe("hard_gate");
  });

  it("title format: [平台] contentType · tourTitle", () => {
    const result = buildMarketingDraftTaskInput(BASE_INPUT);
    expect(result.title).toContain("[小紅書]");
    expect(result.title).toContain("小紅書貼文");
    expect(result.title).toContain("美西黃金海岸 5 日遊");
  });

  it("title without platform omits bracket", () => {
    const result = buildMarketingDraftTaskInput({
      ...BASE_INPUT,
      platform: undefined,
    });
    expect(result.title).not.toContain("[");
    expect(result.title).toContain("小紅書貼文");
  });

  it("title falls back to first 20 chars of title when no tourTitle", () => {
    const result = buildMarketingDraftTaskInput({
      ...BASE_INPUT,
      tourTitle: undefined,
    });
    expect(result.title).toContain("美西自駕 5 天 4 夜攻略".slice(0, 20));
  });

  it("payload JSON contains all expected fields", () => {
    const result = buildMarketingDraftTaskInput(BASE_INPUT);
    const payload = JSON.parse(result.payload);
    expect(payload.contentType).toBe("xhs_post");
    expect(payload.title).toBe(BASE_INPUT.title);
    expect(payload.body).toBe(BASE_INPUT.body);
    expect(payload.platform).toBe("xiaohongshu");
    expect(payload.targetAudience).toBe(BASE_INPUT.targetAudience);
    expect(payload.tourId).toBe(42);
    expect(payload.tourTitle).toBe(BASE_INPUT.tourTitle);
    expect(payload.hashtags).toEqual(["美西自駕", "舊金山", "加州"]);
    expect(payload.sourceRouter).toBe("marketingContent");
  });

  it("relatedType/relatedId set when tourId present", () => {
    const result = buildMarketingDraftTaskInput(BASE_INPUT);
    expect(result.relatedType).toBe("tour");
    expect(result.relatedId).toBe("42");
  });

  it("relatedType/relatedId undefined when no tourId", () => {
    const result = buildMarketingDraftTaskInput({
      ...BASE_INPUT,
      tourId: undefined,
    });
    expect(result.relatedType).toBeUndefined();
    expect(result.relatedId).toBeUndefined();
  });

  it("createdBy includes sourceRouter when present", () => {
    const result = buildMarketingDraftTaskInput(BASE_INPUT);
    expect(result.createdBy).toBe("marketing:marketingContent");
  });

  it("createdBy defaults to admin:manual when no sourceRouter", () => {
    const result = buildMarketingDraftTaskInput({
      ...BASE_INPUT,
      sourceRouter: undefined,
    });
    expect(result.createdBy).toBe("admin:manual");
  });

  it("title is capped at 255 chars", () => {
    const result = buildMarketingDraftTaskInput({
      ...BASE_INPUT,
      tourTitle: "A".repeat(300),
    });
    expect(result.title.length).toBeLessThanOrEqual(255);
  });
});
