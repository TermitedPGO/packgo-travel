/**
 * wechatAssistService.ts — WeChat-style inbound message handler with AI draft.
 *
 * v78: covers two modes today
 *   1. **Manual paste** (immediately useful): Jeff copies a WeChat / 朋友圈 /
 *      LINE message into the admin UI; AI drafts a Mandarin response in the
 *      same style; Jeff edits/approves; final text goes back to clipboard
 *      (or auto-sends once OA is verified).
 *   2. **WeChat OA webhook** (future-ready): when Jeff verifies his OA,
 *      `processInboundFromWebhook()` will parse incoming messages and create
 *      the same review-pending row.
 *
 * Why bother today: the #1 channel for Chinese diaspora customers is WeChat,
 * but Jeff's OA isn't verified yet. The manual-paste mode lets him 10x his
 * reply speed RIGHT NOW with no integration work blocked.
 */

import { invokeLLM } from "../_core/llm";
import { getDb } from "../db";
import { wechatMessages } from "../../drizzle/schema";
import { enrichChatContext } from "./aiChatContextService";

const SYSTEM_PROMPT = `你是 PACK&GO 旅行社的 AI 助理 Jeff（謝俊富，老闆本人）的「分身」。
客戶在 WeChat / 朋友圈 / LINE 對 Jeff 提問，Jeff 沒空即時回，你先草擬回覆讓他審。

寫作風格：
- 像 Jeff 本人寫的、繁體中文、口語化、親切但專業
- 不要用「您好」「煩請」這種旅行社官腔；直接像朋友聊天
- 適時用 emoji（每則 1-2 個，不要過多）
- 回覆長度 50-150 字（朋友圈場景更短）
- 結尾通常以「想了解更多歡迎敲我」「有興趣再聊」這類自然 CTA

聯絡資訊（需要時提供）：
- 電話：+1 (510) 634-2307
- Email：jeffhsieh09@gmail.com
- 官網：https://packgo-travel.fly.dev

公司：Pack & Go, LLC（CST #2166984，加州合法登記旅行社）

當客戶問特定行程：
- 引用真實行程連結（會在下面 context 提供你可用的行程）
- 不要編造價格、不要編造行程內容

當客戶要報價：
- 推 AI 報價產生器：https://packgo-travel.fly.dev/quote
- 或請客戶留 email + 需求，1 個工作日內報價

當客戶提到投訴 / 退款：
- 不要承諾任何條件
- 取得訂單編號 + email
- 告訴客戶 Jeff 會親自回覆`;

export interface DraftReplyInput {
  inboundText: string;
  source: "wechat_oa" | "manual_paste" | "moments_reply";
  fromDisplayName?: string;
  fromOpenId?: string;
}

export interface DraftReplyResult {
  messageId: number | null;
  draftText: string;
  confidence: number;
  detectedIntent: string[];
}

export async function draftReply(input: DraftReplyInput): Promise<DraftReplyResult> {
  // 1. Enrich with live tour catalog if applicable
  const enrichment = await enrichChatContext(input.inboundText).catch(() => null);
  const contextBlock = enrichment?.systemPromptAddition || "";

  // 2. LLM call (Haiku — cheap, fast, plenty for this use case)
  let draft = "";
  let confidence = 0.5;
  try {
    const response = await invokeLLM({
      model: "claude-haiku-4-5-20251001",
      maxTokens: 400,
      messages: [
        { role: "system", content: SYSTEM_PROMPT + contextBlock },
        {
          role: "user",
          content: `${input.fromDisplayName ? `[來自 ${input.fromDisplayName}]\n` : ""}${input.inboundText}`,
        },
      ],
    });
    draft = String(response?.choices?.[0]?.message?.content || "").trim();
    // Heuristic confidence: longer, more specific drafts → higher confidence
    confidence = Math.min(1.0, 0.4 + draft.length / 800 + (enrichment?.matchedTourCount || 0) * 0.1);
  } catch (err) {
    console.error("[wechatAssistService] LLM draft failed:", (err as Error)?.message);
    draft = "（AI 草稿失敗，請手動回覆）";
    confidence = 0;
  }

  // 3. Persist
  let messageId: number | null = null;
  try {
    const db = await getDb();
    if (db) {
      const result = await db.insert(wechatMessages).values({
        source: input.source,
        fromOpenId: input.fromOpenId || null,
        fromDisplayName: input.fromDisplayName || null,
        inboundText: input.inboundText.slice(0, 5000),
        aiDraftText: draft,
        aiDraftAt: new Date(),
        aiConfidence: String(confidence.toFixed(2)) as any,
        status: "ready_review",
      });
      messageId = Number((result[0] as any).insertId);
    }
  } catch (err) {
    console.warn("[wechatAssistService] persist failed:", (err as Error)?.message);
  }

  return {
    messageId,
    draftText: draft,
    confidence,
    detectedIntent: enrichment?.detectedIntent || [],
  };
}
