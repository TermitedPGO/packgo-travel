/**
 * plainTextReply — 客人回覆草稿的純文字清洗(2026-06-13)。
 *
 * 起因:InquiryAgent 產的草稿含 markdown `**粗體**`,寄成純文字 email 後
 * 客人看到的是字面星號(prod 截圖:「**YG7 和 YL7 兩個團的差別**」)。
 * 違反 Jeff 客人訊息風格(memory: feedback_no_markdown_bold —
 * 不用 ** 標記;feedback_packgo_customer_msg_style — 不官方、口語)。
 *
 * 系統提示已叫 LLM 別產 markdown,但 LLM 偶爾無視 — 這道程式層清洗是
 * 「絕對到不了客人」的保證:任何進客人信箱的草稿都先過這裡。
 *
 * 2026-06-25:同一道出口再加「破折號正規化」。Jeff 鐵律:客人訊息不用破折號
 * (—)。系統提示有講,但 LLM 仍偶爾吐出(prod AFTER 測試:Leslie 草稿
 * "arrives—expecting")。em/en/橫線在這裡一律換成逗號(夾在數字間的視為範圍
 * → ASCII 連字號)。永不動 ASCII 連字號(-,複合字/範圍如 1-2、台北-上海)。
 *
 * 純函式,可單測。
 */

/**
 * Strip the markdown that renders as literal noise in a plain-text email,
 * leaving the human text intact. Conservative on purpose: only touches
 * unambiguous markdown syntax, never Chinese punctuation or hyphenated
 * compounds.
 */
export function stripMarkdownForEmail(input: string | null | undefined): string {
  if (!input) return "";
  let s = input;

  // Fenced code blocks ```...``` → keep the inner text, drop the fences.
  s = s.replace(/```[a-zA-Z]*\n?([\s\S]*?)```/g, "$1");
  // Inline code `x` → x
  s = s.replace(/`([^`\n]+)`/g, "$1");

  // Links [text](url) → "text (url)" so the URL survives in plain text;
  // bare-text links [text]() → text.
  s = s.replace(/\[([^\]]+)\]\(([^)]*)\)/g, (_m, text, url) =>
    url && url.trim() ? `${text} (${url.trim()})` : text,
  );
  // Images ![alt](url) → alt (drop the image marker)
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Bold / italic. Run bold (** / __) before single (* / _) so we don't
  // leave a dangling marker. Require non-space adjacency so we don't eat a
  // lone asterisk used as a literal bullet star or math.
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, "$1");
  s = s.replace(/__([^_\n]+?)__/g, "$1");
  s = s.replace(/\*([^*\n]+?)\*/g, "$1");
  // Single-underscore italic only when word-bounded (避免吃 email/變數名的底線)
  s = s.replace(/(^|[\s(])_([^_\n]+?)_(?=[\s.,;:!?)]|$)/g, "$1$2");

  // Headers: leading #'s on a line → drop the #'s (keep the heading text).
  s = s.replace(/^#{1,6}\s+/gm, "");

  // Bullet markers at line start: "- " / "* " / "+ " → "・" (Jeff 的清單用
  // 全形點,不用 markdown dash-bullet;不影響句中連字號).
  s = s.replace(/^\s*[-*+]\s+/gm, "・");

  // Markdown horizontal rule line (--- / *** / ___) on its own → blank.
  s = s.replace(/^\s*([-*_])\1{2,}\s*$/gm, "");

  // Em / en / horizontal-bar dashes (—–―) are NOT part of Jeff's customer
  // style (hard rule: no em dashes in any customer text). The system prompt
  // forbids them but the LLM still emits them. Normalize so none reaches a
  // customer. Order matters:
  //   1. digit–digit is a numeric range → ASCII hyphen ("US$174–226" → "-")
  //   2. CJK on both sides → full-width comma, no spaces ("行程——報價" → "，")
  //   3. any remaining em/en/bar dash is a clause break → ", "
  // The ASCII hyphen-minus (compound words, "1-2", "台北-上海") is never
  // touched — only the three Unicode dashes above are.
  // ‒-― = figure dash / en dash / em dash / horizontal bar.
  // 　-鿿 + ＀-￯ = CJK punctuation/ideographs + full-width.
  s = s.replace(/(\d)\s*[‒-―]+\s*(\d)/g, "$1-$2");
  s = s.replace(
    /([　-鿿＀-￯])\s*[‒-―]+\s*([　-鿿＀-￯])/g,
    "$1，$2",
  );
  s = s.replace(/\s*[‒-―]+\s*/g, ", ");
  // Tidy the comma-swap artifacts (leading clause-comma, doubled comma,
  // comma immediately before a sentence stop).
  s = s.replace(/(^|\n), /g, "$1");
  s = s.replace(/,\s*,/g, ", ");
  s = s.replace(/,(\s*)([.!?。！？,])/g, "$2");

  // Collapse 3+ blank lines to 2 (markdown stripping can leave gaps).
  s = s.replace(/\n{3,}/g, "\n\n");

  return s.trim();
}

/**
 * True when the text still contains markdown that would render as literal
 * symbols to a customer. Used by tests + a pipeline assertion so a future
 * regression in the sanitizer is caught, not silently shipped.
 */
export function hasResidualMarkdown(s: string): boolean {
  return /\*\*|__|\[[^\]]+\]\([^)]*\)|^#{1,6}\s/m.test(s);
}

/**
 * True when the text still contains an em / en / figure dash or horizontal bar
 * (‒–—―). Jeff's hard rule forbids these in any customer message; the ASCII
 * hyphen-minus (-) is allowed and NOT matched here. Mirror of
 * hasResidualMarkdown for tests + a pipeline regression assertion.
 */
export function hasEmDash(s: string): boolean {
  return /[‒-―]/.test(s);
}
