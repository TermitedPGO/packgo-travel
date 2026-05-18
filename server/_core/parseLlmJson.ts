/**
 * parseLlmJson — defensive JSON.parse for LLM responses.
 *
 * v80.24: extracted from pdfParserAgent.ts and promoted to shared util.
 * The original bug class: Gemini 2.5 Flash + Claude sometimes wrap JSON in
 * ```json ... ``` fences even with response_format=json. They also prepend
 * explanatory text like "Here's the JSON:" or trailing commentary.
 *
 * Audit identified 6 places that still call raw `JSON.parse(llmResponse)`:
 *   - dateExtractorAgent.ts
 *   - claudeAgent.ts (Forge fallback x2)
 *   - learningAgent.ts
 *   - skillLearnerAgent.ts (x2)
 * Every one of those is a production crash if the LLM returns fenced JSON.
 *
 * Use this util at every site that does JSON.parse on LLM output.
 *
 * Behavior:
 * - Strips leading/trailing ``` fences (with optional `json` lang tag).
 * - Skips leading prose to find the first `{` or `[`.
 * - Trims trailing prose after the last `}` or `]`.
 * - Throws SyntaxError with the original raw content (truncated) for
 *   easier debugging than JSON.parse's default "Unexpected token..." error.
 */

const MAX_LOG_LEN = 500;

export function parseLlmJson<T = unknown>(raw: string): T {
  if (!raw || typeof raw !== "string") {
    throw new SyntaxError(`parseLlmJson: empty or non-string input (got ${typeof raw})`);
  }

  let s = raw.trim();

  // Strip leading fence: ```json\n  OR  ```\n  OR  ```JSON
  s = s.replace(/^```(?:json|JSON|JSON5)?\s*\r?\n?/, "");
  // Strip trailing fence: \n``` OR ``` (with optional whitespace)
  s = s.replace(/\r?\n?```\s*$/, "");

  // If still doesn't start with { or [, find the first JSON delimiter
  if (s.length > 0 && s[0] !== "{" && s[0] !== "[") {
    const firstBrace = s.indexOf("{");
    const firstBracket = s.indexOf("[");
    const start =
      firstBrace === -1
        ? firstBracket
        : firstBracket === -1
          ? firstBrace
          : Math.min(firstBrace, firstBracket);
    if (start > 0) {
      s = s.slice(start);
    }
  }

  // Trim trailing prose after the last } or ]
  if (s.length > 0) {
    const lastBrace = s.lastIndexOf("}");
    const lastBracket = s.lastIndexOf("]");
    const end = Math.max(lastBrace, lastBracket);
    if (end !== -1 && end < s.length - 1) {
      s = s.slice(0, end + 1);
    }
  }

  try {
    return JSON.parse(s) as T;
  } catch (err) {
    const truncated =
      raw.length > MAX_LOG_LEN ? `${raw.slice(0, MAX_LOG_LEN)}…` : raw;
    const wrapped = new SyntaxError(
      `parseLlmJson failed: ${(err as Error).message}. Raw input (first ${MAX_LOG_LEN} chars): ${truncated}`
    );
    // preserve original stack for easier debugging
    (wrapped as any).cause = err;
    throw wrapped;
  }
}

/**
 * Variant that returns null on parse failure instead of throwing.
 * Use sparingly — silent failure can mask real bugs. Prefer try/catch
 * around parseLlmJson in caller so you can decide what to do per-context.
 */
export function safeParseLlmJson<T = unknown>(raw: string): T | null {
  try {
    return parseLlmJson<T>(raw);
  } catch {
    return null;
  }
}
