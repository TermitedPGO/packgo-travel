/**
 * v2 Wave 3 Module 3.3 — SkillOrchestrator wrapper for tourComparison.
 *
 * Adapts `generateTourComparisonCatalog` to the canonical SkillOrchestrator
 * contract so the skill registry (module 3.2) can store it and the
 * auto-dispatcher (module 3.4) can call it generically.
 *
 * Why a separate file?
 *   The wrapper used to live at the bottom of `tourComparison.ts`, but
 *   same-module mocks via `vi.mock` don't intercept direct closure
 *   references inside the same file. Splitting the wrapper out means
 *   `vi.mock("./tourComparison")` correctly substitutes the catalog
 *   generator for tests of the orchestrator wrapper.
 *
 * Pipeline:
 *   1. Heuristic entity extraction (country + month + year) from
 *      `ctx.inquiry.intent` + `ctx.rawMessage` — LLM-free for v2; v3
 *      can swap in a thin extractor call if recall is weak.
 *   2. Call `generateTourComparisonCatalog` with the extracted request.
 *   3. Build a draft email body referencing the attached PDF.
 *   4. Return `{ ok: true, pdf, draftBody, meta }` — or
 *      `{ ok: false, needsJeff: true }` when extraction fails.
 */

import {
  generateTourComparisonCatalog,
  type CatalogRequest,
  type CatalogResult,
} from "./tourComparison";
import {
  safelyRun,
  type SkillContext,
  type SkillOrchestrator,
  type SkillResult,
} from "./orchestrator";

const MONTH_NAMES_INDEX = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Heuristic entity extraction. Returns null if we can't determine country
 * + month with reasonable confidence — the dispatcher then escalates to
 * Jeff rather than letting the agent guess.
 */
export function extractCatalogRequest(
  ctx: SkillContext,
): CatalogRequest | null {
  const haystack = `${ctx.inquiry.intent} ${ctx.rawMessage}`.toLowerCase();

  // Country detection. The /b word-boundary doesn't apply to CJK; use
  // unanchored CJK alternatives instead.
  let country: CatalogRequest["country"] | null = null;
  if (/japan|日本/.test(haystack)) country = "Japan";
  else if (/korea|韓國|韩国/.test(haystack)) country = "Korea";
  else if (/china|中國|中国/.test(haystack)) country = "China";
  else if (/europe|歐洲|欧洲/.test(haystack)) country = "Europe";
  else if (/\busa\b|\bus\b|america|美國|美国/.test(haystack))
    country = "United States";
  if (!country) return null;

  // Month: "9 月", "9月", "September", "Sept", "Sep" all match.
  let month: number | null = null;
  const monthMatch = haystack.match(
    /(\d{1,2})\s*月|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i,
  );
  if (monthMatch) {
    if (monthMatch[1]) {
      const m = Number(monthMatch[1]);
      if (m >= 1 && m <= 12) month = m;
    } else if (monthMatch[2]) {
      const idx = MONTH_NAMES_INDEX.findIndex((n) =>
        n.toLowerCase().startsWith(monthMatch[2]!.toLowerCase()),
      );
      if (idx >= 0) month = idx + 1;
    }
  }
  if (!month) return null;

  // Year — explicit YYYY wins; else current year, bumped if month
  // already passed this year.
  const yearMatch = haystack.match(/\b(20\d{2})\b/);
  let year: number;
  if (yearMatch) {
    year = Number(yearMatch[1]);
  } else {
    const now = new Date();
    year = now.getFullYear();
    if (month < now.getMonth() + 1) year += 1;
  }

  return {
    country,
    month,
    year,
    language: ctx.language === "en" ? "en" : "zh-TW",
  };
}

export function buildDraftBody(
  ctx: SkillContext,
  meta: CatalogResult["meta"],
): string {
  const isZh = ctx.language !== "en";
  if (isZh) {
    return [
      `您好,`,
      ``,
      `謝謝您對 ${meta.country}${meta.monthName} ${meta.year} 行程的詢問。我整理了 ${meta.optionsFound} 條精選路線供您參考,共有 ${meta.departuresFound} 個出發梯次可選,完整 PDF 已附上。`,
      ``,
      `請過目後告訴我:`,
      `1. 哪一條路線最接近您想要的玩法?`,
      `2. 預計出發日期 + 人數`,
      `3. 是否需要協助處理機票 / 簽證`,
      ``,
      `我會立即回覆您完整報價。`,
      ``,
      `PACK&GO Travel · Jeff & 團隊`,
    ].join("\n");
  }
  return [
    `Hi,`,
    ``,
    `Thanks for reaching out about ${meta.country} in ${meta.monthName} ${meta.year}. I've put together ${meta.optionsFound} curated itineraries with ${meta.departuresFound} departure dates to choose from — the full comparison PDF is attached.`,
    ``,
    `Once you've had a look, just let me know:`,
    `1. Which itinerary matches your style best?`,
    `2. Your preferred departure date + party size`,
    `3. Whether you'd like help with flights / visa`,
    ``,
    `I'll send you a complete quote right away.`,
    ``,
    `PACK&GO Travel · Jeff & team`,
  ].join("\n");
}

/**
 * Canonical orchestrator. Registered in `server/agents/skills/registry.ts`
 * (module 3.2) under `tour_comparison_request` + `new_inquiry` fallback.
 */
export const tourComparisonOrchestrator: SkillOrchestrator = {
  id: "packgo-tour-comparison",
  run: (ctx) =>
    safelyRun(ctx, async (c): Promise<SkillResult> => {
      const req = extractCatalogRequest(c);
      if (!req) {
        return {
          ok: false,
          reason:
            "Could not extract country + month from inquiry — escalate so Jeff can ask the customer.",
          needsJeff: true,
        };
      }
      const result = await generateTourComparisonCatalog(req);
      return {
        ok: true,
        pdf: result.pdf,
        draftBody: buildDraftBody(c, result.meta),
        meta: { ...result.meta, extractedRequest: req },
      };
    }),
};
