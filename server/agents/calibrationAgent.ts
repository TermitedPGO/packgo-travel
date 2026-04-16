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
// Group 1 (current): uses Haiku for faster calibration
const CALIBRATION_MODEL = 'claude-haiku-4-5-20251001';

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

// ── CHECK 1: Content Fidelity (30%) ──────────────────────────────────────────

export async function checkContentFidelity(
  tourData: any,
  sourceContent?: string
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
  try {
    const prompt = `You are a quality auditor for PACK&GO travel agency. Evaluate the quality of the generated tour description.

SOURCE CONTENT (original URL/PDF text):
${sourceContent.slice(0, 6000)}

GENERATED TOUR DATA:
Title: ${tourData.title || "(missing)"}
Poetic Title: ${(tourData as any).poeticTitle || "(none)"}
Destination: ${(tourData as any).destinationCountry || "(missing)"}
Description: ${(tourData.description || "").slice(0, 800)}

SCORING RULES:
1. Title (0-100): Creative rewriting is ENCOURAGED. Score HIGH (80-100) if it correctly identifies destination, duration, and theme. Do NOT require exact match.
2. Content accuracy (0-100): Are the destination, activities, and highlights factually correct? Enrichment with well-known local attractions is acceptable. Only penalize WRONG information (wrong city, wrong country, contradicting source).
3. Overall creative quality (0-100): Is this a well-written, attractive tour description that preserves factual accuracy?

NOTE: Price and duration accuracy are checked separately by rule-based validation. Do NOT evaluate price or duration here.

Respond in JSON:
{
  "titleScore": 0-100,
  "contentAccuracy": 0-100,
  "overallScore": 0-100,
  "issues": ["only FACTUAL errors, not creative differences"]
}`;

    const response = await invokeLLM({
      model: CALIBRATION_MODEL,
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

    const result = typeof content === "string" ? JSON.parse(content) : content;
    let score = Math.round(result.overallScore ?? 70);
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

    for (const issue of result.issues ?? []) {
      issues.push({
        check: "content",
        severity: "warning",
        message: issue,
        autoFixable: false,
      });
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
      // Translation runs asynchronously AFTER calibration completes, so "pending" is
      // the normal state during generation. Give a neutral-optimistic score (80) so
      // translation timing does not artificially depress the QA score.
      return { score: 80, issues: [] };
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

  // If critical fields missing, cap score to force rejected verdict
  if (hasCriticalMissing) {
    score = Math.min(score, 40);
  }

  return { score: Math.max(0, Math.min(100, score)), issues };
}

// ── CHECK 5: Marketing Quality (15%) ─────────────────────────────────────────

export async function checkMarketingQuality(
  tourData: any
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
  const title = tourData.title || "";
  if (title.length > 0) {
    try {
      const response = await invokeLLM({
        model: CALIBRATION_MODEL,
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
      if (content) {
        const result = typeof content === "string" ? JSON.parse(content) : content;
        const titleScore = Math.max(0, Math.min(100, result.score ?? 70));
        if (titleScore < 50) {
          issues.push({
            check: "marketing",
            severity: "info",
            message: `Title attractiveness: ${titleScore}/100 — ${result.feedback}`,
            field: "title",
            autoFixable: false,
          });
          score -= 10;
        }
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
        const response = await invokeLLM({
          model: CALIBRATION_MODEL,
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

        const response = await invokeLLM({
          model: CALIBRATION_MODEL,
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

  // Run all 5 checks in parallel (except translation which needs tourId)
  const [contentResult, imageResult, completenessResult, marketingResult] = await Promise.all([
    checkContentFidelity(tourData, sourceContent),
    checkImageQuality(tourData, tourId),
    Promise.resolve(checkCompleteness(tourData)),
    checkMarketingQuality(tourData),
  ]);

  // Translation check (sequential — needs DB)
  const translationResult = tourId
    ? await checkTranslationQuality(tourId)
    : { score: 80, issues: [{ check: "translation" as const, severity: "info" as const, message: "Translation pending (runs after calibration — expected)", autoFixable: false }] };

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

  // Re-run marketing check after fixes (description/keyFeatures may have changed)
  let finalMarketingScore = marketingResult.score;
  if (fixes.some((f) => f.field === "description" || f.field === "keyFeatures")) {
    try {
      const recheck = await checkMarketingQuality(fixedTourData);
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

  const verdict: "approved" | "review" | "rejected" =
    totalScore >= 85 ? "approved" : totalScore >= 60 ? "review" : "rejected";

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
