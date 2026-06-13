/**
 * tourReferenceResolver — 把客人信裡的「團指涉」對到 PACK&GO 現有的團
 * (2026-06-13 spike,起因 Jeff:測 AI 能不能辨別現有團;YG7/YL7 是測試代號)。
 *
 * 為什麼需要:InquiryAgent 寫草稿時只看信件文字,對 tour 庫零存取,所以
 * 客人提 YG7 / 黃石團 時 AI 只能腦補。這支在草稿前先解析,讓草稿有料。
 *
 * 三條路,誠實分流(永不假裝):
 *   codeMatches      — 代碼樣 token 對到 productCode / sourceUrl(精確或內含)
 *   keywordCandidates— 地點關鍵字命中 title / destinationCity(模糊候選,給分)
 *   unknownCodes     — 代碼樣 token 一個都對不上(例:YG7 — 你庫裡沒這碼)
 *
 * 純函式 resolveTourReferences(text, tours):無 DB、無 LLM,可窮舉單測。
 * DB 版 resolveFromCatalog 只是包一層查詢。
 */

export interface TourLite {
  id: number;
  title: string;
  productCode: string | null;
  sourceUrl: string | null;
  destinationCity: string | null;
  status: string;
}

export interface KeywordCandidate {
  tour: TourLite;
  /** matched location terms (去重). */
  terms: string[];
  /** = terms.length,候選排序用. */
  score: number;
}

export interface ResolveResult {
  codeMatches: TourLite[];
  keywordCandidates: KeywordCandidate[];
  unknownCodes: string[];
}

/**
 * 地點關鍵字詞庫 — 涵蓋 PACK&GO 現有名錄的主要目的地。客人文字裡出現、
 * 且某團 title/destinationCity 也含這個詞 → 該團是候選。詞庫小而精,
 * 寧可漏抓不要亂抓(漏 → fallback 問客人;亂抓 → 給 Jeff 錯候選)。
 */
const LOCATION_LEXICON: string[] = [
  // 美西 / 黃石圈
  "黃石", "Yellowstone", "美西", "大峽谷", "羚羊峽谷", "傑克遜", "馬蹄灣",
  "拱門", "紀念碑谷", "大堤頓", "錫安", "布萊斯", "總統巨岩", "賭城", "拉斯維加斯",
  "洛杉磯", "舊金山", "優勝美地", "丹佛",
  // 美加東
  "美加東", "美東", "尼加拉", "紐約", "波士頓", "華盛頓",
  // 夏威夷
  "夏威夷", "Hawaii", "歐胡", "茂宜", "大島",
  // 日本
  "東京", "富士", "箱根", "京阪神", "京都", "大阪", "奈良", "關西",
  "北海道", "札幌", "函館", "小樽", "九州", "福岡", "立山", "黑部", "白川", "高山",
  // 中國 / 簽證
  "中國", "簽證", "北京", "西安", "上海", "蘇州", "江南", "張家界", "桂林",
  // 其他
  "台灣", "韓國", "首爾",
];

/** 代碼樣 token:2-5 個大寫字母接 1-4 數字,可帶尾碼(YG7, YL7, SJX10, 26AK516)。 */
const CODE_TOKEN_RE = /\b[A-Z]{1,5}\d{1,4}[A-Z]{0,3}(?:-[A-Z])?\b|\b\d{2}[A-Z]{2,}\d{2,}[A-Z-]*\b/g;

function normalizeCode(s: string): string {
  return s.trim().toUpperCase();
}

/** 抽出客人文字裡的代碼樣 token(去重、去純年份、去太短)。 */
export function extractCodeTokens(text: string): string[] {
  if (!text) return [];
  const raw = text.match(CODE_TOKEN_RE) ?? [];
  return [...new Set(raw.map(normalizeCode))].filter(
    (t) => t.length >= 2 && !/^\d{4}$/.test(t),
  );
}

/** 抽出客人文字裡出現的地點詞(詞庫交集)。 */
export function extractLocationTerms(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  return LOCATION_LEXICON.filter((term) => lower.includes(term.toLowerCase()));
}

export function resolveTourReferences(
  text: string,
  tours: TourLite[],
): ResolveResult {
  const codeMatches: TourLite[] = [];
  const keywordCandidates: KeywordCandidate[] = [];
  const unknownCodes: string[] = [];
  if (!text) return { codeMatches, keywordCandidates, unknownCodes };

  // 1. 代碼路 — 抽 code-shaped tokens,對 productCode + sourceUrl
  const tokens = extractCodeTokens(text);
  const matchedCodeTourIds = new Set<number>();
  for (const tok of tokens) {
    let hit = false;
    for (const t of tours) {
      const pc = (t.productCode ?? "").toUpperCase();
      const su = (t.sourceUrl ?? "").toUpperCase();
      if (pc === tok || (pc && pc.includes(tok)) || (su && su.includes(tok))) {
        if (!matchedCodeTourIds.has(t.id)) {
          codeMatches.push(t);
          matchedCodeTourIds.add(t.id);
        }
        hit = true;
      }
    }
    if (!hit) unknownCodes.push(tok);
  }

  // 2. 關鍵字路 — 客人文字裡出現的地點詞,對 title/destinationCity
  const presentTerms = extractLocationTerms(text);
  if (presentTerms.length > 0) {
    for (const t of tours) {
      if (matchedCodeTourIds.has(t.id)) continue; // 已被代碼命中,不重複列
      const hay = `${t.title} ${t.destinationCity ?? ""}`.toLowerCase();
      const terms = [
        ...new Set(presentTerms.filter((term) => hay.includes(term.toLowerCase()))),
      ];
      if (terms.length > 0) {
        keywordCandidates.push({ tour: t, terms, score: terms.length });
      }
    }
    keywordCandidates.sort((a, b) => b.score - a.score || a.tour.id - b.tour.id);
  }

  return { codeMatches, keywordCandidates, unknownCodes };
}

/* ───────────────────────── DB-backed(bounded)───────────────────────── */

export interface ResolvedCandidate {
  id: number;
  title: string;
  status: string;
  /** how it matched — for the prompt + card to label it. */
  via: "code" | "keyword";
  terms?: string[];
}

export interface ResolveFromEmailResult {
  candidates: ResolvedCandidate[];
  unknownCodes: string[];
}

/**
 * Resolve tour references from a customer email against the live catalog.
 * Bounded: extract code/location tokens in JS first (cheap); only query the
 * DB when something is present, and only for tours matching those tokens
 * (never the whole 6000-row catalog). active tours rank above draft.
 */
export async function resolveFromEmail(
  text: string,
): Promise<ResolveFromEmailResult> {
  const codes = extractCodeTokens(text);
  const terms = extractLocationTerms(text);
  if (codes.length === 0 && terms.length === 0) {
    return { candidates: [], unknownCodes: [] };
  }

  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) return { candidates: [], unknownCodes: codes };

  const { tours } = await import("../../drizzle/schema");
  const { or, like, sql } = await import("drizzle-orm");

  // Build a bounded OR-filter: title/destinationCity LIKE each location term,
  // productCode/sourceUrl LIKE each code token. Cap the row set.
  const conds = [
    ...terms.flatMap((t) => [
      like(tours.title, `%${t}%`),
      like(tours.destinationCity, `%${t}%`),
    ]),
    ...codes.flatMap((c) => [
      like(tours.productCode, `%${c}%`),
      like(tours.sourceUrl, `%${c}%`),
    ]),
  ];
  if (conds.length === 0) return { candidates: [], unknownCodes: codes };

  const rows = (await db
    .select({
      id: tours.id,
      title: tours.title,
      productCode: tours.productCode,
      sourceUrl: tours.sourceUrl,
      destinationCity: tours.destinationCity,
      status: tours.status,
    })
    .from(tours)
    .where(or(...conds))
    // active first, then newest
    .orderBy(sql`(${tours.status} = 'active') DESC`, sql`${tours.id} DESC`)
    .limit(60)) as TourLite[];

  const resolved = resolveTourReferences(text, rows);

  // Flatten to a single ranked candidate list: code matches first (strongest
  // signal), then keyword candidates. Cap to keep the prompt + card tight.
  const candidates: ResolvedCandidate[] = [
    ...resolved.codeMatches.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      via: "code" as const,
    })),
    ...resolved.keywordCandidates.map((c) => ({
      id: c.tour.id,
      title: c.tour.title,
      status: c.tour.status,
      via: "keyword" as const,
      terms: c.terms,
    })),
  ].slice(0, 8);

  return { candidates, unknownCodes: resolved.unknownCodes };
}
