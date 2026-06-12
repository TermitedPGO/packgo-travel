/**
 * normalizePlatformCopy — v690 UAT B-04 fix.
 *
 * Some posterPlatformCopies rows carry a raw LLM JSON blob in copyText
 * (the generator's parse-failure fallback stored the whole raw string,
 * e.g. `{"text":"...","hashtags":[...]}`). Render-side tolerance: when
 * copyText looks like such an object, unwrap text/copyText + hashtags
 * (string or array); anything else passes through untouched.
 */
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
        const unwrapped =
          typeof o.copyText === "string"
            ? o.copyText
            : typeof o.text === "string"
              ? o.text
              : null;
        if (unwrapped != null) {
          text = unwrapped;
          if (!tags) {
            if (typeof o.hashtags === "string") {
              tags = o.hashtags;
            } else if (Array.isArray(o.hashtags)) {
              tags = o.hashtags
                .filter((s): s is string => typeof s === "string")
                .join(" ");
            }
          }
        }
      }
    } catch {
      // not actually JSON — keep the raw text as-is
    }
  }
  return { text, hashtags: tags };
}
