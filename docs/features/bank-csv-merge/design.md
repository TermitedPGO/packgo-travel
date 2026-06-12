# 設計 — 銀行帳目雙源合併

> Stage 2。已驗證的事實(2026-06-12 prod + 代碼):
> - 金額符號一致:CSV 匯入已翻成 Plaid 慣例(正=流出;bankCsvImportService.ts:127 `plaidAmount = -amountNum`)
> - CSV 去重鍵:`csv:<accountId>:<sha1(date+amount+desc)[:32]>`,re-upload 走 onDuplicateKeyUpdate
> - Plaid 列唯一鍵:`uniq_plaid_txn`(plaidTransactionId)
> - 現況精確重複(同帳戶+日+額)= 0 組;帳戶 30001 = 263 CSV + 181 Plaid 混用、30004 = 66+16

## 1. 匹配規則(matcher)

同一筆真實交易的判定:
- **同 linkedAccountId + 金額完全相等 + 日期距離 ≤ 3 天**(刷卡 posted 日兩源常差 1-2 天)
- **一對一貪婪配對**:每個 CSV row 找候選 Plaid rows,按 |日期差| 升冪取最近;
  被配走的 Plaid row 不可再配
- **模糊不猜**:同距離有多個候選、或唯一候選已被配走 → 該 CSV row **不合併**,
  照舊插入 + 在結果標 `ambiguous`(寧可留兩筆給 Jeff 看,不可錯併兩筆不同交易)
- 純函式 `matchCsvRowsToPlaid(csvRows, plaidRows) → { merges, inserts, ambiguous }`,可單測

## 2. 合併方向:Plaid row 為正本,CSV 描述覆蓋

**為什麼留 Plaid row**:plaidTransactionId 是對未來同步的去重鍵。刪它的話,Plaid 之後
送 modified 事件會把它重新插回 → 又重複。CSV row 的合成鍵只防 re-upload 自己。

合併時對 Plaid row 做的事(enrich,不是替換):
| 欄位 | 規則 |
|---|---|
| description | ← CSV 原始行(完整描述) |
| originalDescription | ← CSV 原始行 |
| merchantName | Plaid 的有意義就留(≠ 泛詞;泛詞判定:merchantName==description 或在黑名單 PURCHASE/MAIL ORDER…);否則 ← CSV 的 |
| paymentMeta | 合併:保留原有 + 加 `{csv_reference_number, merged_from_csv: <syntheticId>, plaid_original_name: <原 name>}`(audit + 冪等標記) |
| amount / date / 分類欄位 | **一律不動**(金額不變 = 總帳不變) |

CSV row 本身**不插入**(import 時就攔下)。冪等:re-upload 同一份 CSV → matcher 找到
同一筆 Plaid row → `merged_from_csv` 已存在 → no-op,回報 merged(already)。

## 3. 分類重跑(鐵律內)

enrich 後,若該 Plaid row:
- `agentCategory` 為 null 或 `other_review`,**且**沒有人工確認標記(m0 驗證確切欄位)
→ 入隊重新分類(吃到完整 memo 後信心會升)。產出仍是建議,待分類流程照舊等 Jeff 確認。
人工確認過的列:永不觸碰。

## 4. 回補(backfill)既有資料

新 procedure `plaid.csvMergeBackfill`(adminProcedure,`dryRun` 預設 true):
- 掃既有 `csv:%` rows,用同一 matcher 對同帳戶 Plaid rows 找配對(±3 天)
- **dry-run 報告**:配對清單(日期/金額/兩邊描述)+ **P&L 影響**:這些組今天是
  double-count,合併會讓歷史報表數字變動 — 多少金額、哪些月份,白紙黑字給 Jeff 看
- Jeff 看過報告才執行:enrich Plaid row + **刪除 CSV row**(這次要刪,因為兩筆都已在帳)
  + 每筆 audit log + 執行後斷言:每帳戶 `SUM(amount)` 變化 == dry-run 報告預告的修正額,
  不符就 rollback(transaction 包)

## 5. UI(BankLedgerV2,小改)

- 列表行:description 是泛詞且 originalDescription 有料 → 顯示 originalDescription
  (合併後 description 已是完整版,此規則主要救還沒合併的舊資料)
- 詳情 Sheet:加 originalDescription + paymentMeta.reason / csv_reference_number 區塊
- 搜尋:涵蓋 originalDescription

## 6. 安全邊界

- 金額、日期、帳戶歸屬:本 feature 永不修改(除 backfill 刪重複列,且在 dry-run 報告
  + Jeff 點頭 + transaction + 斷言保護下)
- 全程 audit log;import 結果誠實回報 merged/inserted/ambiguous 三個數字
- 信託/認列邏輯零接觸(它吃的是分類結果,分類仍走人工確認)

## 7. 風險與對策

| 風險 | 對策 |
|---|---|
| 同日同額兩筆不同交易(例:兩杯同價咖啡) | 一對一貪婪 + 模糊不猜 → 留兩筆 + ambiguous 標記 |
| Plaid modified 事件改金額,合併標記殘留 | merged_from_csv 只是描述標記,金額更新照常走 sync upsert |
| backfill 改歷史報表 | dry-run 預設 + P&L 影響白紙黑字 + Jeff 點頭才執行 |
| CSV 描述含個資(客人名) | 與現況一致(CSV 路徑本來就存),不新增暴露面 |
