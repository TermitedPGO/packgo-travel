# 批9 — Email 迴路收尾(escalation 可回 + 客戶歸戶 + 訪客進列表)

> 起因(2026-06-12,Jeff):「沒有自動回客人或者編輯,也沒有自動增加客戶」。
> 調查結論:auto-draft 那半條鏈完整(審核卡可編輯可寄);escalation 那半條是只讀;
> 客檔有自動建(customerProfiles)但 sidebar 不列、email 不歸戶。
> **拍板(2026-06-12)**:① 自動回維持鐵律 — 全部 Jeff 核准才寄,escalation 卡補上
> 「編輯 + 核准寄出」;② sidebar 客戶 = 註冊用戶 + email 訪客(customerProfiles 當主檔,
> 註冊自動合併),不建影子 users。

## 實況調查(摘要,完整見 session 2026-06-12)
- escalation 建議回覆烙在 agentMessages.body 文字第三段,無 inquiryId/結構化欄位
  (gmailPipeline.ts:597-628);agentMessages.context 欄位存在(ops chat 已用)
- `sendAdminInquiryReply({inquiryId, body, senderId})`(_core/inquiryReply.ts)= 現成送信
  helper,cs lane executor 已用;只需 inquiryId
- TodayEscalationCard 只有 ack toggle + 跳客人,無動作鈕
- gmailPipeline:237-255 已自動 upsert customerProfiles(email-only,userId=null)
- **連 userId 都沒做**:已註冊客人用 email 來信,inquiries.userId 仍 null、profile 不連
- admin.customerList 只讀 users(role=user);customerOpenItems 用 userId 查 inquiries
  → guest 全隱形
- 微信歸戶模式(wechatCustomerMatch:profiles.wechatId → userId)可平移到 email

## Milestones

### m1 — escalation 卡「編輯 + 🔒 核准寄出」(同一條既有送信路)✅
- [x] gmailPipeline escalation insert 加結構化 context JSON:{inquiryId, draftReply,
      classification, customerEmail}(body 保持人讀格式不變,向後相容)
- [x] escalationBox EscalationRow 加 inquiryId/suggestedReply(parse context,壞 JSON 降級 null)
- [x] commandCenter 新 mutation `escalationReply`:{messageId, inquiryId, body} →
      sendAdminInquiryReply(既有 helper,零新送信基建)+ 成功後 markRead + audit log
- [x] TodayEscalationCard:有 inquiryId+draft 的卡顯示「編輯並回覆」→ dialog
      (textarea 預填草稿 + 🔒 黑鎖條 checkbox「確認寄給 X」)→ 寄出 → 誠實 toast(sent/failed 帶因)
- [x] 舊 escalation rows(無 context)優雅降級:不顯示按鈕
- [x] Vitest:context parse、mutation(mock send)、降級

### m2 — email 歸戶(微信模式平移) ✅
- [x] `emailCustomerMatch.ts`:sender email → users.email 直查(註冊客人)→ 回 userId
- [x] gmailPipeline 進件:match 到 → inquiries.userId 補上 + customerProfiles.userId 連結
      (既有 profile 無 userId 時 backfill)
- [x] Vitest:match 函式 + pipeline 寫入(mock db)

### m3 — sidebar + 客戶 inbox 收訪客 ✅
- [x] admin.customerList 改聯集:users(role=user) ∪ customerProfiles(userId IS NULL 且
      email 非空,且 email 不存在於 users — 註冊後自動去重)→ {kind:"user"|"guest"}
- [x] WsView customer 支援 guest(profileId 鍵);sidebar 訪客 chip 顯示 email + 灰「訪客」badge
- [x] CustomerInbox guest 模式:openItems 以 customerEmail 查 inquiries(userId null);
      header 降級(無 PackPoint/訂單/總消費);對話/機票/微信區隱藏或空狀態
- [x] 註冊合併:m2 的 matcher 在下次來信時自動連 userId;customerList 聯集查詢已去重
- [x] Vitest:聯集去重、guest openItems 查詢鍵

## 實作備註(與原規劃的差異,誠實記錄)
- m1 送信走 `sendReplyInThread`(回原 Gmail thread)而非 sendAdminInquiryReply —
  pipeline 進件根本不建 inquiries row,thread 回覆對客人體驗也更好(同一串)
- m2 範圍修正:inquiries.userId 補連結不適用 pipeline(它不寫 inquiries);
  實際連結點是 customerProfiles.userId;admin 帳號永不歸戶(Jeff 測試信防呆)
- m3 訪客 dedupe 在 SQL(NOT EXISTS users.email),無純函式可單測;
  由 tsc + i18n guard + prod 親驗覆蓋

## DoD
- [x] tsc 0 · 全套 vitest 綠(2266 passed)· i18n parity 7318 keys
- [x] 寄出動作 🔒 gated(編輯並回覆 dialog,checkbox 點名收件人);鐵律不變(零自動寄)
- [x] 300 行紅線(EscalationReplyDialog 105 / GuestCustomerPane 139 / emailCustomerMatch 100)
- [ ] Jeff prod 親驗(寄一封測試信走全鏈:分類→卡→編輯並回覆→核准→收到回信;
  用非註冊信箱寄 → sidebar 出現訪客 chip → 點開看記錄)
