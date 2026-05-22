/**
 * Test fixtures for InquiryAgent — one realistic email per new v2 Wave 3
 * sub-intent. Used by `inquiryAgent.test.ts` to mock the LLM response and
 * verify the classifier round-trips each sub-intent correctly.
 *
 * Module 3.1 ships these 5 fixtures. Module 3.8 (broader inquiry vitest
 * smoke) will add escalation + classification-failure fixtures to the
 * same file.
 *
 * Style notes:
 *   - Subject + body are realistic PACK&GO inbox phrasings (zh-TW heavy)
 *     so a real Stage 4 manual smoke test reads naturally.
 *   - `from` uses test@ — no real customer data.
 *   - No PII leaks — these are fictional inquiries.
 */

export type InquiryFixture = {
  from: string;
  subject: string;
  body: string;
  /** Expected classification when the LLM does its job correctly. */
  expectedIntent:
    | "quote_request"
    | "flight_inquiry"
    | "tour_comparison_request"
    | "visa_inquiry"
    | "deposit_inquiry";
};

export const FIXTURE_QUOTE_REQUEST: InquiryFixture = {
  from: "test-quote@example.com",
  subject: "請問芝加哥 5 天行程報價",
  body:
    "Hi 您好,想請問 2026 年 8 月 22 日 4 大人 1 小孩芝加哥 5 天 4 夜行程的報價,飯店希望 4 星以上,謝謝!",
  expectedIntent: "quote_request",
};

export const FIXTURE_FLIGHT_INQUIRY: InquiryFixture = {
  from: "test-flight@example.com",
  subject: "比較聯航和達美的價格",
  body:
    "請問 9 月 15 日 LAX → JFK 來回,聯航 vs 達美 vs 美航哪家划算?我希望直飛,行李 2 件。可以幫我比一比並提供購買連結嗎?",
  expectedIntent: "flight_inquiry",
};

export const FIXTURE_TOUR_COMPARISON: InquiryFixture = {
  from: "test-compare@example.com",
  subject: "日本 9 月有什麼團?",
  body:
    "您好,我和先生在規劃 9 月底的日本旅遊,15 天左右,目的地不限。請問 PACK&GO 有什麼推薦的路線可以選擇?想看 3-5 條來比一比。",
  expectedIntent: "tour_comparison_request",
};

export const FIXTURE_VISA_INQUIRY: InquiryFixture = {
  from: "test-visa@example.com",
  subject: "中國簽證怎麼辦理?",
  body:
    "Hi PACK&GO,我打算 10 月底去上海,持美國護照。請問中國簽證要準備哪些資料?可以代辦嗎?需要多久?費用大概多少?",
  expectedIntent: "visa_inquiry",
};

export const FIXTURE_DEPOSIT_INQUIRY: InquiryFixture = {
  from: "test-deposit@example.com",
  subject: "確認訂金有沒有付到",
  body:
    "您好,我上週訂了黃石公園 7 天行程訂單號 PG-1234,訂金 USD 500 已經轉帳了,但還沒收到確認信。可以幫我查一下是否到帳?順便寄一份 receipt 給我嗎?謝謝。",
  expectedIntent: "deposit_inquiry",
};

/** All 5 v2 Wave 3 fixtures, in declaration order. */
export const SUBINTENT_FIXTURES: InquiryFixture[] = [
  FIXTURE_QUOTE_REQUEST,
  FIXTURE_FLIGHT_INQUIRY,
  FIXTURE_TOUR_COMPARISON,
  FIXTURE_VISA_INQUIRY,
  FIXTURE_DEPOSIT_INQUIRY,
];

/**
 * v2 Wave 3 Module 3.8 — escalation-path fixtures.
 * Cover the always-escalate intents + critical-urgency + low-confidence paths.
 * (No `expectedIntent` — these tests assert escalation behavior, not the
 *  intent itself, so the fixture is intent-agnostic.)
 */
export const FIXTURE_REFUND_REQUEST = {
  from: "test-refund@example.com",
  subject: "退款請求",
  body: "我要退款,這個行程不符合我的期待。",
};

export const FIXTURE_COMPLAINT = {
  from: "test-upset@example.com",
  subject: "投訴",
  body: "服務態度有問題,請給我交代。",
};

export const FIXTURE_CRITICAL_URGENCY = {
  from: "test-emergency@example.com",
  subject: "緊急狀況",
  body: "在芝加哥機場錯過接機,身上沒有現金、不會說英文,怎麼辦?",
};

export const FIXTURE_LOW_CONFIDENCE = {
  from: "test-vague@example.com",
  subject: "?",
  body: "嗨。",
};
