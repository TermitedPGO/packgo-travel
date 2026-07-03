/**
 * testAccounts — customer-cockpit Phase6 A6「測試帳號排除 helper」。
 *
 * 目的:給「稽核/評分/canary 類」呼叫點一個共用的排除判斷,避免業主本人與
 * 專職測試客人污染樣本(例如 draftEval 月度草稿評分抓到 Jeff 自己的信、
 * 或塊 D 的每週稽核把 0909 canary 自己灌的資料當成真客人差異回報)。
 *
 * OWN_EMAILS 定義在這裡(不是 gmailPipeline.ts)——這是刻意的架構選擇:
 * 這支模組是 zero-heavy-dependency 的 leaf module(沒有 db/redis/gmail
 * client),draftEval 和塊 D 的稽核/canary cron 都要 import isTestOrOwnerAccount;
 * 若 OWN_EMAILS 留在 gmailPipeline.ts 定義,任何 import 都會拖進它整條
 * db/redis/gmail/receiptExtractor/inquiryAgent 重型 import chain(單元測試
 * 要 mock 一長串不相關的 collaborator)。gmailPipeline.ts 改成從這裡反向
 * import OWN_EMAILS。
 *
 * 這是**排除稽核/評分樣本**用的,跟 gmailPipeline.ts 的 isOwnEmail 防火牆
 * (排除「建客人檔」)是不同關注點,兩者刻意分開:
 *   - isOwnEmail 只排 jeffhsieh09@gmail.com / support@packgoplay.com ——
 *     jeffhsieh0909@gmail.com 故意留在管線內,因為它是要走完整客人管線驗收
 *     用的 E2E 測試客人。
 *   - 這支 isTestOrOwnerAccount 額外把 jeffhsieh0909@gmail.com 也排掉,因為
 *     稽核/評分是「回報系統對真客人的表現」,0909 的資料是測試噪音,兩者都
 *     不該進樣本。
 *
 * profileId 排除清單(2026-07-03 監工拍板,見 dispatch-phase6.md A6):
 *   - 2760017:0909 測試客人,批 5 後訪客卡+會員卡癒合成的會員卡。
 *   - 2730002:Jeff 自己的個人卡(userId=1)——不是待合併的重複卡,是業主
 *     本人的卡,同樣不該進客人稽核/評分樣本。
 *
 * 硬紅線:不動 adminCustomers.ts 的客人列表/badge 查詢——那些已經靠既有
 * role='user' / userId IS NULL 條件天然排除業主,這支 helper 是給「其他」
 * 呼叫點用的(draftEval 樣本排除、塊 D 稽核/canary)。
 */

/**
 * 自家/系統寄件地址(原本定義在 gmailPipeline.ts,A6 移到這裡當 source of
 * truth——見上方 module doc)。gmailPipeline.ts 的 isOwnEmail 防火牆與這支
 * isTestOrOwnerAccount 共用同一份清單,避免同一組 literal 兩邊各存一份。
 */
export const OWN_EMAILS = new Set([
  "jeffhsieh09@gmail.com",
  // jeffhsieh0909 刻意「不在」這份清單裡:它是專職 E2E 測試客人(Google 顯示
  // 名 Better way To survive,Jeff 2026-07-02 拍板)。gmailPipeline 的
  // isOwnEmail 靠這份清單讓它的信走完整客人管線(建卡/歸檔/摘要/草稿)——
  // 這支 isTestOrOwnerAccount 在下面用獨立的 EXTRA_TEST_EMAILS 另外把它加回
  // 稽核排除清單,兩個用途不衝突。
  "support@packgoplay.com",
]);

/** jeffhsieh0909@gmail.com 故意不在 OWN_EMAILS 裡(見上方 module doc)。 */
const EXTRA_TEST_EMAILS = new Set(["jeffhsieh0909@gmail.com"]);

/** profileId 2760017(0909 測試客人) / 2730002(Jeff 本人個人卡)。 */
const EXCLUDED_PROFILE_IDS = new Set([2760017, 2730002]);

/**
 * 判斷這個 email/profileId 是不是測試帳號或業主本人——是的話,稽核/評分/
 * canary 類流程應該跳過,不要當成真客人資料處理。email 比對忽略大小寫與
 * 前後空白(比照 gmailPipeline.ts isOwnEmail 的既有慣例)。
 */
export function isTestOrOwnerAccount(email?: string, profileId?: number): boolean {
  if (typeof email === "string") {
    const normalized = email.trim().toLowerCase();
    if (OWN_EMAILS.has(normalized) || EXTRA_TEST_EMAILS.has(normalized)) return true;
  }
  if (typeof profileId === "number" && EXCLUDED_PROFILE_IDS.has(profileId)) return true;
  return false;
}
