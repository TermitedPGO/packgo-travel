# AI 自動備單 + 下一步 — Proposal（Stage 1）

> 緣起:2026-06-22 Jeff 看訂製單表單 +「報價/催款/確認書」三顆按鈕後拍板。
> 三顆按鈕現在都開同一張 `CustomOrderSheet` 手動表單(只是 focus 不同 section)→
> Jeff:「三顆都一樣那幹嘛用?」+「這些欄位也不用,有 LLM 直接讀取不就好了?」

## 一、Jeff 拍板的方向(2026-06-22)

> AI 讀完整對話 + 文件,自動把訂單填好,判斷現在該報價/催款/確認,把對應草稿準備好。
> Jeff 看一眼按送出。三顆按鈕變成「審核 AI 幫你準備好的東西」。

核心:從「Jeff 填表單 + 猜三顆按鈕」→「AI 備單 + 備好下一步,Jeff 審核送出」。
對齊 feedback_packgo_core_principle(自動化優先 + 萬不得已才人力)+ admin_ai_boundary
(AI 出手處 100% 正確 = 搬運真實資料,不杜撰)。

## 二、AI 要自動填什麼(`CustomOrderSheet` 欄位)

從這位客人的完整 thread + 報價/行程 PDF 抽:
- 行程名稱(title)、目的地(destination)
- 出發日 / 回程日(departureDate / returnDate)
- 總價(totalPrice)、訂金(depositAmount,預設總價 30% 可改)、幣別(currency)
- 需要報價(needsQuote)
- 成本(supplierCost)— **僅從供應商 invoice/後台抽,內部欄,絕不上客人文件**(no_cost_on_customer_docs)
- 備註(notes)

AI 只填、標「待 Jeff 確認」;**不自動送出**。Jeff 改完按送。

## 三、AI 判斷「下一步是哪一個」

依訂單狀態 + 對話階段判斷現在該:
- 報價(還沒報價 / 客人在問價)→ 備好報價草稿
- 催款(報價已接受 / 該收訂金)→ 備好收款連結草稿
- 確認書(已收款 / 該出確認)→ 備好確認書草稿

判斷靠 DB 既有狀態(customOrders 狀態機)+ 對話訊號,不靠 AI 腦補金額/狀態。

## 四、UI:三顆按鈕 → 審核 AI 準備好的

三顆按鈕(報價/催款/確認書)不再各開空表單;改成顯示「AI 已備好的訂單 + 建議下一步草稿」,
Jeff 審核 + 送(沿用既有送出路徑:email templates customOrder + 收款連結 + 確認書 PDF)。

## 五、紅線

- 成本只進內部、絕不上客人文件;AI 抽價是「搬運」不是「生成」,抽不到就留空問 Jeff,不腦補。
- 不自動送任何客人面東西;Jeff 審核後才送(admin_ai_boundary)。
- 訂金 ≠ 營收(§17550):收款/確認的時間點照狀態機,不因 AI 備單就認列。
- 客人面文字走 Jeff 口氣、不破折號。

## 六、依賴(必須先做,順序鎖死)

1. **gmail-full-thread-filing**(先)— 沒有完整 thread,AI 讀半條對話會抽錯價/錯日期。**這個是地基。**
2. **customer-ai-sessions 引擎**(已上線 v729)— 重用 `buildCustomerAiContext` / 文件抽取 / invokeLLM 結構化輸出。

→ 順序:① Gmail 全 thread 歸檔 → ② AI 自動備單(本案)→ ③ 三顆按鈕收成審核流。**本案等 ① 落地再進 Stage 2。**

## 七、code 入口(未來 Stage 2 用)

| 要動的 | code |
|--------|------|
| 訂單表單(被 AI 預填) | `client/src/components/admin/customers/CustomOrderSheet.tsx` |
| 三顆按鈕(現都 `openOrders`) | `client/src/components/admin/customers/CustomerDetail.tsx:82-102` → 同一個 `CustomOrderSheet` |
| 訂單狀態機(判階段) | `server/routers/customOrderStateMachine`（customOrderStateMachine.test.ts）|
| AI context + 抽取 | `server/_core/customerAiContext.ts` / `customerDocsText.ts` / `customerAiSummary.ts`(結構化輸出 pattern) |
| 送出路徑 | `server/email/templates/customOrder.ts` + 收款連結 + 確認書 PDF |

## 八、非目標

- 不自動送客人任何東西(維持人工審核送出)。
- 不重做訂單狀態機 / 送出路徑(沿用)。
- 不在 ① 落地前動工。
