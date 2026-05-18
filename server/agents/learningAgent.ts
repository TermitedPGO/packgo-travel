import { invokeLLM } from "../_core/llm";
import { logLlmUsage } from "../llmUsageService";
import { parseLlmJson } from "../_core/parseLlmJson";
import * as skillDb from "../skillDb";
import { InsertAgentSkill } from "../../drizzle/schema";

/**
 * Learning Agent - 從 PDF 內容中學習新的行程結構和特色分類
 * 
 * 功能：
 * 1. 分析 PDF 內容，識別新的行程特色和分類模式
 * 2. 提取關鍵字和規則，生成新的技能
 * 3. 將學習到的技能存入資料庫
 */

interface LearningResult {
  success: boolean;
  skillsLearned: number;
  skillIds: number[];
  summary: string;
  errors?: string[];
}

interface ExtractedSkill {
  skillType: "feature_classification" | "tag_rule" | "itinerary_structure" | "highlight_detection" | "transportation_type" | "meal_classification" | "accommodation_type";
  skillName: string;
  skillNameEn?: string;
  keywords: string[];
  rules: {
    conditions: Array<{
      type: "keyword" | "range" | "pattern";
      keywords?: string[];
      field?: string;
      min?: number;
      max?: number;
      pattern?: string;
      outputLabel: string;
    }>;
  };
  outputLabels: string[];
  description: string;
}

/**
 * 從 PDF 內容中學習新技能
 */
export async function learnFromPdfContent(
  pdfContent: string,
  sourceName: string,
  sourceUrl?: string,
  userId?: number
): Promise<LearningResult> {
  const errors: string[] = [];
  const skillIds: number[] = [];
  
  try {
    // 1. 使用 LLM 分析 PDF 內容，識別可學習的模式
    const analysisPrompt = `你是一個旅遊行程分析專家。請分析以下旅遊行程 PDF 內容，識別出可以學習的新模式和特色分類。

PDF 內容：
${pdfContent.substring(0, 15000)}

請識別以下類型的可學習模式：

1. **特色分類 (feature_classification)**：
   - ESG/永續旅遊特色
   - 美食主題特色
   - 文化探索特色
   - 自然生態特色
   - 其他獨特主題

2. **交通類型 (transportation_type)**：
   - 鐵道旅遊
   - 郵輪旅遊
   - 其他特殊交通

3. **亮點活動 (highlight_detection)**：
   - 特別安排的活動
   - 獨家體驗
   - 升級服務

4. **住宿類型 (accommodation_type)**：
   - 特色住宿
   - 溫泉旅館
   - 星級酒店

請以 JSON 格式回傳識別到的新技能，每個技能包含：
- skillType: 技能類型
- skillName: 技能名稱（繁體中文）
- skillNameEn: 英文名稱
- keywords: 關鍵字陣列（用於匹配）
- rules: 規則物件，包含 conditions 陣列
- outputLabels: 輸出標籤陣列
- description: 技能描述

只回傳 JSON 陣列，不要其他文字。如果沒有識別到新的可學習模式，回傳空陣列 []。

注意：
- 只提取這份 PDF 中明確出現的特色，不要臆測
- 關鍵字必須是 PDF 中實際出現的詞彙
- 規則必須基於 PDF 中的實際模式`;

    // Round 80.15: explicitly route to Haiku — this is short-task pattern
    // extraction, not deep reasoning. Defaulting to Sonnet was costing 12x
    // more tokens than needed.
    const response = await invokeLLM({
      model: "claude-haiku-4-5-20251001",
      messages: [
        { role: "system", content: "你是一個旅遊行程分析專家，專門識別行程特色和分類模式。請只回傳 JSON 格式的結果。" },
        { role: "user", content: analysisPrompt }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "extracted_skills",
          strict: true,
          schema: {
            type: "object",
            properties: {
              skills: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    skillType: { 
                      type: "string",
                      enum: ["feature_classification", "tag_rule", "itinerary_structure", "highlight_detection", "transportation_type", "meal_classification", "accommodation_type"]
                    },
                    skillName: { type: "string" },
                    skillNameEn: { type: "string" },
                    keywords: { 
                      type: "array",
                      items: { type: "string" }
                    },
                    rules: {
                      type: "object",
                      properties: {
                        conditions: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              type: { type: "string", enum: ["keyword", "range", "pattern"] },
                              keywords: { type: "array", items: { type: "string" } },
                              outputLabel: { type: "string" }
                            },
                            required: ["type", "outputLabel"],
                            additionalProperties: false
                          }
                        }
                      },
                      required: ["conditions"],
                      additionalProperties: false
                    },
                    outputLabels: {
                      type: "array",
                      items: { type: "string" }
                    },
                    description: { type: "string" }
                  },
                  required: ["skillType", "skillName", "keywords", "rules", "outputLabels", "description"],
                  additionalProperties: false
                }
              }
            },
            required: ["skills"],
            additionalProperties: false
          }
        }
      }
    });

    // 記錄 LLM 用量
    if (response.usage) {
      logLlmUsage({
        agentName: 'LearningAgent',
        taskType: 'skill_learning',
        model: response.model || 'gemini-2.5-flash',
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      }).catch(() => { /* silent */ });
    }

    // 2. 解析 LLM 回應 — v80.24: use parseLlmJson to handle fences + prose
    let extractedSkills: ExtractedSkill[] = [];
    try {
      const content = response.choices[0]?.message?.content;
      if (content && typeof content === 'string') {
        const parsed = parseLlmJson<{ skills?: ExtractedSkill[] }>(content);
        extractedSkills = parsed.skills || [];
      }
    } catch (parseError) {
      errors.push(`解析 LLM 回應失敗: ${parseError}`);
      console.error("[LearningAgent] Failed to parse LLM response:", parseError);
    }

    // 3. 檢查是否有重複的技能
    const existingSkills = await skillDb.getAllSkills(true);
    const existingNames = new Set(existingSkills.map(s => s.skillName));

    // 4. 儲存新技能
    for (const skill of extractedSkills) {
      // 跳過已存在的技能
      if (existingNames.has(skill.skillName)) {
        console.log(`[LearningAgent] Skill "${skill.skillName}" already exists, skipping`);
        continue;
      }

      // 驗證技能資料
      if (!skill.keywords || skill.keywords.length === 0) {
        errors.push(`技能 "${skill.skillName}" 缺少關鍵字，跳過`);
        continue;
      }

      try {
        const skillData: InsertAgentSkill = {
          skillType: skill.skillType,
          skillName: skill.skillName,
          skillNameEn: skill.skillNameEn,
          keywords: JSON.stringify(skill.keywords),
          rules: JSON.stringify(skill.rules),
          outputLabels: JSON.stringify(skill.outputLabels),
          description: skill.description,
          source: sourceName,
          sourceUrl: sourceUrl,
          createdBy: userId,
          isActive: true,
          isBuiltIn: false,
        };

        const skillId = await skillDb.createSkill(skillData);
        skillIds.push(skillId);
        console.log(`[LearningAgent] Created new skill: ${skill.skillName} (ID: ${skillId})`);
      } catch (createError) {
        errors.push(`建立技能 "${skill.skillName}" 失敗: ${createError}`);
        console.error(`[LearningAgent] Failed to create skill:`, createError);
      }
    }

    // 5. 生成學習摘要
    const summary = skillIds.length > 0
      ? `成功從 "${sourceName}" 學習了 ${skillIds.length} 個新技能`
      : `從 "${sourceName}" 未識別到新的可學習模式`;

    return {
      success: true,
      skillsLearned: skillIds.length,
      skillIds,
      summary,
      errors: errors.length > 0 ? errors : undefined,
    };

  } catch (error) {
    console.error("[LearningAgent] Learning failed:", error);
    return {
      success: false,
      skillsLearned: 0,
      skillIds: [],
      summary: `學習失敗: ${error}`,
      errors: [String(error)],
    };
  }
}

/**
 * 應用已學習的技能到行程內容
 */
export async function applyLearnedSkills(
  content: string,
  metadata?: { duration?: number; price?: number; [key: string]: any }
): Promise<{ labels: string[]; appliedSkills: number[] }> {
  const labels: string[] = [];
  const appliedSkills: number[] = [];

  try {
    // 1. 匹配適用的技能
    const matchedSkills = await skillDb.matchSkillsToContent(content);

    // 2. 應用每個匹配的技能
    for (const match of matchedSkills) {
      const skillLabels = skillDb.applySkillRules(match.skill, content, metadata);
      
      if (skillLabels.length > 0) {
        labels.push(...skillLabels);
        appliedSkills.push(match.skill.id);
        
        // 記錄技能使用
        await skillDb.incrementSkillUsage(match.skill.id, true);
        
        // 記錄應用日誌
        await skillDb.logSkillApplication({
          skillId: match.skill.id,
          inputContent: content.substring(0, 500),
          matchScore: String(match.score),
          outputResult: JSON.stringify(skillLabels),
          success: true,
        });
      }
    }

    // 移除重複標籤
    return {
      labels: Array.from(new Set(labels)),
      appliedSkills,
    };

  } catch (error) {
    console.error("[LearningAgent] Failed to apply skills:", error);
    return { labels: [], appliedSkills: [] };
  }
}

/**
 * 初始化內建技能
 */
export async function initializeBuiltInSkills(): Promise<void> {
  try {
    await skillDb.seedBuiltInSkills();
    console.log("[LearningAgent] Built-in skills initialized");
  } catch (error) {
    console.error("[LearningAgent] Failed to initialize built-in skills:", error);
  }
}
