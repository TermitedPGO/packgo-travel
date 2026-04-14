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
    // No source to compare — give neutral score
    return { score: 70, issues: [] };
  }

  try {
    const prompt = `You are a quality auditor for a travel agency. Compare the generated tour data with the original source content.

SOURCE CONTENT (original PDF/URL text):
${sourceContent.slice(0, 3000)}

GENERATED TOUR DATA:
Title: ${tourData.title || "(missing)"}
Duration: ${tourData.duration || "(missing)"} days
Price: ${tourData.price || "(missing)"}
Description: ${(tourData.description || "").slice(0, 500)}

IMPORTANT ENRICHMENT RULE:
- When the source content has few or no structured attractions/landmarks but the generated tour adds well-known attractions that are geographically consistent with the itinerary stops, this is ACCEPTABLE ENRICHMENT, not a fidelity violation.
- A travel agency is expected to enrich bare itineraries with relevant local attractions.
- Only flag as a fidelity issue if the added content is factually WRONG (wrong city, wrong country) or contradicts the source.
- Do NOT penalize for adding more detail than the source — only penalize for adding INCORRECT detail.

Evaluate:
1. Does the title reflect the original itinerary? (0-100)
2. Is the price consistent? (within 10% tolerance)
3. Is the duration correct?
4. Overall fidelity score (0-100)

Respond in JSON:
{
  "titleScore": 0-100,
  "priceConsistent": true/false,
  "priceDeviation": 0-100 (percentage deviation),
  "durationCorrect": true/false,
  "overallScore": 0-100,
  "issues": ["issue1", "issue2"]
}`;

    const response = await invokeLLM({
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
              priceConsistent: { type: "boolean" },
              priceDeviation: { type: "number" },
              durationCorrect: { type: "boolean" },
              overallScore: { type: "number" },
              issues: { type: "array", items: { type: "string" } },
            },
            required: ["titleScore", "priceConsistent", "priceDeviation", "durationCorrect", "overallScore", "issues"],
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

    if (!result.priceConsistent && result.priceDeviation > 10) {
      issues.push({
        check: "content",
        severity: "critical",
        message: `Price deviation ${result.priceDeviation?.toFixed(0)}% from source`,
        field: "price",
        autoFixable: false,
      });
      score = Math.max(0, score - 20);
    }

    if (!result.durationCorrect) {
      issues.push({
        check: "content",
        severity: "critical",
        message: "Duration does not match source content",
        field: "duration",
        autoFixable: false,
      });
      score = Math.max(0, score - 20);
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
    return { score: 50, issues };
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
        messages: [
          {
            role: "system",
            content: "You are a travel marketing expert. Rate the attractiveness of this tour title on a scale of 0-100. Respond with only a JSON object.",
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
