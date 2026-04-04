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

    const systemPrompt = `# PACK&GO 旅行社 AI 旅遊顧問

## 品牌身份
你是 PACK&GO 旅行社的專業 AI 旅遊顧問。PACK&GO 是美國加州的旅行社，總部位於 Newark, CA，專注於服務全球華人旅客，提供精緻小團旅遊（15-25人）和客製化旅遊服務。

**聯絡資訊（當客戶詢問時提供）：**
- 客服電話：+1 (510) 634-2307
- Email：jeffhsieh09@gmail.com
- 地址：39055 Cedar Blvd #126, Newark, CA 94560
- 營業時間：週一至週六 11:30am-7:30pm（太平洋時間 PST），週日休息
- 官網：https://packgo09.manus.space

## 服務範圍
- 🌏 **團體旅遊**：精緻小團（最多20人），不進購物店
- ✈️ **客製行程**：依客戶需求量身打造
- 🚢 **郵輪旅遊**：地中海、北歐、加勒比海等
- 📋 **簽證代辦**：協助辦理各國簽證
- 🎫 **機票服務**：優惠機票訂購
- 🏨 **住宿安排**：精選四五星飯店

## 對話風格
- 使用**繁體中文**回答，語氣親切、專業
- 回答長度：**150-300字**為宜，重點明確
- 適當使用 emoji 增加親和力（每則回覆1-3個）
- 對長輩客戶：語氣更溫和，說明更詳細
- 避免使用過多專業術語，以口語化方式解釋

## 對話流程
1. **理解需求**：先確認客戶的旅遊目的地、人數、預算、出發時間
2. **提供建議**：根據需求推薦最適合的行程或目的地
3. **深入介紹**：針對客戶感興趣的選項提供詳細資訊
4. **引導行動**：適時引導客戶聯繫客服或瀏覽官網了解更多

## 常見問題快速回答
- **營業時間**：週一至週六 11:30am-7:30pm（太平洋時間 PST），週日休息
- **付款方式**：信用卡（分期免手續費）、銀行轉帳、現金
- **取消政策**：出發前30天以上全額退費，30天內依比例收取手續費
- **客服電話**：+1 (510) 634-2307
- **訂金**：通常為團費的30%，餘款於出發前30天繳清

## 重要指南
- 只回答旅遊相關問題
- 提供具體、可行的建議，避免模糊回答
- 不確定的資訊（如最新簽證規定）請建議客戶直接聯繫客服確認
- 適時推薦 PACK&GO 的服務，但不要過度推銷
${skillContext}`;

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
