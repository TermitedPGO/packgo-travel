# Gmail Push (Cloud Pub/Sub) — GCP 設定 Runbook

> 把「每 3 分鐘輪詢 Gmail」升級成 **Gmail push**（GCP Pub/Sub + webhook）達到秒級通知。
> 程式碼已經寫好（見本檔末「程式碼改了什麼」）。**這份 runbook 是 Jeff 要在 GCP console + Fly 手動做的部分** — code 自己無法建 GCP 資源。
>
> 重要：輪詢 **沒有移除**。push 會漏、watch 約 7 天過期，輪詢留作 fallback / 對帳。即使這份 runbook 一步都還沒做，系統照常運作（只是維持 3 分鐘延遲）。做完才會「升級成秒級」。

---

## 0. 一句話總結 Jeff 要做的事

1. 在 GCP 建一個 Pub/Sub **topic**，授權 Gmail 的系統帳號往裡面 publish。
2. 建一個 **push subscription**，指到 `https://packgoplay.com/api/gmail/push`，並掛一個 **OIDC service account + audience**（這是安全關鍵 — 證明請求真的來自 Google）。
3. 在 Fly 設 4 個環境變數。
4. **重新點一次「Connect Gmail」**（不是重新授權，只是觸發第一次 watch 註冊）。

預估 15–20 分鐘。需要的權限：對 GCP 專案 `37442654295`（support@packgoplay.com 那個）有 Pub/Sub Admin + Service Account Admin。

---

## 1. 確認專案 + 啟用 API

- GCP 專案：**packgo 既有的那個（專案號 `37442654295`）** — 就是 Gmail OAuth client（`GMAIL_OAUTH_CLIENT_ID`）所在的專案。**Pub/Sub topic 必須跟 Gmail OAuth 在同一個 GCP 專案**，否則 Gmail 不准 publish。
- 啟用兩個 API（Console → APIs & Services → Enable APIs）：
  - **Cloud Pub/Sub API**
  - **Gmail API**（本來就開著）

---

## 2. 建 Pub/Sub Topic

Console → Pub/Sub → Topics → **Create topic**：

- Topic ID：`gmail-inbox`（名字隨意，但要記住）
- 其他預設即可（不用勾「Add a default subscription」，我們下面自己建 push subscription）

建好後完整 topic 名稱會是：

```
projects/<PROJECT_ID>/topics/gmail-inbox
```

`<PROJECT_ID>` 用**專案 ID 字串**（不是專案號），例如 `packgo-travel` 之類；在 Console 右上或專案選單看得到。**這整串就是稍後要設的 `GMAIL_PUBSUB_TOPIC`。**

---

## 3. 授權 Gmail 系統帳號 publish 到這個 topic（關鍵，少了就收不到）

Gmail 用一個**固定的系統 service account** 把通知 publish 進來：

```
gmail-api-push@system.gserviceaccount.com
```

在剛建的 topic 頁 → **PERMISSIONS / SHOW INFO PANEL** → **ADD PRINCIPAL**：

- New principals：`gmail-api-push@system.gserviceaccount.com`
- Role：**Pub/Sub Publisher**（`roles/pubsub.publisher`）
- Save

> 漏這步的症狀：`users.watch` 呼叫會直接報 `User not authorized to perform this action`（在 OAuth callback log 看得到 `[gmail oauth] watch registration failed`）。

---

## 4. 建一個 Service Account 給 push 簽 OIDC token

push subscription 送請求到我們 webhook 時，會帶一個 **Google 簽的 OIDC JWT** 在 `Authorization: Bearer`。我們的 webhook 會驗這個 token（簽章 + audience + service account email）才處理。所以要一個 SA 給它簽。

Console → IAM & Admin → Service Accounts → **Create service account**：

- Name：`gmail-push-invoker`
- 不需要授予任何專案角色（它只是用來簽 OIDC token，不需要其他權限）
- 建好後記下它的 email，形如：
  ```
  gmail-push-invoker@<PROJECT_ID>.iam.gserviceaccount.com
  ```
  **這就是稍後要設的 `GMAIL_PUSH_SA`。**

> 另外要讓 Pub/Sub 服務帳號能「代表這個 SA 簽 token」。多數情況 GCP 會自動處理；若 subscription 建立時報 IAM 錯誤，照 Console 的提示，把 role
> `roles/iam.serviceAccountTokenCreator` 授給 Pub/Sub 的 service agent
> `service-<PROJECT_NUMBER>@gcp-sa-pubsub.iam.gserviceaccount.com`（`<PROJECT_NUMBER>` = `37442654295`）。

---

## 5. 建 Push Subscription（指到我們的 webhook）

Console → Pub/Sub → Subscriptions → **Create subscription**：

- Subscription ID：`gmail-inbox-push`
- Topic：選 step 2 的 `gmail-inbox`
- Delivery type：**Push**
- Endpoint URL：
  ```
  https://packgoplay.com/api/gmail/push
  ```
  （一定要用 `packgoplay.com` 正式網域，不是 `*.fly.dev` — fly.dev 會被 308 導走，雖然 `/api/*` 有豁免，但正式網域最穩。）
- 勾 **Enable authentication**：
  - Service account：選 step 4 的 `gmail-push-invoker@...`
  - **Audience**：填一個**你自己決定、之後要原封不動設進 `GMAIL_PUSH_AUDIENCE`** 的字串。建議直接用 endpoint URL：
    ```
    https://packgoplay.com/api/gmail/push
    ```
- Acknowledgement deadline：**10 秒**就夠（我們 webhook 幾毫秒就 204 回，重活丟去背景 queue）。
- 其餘預設。Create。

---

## 6. 設 Fly 環境變數

```bash
fly secrets set \
  GMAIL_PUBSUB_TOPIC="projects/<PROJECT_ID>/topics/gmail-inbox" \
  GMAIL_PUSH_AUDIENCE="https://packgoplay.com/api/gmail/push" \
  GMAIL_PUSH_SA="gmail-push-invoker@<PROJECT_ID>.iam.gserviceaccount.com" \
  -a packgo-travel
```

| 環境變數 | 值 | 用途 |
|----------|----|------|
| `GMAIL_PUBSUB_TOPIC` | `projects/<PROJECT_ID>/topics/gmail-inbox` | `users.watch` 要 publish 去哪個 topic。**沒設 = push 整套不啟動，只跑輪詢。** |
| `GMAIL_PUSH_AUDIENCE` | step 5 填的 audience（建議就是 endpoint URL） | webhook 驗 OIDC token 的 `aud` claim。**prod 沒設這個，webhook 會拒收所有 push（500）**，故意如此 — 避免只驗簽章就放行任何 Google 簽的 token。 |
| `GMAIL_PUSH_SA` | step 4 的 SA email | webhook 額外比對 token 的 `email` claim，確保是「我們這個 subscription 的 SA」而不是別的專案的。**選填但強烈建議。** |

> `APP_ENCRYPTION_KEY`（或 `PLAID_ENCRYPTION_KEY`）本來就有了 — token 加解密共用同一把，這次不用動。

---

## 7. 要不要重新授權 Gmail？

**不用重新授權（scope 沒變）。**

- `gmail.users.watch` 需要的 scope 是 `gmail.readonly` / `gmail.modify` / `https://mail.google.com/` / `gmail.metadata` **任一**（已對照官方 method reference 查證，不是 guide 頁那句模糊的「modify 或 settings」）。
- 我們**現有的授權已經同時有 `gmail.readonly` + `gmail.modify`**，所以 watch 不需要任何新 scope，**故意不加 `gmail.settings*`**（加了反而要 Jeff 重新同意）。

**但要重新「連一次」**（不是重新授權，是觸發第一次 watch 註冊）：

- code 在 **OAuth connect callback 成功後**會自動呼叫一次 `users.watch`。但你現有的 integration row 是 watch 功能上線**之前**就連好的，所以還沒註冊過 watch。
- 上線後（部署完、env 設好），請**重新點一次後台的「Connect Gmail」**，或直接開：
  ```
  https://packgoplay.com/api/admin/connect-gmail
  ```
  （要先用 admin 登入）。走完一次流程即可 — 之後每天的續租 cron 會自動接手，不用再手動。

---

## 8. 驗證有沒有成功

1. **看 OAuth callback log**（step 7 重連後）：應出現
   `[gmail oauth] watch registered (expires 2026-07-...)`。
   若是 `GMAIL_PUBSUB_TOPIC unset` → env 沒設好；若是 `watch registration failed` → 多半是 step 3 的 publish 權限漏了。
2. **DB**：`gmailIntegration.watchExpiration` 應該有值（epoch 毫秒），`lastHistoryId` 有值。
3. **真的寄一封測試信到 support@packgoplay.com**：幾秒內 Fly log 應出現
   `[gmailPushWorker]` / `[gmailPipeline] push incremental ingest done`，客人頁該秒級出現。
4. **Pub/Sub subscription 指標**（Console → 該 subscription → Metrics）：
   - `push request count` 有在動、`ack` 正常；
   - 若看到大量 `4xx`/`5xx`：4xx 多半是 OIDC 驗證失敗（audience / SA 對不上 env）；5xx 看 Fly log。

---

## 9. 之後的維運（自動，Jeff 不用管）

- **每天 04:30 UTC** 有一個 cron（`gmail-watch-renew`）自動續租 watch（Gmail watch 約 7 天到期，提早續，留 2 天緩衝）。
- watch 若因故失效、或 `historyId` 過期（超出 Gmail 保留窗），**輪詢會自動補上**，不會漏信（只是那段時間退回到 3 分鐘延遲）。
- token 被撤銷（invalid_grant）時，push 跟 poll 都會偵測到並**通知 Jeff 一次**，要 Jeff 重新連 Gmail。

---

## 10. 程式碼改了什麼（給之後接手的人看，不需執行）

| 檔案 | 改動 |
|------|------|
| `server/_core/gmail.ts` | 新增 `registerGmailWatch` / `stopGmailWatch` / `listHistoryMessageIds`（增量 diff）/ `listMessagesByIds` / 純函式 `decodePubSubPushBody` + `extractBearerToken`；scope **未動**（加註說明為何不動）。 |
| `server/_core/gmailPushWebhook.ts`（新） | `POST /api/gmail/push` 的 handler：驗 OIDC（`verifyPushAuth`，可單測）→ 解 envelope → 入 queue → 204 快回。 |
| `server/agents/autonomous/gmailPipeline.ts` | 抽出共用 `ingestFreshMessages`（收據/雜訊/逐封 ingest 三道 gate，與輪詢共用、行為不變）；新增 push 入口 `runGmailPipelineForMessageIds`（用 `history.list` 增量）。輪詢 `runGmailPipeline` 維持相容。 |
| `server/queue.ts` | 新增 `gmailPushQueue` + `gmailWatchRenewQueue` + `scheduleGmailWatchRenew`（每天 04:30 UTC）。 |
| `server/gmailPushWorker.ts`（新） | 兩個 worker：`gmail-push`（跑增量 ingest）+ `gmail-watch-renew`（每天續租）。 |
| `server/gmailOAuth.ts` | connect 成功後 best-effort 註冊一次 watch（topic 沒設就略過，永不拋錯）。 |
| `server/_core/index.ts` | 掛 `/api/gmail/push` route（express.raw）+ 啟動 push workers + 排 renew cron。 |
| `drizzle/schema.ts` + `drizzle/0103_gmail_watch_expiration.sql` | `gmailIntegration` 加 `watchExpiration BIGINT NULL`（epoch ms）。idempotent migration。 |
| 測試 | `server/_core/gmailPush.test.ts`（envelope 解析 + bearer + history diff/dedup/pagination/404）、`server/_core/gmailPushWebhook.test.ts`（OIDC 驗證所有拒收/放行分支）。 |

**安全摘要**：webhook 不只信 body — 強制驗 Pub/Sub 的 OIDC JWT（`OAuth2Client.verifyIdToken` 驗簽章 + audience + 過期，再額外查 `email_verified===true` 與 `email===GMAIL_PUSH_SA`）。驗不過回 401；prod 沒設 audience 直接 500 拒收（不讓只驗簽章就放行）。冪等沿用既有 `PACKGO_AI_PROCESSED` label — 同一封信 push + poll 都碰到也只處理一次、不會重覆回信。
