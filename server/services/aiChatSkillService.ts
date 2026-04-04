/**
 * AI Chat Skill Integration Service
 * 
 * Integrates skill matching and triggering into AI customer service conversations.
 * Uses Claude for intelligent skill matching and response generation.
 */

import { getDb } from "../db";
import { agentSkills } from "../../drizzle/schema";
import { eq, and, like, or, sql } from "drizzle-orm";
import { recordSkillTrigger, type ContextType } from "./skillPerformanceService";
import { getHaikuAgent, ClaudeAgent } from "../agents/claudeAgent";

// Types
export interface SkillMatch {
  skillId: number;
  skillName: string;
  skillType: string;
  keywords: string[];
  matchedKeywords: string[];
  confidence: number;
  responseTemplate?: string;
  metadata?: Record<string, any>;
}

export interface ChatContext {
  message: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  userId?: number;
  sessionId?: string;
}

export interface SkillEnhancedResponse {
  response: string;
  triggeredSkills: SkillMatch[];
  usageLogIds: number[];
}

/**
 * Get all active skills from the database
 */
export async function getActiveSkills(): Promise<any[]> {
  const db = await getDb();
  if (!db) return [];
  
  const skills = await db.select()
    .from(agentSkills)
    .where(eq(agentSkills.isActive, true));
  
  return skills;
}

/**
 * Match user message against available skills
 * Uses keyword matching and Claude for intelligent matching
 */
export async function matchSkills(
  message: string,
  skills: any[]
): Promise<SkillMatch[]> {
  const matches: SkillMatch[] = [];
  const messageLower = message.toLowerCase();
  
  for (const skill of skills) {
    const keywords = skill.keywords ? JSON.parse(skill.keywords) : [];
    const matchedKeywords: string[] = [];
    
    // Check keyword matches
    for (const keyword of keywords) {
      if (messageLower.includes(keyword.toLowerCase())) {
        matchedKeywords.push(keyword);
      }
    }
    
    if (matchedKeywords.length > 0) {
      // Calculate confidence based on matched keywords ratio
      const confidence = matchedKeywords.length / Math.max(keywords.length, 1);
      
      matches.push({
        skillId: skill.id,
        skillName: skill.skillName,
        skillType: skill.skillType,
        keywords,
        matchedKeywords,
        confidence: Math.min(confidence * 1.5, 1), // Boost confidence slightly
        responseTemplate: skill.responseTemplate,
        metadata: skill.metadata ? JSON.parse(skill.metadata) : undefined,
      });
    }
  }
  
  // Sort by confidence (highest first)
  matches.sort((a, b) => b.confidence - a.confidence);
  
  return matches;
}

/**
 * Use Claude to intelligently match skills based on semantic understanding
 */
export async function intelligentSkillMatch(
  message: string,
  skills: any[]
): Promise<SkillMatch[]> {
  if (skills.length === 0) return [];
  
  const agent = getHaikuAgent();

  
  agent.setContext('AiChatAgent', 'ai_chat');
  
  // Prepare skill descriptions for Claude
  const skillDescriptions = skills.map(s => ({
    id: s.id,
    name: s.skillName,
    type: s.skillType,
    keywords: s.keywords ? JSON.parse(s.keywords) : [],
    description: s.description || "",
  }));
  
  const prompt = `分析以下用戶訊息，並判斷哪些技能應該被觸發。

用戶訊息：
"${message}"

可用技能列表：
${JSON.stringify(skillDescriptions, null, 2)}

請返回一個 JSON 陣列，包含應該觸發的技能 ID 和信心度（0-1）。
只返回信心度 > 0.5 的技能。
格式：[{"skillId": 1, "confidence": 0.8, "reason": "匹配原因"}]

如果沒有匹配的技能，返回空陣列 []。`;

  try {
    const result = await agent.sendMessage(prompt, {
      systemPrompt: "你是一個技能匹配專家。根據用戶訊息的語義，判斷哪些技能應該被觸發。只返回 JSON 格式的結果。",
      temperature: 0.3,
    });
    
    if (!result.success || !result.content) {
      return [];
    }
    
    // Parse Claude's response
    const jsonMatch = result.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    
    const matchedSkillIds = JSON.parse(jsonMatch[0]) as Array<{
      skillId: number;
      confidence: number;
      reason: string;
    }>;
    
    // Convert to SkillMatch format
    const matches: SkillMatch[] = [];
    for (const match of matchedSkillIds) {
      const skill = skills.find(s => s.id === match.skillId);
      if (skill && match.confidence > 0.5) {
        matches.push({
          skillId: skill.id,
          skillName: skill.skillName,
          skillType: skill.skillType,
          keywords: skill.keywords ? JSON.parse(skill.keywords) : [],
          matchedKeywords: [], // Claude-based matching doesn't use keyword matching
          confidence: match.confidence,
          responseTemplate: skill.responseTemplate,
          metadata: skill.metadata ? JSON.parse(skill.metadata) : undefined,
        });
      }
    }
    
    return matches;
  } catch (error) {
    console.error("[AIChatSkillService] Intelligent skill match error:", error);
    return [];
  }
}

/**
 * Generate skill-enhanced response using Claude
 */
export async function generateSkillEnhancedResponse(
  context: ChatContext,
  matchedSkills: SkillMatch[]
): Promise<string> {
  const agent = getHaikuAgent();

  agent.setContext('AiChatAgent', 'ai_chat');
  
  // Build skill context for Claude
  let skillContext = "";
  if (matchedSkills.length > 0) {
    skillContext = `
你已識別到以下相關技能可以幫助回答用戶問題：
${matchedSkills.map(s => `- ${s.skillName} (${s.skillType}): 關鍵字 ${s.matchedKeywords.join(", ")}`).join("\n")}

請根據這些技能的專業知識來增強你的回答。`;
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

  // Build conversation messages
  const messages = [
    ...(context.conversationHistory || []).slice(-10).map(msg => ({
      role: msg.role,
      content: msg.content,
    })),
    {
      role: "user" as const,
      content: context.message,
    },
  ];
  
  try {
    const result = await agent.sendConversation(
      messages.map(m => ({ role: m.role, content: m.content })),
      {
        systemPrompt,
        temperature: 0.7,
      }
    );
    
    if (result.success && result.content) {
      return result.content;
    }
    
    return "抱歉，我無法處理您的請求。請稍後再試。";
  } catch (error) {
    console.error("[AIChatSkillService] Generate response error:", error);
    return "抱歉，我無法處理您的請求。請稍後再試。";
  }
}

/**
 * Process a chat message with skill integration
 * Main entry point for skill-enhanced AI chat
 */
export async function processMessageWithSkills(
  context: ChatContext
): Promise<SkillEnhancedResponse> {
  const startTime = Date.now();
  const usageLogIds: number[] = [];
  
  try {
    // 1. Get all active skills
    const skills = await getActiveSkills();
    
    // 2. Match skills using both keyword and intelligent matching
    const keywordMatches = await matchSkills(context.message, skills);
    const intelligentMatches = await intelligentSkillMatch(context.message, skills);
    
    // 3. Merge and deduplicate matches
    const allMatches = [...keywordMatches];
    for (const match of intelligentMatches) {
      if (!allMatches.find(m => m.skillId === match.skillId)) {
        allMatches.push(match);
      } else {
        // Update confidence if intelligent match has higher confidence
        const existing = allMatches.find(m => m.skillId === match.skillId);
        if (existing && match.confidence > existing.confidence) {
          existing.confidence = match.confidence;
        }
      }
    }
    
    // 4. Sort by confidence and take top 3
    const topMatches = allMatches
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);
    
    // 5. Record skill triggers
    for (const match of topMatches) {
      const processingTime = Date.now() - startTime;
      const logId = await recordSkillTrigger({
        skillId: match.skillId,
        skillName: match.skillName,
        skillType: match.skillType,
        contextType: "chat" as ContextType,
        contextId: context.sessionId,
        inputText: context.message,
        matchedKeywords: match.matchedKeywords,
        userId: context.userId,
        sessionId: context.sessionId,
        wasSuccessful: true,
        processingTimeMs: processingTime,
      });
      usageLogIds.push(logId);
    }
    
    // 6. Generate skill-enhanced response
    const response = await generateSkillEnhancedResponse(context, topMatches);
    
    return {
      response,
      triggeredSkills: topMatches,
      usageLogIds,
    };
  } catch (error) {
    console.error("[AIChatSkillService] Process message error:", error);
    
    // Fallback to basic response
    return {
      response: "抱歉，我無法處理您的請求。請稍後再試。",
      triggeredSkills: [],
      usageLogIds: [],
    };
  }
}

/**
 * Record user feedback for a chat response
 */
export async function recordChatFeedback(
  usageLogIds: number[],
  feedback: "positive" | "negative",
  comment?: string
): Promise<void> {
  const { recordUserFeedback } = await import("./skillPerformanceService");
  
  for (const logId of usageLogIds) {
    await recordUserFeedback({
      usageLogId: logId,
      feedback,
      comment,
    });
  }
}

/**
 * Record conversion from a chat session
 */
export async function recordChatConversion(
  usageLogIds: number[],
  conversionType: "booking" | "inquiry" | "favorite" | "share",
  conversionId?: number
): Promise<void> {
  const { recordConversion } = await import("./skillPerformanceService");
  
  for (const logId of usageLogIds) {
    await recordConversion({
      usageLogId: logId,
      conversionType,
      conversionId,
    });
  }
}
