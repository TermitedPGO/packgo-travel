# Tasks — Email 自動回覆(信任階梯)

> Stage 3。每 milestone:tsc 0 + Vitest + commit。Stage B 的「開」永遠是 Jeff 在 UI 親手做。

## m0 — 前置驗證 ✅(2026-06-12)
- [x] **修正前判**:Gmail token「過期」是誤讀 — tokenExpiresAt 只是 access token 舊快照,
      runtime 自動刷新;support@ 今晨 06:50 仍正常輪詢;gmail.modify scope 涵蓋寄信
      → **閘2 重授權不需要,寄信前置已就緒**
- [x] interactionOutcomes 可查當日數(現況 auto_escalate 5 / auto_draft 230)
- [x] 編輯記錄:editedPayload 核准時覆寫 payload,但 audit log 留 payloadEdited 旗標
      → m3 readiness 用 audit join approvalTasks(payload.classification)計算

## m1 — 政策 schema + 閘門改造(影子解耦)✅
- [x] DEFAULT_INQUIRY_POLICY 加四鍵 + minConfidence 85→90;舊政策缺鍵由純函式安全預設
      接住(missing/壞型別一律倒向安全側),不需要 ensurePolicy 改造
- [x] autoSendGate.ts 純函式:八步閘門;影子與全域 AGENT_DRY_RUN 解耦;影子不受
      cap 限制(證據照收);count 查詢失敗 fail-safe 視同 cap 滿
- [x] pipeline 接線:verdict 執行 + 黑名單命中改寫 verdict=draft + 通知訊息改 gate
      語言(影子卡標示「本來會自動回,未寄」)
- [x] Vitest 13 條:五類硬排除塞白名單仍 draft、雙開關、影子預設、cap 邊界、
      回歸保證(off+空白名單下任何輸入都拿不到 send)

## m2 — 可見性卡(留底)✅
- [x] pipeline 既有 per-email observation 補結構化 context(customerEmail/subject/
      draftReply/gmailMessageId)— 不另發訊息,重用 #inquiry channel 那張
- [x] autoReplyBox.ts:parseAutoReplyCard(純)+ listAutoReplyCards(7 天窗、
      LIKE 預過濾 + parse 真檢、未讀優先)+ commandCenter.autoReplyCards
- [x] TodayAutoReplyBox:已自動寄(BadgeK)/ 影子(Badge)卡 + 看內容展開 +
      跟進更正(重用 🔒 EscalationReplyDialog,sendEscalationReply guard 放行
      observation)+ 知道了(agent.replyToMessage markRead,與 channel 未讀同步)
- [x] i18n 10 keys · Vitest 5 條(parse)+ 批9 guard 測試跟上新契約

## m3 — 數據:核准不改率 ✅
- [x] autoReplyReadiness.ts:computeReadiness 純函式(sent/failed/approved 都算核准
      決定;shadow-only 類也列;拍板門檻 20+95% 進常數)+ getAutoReplyReadiness
      (approvalTasks cs 14 天 + audit payloadEdited join + observations 影子計數)
- [x] commandCenter.autoReplyReadiness 唯讀 procedure
- [x] Vitest 5 條(計數/門檻邊界 19↔20 封 95↔94%/failed 算核准/shadow-only/unknown)

## m4 — 政策開關 UI ✅
- [x] AutoSendPolicyCard(系統頁):成績單(達標徽章)/ 類別白名單(未達標粗黑警告,
      硬排除五類不在候選)/ 門檻 / 日上限 / 附件擋 / 影子 toggle / 總開關 🔒 黑鎖條 /
      全部停止鈕(無 confirm,影子照常收證據)
- [x] agent.getAutoSendPolicyFull / setAutoSendPolicyFull:六鍵讀寫(in-place,與既有
      setAutoSendSettings 同模式)+ zod 層擋硬排除類 + audit log(before/after)
- [x] readAutoSendPolicy 從 gate 導出共用(預設值單一來源)
- [x] i18n 24 keys · agent router 快照測試跟上(50→52 procedures)

## m5 — Stage A 啟動(部署後)
- [ ] 部署 → 影子模式自動生效(shadowMode 預設 true,總開關仍 false)
- [ ] 跑 ~2 週 → Jeff 看系統頁成績單 → 達標類別親手開(Stage B)

## DoD
- [ ] tsc 0 · 全套綠 · i18n parity
- [ ] 鐵律邊界成立:總開關 off / 白名單空 = 行為與今天完全一致(回歸保證)
- [ ] 硬編碼排除類在任何政策組合下都進不了自動線(測試鎖死)
- [ ] Jeff 親驗:影子卡出現在今日待辦、readiness 表有數字
