/**
 * normalizePlatformCopy — v690 UAT B-04 fix (+v691 重驗 extension).
 *
 * Some posterPlatformCopies rows carry a raw LLM JSON blob in copyText
 * (the generator's parse-failure fallback stored the whole raw string).
 * Observed shapes in prod:
 *   1. `{"text": "...", "hashtags": [...]}`
 *   2. `{"copyText": "...", "hashtags": "..."}`
 *   3. `{"platform": "Email Newsletter", "content": {"subject_line": "...",
 *      "body": "...", ...}}`  (v691 re-verify finding)
 * Render-side tolerance: unwrap the human text out of any of these;
 * anything unrecognisable passes through untouched (don't guess).
 */

/** String-valued copy fields, in display order, for shape-3 content objects. */
const CONTENT_TEXT_KEYS = [
  "subject_line",
  "subject",
  "preview_text",
  "greeting",
  "intro",
  "body",
  "body_text",
  "text",
  "copyText",
  "cta",
  "closing",
  "signature",
] as const;

function gatherContentText(o: Record<string, unknown>): string | null {
  const parts: string[] = [];
  for (const k of CONTENT_TEXT_KEYS) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) parts.push(v.trim());
    // bullet lists ({"highlights": ["a","b"]}) → one line per bullet
    else if (Array.isArray(v)) {
      const lines = v.filter(
        (s): s is string => typeof s === "string" && s.trim() !== "",
      );
      if (lines.length > 0) parts.push(lines.join("\n"));
    }
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

function extractTags(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v.filter((s): s is string => typeof s === "string").join(" ");
  }
  return "";
}

export function normalizePlatformCopy(
  copyText: string | null | undefined,
  hashtags?: string | null,
): { text: string; hashtags: string } {
  let text = copyText ?? "";
  let tags = hashtags ?? "";

  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const o = JSON.parse(trimmed) as Record<string, unknown>;
      if (o != null && typeof o === "object" && !Array.isArray(o)) {
        // shapes 1+2: direct text key
        let unwrapped =
          typeof o.copyText === "string"
            ? o.copyText
            : typeof o.text === "string"
              ? o.text
              : null;
        let embeddedTags = o.hashtags;

        // shape 3: nested content object (or content fields at top level)
        if (unwrapped == null) {
          const content =
            o.content != null &&
            typeof o.content === "object" &&
            !Array.isArray(o.content)
              ? (o.content as Record<string, unknown>)
              : o;
          unwrapped = gatherContentText(content);
          if (embeddedTags == null) embeddedTags = content.hashtags;
        }

        if (unwrapped != null) {
          text = unwrapped;
          if (!tags) tags = extractTags(embeddedTags);
        }
      }
    } catch {
      // not actually JSON — keep the raw text as-is
    }
  }
  return { text, hashtags: tags };
}
