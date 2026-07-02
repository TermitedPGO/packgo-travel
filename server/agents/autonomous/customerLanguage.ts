/**
 * customerLanguage — 客人語言偵測 + 草稿語言 code gate(共用純函式)。
 *
 * 起因(2026-07-01 prod 反例):純英文客人 Leslie 收到「Hi Leslie」開頭、
 * 內文整段中文的升級草稿。prompt 有交代「對英文客戶用英文」但 LLM 系統
 * 提示整份是中文,偏誤壓過指示。教訓:語言正確性不能只靠 prompt,要有
 * code 層 gate。
 *
 * 這裡集中三件事,讓 followup 草稿鏈與 inquiry 升級/observation 草稿鏈
 * 用同一套規則(客人 inbound 零 CJK 字 → en):
 *   1. detectLanguageFromText — 單段文字的 CJK 偵測(從
 *      followupDraftProducer.detectLanguage 抽出的等價實作;該檔改為
 *      委派到這裡,規則永遠一致)。
 *   2. detectInquiryCustomerLanguage — inquiry 鏈的客人語言:觸發信
 *      (rawMessage)就是客人最新 inbound;沒有就往 threadHistory(舊→新)
 *      從新往舊找最後一封 inbound。
 *   3. checkDraftLanguage — 產出後的 code gate:en 客人的草稿含任何
 *      CJK 字 → violation(簽名行可白名單排除);zh 客人不設限。
 *
 * 全部是純函式,無 DB / 無 LLM,配 customerLanguage.test.ts。
 */

export type CustomerLanguage = "zh-TW" | "zh-CN" | "en";

/** CJK ideograph range(U+4E00-U+9FFF)。跟 followup 鏈沿用同一條 regex,
 * 偵測與 gate 用同一定義,不會出現「偵測說 en、gate 又用別的字表」。 */
const CJK_RE = /[一-鿿]/;

/** 簡體高頻字表 — 出現任一 → zh-CN(沿自 followupDraftProducer)。 */
const SIMPLIFIED_RE = /[这国说会们对应实现关闭东买卖优齐适会议]/;

export function hasCjk(text: string | null | undefined): boolean {
  return !!text && CJK_RE.test(text);
}

/** Crude language guess — 零 CJK 字 → en;含簡體高頻字 → zh-CN;預設繁中。
 * (等價於 followupDraftProducer.detectLanguage,該處已改為委派這裡。) */
export function detectLanguageFromText(
  text: string | null | undefined,
): CustomerLanguage {
  if (!text) return "zh-TW";
  if (!CJK_RE.test(text)) return "en";
  if (SIMPLIFIED_RE.test(text)) return "zh-CN";
  return "zh-TW";
}

/**
 * inquiry 鏈(升級/observation 草稿)的客人語言。
 *
 * 觸發這次處理的那封信(rawMessage)就是客人「最新的 inbound」,優先看它;
 * 空白(附件-only 等)才退回 threadHistory(舊→新)由新往舊找最後一封
 * 客人 inbound;都沒有 → zh-TW(與 followup 鏈同一保守預設)。
 */
export function detectInquiryCustomerLanguage(input: {
  rawMessage?: string | null;
  threadHistory?: Array<{ direction: "inbound" | "outbound"; body?: string | null }> | null;
}): CustomerLanguage {
  const raw = input.rawMessage?.trim();
  if (raw) return detectLanguageFromText(raw);
  const history = input.threadHistory ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.direction !== "inbound") continue;
    const body = m.body?.trim();
    if (body) return detectLanguageFromText(body);
  }
  return "zh-TW";
}

export type LanguageGateResult =
  | { ok: true }
  | { ok: false; violation: "cjk_in_en_draft"; sample: string };

/**
 * Code gate:草稿語言是否符合客人語言。
 *
 * - lang = "en":草稿含任何 CJK 字 → violation(先剔除 opts.ignore 的
 *   白名單字串,例如簽名「PACK&GO Travel · Jeff & 團隊」— 簽名一致是
 *   規格要求,不能因為簽名帶中文就永遠過不了)。
 * - lang = zh-TW / zh-CN:不設限,一律 ok(zh 客人收到中英夾雜是正常的)。
 * - 空草稿:ok(沒東西可違規;要不要有草稿是別層的事)。
 *
 * sample 回傳第一個 CJK 字附近的片段(log / 卡片訊息用),不是整段草稿。
 */
export function checkDraftLanguage(
  lang: CustomerLanguage,
  draft: string | null | undefined,
  opts?: { ignore?: string[] },
): LanguageGateResult {
  if (lang !== "en") return { ok: true };
  if (!draft) return { ok: true };
  let scanned = draft;
  for (const ig of opts?.ignore ?? []) {
    const cleaned = ig?.trim();
    if (cleaned) scanned = scanned.split(cleaned).join(" ");
  }
  const m = CJK_RE.exec(scanned);
  if (!m) return { ok: true };
  const start = Math.max(0, m.index - 20);
  const sample = scanned.slice(start, m.index + 40).replace(/\s+/g, " ").trim();
  return { ok: false, violation: "cjk_in_en_draft", sample };
}

/**
 * Prompt 端的語言指示(prompt + code gate 雙保險的 prompt 半邊)。
 *
 * en 客人:硬性、雙語重申(系統提示整份中文會把模型往中文拉,所以用
 * 客人的語言再講一次 — 同 followupDrafter LANGUAGE_DIRECTIVE 的教訓)。
 * zh 客人:回空字串,不加任何限制(既有 prompt 已處理繁/簡)。
 */
export function buildLanguageDirective(lang: CustomerLanguage): string {
  if (lang !== "en") return "";
  return [
    "【回覆語言(硬性規定,違反視同失敗)】",
    "這位客人來信是英文(inbound 全無中文字)。draftReply 必須整封用英文寫,除了簽名行逐字照抄之外,不可出現任何中文字。",
    "The customer writes in English. Write the ENTIRE draftReply in English only. Except for the exact signature line given above, do not include a single Chinese character anywhere in the reply.",
  ].join("\n");
}

/** 重試(第二次)用的加重指令 — 第一版草稿被 gate 擋下後追加。 */
export function buildLanguageRetryDirective(): string {
  return [
    "【重寫(語言違規)】",
    "你上一版草稿含有中文字,但這位客人是英文客人。重寫整封 draftReply:100% 英文,簽名行逐字照抄除外。",
    "LANGUAGE VIOLATION: your previous draft contained Chinese characters, but this customer writes in English. Rewrite the ENTIRE draftReply in English only; the exact signature line is the only exception.",
  ].join("\n");
}
