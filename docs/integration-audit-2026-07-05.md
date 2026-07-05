# 外部服務清理審查 — 給 Fable 決定(2026-07-05)

> 起因:Jeff 看登入器一堆服務(TiDB / Upstash / R2 / Fly / Claude / Sentry / UptimeRobot / PostHog...),問「我真的需要這麼多 stuff?」。Opus 掃 code + env 面,分類哪些是死的/半掛的/真活的。**本檔只做判斷輔助,任何砍帳號/砍 code 等 Fable 拍板。** Jeff 已喊暫停,明天由 Fable 逐項決定。

## Fable 決定清單(逐項 yes/no)

| # | 項目 | 建議 | 動作規模 | 風險 |
|---|------|------|----------|------|
| A | Manus / Forge 全鏈死 code + secrets 拔除 | **建議做** | 中(跨 6+ 檔)| 低,但含一個 auth 字串要先查 |
| B | PrintFriendly 帳號 + secret + 殘測拔除 | **建議做** | 小 | 極低 |
| C | Replicate 帳號 + secret 拔除 | **建議做** | 極小(code 本來就沒接)| 極低 |
| D | SendGrid:查 Fly secrets 有沒有設,沒設就砍帳號 | **Jeff 查一下** | 查證,非改 code | 低 |
| E | Plaid / OpenAI / Firecrawl 確認是活的別誤砍 | **不要砍** | 無 | — |
| F | PostHog 留不留 | Jeff 一句話 | 無 | — |

判斷方法:Opus 本機無 DATABASE_URL、看不到 Jeff 的 Fly secrets 實值,所以「key 有沒有設」只能標「去查」;但「code 有沒有在用」可以從 codebase 確定,以下證據皆附 `檔案:行號`。

---

## 一、確定死的,可以直接清掉(code 根本沒在用)

### A. Manus / Forge — 這 app 的前世,已整個搬離

這個 app 本來長在 Manus 平台上,後來把 storage / LLM / map / 圖片生成全部搬去直連(Anthropic / Google / R2 / OpenAI)。現在 Manus 只剩殘骸:

- `server/_core/storage.ts:3`、`server/_core/llm.ts:3`、`server/_core/map.ts:4`、`server/_core/imageGeneration.ts:4` — 開頭都註明「Replaces the legacy Manus Forge ...」。
- `server/_core/dataApi.ts:4` — 整檔「DEPRECATED in the Fly.io deployment ... 保留 export 只為讓 import resolve」= 空殼。
- `server/agents/claudeAgent.ts:154` — 一段 `forgeAvailable = !!(BUILT_IN_FORGE_API_KEY && BUILT_IN_FORGE_API_URL)` 的 LLM fallback;prod 直連 ANTHROPIC_API_KEY,這條永遠不觸發。
- `server/_core/env.ts:25-28` — `forgeApiUrl/forgeApiKey` 欄位,註明「Legacy Manus Forge proxy (deprecated — kept for consumers not yet migrated)」。
- `MANUS_API_KEY` 讀取檔數 = **0**(沒有任何活 code 讀它)。
- `client/src/i18n/en.ts:1754`、`zh-TW.ts:1765` — UI 字串「Login with Manus」/「請使用 Manus 帳號登入」。**這條要先查**:確認沒有真的 Manus OAuth 登入路徑還掛著(相關可疑 env:`OAUTH_SERVER_URL`、`OWNER_OPEN_ID`),再決定拔字串還是連帶拔登入路徑。

動作:
- Fly secrets 拔 `MANUS_API_KEY`、`BUILT_IN_FORGE_API_KEY`、`BUILT_IN_FORGE_API_URL`。
- 砍 Manus 帳號/訂閱(若還有在付)。
- Code cleanup:移除 claudeAgent.ts 的 Forge fallback 分支、env.ts 的 forge 欄位、dataApi.ts 空殼(先確認沒 consumer)、「Login with Manus」i18n(先查 auth)。

### B. PrintFriendly — 純佔位

- 全 codebase **零使用**(grep code 空)。只剩 `server/printfriendly.test.ts` 在測一個沒人用的服務,測試自己 log「PRINTFRIENDLY_API_KEY not configured, skipping」。
- `PRINTFRIENDLY_API_KEY` 讀取檔數 = 0。

動作:砍 PrintFriendly 帳號,拔 `PRINTFRIENDLY_API_KEY`,刪 `server/printfriendly.test.ts`(+ 若有對應 service 檔)。

### C. Replicate — 只在文件裡,沒接進 code

- 唯一提及在 `server/agents/skills/ImageGenerationAgent.SKILL.md`(給 agent 讀的說明文件),**沒有任何 .ts/.tsx 真的 import 或呼叫 replicate**。
- 圖片生成實際走 OpenAI gpt-image-2(見 E)+ Unsplash + Google CSE,沒 Replicate 的份。

動作:砍 Replicate 帳號,拔 `REPLICATE_API_TOKEN`。（SKILL.md 那段要不要改順手處理)

---

## 二、去 Fly secrets 查一眼,沒設就是白掛

### D. SendGrid

- `server/emailService.ts:16,48,56` — 邏輯是「有 `SENDGRID_API_KEY` 就用 SendGrid,沒有就退回 Gmail SMTP(`EMAIL_HOST` 預設 `smtp.gmail.com`,即 support@packgoplay.com)」。
- 這是合法的 fallback 設計,不是死 code。但 Jeff 寄客人信若走 Gmail(照 Gmail OAuth 設定判斷應該是),SendGrid 就沒在用。

動作:Jeff 查 Fly secrets 有沒有 `SENDGRID_API_KEY`。沒設 → SendGrid 帳號可砍(code 不用動,fallback 已在)。有設 → 代表在用,保留。

---

## 三、確認是活的,別誤砍(有付費在燒,但是必要的)

### E. 這三個是真的在跑的付費路徑

- **OpenAI** — `server/_core/imageGen.ts:14-17` `new OpenAI()` 打 gpt-image-2 生圖。活的,生圖就收錢。
- **Firecrawl** — `server/services/competitorScraperService.ts:276` 真的 `fetch("https://api.firecrawl.dev/v1/scrape")` 爬競品。活的付費路徑。
- **Plaid** — 抓銀行流水做 P&L 兩本帳(見 memory `project_bookkeeping_two_ledgers`)。沒設 key 會「skipping」(`server/plaidSyncWorker.ts:40`),所以只要對帳有在動就是有設 = 活的。

### F. 真正每月/按量燒錢的就這幾條

Anthropic(Claude LLM)、OpenAI(生圖)、Firecrawl(爬蟲)、TiDB、Upstash、R2、Fly。Stripe / Square 只有成交才抽成。其餘 Google 系(登入 / CSE / Places / Maps)、reCAPTCHA、Unsplash API、UptimeRobot 都免費或近免費,不構成成本壓力。

截圖那 8 個(TiDB / Upstash / R2 / Fly / Claude / Sentry / UptimeRobot / PostHog)**沒有一個是死的**;6 個是脊椎,Sentry 建議留,PostHog 是唯一「看要不要留」的(接了轉換漏斗,值不值得看你有沒有在看報表)。Jeff 覺得雜是因為「登入的服務多」,不是「都在收錢」。

---

## 附:完整 env 面(app 真正讀的外部 key,去重)

活/必要:`ANTHROPIC_API_KEY` `DATABASE_URL`(TiDB) `UPSTASH_REDIS_URL`/`REDIS_HOST` `R2_*` `GMAIL_OAUTH_*` `GOOGLE_*`(OAuth/CSE/Places/Maps) `OPENAI_API_KEY` `FIRECRAWL_API_KEY` `PLAID_*` `STRIPE_*` `SQUARE_*` `SENTRY_DSN` `RECAPTCHA_SECRET_KEY` `UNSPLASH_*` `JWT_SECRET` `APP_ENCRYPTION_KEY`。

死/待清:`MANUS_API_KEY` `BUILT_IN_FORGE_API_KEY` `BUILT_IN_FORGE_API_URL` `PRINTFRIENDLY_API_KEY` `REPLICATE_API_TOKEN`。

待查:`SENDGRID_API_KEY`(沒設就砍 SendGrid)、`OAUTH_SERVER_URL`/`OWNER_OPEN_ID`(是否 Manus 登入遺留)。

---

## Fable 若拍板要拔 code,建議的執行邊界

- 一個 cleanup commit,只動死 code:Forge fallback（claudeAgent.ts）、env.ts forge 欄位、dataApi.ts 空殼、printfriendly 殘測、Replicate SKILL.md 段落、「Login with Manus」i18n(**先查 auth 路徑**)。
- 不碰 emailService.ts（fallback 是活設計)、不碰任何 E 類活服務。
- 收尾照常:`tsc --noEmit` 0 錯 + 全套 vitest 綠 → commit 上 main,**不 ship**(拔 secret 是 Jeff 在 Fly 手動,拔帳號也是 Jeff)。
- 砍帳號/拔 Fly secret 一律 Jeff 本人做,Opus/Fable 不碰。
