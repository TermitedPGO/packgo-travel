# Gmail 整合 + 分類器修復 — Design (Stage 2)

> 對應 `proposal.md`。實作 checklist 見 `progress.md`。

## Task 1 — support@ 重新授權(資訊性,無 code)

- **路由**:`GET /api/admin/connect-gmail`([server/gmailOAuth.ts:49](../../../server/gmailOAuth.ts)),admin-only,302 導到 Google 同意畫面。
- **Scope / consent URL**:[server/_core/gmail.ts:53](../../../server/_core/gmail.ts) `getGmailAuthUrl`,用 `access_type=offline` + `prompt=consent` → 重新授權一定拿到新的 refresh token。Scope:gmail.readonly / modify / labels / userinfo.email。
- **Callback**:[server/gmailOAuth.ts:72](../../../server/gmailOAuth.ts),依 `emailAddress` upsert,保持 `isActive=1`,清掉 `disconnectReason`。
- **Jeff 要打開的網址**(在已用 admin 登入 packgoplay.com 的瀏覽器):
  ```
  https://packgoplay.com/api/admin/connect-gmail
  ```
  在 Google 選帳號畫面**選 support@packgoplay.com**。
- **第二隻帳號 = 同一個流程**:callback 依授權的 Google 帳號 upsert,沒有獨立的「加帳號」路徑。在選帳號畫面改選另一個帳號即可。
  - **Footgun**:重連 support@ 時若誤選 jeffhsieh09,會立刻把私人帳號 `isActive→1`。分類器驗證通過前不要連私人帳號。
- **根因待排除**:refresh token 死於 `invalid_grant`。常見原因:OAuth consent screen 仍在 "Testing"(refresh token 約 7 天過期)、手動撤銷、或 Google 改密碼。請確認 Google Cloud Console 的 publishing status 以免復發(我這端看不到該 console)。

## Task 2 — Token 死掉的節流警報

**問題**:worker 的 per-integration error 在 [gmailPollWorker.ts:48](../../../server/gmailPollWorker.ts) 被 catch 後只 `console.error`,job 仍「成功」完成,所以 `failed` event 的 `notifyOwner`([line 86](../../../server/gmailPollWorker.ts))對 `invalid_grant` 永遠不觸發 → 自 2026-06-03 起每 10 分鐘默默失敗。

**設計(Jeff 選:不自動停用,只響一次)**:
- 純邏輯抽到 `server/_core/gmailAuthFailure.ts`(worker 在 import 時就 `new Worker()` 連 Redis,不能在測試裡 import → 邏輯必須獨立才能單測)。
- `isAuthRevocationError(err)`:**只**認 `invalid_grant` / "token has been expired or revoked"。暫時性網路 / 5xx 錯誤不可觸發,否則狼來了。
- `handleIntegrationPollError(integration, err, io)`:
  - 非撤銷錯誤 → 不動作(worker 照舊 log)。
  - 撤銷錯誤 + `disconnectReason` 尚未以 `auth_revoked` 開頭 → 寫 `disconnectReason`(去重旗標)+ `notifyOwner` 一次。
  - 撤銷錯誤 + 已標記 → 安靜(本次撤銷事件已通知過)。
  - **不碰 `isActive`**(保持 1,per Jeff)。重連時 callback 清掉 `disconnectReason` → 重新武裝。
- I/O(db update、notifyOwner)以參數注入,模組保持純淨可測。
- 警報內文:中文、可操作、含重連網址 + 要選哪個帳號 + 「修好前只提醒這一次」。不用破折號。
- **取捨**:保持 `isActive=1` → token 沒救回前每 10 分鐘仍會錯一次(只是不再洗信箱)。這是 Jeff 明確選的。
- **測試**(`gmailAuthFailure.test.ts`):detection true/false;handle 三條路徑(generic 不動作、首次撤銷兩個 I/O 各一次、已標記不動作);alert 內含網址+帳號且無破折號。

## Task 3 — 分類器(#93)

### 兩個分開的問題
- **3a 分類品質**(本 task 核心,要 eval):真客人 vs 非客人。
- **3b 處理 robustness**:31% 例外(crash)。先量出哪幾種信會丟例外(附件解析?LLM 沒回 tool_call?),各別補防。與 3a 分開記錄、分開驗。

### 架構提案(待 Jeff review design 後定案)
```
Gmail-native 預過濾(無 LLM)
  └ 排除 category:promotions/social/forums;SPAM/TRASH 本來就被 Gmail 查詢預設排除
        ↓ 通過的
  便宜「是不是真客人?」triage gate(低成本)
        ↓ 像客人的才
  完整 InquiryAgent 擬稿(現有流程)
        ↓
  honor discard:非客人不擬稿、不貼 channel(省 token + 去雜訊)
```
- **信心門檻硬規則**:非客人 或 客人/雜訊判斷低信心 → escalate 給 owner,**絕不**當客人擬稿、更不 auto-send。即使日後開了 kill switch 也成立。

### 分類法(taxonomy)— 建議,待確認
- **建議 A(推薦)**:擴充現有 `classification` enum,加明確非客人類:`newsletter` / `transactional`(收據/確認) / `notification` / `personal`,全部 map 到 discard/ignore。理由:policy 與 dashboard 已 key on classification,改動最小。
- 建議 B:加一個正交 boolean `isCustomer` + `nonCustomerReason`,概念較乾淨但動到 output schema 與每個 consumer。
- 取捨寫在這,Stage 3 前由 Jeff 拍板。eval 的 gold label 先以**二元(客人 / 非客人)**為主,子類為輔,所以 taxonomy 未定不擋 eval。

### Eval 設計(Owner 已選:從 support@ live 拉)
1. **前置**:Jeff 先重連 support@(task 1)。
2. **拉語料**(read-only,只 support@):新寫 `scripts/gmail-eval/` 腳本,用還原後的 token 抓近 N 天訊息,**最小欄位**(from / subject / snippet / Gmail labelIds / internalDate),含 SPAM/category 標籤。語料留本機、不外傳、報告中匿名化。
3. **Gold label**:我先標(客人 / 非客人 + 子類)→ **Jeff 抽查 / 修正** → 凍結。
4. **量測**:舊 classifier vs 新 classifier 對 gold set,回報 precision / recall / F1 + confusion matrix。**優先指標 = 真客人 recall**(漏接客人代價最高)。
5. **簽核**:數字 + 抽樣案例給 Jeff 過目,通過才談部署。

### 硬性順序
分類器修好 + eval 過 + Jeff 簽核 → 才連 jeffhsieh09。不可把私人信箱餵給還沒驗過的分類器。
