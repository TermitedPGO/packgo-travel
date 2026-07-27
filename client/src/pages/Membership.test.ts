/**
 * Membership 頁面的方案結構鎖(2026-07-25 Jeff 裁定)。
 *
 * 裁定內容:會員制改為單一免費層,砍掉 Plus 與 Concierge 付費層。理由:
 *   一,加州 Business and Professions Code 17550.27(Seller of Travel Discount
 *       Program)規定收費會員需維持 10 萬美元保證金、年費上限 150 美元、
 *       續約授權不得在到期前 60 天以上取得。現行 Stripe 訂閱在加入當下即取得
 *       永久扣款同意,與該條牴觸。
 *   二,加州自動續訂法(現行控制版本 AB 2863,2025-01-01 生效)的完整揭露、
 *       獨立同意、續訂前通知、線上取消義務,一人公司維護成本與收益不成比例。
 *   三,同業(雄獅、Trip.com、走四方、途風)忠誠方案全部免費。
 *
 * 這一條鎖的是「頁面上不得再出現付費層與自動扣款語句」。
 * 若日後要恢復付費層,必須先完成上述法遵並更新本測試,不得直接刪測試。
 *
 * 為什麼用原始碼掃描而非渲染:本頁依賴 tRPC、路由與 i18n context,
 * 渲染測試需要大量 mock,而 mock 一旦漂移就會變成假綠(見 docs/adr/0005)。
 * 掃原始碼直接鎖「檔案裡不存在付費結構」,mock 漂移不會影響它。
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAW = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Membership.tsx"),
  "utf8",
);

/**
 * 掃描前先剝掉註解。
 *
 * 為什麼:本檔的檔頭註解必須說明「本頁不再有免費試用、價格、Stripe 結帳」,
 * 那是給後人看的裁定依據。若連註解一起掃,這條說明本身就會讓測試變紅,
 * 逼得未來的人去刪註解來讓測試過 —— 那正是 docs/adr/0005 記錄過的
 * 「檢查腳本逼出不誠實行為」那一類錯誤。
 *
 * 所以判準是:程式碼裡不得出現,註解裡可以說明為什麼不出現。
 */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const TERMS_RAW = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "MembershipTerms.tsx"),
  "utf8",
);
const TERMS_SRC = TERMS_RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("MembershipTerms:零硬編碼(R3,P1-2)", () => {
  it("剝註解後 JSX 不得含任何中日韓字元(文案一律走 t())", () => {
    const cjk = TERMS_SRC.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g);
    expect(cjk ?? []).toEqual([]);
  });
});

describe("Membership 頁面:單一免費層(Jeff 2026-07-25 裁定)", () => {
  it("不得出現 Plus 或 Concierge 付費層的方案定義", () => {
    expect(SRC).not.toMatch(/key:\s*["']plus["']/);
    expect(SRC).not.toMatch(/key:\s*["']concierge["']/);
  });

  it("不得出現任何年費或月費金額", () => {
    expect(SRC).not.toMatch(/plusYearly|plusMonthly|conciergeYearly|conciergeMonthly/);
    // 2026-07-26 R2(P1-5):終驗抓到 34.99 是誤植,舊 Concierge 月費實為
    // 39.99;圍欄同時補上 99 與 399,並改用金額語境(\$ 或 price)防漏。
    expect(SRC).not.toMatch(/\b(89|349|99|399|9\.99|39\.99)\b/);
  });

  it("不得出現月付年付切換(那是付費層才需要的)", () => {
    expect(SRC).not.toMatch(/billingPeriod/);
  });

  it("不得出現免費試用與自動扣款語句(加州自動續訂法)", () => {
    expect(SRC).not.toMatch(/trial|試用/i);
  });

  it("不得呼叫 Stripe 結帳", () => {
    expect(SRC).not.toMatch(/createCheckoutSession|checkoutMutation/);
  });

  // 2026-07-26 R2(P1-3)→R3 強化:Jeff 原話「會員積分就可以了」。
  // R2 版只掃 membership.feat* token,終驗證實直接塞英文 literal 仍綠。
  // R3 版改成 features 區塊逐行白名單:每一個項目行都必須恰好是
  // 允許的 t() key,塞任何 literal、任何非 Packpoint key 都紅。
  it("權益清單逐行白名單:只准 Packpoint 系 t() key,禁任何 literal", () => {
    const m = SRC.match(/features:\s*\[([\s\S]*?)\]/);
    expect(m).toBeTruthy();
    const lines = m![1].split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    const ALLOWED = /^\{ text: t\("membership\.feat(Packpoint[A-Za-z]*|AutoUpgrade)"\), included: (true|false) \},?$/;
    for (const line of lines) {
      expect(line).toMatch(ALLOWED);
    }
  });

  it("方案陣列只有一個項目", () => {
    const keys = [...SRC.matchAll(/key:\s*["']([a-z]+)["']\s*as const/g)].map((m) => m[1]);
    expect(keys).toEqual(["free"]);
  });
});
