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
 * 純函式,可單測。只動 markdown 標記,不碰中文標點、不碰正常連字號。
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
