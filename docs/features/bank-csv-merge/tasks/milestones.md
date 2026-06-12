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

## m2 — csvImport 接 matcher
- [ ] csvImport:解析後先撈該帳戶 ±窗內 Plaid rows → matcher → merges 走 enrich
      (design §2 欄位規則,含 merged_from_csv 冪等檢查)、inserts 照舊插入、ambiguous 照舊插入
- [ ] 回傳加 `{merged, mergedAlready, inserted, ambiguous}`;前端 toast 同步顯示
- [ ] enrich 寫 audit log(action: bankTxn.csvMerge)
- [ ] Vitest:import 整合(mock db)三路徑

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

## m4 — 分類重跑 + UI
- [ ] enrich 後:未人工確認且 null/other_review → 入隊重分類(用 m0 驗證的保護欄位)
- [ ] BankLedgerV2:泛詞行顯示 originalDescription;詳情 Sheet 加完整描述/reason/ref# 區塊;
      搜尋涵蓋 originalDescription
- [ ] i18n + Vitest(泛詞判定純函式)

## DoD
- [ ] tsc 0 · 全套 vitest 綠 · i18n parity
- [ ] 金額不變式:m2 路徑零金額變動;m3 變動 == 報告預告
- [ ] Jeff 親驗:上傳一份真實月度 CSV → merged/inserted 數字合理 → 帳本 PURCHASE 變完整描述
