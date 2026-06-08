# Tour 詳情頁行動區重設計 — Design（Stage 2 設計）

> 依 [proposal.md](./proposal.md)。所有 code/部署動作需 Jeff 點頭（見 progress.md 的 gate）。

---

## 1. 架構總覽

新增 4 個元件，全部放在既有目錄 `client/src/pages/TourDetailPeony/`（與其他子元件一致，無 `components/tour/`）：

```
index.tsx (orchestrator)
├─ 既有 HeroSection / OverviewSection / ...
├─ TourActionArea.tsx          ← 新。決策+行動區的容器（Spec 條 + 小精靈 + CTA 列）
│   ├─ TourSpecBar.tsx         ← 新。純事實 spec 條
│   └─ TourFitWizard.tsx       ← 新。三題選項小精靈（受控，state 提到 index）
├─ PricingSection.tsx          ← 改。CTA 列：詢問升主、線上預訂降次要
├─ BottomCTA.tsx               ← 改。主鈕改「要報價」開 Dialog；「線上預訂」降次要；電話保留
├─ TourInquiryDialog.tsx       ← 新。詢問表單 Dialog（name+email 必填，帶 wizard + relatedTourId）
└─ WeChatDialog.tsx            ← 新。顯示現有微信 QR 圖
```

**State 單一來源在 `index.tsx`**（見 §6），避免 Spec/Wizard 區與底部固定條各自持有狀態而漂移。

新增純函式放 `client/src/pages/TourDetailPeony/actionArea.helpers.ts`（可單測，不碰 React）：
`deriveNextDeparture`、`deriveFlightInclusion`、`deriveStartingUsd`、`deriveGroupSize`、`buildInquiryInput`。

---

## 2. Spec 條資料來源與衍生（TourSpecBar）

原則：**有資料才顯示 chip，無資料就省略**（不腦補、不留空殼）。資料來自既有的 `trpc.tours.getById`（tour）與 `trpc.departures.list.useQuery({ tourId })`（departures）。

| Chip | 來源 | 衍生規則 | 無資料時 |
|------|------|----------|----------|
| 起價 USD | `tour.price` + `tour.priceCurrency`；或 departures `adultPrice` 最小值 | `deriveStartingUsd`：currency=USD 直接顯示；=TWD 用既有 `formatDualPrice` 取近似 USD（標「約」）。取 open 團期最低 `adultPrice` 與 `tour.price` 的較小者 | 省略 chip |
| 天數 | `tour.duration` / `tour.nights` | `N 天 M 夜`（缺 nights 就 `N 天`） | 省略 |
| 出發城市 | `tour.departureCity` / `tour.departureCountry` | 直接顯示 | 省略 |
| 含/不含機票 | `tour.costExplanation`（JSON included/excluded）、`tour.flights`/`tour.outboundAirline` | `deriveFlightInclusion` → `'included' / 'excluded' / 'unknown'`：included 文字含 `/機票｜airfare｜flight｜機位/i` → 含；excluded 含 → 不含（機票另計）；否則 `unknown` | `unknown` 時省略 chip |
| 小團人數 | `tour.maxParticipants`；或 nextDeparture `totalSlots` | `deriveGroupSize`：有 maxParticipants 顯示「小團 N 人」；否則用 nextDeparture totalSlots | 省略 |
| 下個團期 | departures list | `deriveNextDeparture`：filter `status!=='cancelled' && departureDate>now`，sort asc，取 [0]。顯示日期 +（`status==='confirmed'` 時加「確認出發」badge） | 顯示「團期洽詢」 |

`deriveFlightInclusion` / `deriveStartingUsd` / `deriveNextDeparture` / `deriveGroupSize` 為純函式，於 actionArea.helpers.ts 實作並單測。

---

## 3. 小精靈 → inquiry payload（誠實型別對映）

### 3.1 問題
Q1 選了「結構化」，但既有 `inquiries` 欄位型別放不下質化選項（`drizzle/schema.ts:855-859`）：
- `numberOfPeople: int` — bucket `1-2/3-5/6+` 是區間，塞 int 失真。
- `budget: int` — 設計給金額，放 `經濟/舒適/奢華` 是型別錯置。
- `preferredDepartureDate: timestamp` — `近期/寒暑假/再討論` 是模糊窗，非日期。

**不可為了「重用欄位」而捏造數字**（把「奢華」寫成某個 int）。

### 3.2 解法（誠實的結構化）
對 `inquiries` 加兩個可空欄位（additive migration，低風險，不碰金流）：

```ts
// drizzle/schema.ts，inquiries 表內
relatedTourId: int("relatedTourId"),          // 關聯到 tours.id（Jeff Q1 明確要的關係）
wizardAnswers: json("wizardAnswers"),          // { people, timeframe, budget } 質化選項原樣
```

`json()` 已是本 schema 既有 pattern（`tourDepartures.supplierConfirmations`、`tours.colorTheme`），非新造機制。

`wizardAnswers` 存語意中性 key（非顯示字串），方便日後篩選：
```ts
type WizardAnswers = {
  people: "1-2" | "3-5" | "6+";
  timeframe: "soon" | "school_break" | "discuss";
  budget: "economy" | "comfort" | "luxury";
};
```

天數/目的地不另存（透過 `relatedTourId` JOIN `tours` 即得 `duration`/`destination`，避免去正規化重複）。

### 3.3 雙寫 message
InquiryAgent 只讀 `subject` + `message`（`server/agents/autonomous/inquiryAgent.ts`）。故 `buildInquiryInput` 會把 wizard 答案組成**人類可讀**摘要併入 `message`，agent 與 Jeff 都看得到。範例：

```
[行程詢問] 北海道親子賞雪 5 日（Tour #1234）

人數：3-5 人
出發時間：暑假/寒假
預算等級：舒適

— 由行程頁小精靈帶入 —
```

（注意：上面範例僅文件示意；實際產出文案不得使用破折號，改用括號/冒號。）

### 3.4 CTA → inquiryType
| CTA | inquiryType | subject 前綴 |
|-----|-------------|--------------|
| 要報價 | `general` | `[報價] {tourTitle}` |
| 客製這團 | `custom_tour` | `[客製] {tourTitle}` |

兩者都帶 `relatedTourId` + `wizardAnswers` + message 摘要。

---

## 4. 後端變更

### 4.1 Migration
新增 Drizzle migration（編號接續既有，目前最後是 0077；確認 `drizzle/` 下實際下一號）。內容：對 `inquiries` `ADD COLUMN relatedTourId INT NULL` + `ADD COLUMN wizardAnswers JSON NULL`。Additive、可空、無 default 變更、不碰既有資料。**Jeff 點頭才跑。**

### 4.2 `inquiries.create`（`server/routers/inquiries.ts:122`）
擴充 zod input（維持 name+email 必填不變，Q2）：
```ts
relatedTourId: z.number().int().positive().optional(),
wizardAnswers: z.object({
  people: z.enum(["1-2","3-5","6+"]),
  timeframe: z.enum(["soon","school_break","discuss"]),
  budget: z.enum(["economy","comfort","luxury"]),
}).partial().optional(),
inquiryType: z.enum(["general","custom_tour"]).optional(), // 預設仍 general
```
mutation 內把 `relatedTourId` / `wizardAnswers` / `inquiryType` 一併傳給 `db.createInquiry`。限速（5/10min per IP）與既有驗證不動。

### 4.3 `db.createInquiry`
確認其 insert 會 forward 新欄位（`server/db.ts` 或 domain split 內）。若是 `...input` spread 即自動帶上；若是逐欄位列舉，補上兩個新欄位。實作時 Read 確認，不假設。

---

## 5. 元件規格

### 5.1 TourSpecBar.tsx
- Props：`{ tour, departures, themeColor }`。
- 渲染：水平 chip 列（手機可 wrap，等高、對齊）。每個 chip = icon + label + value，`rounded-lg`，容器 `rounded-xl`。
- 只 render 有值的 chip（§2 規則）。純展示，無互動。

### 5.2 TourFitWizard.tsx
- 受控元件。Props：`{ value: WizardAnswers Partial, onChange, themeColor }`。
- 三列，每列一個 segmented 選項組（人數/時間/預算）。選項用 `<button>`，`rounded-lg`，選中態用 themeColor，未選中態灰底。
- 手機優先：每列選項 `grid grid-cols-3 gap-2`，等寬等高。
- 無自身送出鈕；state 提到 index.tsx，供 CTA 與 Dialog 取用。
- 可全部不選（選填）；不選則 `wizardAnswers` 對應 key 省略。

### 5.3 TourInquiryDialog.tsx
- Props：`{ open, onOpenChange, tour, wizardAnswers, mode: 'quote'|'custom', themeColor }`。
- shadcn `<Dialog>`（primitive 自帶 `p-6`，caller 只給 width override，見 CLAUDE.md §2.5）。`rounded-xl`。
- 內容：頂部顯示 wizard 答案唯讀 chips（讓客人確認）+ 表單：姓名（必填）、email（必填）、電話（選填）、留言（選填，預填摘要可編輯）。輸入框 `rounded-lg`。
- 送出：`trpc.inquiries.create.useMutation()`，payload 由 `buildInquiryInput(tour, wizardAnswers, mode, formFields)` 組。
- 成功態：顯示「已收到，會盡快與你聯絡」+ 關閉；錯誤態：顯示限速/驗證訊息。i18n 全覆蓋。

### 5.4 WeChatDialog.tsx
- Props：`{ open, onOpenChange }`。
- shadcn `<Dialog>`，`rounded-xl`，置中顯示 `/images/qrcode-wechat.png`（`rounded-xl` 圖）+ 一行說明（i18n）。手機可長按存圖。

### 5.5 TourActionArea.tsx（容器）
- Props：`{ tour, departures, themeColor, wizard, setWizard, onInquire(mode), onWeChat }`。
- 版面（手機優先，單欄；桌機可加大留白）：
  1. `TourSpecBar`
  2. `TourFitWizard`
  3. CTA 列：**主** = 要報價（filled, themeColor, `rounded-lg`）、客製這團（filled 次階或 outline 強調）；**輔** = 加微信、打電話（outline, `rounded-lg`）；**次要** = 線上預訂（文字鈕/最低視覺權重，`navigate('/book/:id')`）。
- 容器卡 `rounded-xl`，內距 `p-4`/`p-6`，整齊等高對齊。

---

## 6. 整合點（index.tsx）

```ts
const [inquiryOpen, setInquiryOpen] = useState(false);
const [inquiryMode, setInquiryMode] = useState<'quote'|'custom'>('quote');
const [wechatOpen, setWechatOpen] = useState(false);
const [wizard, setWizard] = useState<Partial<WizardAnswers>>({});

const openInquiry = (mode) => { setInquiryMode(mode); setInquiryOpen(true); };
```
- `<TourActionArea>` 置於 Hero 之後、概覽附近（決策區要早出現），吃上面的 state/handlers。
- `<BottomCTA>` 主鈕改呼叫 `openInquiry('quote')`（取代 `navigate('/book')`）；新增最低權重「線上預訂」次要連結 → `/book/:id`；電話連結保留。
- `<PricingSection>` CTA 列：詢問升主、線上預訂降次要（傳入 `openInquiry`）。
- `<TourInquiryDialog>` 與 `<WeChatDialog>` 在 index.tsx render 一次，吃 open state。

`BottomCTA` 與 `PricingSection` 既有 props 需新增 `onInquire`（與必要時 `onWeChat`）。改動最小化，不動其餘版面。

---

## 7. i18n keys（zh-TW.ts + en.ts，前綴 `tourDetail.action.*`）

```
tourDetail.action.specBar.{ days, nights, from, departFrom, flightIncluded, flightExcluded, groupSize, nextDeparture, confirmed, inquireDeparture }
tourDetail.action.wizard.{ title, peopleLabel, people_1_2, people_3_5, people_6plus,
                           timeLabel, time_soon, time_break, time_discuss,
                           budgetLabel, budget_economy, budget_comfort, budget_luxury }
tourDetail.action.cta.{ requestQuote, customize, addWeChat, callNow, bookOnline }
tourDetail.action.dialog.{ title_quote, title_custom, name, email, phone, note, submit,
                           successTitle, successBody, yourChoices }
tourDetail.action.wechat.{ title, scanHint }
```
所有顯示字串走 `useLocale()` 的 `t()`。**禁止**硬編碼中文（CLAUDE.md §4.1）。zh-TW / en 對稱補齊。

---

## 8. RWD / 無障礙 / 整齊

- 手機優先：Spec chips wrap 等高；wizard 每列 `grid-cols-3` 等寬；CTA 手機直排、桌機可橫排，按鈕等高。
- 像素對齊：chip 基線對齊、CTA 等高、卡片邊緣對齊（整齊鐵律）。
- 選項鈕加 `aria-pressed`；Dialog 用 shadcn 內建 focus trap；圖片有 alt。
- 圓角：卡 `rounded-xl`、鈕 `rounded-lg`、輸入 `rounded-lg`、QR 圖 `rounded-xl`。

---

## 9. 測試計畫（Vitest）

**純函式（actionArea.helpers.ts）— 主要覆蓋面：**
- `deriveNextDeparture`：未來/過去/全取消/confirmed badge/空陣列。
- `deriveFlightInclusion`：included 命中、excluded 命中、都無 → unknown。
- `deriveStartingUsd`：USD 直顯、TWD 轉近似、取 departures 最低。
- `deriveGroupSize`：maxParticipants 優先、退而用 totalSlots、皆無 → null。
- `buildInquiryInput`：quote vs custom 的 inquiryType/subject、wizardAnswers 帶入、message 摘要含三選項且**不含破折號**、relatedTourId 帶入、缺選項時省略 key。

**後端：** 擴充 `inquiries.create` 測試（若無則新建）：接受 `relatedTourId`/`wizardAnswers`、預設 inquiryType、name+email 仍必填、限速不變。

**元件（選配，視時間）：** `TourFitWizard` 點選改 state；`TourInquiryDialog` 必填驗證與成功態。

**驗收：** `tsc --noEmit` 0 error（OOM 用 `NODE_OPTIONS=--max-old-space-size=6144`）；手機/桌機視覺（preview）截圖；圓角/整齊/i18n 自查。

---

## 10. 交接
任務拆解見 [tasks.md](./tasks.md)，總覽/gate 見 [progress.md](./progress.md)。
