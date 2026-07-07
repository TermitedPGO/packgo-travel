/**
 * followupDraftHonesty — deterministic 誠實度 gates for follow-up drafts,
 * run BEFORE the card is stored (blocked = card not stored,寧可沒卡).
 *
 * Real incident (2026-06-29, Emerald 的 thread):一封跟進草稿開頭「Hi Leslie」
 * (這條 thread 根本不是在跟 Leslie 講話),還宣稱「quotes 已寄」,但系統完全
 * 沒有任何報價寄出記錄。語言 gate(cjk_in_en_draft)已經擋語言錯;這個模組補上
 * 另外兩個同架構的 hard gate:
 *
 *   1. 吹牛 gate (unverified_delivery_claim) — 草稿宣稱「已寄 / I've sent /
 *      attached is」等已完成交付,必須有這位客人的 deterministic 交付證據
 *      (customOrders.quoteSentAt / confirmedAt、寄出的 aiQuotes、
 *      customerDocuments uploadedBy="email_sent")背書。證據為空 → 擋。
 *      只抓強烈的過去式宣稱;未來承諾(「我會寄」「I will send」「週五可以
 *      來取」)絕不誤傷。evidence === null 代表查證失敗(UNKNOWN)→ fail-open
 *      不擋(caller log warn),絕不因為證據查詢失敗弄壞草稿鏈。
 *
 *   2. 抬頭 gate (greeting_unknown_recipient) — 草稿第一行的稱呼名字必須是
 *      對話裡真實出現過的人:inbound 內容開頭的「From: Name <email>」header、
 *      對方 email 的 local-part、profile name,以及 Jeff 自己 outbound 信開頭
 *      的稱呼(drafter 明文要 LLM 延用「Jeff 本來怎麼喊這位客人」,所以 Jeff
 *      喊過的「陳姊」就是合法稱呼)。抓不到名字(「您好」「Hi,」)一律放行;
 *      CJK 稱呼但名單裡完全沒有 CJK 名字(客人記錄全是拼音,無從對照)=
 *      UNKNOWN → 放行不擋;名字真的對不上 → 擋。
 *      名單來源查詢失敗(allowedNamesIncomplete)→ 同吹牛 gate 一樣 fail-open。
 *
 * 全模組 PURE(無 DB、無 LLM、無 logger)→ 每條規則都有單元測試。
 * evidence 的 DB 查詢在 followupDraftProducer.gatherDeliveryEvidence。
 */

export type HonestyViolation =
  | "unverified_delivery_claim"
  | "greeting_unknown_recipient"
  // 批十二-1 (P0):草稿文案聲稱「附上檔案」但這封實際沒帶任何附件 → 擋(確定性,零 LLM)。
  | "claimed_attachment_missing";

/**
 * Deterministic delivery evidence for ONE customer (same sources as
 * customerFacts.deriveDelivered — authoritative timestamps / status enums,
 * never prose). `null` at the call site = lookup failed = UNKNOWN → the claim
 * gate must fail OPEN (never block on unknown).
 */
export interface DeliveryEvidence {
  /** Any customOrders.quoteSentAt, or an aiQuotes row in sent/viewed/converted. */
  quoteSent: boolean;
  /** Any customOrders.confirmedAt (確認書出過). */
  confirmed: boolean;
  /** Files we actually emailed the customer (customerDocuments uploadedBy="email_sent"). */
  deliveredDocFileNames: string[];
}

export function hasAnyDeliveryEvidence(e: DeliveryEvidence): boolean {
  return e.quoteSent || e.confirmed || e.deliveredDocFileNames.length > 0;
}

// ── 吹牛 gate:strong past-tense delivery-claim patterns ────────────────────
// Precision guard:只收「已經完成」的宣稱。未來式(我會寄 / I will send /
// 週五可以來取)都不在這些 pattern 的匹配範圍內 — 測試明確鎖住這點。
const DELIVERY_CLAIM_PATTERNS: RegExp[] = [
  // zh(含簡體變體)
  /已寄/,
  /已發送/,
  /已发送/,
  /已提供/,
  /已確認/,
  /已确认/,
  /已經寄/,
  /已经寄/,
  /附上了/,
  /如先前寄出/,
  // en — 過去完成/過去式的明確宣稱;"I will send" / "we can send" 不會中。
  /\bI(?:'ve| have) sent\b/i,
  /\bwe(?:'ve| have)? sent\b/i,
  /\bas promised\b/i,
  /\battached (?:is|are)\b/i,
  /\balready (?:sent|provided|confirmed)\b/i,
];

/** True when the draft asserts something was ALREADY sent / provided / confirmed. */
export function detectDeliveryClaim(body: string): boolean {
  const text = body ?? "";
  return DELIVERY_CLAIM_PATTERNS.some((p) => p.test(text));
}

// ── 附件宣稱 gate (批十二-1, P0) ──────────────────────────────────────────────
// E2E 完單測試 F3:報價/請款/收據信本文寫「附在信裡」「隨信附上…PDF」,但外寄
// 郵件實際沒帶附件。這個 pattern 表只收「這封信裡就有附件」的當下宣稱;刻意避開:
//   未來式(我會附上 / 稍後附上 / I will attach)= 承諾,不是謊;
//   否定(沒有另外附件 / 不另附)= 明說沒附;
//   與附件無關的詞(附近 / 附加 / 附註 / attachment fee)。
// 只用純字串比對,零 LLM,與 detectDeliveryClaim 同架構。
const ATTACHMENT_CLAIM_PATTERNS: RegExp[] = [
  // zh —「附在這封信 / 附在信裡 / 附在信中 / 附在郵件」
  /附在(?:這封|此)?(?:信|郵件|信件)/,
  //「附於信中 / 附於郵件」
  /附於(?:此)?(?:信|郵件)/,
  //「隨信附上 / 隨函附 / 隨郵件附」
  /隨(?:信|函|郵件)附/,
  //「隨附報價單 / 隨附收據 / 隨附的文件」— 需接檔案類名詞或「的/上/了」,避免誤吃「隨附近」
  /隨附(?:上|的|了|檔|件|報價|收據|文件|發票|行程|單|表|pdf)/i,
  //「詳見附件 / 參見附件 / 如附件 / 請見附件 / 另見附件」(不收裸「見」以免吃到「意見附件」)
  /(?:如|詳見|參見|請見|另見)附件/,
  //「報價單如附」— 如附收尾,後面接標點/結尾(不接「近/加/註」)
  /如附(?=[ \t,，。;；:：!！)）】」』]|$)/,
  //「附件是 / 附檔是 / 附件請查收 / 附件如下 / 附件中 / 附件裡 / 附件供您參考」
  /附(?:件|檔案?)(?:是|為|裡|中|內|:|：|請查收|如下|供您|給您)/,
  // en — present/past「it is attached / enclosed / please find attached」(未來式 will attach 不收)
  // 「please find」需接 attached/enclosed,不吃「please find the details below」這種無附件用語。
  /\bplease find (?:the |our )?(?:attached|enclosed)/i,
  //「attached to this」限定 email/message/reply,排除「attached to this itinerary/reservation」。
  /\battached (?:is|are|please|herewith|hereto|you'?ll find|you will find|for your|to this (?:e-?mail|message|reply|note))\b/i,
  //「is/are attached」但排除慣用語「attached to X」(is attached to the reservation ≠ 帶附件)。
  /\b(?:is|are|herewith|hereto) attached\b(?!\s+to\s)/i,
  /\bi(?:'ve| have) (?:attached|enclosed)\b/i,
  /\benclosed (?:is|are|herewith|please|you'?ll find|for your)\b/i,
  /\bsee (?:the )?attach(?:ment|ed)\b/i,
  /\bin the attach(?:ment|ed)\b/i,
];

/** True when the draft claims THIS email carries an attachment (附上/附在信裡/
 * attached/enclosed). Deterministic — pair with the real attachment count to
 * catch a body that says 附上 while sending nothing. */
export function detectAttachmentClaim(body: string): boolean {
  const text = body ?? "";
  return ATTACHMENT_CLAIM_PATTERNS.some((p) => p.test(text));
}

// ── From-header parsing(shared by 抬頭 gate + 收件人顯示修正)──────────────
// gmailPipeline files inbound content as `From: ${msg.from}\nSubject: …\n\n body`
// (threadFiling backfill rows carry NO header — parsers must tolerate both).

export interface ParsedAddress {
  name: string | null;
  email: string | null;
}

/** Parse a raw RFC-ish address value: `Name <a@b.c>` / `"Name" <a@b.c>` /
 * `a@b.c`. Unknown shapes → name-only (email null). */
export function parseAddress(raw: string): ParsedAddress {
  const s = (raw ?? "").trim();
  if (!s) return { name: null, email: null };
  const angle = s.match(/^"?([^"<]*?)"?\s*<([^<>\s]+@[^<>\s]+)>$/);
  if (angle) {
    return { name: angle[1].trim() || null, email: angle[2].toLowerCase() };
  }
  const bare = s.match(/^<?([^<>\s"]+@[^<>\s"]+)>?$/);
  if (bare) return { name: null, email: bare[1].toLowerCase() };
  return { name: s, email: null };
}

/**
 * Extract the `From:` header the inbound filer prepends to stored content.
 * Anchored to the CONTENT START (same as threadFiling.bodyPrefix) so a quoted
 * reply containing "From:" mid-body never counts. Returns null when the row
 * has no header (threadFiling backfill).
 */
export function parseFromHeader(content: string | null | undefined): ParsedAddress | null {
  const s = (content ?? "").trimStart();
  const m = s.match(/^From:[ \t]*([^\r\n]+)/);
  if (!m) return null;
  const parsed = parseAddress(m[1]);
  if (!parsed.name && !parsed.email) return null;
  return parsed;
}

/** local-part of an email ("leslie.green@axt.com" → "leslie.green"). */
export function emailLocalPart(email: string | null | undefined): string | null {
  const at = (email ?? "").indexOf("@");
  return at > 0 ? (email as string).slice(0, at) : null;
}

/** Minimal row shape both gates read (matches InteractionDetailRow). */
export interface CounterpartyRow {
  direction: "inbound" | "outbound";
  content: string | null;
}

/**
 * 收件人顯示修正(gate 4):the thread counterparty = the From address of the
 * newest inbound row that carries a parseable From header (header-less
 * backfilled rows are walked past — still newest-first). None found →
 * fallback (profile email). This is what the card displays as 收件 AND what
 * sendEscalationReply puts in the To: header, so for a merged card
 * (leslie→Emerald) the display and the actual recipient finally agree.
 */
export function pickCounterpartyEmail(
  rowsNewestFirst: CounterpartyRow[],
  fallbackEmail: string,
): string {
  for (const r of rowsNewestFirst) {
    if (r.direction !== "inbound") continue;
    const parsed = parseFromHeader(r.content);
    if (parsed?.email) return parsed.email;
  }
  return fallbackEmail;
}

// ── 抬頭 gate ────────────────────────────────────────────────────────────────

/** Generic (non-name) greeting words — "Hi there," / "Dear Valued Customer"
 * are style problems, not wrong-person problems → treated as no-name (pass). */
const GREETING_STOPWORDS = new Set([
  "there", "all", "everyone", "team", "friend", "friends", "both", "again",
  "sir", "madam", "folks", "guys", "valued", "customer", "customers", "client",
  "clients", "guest", "guests", "traveler", "travelers", "traveller", "travellers",
  "family",
]);

const CJK_RE = /[一-鿿]/;
/** zh 稱呼 suffixes stripped off a greeting name(「王姊姊您好」→ 王). Longest first. */
const ZH_HONORIFIC_SUFFIX =
  /(?:姊姊|姐姐|哥哥|大哥|大姐|阿姨|叔叔|先生|小姐|太太|女士|老師|姊|姐|哥|兄)+$/;

/** An English greeting name token: capitalized word ("Leslie", "O'Brien"). */
const EN_NAME_TOKEN = /^[A-Z][A-Za-z.'-]*$/;

function firstNonEmptyLine(body: string): string {
  for (const line of (body ?? "").split(/\r?\n/)) {
    const t = line.trim();
    if (t) return t;
  }
  return "";
}

/**
 * Extract the greeting NAME from a draft's first line, or null when the
 * greeting carries no confident name (null = gate passes).
 *   "Hi Leslie,…" → "Leslie" · "Dear Emerald Young" → "Emerald Young"
 *   "王姊姊您好"   → "王"     · "Leslie 您好" → "Leslie" · "王姊," → "王"
 *   "您好" / "Hi," / "Hi there," / "Dear valued customer" → null
 */
export function extractGreetingName(body: string): string | null {
  const line = firstNonEmptyLine(body);
  if (!line) return null;

  // English opener: Hi/Hello/Hey/Dear + name tokens, up to the first clause break.
  const en = line.match(/^(?:hi|hello|hey|dear)[ \t]+([^,,!!.。::;;]+)/i);
  if (en) {
    const candidate = en[1].trim();
    const tokens = candidate.split(/\s+/);
    // >2 tokens = almost certainly a sentence ("Hi hope you are well") → no name.
    if (tokens.length === 0 || tokens.length > 2) return null;
    if (tokens.some((t) => GREETING_STOPWORDS.has(t.toLowerCase()))) return null;
    if (!tokens.every((t) => EN_NAME_TOKEN.test(t) || CJK_RE.test(t))) return null;
    return tokens.join(" ");
  }

  if (CJK_RE.test(line)) {
    // "X您好" / "X 你好" — name is whatever precedes the 您好/你好.
    const nihao = line.match(/^(.{0,16}?)[\s,,]*(?:您好|你好)/);
    if (nihao) {
      const name = nihao[1].replace(ZH_HONORIFIC_SUFFIX, "").trim();
      return name || null;
    }
    // A line that IS just "X姊," / "X哥:" (稱呼-suffixed name alone).
    const bare = line.match(
      /^([^\s,,、!!??::;;]{1,12}?)(?:姊姊|姐姐|哥哥|大哥|大姐|阿姨|叔叔|先生|小姐|太太|女士|姊|姐|哥)\s*[,,::!!]?$/,
    );
    if (bare) return bare[1].trim() || null;
  }
  return null;
}

/** Row shape the allowed-name collector reads. */
export interface GreetingSourceRow {
  direction: "inbound" | "outbound";
  content: string | null;
}

/** Strip the filer's `From:…\nSubject:…\n\n` header block if present (same
 * shape threadFiling.bodyPrefix strips), so greeting extraction always looks
 * at the real first line of the letter. Header-less content passes through. */
function stripFiledHeaderBlock(content: string | null | undefined): string {
  const s = content ?? "";
  const header = s.trimStart().match(/^From:.*\r?\nSubject:.*\r?\n\r?\n/);
  return header ? s.trimStart().slice(header[0].length) : s;
}

/**
 * The set of names a greeting is ALLOWED to address = people who actually
 * appear in this conversation: inbound From-header display names + the
 * local-part of counterparty emails + the profile name/email + the greeting
 * names of JEFF'S OWN outbound turns. The last source is load-bearing:
 * followupDrafter explicitly instructs the LLM to reuse the 稱呼 Jeff already
 * used for this customer (「陳姊」「王姊姊」), which lives in OUTBOUND content
 * only — a romanized profile ("Jenny Chen") can never vouch for it. Deduped,
 * original casing kept (matching is case-insensitive).
 */
export function collectAllowedGreetingNames(input: {
  rowsNewestFirst: GreetingSourceRow[];
  profileName?: string | null;
  profileEmail?: string | null;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (v: string | null | undefined) => {
    const t = (v ?? "").trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  for (const r of input.rowsNewestFirst) {
    if (r.direction === "inbound") {
      const parsed = parseFromHeader(r.content);
      if (!parsed) continue;
      add(parsed.name);
      add(emailLocalPart(parsed.email));
    } else {
      // Jeff's own greeting on a sent letter = the drafter's mandated 稱呼
      // source. extractGreetingName is conservative (no confident name → null)
      // so non-greeting openers ("報價附上") contribute nothing.
      add(extractGreetingName(stripFiledHeaderBlock(r.content)));
    }
  }
  add(input.profileName);
  add(emailLocalPart(input.profileEmail));
  return out;
}

/**
 * Case-insensitive membership with first-name matching:
 *   "Hi Leslie" matches allowed "Leslie Green" (token match) and
 *   "leslie.green" (email local-part split on ._-). CJK: prefix match either
 *   way, so greeting "王" matches profile「王美麗」and vice versa.
 *
 * CJK bridge fail-open: a CJK greeting when the allowed set has ZERO CJK
 * names is UNKNOWN, not a mismatch — records are romanized ("Jenny Chen" /
 * "jchen88") and we cannot deterministically map 陳↔Chen, so blocking here
 * would systematically suppress the 慣稱(陳姊/王哥)drafts Jeff mandates.
 * No evidence to contradict → pass (Jeff reviews every draft anyway).
 */
export function isGreetingNameAllowed(greetingName: string, allowedNames: string[]): boolean {
  const g = greetingName.trim().toLowerCase();
  if (!g) return true;
  const keys = new Set<string>();
  const cjkKeys: string[] = [];
  for (const name of allowedNames) {
    const n = (name ?? "").trim().toLowerCase();
    if (!n) continue;
    keys.add(n);
    for (const tok of n.split(/[\s._-]+/)) if (tok) keys.add(tok);
    if (CJK_RE.test(n)) cjkKeys.push(n);
  }
  if (keys.has(g)) return true;
  for (const tok of g.split(/\s+/)) if (keys.has(tok)) return true;
  if (CJK_RE.test(g)) {
    if (cjkKeys.length === 0) return true; // no CJK evidence at all → UNKNOWN → pass
    for (const a of cjkKeys) if (a.startsWith(g) || g.startsWith(a)) return true;
  }
  return false;
}

// ── combined check ───────────────────────────────────────────────────────────

export interface HonestyCheckInput {
  /** The CLEANED draft body (after sanitizeFollowupDraftBody). */
  body: string;
  /** Deterministic delivery evidence; null = lookup failed = UNKNOWN → fail-open. */
  evidence: DeliveryEvidence | null;
  /** From collectAllowedGreetingNames. */
  allowedGreetingNames: string[];
  /** 批十二-1 (P0):這封草稿/信件實際帶了幾個附件 → true 代表 ≥1 個。只有明確
   * 傳 false(呼叫端確知沒附件)時,才會在文案聲稱附件卻沒帶時擋下;undefined
   * = 呼叫端不判附件(維持舊行為,gate 不觸發)。附件是確定性事實(不像交付/
   * 抬頭有 UNKNOWN),所以聲稱+false 一律硬擋,沒有 fail-open。 */
  hasAttachment?: boolean;
  /** True when a source of allowed names could not be read (e.g. the profile
   * name lookup failed). The set may be missing the very name that would have
   * vouched for the greeting, so a non-match is UNKNOWN → the greeting gate
   * fails OPEN too — same fail-open contract as evidence:null on the claim
   * gate (a lookup hiccup must never break drafting). */
  allowedNamesIncomplete?: boolean;
}

export interface HonestyCheckResult {
  ok: boolean;
  violations: HonestyViolation[];
  /** Claim pattern matched but evidence was UNKNOWN → caller should log a warn
   * (we failed open on purpose — never break drafting on a lookup hiccup). */
  claimWithUnknownEvidence: boolean;
  /** Greeting name did NOT match, but the allowed-name set was incomplete
   * (lookup failure) → failed open on purpose; caller should log a warn. */
  greetingWithUnknownNames: boolean;
  /** The greeting name we extracted (null = no-name greeting), for logs. */
  greetingName: string | null;
  /** 批十二-1:文案是否聲稱這封信帶了附件(供 log / UI badge 用)。 */
  attachmentClaim: boolean;
}

/** Both gates in one pure call; blocked = ok:false = do NOT store the card. */
export function checkFollowupDraftHonesty(input: HonestyCheckInput): HonestyCheckResult {
  const violations: HonestyViolation[] = [];
  let claimWithUnknownEvidence = false;
  let greetingWithUnknownNames = false;

  if (detectDeliveryClaim(input.body)) {
    if (input.evidence === null) {
      claimWithUnknownEvidence = true; // UNKNOWN → fail-open, warn only
    } else if (!hasAnyDeliveryEvidence(input.evidence)) {
      violations.push("unverified_delivery_claim");
    }
  }

  const greetingName = extractGreetingName(input.body);
  if (greetingName && !isGreetingNameAllowed(greetingName, input.allowedGreetingNames)) {
    if (input.allowedNamesIncomplete) {
      greetingWithUnknownNames = true; // UNKNOWN → fail-open, warn only
    } else {
      violations.push("greeting_unknown_recipient");
    }
  }

  // 附件 gate:文案聲稱附上檔案,但呼叫端確知這封沒帶任何附件 → 硬擋(寧可沒卡)。
  // 附件有無是確定性事實,沒有 UNKNOWN fail-open;undefined 代表呼叫端不判(舊行為)。
  const attachmentClaim = detectAttachmentClaim(input.body);
  if (attachmentClaim && input.hasAttachment === false) {
    violations.push("claimed_attachment_missing");
  }

  return {
    ok: violations.length === 0,
    violations,
    claimWithUnknownEvidence,
    greetingWithUnknownNames,
    greetingName,
    attachmentClaim,
  };
}
