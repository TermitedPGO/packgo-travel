/**
 * attachmentReplyGate — attachment-mail autonomous-send SUSPENSION plus an
 * advisory risk highlighter (pdf-attachment-reliability, 2026-07-15/16).
 *
 * Incident: the InquiryAgent prompt SAID「讀不到不得告訴客人、要交 Jeff 接手」,
 * but prompt text is advice, not a gate — when the shared PDF parser broke
 * (pdf-parse v1/v2 API mismatch), the model told a customer their perfectly
 * fine PDF couldn't be parsed. The code-level answer went through four
 * matcher generations and ended somewhere simpler (below).
 *
 * ──────────────────────────────────────────────────────────────────────
 * FINAL DISPOSITION (Codex 12:01 §五) — SUSPENSION + ADVISORY, NOT A GATE
 * ──────────────────────────────────────────────────────────────────────
 * Four consecutive rounds tried to make regex bound natural-language
 * read-failure wording — flat lists, character gaps, a clause-local walk,
 * then a three-state unsafe/ambiguous/clean matcher. Every round passed its
 * own fixtures and failed the next independent fresh corpus, in BOTH
 * directions: dangerous paraphrases the closed vocabularies had never seen
 * kept reaching `clean`, and quoted/negated/reported wording kept dying as
 * `unsafe` (「請勿重傳附件」 destroyed a perfectly good draft). The verdict
 * is architectural, not a missing synonym: a regex cannot certify natural
 * language, so it no longer decides anything. Two mechanical rules replace
 * it:
 *
 *   1. ANY attachment mail → forceEscalate, always. autoSendGate now treats
 *      attachments as a HARD exclusion (same tier as refunds/quotes — no
 *      policy key opens it). PDFs still parse and drafts are still written;
 *      a human presses send.
 *   2. The matcher below survives as an ADVISORY RISK HIGHLIGHTER only. Its
 *      unsafe/ambiguous/clean verdict and matched snippet go on the
 *      escalation card so Jeff's eye lands on the risky sentence first. It
 *      never empties bodyText, never authorizes a send, and its misses in
 *      either direction cost nothing but highlight quality.
 *
 * Re-enabling attachment auto-send is a SEPARATE future project (controlled
 * reply templates / structured output + shadow evidence), not more regex.
 *
 * The classifier itself is clause-local and reporting-aware: within a clause
 * it walks subject → (licensed modifier)* → predicate, breaking on reporting
 * verbs (寫著/顯示/describes) and new subjects; a sentence-scoped smell layer
 * catches paraphrase into `ambiguous`. Kept because a highlighted card is
 * better than an unhighlighted one — with the explicit caveat that both its
 * recall and precision are BOUNDED, per the corpora above.
 *
 * PURE functions, mirrors autoSendGate's design so every rule is unit-tested
 * exhaustively; runInquiryAgent applies the verdict for ALL callers.
 */

import { stripMarkdownForEmail } from "../../_core/plainTextReply";

/** Statuses whose text actually reached the model as a (possibly truncated)
 *  full read. Everything else — parse_error, too_large, empty, unsupported,
 *  AND the fail-closed statuses partial / not_processed — forces escalation. */
export const READABLE_ATTACHMENT_STATUSES: ReadonlySet<string> = new Set([
  "ok",
  "ok_truncated",
]);

// ══════════════════════════════════════════════════════════════════════
// 1. Safety-scan normalization — SCAN COPY ONLY (Codex 09:21 §四.4).
//    property-based, not a hand-listed range: the customer receives the
//    untouched draft; this string exists so typography, markup or script
//    variants cannot smuggle a phrase past the matcher.
// ══════════════════════════════════════════════════════════════════════

const HTML_NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  hairsp: " ",
  // Invisible entities decode to "" directly: their code points (ZWSP, ZWNJ,
  // ZWJ, WORD JOINER, SOFT HYPHEN, LRM, RLM) are all Default_Ignorable and
  // would be stripped by the very next step anyway — and literal invisible
  // characters in source are unreviewable and easy to destroy silently.
  zwsp: "",
  zwnj: "",
  zwj: "",
  zerowidthspace: "",
  nobreak: "",
  wj: "",
  shy: "",
  lrm: "",
  rlm: "",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  minus: "−",
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
  bull: "・",
};

function decodeEntity(match: string, body: string): string {
  const key = body.toLowerCase();
  try {
    if (key.startsWith("#x")) {
      const cp = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff
        ? String.fromCodePoint(cp)
        : match;
    }
    if (key.startsWith("#")) {
      const cp = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff
        ? String.fromCodePoint(cp)
        : match;
    }
  } catch {
    return match;
  }
  return HTML_NAMED_ENTITIES[key] ?? match;
}

/** Default_Ignorable + format chars → gone. Property-based so it covers the
 *  whole class (U+034F CGJ, U+2065, U+E0001 tag chars, bidi isolates, ZWSP,
 *  BOM, soft hyphen …) not a hand-list. Newlines are NOT in the class, so
 *  sentence boundaries survive. */
// Constructor form, not a literal: the project tsconfig targets pre-ES6 and
// tsc rejects the `u` flag in literals (TS1501) — the runtime (Node 22)
// supports it fine, same workaround as plainTextReply's no-u-flag note.
const IGNORABLE = new RegExp("[\\p{Default_Ignorable_Code_Point}\\p{Cf}]", "gu");
/** Apostrophes incl U+02BC MODIFIER LETTER APOSTROPHE (`wouldnʼt`). U+0060
 *  GRAVE is deliberately excluded: it is markdown inline-code syntax and
 *  folding it would split `解析`. */
const APOSTROPHES = /[‘’‚‛′ʹʻʼʽˈ׳＇´]/g;
const QUOTES = /[“”„‟″ʺ״＂]/g;
/** Dash family used AS a hyphen (tight, no surrounding space) → ASCII hyphen,
 *  so `re–send` (U+2013) / `re‑send` (U+2011) match `re-?send`. Spaced dashes
 *  are clause breaks and are left to stripMarkdownForEmail (→ comma). */
const TIGHT_DASH = /(?<=\w)[‐-―⁃−﹘﹣－](?=\w)/g;

const CJK =
  "[\\u3000-\\u303F\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFFEF]";

/**
 * zh-TW LLMs sporadically emit simplified characters (red-team: 无法解析
 * slipped the whole matcher). Fold the forbidden-phrase-bearing characters
 * only — a safety scan, NOT a translation.
 */
const SIMPLIFIED_FOLD: ReadonlyArray<readonly [RegExp, string]> = [
  [/无/g, "無"], [/读/g, "讀"], [/开/g, "開"], [/传/g, "傳"], [/档/g, "檔"],
  [/图/g, "圖"], [/显/g, "顯"], [/请/g, "請"], [/给/g, "給"], [/贴/g, "貼"],
  [/发/g, "發"], [/损/g, "損"], [/坏/g, "壞"], [/内/g, "內"], [/载/g, "載"],
  [/说/g, "說"], [/写/g, "寫"], [/这/g, "這"], [/边/g, "邊"], [/个/g, "個"],
  [/们/g, "們"], [/没/g, "沒"], [/处/g, "處"], [/样/g, "樣"], [/统/g, "統"],
  [/扫/g, "掃"], [/乱/g, "亂"], [/码/g, "碼"], [/糊/g, "糊"], [/临/g, "臨"],
  [/见/g, "見"], [/后/g, "後"], [/来/g, "來"], [/过/g, "過"], [/纸/g, "紙"],
];

/**
 * Order: entities → tags → NFKC (fullwidth ＰＤＦ → PDF, compatibility) →
 * strip ignorables → fold dashes/apostrophes/quotes → markdown strip →
 * simplified fold → whitespace. NFKC runs BEFORE ignorable-strip so any
 * compatibility char that decomposes to an ignorable is then removed; and
 * folds run AFTER NFKC because NFKC does not touch U+2013 / U+02BC.
 */
function normalizeForSafetyScan(input: string): string {
  let s = input;
  // <br> is a SOFT break — our drafts are plain text, so an HTML <br> mid
  // phrase is injection (「無法<br>解析」). Join with a space, not a newline,
  // so it cannot manufacture a clause boundary. Block-close tags are more
  // likely real paragraph boundaries → newline.
  s = s.replace(/<br\s*\/?>/gi, " ");
  s = s.replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote|section)\s*>/gi, "\n");
  s = s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z0-9]{1,20});/g, decodeEntity);
  s = s.replace(/<[^<>\n]{1,300}>/g, "");
  s = s.normalize("NFKC");
  s = s.replace(IGNORABLE, "");
  s = s.replace(TIGHT_DASH, "-");
  s = s.replace(APOSTROPHES, "'");
  s = s.replace(QUOTES, '"');
  s = s.replace(/~~([^~\n]+?)~~/g, "$1");
  s = stripMarkdownForEmail(s);
  for (const [re, to] of SIMPLIFIED_FOLD) s = s.replace(re, to);
  s = s.replace(/[^\S\n]+/g, " ");
  s = s.replace(new RegExp(`(?<=${CJK}) (?=${CJK})`, "g"), "");
  // Join CJK across a stray newline too: 無法\n解析 is a soft wrap or an
  // injected break (Chinese sentence boundaries carry 。！？ before the
  // newline), never a real clause break mid-word.
  s = s.replace(new RegExp(`(?<=${CJK})\\n(?=${CJK})`, "g"), "");
  return s;
}

// ══════════════════════════════════════════════════════════════════════
// 2. Segmentation. Sentences bound anaphora; CLAUSES bound every relation.
// ══════════════════════════════════════════════════════════════════════

type Clause = { text: string; start: number };

function splitClauses(scan: string): Clause[] {
  const out: Clause[] = [];
  const re = /[^。.!?！？;；\n,，、]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scan)) !== null) {
    if (m[0].trim().length > 0) out.push({ text: m[0], start: m.index });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════
// 3. Lexicon. Every list is closed; the relation walk is what gives meaning.
// ══════════════════════════════════════════════════════════════════════

// File nouns. zh EXCLUDES 文件 (簽證文件 = traveler paperwork) and bare 檔.
const ZH_FILE = "(?:附件|附檔|檔案|圖檔|圖片|照片|掃描檔?|截圖|PDF|pdf)";
// en EXCLUDES document/image/photo; excludes the "file clerk/cabinet/room"
// compounds (a person/place, not a document).
const EN_FILE = "(?:files?|pdfs?|attachments?|scans?|screenshots?|spreadsheets?|excel)(?!\\s+(?:clerk|cabinet|room|manager|folder))\\b";
const ZH_FILE_RE = new RegExp(ZH_FILE, "g");
const EN_FILE_RE = new RegExp(`\\b${EN_FILE}`, "gi");
const ZH_FILE_TEST = new RegExp(ZH_FILE);
const EN_FILE_TEST = new RegExp(`\\b${EN_FILE}`, "i");

// Info objects — asking for / talking about these is NEVER a file re-supply.
const ZH_INFO =
  "(?:出發日期|回程日期|日期|時間|時刻|航班(?:時間|資訊)?|姓名|名字|全名|拼音|人數|電話|手機|地址|訂位代號|訂單編號|確認[碼號]|代號|編號|預算|需求)";
const EN_INFO =
  "(?:departure date|travel dates?|dates?|times?|names?|full name|passport number|confirmation (?:number|code)|booking (?:number|code|reference)|reference number|phone(?: number)?|number|itinerary details|budget|head ?count|number of (?:people|travell?ers))";

// Content nouns — a defect ADJECTIVE followed by one of these describes the
// file's content, not a read failure (空白申請表 / blank page / 空白頁).
const ZH_CONTENT_NOUN =
  "(?:頁|頁面|表|表格|表單|申請表|欄位|區塊|部分|段落|章節|附錄|條款|說明|內文)";
const EN_CONTENT_NOUN =
  "(?:pages?|forms?|fields?|sections?|tables?|columns?|rows?|paragraphs?|appendix|clauses?|blanks?)";

// Reporting verbs — file is the REPORTER, what follows is content. A defect
// after one of these never counts as a read failure.
// 顯示 is REPORTING by default (顯示護照損壞 = the file shows damage) and a
// FAILURE verb only with a failure complement (顯示不出來/顯示有狀況)。有問題的
// (attributive 的) and 狀況良好-type positives stay reporting.
const ZH_REPORT =
  "(?:寫著|寫的是|上寫|中寫|裡寫|說明|描述|提到|提及|指出|載明|記載|標示|顯示(?!不|怪|出來|成|有(?:點|些)?(?:狀況|異常|問題)(?!良好|正常|穩定|不錯|的))|中的|裡的|上的)";
// A reporting frame BEFORE the file noun (「沖印店說這批照片太大」「設計師說
// 封面圖片不對稱」) governs the whole clause — unless the sayer is OUR side
// (「系統顯示檔案太大」is our display, a real failure).
const ZH_REPORT_BEFORE = /(?:說明|說|提到|表示|寫道|回覆|告知|指出|回報|反映)[^,，。;；!！?？\n]{0,4}$/;
const ZH_OUR_SAYER = /(?:我們|我方|系統|後台|敝司|本公司)[^,，。;；!！?？\n]{0,4}(?:說|顯示|回報)[^,，。;；!！?？\n]{0,4}$/;
const EN_REPORT =
  // every alternative ends at a word boundary — "reads?" without \b matched
  // inside "our READER crashing" and wrongly excused a real leak (red-team).
  "(?:describes?\\b|described\\b|show(?:s|ed|n)?\\b(?!\\s+up)|says?\\b|said\\b|explains?\\b|explained\\b|mentions?\\b|mentioned\\b|indicates?\\b|indicated\\b|states?\\b|stated\\b|reads?\\b|notes?\\b|noted\\b|lists?\\b|listed\\b|includes?\\b|contains? a picture of|is a (?:picture|photo|scan|copy) of|is of\\b)";

const ZH_REQUEST =
  "(?:請問|請|麻煩|勞煩|煩請|還請|拜託|能否|可否|可不可以|可以|方便|幫我|幫忙)";
const EN_REQUEST =
  "(?:please|kindly|could you|would you|can you|do you mind|would you mind|mind)";

// Third-party destinations — re-uploading THERE is not re-sending to us.
// The bare-site form (「如果ESTA網站顯示逾時,請重新上傳一次」「簽證系統才會
// 放行」) has no 到/至 particle, so a plain site mention in the sentence also
// counts; OUR systems (我們的訂位系統) deliberately do not.
const ZH_DEST =
  "(?:到|至|去|往|上傳到|傳到|寄到)[^,，。;；!！?？\\n]{0,10}(?:網站|網頁|系統|平台|官網|入口|後台|portal|ESTA|簽證|領事館|大使館|申請)|ESTA|網站|官網|平台|入口網?站?|(?:簽證|報名|申請|移民|海關|航空)系統";
const EN_DEST =
  "\\bto\\s+(?:the\\s+|your\\s+|our\\s+)?(?:consulate|embassy|esta|visa|portal|website|site|system|application|account|dropbox|drive|google|form)\\b";

// We are the sender — benign, the customer is not being asked for anything.
const ZH_US_SEND =
  "(?:我|我們|我方|敝司|本公司)[^,，。;；!！?？\\n]{0,14}(?:再|重新|稍後|晚點|之後|明天|待會)?[^,，。;；!！?？\\n]{0,6}(?:寄|傳|附|送|發|補)[^,，。;；!！?？\\n]{0,10}給(?:您|你|大家|各位)";
const EN_US_SEND =
  "\\b(?:i'?ll|i will|i can|we'?ll|we will|we can|let me)\\b[^.!?\\n]{0,30}\\b(?:send|sending|attach|attaching|share|sharing|forward|forwarding|resend|re-?send|re-?attach|upload)\\b";

// ── read-failure DEFECTS that predicate a FILE subject (unsafe when bound) ──
// zh: each anchored (^) — must start where the walk stands.
const ZH_DEFECT: ReadonlyArray<RegExp> = [
  /^(?:打不開|開不起來|開啟不了|開不了|開不出來?|開不成功)/,
  /^(?:沒(?:有)?(?:能|辦法)?打開|沒(?:有)?開成功|沒(?:有)?成功打開)/,
  // 沒有成功讀出來 / 沒能成功解析 …
  /^沒(?:有)?(?:能|辦法)?成功(?:讀(?:出來?|取)?|解析|辨識|開啟?|載入|顯示)/,
  /^(?:載入|讀取|解析|辨識|開啟|顯示|預覽|下載|轉檔|上傳)(?:失敗|不了|不成功|錯誤|有誤)/,
  /^無法(?:順利|正常|完整|成功|正確)?(?:開啟|載入|顯示|使用|讀出|讀取|解析|辨識|預覽|擷取|開|處理(?=[^,，。;；!！?？\n]{0,6}(?:附件|檔案|圖檔|PDF|它)))/,
  /^(?:讀不(?:出來?|到|了)|跑不出來?|沒(?:有)?跑出來?|出不(?:來|了)|顯示不(?:出來?|了)|沒(?:有)?(?:能)?顯示出來?)/,
  // 看不到內容 / 看不太清楚 (our-read failure phrased as file-subject)
  /^看不(?:太)?到(?:任何)?(?:內容|東西|文字|資料)/,
  /^看不(?:太)?清楚/,
  // 顯示怪怪 / 看起來怪怪 / 顯示有狀況 / 顯示異常。不對(?!稱):「封面圖片
  // 看起來不對稱」是版面評論;(?!良好|…|的):「顯示狀況良好」是正面內容、
  //「顯示有問題的路段」是報告內容(red-team false kills)。
  /^(?:顯示|看起來|看上去|開起來)(?:有點|有些|是)?(?:怪怪|不對(?!稱)|不正常)/,
  /^顯示(?:有(?:點|些)?)?(?:狀況|異常|問題)(?!良好|正常|穩定|不錯|還好|的)/,
  // 開起來/打開後 是一片空白
  /^(?:開起來|打開後|點開後)(?:是)?(?:一片)?空白/,
  /^(?:是空的|(?:是|一片)?空白|亂碼|損壞|毀損|壞掉|破損)(?![^,，。;；!！?？\n]{0,4}(?:頁|表|申請表|報名表|欄|區|部分|的簽名|的申請))/,
  //(?!…正常):「夜景照片比較模糊是正常現象」是攝影建議(red-team false kill)。
  /^(?:太|很|有點|有些|比較)?(?:模糊|糊掉|看不清)(?![^,，。;；!！?？\n]{0,6}(?:是|屬|很)?(?:正常|常見|難免))/,
  /^(?:太大|過大)(?!會|就|可能|的話|時)/,
  /^(?:沒(?:有)?(?:任何)?(?:內容|文字|資料|東西)(?![^,，。;；!！?？\n]{0,4}(?:給|的(?:頁|表)))|裡面是空的)/,
];
// Adverbs allowed between a negation/verb and the read verb.
const EN_ADV =
  "(?:quite|really|even|fully|properly|actually|currently|always|ever|yet|still|correctly|reliably|successfully|somehow|just)";
// en: file-as-subject defect predicates.
const EN_NEG =
  "(?:won'?t|will not|wo n't|would ?n'?t|would not|can'?t|cannot|can not|could ?n'?t|could not|did ?n'?t|did not|does ?n'?t|does not|is ?n'?t|is not|are ?n'?t|are not|was ?n'?t|was not|were ?n'?t|were not|has ?n'?t|has not|have ?n'?t|have not|had ?n'?t|had not|do ?n'?t|do not|failed to|unable to|not able to|(?:was|were|are|is|am)\\s+(?:un)?able to|couldn|wouldn)";
const EN_DEFECT: ReadonlyArray<RegExp> = [
  new RegExp(`^(?:${EN_NEG})\\s+(?:be\\s+|been\\s+|being\\s+)?(?:properly\\s+|correctly\\s+|fully\\s+|quite\\s+)?(?:open(?:ed|ing)?(?:\\s+up)?|load(?:ed|ing)?|display(?:ed|ing)?|render(?:ed|ing)?|show(?:n|ing)?(?:\\s+up)?|read|process(?:ed|ing)?|preview(?:ed|ing)?|come\\s+up|come\\s+through|go\\s+through|print(?:ed|ing)?)\\b`, "i"),
  new RegExp(`^(?:is|are|was|were|looks?|looked|seems?|seemed|appears?|appeared|came\\s+(?:out|through|back|over|in)|comes?\\s+(?:out|through|in)|arrived|turned\\s+out|rendered|opened|loaded|displayed|printed|downloaded)\\s+(?:to\\s+be\\s+)?(?:completely\\s+|totally\\s+|mostly\\s+|all\\s+|just\\s+|quite\\s+|very\\s+|too\\s+|a\\s+bit\\s+|kind\\s+of\\s+|pretty\\s+much\\s+)*(?:blank|empty|corrupted|damaged|broken|fuzzy|blurry|garbled|scrambled|unreadable|illegible|distorted|pixelated|jumbled|cut\\s+off|all\\s+black)\\b(?!\\s+(?:page|form|field|section|application|template))`, "i"),
  new RegExp(`^(?:contains?|has|have|had)\\s+no\\s+(?:readable\\s+|extractable\\s+|legible\\s+|visible\\s+|actual\\s+)?(?:text|contents?|data|words)\\b(?!\\s+(?:for|on|about|regarding|under|in\\s+(?:the\\s+)?(?:section|column|row|field)))`, "i"),
  new RegExp(`^(?:is|are|was|were|seems?|appears?)(?:\\s+to\\s+be)?\\s+having\\s+(?:some\\s+|any\\s+|a\\s+lot\\s+of\\s+)?(?:issues?|problems?|trouble)\\b`, "i"),
  new RegExp(`^(?:${EN_NEG})\\s+(?:properly\\s+|correctly\\s+|fully\\s+)?(?:readable|legible|viewable|accessible|openable)\\b`, "i"),
];

// ── machine-read verbs: OUR reading act. unsafe unless reporting-governed. ──
const ZH_MACHINE = "(?:解析|讀取|辨識|擷取|讀出)";
const EN_MACHINE = "(?:parse|parsed|parsing|decode|decoded|decoding|extract|extracted|extracting|read)";
const ZH_OUR = "(?:我們|我|系統|後台|敝司|本公司|這邊|這裡|我方)";
const EN_OUR = "(?:we|i|our system|the system|our end|our side|on our end|on our side|our team)";

// ── re-supply verbs ──
const ZH_RESUPPLY_PRESUP = /(?:重傳|重寄(?!回)|重新上傳|重新傳|重新寄(?!回)|補傳|補寄)/g; // presupposes a prior send
// 寄(?!回): 簽名後再寄回給我們 = customer returning a signed doc, normal flow.
// 附(?!件|檔): 附 as a noun head (附件), not the verb 附.
const ZH_RESUPPLY_PLAIN = /再(?:傳|寄(?!回)|上傳|貼|附(?!件|檔)|發|提供|給)(?:一(?:次|份|遍|下))?/g;
const EN_RESUPPLY_PRESUP = /\b(?:resend|re-?send|reattach|re-?attach|re-?upload|reupload)\b/gi;
const EN_RESUPPLY_PLAIN = /\b(?:send|sending|upload|uploading|attach|attaching|share|sharing|provide|providing|give|giving|forward|forwarding)\b/gi;
const EN_AGAIN = /\b(?:again|once more|one more time|another time|a (?:fresh|new|clean|clearer|second|different) cop(?:y|ies)|another cop(?:y|ies))\b/i;

// ── modifiers licensed between a subject and its predicate ──
const ZH_MOD = new RegExp(
  "^(?:的|了|呢|內容|文字|部分|這邊|那邊|這裡|那裡|這裏|那裏|這兒|那兒|我們|我|你|您|系統|後台|電腦|信箱|這個|那個|在|於|上|中|裡面|裏面|裡|裏|好像|似乎|可能|看來|應該|大概|感覺|根本|完全|整份|整個|整批|全部|都|也|就|卻|還是|還|一直|目前|現在|本身|有點|有些|有一點|稍微|下載後|打開後|開啟後|收到後|點開後)",
);
const EN_MOD = new RegExp(
  "^(?:here|unfortunately|sadly|really|just|apparently|somehow|still|also|though|however|actually|simply|clearly|obviously|itself|now|currently|completely|entirely|basically|on\\s+(?:our|my|this|their)\\s+(?:end|side|system|machine|computer)|in\\s+our\\s+(?:system|inbox|end)|at\\s+our\\s+end|when\\s+(?:it|we|you)[^,.!?\\n]{0,20}|after\\s+(?:download|opening|it)[^,.!?\\n]{0,12}|that\\s+you\\s+(?:sent|attached|shared|uploaded|provided))\\b",
  "i",
);

// ══════════════════════════════════════════════════════════════════════
// 4. The clause walk + per-trigger classification.
//    Each trigger a clause raises is tagged unsafe / benign / ambiguous.
//    A benign tag means "a prover explained this away"; it does NOT license
//    other triggers. Aggregate: any unsafe → unsafe; else any ambiguous →
//    ambiguous; else clean.
// ══════════════════════════════════════════════════════════════════════

export type Verdict = "unsafe" | "ambiguous" | "clean";

type Hit = { verdict: Exclude<Verdict, "clean">; snippet: string };

/** Walk subject → (licensed modifier)* → predicate. Returns the matched
 *  predicate or null the moment an unlicensed token appears — that break is
 *  the relation check. A reporting verb encountered on the way aborts to
 *  null (the file is reporting, not failing). */
function walk(
  rest: string,
  predicates: ReadonlyArray<RegExp>,
  mod: RegExp,
  report: RegExp,
): { snippet: string; end: number } | null {
  let s = rest;
  let consumed = 0;
  for (let step = 0; step < 12; step++) {
    const ws = /^\s+/.exec(s);
    if (ws) {
      s = s.slice(ws[0].length);
      consumed += ws[0].length;
    }
    // a reporting verb here means what follows is CONTENT, not a predicate.
    const rep = report.exec(s);
    if (rep && rep.index === 0) return null;
    for (const re of predicates) {
      const m = re.exec(s);
      if (m) return { snippet: m[0], end: consumed + m[0].length };
    }
    const mm = mod.exec(s);
    if (!mm || mm[0].length === 0) return null;
    s = s.slice(mm[0].length);
    consumed += mm[0].length;
  }
  return null;
}

/** Is `zone` a re-supply object that is a FILE (not info, not third-party)? */
function objectIsFile(zone: string, lang: "zh" | "en"): "file" | "info" | "other" {
  const fileTest = lang === "zh" ? ZH_FILE_TEST : EN_FILE_TEST;
  const infoTest = lang === "zh" ? new RegExp(ZH_INFO) : new RegExp(EN_INFO, "i");
  // info wins over file when both appear ("再寄一次附件裡的訂位代號" = info)
  if (infoTest.test(zone) && !fileTest.test(zone.replace(infoTest, ""))) return "info";
  if (fileTest.test(zone)) return "file";
  if (infoTest.test(zone)) return "info";
  return "other";
}

/** For an elided / pronoun re-supply object ("send it again", "再給我一次"),
 *  resolve what the pronoun points at by the NEAREST preceding topic noun.
 *  A clear non-file topic (payment / booking / 付款 / 訂金 …) means the
 *  re-supply is not about the attachment → benign. A file noun means it may
 *  be → keep it live. No antecedent → "none" (caller decides via attachments). */
const ZH_NONFILE_TOPIC =
  /(?:付款|刷卡|款項|訂金|尾款|余款|餘款|退款|發票|收據|訂單|訂位|報名|報價|人數|日期|姓名|電話|地址|號碼|代號|編號)/g;
const EN_NONFILE_TOPIC =
  /\b(?:payment|charge|deposit|refund|invoice|receipt|order|booking|reservation|transaction|quote|itinerary|number|confirmation|date|name|details?)\b/gi;
function pronounAntecedent(before: string, lang: "zh" | "en"): "file" | "nonfile" | "none" {
  const fileRe = lang === "zh" ? ZH_FILE_RE : EN_FILE_RE;
  const topicRe = lang === "zh" ? ZH_NONFILE_TOPIC : EN_NONFILE_TOPIC;
  const lastIdx = (re: RegExp): number => {
    re.lastIndex = 0;
    let last = -1;
    let m: RegExpExecArray | null;
    while ((m = re.exec(before)) !== null) {
      last = m.index;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return last;
  };
  const f = lastIdx(fileRe);
  const t = lastIdx(topicRe);
  if (f < 0 && t < 0) return "none";
  return t > f ? "nonfile" : "file";
}

function zhResupplyObject(after: string): string {
  let s = after;
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(/^\s+/, "");
    s = s.replace(/^(?:一?(?:次|份|遍|下|張|封|個|回|趟|版|頁|點))+/, "");
    s = s.replace(/^(?:給|幫)?(?:我們|我|您|你|他們|她們)/, "");
    if (s === before) break;
  }
  const cut = s.search(/[給到至]|過來|回來/);
  if (cut >= 0) s = s.slice(0, cut + 2);
  return s.replace(/[好嗎呢吧喔哦謝謝?？。!！\s]+$/g, "").trim();
}

/** The SENTENCE surrounding a clause — for provers whose evidence commonly
 *  sits one comma away (第三方目的地:「如果ESTA網站顯示逾時,請重新上傳一次」;
 *  us-send:「新版報價單今晚整理好,會重寄給您一份」)。 */
function sentenceAround(full: string, idx: number): string {
  const enders = /[。.!?！？;；\n]/;
  let a = idx;
  while (a > 0 && !enders.test(full[a - 1]!)) a--;
  let b = idx;
  while (b < full.length && !enders.test(full[b]!)) b++;
  return full.slice(a, b);
}

/** Direction-to-customer: 給您/寄給你 = WE are sending → benign. */
const ZH_TO_CUSTOMER = /給(?:您|你)(?!們(?:的)?幫)/;

/** Classify ONE clause; `full` is the whole normalized draft for anaphora,
 *  `clauseStart` is this clause's offset in `full` (for antecedent lookback). */
function classifyClause(
  clause: string,
  full: string,
  clauseStart: number,
  hasAttachments: boolean,
): Hit[] {
  const hits: Hit[] = [];
  const zhReport = new RegExp(ZH_REPORT);
  const enReport = new RegExp(EN_REPORT, "i");

  // ── A. file-as-subject read failure (zh) ──
  ZH_FILE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ZH_FILE_RE.exec(clause)) !== null) {
    const before = clause.slice(0, m.index);
    // A third-party reporting frame BEFORE the file (「沖印店說這批照片太大」)
    // governs the clause — unless the sayer is us (「系統顯示檔案太大」).
    if (ZH_REPORT_BEFORE.test(before) && !ZH_OUR_SAYER.test(before)) continue;
    // 範例照片/示意圖 are OUR site assets, not the customer's attachment.
    if (/(?:範例|示意|樣本|官網上的|網站上的)$/.test(before)) continue;
    const after = clause.slice(m.index + m[0].length);
    // reporting verb right after the file noun → content, skip.
    if (zhReport.test(after) && (zhReport.exec(after)?.index ?? 99) <= 2) continue;
    const hit = walk(after, ZH_DEFECT, ZH_MOD, zhReport);
    if (!hit) continue;
    // 打不開+的問題/的狀況 = a nominalized ISSUE being discussed (「上週回報
    // 的檔案打不開問題已處理」), not a fresh failure statement → not proven;
    // the smell layer still keeps it from auto-sending.
    if (/^(?:的)?(?:問題|狀況|情形|事情)/.test(after.slice(hit.end))) continue;
    hits.push({ verdict: "unsafe", snippet: clause.slice(m.index, m.index + m[0].length + hit.end) });
  }
  // ── A. file-as-subject read failure (en) ──
  EN_FILE_RE.lastIndex = 0;
  while ((m = EN_FILE_RE.exec(clause)) !== null) {
    const after = clause.slice(m.index + m[0].length);
    const hit = walk(after, EN_DEFECT, EN_MOD, enReport);
    if (!hit) continue;
    // "looks blurry because of the long exposure" — a visual-quality word
    // with an explanatory continuation is photographic content, not proof.
    if (/blurr|fuzz|dark|faint/i.test(hit.snippet) && /^\s*(?:because|due\s+to|from\s+the)/i.test(after.slice(hit.end))) continue;
    hits.push({ verdict: "unsafe", snippet: clause.slice(m.index, m.index + m[0].length + hit.end) });
  }
  // ── A''. pronoun-subject read failure — "it won't open", "它打不開" — when
  // the pronoun's nearest antecedent (prior clause) is a file. ──
  {
    const enPro = /\b(?:it|this|that|they|these|those)\s+/gi;
    let pm: RegExpExecArray | null;
    while ((pm = enPro.exec(clause)) !== null) {
      const hit = walk(clause.slice(pm.index + pm[0].length), EN_DEFECT, EN_MOD, enReport);
      if (hit && pronounAntecedent(full.slice(0, clauseStart + pm.index), "en") === "file") {
        hits.push({ verdict: "unsafe", snippet: (pm[0] + hit.snippet).trim() });
      }
    }
    const zhPro = /(?:它|它們|這個|那個)/g;
    while ((pm = zhPro.exec(clause)) !== null) {
      const rest = clause.slice(pm.index + pm[0].length);
      const hit = walk(rest, ZH_DEFECT, ZH_MOD, zhReport);
      if (!hit) continue;
      // 那個打不開的鎖頭 — attributive 的+noun means the defect modifies THAT
      // noun, not the pronoun's antecedent (red-team false kill).
      if (/^的/.test(rest.slice(hit.end))) continue;
      if (pronounAntecedent(full.slice(0, clauseStart + pm.index), "zh") === "file") {
        hits.push({ verdict: "unsafe", snippet: (pm[0] + hit.snippet).trim() });
      }
    }
  }

  // ── A'. customer-directed open question (zh): 您那邊能打開嗎 = asking the
  // customer whether THEY can open OUR failed object → unsafe. Requires the
  // 嗎-question or an explicit file object —「您可以打開航空公司的App」
  //「打開Google地圖」「打開出風口」are ordinary instructions (red-team). ──
  {
    const re = /(?:您|你)(?:那邊|這邊)?能(?:不能)?(?:順利|正常)?打開(?:得了)?嗎|(?:您|你)(?:那邊|這邊)?(?:能|可以)(?:順利|正常)?打開(?:它|附件|附檔|檔案|圖檔|PDF)|能不能打開嗎/;
    const mm = re.exec(clause);
    if (mm && !zhReport.test(clause.slice(0, mm.index))) hits.push({ verdict: "unsafe", snippet: mm[0] });
  }
  // ── C'. topicalized object (zh): 把附件再寄一次 — file noun BEFORE the
  // re-supply verb via 把/將. Requires the RE-marker (再/重新 — a first-time
  // 把…傳給我們 ask is normal flow), excludes 轉寄 (forwarding), 附件裡的X
  // (the object is something INSIDE the file), direction-to-customer, and a
  // third-party destination anywhere in the SENTENCE (red-team). ──
  {
    const re = new RegExp(`(?:把|將)${ZH_FILE}(?!裡|中|上的)[^,，。;；!！?？\\n]{0,8}(?:再|重新)(?:(?<!轉)寄(?!回)|傳|上傳|貼|附(?!件|檔)|發)`);
    const mm = re.exec(clause);
    if (mm) {
      const sent = sentenceAround(full, clauseStart + mm.index);
      if (
        !new RegExp(ZH_DEST).test(sent) &&
        !new RegExp(ZH_US_SEND).test(sent) &&
        !ZH_TO_CUSTOMER.test(clause.slice(mm.index))
      ) {
        hits.push({ verdict: "unsafe", snippet: mm[0] });
      }
    }
  }
  // ── B. our-side machine-read of the file (zh) ── 無法解析您的附件
  {
    const re = new RegExp(`${ZH_OUR}[^,，。;；!！?？\\n]{0,10}(?:無法|沒(?:有)?辦法|不能|沒能)(?:順利|正常|完整|成功|正確)?${ZH_MACHINE}`);
    const mm = re.exec(clause);
    if (mm && !zhReport.test(clause.slice(0, mm.index))) {
      const after = clause.slice(mm.index + mm[0].length);
      const obj = zhResupplyObject(after);
      const kind = objectIsFile(after.slice(0, 12), "zh");
      // machine verb + our-side: the object is almost always the file; only a
      // clear info object makes it benign.
      if (kind === "info") { /* benign */ }
      else hits.push({ verdict: "unsafe", snippet: mm[0] });
      void obj;
    }
  }
  // ── B. bare machine-read verb (zh), reporting-aware, NOT draft-wide ──
  {
    const re = new RegExp(`(?:無法|沒(?:有)?辦法|不能|沒能)${ZH_MACHINE}`, "g");
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(clause)) !== null) {
      const before = clause.slice(0, mm.index);
      if (zhReport.test(before)) continue; // 寫著/中的 … 無法解析 → content
      const after = clause.slice(mm.index + mm[0].length);
      const objZone = after.slice(0, 12);
      const kind = objectIsFile(objZone, "zh");
      if (kind === "info") continue; // 無法辨識姓名 → info
      // explicit NON-file, NON-our subject before the verb → other party's act.
      const otherSubject = /(?:領事館|大使館|海關|飯店|旅館|航空公司|櫃檯|系統商|供應商)[^,，。;；!！?？\n]{0,6}$/.test(before);
      if (otherSubject && kind === "other") continue;
      // our-side or file object or bare → unsafe; else ambiguous.
      if (new RegExp(ZH_OUR).test(before) || kind === "file") {
        hits.push({ verdict: "unsafe", snippet: mm[0] });
      } else {
        hits.push({ verdict: "ambiguous", snippet: mm[0] });
      }
    }
  }
  // ── B. our-side read-failure verbs on the file as OBJECT (zh) ──
  // 系統跑不出你附件的內容 / 我這邊看不到您附件的內容 / 讀不出附件
  {
    const readFail = "(?:跑不出來?|看不(?:太)?到|看不(?:太)?清楚|讀不(?:出來?|到)|顯示不出來?|抓不到|抓不出)";
    const re = new RegExp(`${ZH_OUR}[^,，。;；!！?？\\n]{0,8}${readFail}[^,，。;；!！?？\\n]{0,8}${ZH_FILE}`);
    const mm = re.exec(clause);
    if (mm && !zhReport.test(clause.slice(0, mm.index))) {
      hits.push({ verdict: "unsafe", snippet: mm[0] });
    }
  }
  // ── B. content-proxy subject (zh): 內容/文字 + read-outcome defect, when a
  // file noun sits in a NEARBY clause (附件收到了,內容看不太清楚) ──
  {
    const re = new RegExp(
      `(?:內容|文字)(?:好像|似乎|這邊|那邊|我這邊)?(?:看不(?:太)?清楚|看不(?:太)?到|出不(?:來|了)|跑不出來?|沒(?:有)?跑出來?|讀不出來?|顯示不(?:出來?|了)|是空白|一片空白|亂碼)`,
    );
    const mm = re.exec(clause);
    if (mm && (ZH_FILE_TEST.test(full))) {
      const before = clause.slice(0, mm.index);
      //「若內容看不太清楚,跟我們說一聲」is a conditional OFFER about a file
      // WE sent, not a failure statement (red-team false kill).
      const conditional = /(?:若|如果|要是|萬一)/.test(before);
      if (!zhReport.test(before) && !conditional) hits.push({ verdict: "unsafe", snippet: mm[0] });
    }
  }
  // ── B. zh paraphrase re-supply: 換個方式給/傳/寄 (+ file context). WE may
  // offer the alternative channel ourselves —「我可以換個方式傳給您」is our
  // delivery offer, not an ask (red-team false kill). ──
  {
    const re = /(?:換|改)(?:個|一個|其他|別的)?方式[^,，。;；!！?？\n]{0,6}(?:給|傳|寄|提供)/;
    const mm = re.exec(clause);
    if (mm && (ZH_FILE_TEST.test(clause) || ZH_FILE_TEST.test(full))) {
      const usOffer =
        /(?:我|我們)(?:可以|會|來|再)[^,，。;；!！?？\n]{0,6}$/.test(clause.slice(0, mm.index)) ||
        ZH_TO_CUSTOMER.test(clause.slice(mm.index));
      if (!usOffer) hits.push({ verdict: "unsafe", snippet: mm[0] });
    }
  }
  // ── B. our-side machine-read of the file (en) ── we can't parse the PDF
  {
    const re = new RegExp(`${EN_OUR}\\s+(?:${EN_NEG})\\s+(?:${EN_MACHINE})\\b`, "i");
    const mm = re.exec(clause);
    if (mm && !enReport.test(clause.slice(0, mm.index))) {
      const after = clause.slice(mm.index + mm[0].length);
      const kind = objectIsFile(after.slice(0, 30), "en");
      if (kind !== "info") hits.push({ verdict: "unsafe", snippet: mm[0] });
    }
  }
  // ── B. en our-side read trouble idioms (no clean NEG+MACHINE shape) ──
  // "had trouble opening the attachment", "can't get any text from the PDF",
  // "couldn't make out/make sense of ... the attachment", "unable to open it"
  {
    const patterns: RegExp[] = [
      new RegExp(`\\bha(?:d|ve|s|ving)\\s+(?:some\\s+|a\\s+lot\\s+of\\s+|any\\s+)?(?:trouble|difficulty|difficulties|an?\\s+issue|issues|problems?)\\s+(?:${EN_ADV}\\s+)?(?:open|read|load|process|access|view|display|render|extract|preview|get)ing\\b`, "i"),
      new RegExp(`${EN_OUR}\\s+(?:${EN_NEG})\\s+(?:${EN_ADV}\\s+)?get\\s+(?:any\\s+|the\\s+)?(?:text|content|data|words)\\s+(?:from|out\\s+of)\\b`, "i"),
      new RegExp(`${EN_OUR}\\s+(?:${EN_NEG})\\s+(?:${EN_ADV}\\s+)?make\\s+(?:out|sense\\s+of)\\b`, "i"),
      new RegExp(`${EN_OUR}\\s+(?:${EN_NEG})\\s+(?:be\\s+)?able\\s+to\\s+(?:${EN_ADV}\\s+)?(?:open|read|load|process|access|view|display|render|extract|preview|make\\s+(?:out|sense\\s+of)|get)\\b`, "i"),
      new RegExp(`\\b(?:something|anything)\\s+(?:went|has\\s+gone|goes)\\s+wrong\\s+with\\s+(?:the\\s+|your\\s+|this\\s+|that\\s+|our\\s+)?${EN_FILE}`, "i"),
    ];
    for (const re of patterns) {
      const mm = re.exec(clause);
      if (!mm || enReport.test(clause.slice(0, mm.index))) continue;
      // require file context somewhere reachable (this clause or the draft):
      // "had trouble opening the attachment" / "make sense of it" (it→file).
      if (EN_FILE_TEST.test(clause) || /\b(?:it|them|this|that)\b/i.test(clause.slice(mm.index)) && EN_FILE_TEST.test(full)) {
        hits.push({ verdict: "unsafe", snippet: mm[0] });
        break;
      }
    }
  }
  // ── B. en unreadable/illegible adjective bound to file or our-read ──
  {
    const re = /\b(?:unreadable|illegible|unopenable)\b/i;
    const mm = re.exec(clause);
    if (mm && !enReport.test(clause.slice(0, mm.index))) {
      if (EN_FILE_TEST.test(clause)) hits.push({ verdict: "unsafe", snippet: mm[0] });
      else hits.push({ verdict: "ambiguous", snippet: mm[0] });
    }
  }

  // ── C. re-supply asks. object zone decides; third-party / us-send benign ──
  const zhDest = new RegExp(ZH_DEST);
  const enDest = new RegExp(EN_DEST, "i");
  const zhUsSend = new RegExp(ZH_US_SEND);
  const enUsSend = new RegExp(EN_US_SEND, "i");
  const zhReq = new RegExp(ZH_REQUEST);
  const enReq = new RegExp(EN_REQUEST, "i");

  // zh presuppositional re-supply (重傳/重寄) — object already the prior file.
  // Direction + destination checks look at the whole SENTENCE:「會重寄給您
  // 一份」is us re-sending;「如果ESTA網站顯示逾時,請重新上傳一次」has the
  // third-party destination one comma earlier (red-team false kills).
  {
    let mm: RegExpExecArray | null;
    ZH_RESUPPLY_PRESUP.lastIndex = 0;
    while ((mm = ZH_RESUPPLY_PRESUP.exec(clause)) !== null) {
      const after = clause.slice(mm.index + mm[0].length);
      const sent = sentenceAround(full, clauseStart + mm.index);
      if (zhDest.test(sent) || zhUsSend.test(sent)) continue;
      if (ZH_TO_CUSTOMER.test(after.slice(0, 10))) continue;
      const kind = objectIsFile(zhResupplyObject(after) || after.slice(0, 12), "zh");
      if (kind === "info") continue;
      hits.push({ verdict: "unsafe", snippet: mm[0] });
    }
  }
  // zh plain re-supply (再傳/再寄/再提供) — needs request marker or clause start.
  {
    let mm: RegExpExecArray | null;
    ZH_RESUPPLY_PLAIN.lastIndex = 0;
    while ((mm = ZH_RESUPPLY_PLAIN.exec(clause)) !== null) {
      const sentHere = sentenceAround(full, clauseStart + mm.index);
      if (zhDest.test(sentHere) || zhUsSend.test(sentHere)) continue;
      if (ZH_TO_CUSTOMER.test(clause.slice(mm.index, mm.index + mm[0].length + 10))) continue;
      const before = clause.slice(0, mm.index);
      const directed = zhReq.test(before) || before.trim().length === 0 || /(?:給我們?|過來|幫我)/.test(clause.slice(mm.index));
      if (!directed) continue;
      const rawAfter = clause.slice(mm.index + mm[0].length);
      const obj = zhResupplyObject(rawAfter);
      // A SPEC modifier on the object (「再傳一張兩吋照片」) asks for a NEW
      // differently-specced item, not the failed attachment again — not
      // proven; the smell layer still routes it to Jeff (red-team).
      if (/^[^,，。;；!！?？\n]{0,4}(?:兩吋|二吋|大頭|證件|白底|彩色|近期|六個月內|新的)/.test(rawAfter)) continue;
      const kind = objectIsFile(obj || rawAfter.slice(0, 12), "zh");
      if (kind === "file") hits.push({ verdict: "unsafe", snippet: clause.slice(mm.index, mm.index + mm[0].length) + obj });
      else if (kind === "info") continue;
      else if (pronounAntecedent(full.slice(0, clauseStart + mm.index), "zh") === "nonfile") continue;
      else if (hasAttachments) hits.push({ verdict: "ambiguous", snippet: clause.slice(mm.index, mm.index + mm[0].length) });
    }
  }
  // en presuppositional re-supply (resend/reupload/reattach).
  {
    let mm: RegExpExecArray | null;
    EN_RESUPPLY_PRESUP.lastIndex = 0;
    while ((mm = EN_RESUPPLY_PRESUP.exec(clause)) !== null) {
      if (enDest.test(clause) || enUsSend.test(clause)) continue;
      const after = clause.slice(mm.index + mm[0].length);
      const kind = objectIsFile(after.slice(0, 30), "en");
      if (kind === "info") continue;
      if (kind === "file") hits.push({ verdict: "unsafe", snippet: mm[0] });
      else if (pronounAntecedent(full.slice(0, clauseStart + mm.index), "en") === "nonfile") continue;
      else if (hasAttachments) hits.push({ verdict: "ambiguous", snippet: mm[0] });
    }
  }
  // en plain re-supply + "again" / "a fresh copy".
  {
    let mm: RegExpExecArray | null;
    EN_RESUPPLY_PLAIN.lastIndex = 0;
    while ((mm = EN_RESUPPLY_PLAIN.exec(clause)) !== null) {
      if (enDest.test(clause) || enUsSend.test(clause)) continue;
      const before = clause.slice(0, mm.index);
      const after = clause.slice(mm.index + mm[0].length);
      const directed = enReq.test(before) || before.trim().length === 0;
      const recur = EN_AGAIN.test(after) || /\bcop(?:y|ies)\b/i.test(after);
      if (!directed && !recur) continue;
      const kind = objectIsFile(after.slice(0, 40), "en");
      if (kind === "file" && recur) hits.push({ verdict: "unsafe", snippet: (mm[0] + after.slice(0, 24)).trim() });
      else if (kind === "info") continue;
      else if (pronounAntecedent(full.slice(0, clauseStart + mm.index), "en") === "nonfile") continue;
      else if (recur && hasAttachments) hits.push({ verdict: "ambiguous", snippet: mm[0] });
    }
  }

  return hits;
}


// ══════════════════════════════════════════════════════════════════════
// 5. The AMBIGUOUS smell layer (Codex 09:21 §四.1).
//
// The unsafe tier above PROVES a relation before destroying a draft — high
// precision, and therefore incomplete by construction: red-team showed
// natural paraphrase (「叫不出來」「灌不進來」 "choked on" "spins forever")
// sails past any closed verb list. This layer is the recall side: a cheap
// sentence-scoped co-occurrence test — a FILE REFERENCE plus FAILURE-ish or
// RE-SUPPLY-ish wording — that can only ever yield `ambiguous` (block
// auto-send, keep the draft, show Jeff). It never drops a draft, so its
// vocabulary is deliberately broad; a false hit costs Jeff a glance.
//
// BENIGN PROVERS keep everyday quote flow clean: a reporting verb between
// the file and the failure (the file DESCRIBES a failure), a defect
// adjective on a content noun (空白申請表 / blank form), an info object
// (看不到出發日期), a third-party destination (上傳到 ESTA), us being the
// sender (我再傳一次檔案給您), and conditional 太大會…. A sentence whose
// every smell token is explained stays clean.
// ══════════════════════════════════════════════════════════════════════

function splitSentences(scan: string): Clause[] {
  const out: Clause[] = [];
  const re = /[^。.!?！？;；\n]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scan)) !== null) {
    if (m[0].trim().length > 0) out.push({ text: m[0], start: m.index });
  }
  return out;
}

/** File references for the smell layer: the strict file nouns plus document
 *  types customers actually attach (同意書/授權書/contract/roster …). Wider
 *  than the unsafe tier's list on purpose — this tier cannot destroy. */
const SMELL_FILE_ZH = new RegExp(
  // 文件 counts here UNLESS it is traveler paperwork (簽證文件…); the unsafe
  // tier still never uses bare 文件. 您附的/您傳來的 marks an inbound file
  // even without a file noun (「您附的那份簽證文件」).
  `${ZH_FILE}|同意書|授權書|報名表|確認單|壓縮檔|(?:Word|word|Excel|excel)\\s?檔|(?<!簽證|入境|申請|旅行|旅遊|報名|相關)文件|(?:您|你)(?:附|傳|寄|上傳)(?:來|過來)?的`,
);
const SMELL_FILE_EN = new RegExp(
  `\\b${EN_FILE}|\\b(?:paperwork|contracts?|forms?|rosters?|cop(?:y|ies)|attached|scanned)\\b|\\b(?:the|your|this|that|earlier|first|second)\\s+(?!travel\\s)document\\b|\\byou\\s+(?:sent|attached|forwarded|uploaded|shared)\\b`,
  "i",
);

/** Failure-ish wording (zh). Potential-complement V不X shapes, defect nouns,
 *  crash verbs, empty-outcome phrases. NOT bare 不/沒 — those are everywhere
 *  (「不好意思」「沒問題」). 太大 keeps the conditional-advice exclusion. */
const ZH_SMELL_FAIL = new RegExp(
  [
    "(?:打|開|讀|看|載|點|叫|秀|傳|拉|灌|存取|預覽|下載|解壓縮?|解析|辨識|讀取|開啟|顯示)[^,，。;；!！?？\\n]{0,2}不(?:開|了|到|出|來|進|上|下|見|起)",
    "無法|沒(?:有)?辦法|沒能|不(?:太)?能(?:顯示|開啟?|讀|載入|打開|預覽|下載)",
    "沒(?:有)?(?:跑|叫|秀|顯示)出來?|出不(?:來|了)|跑不出來?",
    "沒(?:有)?(?:東西|內容|反應|畫面)",
    "失敗|錯誤|異常|(?:有|出)(?:了|點|些)?(?:狀況|問題)|(?:編碼|格式|權限)問題",
    "當機|當掉|卡住|卡在|吃掉|移除|攔下|擋(?:下|住|了)",
    "空白|亂碼|損[壞毀]|毀損|壞掉|破損|(?:一堆|全是)符號|一片黑",
    "(?:太|過)大(?!會|就|可能|的話|時)",
    "模糊|糊掉",
    "\\b0\\s?(?:KB|kb|bytes)\\b",
  ].join("|"),
);

/** Failure-ish wording (en). Contractions are already ASCII after the scan
 *  normalization, so \w+n't matches wouldn't/isn't/hasn't/…. */
const EN_SMELL_FAIL = new RegExp(
  [
    "\\b\\w+n't\\b|\\bnot\\b|\\bnever\\b|\\bno\\b|\\bnone\\b|\\bnothing\\b|\\bwithout\\b|\\bcannot\\b|\\bunable\\b",
    "\\bfail(?:ed|s|ing|ure)?\\b|\\berrors?\\b|\\bcrash\\w*|\\bchok\\w*|\\bfroze\\b|\\bfreez\\w*|\\bstuck\\b|\\bhang(?:s|ing)?\\b|\\bspin(?:s|ning)?\\b|\\brefus\\w*|\\bstruggl\\w*",
    "\\bgave up\\b|\\bgive up\\b|\\bgiving up\\b|\\bact(?:ing|s|ed)? up\\b|\\bbother\\b|\\btrouble\\b|\\bissues?\\b|\\bproblems?\\b|\\bno luck\\b",
    "\\bblank\\b|\\bempty\\b|\\bgibberish\\b|\\bgarbl\\w*|\\bscrambl\\w*|\\bmangl\\w*|\\bdamag\\w*|\\bcorrupt\\w*|\\bbroken\\b|\\bunreadable\\b|\\billegible\\b|\\bdistort\\w*|\\bjumbled\\b|\\bpixelat\\w*",
    "\\blost\\b|\\bmissing\\b|\\bin pieces\\b|\\bfell apart\\b|\\bhalfway\\b|\\bzero (?:bytes|percent)\\b|\\b0\\s?(?:KB|kb|bytes)\\b",
    "\\bblack page\\b|\\bsolid black\\b|\\bcompletely white\\b|\\bempty shell\\b|\\bempty-handed\\b|\\bdraws? a blank\\b|\\bhard to get\\b|\\brandom characters\\b",
  ].join("|"),
  "i",
);

/** Transit-failure verbs: something SENT TO US didn't arrive usable. A bare
 *  pronoun subject with no antecedent still smells here ("It didn't come
 *  through") because transit verbs presuppose an inbound object. */
const EN_TRANSIT = /\b(?:come|came|coming|making it|make it|made it)\s+through\b|\bsurviv\w+\b|\breach\w*\s+(?:us|our)\b|\barriv\w+\b/i;

/** Re-supply smell: any customer-directed send-us-again shape. */
const ZH_SMELL_RESUPPLY = /(?:再|重新?|補)(?:寄(?!回)|傳|上傳|貼|附(?!件|檔)|發|提供|給)|換(?:個|一個|其他|別的)?方式/;
const EN_SMELL_RESUPPLY = new RegExp(
  `\\b(?:re-?send|re-?attach|re-?upload|resend|reattach|reupload)\\b|\\b(?:send|upload|attach|share|provide|give|forward|shoot|fire|pop|pass)\\w*\\b[^.!?\\n]{0,30}\\b(?:again|once more|one more time|over again|a (?:fresh|new|second|clean|clearer) cop(?:y|ies)|another cop(?:y|ies))\\b|\\bsecond send\\b`,
  "i",
);

const ZH_CONTENT_NOUN_AFTER = /^[^,，。;；!！?？\n]{0,2}(?:申請表|表格|表單|欄位|簽名頁?)/;
const EN_CONTENT_NOUN_AFTER = /^\s*(?:visa\s+|application\s+)?(?:forms?|fields?|sections?|applications?|templates?)\b/i;
const ZH_BLUR_EXPLAINED = /^[^,，。;；!！?？\n]{0,6}(?:是因為|因為|是正常|屬正常)/;
const EN_BLUR_EXPLAINED = /^[^.!?\n]{0,12}\b(?:because|due to|from the)\b/i;

/** One sentence → ambiguous snippet, or null when clean / fully explained. */
function smellSentence(
  sentence: string,
  full: string,
  sentStart: number,
): string | null {
  const zhReport = new RegExp(ZH_REPORT);
  const enReport = new RegExp(EN_REPORT, "i");

  // ---- file reference ----
  const zhFile = SMELL_FILE_ZH.exec(sentence);
  const enFile = SMELL_FILE_EN.exec(sentence);
  let fileIdx = zhFile ? zhFile.index : enFile ? enFile.index : -1;
  if (zhFile && enFile) fileIdx = Math.min(zhFile.index, enFile.index);
  let filePronoun = false;
  if (fileIdx < 0) {
    // pronoun subject whose nearest antecedent is a file
    const pro = /\b(?:it|this|that|they)\b|它|它們|這個|那個/i.exec(sentence);
    if (pro) {
      const ante = pronounAntecedent(full.slice(0, sentStart + pro.index), /[它這那]/.test(pro[0]) ? "zh" : "en");
      if (ante === "file") {
        fileIdx = pro.index;
        filePronoun = true;
      } else if (
        ante === "none" &&
        (EN_TRANSIT.test(sentence) ||
          // "When I try to preview it, all I get is an error message" — a
          // file-action verb marks the pronoun as document-ish even with no
          // named antecedent.
          /\b(?:open|preview|download|view|load|extract)(?:ing|ed|s)?\b/i.test(sentence))
      ) {
        fileIdx = pro.index;
        filePronoun = true;
      }
    }
  }
  if (fileIdx < 0) return null;
  void filePronoun;

  // ---- failure smell ----
  const failRe = new RegExp(`${ZH_SMELL_FAIL.source}|${EN_SMELL_FAIL.source}`, "gi");
  let fm: RegExpExecArray | null;
  while ((fm = failRe.exec(sentence)) !== null) {
    if (fm.index === failRe.lastIndex) failRe.lastIndex++;
    const tok = fm[0];
    const after = sentence.slice(fm.index + tok.length);
    // prover (a): a reporting verb sits between the file and this failure —
    // the file DESCRIBES the failure, it does not have it.
    if (fm.index > fileIdx) {
      const between = sentence.slice(fileIdx, fm.index);
      if (zhReport.test(between) || enReport.test(between)) continue;
    }
    // prover (b): defect adjective on a CONTENT noun (空白申請表, blank form).
    if (/空白|blank|empty/i.test(tok)) {
      if (ZH_CONTENT_NOUN_AFTER.test(after) || EN_CONTENT_NOUN_AFTER.test(after)) continue;
    }
    // prover (c): failure verb takes an INFO object (看不到出發日期).
    if (new RegExp(`^[^,，。;；!！?？\\n]{0,4}${ZH_INFO}`).test(after)) continue;
    if (new RegExp(`^[^.!?\\n]{0,14}\\b${EN_INFO}\\b`, "i").test(after)) continue;
    // prover (e): visual blur explained as photographic content.
    if (/模糊|糊掉|blurry|fuzzy/i.test(tok)) {
      if (ZH_BLUR_EXPLAINED.test(after) || EN_BLUR_EXPLAINED.test(after)) continue;
    }
    return sentence.slice(Math.max(0, fm.index - 12), fm.index + tok.length).trim();
  }

  // ---- re-supply smell ----
  const resupRe = new RegExp(
    `${ZH_SMELL_RESUPPLY.source}|${EN_SMELL_RESUPPLY.source}`,
    "gi",
  );
  let rm: RegExpExecArray | null;
  while ((rm = resupRe.exec(sentence)) !== null) {
    if (rm.index === resupRe.lastIndex) resupRe.lastIndex++;
    const after = sentence.slice(rm.index + rm[0].length);
    // prover (d): third-party destination / us-sending / direction-to-customer
    // (給您 = we send) / info object.
    if (new RegExp(ZH_DEST).test(sentence) || new RegExp(EN_DEST, "i").test(sentence)) continue;
    if (new RegExp(ZH_US_SEND).test(sentence) || new RegExp(EN_US_SEND, "i").test(sentence)) continue;
    if (/^[^,，。;；!！?？\n]{0,8}給(?:您|你)(?!們)/.test(after)) continue;
    if (new RegExp(`^[^,，。;；!！?？\\n]{0,8}${ZH_INFO}`).test(after)) continue;
    if (new RegExp(`^[^.!?\\n]{0,20}\\b${EN_INFO}\\b`, "i").test(after)) continue;
    return sentence.slice(Math.max(0, rm.index - 12), rm.index + rm[0].length).trim();
  }

  return null;
}

/** Classify a whole draft into unsafe / ambiguous / clean (Codex 09:21). */
export function classifyAttachmentReply(draft: string): { verdict: Verdict; snippet: string | null } {
  if (!draft) return { verdict: "clean", snippet: null };
  const scan = normalizeForSafetyScan(draft);
  const clauses = splitClauses(scan);
  let ambiguous: string | null = null;
  for (const c of clauses) {
    for (const h of classifyClause(c.text, scan, c.start, true)) {
      if (h.verdict === "unsafe") return { verdict: "unsafe", snippet: h.snippet };
      if (h.verdict === "ambiguous" && ambiguous === null) ambiguous = h.snippet;
    }
  }
  // Recall pass: sentence-scoped smell → ambiguous (never unsafe). Runs even
  // when a clause rule already flagged ambiguous — first snippet wins.
  if (ambiguous === null) {
    for (const s of splitSentences(scan)) {
      const smell = smellSentence(s.text, scan, s.start);
      if (smell !== null) {
        ambiguous = smell;
        break;
      }
    }
  }
  if (ambiguous !== null) return { verdict: "ambiguous", snippet: ambiguous };
  return { verdict: "clean", snippet: null };
}

/**
 * Back-compat helper: the snippet the classifier judges `unsafe`, or null.
 * Since Codex 12:01 this is a RISK HINT, nothing more — nothing is dropped
 * on its account. Exported for tests and card-highlighting surfaces.
 */
export function findForbiddenReplyPhrase(draft: string): string | null {
  const r = classifyAttachmentReply(draft);
  return r.verdict === "unsafe" ? r.snippet : null;
}

export interface AttachmentReplyGateInput {
  attachments: Array<{ filename: string; parseStatus: string }>;
  /** The CANONICAL customer-facing draft — after stripMarkdownForEmail. */
  draftReply: string;
  /** Optional raw LLM output — classified too as belt-and-suspenders. */
  rawDraftReply?: string;
}

export interface AttachmentReplyGateResult {
  /** true → caller must set shouldEscalate=true / shouldAutoReply=false.
   *  TRUE FOR EVERY ATTACHMENT MAIL (Codex 12:01 §五.1): attachment mail is
   *  mechanically suspended from autonomous send, whatever the parse status
   *  or draft wording. */
  forceEscalate: boolean;
  escalationReason?: string;
  /** ALWAYS false (Codex 12:01 §五.2). The matcher is demoted to an advisory
   *  risk highlighter — it has NO authority to destroy a draft. Field kept so
   *  existing callers compile; their drop branches are simply dead. */
  dropDraft: boolean;
  /** Never set — see dropDraft. */
  draftDropReason?: string;
  /** ADVISORY three-state risk hint for the escalation card / observability.
   *  Grants nothing and destroys nothing: independent fresh-corpus rounds
   *  proved a regex cannot bound natural language, so this may misjudge in
   *  BOTH directions — treat it as a highlight, never a decision. */
  verdict: Verdict;
  /** The matched risky snippet (when verdict !== "clean") — for the card to
   *  highlight so Jeff's eye lands on the dangerous sentence first. */
  riskHint?: string;
}

export interface FinalizeAutonomousDraftResult {
  /** Canonical outgoing body — EXACT string for sendReplyInThread. ALWAYS
   *  the canonicalized draft, never emptied: Jeff edits it on the card. */
  bodyText: string;
  forceEscalate: boolean;
  /** ALWAYS false — kept for caller compatibility (Codex 12:01 §五.2). */
  droppedDraft: boolean;
  reason?: string;
  /** Advisory risk hint — see AttachmentReplyGateResult.verdict. */
  verdict: Verdict;
}

/**
 * The FINAL canonical chokepoint for autonomous sends (Codex 16:02 P1-3;
 * demoted to suspension + advisory by Codex 12:01 §五). Runs AFTER all
 * augmentation (CTA append etc.). For attachment mail it ALWAYS escalates —
 * the draft is preserved for Jeff, with the risk hint in the reason. Callers
 * MUST hand `bodyText` to sendReplyInThread verbatim (the MIME builder adds
 * its own fixed footer; safety normalization never enters bodyText).
 */
export function finalizeAutonomousDraft(input: {
  draftReply: string;
  attachments: Array<{ filename: string; parseStatus: string }>;
}): FinalizeAutonomousDraftResult {
  const bodyText = stripMarkdownForEmail(input.draftReply);
  const verdict = evaluateAttachmentReplyGate({
    attachments: input.attachments,
    draftReply: bodyText,
    rawDraftReply: input.draftReply,
  });
  return {
    bodyText,
    forceEscalate: verdict.forceEscalate,
    droppedDraft: false,
    verdict: verdict.verdict,
    reason: verdict.escalationReason,
  };
}

export function evaluateAttachmentReplyGate(
  input: AttachmentReplyGateInput,
): AttachmentReplyGateResult {
  // No attachments → nothing to gate. Normal mail must be able to discuss
  // e.g.「上次檔案打不開的問題」without tripping anything.
  if (input.attachments.length === 0) {
    return { forceEscalate: false, dropDraft: false, verdict: "clean" };
  }

  // ── Mechanical suspension (Codex 12:01 §五.1) ──
  // ANY attachment → escalate, full stop. Four consecutive independent
  // fresh-corpus rounds proved the wording matcher cannot be a safe
  // auto-send boundary (leaks kept reaching `clean`, good drafts kept dying
  // as `unsafe`), so the matcher below is advisory only and the send
  // decision is no longer language-dependent at all.
  const result: AttachmentReplyGateResult = {
    forceEscalate: true,
    dropDraft: false,
    verdict: "clean",
  };

  const unreadable = input.attachments.filter(
    (a) => !READABLE_ATTACHMENT_STATUSES.has(a.parseStatus),
  );
  if (unreadable.length > 0) {
    const list = unreadable.map((a) => `${a.filename}(${a.parseStatus})`).join("、");
    result.escalationReason = `有 ${unreadable.length} 個附件系統讀不出來:${list}。備援也試過了,要麻煩你開原始檔看;這封不能自動回。`;
  } else {
    result.escalationReason =
      "這封信帶附件,附件信一律由你確認後才回(草稿我擬好了,直接改直接送都行)。";
  }

  // ── Advisory risk hint (Codex 12:01 §五.2) — highlight, never decide. ──
  const a = classifyAttachmentReply(input.draftReply);
  const b =
    input.rawDraftReply && input.rawDraftReply !== input.draftReply
      ? classifyAttachmentReply(input.rawDraftReply)
      : { verdict: "clean" as Verdict, snippet: null as string | null };
  // strongest wins: unsafe > ambiguous > clean.
  const rank = (v: Verdict) => (v === "unsafe" ? 2 : v === "ambiguous" ? 1 : 0);
  const chosen = rank(a.verdict) >= rank(b.verdict) ? a : b;

  if (chosen.verdict !== "clean" && chosen.snippet) {
    result.verdict = chosen.verdict;
    result.riskHint = chosen.snippet;
    result.escalationReason += `注意:草稿裡「${chosen.snippet}」看起來像把讀檔問題推給客人,寄出前請特別看這句。`;
  }

  return result;
}
