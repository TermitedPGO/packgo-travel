# 客人對話學習系統 — Proposal (Stage 1)

## 問題

Jeff 每次回客人訊息,都要重新讀完之前的對話紀錄,回想這個客人在意什麼、聊到哪。資料其實有存(inquiryMessages + customerInteractions),但 AI 沒有從中學習,每次回覆都像第一次認識這個客人。

## 目標

讓 AI 記住每個客人的事,並且學 Jeff 的回覆風格,逐步達到可以自動回覆。

## 三個階段

### 階段 1: 記住客人(本次做)

每次對話結束後,自動從對話內容提取這個客人在意的事、偏好、特殊需求,更新到 customerProfiles。下次 AI 回覆時自動帶入,不用 Jeff 重新讀。

成功標準: Jeff 打開客人對話時,AI 已經知道這個客人之前在意什麼,草稿直接反映這些資訊。

### 階段 2: 學 Jeff 的風格(之後做)

從 Jeff 過去的真實回覆中,學他怎麼跟不同類型的客人說話:語氣、用詞、判斷方式。不只是「不用破折號」這種規則,而是從實際範例中學。

### 階段 3: 自動回覆(最後做)

有把握的回覆自動送出,沒把握的標起來讓 Jeff 看。需要階段 1+2 的基礎才有意義。

## 現有基礎設施(已經有的)

| 元件 | 狀態 | 缺什麼 |
|------|------|--------|
| customerProfiles.aiNotes | 欄位存在 | 不確定是否有在更新 |
| customerProfiles.preferences (JSON) | 欄位存在 | 不確定有沒有從對話中提取 |
| customerProfiles.keyFacts | 欄位存在 | 同上 |
| customerInteractions | 每則訊息都有記錄 | 沒有回頭分析 |
| InquiryAgent 收到 customerProfile | 有帶入 | 但 profile 可能是空的 |
| inquiryMessages 存 Jeff 的回覆 | senderType='admin' | 沒有從中學習風格 |

## 需要釐清的問題

1. aiNotes / preferences / keyFacts 現在實際有在填嗎?還是 schema 有但 code 沒跑?
2. InquiryAgent 生成草稿時,有沒有實際讀到這些欄位的內容?
3. Jeff 目前一個月大概跟幾個客人在聊?(判斷規模)

## 不做的事

- 不做 fine-tuning(用 prompt + few-shot 就夠,不需要訓練模型)
- 不做即時對話(這不是 chatbot,是 email/微信回覆系統)
- 不改客人看到的介面(這是後台 AI 的改進)
