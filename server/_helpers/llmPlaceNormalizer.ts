/**
 * llmPlaceNormalizer — Round 80.21 v11.
 *
 * When the static alias dictionary (`placeNameAliases.ts`) doesn't have
 * an entry for an OTA-style Chinese place name, fall back to a Claude
 * Haiku call. The LLM returns the standard Chinese + English forms
 * which we then add as final-tier geocoding candidates.
 *
 * Caching:
 *   - Redis with 30-day TTL (most place names don't change)
 *   - Cache key: `placealias:v1:{country}:{rawName}`
 *   - Result is small JSON {en, zh} — cheap to cache
 *
 * Cost: ~$0.001 per uncached query. With caching, after a few weeks
 * of organic traffic the LLM is rarely called (most queries hit cache).
 *
 * Future: a periodic batch job pre-populates the cache from existing
 * tour data (see `scripts/sweep-place-aliases.ts`).
 */

import { redis } from "../redis";
import { invokeLLM } from "../_core/llm";

const CACHE_PREFIX = "placealias:v1:";
const CACHE_TTL = 30 * 24 * 60 * 60; // 30 days
const NEGATIVE_CACHE_MARKER = "__NONE__"; // store this when LLM gives nothing

export interface LlmAlias {
  /** Standard English name (most reliable for Google geocoder) */
  en: string;
  /** Standard / canonical Chinese name */
  zh: string;
}

/**
 * Ask Claude Haiku to normalize a Chinese place name (typically an OTA
 * non-standard transliteration) into standard Chinese + English forms.
 *
 * @param rawName  the OTA / non-standard Chinese name (e.g. "蒙投")
 * @param countryHint  optional country context to disambiguate (e.g. "瑞士")
 * @returns  {en, zh} both filled when LLM has a confident answer; null
 *           when LLM doesn't know (cached as negative).
 */
export async function normalizePlaceName(
  rawName: string,
  countryHint?: string
): Promise<LlmAlias | null> {
  const trimmed = (rawName || "").trim();
  if (!trimmed) return null;
  const cacheKey = `${CACHE_PREFIX}${countryHint || "any"}:${trimmed}`;

  // Cache check
  try {
    const cached = await redis.get(cacheKey);
    if (cached === NEGATIVE_CACHE_MARKER) return null;
    if (cached) return JSON.parse(cached) as LlmAlias;
  } catch {
    /* redis unavailable — proceed to LLM */
  }

  // LLM call
  let parsed: LlmAlias | null = null;
  try {
    const sys = `You are a travel place name normalizer. The user gives you a Chinese place name (often a non-standard transliteration from a Taiwanese travel agency) and optionally a country. Your job: output the STANDARD Chinese name and STANDARD English name that Google Maps would recognize.

Output ONLY a single line of valid JSON, no markdown, no commentary:
{"en":"<English>","zh":"<Standard Chinese>"}

Rules:
- If you don't know the place or aren't confident → {"en":"","zh":""}
- "en" should be the name a Google geocoder would recognize (e.g. "Montreux", not "Montreux Switzerland")
- "zh" should be the canonical Chinese name used in Wikipedia / standard references
- For train routes / activities (not places) → {"en":"","zh":""}

Examples:
Input: 蒙投 (Country: 瑞士)
Output: {"en":"Montreux","zh":"蒙特勒"}

Input: 西庸古堡 (Country: 瑞士)
Output: {"en":"Château de Chillon","zh":"希永城堡"}

Input: 林島 (Country: 德國)
Output: {"en":"Lindau","zh":"林道"}

Input: 黃金列車 (Country: 瑞士)
Output: {"en":"","zh":""}  // train route, not a place

Input: 鬼屋 (Country: 日本)
Output: {"en":"","zh":""}  // ambiguous`;

    const userMsg = countryHint
      ? `${trimmed} (Country: ${countryHint})`
      : trimmed;

    const resp = await invokeLLM({
      model: "claude-haiku-4-5-20251001",
      maxTokens: 100,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userMsg },
      ],
    });
    const content = resp.choices[0]?.message?.content;
    if (typeof content === "string") {
      const stripped = content
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      try {
        const obj = JSON.parse(stripped);
        if (obj && typeof obj === "object" && (obj.en || obj.zh)) {
          parsed = { en: String(obj.en || ""), zh: String(obj.zh || "") };
        }
      } catch {
        /* invalid JSON from LLM — treat as no answer */
      }
    }
  } catch (err) {
    console.warn(
      `[llmPlaceNormalizer] LLM call failed for "${trimmed}":`,
      (err as Error).message
    );
  }

  // Cache result (positive or negative)
  try {
    if (parsed) {
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(parsed));
      console.log(
        `[llmPlaceNormalizer] resolved "${trimmed}" → en=${parsed.en} zh=${parsed.zh}`
      );
    } else {
      await redis.setex(cacheKey, CACHE_TTL, NEGATIVE_CACHE_MARKER);
    }
  } catch {
    /* redis unavailable — that's OK */
  }

  return parsed;
}

/**
 * Batch helper for the sweep script — pre-populates cache for many names.
 * Returns map of rawName → result (or null if no LLM answer).
 */
export async function normalizeBatch(
  names: string[],
  countryHint?: string
): Promise<Map<string, LlmAlias | null>> {
  const results = new Map<string, LlmAlias | null>();
  // Sequential calls to be polite to LLM API + simpler cache contention
  for (const name of names) {
    const alias = await normalizePlaceName(name, countryHint);
    results.set(name, alias);
  }
  return results;
}
