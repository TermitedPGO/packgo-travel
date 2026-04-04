# PACK&GO 旅行社 — AI 開發 Context 文件

> **重要：** 這是給 AI 助手（Claude / Manus）的永久記憶文件。每次開始新任務前，請先閱讀此文件，確保所有決策與既有規範一致。

---

## 一、專案基本資訊

| 項目 | 值 |
|------|-----|
| 專案名稱 | PACK&GO 旅行社 |
| 技術棧 | React 19 + Tailwind 4 + tRPC 11 + Drizzle ORM + MySQL |
| 部署網域 | packgo09.manus.space |
| 主要語言 | 繁體中文（預設）、英文、西班牙文 |
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
- **語言檔案：** `zh-TW.ts`（預設）、`en.ts`、`es.ts`
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
2. 在 `zh-TW.ts`、`en.ts`、`es.ts` 中加入對應翻譯
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
| tRPC 路由 | `server/routers.ts` |
| 資料庫查詢 | `server/db.ts` |
| LLM 調用 | `server/_core/llm.ts` |
| S3 儲存 | `server/storage.ts` |
| 認證狀態 | `client/src/_core/hooks/useAuth.ts` |
| 路由設定 | `client/src/App.tsx` |
| 全域樣式 | `client/src/index.css` |
| i18n 繁中 | `client/src/locales/zh-TW.ts` |
| i18n 英文 | `client/src/locales/en.ts` |
| i18n 西班牙文 | `client/src/locales/es.ts` |
| AI 生成主控 | `server/agents/masterAgent.ts` |
| 進度追蹤 | `server/agents/progressTracker.ts` |
| 行程詳情頁 | `client/src/pages/TourDetailPeony.tsx` |
| 管理後台行程 | `client/src/components/admin/ToursTab.tsx` |
| 行程編輯對話框 | `client/src/components/admin/TourEditDialog.tsx` |

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

## 九、版本歷史

| 版本 | 日期 | 主要變更 |
|------|------|----------|
| 1.0 | 2026-03-26 | 初版，整合所有既有設計決策和禁止事項 |
