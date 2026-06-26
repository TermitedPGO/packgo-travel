# Step 5 — 看門狗第一條:售價 vs 後台成本(漏價)

> 源自 plan.md §五 Step 5。把「省時間」升級成「省錢」:先挑一條最會害你賠錢的對帳。
> 規則不是判斷,所以準。只給 Jeff 看,絕不上客人文件、絕不自己改。
> 設計前置:2026-06-26 grounded 測繪(3 個 Explore agent 掃過草稿鏈 / 對帳資料 / 駕駛艙 UI)。

## 一、要解的問題

David 那種漏價:報給客人的售價漏算了成本,等於賠錢出團。現在沒有任何東西在你送報價前
把「售價 vs 成本」直接攤給你看。

## 二、硬邊界

1. 內部警示,只給 Jeff 看。供應商成本(同業價)絕不出現在給客人的文件 — 看門狗是 admin-only。
2. 規則不是判斷:純 deterministic 算 margin,零 LLM。
3. 誠實至上:`supplierCost` 是手動估值不是真 invoice,所以只在「兩個數字都有」時叫;
   缺一個就停下不亂猜。做不到 100% 正確就不叫。
4. 攔你,不替你改:看門狗只把數字攤給你,絕不自動改價、絕不自動送。

## 三、最小可行規則(Rule #1)

對每張 `customOrders`:
- 跳過 `status ∈ {draft, cancelled}`(draft 數字還在喬、cancelled 不相關)。
- 跳過 `totalPrice == null` 或 `supplierCost == null`(沒得比 → 誠實停手)。
- 跳過 `totalPrice <= 0`(防除以零 / 壞資料)。
- `margin = (totalPrice − supplierCost) / totalPrice`,四捨五入 3 位(照 supplierMargin.ts)。
- `margin <= 0` → 紅燈(`reason: margin<0 ? "loss" : "breakeven"`)= David 賠錢/零毛利。
- `0 < margin < 0.15` → 黃燈(`reason: "thin"`)= 毛利過薄,送前再核。
- `margin >= 0.15` → 沒事,不叫。

門檻 0.15 沿用 supplierMargin 稽核。同一張單售價跟成本共用 `currency` 欄,所以沒有跨幣別問題
(若日後拆成本幣別,照 supplierMargin 的 currencyMismatch=不換匯不假算)。

## 四、不做的(刻意縮範圍,避免噪音 / 越界)

- 不從 supplierDepartures.agentPrice 反推成本(join 邊界太多,留待有 supplierInvoices 表再做)。
- 不把「報了價但沒填成本」當警示(會洪水般淹掉真正的紅燈;v2 再加 info 級)。
- 不碰 aiQuotes funnel、不碰 PDF 內容比對(那是 costLeakGate 的事,獨立守門)。
- 不自動建 approvalTask、不自動改、不自動送。

## 五、落點

- 純規則:`server/services/customOrderWatchdog.ts`
  - `evaluateOrderMargin(order, threshold) → OrderMarginFinding | null`(純函式)
  - `findOrderMarginIssues(orders, threshold) → OrderMarginFinding[]`(過濾 + 紅在前、最差在前)
  - `WATCHDOG_MARGIN_THRESHOLD = 0.15`
- Endpoint:`customerOrders.watchdogForCustomer`(adminProcedure,selectionSchema)
  - `db.findCustomerProfileId` → `db.listCustomOrdersByProfile`(全列含 cost)→ findOrderMarginIssues
- UI:`DetailTabs.tsx` OverviewTab 最上方一條警示卡(打開客人立刻看到),把售價/成本/毛利三個數字直接貼出來。
  紅(loss/breakeven)/ 黃(thin)。高密度極簡、rounded-xl、i18n(zh-TW + en 同步)。

## 六、Tasks

- [ ] `customOrderWatchdog.ts` 純規則 + 型別
- [ ] `customOrderWatchdog.test.ts`:healthy/thin/breakeven/loss/門檻邊界/draft/cancelled/cost null/total null/total<=0/排序/decimal string
- [ ] `adminCustomerOrders.ts` 加 `watchdogForCustomer` endpoint + import
- [ ] `adminCustomerOrders.test.ts`:更新 surface 清單 + 行為測試
- [ ] `DetailTabs.tsx` OverviewTab 警示卡
- [ ] i18n `admin.customers.watchdog.*`(zh-TW + en)
- [ ] tsc 0 + vitest 綠 → commit

## 七、之後(非本步)

- v2:報了價但沒填成本的 info 級提醒。
- 看門狗第二條:護照名對訂單。第三條:答應了還沒寄。
- supplierInvoices 表落地後,把成本來源從手動估值換成真 invoice。
- CustomOrderDetail 送報價點的 inline 警示(point-of-action,本步先做 overview 警示)。
