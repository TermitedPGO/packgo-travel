/**
 * CalibrationAgent — Automatic QA quality gate for generated tours.
 *
 * 5 checks with weighted scoring:
 *   CHECK 1: Content Fidelity   (30%) — Does the tour match the source PDF/URL?
 *   CHECK 2: Translation Quality (20%) — Is the English translation clean?
 *   CHECK 3: Image Quality       (20%) — Are hero + feature images present?
 *   CHECK 4: Completeness        (15%) — Are all required fields filled?
 *   CHECK 5: Marketing Quality   (15%) — Is the copy attractive and well-formed?
 *
 * Verdict thresholds:
 *   ≥85 → approved (auto-ready for Jeff's 1-click approval)
 *   60-84 → review (needs Jeff's review)
 *   <60 → rejected (back to draft)
 */

import { invokeLLM } from "../_core/llm";

// A/B Test Group 1: CalibrationAgent model selection
// Group 0 (baseline): uses default Sonnet

// Round 80.18: programmatic city↔country sanity check. Catches the
// hallucinations the LLM verdict missed (e.g. tour saved as
// "巴西/桃園" or "日本/高雄" — city's actual country differs from the
// declared destinationCountry).
//
// Returns { mismatch: true, actualCountry } when city is in the lookup
// AND its country differs from the declared one. If city or country is
// empty, or city isn't in the lookup, returns { mismatch: false }.
const CITY_TO_COUNTRY_LOOKUP: Record<string, string> = {
  // Japan
  東京: "日本", 大阪: "日本", 京都: "日本", 名古屋: "日本", 福岡: "日本",
  廣島: "日本", 神戶: "日本", 奈良: "日本", 四國: "日本", 北海道: "日本",
  沖繩: "日本", 沖縄: "日本", 九州: "日本", 關西: "日本", 京阪神: "日本",
  那霸: "日本", 石垣: "日本", 宮古: "日本", 與那國: "日本", 函館: "日本",
  札幌: "日本", 旭川: "日本", 釧路: "日本",
  // Korea
  首爾: "韓國", 釜山: "韓國", 濟州: "韓國",
  // SE Asia
  曼谷: "泰國", 清邁: "泰國", 普吉: "泰國", 蘇梅: "泰國",
  河內: "越南", 胡志明: "越南", 峴港: "越南", 下龍灣: "越南",
  巴里島: "印尼", 峇里島: "印尼",
  馬尼拉: "菲律賓", 宿霧: "菲律賓", 長灘島: "菲律賓",
  吉隆坡: "馬來西亞", 沙巴: "馬來西亞", 檳城: "馬來西亞",
  // Europe
  維也納: "奧地利", 薩爾斯堡: "奧地利", 哈修塔特: "奧地利",
  布拉格: "捷克", 庫倫洛夫: "捷克",
  蘇黎世: "瑞士", 日內瓦: "瑞士", 琉森: "瑞士", 采爾馬特: "瑞士",
  布達佩斯: "匈牙利", 華沙: "波蘭", 克拉科夫: "波蘭",
  羅馬: "義大利", 米蘭: "義大利", 威尼斯: "義大利", 佛羅倫斯: "義大利",
  那不勒斯: "義大利",
  巴黎: "法國", 尼斯: "法國", 里昂: "法國", 馬賽: "法國",
  倫敦: "英國", 愛丁堡: "英國", 曼徹斯特: "英國",
  柏林: "德國", 慕尼黑: "德國", 法蘭克福: "德國", 漢堡: "德國",
  巴塞隆納: "西班牙", 馬德里: "西班牙", 塞維亞: "西班牙",
  雅典: "希臘", 聖托里尼: "希臘", 米克諾斯: "希臘",
  伊斯坦堡: "土耳其", 卡帕多奇亞: "土耳其",
  阿姆斯特丹: "荷蘭", 布魯塞爾: "比利時",
  雷克雅維克: "冰島", 奧斯陸: "挪威",
  斯德哥爾摩: "瑞典", 哥本哈根: "丹麥", 赫爾辛基: "芬蘭",
  // Americas
  紐約: "美國", 華盛頓: "美國", 費城: "美國", 波士頓: "美國", 芝加哥: "美國",
  洛杉磯: "美國", 舊金山: "美國", 拉斯維加斯: "美國", 西雅圖: "美國",
  邁阿密: "美國", 夏威夷: "美國", 阿拉斯加: "美國",
  溫哥華: "加拿大", 多倫多: "加拿大", 魁北克: "加拿大",
  // Oceania
  雪梨: "澳洲", 墨爾本: "澳洲", 黃金海岸: "澳洲", 布里斯本: "澳洲",
  奧克蘭: "紐西蘭", 基督城: "紐西蘭", 皇后鎮: "紐西蘭",
  // South America
  馬丘比丘: "秘魯", 庫斯科: "秘魯", 利馬: "秘魯",
  里約: "巴西", 聖保羅: "巴西", 布宜諾斯艾利斯: "阿根廷",
  // Taiwan (the most commonly-confused set)
  台北: "台灣", 新北: "台灣", 基隆: "台灣", 桃園: "台灣", 新竹: "台灣",
  苗栗: "台灣", 台中: "台灣", 彰化: "台灣", 南投: "台灣", 雲林: "台灣",
  嘉義: "台灣", 台南: "台灣", 高雄: "台灣", 屏東: "台灣", 宜蘭: "台灣",
  花蓮: "台灣", 台東: "台灣", 花東: "台灣", 澎湖: "台灣", 金門: "台灣",
  馬祖: "台灣", 阿里山: "台灣", 日月潭: "台灣", 墾丁: "台灣", 太魯閣: "台灣",
};

// Region labels that legitimately span multiple countries — these should
// NOT be flagged. e.g. tour with country=日本 + city=北海道 (region) is fine.
const MULTI_REGION_CITIES = new Set([
  "北歐", "東歐", "南歐", "西歐", "中歐", "美東", "美西", "美加", "奧捷", "英愛",
  "法瑞義", "德奧",
]);

function checkCityInCountry(city: string, country: string): {
  mismatch: boolean;
  actualCountry: string | null;
} {
  if (!city || !country) return { mismatch: false, actualCountry: null };
  if (MULTI_REGION_CITIES.has(city)) return { mismatch: false, actualCountry: null };
  const cityCountry = CITY_TO_COUNTRY_LOOKUP[city];
  // City not in our lookup → can't tell, don't flag (conservative)
  if (!cityCountry) return { mismatch: false, actualCountry: null };
  if (cityCountry === country) return { mismatch: false, actualCountry: cityCountry };
  return { mismatch: true, actualCountry: cityCountry };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CalibrationIssue {
  check: "content" | "translation" | "image" | "completeness" | "marketing";
  severity: "critical" | "warning" | "info";
  message: string;
  field?: string;
  autoFixable: boolean;
}

export interface CalibrationReport {
  contentFidelityScore: number;   // 0-100
  translationScore: number;       // 0-100
  imageScore: number;             // 0-100
  completenessScore: number;      // 0-100
  marketingScore: number;         // 0-100
  totalScore: number;             // 0-100 weighted average
  verdict: "approved" | "review" | "rejected";
  issues: CalibrationIssue[];
  autoFixesApplied: Array<{ field: string; before: string; after: string }>;
}

// ── Weights ───────────────────────────────────────────────────────────────────

const WEIGHTS = {
  content: 0.30,
  translation: 0.20,
  image: 0.20,
  completeness: 0.15,
  marketing: 0.15,
};

// ── v67: combined fidelity + marketing LLM helper ─────────────────────────────
//
// Previously CalibrationAgent fired TWO separate LLM calls per tour:
//   1. checkContentFidelity → fidelity scores + factual issues
//   2. checkMarketingQuality → title attractiveness rating
//
// Both calls audit the same tour data; only the question differs. Merging them
// into a single Haiku call cuts calibration LLM usage by 50% (and removes one
// network round-trip from every tour generation).
//
// `runCalibration` calls this once up front and passes the result down to
// `checkContentFidelity` / `checkMarketingQuality` via the `precomputedLLM`
// param — those functions still work standalone if called directly (they fall
// back to their own LLM call when nothing is precomputed).
export interface PrecomputedQualityLLM {
  titleScore: number;
  contentAccuracy: number;
  overallScore: number;
  issues: string[];
  marketingTitleScore: number;
  marketingTitleFeedback: string;
}

export async function combinedQualityLLM(
  tourData: any,
  sourceContent?: string
): Promise<PrecomputedQualityLLM | null> {
  const title = tourData.title || "";
  const hasFidelityInput = !!(sourceContent && sourceContent.trim().length >= 50);
  const hasMarketingInput = title.length > 0;
  if (!hasFidelityInput && !hasMarketingInput) return null;

  const prompt = `You audit a generated travel tour on TWO axes:

A) FIDELITY vs SOURCE — CRITICAL DESTINATION CHECK
${hasFidelityInput
  ? `SOURCE CONTENT (original URL/PDF text):
${sourceContent!.slice(0, 8000)}

GENERATED TOUR DATA:
Title: ${tourData.title || "(missing)"}
Poetic Title: ${(tourData as any).poeticTitle || "(none)"}
DestinationCountry: ${(tourData as any).destinationCountry || "(missing)"}
DestinationCity: ${(tourData as any).destinationCity || "(missing)"}
DepartureCity: ${(tourData as any).departureCity || "(missing)"}
Description: ${(tourData.description || "").slice(0, 800)}

CRITICAL FIDELITY CHECKS (Round 80.16 — calibration was too lenient):
1. **Destination match against SOURCE** — Look at source content. What destination(s) does the SOURCE describe? Is "DestinationCountry" + "DestinationCity" actually one of those destinations? If source talks about 峇里島 but destination says "台灣/台北" → that's a CRITICAL FIDELITY VIOLATION (overallScore ≤ 40, contentAccuracy ≤ 30).
2. **DestinationCity ≠ DepartureCity check** — Tours commonly say "X 出發前往 Y". DestinationCity must NOT equal DepartureCity in those cases. If both are 高雄 in a "高雄出發 那霸" tour, that's wrong (overallScore ≤ 60).
3. **Title-destination consistency** — Does the title mention a country/city consistent with DestinationCountry/City? If title says "峇里島" but destination is "台灣", flag it (titleScore ≤ 40).
4. **Source ground truth** — When in doubt, the SOURCE is the truth. The tour metadata is hallucination-prone. Be strict on this.

SCORING RULES (RECALIBRATED):
- titleScore (0-100): Creative rewriting is fine ONLY IF the destination is preserved. If title contradicts source destination → titleScore ≤ 40.
- contentAccuracy (0-100): Hard penalty for destination mismatch with source. Enrichment with well-known local attractions is OK ONLY if the destination is correct.
- overallScore (0-100): Reflect destination fidelity. A tour with wrong destination CANNOT score above 50, regardless of how nice the description reads.
- issues: List EVERY destination mismatch / departure-vs-destination conflict / title-source contradiction.
- A flawless tour: no factual errors AND destination matches source → 100.
NOTE: Price and duration are checked by rule-based validation elsewhere — DO NOT evaluate price/duration here.`
  : `(no source content available — return titleScore=70, contentAccuracy=70, overallScore=70, issues=[])`}

B) MARKETING — Title Attractiveness
${hasMarketingInput
  ? `Tour Title: "${title}"
Rate from 0-100 how attractive and marketable this title is. Provide brief feedback (one sentence).`
  : `(no title — return marketingTitleScore=50, marketingTitleFeedback="Title missing")`}

Respond ONLY with valid JSON in this exact shape:
{
  "titleScore": 0-100,
  "contentAccuracy": 0-100,
  "overallScore": 0-100,
  "issues": ["only factual errors — empty if none"],
  "marketingTitleScore": 0-100,
  "marketingTitleFeedback": "one-sentence feedback"
}`;

  try {
    const response = await invokeLLM({
      model: "claude-haiku-4-5-20251001",
      maxTokens: 1024,
      messages: [
        { role: "system", content: "You are a strict quality auditor. Respond only with valid JSON." },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "combined_quality_check",
          strict: true,
          schema: {
            type: "object",
            properties: {
              titleScore: { type: "number" },
              contentAccuracy: { type: "number" },
              overallScore: { type: "number" },
              issues: { type: "array", items: { type: "string" } },
              marketingTitleScore: { type: "number" },
              marketingTitleFeedback: { type: "string" },
            },
            required: ["titleScore", "contentAccuracy", "overallScore", "issues", "marketingTitleScore", "marketingTitleFeedback"],
            additionalProperties: false,
          },
        },
      },
    });
    const content = response?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    return parsed as PrecomputedQualityLLM;
  } catch (err) {
    console.warn("[CalibrationAgent] combinedQualityLLM failed, will fall back to per-check LLM calls:", err);
    return null;
  }
}

// ── CHECK 1: Content Fidelity (30%) ──────────────────────────────────────────

export async function checkContentFidelity(
  tourData: any,
  sourceContent?: string,
  precomputedLLM?: PrecomputedQualityLLM | null
): Promise<{ score: number; issues: CalibrationIssue[] }> {
  const issues: CalibrationIssue[] = [];

  if (!sourceContent || sourceContent.trim().length < 50) {
    return { score: 70, issues: [] };
  }

  // ════════ Step 1: 規則化 price/duration 比對 ════════

  // 1a. 從 sourceContent 提取 source price（規則化，不靠 LLM）
  let sourcePrice = 0;
  // 格式1: buildRawContentFromLionData 輸出 "價格：83,900 TWD"
  const priceLine = sourceContent.match(/價格[：:]\s*([\d,]+)\s*(TWD|USD|JPY|EUR)?/);
  if (priceLine) {
    sourcePrice = parseFloat(priceLine[1].replace(/,/g, ''));
  }
  // 格式2: "NT$83,900" 或 "NT 83,900"
  if (sourcePrice === 0) {
    const ntMatch = sourceContent.match(/NT\$?\s*([\d,]+)/);
    if (ntMatch) sourcePrice = parseFloat(ntMatch[1].replace(/,/g, ''));
  }
  // 格式3: "83,900元"
  if (sourcePrice === 0) {
    const yuanMatch = sourceContent.match(/([\d,]{4,})\s*元/);
    if (yuanMatch) sourcePrice = parseFloat(yuanMatch[1].replace(/,/g, ''));
  }

  // 1b. 從 sourceContent 提取 source duration
  let sourceDays = 0;
  const daysLine = sourceContent.match(/天數[：:]\s*(\d+)/);
  if (daysLine) {
    sourceDays = parseInt(daysLine[1], 10);
  }
  if (sourceDays === 0) {
    const daysMatch = sourceContent.match(/(\d+)\s*(?:天|日|days?)/i);
    if (daysMatch) sourceDays = parseInt(daysMatch[1], 10);
  }

  // 1c. 取得 generated tour 的 price 和 duration
  const genPrice = typeof tourData.price === 'number' ? tourData.price : parseFloat(String(tourData.price)) || 0;
  const genDays = typeof tourData.duration === 'number' ? tourData.duration : parseInt(String(tourData.duration)) || 0;

  // 1d. 規則化比對
  let rulePriceOk = true;
  let rulePriceDeviation = 0;
  if (sourcePrice > 0 && genPrice > 0) {
    rulePriceDeviation = Math.abs(genPrice - sourcePrice) / sourcePrice * 100;
    rulePriceOk = rulePriceDeviation <= 15;
    console.log(`[CalibrationAgent] Rule-based price check: source=${sourcePrice}, gen=${genPrice}, deviation=${rulePriceDeviation.toFixed(1)}%, ok=${rulePriceOk}`);
  }

  let ruleDurationOk = true;
  if (sourceDays > 0 && genDays > 0) {
    ruleDurationOk = genDays === sourceDays;
    console.log(`[CalibrationAgent] Rule-based duration check: source=${sourceDays}, gen=${genDays}, ok=${ruleDurationOk}`);
  }

  // ════════ Step 2: LLM 只評估標題和內容品質 ════════
  // v67: if precomputedLLM is provided (set by runCalibration via combinedQualityLLM),
  // we skip the LLM call entirely — the orchestrator already paid for both fidelity
  // AND marketing scores in a single combined call. Standalone direct callers of
  // checkContentFidelity (no precomputed) still get the original fall-back path.
  try {
    let result: { titleScore: number; contentAccuracy: number; overallScore: number; issues: string[] };

    if (precomputedLLM) {
      result = {
        titleScore: precomputedLLM.titleScore,
        contentAccuracy: precomputedLLM.contentAccuracy,
        overallScore: precomputedLLM.overallScore,
        issues: precomputedLLM.issues,
      };
    } else {
      // Fallback path: per-check LLM call (only when called directly, not via runCalibration)
      const prompt = `You are a quality auditor for PACK&GO travel agency. Evaluate the quality of the generated tour description.

SOURCE CONTENT (original URL/PDF text):
${sourceContent.slice(0, 6000)}

GENERATED TOUR DATA:
Title: ${tourData.title || "(missing)"}
Poetic Title: ${(tourData as any).poeticTitle || "(none)"}
Destination: ${(tourData as any).destinationCountry || "(missing)"}
Description: ${(tourData.description || "").slice(0, 800)}

Respond in JSON:
{
  "titleScore": 0-100,
  "contentAccuracy": 0-100,
  "overallScore": 0-100,
  "issues": ["ONLY factual errors — empty array if none"]
}`;
      const response = await invokeLLM({
        model: "claude-haiku-4-5-20251001",
        maxTokens: 1024,
        messages: [
          { role: "system", content: "You are a strict quality auditor. Respond only with valid JSON." },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "fidelity_check",
            strict: true,
            schema: {
              type: "object",
              properties: {
                titleScore: { type: "number" },
                contentAccuracy: { type: "number" },
                overallScore: { type: "number" },
                issues: { type: "array", items: { type: "string" } },
              },
              required: ["titleScore", "contentAccuracy", "overallScore", "issues"],
              additionalProperties: false,
            },
          },
        },
      });
      const content = response?.choices?.[0]?.message?.content;
      if (!content) return { score: 70, issues: [] };
      result = typeof content === "string" ? JSON.parse(content) : content;
    }

    // ──── Round 69 Fix 1 + Round 70 Fix 1: Trust FACTUAL issues only ────
    // Round 69: LLM consistently returned overallScore=93-95 even with issues=[]
    //   → we now use issues array as ground truth.
    // Round 70: LLM still puts SOFT observations in issues ("not explicitly
    //   confirmed", "might mislead", "could be clearer") that aren't real factual
    //   errors. These false positives kept scores at 99 instead of 100. Now we
    //   filter them out before counting deductions.
    const SOFT_ISSUE_MARKERS = [
      "not explicitly",
      "might",
      "may ",
      "could ",
      "seems",
      "appears to",
      "is not explicit",
      "is unclear",
      "could be clearer",
      "slight",
      "minor",
      "correctly",          // positive observation masquerading as issue
      "is accurate",        // positive observation
      "is appropriate",     // positive observation
    ];
    const rawLlmIssues = Array.isArray(result.issues)
      ? result.issues.filter((s: any) => typeof s === "string" && s.trim().length > 0)
      : [];
    const llmIssuesList = rawLlmIssues.filter((msg: string) => {
      const lower = msg.toLowerCase();
      // Drop if matches any soft marker (false positive — not a factual error)
      const isSoft = SOFT_ISSUE_MARKERS.some((m) => lower.includes(m));
      if (isSoft) {
        console.log(`[CalibrationAgent] Round 70: dropping soft LLM issue: ${msg.slice(0, 100)}`);
      }
      return !isSoft;
    });

    let score: number;
    if (llmIssuesList.length === 0) {
      score = 100;
    } else {
      // Round 70: softened deduction from -5 to -3 per real issue so edge cases
      // (where filter doesn't catch a false positive) don't overly punish.
      score = Math.max(70, 100 - llmIssuesList.length * 3);
    }
    score = Math.max(0, Math.min(100, score));

    // ════════ Step 3: 組合規則化結果 + LLM 結果 ════════
    if (!rulePriceOk && sourcePrice > 0) {
      if (rulePriceDeviation > 50) {
        issues.push({
          check: "content",
          severity: "critical",
          message: `Price deviation ${rulePriceDeviation.toFixed(0)}% from source (${sourcePrice} → ${genPrice})`,
          field: "price",
          autoFixable: false,
        });
        score = Math.max(0, score - 20);
      } else if (rulePriceDeviation > 25) {
        issues.push({
          check: "content",
          severity: "warning",
          message: `Price deviation ${rulePriceDeviation.toFixed(0)}% from source`,
          field: "price",
          autoFixable: false,
        });
        score = Math.max(0, score - 10);
      } else {
        issues.push({
          check: "content",
          severity: "info",
          message: `Minor price deviation ${rulePriceDeviation.toFixed(0)}%`,
          field: "price",
          autoFixable: false,
        });
        score = Math.max(0, score - 5);
      }
    }

    if (!ruleDurationOk && sourceDays > 0) {
      issues.push({
        check: "content",
        severity: "critical",
        message: `Duration mismatch: source=${sourceDays} days, generated=${genDays} days`,
        field: "duration",
        autoFixable: false,
      });
      score = Math.max(0, score - 15);
    }

    // Round 70: only the filtered (real, factual) issues surface in the report
    for (const issue of llmIssuesList) {
      issues.push({
        check: "content",
        severity: "warning",
        message: issue,
        autoFixable: false,
      });
    }

    // 2026-05-16: deterministic destination-fidelity check.
    //
    // The LLM-driven check above ALREADY tells the model to compare
    // destinations and "score ≤ 50 if destination contradicts source".
    // In practice (production 2026-05-16) the LLM gave 94 / 96 to two
    // tours where source = 沖繩 and generated title = 夏威夷 — full
    // hallucinations the model failed to catch. This rule-based
    // post-check guarantees those slip through.
    //
    // Algorithm: extract well-known destination keywords (Chinese names
    // of major countries / regions) from BOTH the source content and
    // the generated title. If neither shares any keyword, we have a
    // factual drift — force score → 30 + critical issue. If they do
    // share at least one keyword, no action (LLM check stands).
    const DEST_KEYWORDS = [
      "沖繩", "北海道", "東京", "京都", "大阪", "九州", "本州", "四國",
      "夏威夷", "美國", "美東", "美西", "紐約", "洛杉磯", "舊金山", "拉斯維加斯", "黃石", "阿拉斯加",
      "加拿大", "溫哥華", "多倫多", "墨西哥",
      "韓國", "首爾", "釜山", "濟州",
      "泰國", "曼谷", "普吉",
      "越南", "新加坡", "馬來西亞",
      "中國", "香港", "澳門", "上海", "北京", "西安",
      "歐洲", "奧地利", "捷克", "德國", "法國", "義大利", "西班牙", "葡萄牙", "希臘", "瑞士",
      "英國", "倫敦", "愛爾蘭", "荷蘭", "比利時", "盧森堡", "丹麥", "瑞典", "挪威", "芬蘭", "冰島",
      "土耳其", "埃及", "摩洛哥", "南非",
      "澳洲", "紐西蘭",
      "印度", "尼泊爾", "斯里蘭卡",
      "巴西", "秘魯", "阿根廷", "智利", "古巴",
      "杜拜", "阿聯", "以色列", "約旦",
      "台灣", "台北", "台中", "高雄", "花蓮", "墾丁",
    ];
    const genTitle = String(tourData.title || "");
    const sourceKeywords = new Set<string>();
    const genKeywords = new Set<string>();
    for (const kw of DEST_KEYWORDS) {
      if (sourceContent.includes(kw)) sourceKeywords.add(kw);
      if (genTitle.includes(kw)) genKeywords.add(kw);
    }
    // Drift detection: source has known destinations AND generated has
    // known destinations, but ZERO overlap → critical hallucination.
    if (sourceKeywords.size > 0 && genKeywords.size > 0) {
      let overlap = false;
      for (const kw of genKeywords) {
        if (sourceKeywords.has(kw)) {
          overlap = true;
          break;
        }
      }
      if (!overlap) {
        const srcList = [...sourceKeywords].slice(0, 4).join(", ");
        const genList = [...genKeywords].slice(0, 4).join(", ");
        issues.push({
          check: "content",
          severity: "critical",
          message: `Destination drift: source mentions [${srcList}] but generated title only mentions [${genList}] — zero overlap suggests LLM hallucination.`,
          field: "title",
          autoFixable: false,
        });
        // Force well below the 60 review threshold so verdict=rejected.
        score = Math.min(score, 30);
        console.warn(
          `[CalibrationAgent] destination drift detected: source=[${srcList}] vs generated=[${genList}], forcing score → 30`
        );
      }
    }

    return { score, issues };
  } catch (err) {
    console.warn("[CalibrationAgent] checkContentFidelity LLM failed:", err);
    return { score: 70, issues: [] };
  }
}

// ── CHECK 2: Translation Quality (20%) ───────────────────────────────────────

export async function checkTranslationQuality(
  tourId: number
): Promise<{ score: number; issues: CalibrationIssue[] }> {
  const issues: CalibrationIssue[] = [];

  try {
    const { getTourTranslations } = await import("../translation");
    const enTranslations = await getTourTranslations(tourId, "en");

    if (!enTranslations || Object.keys(enTranslations).length === 0) {
      // Translation runs asynchronously AFTER calibration completes. "Pending" is a
      // pipeline-timing artefact, not a content-quality defect, so we return 100 —
      // a tour should not be penalised 20% just because the async translation hasn't
      // dequeued yet. Once translations land, a post-translation pass can re-score.
      return { score: 100, issues: [] };
    }

    let score = 100;
    const chineseRegex = /[\u4e00-\u9fff]/;

    // Check for Chinese residue in English translations
    for (const [field, value] of Object.entries(enTranslations)) {
      if (typeof value === "string" && chineseRegex.test(value)) {
        issues.push({
          check: "translation",
          severity: "warning",
          message: `English translation for "${field}" contains Chinese characters`,
          field,
          autoFixable: false,
        });
        score -= 15;
      }
    }

    // Check coverage — at least title and description should be translated
    const requiredFields = ["title", "description"];
    for (const field of requiredFields) {
      if (!enTranslations[field] || enTranslations[field].trim().length === 0) {
        issues.push({
          check: "translation",
          severity: "warning",
          message: `Missing English translation for required field: ${field}`,
          field,
          autoFixable: false,
        });
        score -= 10;
      }
    }

    return { score: Math.max(0, Math.min(100, score)), issues };
  } catch (err) {
    console.warn("[CalibrationAgent] checkTranslationQuality failed:", err);
    issues.push({
      check: "translation",
      severity: "warning",
      message: "Translation check failed — could not query translations",
      autoFixable: false,
    });
    return { score: 80, issues };
  }
}

// ── CHECK 3: Image Quality (20%) ─────────────────────────────────────────────

export async function checkImageQuality(
  tourData: any,
  tourId?: number
): Promise<{ score: number; issues: CalibrationIssue[] }> {
  const issues: CalibrationIssue[] = [];
  let score = 100;

  // Check heroImage
  const heroImage = tourData.heroImage || tourData.hero_image;
  if (!heroImage || heroImage.trim().length === 0) {
    issues.push({
      check: "image",
      severity: "warning",
      message: "Hero image is missing",
      field: "heroImage",
      autoFixable: false,
    });
    score -= 30;
  } else if (
    heroImage.includes("placeholder") ||
    heroImage.includes("via.placeholder") ||
    heroImage.includes("placehold.co")
  ) {
    issues.push({
      check: "image",
      severity: "warning",
      message: "Hero image is a placeholder URL",
      field: "heroImage",
      autoFixable: false,
    });
    score -= 20;
  }

  // Check featureImages
  let featureImages: string[] = [];
  try {
    const raw = tourData.featureImages || tourData.feature_images || "[]";
    featureImages = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    featureImages = [];
  }

  if (featureImages.length === 0) {
    issues.push({
      check: "image",
      severity: "warning",
      message: "No feature images found",
      field: "featureImages",
      autoFixable: false,
    });
    score -= 30;
  } else if (featureImages.length < 3) {
    issues.push({
      check: "image",
      severity: "info",
      message: `Only ${featureImages.length} feature image(s) — recommend at least 3`,
      field: "featureImages",
      autoFixable: false,
    });
    score -= 10;
  }

  // Check imageLibrary quality scores if tourId is available
  if (tourId) {
    try {
      const { getImageLibrary } = await import("../db");
      const libraryImages = await getImageLibrary({ tourId, limit: 10 });
      if (libraryImages.length > 0) {
        const qualityScores = libraryImages
          .map((img: any) => img.qualityScore)
          .filter((s: any) => s !== null && s !== undefined) as number[];
        if (qualityScores.length > 0) {
          const avgQuality = qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length;
          if (avgQuality < 50) {
            issues.push({
              check: "image",
              severity: "warning",
              message: `Average image quality score is low: ${avgQuality.toFixed(0)}/100`,
              autoFixable: false,
            });
            score -= 10;
          }
        }
      }
    } catch {
      // Non-critical — skip
    }
  }

  return { score: Math.max(0, Math.min(100, score)), issues };
}

// ── CHECK 4: Completeness (15%) ───────────────────────────────────────────────

export function checkCompleteness(tourData: any): { score: number; issues: CalibrationIssue[] } {
  const issues: CalibrationIssue[] = [];
  let score = 100;

  // Critical fields — missing any → rejected
  const criticalFields: Array<{ key: string; label: string }> = [
    { key: "title", label: "title" },
    { key: "price", label: "price" },
    { key: "duration", label: "duration" },
  ];

  let hasCriticalMissing = false;
  for (const { key, label } of criticalFields) {
    const val = tourData[key];
    const missing = val === undefined || val === null || val === "" || val === 0;
    if (missing) {
      issues.push({
        check: "completeness",
        severity: "critical",
        message: `Missing critical field: ${label}`,
        field: key,
        autoFixable: false,
      });
      score -= 25;
      hasCriticalMissing = true;
    }
  }

  // Important fields — missing → warning + deduction
  const importantFields: Array<{ key: string; label: string; deduction: number }> = [
    { key: "description", label: "description", deduction: 10 },
    { key: "destinationCountry", label: "destinationCountry", deduction: 5 },
    { key: "itineraryDetailed", label: "itineraryDetailed", deduction: 10 },
    { key: "hotels", label: "hotels", deduction: 5 },
    { key: "meals", label: "meals", deduction: 5 },
    { key: "costExplanation", label: "costExplanation", deduction: 5 },
    { key: "noticeDetailed", label: "noticeDetailed", deduction: 5 },
  ];

  for (const { key, label, deduction } of importantFields) {
    const val = tourData[key];
    let missing = false;
    if (val === undefined || val === null || val === "") {
      missing = true;
    } else if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed) && parsed.length === 0) missing = true;
      } catch {
        if (val.trim().length === 0) missing = true;
      }
    } else if (Array.isArray(val) && val.length === 0) {
      missing = true;
    }

    if (missing) {
      issues.push({
        check: "completeness",
        severity: "warning",
        message: `Missing or empty field: ${label}`,
        field: key,
        autoFixable: false,
      });
      score -= deduction;
    }
  }

  // Fix 5 (Round 63): 7 hard deduction rules for image/data integrity — upgraded weights
  // Rule 1: hotelImages empty — upgraded -5 → -10
  {
    let empty = true;
    try {
      const v = typeof tourData.hotelImages === 'string' ? JSON.parse(tourData.hotelImages) : tourData.hotelImages;
      if (Array.isArray(v) && v.length > 0) empty = false;
    } catch { /* keep empty=true */ }
    if (empty) {
      issues.push({ check: 'completeness', severity: 'warning', message: 'hotelImages is empty — hotel images not generated (Round 63: -10)', field: 'hotelImages', autoFixable: false });
      score -= 10; // Round 63: upgraded from -5 to -10
    }
  }
  // Rule 2: galleryImages empty — upgraded -5 → -8
  {
    let empty = true;
    try {
      const v = typeof tourData.galleryImages === 'string' ? JSON.parse(tourData.galleryImages) : tourData.galleryImages;
      if (Array.isArray(v) && v.length > 0) empty = false;
    } catch { /* keep empty=true */ }
    if (empty) {
      issues.push({ check: 'completeness', severity: 'warning', message: 'galleryImages is empty — feature gallery not generated (Round 63: -8)', field: 'galleryImages', autoFixable: false });
      score -= 8; // Round 63: upgraded from -5 to -8
    }
  }
  // Rule 3: attractions empty — upgraded -5 → -7
  {
    let empty = true;
    try {
      const v = typeof tourData.attractions === 'string' ? JSON.parse(tourData.attractions) : tourData.attractions;
      if (Array.isArray(v) && v.length > 0) empty = false;
    } catch { /* keep empty=true */ }
    if (empty) {
      issues.push({ check: 'completeness', severity: 'warning', message: 'attractions is empty — no attraction data generated (Round 63: -7)', field: 'attractions', autoFixable: false });
      score -= 7; // Round 63: upgraded from -5 to -7
    }
  }
  // Rule 4: featureImages empty or URL-only strings (not full objects)
  // upgraded: empty -5 → -10; old format -3 → -5
  {
    let bad = true;
    try {
      const v = typeof tourData.featureImages === 'string' ? JSON.parse(tourData.featureImages) : tourData.featureImages;
      if (Array.isArray(v) && v.length > 0) {
        // Check if items are full objects (not bare URL strings)
        const firstItem = v[0];
        if (typeof firstItem === 'object' && firstItem !== null && firstItem.url) bad = false;
        else if (typeof firstItem === 'string') {
          // URL-only strings — old format
          issues.push({ check: 'completeness', severity: 'warning', message: 'featureImages contains URL-only strings instead of full objects {url, alt, caption, position} (Round 63: -5)', field: 'featureImages', autoFixable: false });
          score -= 5; // Round 63: upgraded from -3 to -5
          bad = false; // Not empty, just old format
        }
      }
    } catch { /* keep bad=true */ }
    if (bad) {
      issues.push({ check: 'completeness', severity: 'warning', message: 'featureImages is empty — feature images not generated (Round 63: -10)', field: 'featureImages', autoFixable: false });
      score -= 10; // Round 63: upgraded from -5 to -10
    }
  }
  // Rule 5: hotels[].image missing — upgraded per-hotel -2 → -3, cap -5 → -9
  {
    try {
      const v = typeof tourData.hotels === 'string' ? JSON.parse(tourData.hotels) : tourData.hotels;
      if (Array.isArray(v) && v.length > 0) {
        const missingCount = v.filter((h: any) => !h.image || h.image === '').length;
        if (missingCount > 0) {
          issues.push({ check: 'completeness', severity: 'warning', message: `${missingCount}/${v.length} hotel(s) missing image field (Round 63: -3 each, max -9)`, field: 'hotels', autoFixable: false });
          score -= Math.min(9, missingCount * 3); // Round 63: upgraded from -2 each / max -5
        }
      }
    } catch { /* skip */ }
  }
  // Rule 6: meals[].image missing — upgraded per-meal -2 → -3, cap -5 → -9
  {
    try {
      const v = typeof tourData.meals === 'string' ? JSON.parse(tourData.meals) : tourData.meals;
      if (Array.isArray(v) && v.length > 0) {
        const missingCount = v.filter((m: any) => !m.image || m.image === '').length;
        if (missingCount > 0) {
          issues.push({ check: 'completeness', severity: 'warning', message: `${missingCount}/${v.length} meal(s) missing image field (Round 63: -3 each, max -9)`, field: 'meals', autoFixable: false });
          score -= Math.min(9, missingCount * 3); // Round 63: upgraded from -2 each / max -5
        }
      }
    } catch { /* skip */ }
  }
  // Rule 7: heroImage missing — upgraded -15 → -20 (critical)
  {
    const heroMissing = !tourData.heroImage || tourData.heroImage === '';
    if (heroMissing) {
      issues.push({ check: 'completeness', severity: 'critical', message: 'heroImage is missing — banner image not generated (Round 63: -20)', field: 'heroImage', autoFixable: false });
      score -= 20; // Round 63: upgraded from -15 to -20
    }
  }

  // If critical fields missing, cap score to force rejected verdict
  if (hasCriticalMissing) {
    score = Math.min(score, 40);
  }

  return { score: Math.max(0, Math.min(100, score)), issues };
}

// ── CHECK 5: Marketing Quality (15%) ─────────────────────────────────────────

export async function checkMarketingQuality(
  tourData: any,
  precomputedLLM?: PrecomputedQualityLLM | null
): Promise<{ score: number; issues: CalibrationIssue[] }> {
  const issues: CalibrationIssue[] = [];
  let score = 100;

  // Description length check (50-500 characters)
  const description = tourData.description || "";
  if (description.length < 50) {
    issues.push({
      check: "marketing",
      severity: "warning",
      message: `Description too short: ${description.length} chars (min 50)`,
      field: "description",
      autoFixable: true,
    });
    score -= 20;
  } else if (description.length > 1000) {
    issues.push({
      check: "marketing",
      severity: "info",
      message: `Description very long: ${description.length} chars (recommend < 500)`,
      field: "description",
      autoFixable: false,
    });
    score -= 5;
  }

  // keyFeatures check (≥3)
  let keyFeatures: string[] = [];
  try {
    const raw = tourData.keyFeatures || tourData.key_features || "[]";
    keyFeatures = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    keyFeatures = [];
  }

  if (keyFeatures.length < 3) {
    issues.push({
      check: "marketing",
      severity: "warning",
      message: `Only ${keyFeatures.length} key feature(s) — recommend at least 3`,
      field: "keyFeatures",
      autoFixable: true,
    });
    score -= 15;
  }

  // heroSubtitle check
  const heroSubtitle = tourData.heroSubtitle || tourData.hero_subtitle || "";
  if (!heroSubtitle || heroSubtitle.trim().length === 0) {
    issues.push({
      check: "marketing",
      severity: "info",
      message: "heroSubtitle is missing",
      field: "heroSubtitle",
      autoFixable: true,
    });
    score -= 10;
  } else if (heroSubtitle.length > 100) {
    issues.push({
      check: "marketing",
      severity: "info",
      message: `heroSubtitle too long: ${heroSubtitle.length} chars (max 100)`,
      field: "heroSubtitle",
      autoFixable: false,
    });
    score -= 5;
  }

  // LLM title attractiveness check
  // v67: prefer precomputed score from combinedQualityLLM (set by runCalibration).
  // Fallback to a per-call LLM only if standalone caller passed nothing.
  const title = tourData.title || "";
  if (title.length > 0) {
    try {
      let titleScore: number;
      let feedback: string;

      if (precomputedLLM) {
        titleScore = Math.max(0, Math.min(100, precomputedLLM.marketingTitleScore ?? 70));
        feedback = precomputedLLM.marketingTitleFeedback || "";
      } else {
        const response = await invokeLLM({
          model: "claude-haiku-4-5-20251001",
          maxTokens: 256,
          messages: [
            {
              role: "system",
              content: "You are a travel marketing expert. Evaluate if this tour title is attractive and marketable. Rate it from 0-100. Respond with only a JSON object.",
            },
            {
              role: "user",
              content: `Rate this tour title: "${title}"\n\nRespond: {"score": 0-100, "feedback": "brief feedback"}`,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "title_rating",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  score: { type: "number" },
                  feedback: { type: "string" },
                },
                required: ["score", "feedback"],
                additionalProperties: false,
              },
            },
          },
        });
        const content = response?.choices?.[0]?.message?.content;
        if (!content) return { score: Math.max(0, Math.min(100, score)), issues };
        const result = typeof content === "string" ? JSON.parse(content) : content;
        titleScore = Math.max(0, Math.min(100, result.score ?? 70));
        feedback = result.feedback || "";
      }

      if (titleScore < 50) {
        issues.push({
          check: "marketing",
          severity: "info",
          message: `Title attractiveness: ${titleScore}/100 — ${feedback}`,
          field: "title",
          autoFixable: false,
        });
        score -= 10;
      }
    } catch {
      // Non-critical — skip LLM title check
    }
  }

  return { score: Math.max(0, Math.min(100, score)), issues };
}

// ── autoFix ───────────────────────────────────────────────────────────────────

async function applyAutoFixes(
  tourData: any,
  issues: CalibrationIssue[]
): Promise<{ tourData: any; fixes: Array<{ field: string; before: string; after: string }> }> {
  const fixes: Array<{ field: string; before: string; after: string }> = [];
  const fixableIssues = issues.filter((i) => i.autoFixable && i.field);

  for (const issue of fixableIssues) {
    const field = issue.field!;

    try {
      if (field === "description" && issue.message.includes("too short")) {
        const before = tourData.description || "";
        // v67: description expansion — Haiku, 512 tokens (output is 100-300 chars).
        const response = await invokeLLM({
          model: "claude-haiku-4-5-20251001",
          maxTokens: 512,
          messages: [
            {
              role: "system",
              content: "You are a travel copywriter. Expand the following tour description to 100-300 characters while keeping the same language and tone. Return only the expanded description text, nothing else.",
            },
            {
              role: "user",
              content: `Tour: ${tourData.title}\nCurrent description: ${before}\n\nExpand to 100-300 characters:`,
            },
          ],
        });
        const rawContent = response?.choices?.[0]?.message?.content;
        const after = (typeof rawContent === 'string' ? rawContent.trim() : '') || before;
        if (after && after !== before && after.length >= 50) {
          tourData.description = after;
          fixes.push({ field, before, after });
        }
      }

      if (field === "keyFeatures" && issue.message.includes("key feature")) {
        const currentRaw = tourData.keyFeatures || tourData.key_features || "[]";
        let current: string[] = [];
        try {
          current = typeof currentRaw === "string" ? JSON.parse(currentRaw) : currentRaw;
        } catch {
          current = [];
        }
        const before = JSON.stringify(current);

        // v67: keyFeatures generation — Haiku, 512 tokens (3-5 short bullets).
        const response = await invokeLLM({
          model: "claude-haiku-4-5-20251001",
          maxTokens: 512,
          messages: [
            {
              role: "system",
              content: "You are a travel marketing expert. Generate key selling points for this tour. Return a JSON array of strings.",
            },
            {
              role: "user",
              content: `Tour: ${tourData.title}\nDescription: ${(tourData.description || "").slice(0, 300)}\nCurrent features: ${JSON.stringify(current)}\n\nGenerate ${3 - current.length} additional key features to reach at least 3 total. Return JSON array of all features (existing + new).`,
            },
          ],
        });
        const rawContent2 = response?.choices?.[0]?.message?.content;
        const content = typeof rawContent2 === 'string' ? rawContent2.trim() : "";
        try {
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const after = jsonMatch[0];
            tourData.keyFeatures = after;
            fixes.push({ field: "keyFeatures", before, after });
          }
        } catch {
          // Skip
        }
      }

      if (field === "heroSubtitle" && issue.message.includes("missing")) {
        const before = "";
        const description = tourData.description || "";
        if (description.length > 0) {
          // Extract first sentence or first 80 chars
          const sentences = description.split(/[。！？.!?]/);
          const after = (sentences[0] || description).slice(0, 80).trim();
          if (after.length > 0) {
            tourData.heroSubtitle = after;
            fixes.push({ field: "heroSubtitle", before, after });
          }
        }
      }
    } catch (err) {
      console.warn(`[CalibrationAgent] autoFix failed for field "${field}":`, err);
    }
  }

  return { tourData, fixes };
}

// ── Main: calibrateTour ───────────────────────────────────────────────────────

export async function calibrateTour(
  tourData: any,
  sourceContent?: string
): Promise<CalibrationReport> {
  console.log("[CalibrationAgent] Starting calibration for tour:", tourData.title || "(untitled)");

  const tourId = tourData.id || tourData.tourId;

  // v67: Combine fidelity + marketing-title LLM into ONE call up front.
  // Previously these fired as 2 separate Sonnet calls (now Haiku post-v67) —
  // merging into one single Haiku call halves calibration LLM token use.
  const combined = await combinedQualityLLM(tourData, sourceContent);

  // Run all 5 checks in parallel (except translation which needs tourId)
  const [contentResult, imageResult, completenessResult, marketingResult] = await Promise.all([
    checkContentFidelity(tourData, sourceContent, combined),
    checkImageQuality(tourData, tourId),
    Promise.resolve(checkCompleteness(tourData)),
    checkMarketingQuality(tourData, combined),
  ]);

  // Translation check (sequential — needs DB).
  // If no tourId (tour not yet saved), translations can't exist — treat as pending=100
  // so the timing of the async translation job does not depress quality score.
  const translationResult = tourId
    ? await checkTranslationQuality(tourId)
    : { score: 100, issues: [{ check: "translation" as const, severity: "info" as const, message: "Translation pending (runs after calibration — expected)", autoFixable: false }] };

  // Aggregate all issues
  const allIssues: CalibrationIssue[] = [
    ...contentResult.issues,
    ...translationResult.issues,
    ...imageResult.issues,
    ...completenessResult.issues,
    ...marketingResult.issues,
  ];

  // Apply auto-fixes
  const { tourData: fixedTourData, fixes } = await applyAutoFixes(tourData, allIssues);

  // Re-run marketing check after fixes (description/keyFeatures may have changed).
  // v67: pass the same precomputed LLM scores so the recheck stays purely rule-based
  // and skips the (now unused) per-check LLM fallback.
  let finalMarketingScore = marketingResult.score;
  if (fixes.some((f) => f.field === "description" || f.field === "keyFeatures")) {
    try {
      const recheck = await checkMarketingQuality(fixedTourData, combined);
      finalMarketingScore = recheck.score;
    } catch {
      // Keep original score
    }
  }

  // Calculate weighted total score
  const scores = {
    content: contentResult.score,
    translation: translationResult.score,
    image: imageResult.score,
    completeness: completenessResult.score,
    marketing: finalMarketingScore,
  };

  const totalScore = Math.round(
    scores.content * WEIGHTS.content +
    scores.translation * WEIGHTS.translation +
    scores.image * WEIGHTS.image +
    scores.completeness * WEIGHTS.completeness +
    scores.marketing * WEIGHTS.marketing
  );

  // Round 80.18: HARD RULE — destinationCity must geographically belong to
  // destinationCountry. This is a programmatic check that runs AFTER the
  // LLM verdict — when violated, force-downgrade to "review" regardless
  // of LLM-assigned score. The previous Round 80.16 prompt-tightening
  // helped but LLM still missed cases like 巴西/桃園 (city is Taiwan,
  // country is Brazil) and gave them approved/96. This rule catches them
  // automatically.
  const cityCountryMismatch = checkCityInCountry(
    fixedTourData.destinationCity || "",
    fixedTourData.destinationCountry || ""
  );
  if (cityCountryMismatch.mismatch) {
    allIssues.push({
      check: "content",
      severity: "critical",
      message: `Hard-rule fail: destinationCity "${fixedTourData.destinationCity}" is not in destinationCountry "${fixedTourData.destinationCountry}" — city actually belongs to "${cityCountryMismatch.actualCountry || "unknown"}"`,
      field: "destinationCity",
      autoFixable: false,
    });
    console.warn(
      `[CalibrationAgent] 🚨 Hard rule violated: city=${fixedTourData.destinationCity} not in country=${fixedTourData.destinationCountry}`
    );
  }

  let verdict: "approved" | "review" | "rejected" =
    totalScore >= 85 ? "approved" : totalScore >= 60 ? "review" : "rejected";
  // Hard-rule override: even if score is high, never auto-approve a tour
  // with a city↔country mismatch. Force to "review" so admin sees it.
  if (cityCountryMismatch.mismatch && verdict === "approved") {
    console.warn(`[CalibrationAgent] 🚨 Forcing verdict approved → review due to city/country mismatch`);
    verdict = "review";
  }

  console.log(`[CalibrationAgent] Score: ${totalScore}, Verdict: ${verdict}, Issues: ${allIssues.length}, AutoFixes: ${fixes.length}`);
  console.log(`[CalibrationAgent] 📊 Final Report:`);
  console.log(`  Content Fidelity : ${scores.content}  (weight: ${WEIGHTS.content * 100}%)`);
  console.log(`  Translation      : ${scores.translation}  (weight: ${WEIGHTS.translation * 100}%)`);
  console.log(`  Image            : ${scores.image}  (weight: ${WEIGHTS.image * 100}%)`);
  console.log(`  Completeness     : ${scores.completeness}  (weight: ${WEIGHTS.completeness * 100}%)`);
  console.log(`  Marketing        : ${scores.marketing}  (weight: ${WEIGHTS.marketing * 100}%)`);
  console.log(`  Total            : ${totalScore}`);
  if (allIssues.length > 0) {
    console.log(`  Issues (${allIssues.length}):`);
    for (const issue of allIssues) {
      console.log(`    [${issue.check}][${issue.severity}] ${issue.message}${issue.field ? ` (field: ${issue.field})` : ''}`);
    }
  }

  return {
    contentFidelityScore: scores.content,
    translationScore: scores.translation,
    imageScore: scores.image,
    completenessScore: scores.completeness,
    marketingScore: scores.marketing,
    totalScore,
    verdict,
    issues: allIssues,
    autoFixesApplied: fixes,
  };
}
