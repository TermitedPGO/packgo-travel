import { drizzle } from "drizzle-orm/mysql2";
import { agentSkills, skillApplicationLogs, learningSessions, InsertAgentSkill, InsertSkillApplicationLog, InsertLearningSession, AgentSkill } from "../drizzle/schema";
import { chatSkillsData } from "./seeds/chatSkills";
import { eq, and, desc, sql, like, or } from "drizzle-orm";

// Lazily create the drizzle instance
let _db: ReturnType<typeof drizzle> | null = null;

async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    _db = drizzle(process.env.DATABASE_URL);
  }
  if (!_db) {
    throw new Error("Database not available");
  }
  return _db;
}

// ============================================
// Agent Skills CRUD Operations
// ============================================

/**
 * Get all active skills
 */
export async function getAllSkills(includeInactive = false) {
  const db = await getDb();
  if (includeInactive) {
    return db.select().from(agentSkills).orderBy(desc(agentSkills.usageCount));
  }
  return db.select().from(agentSkills).where(eq(agentSkills.isActive, true)).orderBy(desc(agentSkills.usageCount));
}

/**
 * Get skills by type
 */
export async function getSkillsByType(skillType: string) {
  const db = await getDb();
  return db.select().from(agentSkills)
    .where(and(
      eq(agentSkills.skillType, skillType as any),
      eq(agentSkills.isActive, true)
    ))
    .orderBy(desc(agentSkills.usageCount));
}

/**
 * Get a single skill by ID
 */
export async function getSkillById(id: number) {
  const db = await getDb();
  const results = await db.select().from(agentSkills).where(eq(agentSkills.id, id));
  return results[0] || null;
}

/**
 * Create a new skill
 */
export async function createSkill(skill: InsertAgentSkill) {
  const db = await getDb();
  const result = await db.insert(agentSkills).values(skill);
  return result[0].insertId;
}

/**
 * Update a skill
 */
export async function updateSkill(id: number, updates: Partial<InsertAgentSkill>) {
  const db = await getDb();
  await db.update(agentSkills).set(updates).where(eq(agentSkills.id, id));
}

/**
 * Delete a skill (soft delete by setting isActive to false)
 */
export async function deleteSkill(id: number, hardDelete = false) {
  const db = await getDb();
  if (hardDelete) {
    await db.delete(agentSkills).where(eq(agentSkills.id, id));
  } else {
    await db.update(agentSkills).set({ isActive: false }).where(eq(agentSkills.id, id));
  }
}

/**
 * Increment skill usage count
 */
export async function incrementSkillUsage(id: number, success: boolean) {
  const db = await getDb();
  if (success) {
    await db.update(agentSkills)
      .set({
        usageCount: sql`${agentSkills.usageCount} + 1`,
        successCount: sql`${agentSkills.successCount} + 1`,
        lastUsedAt: new Date()
      })
      .where(eq(agentSkills.id, id));
  } else {
    await db.update(agentSkills)
      .set({
        usageCount: sql`${agentSkills.usageCount} + 1`,
        lastUsedAt: new Date()
      })
      .where(eq(agentSkills.id, id));
  }
}

// ============================================
// Skill Matching Functions
// ============================================

/**
 * Match skills based on content keywords
 * Returns skills sorted by match score
 */
export async function matchSkillsToContent(content: string, skillType?: string) {
  // Get all active skills (optionally filtered by type)
  let skills;
  if (skillType) {
    skills = await getSkillsByType(skillType);
  } else {
    skills = await getAllSkills();
  }
  
  // Calculate match score for each skill
  const scoredSkills = skills.map(skill => {
    const keywords = JSON.parse(skill.keywords) as string[];
    const matchedKeywords = keywords.filter(kw => content.includes(kw));
    const score = keywords.length > 0 ? matchedKeywords.length / keywords.length : 0;
    
    return {
      skill,
      score,
      matchedKeywords
    };
  });
  
  // Filter and sort by score (threshold: 0.2)
  return scoredSkills
    .filter((s: { skill: typeof agentSkills.$inferSelect; score: number; matchedKeywords: string[] }) => s.score >= 0.2)
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score);
}

/**
 * Apply a skill's rules to content and return labels
 */
export function applySkillRules(skill: typeof agentSkills.$inferSelect, content: string, metadata?: any): string[] {
  const rules = JSON.parse(skill.rules) as any;
  const outputLabels = skill.outputLabels ? JSON.parse(skill.outputLabels) as string[] : [];
  const labels: string[] = [];
  
  // Check each rule
  if (rules.conditions) {
    for (const condition of rules.conditions) {
      let matched = false;
      
      switch (condition.type) {
        case 'keyword':
          // Check if any keyword is present
          matched = condition.keywords?.some((kw: string) => content.includes(kw));
          break;
          
        case 'range':
          // Check numeric range (e.g., duration, price)
          if (metadata && condition.field && metadata[condition.field] !== undefined) {
            const value = metadata[condition.field];
            matched = value >= (condition.min ?? -Infinity) && value <= (condition.max ?? Infinity);
          }
          break;
          
        case 'pattern':
          // Check regex pattern
          if (condition.pattern) {
            const regex = new RegExp(condition.pattern, 'i');
            matched = regex.test(content);
          }
          break;
      }
      
      if (matched && condition.outputLabel) {
        labels.push(condition.outputLabel);
      }
    }
  }
  
  // If no specific conditions matched but keywords matched, use default output labels
  if (labels.length === 0 && outputLabels.length > 0) {
    const keywords = JSON.parse(skill.keywords) as string[];
    if (keywords.some(kw => content.includes(kw))) {
      labels.push(...outputLabels);
    }
  }
  
  return Array.from(new Set(labels)); // Remove duplicates
}

// ============================================
// Skill Application Logging
// ============================================

/**
 * Log a skill application
 */
export async function logSkillApplication(log: InsertSkillApplicationLog) {
  const db = await getDb();
  await db.insert(skillApplicationLogs).values(log);
}

/**
 * Get skill application history
 */
export async function getSkillApplicationHistory(skillId?: number, tourId?: number, limit = 50) {
  const db = await getDb();
  let query = db.select().from(skillApplicationLogs);
  
  if (skillId && tourId) {
    query = query.where(and(
      eq(skillApplicationLogs.skillId, skillId),
      eq(skillApplicationLogs.tourId, tourId)
    )) as any;
  } else if (skillId) {
    query = query.where(eq(skillApplicationLogs.skillId, skillId)) as any;
  } else if (tourId) {
    query = query.where(eq(skillApplicationLogs.tourId, tourId)) as any;
  }
  
  return query.orderBy(desc(skillApplicationLogs.appliedAt)).limit(limit);
}

// ============================================
// Learning Sessions
// ============================================

/**
 * Create a new learning session
 */
export async function createLearningSession(session: InsertLearningSession) {
  const db = await getDb();
  const result = await db.insert(learningSessions).values(session);
  return result[0].insertId;
}

/**
 * Update learning session status
 */
export async function updateLearningSession(id: number, updates: Partial<InsertLearningSession>) {
  const db = await getDb();
  await db.update(learningSessions).set(updates).where(eq(learningSessions.id, id));
}

/**
 * Get learning session by ID
 */
export async function getLearningSessionById(id: number) {
  const db = await getDb();
  const results = await db.select().from(learningSessions).where(eq(learningSessions.id, id));
  return results[0] || null;
}

/**
 * Get recent learning sessions
 */
export async function getRecentLearningSessions(limit = 20) {
  const db = await getDb();
  return db.select().from(learningSessions)
    .orderBy(desc(learningSessions.createdAt))
    .limit(limit);
}

// ============================================
// Built-in Skills Seeding
// ============================================

/**
 * Seed built-in skills if they don't exist
 */
export async function seedBuiltInSkills() {
  const db = await getDb();
  const existingSkills = await db.select().from(agentSkills).where(eq(agentSkills.isBuiltIn, true));
  
  if (existingSkills.length > 0) {
    console.log(`[SkillDb] ${existingSkills.length} built-in skills already exist`);
    return;
  }
  
  const builtInSkills: InsertAgentSkill[] = [
    // Feature Classification Skills
    {
      skillType: "feature_classification",
      skillName: "ESG 永續旅遊識別",
      skillNameEn: "ESG Sustainable Tourism",
      keywords: JSON.stringify(["ESG", "永續", "環保", "低碳", "CarboNZero", "碳中和", "綠色旅遊", "生態保育"]),
      rules: JSON.stringify({
        conditions: [
          { type: "keyword", keywords: ["ESG", "永續", "CarboNZero", "碳中和"], outputLabel: "ESG永續" },
          { type: "keyword", keywords: ["環保", "低碳", "綠色"], outputLabel: "環保旅遊" },
          { type: "keyword", keywords: ["生態保育", "保育"], outputLabel: "生態保育" }
        ]
      }),
      outputLabels: JSON.stringify(["ESG永續", "環保旅遊"]),
      description: "識別 ESG 永續旅遊相關行程，包含環境保護、社會責任、永續經濟等主題",
      isBuiltIn: true,
      isActive: true
    },
    {
      skillType: "feature_classification",
      skillName: "美食主題識別",
      skillNameEn: "Culinary Tourism",
      keywords: JSON.stringify(["美食", "料理", "餐廳", "米其林", "美饌", "饗宴", "品嚐", "風味餐"]),
      rules: JSON.stringify({
        conditions: [
          { type: "keyword", keywords: ["米其林", "星級餐廳"], outputLabel: "米其林美食" },
          { type: "keyword", keywords: ["美食", "料理", "美饌", "饗宴"], outputLabel: "美食之旅" },
          { type: "keyword", keywords: ["風味餐", "特色餐"], outputLabel: "特色餐食" }
        ]
      }),
      outputLabels: JSON.stringify(["美食之旅"]),
      description: "識別美食主題行程，包含米其林餐廳、當地特色料理等",
      isBuiltIn: true,
      isActive: true
    },
    {
      skillType: "feature_classification",
      skillName: "文化探索識別",
      skillNameEn: "Cultural Exploration",
      keywords: JSON.stringify(["文化", "遺產", "歷史", "博物館", "古蹟", "世界遺產", "UNESCO", "傳統"]),
      rules: JSON.stringify({
        conditions: [
          { type: "keyword", keywords: ["世界遺產", "UNESCO"], outputLabel: "世界遺產" },
          { type: "keyword", keywords: ["文化", "歷史", "古蹟"], outputLabel: "文化探索" },
          { type: "keyword", keywords: ["博物館", "美術館"], outputLabel: "藝文之旅" }
        ]
      }),
      outputLabels: JSON.stringify(["文化探索"]),
      description: "識別文化探索主題行程，包含世界遺產、歷史古蹟、博物館等",
      isBuiltIn: true,
      isActive: true
    },
    {
      skillType: "feature_classification",
      skillName: "自然生態識別",
      skillNameEn: "Nature & Wildlife",
      keywords: JSON.stringify(["生態", "國家公園", "野生動物", "自然", "健行", "冰川", "峽灣", "森林"]),
      rules: JSON.stringify({
        conditions: [
          { type: "keyword", keywords: ["國家公園", "自然保護區"], outputLabel: "國家公園" },
          { type: "keyword", keywords: ["野生動物", "動物"], outputLabel: "野生動物" },
          { type: "keyword", keywords: ["健行", "登山", "徒步"], outputLabel: "健行之旅" },
          { type: "keyword", keywords: ["冰川", "冰河"], outputLabel: "冰川探險" },
          { type: "keyword", keywords: ["峽灣"], outputLabel: "峽灣之旅" }
        ]
      }),
      outputLabels: JSON.stringify(["自然生態"]),
      description: "識別自然生態主題行程，包含國家公園、野生動物、健行等",
      isBuiltIn: true,
      isActive: true
    },
    
    // Transportation Type Skills
    {
      skillType: "transportation_type",
      skillName: "鐵道旅遊識別",
      skillNameEn: "Rail Tourism",
      keywords: JSON.stringify(["鐵道", "火車", "列車", "觀光列車", "高鐵", "新幹線", "TGV", "鐵路"]),
      rules: JSON.stringify({
        conditions: [
          { type: "keyword", keywords: ["觀光列車", "景觀列車"], outputLabel: "觀光列車" },
          { type: "keyword", keywords: ["鐵道", "火車", "列車", "鐵路"], outputLabel: "鐵道之旅" },
          { type: "keyword", keywords: ["高鐵", "新幹線", "TGV"], outputLabel: "高速鐵路" }
        ]
      }),
      outputLabels: JSON.stringify(["鐵道之旅"]),
      description: "識別鐵道旅遊主題行程，包含觀光列車、高速鐵路等",
      isBuiltIn: true,
      isActive: true
    },
    {
      skillType: "transportation_type",
      skillName: "郵輪旅遊識別",
      skillNameEn: "Cruise Tourism",
      keywords: JSON.stringify(["郵輪", "遊船", "峽灣遊船", "渡輪", "遊艇", "船"]),
      rules: JSON.stringify({
        conditions: [
          { type: "keyword", keywords: ["郵輪"], outputLabel: "郵輪之旅" },
          { type: "keyword", keywords: ["遊船", "峽灣遊船"], outputLabel: "遊船體驗" },
          { type: "keyword", keywords: ["渡輪"], outputLabel: "渡輪" }
        ]
      }),
      outputLabels: JSON.stringify(["郵輪之旅"]),
      description: "識別郵輪旅遊主題行程，包含郵輪、遊船等",
      isBuiltIn: true,
      isActive: true
    },
    
    // Tag Rule Skills
    {
      skillType: "tag_rule",
      skillName: "天數標籤規則",
      skillNameEn: "Duration Tag Rules",
      keywords: JSON.stringify(["天", "日", "晚"]),
      rules: JSON.stringify({
        conditions: [
          { type: "range", field: "duration", min: 10, outputLabel: "深度旅遊" },
          { type: "range", field: "duration", min: 7, max: 9, outputLabel: "經典行程" },
          { type: "range", field: "duration", min: 5, max: 6, outputLabel: "精選行程" },
          { type: "range", field: "duration", max: 4, outputLabel: "輕旅行" }
        ]
      }),
      outputLabels: JSON.stringify(["深度旅遊", "經典行程", "精選行程", "輕旅行"]),
      description: "根據行程天數自動生成對應標籤",
      isBuiltIn: true,
      isActive: true
    },
    {
      skillType: "tag_rule",
      skillName: "價格標籤規則",
      skillNameEn: "Price Tag Rules",
      keywords: JSON.stringify(["價格", "費用", "元"]),
      rules: JSON.stringify({
        conditions: [
          { type: "range", field: "price", min: 150000, outputLabel: "頂級奢華" },
          { type: "range", field: "price", min: 80000, max: 149999, outputLabel: "精緻行程" },
          { type: "range", field: "price", min: 50000, max: 79999, outputLabel: "品質優選" },
          { type: "range", field: "price", max: 30000, outputLabel: "超值優惠" }
        ]
      }),
      outputLabels: JSON.stringify(["頂級奢華", "精緻行程", "品質優選", "超值優惠"]),
      description: "根據行程價格自動生成對應標籤",
      isBuiltIn: true,
      isActive: true
    },
    
    // Highlight Detection Skills
    {
      skillType: "highlight_detection",
      skillName: "亮點活動識別",
      skillNameEn: "Highlight Detection",
      keywords: JSON.stringify(["特別安排", "獨家", "升等", "贈送", "入內參觀", "專屬", "限定"]),
      rules: JSON.stringify({
        conditions: [
          { type: "keyword", keywords: ["特別安排", "特別企劃"], outputLabel: "特別安排" },
          { type: "keyword", keywords: ["獨家", "專屬"], outputLabel: "獨家行程" },
          { type: "keyword", keywords: ["升等", "升級"], outputLabel: "升級服務" },
          { type: "keyword", keywords: ["贈送", "免費"], outputLabel: "贈送好禮" },
          { type: "keyword", keywords: ["入內參觀"], outputLabel: "深度體驗" }
        ]
      }),
      outputLabels: JSON.stringify(["特別安排", "獨家行程", "升級服務"]),
      description: "識別行程中的亮點活動和特殊安排",
      isBuiltIn: true,
      isActive: true
    },
    
    // Accommodation Type Skills
    {
      skillType: "accommodation_type",
      skillName: "住宿類型識別",
      skillNameEn: "Accommodation Type",
      keywords: JSON.stringify(["五星", "四星", "精品酒店", "度假村", "溫泉", "民宿", "特色住宿"]),
      rules: JSON.stringify({
        conditions: [
          { type: "keyword", keywords: ["五星", "5星", "奢華酒店"], outputLabel: "五星級住宿" },
          { type: "keyword", keywords: ["四星", "4星"], outputLabel: "四星級住宿" },
          { type: "keyword", keywords: ["溫泉", "溫泉酒店", "溫泉旅館"], outputLabel: "溫泉住宿" },
          { type: "keyword", keywords: ["度假村", "Resort"], outputLabel: "度假村" },
          { type: "keyword", keywords: ["特色住宿", "精品酒店", "設計酒店"], outputLabel: "特色住宿" }
        ]
      }),
      outputLabels: JSON.stringify(["五星級住宿", "溫泉住宿", "特色住宿"]),
      description: "識別行程中的住宿類型和等級",
      isBuiltIn: true,
      isActive: true
    }
  ];
  
  for (const skill of builtInSkills) {
    await db.insert(agentSkills).values(skill);
  }

  // Seed conversation skills (AI Chat knowledge base)
  const conversationSkills: InsertAgentSkill[] = chatSkillsData.map(s => ({
    skillType: s.skillType,
    skillCategory: s.skillCategory,
    skillName: s.skillName,
    skillNameEn: s.skillNameEn,
    keywords: s.keywords,
    rules: s.rules,
    outputLabels: s.outputLabels,
    description: s.description,
    isBuiltIn: true,
    isActive: true,
  }));

  for (const skill of conversationSkills) {
    await db.insert(agentSkills).values(skill);
  }

  console.log(`[SkillDb] Seeded ${builtInSkills.length} built-in skills + ${conversationSkills.length} conversation skills`);
}
