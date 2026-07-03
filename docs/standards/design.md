# PACK&GO 前端設計規範（全文）

> 從 CLAUDE.md v1.3 抽出（原 §2、§4.1、§5.1）。CLAUDE.md 只留紅線摘要，細節以本檔為準。
> 適用：packgoplay.com 網站 UI（client/src）。客人 PDF 文件的設計規範在 memory 層與各 packgo-* skill 內，不在本檔。
> 重要：subagent 看不到 Jeff 的 memory。派 UI 任務給 subagent 時，把本檔路徑放進 prompt。

## 1. 圓角規範（紅線級，違反即打回）

全站所有可見 UI 元素必須有圓角。唯一例外：全寬 Hero 背景圖（`absolute inset-0`）。

| 元素 | Class | 備註 |
|------|-------|------|
| 行程卡片、目的地卡片 | `rounded-xl` | 12px |
| 輸入框 input/select/textarea | `rounded-lg` | 8px |
| 一般按鈕 | `rounded-lg` | 禁止搜尋按鈕用 `rounded-full` |
| 頭像 | `rounded-full` | 唯一合法的 full |
| 搜尋框整體容器 | `rounded-3xl` + `overflow-hidden` | 24px |
| Dialog / Modal | `rounded-xl` | |
| 卡片內圖片 `<img>` | `rounded-xl` | 必加，最常漏 |
| Badge / Tag | `rounded-md` | 6px |
| AI 聊天氣泡 | `rounded-xl` | |

自檢指令（交付前跑）：
```bash
grep -rn "object-cover" client/src --include="*.tsx" | grep -v "rounded"
# 有輸出 = 有漏，逐一修
```

## 2. 整齊與密度（紅線級，和圓角同級）

- 像素對齊：同一行的元素 baseline 對齊；卡片網格用一致的 gap，不手調個別 margin。
- 密度節奏：一個區塊內不可同時出現「太擠」和「太空」。ragged（參差）或不一致間距 = AI 感，會被 Jeff 打回。
- 極簡與黑白是 Jeff 刻意的 art direction，不是沒做完。不要主動「豐富化」或加彩色裝飾。

## 3. 色彩 / 字體 / 間距

```css
--primary: #0D9488;      /* Teal-600 品牌主色 */
--background: #FFFFFF;
--foreground: #111827;   /* Gray-900 */
--card: #F9FAFB;         /* Gray-50 */
```

- 標題 h1-h3：Noto Serif TC，`font-bold` 或 `font-semibold`
- 內文：Inter
- 搜尋欄欄位間距 `gap-4` 起；卡片內 padding `p-4`/`p-6`；頁面區塊 `py-16`/`py-20`

## 4. Sheet / Dialog padding（三次踩坑的定案）

核心：primitive 已包 padding，caller 不要再加。

| 容器 | Primitive 自帶 | Caller 只寫 |
|------|----------------|-------------|
| `<SheetContent>` | `px-6` + `gap-4` | `w-full xl:max-w-5xl xl:rounded-l-xl overflow-y-auto` |
| `<SheetHeader>` / `<SheetFooter>` | `py-4` | 需要才加 `border-b` |
| `<DialogContent>` | `p-6` 全包 | width override 如 `max-w-2xl` |

禁止：
- Caller 在 Sheet body 加 `px-*`（double-pad）
- 用 `2xl:` breakpoint 控 Sheet 寬（Jeff 的 MacBook 1440px，`2xl`=1536 永不觸發；一律 `xl:`）
- Body wrapper 自控 padding（primitive 沒 horizontal 就會字貼牆）

新 overlay primitive 上線前四點檢查：twMerge 跨 breakpoint 不會 merge、實際 1440px 驗證、清 Service Worker + cache 再看 prod、所有 caller 掃一遍。

## 5. 前端禁止模式

```tsx
// ❌ 可見元素無 rounded-*
<div className="bg-white border">...</div>

// ❌ 硬編碼中文字串（動態資料庫內容除外）
<p>選擇日期</p>            // ✅ 應為 {t('selectDate')}，key 加進 client/src/i18n/zh-TW.ts + en.ts

// ❌ 直接 axios / fetch
import axios from 'axios'   // ✅ 一律 trpc.*.useQuery / useMutation

// ❌ render 中創建不穩定引用
const { data } = trpc.items.get.useQuery({ ids: [1, 2, 3] })  // 每次 render 新陣列，抽成常數或 useMemo

// ❌ Wouter Link 內嵌 <a>
<Link><a href="...">文字</a></Link>
```

- 新增 top-level 路由區段必須同步加進 `server/_core/knownRoutes.ts`（SPA whitelist，注意是 server 端檔案，改了要隨下次部署才生效），否則直開 / 重整 404。

## 6. 「有直角元素」的排查順序

1. 搜尋框三個輸入欄位是否都 `rounded-lg`
2. 卡片圖片（object-cover）是否 `rounded-xl`
3. AI 聊天氣泡 `rounded-xl`
4. Dialog / Modal `rounded-xl`
5. 按鈕 `rounded-lg`（不是 full，除非頭像）
