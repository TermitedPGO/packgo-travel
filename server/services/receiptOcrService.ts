/**
 * Receipt OCR via Claude Haiku 4.5 vision — Mobile Phase 6 (2026-05-22).
 *
 * Takes a receipt image (JPEG/PNG/PDF rasterised), asks Claude to
 * extract { amount, date, vendor } as JSON. Returned to client which
 * uses it to suggest a matching bankTransaction.
 *
 * Cost: ~$0.003 per receipt (Haiku 4.5 + 1 small image). Daily cap
 * enforced upstream in the tRPC route (50/day).
 *
 * Returns confidence so the UI can hide low-confidence matches.
 */

import { invokeLLM, type Message } from "../_core/llm";

export type ReceiptOcrResult = {
  amount: number | null;
  date: string | null;          // YYYY-MM-DD
  vendor: string | null;
  currency: string | null;       // ISO 4217 or null if not detected
  confidence: number;            // 0-100
  rawResponse: string;
};

const SYSTEM_PROMPT = `你是 PACK&GO 收據解析器。客戶會給你 1 張收據圖（餐廳/超市/加油站/旅館/機票/任何商家）。

任務：抽出 3 個欄位，回 JSON tool call:

  amount      — 總金額（數字, USD 為主, 若標 NT$ 也回原數字）
  date        — 日期 YYYY-MM-DD
  vendor      — 商家名（乾淨字串, 例如 "Burger King" 不要 "BK ONLINE #4287"）
  currency    — ISO 4217 ("USD" / "TWD") 或 null 若看不出來
  confidence  — 0-100 整體信心度

規則:
- 看不清楚就回 null + 較低 confidence。不要亂猜。
- 收據常用「TOTAL / GRAND TOTAL / AMOUNT DUE / 合計 / 總計」做標記，找這些 keywords 旁邊的數字
- 多個總額時取最後一個（最終 total）
- 日期格式各地不同；若 MM/DD 不確定可猜成今年`;

const TOOL = {
  type: "function" as const,
  function: {
    name: "submit_receipt",
    description: "Submit extracted receipt fields",
    parameters: {
      type: "object",
      properties: {
        amount: { type: ["number", "null"] },
        date: { type: ["string", "null"] },
        vendor: { type: ["string", "null"] },
        currency: { type: ["string", "null"] },
        confidence: { type: "integer", minimum: 0, maximum: 100 },
      },
      required: ["amount", "date", "vendor", "currency", "confidence"],
    },
  },
};

/**
 * OCR a receipt image. `imageBase64` should be the bare base64 (no
 * data: prefix) and `mediaType` matches the original file content type.
 */
export async function ocrReceipt(args: {
  imageBase64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
}): Promise<ReceiptOcrResult> {
  // PDFs need a different content block; for v1 keep it to images
  // (most receipts are photos anyway). PDFs fail-soft with low confidence.
  if (args.mediaType === "application/pdf") {
    return {
      amount: null,
      date: null,
      vendor: null,
      currency: null,
      confidence: 0,
      rawResponse: "(PDF OCR not yet supported)",
    };
  }

  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: args.mediaType,
            data: args.imageBase64,
          },
        } as any,
        { type: "text", text: "請抽出 amount / date / vendor / currency / confidence" } as any,
      ] as any,
    },
  ];

  try {
    const result = await invokeLLM({
      model: "claude-haiku-4-5-20251001",
      messages,
      tools: [TOOL as any],
      toolChoice: { name: "submit_receipt" },
      maxTokens: 400,
    });

    const toolCall = result.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return {
        amount: null,
        date: null,
        vendor: null,
        currency: null,
        confidence: 0,
        rawResponse: "(no tool call returned)",
      };
    }

    const parsed = JSON.parse(toolCall.function.arguments);
    return {
      amount: typeof parsed.amount === "number" ? parsed.amount : null,
      date: typeof parsed.date === "string" ? parsed.date : null,
      vendor: typeof parsed.vendor === "string" ? parsed.vendor : null,
      currency: typeof parsed.currency === "string" ? parsed.currency : null,
      confidence: Math.max(0, Math.min(100, parsed.confidence ?? 0)),
      rawResponse: toolCall.function.arguments,
    };
  } catch (err) {
    console.error("[receiptOcrService] OCR failed:", err);
    return {
      amount: null,
      date: null,
      vendor: null,
      currency: null,
      confidence: 0,
      rawResponse: `(error: ${(err as Error)?.message ?? "unknown"})`,
    };
  }
}
