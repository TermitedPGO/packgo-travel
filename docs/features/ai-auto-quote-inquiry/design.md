# AI 自動處理客製團報價詢問（proposal + design + playbook）

> 起因（2026-06-15）：Jenny 的客製台灣團，從出報價、加照片、出英文版、擬回信，全是 Jeff 跟 Claude 來回手做。Jeff：「我們聊這麼久，AI 應該理解這些、自動化。」

## 問題

客製團詢問（如 Jenny）目前的後台流程：InquiryAgent 把它分類成 `quote_request` → policy `auto_escalate`（報價留人）→ 今日待辦一張**沒有草稿**的卡。之後所有事（出行程報價 PDF、中英文兩版、擬回信、夾 PDF、處理「有英文版嗎」「英文導遊多少」這種追問）都是人手來回。

## 目標

客製團詢問進來時，AI 自動：
1. 抽出行程要素（天數、人數、區域、房型、是否含機票等）。
2. 叫 `packgo-quote` skill 出高檔行程報價 PDF（每日專頁＋滿版景點照；中文預設，需要時出英文版）。
3. 擬一封回信、把 PDF 夾上（靠 reply-attachments 功能）。
4. 放今日待辦給 Jeff 審 → Jeff 按寄。
常見追問（英文版、導遊語言選項）也先擬好骨架。

## 鐵則：報價留人那條線，不自動（[[feedback_packgo_admin_ai_boundary]]）

- **價格、利潤、供應商實際成本（如金宥的英文導遊加價）AI 不自己生。** AI 負責搬運與排版（出行程骨架、抓照片、擬信措辭），但**任何要報給客人的數字**，AI 到這裡就停、escalate 給 Jeff 填/確認、Jeff 按寄。
- AI 出手處資訊必須 100% 正確（搬運不生成）。拿不到確認來源的數字，就留白＋escalate，不准猜。

## 相依

- **reply-attachments 功能**（進行中，見 `docs/features/reply-attachments/`）— 夾 PDF 進回信要靠它。先上線。
- **packgo-quote skill**（已完成升級）— 出 PDF；中英雙版（skill 內加「同資料出英文版」一條，目前是手動）。
- **InquiryAgent / 今日待辦 / produceInquiryReply** — 擬信、上架。

## 客製團詢問 Playbook（教 AI 怎麼跑）

1. **分類**：客人要「設計行程＋報價」=客製團。先確認要素齊不齊（天數/人數/區域/房型/機票/特殊需求）；不齊就先擬一封「釐清需求」的回信問清楚，不要硬出報價。
2. **出文件**：要素齊 → 叫 `packgo-quote` skill 出 PDF。照片走 Wikimedia CC 流程（skill 已寫）。中文預設；客人要英文 → 同資料出英文版。
3. **價格**：行程骨架 AI 做，**單價/總價/利潤 escalate 給 Jeff**（先從供應商後台/金宥核底價，見 [[feedback_packgo_quote_pricing]]）。報價單不顯示底價利潤。
4. **擬回信**：短、口語、不官方（[[feedback_packgo_customer_msg_style]]）；但高單價/正式客人可較 professional（加公司署名，用「您」）— 看客人。把 PDF 夾上。放今日待辦。
5. **追問處理**：
   - 「有英文版嗎」→ 出英文版 PDF、夾上、擬短回信。
   - 「英文導遊多少」→ AI **不報數字**；擬信骨架說「正在跟當地確認費用」＋ escalate 給 Jeff 跟金宥要數字。註：英文導遊=全程英文，不是部分。
   - 改行程/換飯店 → 改 PDF 重出。
6. **永遠 Jeff 按最後一鍵**（報價給客人由 Jeff 寄）。

## 接線（design）

- InquiryAgent 對 `quote_request`（且要素齊、信心夠）不再只 escalate：呼叫一個新的 producer（類似 `produceInquiryReplyTask` 但會跑 skill 出 PDF + 起草），把 PDF 上傳 R2、草稿＋附件 key 寫進今日待辦卡（context.draftReply + attachmentKeys）。
- 價格欄位留白/標「待 Jeff 確認」，escalate。
- skill 由 agent 端觸發（headless Chrome 出 PDF 的流程封裝成可被 server 呼叫的一步，或先讓 agent 產 HTML→PDF 落地再上傳）。

## 非目標

- 全自動寄出（永遠 staged 給 Jeff）。
- 自動定價（永遠人決定）。

## Rollout

reply-attachments 上線後再做這個。tsc＋vitest 綠 → `pnpm ship`。先讓「客製團詢問 → 自動出中文 PDF＋擬信＋上架今日待辦」這條跑通，英文版/追問再接。
