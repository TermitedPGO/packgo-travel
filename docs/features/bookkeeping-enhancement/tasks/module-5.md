# M5 — 信託合規報表 + 稽核匯出

harness #72 · design.md §M5 · 待 M1

## 目標
信託遞延收入報表 (CST §17550) + 稽核軌跡匯出。後端 trustDeferralService.ts 完整、env-gated。

## Checklist
- [x] 確認 `PLAID_TRUST_DEFERRAL_ENABLED` 狀態；off 時 UI 顯示「未啟用」不報錯
  - `trustReconciliation` 每帳戶帶 `enabled`；`enabled=false` → amber ShieldAlert banner（顯示信託餘額，不報錯）
- [x] trust 報表 UI：outstanding（未認列訂金）/ 已認列 / 本期變動（複用 trustReconciliation / trustDeferredList）
  - KPI strip 採 CST 對帳三元組（Outstanding / Balance / Drift）+ Unmatched，全部來自 trustReconciliation 無 row cap；已認列 rows 用 deferred-list status filter 按需呈現（不編可能不準的 grand-total，守「不準猜」紅線）
- [x] 稽核匯出：排除清單（transfer + other_review 明細）+ 轉帳明細
  - [x] 加輕量 `auditExclusionList` query（複用純函式 `foldExclusionRows` + `toExclusionCsv`），不動 yearEndExport
- [x] 圓角 / 繁中 i18n 合規
  - `trustCompliance` namespace 已加 zh-TW + en（i18n.test.ts parity 過）；KpiCard/SectionCard 自帶 rounded-xl

### 驗收
- [x] `tsc --noEmit` 0 error
- [x] Vitest：outstanding 計算 (foldOutstandingTrust ×4) / 排除清單只含 transfer+other_review (foldExclusionRows + toExclusionCsv ×8)
- [ ] 手測：env on/off 兩種顯示正確（post-deploy）
