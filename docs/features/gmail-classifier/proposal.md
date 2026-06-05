# Gmail 整合 + 分類器修復 — Proposal (Stage 1)

> 來源:2026-06-04 從一個權限被鎖的 session 交接過來。對應 owner task #93。
> 狀態:Stage 1 需求。Stage 2 design 見 `design.md`。

## 背景(已從 live prod 驗證,2026-06-04)

`gmailIntegration`(TiDB,read-only 查詢):

| 帳號 | id | isActive | last poll | processed / failed | disconnectReason |
|---|---|---|---|---|---|
| support@packgoplay.com | 30001 | 1 | 2026-06-03 07:10 | 57 / 0 | null |
| jeffhsieh09@gmail.com | 1 | 0 | 2026-05-27 | 174 / 80 (31%) | "Switched to support@…" |

行為閘門(Fly secrets / env):
- `AGENT_DRY_RUN=true` 且 policy `autoSendEnabled=false` → 兩道 auto-send 開關都關著。**目前 agent 只擬稿,不自動寄信給任何人。**
- `BASE_URL=https://packgoplay.com`、`OWNER_EMAIL=support@packgoplay.com`、SMTP(`EMAIL_USER/PASSWORD`)已設 → owner 警報寄得出去。
- `GMAIL_POLL_LABEL` 未設 → 輪詢整個未讀收件匣,沒有 label 範圍限制。

資料發現(`customerInteractions`,231 封 inbound,2026-05-22 ~ 06-01,78 個寄件人):
- **229 封被分類 `spam`**,1 visa_inquiry,1 quote_request。
- outcomes:229 `auto_draft`、2 `auto_escalate`。
- **Bug:** policy 寫 `spam → action: "discard"`,但 pipeline 從不執行 discard。每封 spam 仍跑一次完整 LLM 擬稿並貼到 #inquiry channel。所以症狀不是「分不出 spam」(LLM 大多標成 spam),而是 (a) 每封垃圾都浪費一次擬稿 LLM call,(b) 光看總數無法判斷那 229 裡有沒有埋著真客人 → 這正是 eval 要回答的(真客人 recall)。
- jeffhsieh09 的 31% `messagesFailed` 是處理時**丟例外**(crash,例如 2026-05-21 記錄的 LLM 沒回 tool_call),不是分類錯。屬於另一個問題(robustness)。

## 目標

1. **重連 support@**:被撤銷的 OAuth token 重新授權,恢復 live 輪詢。確認加第二隻帳號是同一個流程。(task 1 — 已交付路徑與網址,見 design.md)
2. **Token 死掉要有警報**:`invalid_grant` 時節流通知 owner 一次,別每 10 分鐘默默失敗。(task 2)
3. **分類器可靠分辨「真客人 vs spam/行銷/收據/通知/私人信」**:用 support@ 真實信件做標注 eval,回報 precision/recall。優先指標 = **真客人 recall**(別把真客人埋進 spam)。(task 3 / #93)
4. 上面驗證通過後,才連 jeffhsieh09 私人帳號。

## Non-goals(這次不做)

- 不碰 Stripe / 金流(LIVE)。
- 不開 auto-send:`AGENT_DRY_RUN` 與 `autoSendEnabled` 維持關閉,要分開、另外簽核才開。
- 分類器驗證通過前不連 jeffhsieh09。
- 不自動部署:task 2、task 3 上線前都要 Jeff 簽核。

## 紅線(來自 CLAUDE.md + 交接)

- 不准猜 → 用 eval 數據驗,不是改個 prompt 就宣稱修好。
- tsc 0 error + 每個新模組有 Vitest + i18n parity。
- 任何文字不用破折號(—)。
- 敏感:這影響「自動寄給客人什麼」,部署前 Jeff 過目。

## Owner 已定案的決策(2026-06-04 AskUserQuestion)

- **Eval 資料來源**:從 live Gmail 重新拉一批 → 即 **support@ 重新授權後,只從 support@ 拉,不碰 jeffhsieh09**。
- **Task 2 token 死掉處理**:**不自動停用帳號**,保持 `isActive=1`,只發一次節流警報(用 `disconnectReason` 當去重旗標,重連時被清除即重新武裝)。
