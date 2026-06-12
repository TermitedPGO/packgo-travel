# Tasks — Email 自動回覆(信任階梯)

> Stage 3。每 milestone:tsc 0 + Vitest + commit。Stage B 的「開」永遠是 Jeff 在 UI 親手做。

## m0 — 前置驗證
- [ ] Gmail OAuth token 狀態(閘2 重授權做了沒?gmailIntegration.tokenExpiresAt 未來 +
      isActive=1)— 沒過這關整個 feature 紙上談兵
- [ ] 確認 interactionOutcomes 可查「當日 auto_replied 數」(日上限的計數來源)
- [ ] 確認 approvalTasks 的 editedPayload 留存方式(算「不改直接核准」的依據:
      decidedAt 後 payload vs editedPayload 異同)

## m1 — 政策 schema + 閘門改造(影子解耦)
- [ ] DEFAULT_INQUIRY_POLICY 加四鍵(shadowMode=true / classes=[] / dailyCap=10 /
      blockAttachments=true);ensurePolicy 對舊政策 JSON 合併補鍵(additive)
- [ ] gmailPipeline 閘門八步(design §2):硬編碼排除 → 白名單 → 附件 → 信心 → 日上限
      → 黑名單(既有)→ 影子 → 真寄
- [ ] 純函式 `evaluateAutoSend(decision, policy, todaysSent, hasAttachments)` →
      {verdict: "send"|"shadow"|"draft", reason} — 全部閘門邏輯進純函式,pipeline 只執行
- [ ] Vitest:八步閘門逐條 + 硬編碼排除不可被白名單繞過 + cap 邊界

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
