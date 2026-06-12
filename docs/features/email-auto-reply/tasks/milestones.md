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

## m2 — 可見性卡(留底)
- [ ] pipeline:auto_replied / would_auto_send → post agentMessages observation
      (context 帶 autoReply/shadow + draft + thread 資訊)
- [ ] 今日待辦:已自動回卡(看內容 + 跟進更正 → 重用 EscalationReplyDialog)+
      影子卡(看草稿,純資訊)— 都可處理好了收掉
- [ ] i18n · Vitest(卡片分類純函式)

## m3 — 數據:核准不改率
- [ ] `commandCenter.autoReplyReadiness`(唯讀):近 14 天 per-class
      {樣本, 不改核准, 編輯核准, 拒絕, 不改率} + 影子 would_auto_send 數
- [ ] Vitest(比率計算純函式;edited 判定 = editedPayload 與原 draftBody 是否實質不同)

## m4 — 政策開關 UI(接上批8 系統頁 placeholder)
- [ ] 系統頁「自動回覆政策」卡:總開關(🔒 黑鎖條才能開)/ 影子 toggle / 類別白名單
      (附 readiness 數據 + 未達標粗黑警告)/ 門檻 / 日上限 / 全停鈕(無 confirm)
- [ ] `agent.updateInquiryAutoSendPolicy` mutation:只准動六鍵 + audit + 版本遞增
- [ ] i18n · Vitest(payload 白名單驗證)

## m5 — Stage A 啟動(部署後)
- [ ] 部署 → 影子模式自動生效(shadowMode 預設 true,總開關仍 false)
- [ ] 跑 ~2 週 → Jeff 看 readiness 表 → 達標類別親手開(Stage B)

## DoD
- [ ] tsc 0 · 全套綠 · i18n parity
- [ ] 鐵律邊界成立:總開關 off / 白名單空 = 行為與今天完全一致(回歸保證)
- [ ] 硬編碼排除類在任何政策組合下都進不了自動線(測試鎖死)
- [ ] Jeff 親驗:影子卡出現在今日待辦、readiness 表有數字
