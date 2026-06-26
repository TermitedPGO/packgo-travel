# Step 4 — 跟進草稿(黃燈:卡住的報價客人,每晚自動備好一封跟進信等審)

> 客戶頁駕駛艙 Step 4。延續 Step 1-3(五秒真相條 / 自動收歷史 / 狀態保鮮)+ Step 5(漏價看門狗)。
> 觸發方式由 Jeff 拍板:**每晚自動掃所有卡住客人,全部草擬好等審**(不是逐一手動觸發)。

## 一句話

報價發了、客人沒回(球在客人手上、靜了 N 天)的客人,每晚自動讀「真實對話」用 Jeff 的口氣草擬一封溫和的跟進信,擺進客戶頁的「待審草稿」區(黃燈),Jeff 一鍵核可寄出。**AI 永遠不自動寄,Jeff 審了才送。**

## 為什麼這樣設計(複用既有審計過的送信軌道,不造新送信路徑)

送信給客人是全系統最敏感的一條線。所以 Step 4 **完全不寫任何新的送信程式**,改成餵進既有、已上線、已測過的軌道:

- 卡住客人是 `selectStaleQuoted` 從 `customerInteractions` 挑出來的;這些往來是 gmail-thread-filing 收進來的,**每筆帶 `gmailThreadId`**。
- 客戶頁「待審草稿」面板(`admin.customerDrafts`)的 **Source 3** 已經會撈 `agentMessages`(`messageType="observation"`、`readByJeff=0`、`relatedCustomerProfileId` 命中)→ 經 `observationDraftCard` 變成可送卡片。
- 卡片的送出走 **`commandCenter.escalationReply({ messageId })`** → `sendEscalationReply` 讀 `context.gmailThreadId` 回到「原本那條 Gmail thread」回信 + 記一筆 outbound。**這條路 Jeff 早就在用。**

所以本功能 = 一支「每晚把草稿寫成 observation 列」的 producer。送信沿用既有路,敏感邊界一行都沒動。

## 資料流

```
nightly followup-scan worker
  → runFollowupDraftScan(db)                         [新]
      findStaleQuotedCustomers(db)                    [既有,reuse]
      per customer:
        讀最近 email 往來 → gmailThreadId + 對話摘錄 + 最後分類 + 語言
        detectDraftSkip(...)  → no_thread / sensitive / empty → 不草擬
        draftFollowup(context) [LLM,Jeff 口氣,讀真對話,不捏造,不破折號,不推銷]
        buildFollowupDraftRow(...) → insert agentMessages(observation)
  → runFollowupScan(db, { excludeProfileIds: 已草擬的 })  [既有,加 exclude]
      不能草擬的(無 thread / 敏感)仍進辦公室 inbox 提醒,Jeff 手動跟進
```

可草擬的 → 直接備好草稿卡;不可草擬的 → 退回原本的 inbox 提醒。一個都沒漏,也不重複浮出。

## 硬邊界(不可違反)

- AI 不自動寄。草稿只是「備好」,送出 100% 由 Jeff 在客戶頁按鍵(走既有 `escalationReply`)。
- 不草擬敏感類(`AUTO_SEND_HARD_EXCLUDED`:退款 / 客訴 / 報價 / 訂金 / 簽證)的客人 → 退回人力。
- 草稿讀「真實對話」,只引用對話裡有的東西,不捏造價格 / 日期 / 行程名。
- 客人文字風格:口語、自然、不官方、短、**不用破折號**、不用打勾 / emoji 清單、純文字。
- 絕不在客人文字出現內部成本 / 同業價 / 供應商名(對話摘錄本就是對客內容,不含成本;再加 prompt 明令)。
- 沒有 `gmailThreadId`(送不出去)就不草擬死卡片 → 退回 inbox 提醒。

## Dedup / 成本

- 每晚上限 = `findStaleQuotedCustomers` 的 limit(20),每位可草擬客人 1 次 LLM call → 每晚最多 20 calls。
- Dedup:同一客人 7 天內已有未讀的 `followup_draft` observation → 跳過,不每晚重草。
- 草稿過期自動隱藏:`isDraftCurrent` 已有的閘 —— 客人一旦回信(新 inbound 推進 `latestMsgAt`),舊草稿自動不顯示(情況變了)。送出後記 outbound 也會把它推下去,自清。

## 模組

| 檔案 | 角色 | 測試 |
|------|------|------|
| `server/agents/autonomous/followupDrafter.ts` | LLM 草擬(`buildSystem` / `TOOL` / `draftFollowup`),純 prompt 契約可測 | `followupDrafter.test.ts` |
| `server/agents/autonomous/followupDraftProducer.ts` | 純 helper(`buildFollowupDraftRow` / `detectDraftSkip` / `pickGmailThreadId` / `buildConversationExcerpt` / `detectLanguage`)+ `runFollowupDraftScan` executor | `followupDraftProducer.test.ts` |
| `server/_core/followupScan.ts` | 加 `excludeProfileIds` opt(additive) | `followupScan.test.ts` +1 |
| `server/followupScanWorker.ts` | 先跑 draft producer,再跑 reminder(排除已草擬) | (worker,live) |

## 不做(v1 範圍外)

- 不造新送信路徑(刻意複用 `escalationReply`)。
- 不碰 whatsapp / wechat 跟進(那些沒有 gmailThreadId 送信軌;退回 inbox 提醒)。
- 不自動寄(永遠 Jeff 審)。
- 不做「跟進的跟進」節流以外的複雜 cadence(先 7 天 dedup,夠用再加)。
