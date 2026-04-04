/**
 * AI Chat Streaming Router
 * Provides SSE (Server-Sent Events) endpoint for real-time streaming AI chat responses.
 * 
 * Endpoint: GET /api/ai/chat/stream
 * Query params:
 *   - message: string (required)
 *   - history: JSON string of [{role, content}] (optional)
 *   - sessionId: string (optional)
 */
import { Router } from "express";
import { getHaikuAgent } from "./agents/claudeAgent";
import { matchSkills } from "./services/aiChatSkillService";
import { checkAiChatRateLimit } from "./rateLimit";

export const aiChatStreamRouter = Router();

aiChatStreamRouter.get("/ai/chat/stream", async (req, res) => {
  const { message, history, sessionId } = req.query as Record<string, string>;

  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  // Rate limiting: 60 requests per hour per IP
  const ip = (req.headers["x-forwarded-for"] as string || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const rateLimitResult = await checkAiChatRateLimit(ip);
  if (!rateLimitResult.allowed) {
    res.status(429).json({ error: "請求過於頻繁，請稍後再試" });
    return;
  }

  // Parse conversation history
  let conversationHistory: { role: "user" | "assistant"; content: string }[] = [];
  if (history) {
    try {
      conversationHistory = JSON.parse(history);
    } catch {
      // ignore parse errors, use empty history
    }
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
  res.flushHeaders();

  const sendEvent = (type: string, data: unknown) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Match skills for context enrichment
    let skillContext = "";
    try {
      const matchedSkills = await matchSkills(message, conversationHistory);
      if (matchedSkills.length > 0) {
        skillContext = `\n你已識別到以下相關技能可以幫助回答用戶問題：\n${matchedSkills.map(s => `- ${s.skillName}: 關鍵字 ${s.matchedKeywords.join(", ")}`).join("\n")}\n請根據這些技能的專業知識來增強你的回答。`;
        // Notify client which skills were triggered
        sendEvent("skills", matchedSkills.map(s => ({
          skillId: s.skillId,
          skillName: s.skillName,
          confidence: s.confidence,
        })));
      }
    } catch {
      // skill matching failure is non-fatal
    }

    const systemPrompt = `你是 PACK&GO 旅行社的專業旅遊顧問 AI。你的職責是：
1. 幫助客戶規劃旅程並推薦目的地
2. 回答關於旅遊套餐、簽證要求和旅遊小貼士的問題
3. 根據客戶偏好提供個性化建議
4. 友善、專業、樂於助人
5. 始終使用繁體中文回答
${skillContext}
重要指南：
- 只專注於旅遊相關話題
- 提供具體、可行的建議
- 需要時詢問澄清問題
- 適當時推薦 PACK&GO 的服務`;

    // Build messages array (last 10 turns + current message)
    const messages = [
      ...conversationHistory.slice(-10),
      { role: "user" as const, content: message },
    ];

    const agent = getHaikuAgent();
    agent.setContext('AIChatAgent', 'customer_service');

    // Stream the response
    for await (const chunk of agent.streamConversation(messages, {
      systemPrompt,
      temperature: 0.7,
    })) {
      sendEvent("chunk", { text: chunk });
    }

    // Signal completion
    sendEvent("done", { sessionId: sessionId || null });
  } catch (error: any) {
    console.error("[AIChatStream] Error:", error.message);
    sendEvent("error", { message: "AI 服務暫時無法使用，請稍後再試。" });
  } finally {
    res.end();
  }
});
