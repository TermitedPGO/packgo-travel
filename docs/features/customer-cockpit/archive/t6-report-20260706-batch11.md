# T6 批十一 — 案件資產收割(2026-07-06)

> main 上工作,每塊 tsc+vitest 綠才 commit,push,**未 ship**。四塊 + 兩資料小修全數交付程式碼。
> 誠實說明:全批的 confirm/dry_run **實跑都在 ship 之後**(端點要先上 prod;本機無 DATABASE_URL、
> 無 R2 憑證、無 LLM key,跑不了)。本 session 交付「程式碼 + 純邏輯單測 + migration」;實際收割
> (含金宥 confirm)照派工單由監工 ship 後做。塊D 兩筆是純資料寫入,不需等 ship,SQL 給 Jeff 隨時跑。

## 塊A 文件進場 — 交付(commit `432daef`)

`server/_core/caseDocumentImport.ts` + 端點 `POST /api/admin/import-case-documents` + 腳本
`scripts/import-case-documents.mjs`。掃已匯入案件的 交付/ 與 來源/,逐檔上傳 R2 + 寫
customerDocuments(掛單、uploadedBy='case_import')。

- 分類(純,單測):護照/簽證/保險/醫療 → PII type;來源/ 非 PII → other + isInternalCost(供應商
  成本);交付/ 產物 → other。.md/.txt/.DS_Store/隱藏檔不歸檔(工作筆記由塊B/C 處理)。
- **⛔ 架構級硬紅線(對抗審查必驗,紅綠例單測鎖死)**:文件 key 一律 customer-docs/,絕不
  reply-attachments/(寄信白名單)。assertNotOutboundKey 每次上傳前後硬擋;供應商成本文件架構上
  不可能被外寄。冪等(同單同 fileName 一次)。
- 金宥 dry_run 預覽(由已測分類邏輯算):來源/ 兩檔(纵横 Invoice、地接報價 xlsx)均 type=other +
  內部成本,走 customer-docs/。10 單測綠。

## 塊B 經驗收割進教訓庫 — 交付(commit `d503645`,含 migration 0112)

**migration 0112**(TiDB 原生 MODIFY / ADD COLUMN IF NOT EXISTS,不套 PREPARE〔0070 事故〕,
statement-breakpoint,journal when 遞增):`caseLearnings.sourceOrderId` 改 nullable(收 blocked
無訂單案)+ 新增 `sourceFolder` 欄 + idx(folderName 冪等)。distillCaseLearning 的一單一課去重
不受影響(NULL 濾掉,已修 caseLearning.ts 型別)。

`server/_core/caseLessonHarvest.ts`(三層)+ 端點 `POST /api/admin/harvest-case-lessons` + 腳本
`scripts/harvest-case-lessons.mjs`:
- parseCaseLessons(純):抽 案件資料.md 的「經驗/踩坑/風險注意/教訓」段條列項當候選。
- deidentifyCaseLessons(LLM,best-effort):指代化不寫客人真名,篩一次性事實,只留可複用教訓。
- harvestCaseLessons(唯一碰 DB):sourceFolder 冪等(整案跳過)→ 有訂單帶 caseType/destination/
  sourceOrderId、blocked 案 NULL → dry_run 只列候選不燒 LLM;confirm 才 de-id + 寫。全 15 案(含
  blocked)都收得了。8 單測綠。

## 塊C 對話進場 — 交付(commit `4068395`)

`chatLogImport.importChatLogForCustomer` 加 `mode`(預設 confirm,既有 Phase1a 不變);dry_run 走完
classify + build(未來日期已在 build 內防呆丟)但不寫,回 would-import 預覽。
`server/_core/caseConversationImport.ts` + 端點 `POST /api/admin/import-case-conversations` + 腳本:
folderName → 該案訂單 customerProfileId + 客人名 → 逐檔(來源/ 的 .txt/.md 對話候選)過既有管線。
**安全全沿用**:classifier 判斷是否對話(not_a_chat_log 跳過)、resolveEventDate 未來日期一律不建、
認人守門、(content,分鐘)去重。4 單測綠。

**範圍申報(依實際資料)**:現有 15 案 來源/ **沒有** .txt/LINE/微信匯出檔,對話多在 .md(如 David
「出票進度與訊息.md」),本塊覆蓋到這些。結構化的 案件資料.md 整檔會被 classifier 判非對話(正確),
故不餵;其「往來摘錄」段的直接建互動列 follow-up(避免結構化摘要硬拆成互動 = 寧缺勿假 / keyDates
教訓 / 未來日期地雷)。金宥無對話 .md → 塊C 對金宥誠實空。

## 塊D 兩筆資料小修 — prod SQL(Jeff 執行;本機無 DB、rename 無 ops 工具)

金宥卡定位修正(Jeff):金宥是 **B2B 同業**(金宥旅行社向 Pack&Go 訂團轉售,窗口 Sam大寶)。純資料、
與批十一程式碼無耦合,不需等 ship,隨時可跑;有守門、冪等、先 SELECT。

```sql
-- 先看
SELECT id, orderNumber, category, title FROM customOrders WHERE customerProfileId = 2760050;
SELECT id, name, jeffPersonalNote FROM customerProfiles WHERE id = 2760048;
-- D-1 陳案(郵輪非機票)category flight → quote
UPDATE customOrders SET category = 'quote' WHERE customerProfileId = 2760050 AND category = 'flight';
-- D-2a 金宥(B2B 同業)改名
UPDATE customerProfiles SET name = '金宥(同業)Sam大寶' WHERE id = 2760048 AND (name IS NULL OR name <> '金宥(同業)Sam大寶');
-- D-2b 金宥 note append(冪等)
UPDATE customerProfiles SET jeffPersonalNote = CONCAT(COALESCE(jeffPersonalNote,''), IF(COALESCE(jeffPersonalNote,'')='','','\n'),
  '[2026-07-06] B2B 同業轉售;乘客為金宥的客人非本社客戶;對金宥售價 $5,393;本社對縱橫成本依防漏閘紀律,絕不出現在任何給金宥的文件')
 WHERE id = 2760048 AND (jeffPersonalNote IS NULL OR jeffPersonalNote NOT LIKE '%B2B 同業轉售%');
```

## 驗證(數字紀律,原樣貼)

```
 Test Files  295 passed | 11 skipped (306)
      Tests  4358 passed | 90 skipped (4448)
```

`tsc --noEmit` 0 錯(pre-commit + pre-push)。i18n 100% parity(未動 client i18n)。

## Commit / 待 Jeff

- 塊A `432daef`｜塊B(+migration 0112)`d503645`｜塊C `4068395`｜本 docs commit。全已 push origin/main,未 ship。
- **塊D SQL**:Jeff 隨時可在 prod DB 跑(不需 ship)。
- `pnpm ship`(把三個 import 端點 + migration 0112 上 prod)。ship 後照派工單:
  1. 監工做金宥全鏈:`import-case-documents --confirm=金宥…`(驗 2 檔進 customerDocuments、key 是
     customer-docs/、不可外寄)+ `harvest-case-lessons --confirm=金宥…`(驗教訓去識別化不含真名)+
     `import-case-conversations --confirm=金宥…`(金宥無對話 .md → 誠實空)。過了再批次其餘案子先
     dry-run 給你過目再 confirm。
- **follow-up**:案件資料.md「往來摘錄」段的直接建互動(塊C 範圍申報)。
