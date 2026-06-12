# 設計 — Email 自動回覆(信任階梯)

> Stage 2。原則:重用既有政策/閘門/安全網,新增的是「影子旗標、類別白名單、
> 可見性、數據、UI 開關、上限」六件配套。

## 1. 政策 schema 擴充(agentPolicies.inquiry JSON,additive)

```jsonc
{
  "autoSendEnabled": false,          // 既有 — 總開關(Stage B 才開)
  "autoSendMinConfidence": 90,       // 既有 — 建議從 85 升到 90
  "autoSendShadowMode": true,        // 新 — Stage A:算 meetsAutoSend 但永不寄,記 would_auto_send
  "autoSendClasses": [],             // 新 — 類別白名單(空 = 一類都不寄);UI 只列允許的候選
  "autoSendDailyCap": 10,            // 新 — 每日自動寄上限,超過 → 降級成草稿
  "autoSendBlockAttachments": true   // 新 — 帶附件一律不自動
}
```

硬編碼排除(不在 JSON、不在 UI,改碼才能動):`refund_request / complaint /
quote_request / deposit_inquiry / visa_inquiry`。UI 候選清單 = 全部分類 −
alwaysEscalate − 硬編碼排除。

## 2. Pipeline 閘門改造(gmailPipeline)

現有:`meetsAutoSend = autoSendEnabled && !shouldEscalate && conf ≥ threshold`
改為(順序即優先序,任一擋下就走草稿/升級路):
1. 硬編碼排除類 → 永不
2. `decision.classification ∉ autoSendClasses` → 否
3. 帶附件且 autoSendBlockAttachments → 否
4. conf < autoSendMinConfidence → 否
5. 今日已自動寄 ≥ dailyCap(查 interactionOutcomes 當日 auto_replied 數)→ 否(記 cap_hit)
6. post-LLM 黑名單(既有)→ 強制升級
7. `autoSendShadowMode` → 不寄,outcome=would_auto_send(**與全域 AGENT_DRY_RUN 解耦**)
8. 全過 → sendReplyInThread 真寄,outcome=auto_replied

## 3. 可見性:今日待辦留底卡(零新表)

自動寄出 / 影子想寄的信都已寫 agentMessages?否 — 它們只進 interactionOutcomes。
新增:pipeline 在 auto_replied / would_auto_send 時 post 一張 agentMessages
(messageType="observation",agentName="inquiry",readByJeff=0,context 帶
{autoReply: true|shadow, classification, confidence, draftReply, gmailThreadId, customerEmail}):
- **已自動回卡**(Stage B):淡灰資訊卡「已自動回覆 X · 信心 N · 看內容」;
  動作:「跟進更正」→ 重用批9 EscalationReplyDialog(預填空白,寄同 thread)
- **影子卡**(Stage A):「AI 本來會自動回這封(影子模式)」+ 看草稿;
  不需要動作 — 真正的草稿核准照常在 cs lane 卡上做
- 兩種卡都可「處理好了」收掉;絕不阻塞

## 4. 數據:核准不改率(報告卡)

來源:approvalTasks(cs lane)已存 payload.draftBody + decideApprovalTask 的
editedPayload — **歷史資料現成可算**。
- 新唯讀 procedure `commandCenter.autoReplyReadiness`:近 14 天 per-classification
  {樣本數, 不改直接核准數, 編輯後核准數, 拒絕數, 不改率} + 影子 would_auto_send 數
- 呈現:政策卡內嵌一張小表(達標類別亮「可開」徽章:樣本 ≥10 且不改率 ≥90%)

## 5. 政策開關 UI(批8 系統頁的 Agent 開關 placeholder 接真後端)

系統頁 InquiryAgent 區塊 → 「自動回覆政策」卡:
- 總開關(autoSendEnabled)— 🔒 黑鎖條 checkbox 才能開(開 = 真的會寄給客人)
- 影子模式 toggle(預設 on;關影子 + 開總開關 = Stage B)
- 類別白名單 checkboxes(只列允許候選;每類旁顯示 readiness 數據;未達標的可勾但
  顯示粗黑警告)
- 信心門檻 / 日上限 數字輸入
- 「全部停止」紅按鈕 = autoSendEnabled=false(一鍵,無 confirm — 停永遠是安全方向)
- 寫入走新 mutation `agent.updateInquiryAutoSendPolicy`(只准動上述六鍵,
  其他政策內容不經此路;audit log;版本 +1)

## 6. 安全邊界總表

| 風險 | 防線 |
|---|---|
| 寄錯類(碰錢) | 硬編碼排除 + 白名單預設空 + alwaysEscalate 既有 |
| 注入攻擊產生危險內容 | 既有 post-LLM 黑名單(金額/退款/密碼/銀行)→ 強制升級 |
| 量失控 | 日上限(預設 10)+ 超限降級草稿 |
| 寄了才發現不對 | 留底卡 + 跟進更正一鍵起草;email 無法收回,故門檻高 + 類別窄 |
| 想立刻停 | UI 全停鈕 + AGENT_DRY_RUN env 雙保險 |
| 半夜寄出品質沒人看 | Stage B 准入條件就是「該類歷史 90% 不用改」;留底卡早上必看 |
| 附件(證件/文件) | autoSendBlockAttachments 預設 true |

## 7. 與既有件的關係
- 批9 escalation 編輯並回覆:不動,永遠是人工線
- cs lane 草稿核准:不動,Stage A/B 之下所有不符自動條件的信照走
- AGENT_DRY_RUN:保留為全域急停 env,不再承擔影子職責(由 autoSendShadowMode 接手)
