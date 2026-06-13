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

export function resolveTourReferences(
  text: string,
  tours: TourLite[],
): ResolveResult {
  const codeMatches: TourLite[] = [];
  const keywordCandidates: KeywordCandidate[] = [];
  const unknownCodes: string[] = [];
  if (!text) return { codeMatches, keywordCandidates, unknownCodes };

  // 1. 代碼路 — 抽 code-shaped tokens,對 productCode + sourceUrl
  const rawTokens = text.match(CODE_TOKEN_RE) ?? [];
  const tokens = [...new Set(rawTokens.map(normalizeCode))]
    // 過濾明顯非代碼的(純年份、太短的常見字)
    .filter((t) => t.length >= 2 && !/^\d{4}$/.test(t));
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
  const presentTerms = LOCATION_LEXICON.filter((term) =>
    text.toLowerCase().includes(term.toLowerCase()),
  );
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
