# Gmail 全 thread 歸檔 — Design(Stage 1+2）

> 狀態:設計定稿待 Jeff 點頭。緣起:客戶頁「沒看到所有消息」實測根因。
> 日期:2026-06-22。

## 一、問題(實測 grounded,非猜測)

客戶頁對話只顯示系統 `customerInteractions` 裡有的;但系統只進了部分對話。

實測 Jenny(profileId 2550004, jenny.chang.info@gmail.com):
- Gmail(連線帳號 jeffhsieh09@gmail.com)有 2 條 thread、約 10 封(2026-05-25 ~ 06-15,其中 1 封在 Trash)。
- 系統 `customerInteractions` 只有 5 封(3 outbound + 2 inbound),無重複、無 spam 隱藏、無 profile 分裂。
- 所以客戶頁忠實顯示了「系統有的 5 封」,不是顯示層 bug。

兩個歸檔 gate 造成缺漏:
1. 寄件:`sentMailFiling` 只掃 `in:sent has:attachment`(gmail.ts:242)→ 你純文字的回覆(沒夾 PDF)不進系統。
2. 收件:`gmailPipeline` 只把輪詢當下處理成詢問的 inbound 寫一列 → 不回頭補整條 thread。

兩條都不做「整條 thread 補齊」。影響全部客人,不只 Jenny。且我剛上線的 AI 摘要/對話讀同一份(半條),所以摘要會偏。

連線帳號(prod 實測):jeffhsieh09@gmail.com(2026-05-11)+ support@packgoplay.com(2026-05-27)。Jenny 在前者,已連線 → backfill 抓得到。

## 二、目標

`customerInteractions` 反映完整 Gmail 對話(雙向、含純文字回覆)。冪等可重跑、不產生重複、不外洩成本、不為了搬運狂燒 LLM。

## 三、現有可重用

- `gmail.ts:getThreadHistory(gmail, threadId, selfEmail, opts)` — 已能抓 thread,但:回傳不含 message id、預設只取最後 12 封、body 截 1200。**要擴充**:回 `{id, from, date, direction, body}`、可取全部、cap 提高。
- `gmailPipeline.ts` 收件 poll(已對每個 active integration 跑)。
- `sentMailFiling.ts` backfill 節奏可參考。
- 多帳號:已支援多個 gmailIntegration,sync 要 per-integration(各自 selfEmail 判方向)。

## 四、架構

### 4.1 Schema(migration 0101)
`customerInteractions` 加:
```
externalId VARCHAR(255) NULL              -- Gmail message id(冪等 dedup key)
UNIQUE (customerProfileId, externalId)    -- 同一客人同一封只一列;NULL 不互斥(MySQL)
```
既有 453 列 externalId 全 NULL(唯一索引允許多 NULL,不衝突)。

### 4.2 抓取(gmail.ts)
新 `listThreadMessagesForFiling(gmail, threadId, selfEmail)` 回每封 `{id, from, date, direction, body, inTrash}`(或擴充 getThreadHistory 加 id + opts.all)。排除 Trash。

### 4.3 Sync 核心(新檔 server/_core/threadFiling.ts)
`syncThreadToInteractions(profileId, threadId, integration)`:
1. 抓整條 thread。
2. 對每封 Gmail 訊息,**claim-or-insert**(冪等 + 不重複既有 453 列):
   - 已有列 `externalId = msgId` → skip。
   - 否則找這個 profile 既有、`externalId IS NULL`、`direction` 同、`createdAt` 在 Gmail date ±2 分鐘、content 前綴相符的 legacy 列 → **UPDATE 補 externalId(認領)**。
   - 找不到 → **INSERT** 新列(channel=email、direction、content=body、generatedBy=human、classification=NULL)。
3. 純搬運:**不對歷史信跑 LLM 分類/摘要**(避免成本爆);spam 維持現行 `spamVerdict` 流程,backfill 歷史信不自動標 spam。

### 4.4 觸發
- 收件 poll:處理完一封 inbound 後,呼 `syncThreadToInteractions(它的 thread)`→ 連帶補純文字回覆 + 早於 poll 的訊息。
- Backfill job(BullMQ,沿用既有 schedule 模式):對每個有 email 的 customerProfile,在每個連線帳號用 `from:/to:<email>` 找 thread,逐條 sync。一次性 +（可選)定期。per-thread cap(如 200 封)。

## 五、紅線

- 冪等:唯一索引 + claim-or-insert,重跑列數不變、不重複。
- PII:只搬運;body 有上限;不外傳;externalId 是 Gmail id 非 PII。
- 成本:backfill 純搬運不跑 LLM(admin_ai_boundary:搬運不生成)。
- Trash/Spam:排除 Trash;spam 沿用現行人工 `spamVerdict`,不自動誤殺。
- 多帳號:per-integration selfEmail 判方向,jeffhsieh09 與 support@ 各自跑。

## 六、待 Jeff 拍的 1 個關鍵決策

既有 453 列怎麼跟 Gmail 對齊(避免重複):
- **A. claim-or-insert(認領 legacy 列)** — 建議。既有列補上 externalId,Gmail 有但系統沒的才新增。零重複、零刪除,最安全。
- B. 清掉重抓 — 把某帳號的 email interactions 刪掉重 sync。乾淨但會動到既有資料,風險高。
（其餘:backfill 範圍=全部 active profile、per-thread cap 200、純搬運不跑 LLM — 採預設,如要不同再說。)

## 七、測試(Vitest)

- `threadFiling.test.ts`:冪等(跑兩次列數不變)、claim-or-insert 認領 legacy 列、方向判斷(selfEmail)、Trash 排除、dedup by externalId、純搬運不呼 LLM。抓取結果注入(不打真 Gmail)。

## 八、Migration

`0101_interaction_external_id.sql`(hand-written idempotent,mirror 0100):
`ALTER TABLE customerInteractions ADD COLUMN externalId VARCHAR(255) NULL`
`+ ADD UNIQUE INDEX uq_ci_profile_external (customerProfileId, externalId)`(INFORMATION_SCHEMA guard)。

## 九、風險/回滾

- 風險:claim-or-insert 的 ±2 分鐘比對若太鬆會錯認 → 用 direction + 時間窗 + content 前綴三重比對收緊;不確定就 INSERT(寧可短暫多一列也不錯改)。
- 回滾:externalId 是 additive 欄;sync 是 additive 寫入;停掉 backfill job 即停。壞了不影響既有 453 列(claim 只補 NULL 欄,不改 content)。

## 十、Stage 4 起點:code 入口(新 session 直接看這裡)

| 要動的 | 現在的 code | 要做的 |
|--------|------------|--------|
| 抓整條 thread | `server/_core/gmail.ts:263` `getThreadHistory`(回傳不含 msg id、預設只取最後 12 封、body 截 1200) | 擴充或新寫 `listThreadMessagesForFiling`,回每封 `{id, from, date, direction, body, inTrash}`、可取全部、排除 Trash |
| 寄件 gate(漏純文字回覆) | `server/_core/sentMailFiling.ts:85` 用 `listSentWithAttachments`;`server/_core/gmail.ts:238` + `:242` query `["in:sent","has:attachment"]` | 不再只靠這條;改走 thread sync(整條補) |
| 收件寫入 | `server/agents/autonomous/gmailPipeline.ts:466` insert(inbound)、`:789` 另一處、`:333` 既有 dedup select | poll 處理完 inbound 後呼 `syncThreadToInteractions(thread)` |
| Schema | `drizzle/schema.ts:2808` `customerInteractions`(目前無 dedup key) | 加 `externalId` + unique(customerProfileId, externalId);migration 0101(hand-written idempotent,mirror 0100;journal append idx 101) |
| 讀取側(不用改) | `server/routers/adminCustomersThread.ts` `mergeThread`、`customerConversationThread`(adminCustomers.ts:1137) | 不動;資料補齊後自然全顯示 |
| Sync 新檔 | (無) | `server/_core/threadFiling.ts` + `threadFiling.test.ts` |
| Backfill job | `server/queue.ts` schedule 模式(參 `scheduleDailyCustomerSummaries`)+ worker | 新 queue + worker:對每個 active profile、每個連線帳號 sync thread |

**實測事實(別重查)**:
- 連線帳號 2 個:`jeffhsieh09@gmail.com`(2026-05-11)+ `support@packgoplay.com`(2026-05-27)。sync 要 per-integration、各自 selfEmail 判方向。
- Jenny = profileId `2550004`, email `jenny.chang.info@gmail.com`;系統 5 封(3 out + 2 in),Gmail ~10 封 2 thread(1 在 Trash),帳號 jeffhsieh09。驗收用她。
- `customerInteractions` 全表 453 列(reconcile 對象)。
- prod 讀寫要在 Fly 跑(本地無 DB):`flyctl ssh console -a packgo-travel`,腳本寫 `/app/` 下跑(node 才找得到 `/app/node_modules`),`DATABASE_URL` 在 env。

## 十一、交接

Stage 4 在新 session 做(Jeff 拍板 2026-06-22,§9.7 階段交接)。第一步:加 §四.1 schema + migration → §四.3 sync 核心 + 測試(冪等/claim-or-insert 先綠)→ 收件 hook → backfill job → Jenny 驗收。reconcile 用 §六 A(claim-or-insert)。
