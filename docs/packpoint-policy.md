# Packpoint 政策(Policy)

> PACK&GO 會員忠誠系統 — Packpoint。
> 本文件定義發放、兌換、過期、自動升級規則。
> 版本:1.0(2026-05-03 起草,Phase B 上線前最終)。

---

## 1. 基礎概念

| 項目 | 規則 |
|------|------|
| 計算單位 | 1 Packpoint = 0.01 USD(100 點 = $1 折抵) |
| 兌換方向 | 結帳時可選用點數折抵,**不可** 提現 / 不可轉讓 |
| 累積基礎 | 每消費 USD $1 = 1 base Packpoint(尚未乘 tier / tour 倍率) |
| 公式 | `points = subtotal × 1 × tier_multiplier × tour_multiplier` |

## 2. Tier 倍率(會員等級)

| Tier | Tier multiplier | 等效回饋上限(tour=2x 時) |
|------|----------------|---------------------------|
| Free | 1x | 2% |
| Plus | 5x | 10% |
| Concierge | 10x | **20%** |

註:Tier 倍率不疊加,加入較高等級即取代基礎倍率。

## 3. Tour 倍率(每團單獨設定)

由 Admin(Jeff)在後台逐團設定:

| 倍率 | 定位 | 預期 commission |
|------|------|----------------|
| **0x** | 不發點數(保留全 commission,適用於虧本邊緣) | < 8% |
| **0.25x** | **預設值** — 薄利安全 | 8-15% |
| 0.5x | 標準 | 15-20% |
| 1x | 活動 / 推廣 | > 20% |
| 2x | 雙倍特推 / 月度旗艦 | > 25% |

**強制規則:** 系統強制限制 Concierge 客在某團最終回饋率不得超過 `commission% - 5%`(例:你估 15% commission,則 Concierge 最高 10% 回饋,否則 admin 試算頁紅色警示)。

## 4. 引流點數(Engagement Bonus)

固定獎勵,**所有 tier 都享受**,不受 tier 倍率影響:

| 行為 | 獎勵點數 | 說明 |
|------|---------|------|
| 首次註冊 | +50 | 限 1 次 |
| 完成行程後寫評論 | +50 | 每筆 booking 限 1 次 |
| 推薦朋友訂購成功 | +500 | 朋友首單付款後發放(雙方都拿 +500) |
| 生日(年度) | +100 | 每年自動發放(需填生日) |
| 上傳旅遊照片 | +10 | 每張 / 限每 booking 100 張 |

**反作弊:** 同一 IP / device / 信用卡的多帳號,自動視為同一人;推薦獎僅發 1 次。

## 5. 兌換規則(Redemption)

- **每筆 booking 最多用 50% 訂單金額兌換**(防止累積大量點數一次清掉,影響 cash flow)
- **最低兌換門檻:** 100 點(等於 $1)
- **兌換不退:** 已兌換點數不能反向換回,即使取消訂單也不還原(防 abuse)
- **退款行為:** 
  - 取消訂單若**已發點**,扣回該次發放的 packpoint(若餘額不足,記為負餘額,需用未來訂單補回)
  - 取消訂單若**有用點數兌換**,點數不退、現金照退
- **促銷團不可疊加:** 已標示「特價」的訂單可能標 0x,UI 會明示

## 6. 過期規則

- **無活動過期:** 帳戶連續 18 個月無「earn 或 redeem」活動 → 點數歸零
- **點數本身不個別過期** — 以帳戶為單位,任何活動重置 18 個月計時器
- **失效前 30 天提醒** Email,讓用戶有機會用掉

## 7. 自動升級(Auto-upgrade)

讓活躍 Free 用戶賺到等級,而非全靠付費:

| 條件 | 獎勵 |
|------|------|
| 12 個月內累積消費 ≥ **$5,000** | 免費升 Plus 1 年(每年自動評估) |
| 12 個月內累積消費 ≥ **$20,000** | 免費升 Concierge 1 年 |

- 12 個月為**滾動**(rolling),不是日曆年
- 升級後 12 個月內若再次達標,自動續期
- 若不再達標,期滿後降回原本 tier(已賺得 packpoint **不會過期**)
- **付費會員不受此影響**(已付 $89 / $349 的客人保留所付期間的 tier)

## 8. 排除條款(Earning Exclusions)

以下情況**不發 Packpoint**:

1. 訂單已使用其他優惠碼(coupon code)— 防止疊加
2. 第三方代訂連結(Trip.com 機票、訂房 affiliate)— commission 走別處
3. 已被取消或退款的訂單
4. 訂單金額為 $0(全用點數兌換)的部分(不能用點數刷點數)
5. Admin 手動標記「不參與 Packpoint」的訂單(例如員工/家人折扣單)

## 9. 帳戶與隱私

- 點數綁定**用戶 ID**,不能轉讓給其他帳戶
- **過世繼承:** 家屬出示文件後,點數可一次性兌換現金(以發放當下匯率)發給繼承人
- **帳戶關閉:** 帳戶主動刪除 = 點數視為自願放棄,不退現金
- **帳戶被封禁(欺詐):** 點數沒收,不退現金

## 10. 政策變更權

PACK&GO 保留變更政策的權利,**重大變更**(降低倍率 / 縮短過期 / 提高兌換門檻)需:

- 至少 **30 天** 提前 Email 通知所有有點數餘額用戶
- 變更生效前**已賺得**的點數,按舊政策保留 6 個月過渡期

---

## 附錄 A:Admin 後台需新增欄位

| Tour 表新欄位 | 型別 | 預設值 | 說明 |
|--------------|------|--------|------|
| `pointsEarnRate` | DECIMAL(3,2) | 0.25 | 此團 tour 倍率(0/0.25/0.5/1/2) |
| `estimatedCommissionPct` | DECIMAL(5,4) | NULL | 你估的 commission 比例(用於試算 cost vs profit,選填) |
| `excludeFromPackpoint` | BOOLEAN | FALSE | 此團不發點(自動標記促銷/affiliate 單) |

## 附錄 B:用戶儀表板需顯示

- 當前 Packpoint 餘額
- 過期計時器(距上次活動多少天 / 還剩幾天會清空)
- 當前 tier + 自動升級進度條(例:已消費 $3,200 / $5,000 → 距 Plus 還差 $1,800)
- 兌換歷史 + 賺得歷史(完整 transaction log)

## 附錄 C:後端計算範例(虛擬代碼)

```ts
function calculatePackpoint(booking: Booking, user: User, tour: Tour): number {
  // Excluded tours (e.g., affiliate, employee discount)
  if (tour.excludeFromPackpoint) return 0;
  if (booking.couponCodeUsed) return 0;
  if (booking.subtotal === 0) return 0;
  
  // Tier multiplier
  const tierMultiplier = {
    free: 1,
    plus: 5,
    concierge: 10,
  }[user.tier];
  
  // Tour multiplier (admin-set, default 0.25x)
  const tourMultiplier = tour.pointsEarnRate ?? 0.25;
  
  // Base: 1 point per $1 spent
  const points = booking.subtotal * 1 * tierMultiplier * tourMultiplier;
  
  // Safety cap: never exceed 20% of booking amount in liability
  const maxPoints = booking.subtotal * 0.20 * 100; // 20% × $100/pt
  return Math.min(Math.floor(points), Math.floor(maxPoints));
}
```

---

## 版本歷史

| 版本 | 日期 | 變更 |
|------|------|------|
| 1.0 | 2026-05-03 | 初版,定義所有發放/兌換/過期規則 |
