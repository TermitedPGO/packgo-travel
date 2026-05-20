# PACK&GO 旅行社 — AI 開發 Context 文件

> **重要：** 這是給 AI 助手（Claude / Manus）的永久記憶文件。每次開始新任務前，請先閱讀此文件，確保所有決策與既有規範一致。

---

## 一、專案基本資訊

| 項目 | 值 |
|------|-----|
| 專案名稱 | PACK&GO 旅行社 |
| 技術棧 | React 19 + Tailwind 4 + tRPC 11 + Drizzle ORM + MySQL |
| 部署網域 | packgo09.manus.space |
| 主要語言 | 繁體中文（預設）、英文 |
| 用戶角色 | `user`（一般會員）、`admin`（旅行社業主） |

---

## 二、設計規範（Design Rules）

### 2.1 圓角規範 — **最高優先級，絕對不可違反**

> **全站所有可見 UI 元素必須有圓角。唯一例外是全寬 Hero 背景圖片（`absolute inset-0` 的背景圖）。**

| 元素類型 | Tailwind Class | 說明 |
|----------|----------------|------|
| 行程卡片、目的地卡片 | `rounded-xl` | 12px |
| 輸入框（input, select, textarea） | `rounded-lg` | 8px |
| 一般按鈕 | `rounded-lg` | 8px，**禁止用 `rounded-full` 在搜尋按鈕** |
| 頭像圖片 | `rounded-full` | 50% |
| 搜尋框整體容器 | `rounded-3xl` + `overflow-hidden` | 24px |
| Dialog / Modal | `rounded-xl` | 12px |
| 卡片內圖片（`<img>`） | `rounded-xl` | 必須加，不可省略 |
| Badge / Tag | `rounded-md` | 6px |
| AI 聊天氣泡 | `rounded-xl` | 12px |

**常見錯誤（禁止）：**
- `rounded-none` 或不加任何 rounded class 在可見元素上
- DateRangePicker 按鈕使用 `rounded-full`（應用 `rounded-lg`）
- 卡片圖片 `<img>` 沒有 `rounded-xl`
- 搜尋框三個輸入欄位圓角不一致

### 2.2 色彩規範

```css
/* 品牌主色 */
--primary: #0D9488;  /* Teal-600 */

/* 背景 */
--background: #FFFFFF;

/* 文字 */
--foreground: #111827;  /* Gray-900 */

/* 卡片背景 */
--card: #F9FAFB;  /* Gray-50 */
```

### 2.3 字體規範

- **標題（h1-h3）：** Noto Serif TC（serif 風格，旅遊質感）
- **內文（body）：** Inter（清晰易讀）
- **中文標題字重：** `font-bold` 或 `font-semibold`

### 2.4 間距規範

- 搜尋欄各欄位間距：`gap-4` 以上
- 卡片內部 padding：`p-4` 或 `p-6`
- 頁面區塊間距：`py-16` 或 `py-20`

---

## 三、架構決策（Architecture Decisions）

### 3.1 前端架構

- **路由：** Wouter（非 React Router）
- **狀態管理：** tRPC + React Query（無 Redux / Zustand）
- **UI 元件庫：** shadcn/ui（從 `@/components/ui/*` 引入）
- **圖示：** lucide-react
- **Markdown 渲染：** `<Streamdown>` 元件（從 `streamdown` 引入）

### 3.2 後端架構

- **API 層：** tRPC（所有 API 在 `server/routers.ts`，超過 150 行時拆分到 `server/routers/`）
- **資料庫：** MySQL via Drizzle ORM（schema 在 `drizzle/schema.ts`）
- **認證：** Manus OAuth（`protectedProcedure` 保護需登入的 API）
- **Admin 保護：** 使用 `adminProcedure`（檢查 `ctx.user.role === 'admin'`）
- **Admin Rate-Limit：** 自動套用 — `adminProcedure` middleware 在 `server/_core/trpc.ts:33-66` 已包含 60 req/min throttle（per-admin user，QA audit 2026-05-11 Phase 6 P0）。Queries 不節流。新增 admin router 時無需手動加 rate-limit。
- **檔案儲存：** S3（`server/storage.ts` 的 `storagePut`）
- **AI 調用：** `server/_core/llm.ts` 的 `invokeLLM`（**只在 server 端調用**）

### 3.3 AI 行程生成架構

```
WebScraperAgent → ContentAnalyzerAgent → [並行] ColorThemeAgent + ImagePromptAgent
  → [並行] ImageGenerationAgent + ItineraryAgent + CostAgent + NoticeAgent + HotelAgent + MealAgent + FlightAgent
```

- **進度追蹤：** BullMQ Queue + Redis，前端輪詢（每 3 秒）`trpc.tours.getGenerationStatus`
- **目標生成時間：** < 120 秒
- **LLM 快取：** 24 小時（相同 prompt hash 直接返回快取）

### 3.4 多語言架構

- **i18n 框架：** 自定義（`client/src/locales/`）
- **語言檔案：** `zh-TW.ts`（預設）、`en.ts`
- **使用方式：** `const { t } = useTranslation()` → `t('key')`
- **禁止：** 在 JSX 中直接硬編碼中文字串（動態資料庫內容除外）

---

## 四、禁止事項（Forbidden Patterns）

### 4.1 前端禁止

```tsx
// ❌ 禁止：直角元素
<div className="bg-white border">...</div>  // 缺少 rounded-*

// ❌ 禁止：搜尋按鈕用 rounded-full
<Button className="rounded-full">搜尋</Button>

// ❌ 禁止：卡片圖片沒有圓角
<img className="object-cover w-full h-48" src={...} />

// ❌ 禁止：硬編碼中文字串
<p>選擇日期</p>  // 應使用 t('selectDate')

// ❌ 禁止：直接引入 axios 或 fetch
import axios from 'axios'  // 應使用 trpc.*.useQuery/useMutation

// ❌ 禁止：在 render 中創建不穩定引用
const { data } = trpc.items.get.useQuery({ ids: [1, 2, 3] })  // 每次 render 新陣列

// ❌ 禁止：在 Link 內嵌套 <a>
<Link><a href="...">文字</a></Link>
```

### 4.2 後端禁止

```ts
// ❌ 禁止：在前端調用 LLM
import { invokeLLM } from '../_core/llm'  // 只能在 server 端

// ❌ 禁止：在資料庫存儲檔案 bytes
content: blob('content')  // 應存 S3 URL

// ❌ 禁止：硬編碼 port
app.listen(3000)  // 應使用 process.env.PORT

// ❌ 禁止：在 publicProcedure 做管理員操作
// 應使用 adminProcedure

// ❌ 禁止：在 admin router 重新定義自己的 procedure（繞過 rate-limit）
//   應直接 import { adminProcedure } from "../_core/trpc"
//   （自動套 60 req/min/admin throttle + role check）

// ❌ 禁止：在 server/_core/* 或 server/agents/autonomous/* 用 console.*
//   應使用 import { logger } from "./logger"（相對路徑）
//   logger.info({ event, ...fields }, "message")
//   logger.error({ err }, "message")
//   （剩餘 ~1,250 sites 在 server/routers/* + services/* + 根目錄
//    server/*.ts，Wave 4 Module 4.24 集中遷移；見
//    docs/refactor/wave-4-deferrals.md）

// ❌ 禁止：直接讀寫 `passportNumber` 未經加密
//   bookingParticipants.passportNumber 與 visaApplications.passportNumber
//   一律經 server/_core/passportEncryption.ts 的 encryptPassport /
//   decryptParticipantRow / decryptVisaApplicationRow 進出。任何
//   db.insert(...).values({passportNumber: input.passportNumber}) 或
//   直接 SELECT 後返回，都會把明文寫入磁碟。
//
//   ✅ 正確：所有讀寫走 server/db.ts 已包好的函式
//     await db.createVisaApplication({passportNumber, ...})  // 自動加密
//     const app = await db.getVisaApplicationById(id)        // 自動解密
//     await db.replaceBookingParticipants(bookingId, ...)    // 自動加密
//     const ps = await db.getBookingParticipants(bookingId)  // 自動解密
//   （v2 Wave 1 Module 1.8；同套 AES-256-GCM envelope 與 Gmail / Plaid
//   tokens 共用，見 server/_core/tokenCrypto.ts）
```

---

## 五、常見問題修復模式

### 5.1 圓角問題

當用戶說「有直角元素」時，按以下順序檢查：
1. 搜尋框三個輸入欄位（出發地、關鍵字、出發時間）是否都是 `rounded-lg`
2. 卡片圖片（`object-cover`）是否有 `rounded-xl`
3. AI 聊天氣泡是否有 `rounded-xl`
4. Dialog / Modal 是否有 `rounded-xl`
5. 按鈕是否有 `rounded-lg`（不是 `rounded-full`，除非是頭像）

**修復工具：**
```bash
# 找出所有 object-cover 但沒有 rounded 的圖片
grep -rn "object-cover" client/src --include="*.tsx" | grep -v "rounded"
```

### 5.2 i18n 問題

當用戶說「英文版顯示中文」時：
1. 找到元件中的硬編碼中文字串
2. 在 `zh-TW.ts`、`en.ts` 中加入對應翻譯
3. 將 JSX 中的中文字串替換為 `{t('key')}`

### 5.3 API 錯誤

- `UNAUTHORIZED`：需要登入，前端應跳轉到 `getLoginUrl()`
- `FORBIDDEN`：需要 admin 角色
- `NOT_FOUND`：資源不存在，顯示 404 頁面

---

## 六、關鍵檔案路徑

| 功能 | 檔案 |
|------|------|
| 資料庫 Schema | `drizzle/schema.ts` |
| tRPC 路由（composition shell） | `server/routers.ts` (~283 LOC, 從 10,130 拆來) |
| tRPC 路由（per-domain） | `server/routers/<domain>.ts` × 40 個 sub-routers（refactor 2026-05-19） |
| 資料庫查詢 | `server/db.ts` |
| Stripe webhook + idempotency | `server/_core/stripeWebhook.ts` + `server/_core/stripeWebhookIdempotency.ts` + table `stripeWebhookEvents`（refactor Phase 2） |
| Supplier sync (Lion + UV) | `server/services/supplierSync/{lion,uv,shared,reporting,index}.ts`（refactor Phase 5A） |
| Passport-at-rest 加密 | `server/_core/tokenCrypto.ts`（AES-256-GCM 通用 envelope）+ `server/_core/passportEncryption.ts`（passport-shape helpers）+ migration `drizzle/0078_passport_encryption.sql`（widen 50→255）+ `server/scripts/backfill-passport-encryption.ts`（idempotent 一次性回填，post-deploy 用 `fly ssh console` 執行；audit-log `passport_backfill_run` 寫入 `adminAuditLog`）— `bookingParticipants.passportNumber` + `visaApplications.passportNumber` 寫入前用 `encryptPassport` 加密，讀出時用 `decryptParticipantRow` / `decryptVisaApplicationRow` 解密。Legacy 明文行靠 `decryptToken` 的 no-prefix fallback 繼續可讀，直到 backfill 跑完。v2 Wave 1 Module 1.8，2026-05-20 |
| Sentry 觀測（server + client） | `server/_core/sentry.ts` + `client/src/_core/SentryBoundary.tsx`（v2 Wave 1 Module 1.1，2026-05-19） |
| Pino 結構化日誌 | `server/_core/logger.ts` + `server/_core/correlationId.ts`（v2 Wave 1 Module 1.2，2026-05-20；critical-path subset 已遷，剩餘 sites 待 Wave 4 Module 4.24） |
| 深度健康檢查 + UptimeRobot | `server/_core/healthCheck.ts` + `/health` Express route + `system.health` tRPC query（DB+Redis+Stripe+LLM ping，Stripe 5min / LLM 1h 快取，v2 Wave 1 Module 1.3，2026-05-20） |
| PostHog 轉換漏斗分析 | `client/src/_core/analytics.ts`（posthog-js + type-safe `track()` 5 events: tour_view / search / booking_start / booking_step / booking_complete；env-gated `VITE_POSTHOG_KEY`；person_profiles=identified_only；autocapture 關閉；URL PII strip；v2 Wave 1 Module 1.4，2026-05-20） |
| LLM 調用 | `server/_core/llm.ts` |
| S3 儲存 | `server/storage.ts` |
| 認證狀態 | `client/src/_core/hooks/useAuth.ts` |
| 路由設定 | `client/src/App.tsx` |
| 全域樣式 | `client/src/index.css` |
| i18n 繁中 | `client/src/locales/zh-TW.ts` |
| i18n 英文 | `client/src/locales/en.ts` |
| AI 生成主控 | `server/agents/masterAgent.ts` |
| 進度追蹤 | `server/agents/progressTracker.ts` |
| 行程詳情頁 | `client/src/pages/TourDetailPeony.tsx`（v2 backlog: 拆 3,827 LOC） |
| 管理後台行程 | `client/src/components/admin/ToursTab.tsx` + `client/src/components/admin/tours/*` sub-views |
| 管理後台 agent | `client/src/components/admin/AutonomousAgentsTab.tsx` (73 LOC) + `client/src/components/admin/agents/*` sub-views（refactor Phase 5B） |
| 行程編輯對話框 | `client/src/components/admin/TourEditDialog.tsx` |
| Refactor 文檔 | `docs/refactor/{audit,plan,progress,completed}.md` + `docs/refactor/tasks/phase-*/*.md` |

---

## 七、測試規範

- **測試框架：** Vitest
- **測試檔案位置：** `server/*.test.ts`（後端）
- **執行測試：** `pnpm test`
- **覆蓋範圍：** 業務邏輯（AI 生成、支付、搜尋、多語言）
- **禁止：** 在測試中插入真實資料到資料庫

---

## 八、Checkpoint 規範

每次完成以下任一事項後，**必須**儲存 Checkpoint：
- 新功能完成
- 重大 Bug 修復
- 設計大幅調整
- 資料庫 Schema 變更

**Checkpoint 前必須確認：**
1. TypeScript 0 errors（`pnpm build` 通過）
2. 所有新功能有對應的 Vitest 測試
3. todo.md 中已完成的項目標記為 `[x]`

---

## 九、Vibe Coding Workflow（2026-05-18 加，源自程序员老王 YouTube 影片，Jeff 認同）

> 「Vibe Coding 不是直接讓 AI 寫，是先逼自己（用 AI 協助）把意圖拆清楚到不能再拆，才讓 AI 寫。」
> 這套 workflow 用於避免「改 A 壞 B、最後幾百萬 token 後代碼變垃圾場」。

### 9.1 任何 feature ≥ 30 行代碼必走 4 階段

每個 feature 在 `docs/features/<feature-name>/` 建立：

```
docs/features/<feature-name>/
├── proposal.md     ← Stage 1: 需求文件
├── design.md       ← Stage 2: 概要+詳細設計（模組劃分、依賴關係）
├── tasks/
│   ├── module-1.md ← Stage 3: 每模組獨立 checklist
│   ├── module-2.md
│   └── ...
├── progress.md     ← Stage 3: 總覽（給監工 agent 看）
└── (實作完成後)
```

**Stage 1-3 跑完才能進 Stage 4 (coding)。** 4 階段間建議**換新對話**，舊資訊靠文件交接。

### 9.2 每次 prompt 必有 4 部分

跟 AI（包括我 Claude）發任何任務，prompt 應該結構化：

1. **目標**（Goal）— 想達成什麼
2. **輸入**（Input）— 既有檔案、限制、上下文
3. **輸出**（Output）— 寫到哪、什麼格式
4. **步驟**（Process）— 含「請主動發問，不要猜測我的意圖」

Jeff 一句帶過時，Claude **應該主動補齊另 3 部分後再執行**，不要腦補。

### 9.3 讓 AI 主動發問

任何不確定處用提示詞：
> 「不了解 XX，請使用提問的方式幫我確定需求。任何不明確的地方都必須向我提問，不要猜測。」

對應 Claude Code 的 `AskUserQuestion` 工具 — **遇到 ambiguous 就用，不要心存「先做做看」**。

### 9.4 監工 agent + 子 agents 並行架構

複雜任務（多模組同步開發）用：
- **主對話**只跑「監工 agent」— 看 progress.md，spawn 子 agents
- **每個子 agent** 透過 `Agent tool` 並行，獨立上下文，只看自己模組的 `task.md` + `design.md`
- **主對話絕不看實作細節** — 只審結果

對應到 PACK&GO 既有 autonomous agents：InquiryAgent 應作主 agent，spawn 子 agent 執行 skill（例如 `packgo-tour-comparison`），不要塞進 InquiryAgent 自己的上下文。

### 9.5 強型別 + linter + tests 三件套（強制）

Python 用 mypy + ruff + pytest；PACK&GO 是 TS 所以：
- **tsc --noEmit** 必過（commit 前跑，OOM 時用 `NODE_OPTIONS="--max-old-space-size=6144"`）
- **Vitest 必有** — 每模組對應 `.test.ts`，新功能寫測試**不是 optional**
- ESLint / Prettier 規範（待補）

### 9.6 紅線（違反就要回頭補）

- ❌ ship code 沒寫對應 Vitest
- ❌ 一個檔案 > 300 行還沒拆模組
- ❌ commit 前沒跑 tsc
- ❌ session > 80 turns 還在同一對話線 — 該開新 session 用文件交接
- ❌ 用 Edit 大改後沒 Read 一次驗證
- ❌ AI 主動發問被跳過、用腦補代替

### 9.7 何時開新對話

- Stage 1→2、2→3、3→4 任一階段交接時
- session turns > 80
- 換完全不同的 feature / 主題
- token 開始炸（cost meter 飆）

---

## 十、版本歷史

| 版本 | 日期 | 主要變更 |
|------|------|----------|
| 1.0 | 2026-03-26 | 初版，整合所有既有設計決策和禁止事項 |
| 1.1 | 2026-05-18 | 加第九章 Vibe Coding Workflow（4 階段 + 監工子 agent + 紅線） |
