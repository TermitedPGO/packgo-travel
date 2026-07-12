# PACK&GO 安全審計 — 2026-07-12（prod v811）

**審計員:** Claude (Opus 4.8)，唯讀模式（讀 code + prod 唯讀探針，零寫入）
**範圍:** 現行營運中的 prod 網站 packgoplay.com（Fly app `packgo-travel`），承接 `docs/SECURITY_AUDIT_2026_05_14.md`（Opus 4.7）。
**方法:** source-code review + 2 支 Explore subagent（procedure 分類 / 注入面掃描）+ git 全歷史 secret 掃描 + `pnpm audit` + prod 唯讀 HTTP 探針。
**evidence_reference:** 見每條發現的 file:line 與文末「prod 探針證據」。所有 prod 探針為 GET/HEAD 唯讀。

---

## 總評:敢公開營運（B+ / A−）

現在這站可以繼續公開營運。上一輪（5-14）審出的所有 P0/P1 我逐條複驗，**全部已修**：四個無認證上傳端點、Gmail token 明文、inquiries/newsletter 無限流、internal token 明文 `===` 比較、OAuth 缺 state、cookie 365 天 —— 都補上了。核心信任邊界（付款金額 server 端算、booking/invoice 全部 owner-check、Stripe/Plaid/Gmail webhook 都驗簽、護照全路徑 AES-256-GCM 加密、CORS 白名單去萬用字元、CSP/HSTS 齊全、密碼重設 256-bit 單次 1 小時）都是實打實的，比大多數一人 SaaS 好。

**沒有找到「攻擊者能直接偷到客戶資料或錢」的洞。** 注入面（raw SQL / shell / 路徑 / prompt / eval）掃過一輪，零可達 sink。

open 的問題集中在兩類，都不是「立刻被打穿」等級：
1. **濫用 / 成本控制** —— 幾個 public mutation 沒限流（LLM 燒錢、匿名 PII 灌入、寄信到攻擊者信箱）。
2. **縱深防禦** —— prod 在對外送 sourcemap（整包前端原始碼可還原）、依賴一堆傳遞性 CVE、prod DB runtime 身分等同 root。

唯一的系統性風險是**已知的 prod DB runtime = root 含 DDL**（DB 硬化批已確認）。它今天不是活漏洞（沒有可達注入去利用它），但它是「爆炸半徑放大器」：萬一未來任何一條注入 / RCE 落地，root DB 讓小事變滅頂。這條的優先級是「趁沒事趕快降權」，不是「現在正在被打」。

---

## 立刻該修的三條

1. **給沒限流的 public mutation 上 rate limit** —— 尤其 `aiQuotes.generate`（會排程寄跟進信到 input 傳進來的信箱 = email 轟炸 + LLM 燒錢）和 `visa.submitApplication`（匿名灌 PII 列 + 濫用 Stripe 開 session）。用現成的 `checkRateLimit` helper，每條 15 分鐘的工。見 P1-A。
2. **prod 停止對外送 sourcemap** —— 已探針確認 `packgoplay.com/assets/*.js.map` 回 200、1.87 MB，整包 TS/TSX 原始碼含註解可還原。改 `build.sourcemap: 'hidden'` 或在 static 層 404 掉 `.map`。見 P2-A。
3. **把 prod DB runtime 身分降權**（去掉 DROP/CREATE/ALTER/SUPER）—— 已在 DB 硬化批識別，這是把整站爆炸半徑砍掉一大塊的單一動作。見 P2-E。

---

## 一、上一輪（2026-05-14）發現的複驗:全部已修 ✅

| 舊編號 | 內容 | 現況 | 證據 |
|--------|------|------|------|
| P0-1..4 | 四個上傳端點無認證 | ✅ 修 | `avatarUpload.ts:30` requireAuth；`tourImageUpload.ts:130/208` requireAdmin；`pdfUpload.ts:43/86` requireAdmin；`generalImageUpload.ts:106/148` requireAdmin |
| P1-1 | Gmail OAuth token 明文入庫 | ✅ 修 | `gmailOAuth.ts:163-164` encryptToken（AES-256-GCM，同 Plaid） |
| P1-2/3 | inquiries.create* 無限流無 bounds | ✅ 修 | `inquiries.ts:167-171` `.max()` bounds；`:191/255/266` 每 IP + 每 email 限流 |
| P1-4 | newsletter.subscribe 無限流、每次寄信 | ✅ 修 | `newsletter.ts:37` 5/hr 限流；`:69-73` 只對真新訂閱者 notifyOwner |
| P1-5 | internal test token 明文 `===`、無 IP/限流 | ✅ 修 | `_core/index.ts:1234-1236` timingSafeEqual；`:1198-1221` IP allowlist；`:1242-1252` 限流；LOCAL_SCRIPT_TOKEN 獨立密鑰 |
| P1-7 | Google OAuth 無 state（login-CSRF） | ✅ 修 | `googleAuth.ts:82` randomBytes state；`:118` timingSafeEqual；`:110` 用後清 cookie |
| P2-4 | cookie maxAge 365 天 > JWT 14 天 | ✅ 修 | `googleAuth.ts:162` `14 * 24 * 60 * 60 * 1000` |

上一輪的其餘 P2/P3 大多也被吸收（護照加密、redaction、CSP、adminMutation 限流都在）。這輪不重複，只列新面或仍 open 的。

---

## 二、本輪發現（依嚴重度）

### 🟠 P1-A — 多個 public mutation 無 rate limit（濫用 / LLM 燒錢 / email 轟炸 / 匿名 PII 灌入）

authZ 分界本身沒破（admin gating 一致、booking/payment/invoice 全 owner-check），但有一批 `publicProcedure` mutation 會 **寫 DB / 呼叫 LLM / 開 Stripe session / 排程寄信**，卻沒有限流。這是目前最實際、最容易被利用的一類。

| file:line | procedure | 做什麼 | 缺口 |
|---|---|---|---|
| `server/routers/aiQuotes.ts:26` | `generate` | LLM `extractQuoteParams` → PDF → `createAiQuote` → `scheduleQuoteFollowUps(id, input.customerEmail)` | **無限流。** 匿名可燒 LLM、灌 R2 PDF，且**排程寄跟進信到 input 傳進來的任意 email** = 拿你的網域對第三方 email 轟炸。**這條價值最高。** |
| `server/routers/visa.ts:62` | `submitApplication` | `createVisaApplication`（護照/DOB/email/phone PII，護照有加密）+ 開 Stripe Checkout Session | **無限流。** 匿名灌 PII 列 + 濫用 Stripe API 開 session。 |
| `server/routers/translation.ts:56` | `translateBatch` | LLM 批次翻譯 | **無限流，且 `texts: z.array(z.string())` 無 `.max()`** —— array 與單字串都無上限，LLM 成本放大。 |
| `server/routers/translation.ts:40` | `translate` | LLM 單筆翻譯 | 無限流、`text` 無長度上限。 |
| `server/routers/toursRead.ts:363` | `generatePdf` | Puppeteer 出 PDF + R2 上傳 | 無限流，每呼叫吃 CPU + 無限長 R2。 |
| `server/routers/auth.ts:51` | `register` | `createUser`（寫 DB） | **無限流**（就在有限流的 `login` 隔壁）。帳號灌爆 / DB 膨脹。 |

**攻擊者實際怎麼用:** 寫個迴圈 `POST /trpc/aiQuotes.generate`，body 塞 `{ rawRequest: "...", customerEmail: "victim@target.com" }`，每次都排一輪跟進信寄給 victim —— 用 PACK&GO 的寄件網域幫他做 email 轟炸兼燒你 LLM 額度；換 `visa.submitApplication` 就是每秒往 visaApplications 灌幾百列假 PII、順帶對 Stripe 開一堆殭屍 session。

**修:** 每條套現成 `checkRateLimit`（`inquiries.ts` 已是範本，每 IP 5/10min 類）。`translateBatch` 補 `.max()`（array 長度 + 每字串長度）。`aiQuotes.generate` 額外對 `input.customerEmail` 做每 email 限流（跟進信是主要傷害）。約 1.5 小時全上完。

---

### 🟡 P2-A — prod 對外送 sourcemap（整包前端原始碼可還原）—— 已探針確認

- **位置:** `vite.config.ts:220` `build.sourcemap: true`；`:190` 的 `filesToDeleteAfterUpload` 只在 `SENTRY_AUTH_TOKEN` 存在時才刪 map，而 `Dockerfile:36` 的 `RUN pnpm build` 沒有帶 SENTRY_AUTH_TOKEN（Dockerfile 全文無此 ARG/ENV），所以 image build 時 map 沒被刪；`server/_core/vite.ts:78` 的 `express.static` 照送所有檔含 `.map`。
- **探針證據:** `GET https://packgoplay.com/assets/index-BJDbYcre.js.map` → **HTTP 200，1,870,537 bytes**；且 `index-BJDbYcre.js` 尾端帶 `sourceMappingURL=index-BJDbYcre.js.map`。
- **攻擊者實際怎麼用:** 直接下載 `.js.map`，把 minified bundle 還原成帶註解、帶原始變數名、帶內部 API 形狀（tRPC procedure 名、feature flag、client 端驗證邏輯）的 TS/TSX 原始碼 —— 是所有後續攻擊的偵察加速器，也可能洩漏註解裡寫的內部推理 / TODO / 安全控制細節。
- **不是 P0/P1 的理由:** 已掃過送出的 bundle，**沒有私鑰洩漏**（只有 `G-91VLGFSK70` GA measurement id，本來就 public）。所以這是「原始碼偵察」等級，不是「拿到密鑰」等級。
- **修:** 三選一 —— (a) `build.sourcemap: 'hidden'`（照出 map 給 Sentry 上傳，但 bundle 不引用、不隨 image 送）；(b) Docker build 帶入 SENTRY_AUTH_TOKEN 讓 `filesToDeleteAfterUpload` 生效；(c) 在 `serveStatic` 對 `.map` 直接回 404。建議 (a)。

---

### 🟡 P2-B — 兩個 protectedProcedure 寫入缺 owner 檢查（跨用戶分析資料竄改，IDOR-lite）

- **位置:** `server/routers/skills.ts:869` `recordFeedback`、`:882` `recordConversion`。兩者 `protectedProcedure`，吃 client 傳的 `usageLogId: z.number()` 就寫，**沒查該 log 屬不屬於 `ctx.user.id`**。
- **攻擊者實際怎麼用:** 任何登入用戶猜連續 id，往別人的 skill-usage 列灌 feedback/conversion，污染 skill-performance 回饋迴路（那份資料最終會餵 AccountingAgent/InquiryAgent 的 prompt 調校）。
- **嚴重度低:** 只是分析污染，無資料外洩。但值得注意的是 —— 同一輪把 `ai.ts` 的平行版本用 `assertOwnsUsageLogs` 補了，這兩條被漏掉。
- **修:** 套同一個 `assertOwnsUsageLogs`，或降到綁 session token。約 15 分鐘。

---

### 🟡 P2-C — 密碼重設 token 明文入庫（DB 讀取即可在 1 小時窗內用）

- **位置:** `server/db/user.ts:261-270` `setPasswordResetToken` 直接存明文到 `users.resetPasswordToken`；比對是 `db/user.ts:152` `where(eq(users.resetPasswordToken, token))` 的 DB 等值查詢。
- **攻擊者實際怎麼用:** 拿到任一 DB read（backup dump / 臨時 debug dump）即可讀出未過期的重設 token，在 1 小時內接管對應帳號。相較 P1（Gmail token）已改加密，這條漏網。
- **嚴重度低:** 需先有 DB 讀取權（那本身已是重大 compromise），且 token 1 小時過期 + 單次用。屬縱深防禦。
- **修:** 存 `sha256(token)`、比對時 hash 後查（token 是 256-bit 隨機，hash 不影響 UX）。另：`server/auth.ts:139-144` 在 `NODE_ENV==='test' || VITEST` 時把原始 token 塞進回應 —— 確認這兩個 env 在 prod 絕不可能被設。

---

### 🟡 P2-D — prompt-injection 縱深防禦不均勻（部分 agent 只靠 role 分離）

- **現況（好的部分）:** 架構一致把指令放 `role:"system"`、不可信內容放 `role:"user"`，從不把 untrusted text 拼進指令塊。兩個最敏感的 agent 更做到**分隔符包裹 + 反破框**：`inquiryAgent.ts:584-608`（`<CUSTOMER_RAW_EMAIL>` 包裹 + 先 strip 掉客人自帶的同名 tag）、`accountingAgent.ts:309-335`（`sanitizeTxnField` strip 控制字元 + strip tag + 截 500 字）。這是這份 codebase 的黃金範式。
- **缺口:** `reviewAgent`（客人評論文字）、`customerPreferenceExtractor`（原始對話內容）只有 role 分離，沒有 inquiryAgent 那種 tamper-proof 分隔符。`customerPreferenceExtractor.ts:149,160` 看得出作者想過這條邊界但停在 role 分離。
- **殘餘風險有界:** 輸出都是 enum/結構化受限 + 有 human-in-the-loop escalation。屬 defense-in-depth。
- **修:** 把 `sanitizeTxnField` 式的 wrap-and-strip helper 抽出來，套到 reviewAgent 與 customerPreferenceExtractor。

---

### 🟡 P2-E — prod DB runtime 身分等同 root 含 DDL（系統性爆炸半徑，已知）

- **現況:** 2026-07-12 `SHOW GRANTS` 已核實 runtime 身分含 DROP/CREATE/ALTER/CREATE USER/SUPER（見 `docs/agent/60-evidence-and-ops.md` §六）。
- **為什麼列進總評:** 它今天不是活漏洞（本輪沒找到可達注入去觸發它），但它讓任何未來的注入/RCE 從「洩一張表」升級成「DROP 全庫 / 建後門帳號」。這是唯一的系統性放大器。
- **修:** runtime 身分降到最小權限（SELECT/INSERT/UPDATE/DELETE，去 DDL/SUPER/CREATE USER）；DDL 只走短效 migration 身分。這是 top-3 之一。

---

### 🟡 P2-F — 依賴傳遞性 CVE 一批（多數不可達，但該做一次 update pass）

`pnpm audit --prod`：**89 個（1 critical / 30 high / 50 moderate / 8 low）**。逐一評估可達性後，多屬傳遞性、不可達或已被 admin gate 擋住：

| 套件 | 版本 | 告警 | 可達性評估 |
|---|---|---|---|
| drizzle-orm | 0.44.7 | high：SQLi via 未跳脫 identifier（GHSA-gpj5-g38j-94v9，<0.45.2） | **不可達。** 全 repo 無 `sql.identifier()`/`sql.raw()`，user 端排序是 `z.enum` 白名單（`toursRead.ts:108`），無任何 user-controlled identifier。純 hygiene，升 ≥0.45.2。 |
| fast-xml-parser | 5.2.5 | **critical**：entity 編碼繞過 | 傳遞性（aws-sdk S3 用），只 parse 可信的 S3/AWS 回應 XML，非攻擊者可控。低。 |
| multer | 2.0.2 | high：多條 DoS | 上傳端點現已全 requireAdmin，需 admin 認證才可達。升 ≥2.0.3。 |
| axios | 1.12.2 | high：MITM / 憑證洩漏 / ReDoS / proto pollution | server 端對外呼叫（供應商 API）。多需特定 proxy/redirect 設定才觸發，grep 未見 proxy/baseURL 動態 host。升到最新 1.x。 |
| lodash `_.template` | — | high：code injection | **不使用**（grep 零命中）。moot。 |
| nodemailer 7.0.12 / ws / path-to-regexp / basic-ftp | — | high 各一 | 多需特定 raw/config 才觸發或為深傳遞性。低。 |

- **攻擊者實際怎麼用:** 這批大多不是「直接打你的端點」，而是「若你剛好用到那個 code path」。以目前用法多不可達。
- **修:** 排一次 `pnpm update`（drizzle → ≥0.45.2、multer → ≥2.0.3、axios → 最新 1.x、fast-xml-parser 隨 aws-sdk 升）。none 是 drop-everything，但一次清掉能把 audit 噪音降下來、也把「哪天真用到」的風險收掉。

---

### 💭 P3 — nits（有空再修）

- **P3-1** `x-powered-by: Express` header 有送出（prod 探針確認）—— `app.disable('x-powered-by')` 一行去掉框架指紋。
- **P3-2** CSP `script-src` 帶 `'unsafe-inline' 'unsafe-eval'`（`_core/index.ts:217`）—— 移除瀏覽器端主要 XSS 防線，程式碼註解已載明取捨；nonce 化是正解但要動 build。（註:client 端 `dangerouslySetInnerHTML` 全站僅 1 處 `chart.tsx:81`，注入 CSS 變數，非 user 內容 —— XSS 面本身極小。）
- **P3-3** SSRF 面:`server/agents/pdfTextExtractor.ts:29` `downloadPdf` 會抓任意 URL，若 `pdfUrl` 為 user 可控即 SSRF。今天走 admin-gated 的 tour 生成流程，暫低。
- **P3-4** `globalSearch.ts:41/43`、`suppliersRouter.ts:138/343`、`bankTransactionLinks.ts:293` 的 LIKE pattern 未跳脫 `%`/`_` 萬用字元（僅擴大搜尋範圍，全走 bound param 無注入）。對照 `caseFileImport.ts:260` 已正確 `escapeLikePattern`。
- **P3-5** `scripts/*.ts` 的 raw mysql2 SQL 在 sqlRehearsal 登記網之外（都是 parameterized，只是無 EXPLAIN 覆蓋）。
- **P3-6** `/healthz` 回應帶 commit ULID（`_core/index.ts:258`）—— 極輕微版本洩漏，可接受。
- **P3-7** CORS 白名單在 prod 也含 `http://localhost:*`（`corsOrigins.ts:41-44`）—— 實務上無意義 bypass（需攻擊者控制受害者本機 localhost origin），可清掉。

---

## 三、已確認穩固的部分（不用動）

1. **tRPC 分層** —— `_core/trpc.ts` public/protected/admin 三層清楚，adminProcedure 檢 `role !== 'admin'` + mutation 60/min 限流。全 `admin*`/refund/export/delete 名的 procedure 都在 adminProcedure（Explore 全掃無誤設）。
2. **付款信任邊界** —— `bookingsPayment.ts:123` 收費金額 = `booking.depositAmount/remainingAmount`（server DB 算，非 client 傳）；`:116` owner-check；`:212` Stripe idempotencyKey；`:257` session。client 只能傳 `paymentType`。
3. **Stripe webhook** —— `stripeWebhook.ts:46` constructEvent 驗簽；`:66-73` UNIQUE(eventId) 中央冪等。
4. **Plaid / Gmail-push webhook** —— Plaid ES256 JWT + body SHA-256 + replay window（上輪已讚）；Gmail-push（`gmailPushWebhook.ts`）Google OIDC verifyIdToken 驗簽名+aud+exp、assert email_verified、SA，且**設定不全時 fail-closed**（`:114-129`）。
5. **booking/invoice/photos owner-check** —— 每個 ownership-sensitive procedure 都 `userId !== ctx.user.id && role !== 'admin' → FORBIDDEN`（Explore 逐條確認）。
6. **護照加密** —— `db.ts:50-62` 明訂全路徑 encrypt-on-write / decrypt-on-read；UI 多數路徑遮罩（`bookings.ts:923` `••••`）、log 有 redaction（`logger.ts:65-91`）；唯一回傳全碼的 `getOrderPacket`（`bookings.ts:783`）是 adminProcedure 的供應商 manifest，by-design。
7. **注入面** —— raw SQL 全 parameterized（無 `sql.raw/identifier`）、shell path 全 server 生成、fs path 全 sanitized、無 `eval/vm/new Function`。（Explore 全掃）
8. **密碼重設** —— 256-bit 隨機、1 小時過期（`auth.ts:164` 強制）、單次用（`:173` clear）、reCAPTCHA + disposable-domain 擋 + 三層限流 + 防列舉的通用回應。
9. **secrets 衛生** —— git 全歷史 `log -p` 掃 password/token/key 模式：零硬編碼密鑰值；無 `.env` 曾入庫；current tree 無字面 secret；prod bundle 無私鑰（只 public GA id）。
10. **CORS / 安全 header** —— 白名單去萬用字元（`*.fly.dev`/`*.manus.*` 已於 5-17 移除）、CSP/HSTS/X-Frame/nosniff/referrer/permissions-policy prod 全確認送出。

---

## prod 探針證據（唯讀）

```
GET https://packgoplay.com/healthz
→ 200 {"status":"ok","ts":"2026-07-12T20:36:07Z","commit":"01KX9FP4RYS2Z59CQRQGZBJ5G5"}

GET https://packgoplay.com/health
→ 200 {"overall":"ok","checks":{"db":{ok,24ms},"redis":{ok,2ms},"stripe":{ok,223ms},"llm":{ok,232ms}}}
   （all-ok 時不帶 error 明細，無內部洩漏）

HEAD https://packgoplay.com/
→ CSP / HSTS / X-Frame-Options=SAMEORIGIN / X-Content-Type-Options=nosniff /
   Referrer-Policy / Permissions-Policy 全送出；x-powered-by: Express（P3-1）

GET https://packgoplay.com/assets/index-BJDbYcre.js.map
→ 200, 1,870,537 bytes（P2-A sourcemap 外洩，已確認）
GET .../assets/index-BJDbYcre.js  尾端含 sourceMappingURL=index-BJDbYcre.js.map
   bundle 掃 secret：僅 G-91VLGFSK70（GA，public），無私鑰
```

依賴掃描：`pnpm audit --prod` → 89 vulns（1 critical / 30 high / 50 moderate / 8 low），評估見 P2-F。

---

*本審計為 source-code review + prod 唯讀探針，非執行時滲透測試。全程零寫入，未存取任何 PII 或 prod secret 值。機器負載敏感,未跑完整測試套件。*
