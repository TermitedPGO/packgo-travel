# 後台主對話框 — Claude 對齊（proposal · Stage 1）

> 目標：把後台主對話框（`AgentChatPage.tsx`，OpsAgent `#ops`）升級成「跟 Claude 對話」的順暢度與功能。
> 北極星：`Desktop/PackGo_示意圖/admin-3-claude.html`（slash / @ / 工具透明 / 停止 / 對話歷史）。

## 1. 現況（實地診斷,不是猜）

底層引擎**已經是 Claude 級**,不需重做：
- SSE token 串流（`/api/agent/ask-ops-stream`）
- Sonnet-4 多輪 tool loop（`server/agents/autonomous/opsAgentStream.ts`,最多 6 輪）
- Streamdown markdown 渲染
- 多輪記憶（載入最近 10 筆 `#ops`,兩邊都持久化到 `agentMessages`）

卡在**表層 UX**。三個最有感的痛點：
1. 答完會閃爍／重排（`AgentChatPage.tsx:522-529` 整串 invalidate + 串流泡泡被拆換成 DB 版）
2. 不能中途停（無 `AbortController`,送出鎖 90 秒,`:477 / :827`）
3. 看不到它在做什麼（tool `status` 被下個 token 蓋掉,`opsAgentStream.ts:207` + `:510`）

## 2. 範圍

### In scope
- **SMALL**：消閃爍、Stop 鈕、工具步驟持續列
- **MEDIUM**：新對話 + 對話歷史清單（多 thread,非單一 `#ops`）、訊息複製 / 重生
- **LARGE**：slash 指令、@ 提及（客戶 / 訂單 / 行程）

### Out of scope（v1 不做,另案）
- 持久記憶「已記住」功能（陳美玲以後報價加管家服務那種）— 是獨立的 agent memory 專案
- 語音輸入、附檔 artifacts 預覽（已部分存在,不在這條線）
- 客人端對話框（這條只動後台）

## 3. 分批交付（不 big-bang）

| 批次 | 內容 | 大小 | 風險 |
|------|------|------|------|
| **Inc 1** | 消閃爍 + Stop + 工具步驟列 + （綁）inbox 講人話 | SMALL | 低,純前端 + 已測 |
| **Inc 2** | 多對話 thread（新對話 + 歷史清單）+ 複製/重生 | MEDIUM | 中,碰 `agentMessages` channel 模型 |
| **Inc 3** | slash 指令 + @ 提及 autocomplete | LARGE | 中,新 composer 互動 |

每批：tsc 0 + Vitest + guard ship,你握 token。

## 4. 待你拍板（OPEN）

- **A. 視覺風格**：保留你現在的黑白「文件式」對話（角色標籤 + 分隔線,只是變順）, 還是改成 Claude app 那種「對話泡泡」？（記憶:你的黑白極簡是刻意的 art direction → 預設傾向保留文件式,只做順）
- **B. slash 指令清單**：示意圖那組（/報價 /查客戶 /查訂單 /記帳 /發提醒 /月報）為 v1 起手?碰錢的（報價/發提醒）一律先出確認卡不自動送。
- **C. @ 範圍**：客戶 + 訂單 + 行程三種實體（預設),還是只客戶?

## 5. 測試要求（§9.5）

- 每個新前端模組對應 `.test.ts(x)`（slash parser、@ autocomplete、abort、thread 切換 純函式優先）
- escalation/inbox 文案已在 `inquiryLabels.test.ts` 覆蓋

## 6. 狀態

- Stage 1 proposal：本檔
- Stage 2 design：待 §4 決定後補 `design.md`
- Inc 1 與 §4 無關（style-agnostic 的消閃爍/Stop/步驟列）→ 可先動工
