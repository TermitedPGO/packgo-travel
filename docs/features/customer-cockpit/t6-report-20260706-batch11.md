# T6 批十一 — 案件資產收割(2026-07-06)

> main 上工作,tsc+vitest 綠才 commit,push,未 ship。本批四塊 + 兩資料小修。
> 誠實說明:全批的 confirm/dry_run 實跑都在「ship 之後」(端點要先上 prod;本機無
> DATABASE_URL、無 R2 憑證、無 LLM key,跑不了)。本 session 交付「程式碼 + 純邏輯單測」,
> 實際收割(含金宥 confirm)照派工單由監工 ship 後做。塊A(最先要、且帶架構級硬紅線)已完整
> 交付並 push;塊B/C 因含 prod schema migration + LLM + 第二條匯入管線,列下一 tranche 以免在
> 長 session 尾端趕出高風險的 migration;塊D 兩筆是 prod 資料寫入,給 ship 後精確 ops 步驟。

## 塊A 文件進場 — 已交付(commit `432daef`)

`server/_core/caseDocumentImport.ts` + 端點 `POST /api/admin/import-case-documents` + 本機腳本
`scripts/import-case-documents.mjs`。

- 掃已匯入案件的 交付/ 與 來源/,逐檔上傳 R2 + 寫 customerDocuments(掛該案訂單、
  uploadedBy='case_import')。
- 分類(純函式,單測鎖):護照/簽證/保險/醫療 → 對應 PII type;來源/ 非 PII → other +
  isInternalCost(供應商成本);交付/ 給客人產物 → other。.md/.txt/.DS_Store/隱藏檔 →
  不歸檔(那是案件工作筆記,塊B 教訓 / 塊C 對話各自處理)。
- **⛔ 架構級硬紅線(對抗審查必驗,已用紅綠例單測鎖死)**:案件文件 R2 key 一律走
  `customer-docs/`(customerDocR2Key),**絕不可能落在 `reply-attachments/`**(寄信附件白名單)。
  `assertNotOutboundKey` 每次上傳前後各硬擋一次;`customerDocR2Key` 產出的 key 一律 customer-docs/。
  只要不在 reply-attachments/ 前綴,`resolveReplyAttachments`(寄信路)就會拒絕 → 供應商成本
  invoice 架構上不可能被誤寄給客人。
- 冪等:同單(customOrderId)同 fileName 的 case_import 文件只寫一次;dry_run 只讀清單分類,
  不碰 R2/DB。
- 端點兩段式 dry_run/confirm + LOCAL_SCRIPT_TOKEN(同 import-case-file);腳本 dry-run 送
  metadata、confirm 按大小分批帶 base64(避開 10mb body 上限)。

**金宥 dry_run 預覽(由已單測的分類邏輯算,端點上 prod 前先給你看)**:金宥 來源/ 兩檔、無 交付/、
無對話匯出檔 —— `金宥_纵横_Invoice_JP0001154.pdf` 與 `金宥_地接報價_纵横_0410.xlsx` 兩檔均
classify 成 `type=other、isInternalCost=true`(供應商成本,走 customer-docs/,不可外寄),action=upload。

**單測(10 綠)**:分類(PII / 來源成本 / 交付產物 / .md·.txt·隱藏檔跳過)、硬紅線紅綠例
(reply-attachments/ key → throw;customerDocR2Key 一律 customer-docs/)、計畫 + 冪等。

## 塊D 兩筆資料小修 — ship 後 ops 步驟(prod 寫入,本機無 DB 跑不了)

兩筆都是單列 prod 資料寫入,照「最小修法」由監工/Jeff 在 ops chat 或 prod 執行:

1. **ORD-2026-0010(陳案)category flight → quote**(郵輪非機票):ops chat 釘住陳案 → 呼叫
   `update_custom_order { orderId: <ORD-2026-0010 的 id>, category: "quote" }`(工具既有,enum 含 quote)。
2. **金宥卡 2760048 note append**(名字「Sam大寶」是對接人非客人,不改名等護照):ops chat 釘住
   金宥 → `update_customer_note { note: "卡名暫用對接人(Sam大寶,同業轉售),客人真名待護照;客人本人電話 +1 (510) 713-7888" }`(append 模式,不覆蓋)。

> 註:金宥卡真名待護照的判斷來自案件資料.md §一(對接人 Sam、客人真名以護照為準)。

## 塊B 經驗收割進教訓庫 — 設計完成、列下一 tranche(需 prod migration)

現況:`caseLearnings` 的 `sourceOrderId` 是 **NOT NULL**,`distillCaseLearning` 以 sourceOrderId 去重
(一單一課、需訂單)。塊B 要「全部 15 案都收(含 blocked 無卡案)+ 來源標 folderName 冪等」,與現有
schema 衝突,需 migration 0112:
- `sourceOrderId` 改 **nullable**(blocked 案無訂單)。
- 新增 `sourceFolder varchar` + 索引,folderName 冪等去重的依據(重跑同案不重複寫)。

管線(照 caseLearning.ts 三層 pattern):
- 純函式 `parseCaseLessons(md)`:抽「## 對話經驗(踩坑)」「風險與注意事項」等段落逐條 →
  候選教訓字串(可單測)。
- LLM 去識別化(照 extractCaseLesson 的 EXTRACT_SYSTEM 規則:指代化「某芝加哥包車案」不寫真名),
  best-effort。
- 協調函式 `harvestCaseLessons(folderName, md, mode)`:dry_run 列會寫哪幾條;confirm 寫入
  caseLearnings(caseType/destination 從該案訂單或 md 抽,sourceFolder 冪等)。
- 端點 + 腳本(同 塊A 慣例)。

風險理由:migration 動既有教訓表 + 改 NOT NULL 約束,是 prod schema 變更,不宜在長 session 尾端趕;
且 LLM 去識別化本機無 key 驗不了。列為下一 tranche 第一件。

## 塊C 對話紀錄進場 — 設計完成、列下一 tranche

現有 `chatLogImport.ts` 管線齊全(`resolveEventDate` 未來日期防呆、`buildChatLogInteractionRows`、
`importChatLogForCustomer` 認人守門),塊C = 加一條「案件夾對話檔進場」的端點 + 腳本餵它:
- 掃 來源/ 的對話匯出檔(.txt/LINE/微信匯出)逐案走 importChatLogForCustomer。
- 案件資料.md 內帶明確過去日期的「往來摘錄/關鍵日期」段:純函式抽「日期 + 摘要」逐條,只有帶
  明確過去日期的才建互動;沒日期的不建(寧缺勿假,keyDates 教訓 + 未來日期一律不建 —— 30-templates
  兩條地雷)。
- 先金宥(但金宥無對話匯出檔,僅 md;其 md 的「關鍵日期」多為未來日期 → 依規則不建互動,誠實空)。

## 驗證(數字紀律,原樣貼)

```
 Test Files  293 passed | 11 skipped (304)
      Tests  4346 passed | 90 skipped (4436)
```

`tsc --noEmit` 0 錯(pre-commit + pre-push)。i18n 100% parity(未動 client i18n)。

## Commit / 待 Jeff

- 塊A:`432daef`(已 push origin/main)。
- `pnpm ship`(把 import-case-documents 端點上 prod)。ship 後:
  1. 監工做金宥全鏈:`node scripts/import-case-documents.mjs --confirm=金宥_芝加哥尼加拉瀑布`
     → 驗 2 檔進 customerDocuments、key 是 customer-docs/、掛 ORD-0008、不可外寄。過了再批次其餘案子
     dry-run 給你過目。
  2. 塊D 兩筆 ops(見上)。
- 塊B/C 列下一 tranche(migration 0112 + 教訓/對話管線)。
