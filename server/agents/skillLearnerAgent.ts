/**
 * SkillLearnerAgent - AI 自動學習技能代理
 * 
 * 基於 Superpowers 架構設計，實作 AI 自動學習功能：
 * 1. 分析行程內容，自動識別新的關鍵字和模式
 * 2. 自動擴充現有技能的關鍵字庫
 * 3. 建議創建新技能（當發現無法歸類的新模式時）
 * 4. 學習回饋機制（根據管理員確認/拒絕優化學習）
 */

import { invokeLLM } from "../_core/llm";
import { logLlmUsage } from "../llmUsageService";
import { parseLlmJson } from "../_core/parseLlmJson";
import { getDb } from "../db";
import { agentSkills, skillApplicationLogs } from "../../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

// 學習結果類型定義
export interface LearningResult {
  // 建議新增到現有技能的關鍵字
  keywordSuggestions: {
    skillId: number;
    skillName: string;
    newKeywords: string[];
    confidence: number; // 0-1 信心度
    reason: string;
  }[];
  
  // 建議創建的新技能
  newSkillSuggestions: {
    skillName: string;
    skillType: string;
    category: string;
    description: string;
    keywords: string[];
    whenToUse: string;
    corePattern: string;
    confidence: number;
    reason: string;
  }[];
  
  // 識別出的標籤
  identifiedTags: {
    tag: string;
    category: string;
    matchedSkillId?: number;
    isNew: boolean;
  }[];
  
  // 學習統計
  stats: {
    totalKeywordsFound: number;
    newKeywordsFound: number;
    existingKeywordsMatched: number;
    processingTimeMs: number;
  };
}

// 學習建議狀態
export type SuggestionStatus = 'pending' | 'approved' | 'rejected';

export class SkillLearnerAgent {
  private existingSkills: any[] = [];
  
  /**
   * 主要學習方法 - 分析內容並學習新的關鍵字和模式
   */
  async learnFromContent(content: {
    title: string;
    description: string;
    highlights?: string[];
    dailyItinerary?: any[];
    country?: string;
    city?: string;
    price?: number;
    duration?: number;
  }): Promise<LearningResult> {
    const startTime = Date.now();
    
    // 1. 載入現有技能
    await this.loadExistingSkills();
    
    // 2. 準備分析內容
    const analysisContent = this.prepareContentForAnalysis(content);
    
    // 3. 使用 Claude AI 分析內容
    const aiAnalysis = await this.analyzeWithAI(analysisContent);
    
    // 4. 比對現有技能，識別新關鍵字
    const keywordSuggestions = this.identifyNewKeywords(aiAnalysis);
    
    // 5. 識別可能的新技能
    const newSkillSuggestions = this.identifyNewSkills(aiAnalysis);
    
    // 6. 生成識別標籤
    const identifiedTags = this.generateTags(aiAnalysis);
    
    const processingTime = Date.now() - startTime;
    
    return {
      keywordSuggestions,
      newSkillSuggestions,
      identifiedTags,
      stats: {
        totalKeywordsFound: aiAnalysis.extractedKeywords?.length || 0,
        newKeywordsFound: keywordSuggestions.reduce((sum, s) => sum + s.newKeywords.length, 0),
        existingKeywordsMatched: aiAnalysis.matchedKeywords?.length || 0,
        processingTimeMs: processingTime
      }
    };
  }
  
  /**
   * 載入現有技能
   */
  private async loadExistingSkills() {
    try {
      const db = await getDb();
      if (!db) return;
      this.existingSkills = await db
        .select()
        .from(agentSkills)
        .where(eq(agentSkills.isActive, true));
    } catch (error) {
      console.error("[SkillLearnerAgent] Failed to load skills:", error);
      this.existingSkills = [];
    }
  }
  
  /**
   * 準備分析內容
   */
  private prepareContentForAnalysis(content: any): string {
    const parts: string[] = [];
    
    if (content.title) parts.push(`標題: ${content.title}`);
    if (content.description) parts.push(`描述: ${content.description}`);
    if (content.highlights?.length) parts.push(`亮點: ${content.highlights.join(', ')}`);
    if (content.country) parts.push(`國家: ${content.country}`);
    if (content.city) parts.push(`城市: ${content.city}`);
    if (content.price) parts.push(`價格: ${content.price}`);
    if (content.duration) parts.push(`天數: ${content.duration}`);
    
    if (content.dailyItinerary?.length) {
      const itineraryText = content.dailyItinerary
        .map((day: any, idx: number) => `第${idx + 1}天: ${day.title || ''} - ${day.description || ''}`)
        .join('\n');
      parts.push(`每日行程:\n${itineraryText}`);
    }
    
    return parts.join('\n\n');
  }
  
  /**
   * 使用 Claude AI 分析內容
   */
  private async analyzeWithAI(content: string): Promise<{
    extractedKeywords: string[];
    matchedKeywords: string[];
    categories: { name: string; keywords: string[]; confidence: number }[];
    suggestedNewCategories: { name: string; description: string; keywords: string[] }[];
    tourCharacteristics: string[];
  }> {
    // 準備現有技能資訊供 AI 參考
    const existingSkillsInfo = this.existingSkills.map(skill => ({
      id: skill.id,
      name: skill.skillName,
      type: skill.skillType,
      keywords: this.parseKeywords(skill.keywords)
    }));
    
    const systemPrompt = `你是一個專業的旅遊行程分析專家，負責從行程內容中識別關鍵特徵和標籤。

你的任務是：
1. 從行程內容中提取所有相關的關鍵字和特徵
2. 將這些關鍵字與現有技能的關鍵字進行比對
3. 識別出新的關鍵字（現有技能中沒有的）
4. 建議可能需要創建的新技能類別

現有技能列表：
${JSON.stringify(existingSkillsInfo, null, 2)}

請以 JSON 格式回覆，包含以下欄位：
- extractedKeywords: 從內容中提取的所有關鍵字陣列
- matchedKeywords: 與現有技能匹配的關鍵字陣列
- categories: 識別出的分類陣列，每個包含 name, keywords, confidence
- suggestedNewCategories: 建議的新分類陣列，每個包含 name, description, keywords
- tourCharacteristics: 行程特徵描述陣列`;

    const userPrompt = `請分析以下旅遊行程內容，提取關鍵字並識別特徵：

${content}

請特別注意：
1. 交通方式（鐵道、郵輪、飛機、巴士等）
2. 住宿類型（五星級、溫泉、民宿等）
3. 美食特色（米其林、當地美食、特色餐廳等）
4. 文化體驗（神社、寺廟、城堡、博物館等）
5. 自然景觀（賞櫻、賞楓、雪景、海灘等）
6. 特殊活動（滑雪、潛水、登山等）
7. 旅遊主題（蜜月、親子、銀髮族等）`;

    try {
      // Round 80.15: skill keyword extraction — short classification task,
      // route to Haiku to save 12x tokens.
      const response = await invokeLLM({
        model: "claude-haiku-4-5-20251001",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "skill_analysis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                extractedKeywords: {
                  type: "array",
                  items: { type: "string" },
                  description: "從內容中提取的所有關鍵字"
                },
                matchedKeywords: {
                  type: "array",
                  items: { type: "string" },
                  description: "與現有技能匹配的關鍵字"
                },
                categories: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      keywords: { type: "array", items: { type: "string" } },
                      confidence: { type: "number" }
                    },
                    required: ["name", "keywords", "confidence"],
                    additionalProperties: false
                  },
                  description: "識別出的分類"
                },
                suggestedNewCategories: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      description: { type: "string" },
                      keywords: { type: "array", items: { type: "string" } }
                    },
                    required: ["name", "description", "keywords"],
                    additionalProperties: false
                  },
                  description: "建議的新分類"
                },
                tourCharacteristics: {
                  type: "array",
                  items: { type: "string" },
                  description: "行程特徵描述"
                }
              },
              required: ["extractedKeywords", "matchedKeywords", "categories", "suggestedNewCategories", "tourCharacteristics"],
              additionalProperties: false
            }
          }
        }
      });
      
      // 記錄 LLM 用量
      if (response.usage) {
        logLlmUsage({
          agentName: 'SkillLearnerAgent',
          taskType: 'skill_learning',
          model: response.model || 'gemini-2.5-flash',
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
        }).catch(() => { /* silent */ });
      }
      // v80.24: use shared parseLlmJson — handles fences + prose
      const messageContent = response.choices[0].message.content;
      const contentStr = typeof messageContent === 'string'
        ? messageContent
        : (messageContent ? JSON.stringify(messageContent) : "{}");
      const result = parseLlmJson<{
        extractedKeywords: string[];
        matchedKeywords: string[];
        categories: { name: string; keywords: string[]; confidence: number }[];
        suggestedNewCategories: { name: string; description: string; keywords: string[] }[];
        tourCharacteristics: string[];
      }>(contentStr);
      return result;
    } catch (error) {
      console.error("[SkillLearnerAgent] AI analysis failed:", error);
      return {
        extractedKeywords: [],
        matchedKeywords: [],
        categories: [],
        suggestedNewCategories: [],
        tourCharacteristics: []
      };
    }
  }
  
  /**
   * 識別新關鍵字
   */
  private identifyNewKeywords(aiAnalysis: any): LearningResult['keywordSuggestions'] {
    const suggestions: LearningResult['keywordSuggestions'] = [];
    
    for (const category of aiAnalysis.categories || []) {
      // 找到對應的現有技能
      const matchedSkill = this.existingSkills.find(skill => {
        const skillKeywords = this.parseKeywords(skill.keywords);
        return category.keywords.some((kw: string) => 
          skillKeywords.some(sk => sk.toLowerCase().includes(kw.toLowerCase()) || kw.toLowerCase().includes(sk.toLowerCase()))
        );
      });
      
      if (matchedSkill) {
        const existingKeywords = this.parseKeywords(matchedSkill.keywords);
        const newKeywords = category.keywords.filter((kw: string) => 
          !existingKeywords.some(ek => 
            ek.toLowerCase() === kw.toLowerCase() ||
            ek.toLowerCase().includes(kw.toLowerCase()) ||
            kw.toLowerCase().includes(ek.toLowerCase())
          )
        );
        
        if (newKeywords.length > 0) {
          suggestions.push({
            skillId: matchedSkill.id,
            skillName: matchedSkill.skillName,
            newKeywords,
            confidence: category.confidence,
            reason: `AI 從行程內容中識別出這些新關鍵字與「${matchedSkill.skillName}」技能相關`
          });
        }
      }
    }
    
    return suggestions;
  }
  
  /**
   * 識別可能的新技能
   */
  private identifyNewSkills(aiAnalysis: any): LearningResult['newSkillSuggestions'] {
    const suggestions: LearningResult['newSkillSuggestions'] = [];
    
    for (const newCategory of aiAnalysis.suggestedNewCategories || []) {
      // 檢查是否與現有技能重複
      const isDuplicate = this.existingSkills.some(skill => 
        skill.skillName.toLowerCase().includes(newCategory.name.toLowerCase()) ||
        newCategory.name.toLowerCase().includes(skill.skillName.toLowerCase())
      );
      
      if (!isDuplicate && newCategory.keywords.length >= 2) {
        suggestions.push({
          skillName: `${newCategory.name}識別`,
          skillType: 'feature_classification',
          category: 'technical',
          description: newCategory.description,
          keywords: newCategory.keywords,
          whenToUse: `當行程內容包含以下關鍵字時觸發：${newCategory.keywords.slice(0, 3).join('、')}`,
          corePattern: `1. 掃描行程內容\n2. 匹配關鍵字：${newCategory.keywords.join(', ')}\n3. 生成對應標籤`,
          confidence: 0.7,
          reason: `AI 識別出一個新的行程特徵類別，建議創建新技能以支援自動標籤`
        });
      }
    }
    
    return suggestions;
  }
  
  /**
   * 生成識別標籤
   */
  private generateTags(aiAnalysis: any): LearningResult['identifiedTags'] {
    const tags: LearningResult['identifiedTags'] = [];
    
    // 從匹配的分類生成標籤
    for (const category of aiAnalysis.categories || []) {
      const matchedSkill = this.existingSkills.find(skill => {
        const skillKeywords = this.parseKeywords(skill.keywords);
        return category.keywords.some((kw: string) => 
          skillKeywords.some(sk => sk.toLowerCase().includes(kw.toLowerCase()))
        );
      });
      
      tags.push({
        tag: category.name,
        category: matchedSkill?.skillType || 'feature_classification',
        matchedSkillId: matchedSkill?.id,
        isNew: !matchedSkill
      });
    }
    
    // 從特徵描述生成標籤
    for (const characteristic of aiAnalysis.tourCharacteristics || []) {
      if (!tags.some(t => t.tag === characteristic)) {
        tags.push({
          tag: characteristic,
          category: 'characteristic',
          isNew: true
        });
      }
    }
    
    return tags;
  }
  
  /**
   * 解析關鍵字（支援 JSON 陣列和逗號分隔格式）
   */
  private parseKeywords(keywords: string | null): string[] {
    if (!keywords) return [];
    
    try {
      const parsed = JSON.parse(keywords);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // 不是 JSON，嘗試逗號分隔
    }
    
    return keywords.split(',').map(k => k.trim()).filter(Boolean);
  }
  
  /**
   * 應用學習建議 - 自動將新關鍵字添加到技能
   */
  async applyKeywordSuggestion(
    skillId: number, 
    newKeywords: string[],
    approvedBy?: string
  ): Promise<boolean> {
    try {
      const db = await getDb();
      if (!db) return false;
      const skill = await db
        .select()
        .from(agentSkills)
        .where(eq(agentSkills.id, skillId))
        .limit(1);
      
      if (!skill.length) return false;
      
      const existingKeywords = this.parseKeywords(skill[0].keywords);
      const keywordSet = new Set([...existingKeywords, ...newKeywords]);
      const updatedKeywords = Array.from(keywordSet);
      
      await db
        .update(agentSkills)
        .set({
          keywords: JSON.stringify(updatedKeywords),
          version: (skill[0].version || 1) + 1,
          updatedAt: new Date()
        })
        .where(eq(agentSkills.id, skillId));
      
      console.log(`[SkillLearnerAgent] Applied ${newKeywords.length} new keywords to skill ${skillId}`);
      return true;
    } catch (error) {
      console.error("[SkillLearnerAgent] Failed to apply keyword suggestion:", error);
      return false;
    }
  }
  
  /**
   * 創建新技能
   */
  async createNewSkill(suggestion: LearningResult['newSkillSuggestions'][0]): Promise<number | null> {
    try {
      const db = await getDb();
      if (!db) return null;
      const result = await db
        .insert(agentSkills)
        .values({
          skillType: suggestion.skillType as any,
          skillName: suggestion.skillName,
          skillCategory: suggestion.category as any,
          description: suggestion.description,
          keywords: JSON.stringify(suggestion.keywords),
          rules: JSON.stringify({ whenToUse: suggestion.whenToUse, corePattern: suggestion.corePattern }),
          whenToUse: suggestion.whenToUse,
          corePattern: suggestion.corePattern,
          isActive: true,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      
      console.log(`[SkillLearnerAgent] Created new skill: ${suggestion.skillName}`);
      // @ts-ignore - MySQL returns insertId
      return result[0]?.insertId ? Number(result[0].insertId) : null;
    } catch (error) {
      console.error("[SkillLearnerAgent] Failed to create new skill:", error);
      return null;
    }
  }
  
  /**
   * 批量學習 - 從多個行程中學習
   */
  async batchLearn(contents: any[]): Promise<{
    totalProcessed: number;
    keywordSuggestionsCount: number;
    newSkillSuggestionsCount: number;
    processingTimeMs: number;
  }> {
    const startTime = Date.now();
    let keywordSuggestionsCount = 0;
    let newSkillSuggestionsCount = 0;
    
    for (const content of contents) {
      const result = await this.learnFromContent(content);
      keywordSuggestionsCount += result.keywordSuggestions.length;
      newSkillSuggestionsCount += result.newSkillSuggestions.length;
    }
    
    return {
      totalProcessed: contents.length,
      keywordSuggestionsCount,
      newSkillSuggestionsCount,
      processingTimeMs: Date.now() - startTime
    };
  }
}

// 導出單例
export const skillLearnerAgent = new SkillLearnerAgent();
