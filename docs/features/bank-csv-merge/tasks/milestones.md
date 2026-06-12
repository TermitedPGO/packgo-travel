# Tasks — 銀行帳目雙源合併

> Stage 3。每 milestone:tsc 0 + Vitest + commit(green 即 commit)。

## m0 — 驗證殘餘假設 ✅(2026-06-12)
- [x] 人工確認標記 = `jeffOverrideCategory`(UI 設分類寫它、報表 jeffOverride ?? agentCategory、
      重分類資格 = IS NULL)
- [x] date 語義:CSV「Posted Date」、Plaid `t.date` 都是 posted date(authorized_date 另存)
- [x] prod ±3 天重疊 = **0 組 / $0**(flyctl ssh 直查)→ **無歷史重複入帳,月報不需修正**

## m1 — matcher 純函式 ✅
- [x] `server/services/bankCsvMerge.ts`:`matchCsvRowsToPlaid(csvRows, plaidRows)` →
      `{ merges: [{csvRow, plaidRowId, dateDiff}], inserts: [csvRow], ambiguous: [{csvRow, reason}] }`
- [x] 規則:同帳戶(呼叫端保證)+ 金額相等 + |日期差| ≤3 天;最近日優先;一對一;同距多候選
      → ambiguous;候選被配走 → 次近;全配走 → ambiguous;確定性排序(重跑同結果)
- [x] Vitest 16 條:配對/日差邊界/超窗/同日同額兩筆/金額不等/冪等標記/他人認領不搶/
      確定性/enrichment 欄位不變式(無 amount/date/分類鍵)

## m2 — csvImport 接 matcher ✅
- [x] csvImport:撈該帳戶 [min-3, max+3] 窗內 Plaid rows → matcher → merges 走 enrich、
      inserts/ambiguous 照舊 upsert;dryRun 回 wouldMerge/wouldInsert/ambiguous 預覽
- [x] 內建防禦分支(m3 降級而來):配中且舊 CSV twin row 存在 → 刪 twin + audit
      (bankTxn.csvMergeRemoveTwin);重新上傳舊 CSV 即回補
- [x] 回傳 {merged, mergedAlready, ambiguous, removedOldCsvRows};前端 dialog 預覽行 +
      commit toast 顯示合併數
- [x] enrich audit log(bankTxn.csvMerge,記 csvSyntheticId/dateDiffDays/plaid 原名)
- [x] 誠實記錄:三路徑分流邏輯由 m1 的 16 條純測試蓋;router 膠水(SQL 窗/update/delete)
      mock 測試 = 測 mock 本身,不寫 — 靠 tsc + 全套 + prod 親驗(同批9 m3 模式)
- [x] matcher 改泛型 <C extends CsvRowLike>(tsc 抓到 ParsedCsvRow 流經 matcher 丟欄位)

## m3 — backfill 既有資料(**m0 改判:降級**)

> m0 實測歷史重疊 0 組 → 獨立 backfill procedure 不做。改為 m2 匯入路徑內建防禦分支:
> matcher 配中且同 syntheticId 的舊 CSV row 已存在 → enrich Plaid row + 刪舊 CSV row
> (transaction + audit)。Jeff 日後要回補 = 重新上傳舊 CSV 即可。

### ~~原 m3 規劃(留檔)~~
- [ ] `plaid.csvMergeBackfill`(dryRun 預設 true):報告配對清單 + per-月 P&L 修正額
- [ ] 執行模式:transaction 包(enrich + 刪 CSV row + audit);斷言 SUM(amount) 變化
      == 預告修正額,不符 rollback
- [ ] Vitest:報告組裝 + 斷言邏輯(mock)
- [ ] **執行需 Jeff 看過 dry-run 報告點頭(碰歷史報表)**

## m4 — 分類重跑 + UI ✅
- [x] enrich 後:jeffOverrideCategory IS NULL 且 agentCategory null/other_review →
      重置三個 agent 欄位(SQL 再守一次 override IS NULL)→ classifyUncategorizedBatch
      撿走重分類(吃到完整 memo);non-fatal,回傳 requeuedForClassification
- [x] BankLedgerV2:詳情 Sheet 加 銀行原始描述/付款備註/Ref#/合併前 Plaid 名稱 區塊
      (MergeInfoFields,paymentMeta 容錯解析);搜尋涵蓋 originalDescription
- [x] **改判**:列表行「泛詞改顯 originalDescription」不做 — 合併後 description 已是完整版、
      未合併 Plaid 行 originalDescription 全 null(m0 實證),規則無資料可救,不加死邏輯
- [x] i18n 4 keys(泛詞判定 isGenericBankLabel 已在 m1 測)

## DoD
- [x] tsc 0 · 全套 vitest 綠(2285 passed)· i18n parity 7328 keys
- [x] 金額不變式:enrich set 結構性無 amount/date/分類鍵(進測試);m3 已降級
- [ ] Jeff 親驗(部署後):上傳一份真實月度 CSV → 預覽顯示「將合併 N 筆」→ commit →
      帳本 PURCHASE 變完整描述、卡 other_review 的重新分類
