# 指揮中心 (Command Center) — Design（§9.1 Stage 2：設計 + 任務切分）

> 上游：`proposal.md`（Stage 1，已 Jeff 拍板）。本文把需求落成**可派工的任務**。
> **組織原則（Jeff 2026-05-30 定）：以「四個頁面」給任務** — 客服 / 報價 / 行銷 / 財務,每條 lane = 指揮中心裡的一個頁面。
> **鐵律**：四個頁面共用**一條脊椎**(同一張審核箱 table + 同一個殼)。DB schema 只能一條 session 動 → **脊椎必須先做、單一 owner**,四個頁面才在上面平行長。

---

## 0. 一句話架構

```
producer(agent / skill / webhook)
   │  draft 出東西、判 riskLevel
   ▼
createApprovalTask({ lane, type, riskLevel, title, payload })   ← 共用 helper
   │
   ▼
approvalTasks  (一張新 table = 審核箱單一真相)
   │
   ▼
指揮中心 tab (AdminV2)  ── 4 個 lane 頁面,各自 filter lane ──
   │  Jeff 看 / 改 / 按
   ▼
approve / reject  ──►  executor(lane-specific)
                         客服 → sendInquiryReply(已寫好)
                         報價 → 出 PDF
                         行銷 → 發布
                         財務 → 只標已讀(永不自動動錢)
```

四個頁面**長得一樣**（同一個審核箱列表元件），差別只在：① filter 哪個 lane、② payload 怎麼預覽、③ approve 後叫哪個 executor。所以**脊椎做一次,四頁面共用**。

---

## 1. 任務地圖（派工總覽）

| # | 任務 | 類型 | 前置 | 可否現在派 | 碰 DB schema |
|---|------|------|------|-----------|-------------|
| **S** | **脊椎**：審核箱 table + 殼 + 共用 helper + tRPC router | 必做、單一 owner | — | ✅ **現在派** | ✅ **唯一一條** |
| **P1** | **客服頁**（pilot）：InquiryAgent 草稿 → 審核箱 → 一鍵送（吃已寫好的 `sendInquiryReply`） | 頁面 | S | ⏳ S 落地後 | ❌ |
| **P2** | **報價頁**：`packgo-quote` 草稿 → 審核箱 → 核單價 → 出 PDF | 頁面 | S + supplier-uv 第二輪 | ⏳ blocked | ❌ |
| **P3** | **行銷頁**：`packgo-xiaohongshu`/`wechat-oa` 草稿 → 審核箱 → 發布 | 頁面 | S + 各平台 API 評估 | ⏳ blocked | ❌ |
| **P4** | **財務頁**：對帳/淨利異常 → 審核箱當警示（永不自動動錢） | 頁面 | S + PKG-C（淨利單一真相） | ⏳ blocked | ❌ |

**派工順序**：先 **S**（單一 owner 建 table + 殼）→ 驗證合併 → 再 **P1 客服**當 pilot 跑通整條脊椎 → P2/P3/P4 等各自前置解除後複製 P1 的模式。

> P2/P3/P4 現在「blocked」是因為各有外部前置（供應商第二輪 / 平台 API / PKG-C），不是技術不行。脊椎做好後它們就是「複製 P1、換 producer + executor」。

---

## 2. 脊椎任務 S（Phase 0）— 單一 DB owner，現在派

### S-1. 審核箱 table（`drizzle/schema.ts` — 本 feature 唯一一處 schema 變更）

依 `stripeWebhookEvents` 既有慣例（`int autoincrement PK` + `mysqlEnum` + `text` 存 JSON + 2nd-arg 建 index）：

```ts
export const approvalTasks = mysqlTable("approvalTasks", {
  id: int("id").autoincrement().primaryKey(),
  // 哪個頁面（Jeff 的四個頁面）
  lane: mysqlEnum("lane", ["cs", "quote", "marketing", "finance"]).notNull(),
  // 細分動作，給 executor 路由用
  taskType: varchar("taskType", { length: 64 }).notNull(), // e.g. "inquiry_reply" / "quote_pdf" / "xhs_post" / "finance_alert"
  // 政策層級（proposal §3）：auto=可批次一鍵、review=逐封審、hard_gate=碰錢/不可逆,強制逐筆確認
  riskLevel: mysqlEnum("riskLevel", ["auto", "review", "hard_gate"]).notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected", "sent", "failed", "expired"]).notNull().default("pending"),
  title: varchar("title", { length: 255 }).notNull(),   // 審核箱列表那行的人話標題
  summary: text("summary"),                              // 選填較長預覽
  payload: text("payload").notNull(),                    // JSON 字串,lane 專屬（草稿內文 / 報價列 / 貼文 / 警示數據 + refs）
  relatedType: varchar("relatedType", { length: 64 }),   // "inquiry" / "booking" / "tour" …（連結用）
  relatedId: varchar("relatedId", { length: 64 }),
  createdBy: varchar("createdBy", { length: 64 }).notNull(), // producer 身份："InquiryAgent" / "packgo-quote" / admin userId
  decidedBy: int("decidedBy"),                           // 按下去那個 admin 的 users.id（nullable）
  decidedAt: timestamp("decidedAt"),
  errorMessage: text("errorMessage"),                    // executor 失敗時
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(), // ⚠️ worker：對齊現有 updatedAt 慣例（是否 .onUpdateNow()）
}, (t) => ({
  idxLaneStatus: index("idx_approvalTasks_lane_status").on(t.lane, t.status),
  idxStatus: index("idx_approvalTasks_status").on(t.status),
  idxCreatedAt: index("idx_approvalTasks_createdAt").on(t.createdAt),
}));
```

+ 對應 migration（worker 用既有 migration 流程產，**不手寫 SQL 亂改**）。

### S-2. 共用 helper `server/_core/approvalTasks.ts`（新檔）

- `createApprovalTask(input): Promise<{ id: number }>` — producer 統一入口，寫一列 pending。
- `decideApprovalTask({ id, decision, decidedBy, editedPayload? })` — approve/reject，approve 時**不在這裡寄信**，只改 status；executor 由 router 層按 lane 叫。
- 寫 / 決策都要 `auditLog`（複用 `server/_core/auditLog.ts`：`action:"approvalTask.create|approve|reject"`, `targetType:"approvalTask"`, `targetId:id`）。
- **Vitest**：建立、決策、audit 有被呼叫（mock db + auditLog）。

### S-3. tRPC router `server/routers/commandCenter.ts`（新檔，掛進 `server/routers.ts`）

全用 `import { adminProcedure, router } from "../_core/trpc"`（自動 rate-limit + role）：
- `list({ lane?, status? })` query — 審核箱列表（四頁面各自帶 lane filter）。
- `stats()` query — 各 lane pending 數、昨晚做了啥摘要（給「狀態」塊）。
- `approve({ id, editedPayload? })` mutation — 改 status → 按 lane 叫 executor。**hard_gate 的 lane 一律逐筆,不准 bulk。**
- `reject({ id, reason })` mutation。
- `bulkApprove({ ids })` mutation — **只允許 riskLevel=auto/review,擋掉 hard_gate**（碰錢/不可逆不准批次）。
- **Vitest**：list filter、bulkApprove 擋 hard_gate、approve 叫對 executor（mock）。

### S-4. AdminV2 殼 + 指揮中心 tab（client）

- `client/src/pages/AdminV2.tsx`：在它的 tab IA 加一個「🎛 指揮中心」頁，lazy import（⚠️ worker：讀實檔確認 IA/PageId 結構再加,**這是四頁面唯一共改的檔,S 做完才有人碰**）。
- `client/src/components/admin-v2/CommandCenter/`（新資料夾）：
  - `CommandCenterTab.tsx` — 殼，3 塊：狀態 / 審核箱(四個 lane 分頁) / 班表。**v1 重點做「審核箱」**，狀態 + 班表先放精簡版。
  - `ApprovalInbox.tsx` — 通用審核箱列表（吃 lane prop），各 lane 頁面共用。riskLevel=auto 顯示「一鍵全送」、hard_gate 強制逐筆確認 dialog。
  - `lanes/` — 每 lane 一個小元件管 payload 預覽 + executor 呼叫（P1–P4 各自填）。
- **i18n**：所有字串走 `t()`（zh-TW + en),**不硬編碼中文**。
- **圓角 / 整齊**：卡片 `rounded-xl`、按鈕 `rounded-lg`、Dialog `rounded-xl`、等高密度（CLAUDE.md §2 紅線）。

### S 邊界（給 worker 的護欄）
- **可動**：`drizzle/schema.ts`(+migration)、`server/_core/approvalTasks.ts`(新)、`server/routers/commandCenter.ts`(新)、`server/routers.ts`(掛 router)、`client/.../CommandCenter/*`(新)、`AdminV2.tsx`(加 1 個 tab)、i18n(加 key)。
- **不可碰**：PKG-B 要刪的 v1 死碼、PKG-C 的財務檔、`emailService.ts` / `inquiries.ts`（那是 P1 客服頁的料,S 不碰）。
- **單一 owner**：只有 S 這條動 schema。派工期間其他條不准碰 `drizzle/schema.ts`。

---

## 3. 客服頁任務 P1（Phase 1 pilot）— S 落地後派

> 為何客服當 pilot：有真資料、乾淨的「草擬→審→送」迴圈、痛點最大、對外依賴最低（proposal §7）。

### P1 的好消息：寄信後端**已經寫好**（只差收編 + 測試）
協調者 2026-05-30 查實碼：`server/emailService.ts` 的 `sendInquiryReply`（品牌信 + SendGrid/SMTP fallback + HTML escape + best-effort boolean）與 `server/routers/inquiries.ts` 的 `addMessage`（admin 回覆→寄信、never throw、status→replied、回傳 `{...created,emailSent}`）**已寫好,目前未 commit 躺在 main 工作區**。P1 worker **接收這份**,不要重寫。

### P1 模組
- **P1-a 收編既有後端**：把那份未 commit 的 `sendInquiryReply` + `addMessage` 寄信收進 P1 worktree,**補上缺的 Vitest**（admin 回覆會寄 / 客人留言不寄 / status→replied / emailSent 回傳;mock emailService + db,§9.6 紅線），跑綠 tsc。
- **P1-b producer**：`server/agents/autonomous/inquiryAgent.ts` 產出 draftReply 後 → `createApprovalTask({ lane:"cs", taskType:"inquiry_reply", riskLevel, title, payload:{ inquiryId, draftBody, customerEmail } })`。
- **P1-c 敏感分級（品質公平不可犧牲）**：醫療 / 緊急 / 政治 / 客訴 / 退款 關鍵字 → `riskLevel:"hard_gate"`（永遠人工逐筆,不准 bulk）;一般 → `"review"`。接 `packgo-customer-service` 既有 escalation 設計。
- **P1-d 客服頁 UI**：審核箱「客服」分頁 = 列草稿 → 點開改內文 → 「一鍵送」/「逐封送」→ `commandCenter.approve` → executor 叫 `sendInquiryReply` + 回寫 `addMessage`。
- **Vitest**：P1-a 的寄信路徑 + P1-c 的敏感分級判定。

### P1 邊界
- **可動**：`inquiryAgent.ts`、`emailService.ts`/`inquiries.ts`（收編既有）、`CommandCenter/lanes/cs*`、客服相關 i18n key。
- **不可碰**：schema（S 已定）、其他 lane 的檔、PKG-B/PKG-C 範圍。
- ⚠️ `InquiriesTab.tsx`(v1) 那 9 行 toast 改動隨 PKG-B 刪除作廢無妨,**不依賴它**。

---

## 4. 報價頁 P2 / 行銷頁 P3 / 財務頁 P4（脊椎複製，待前置解除）

每頁 = 換 producer + executor + riskLevel,**UI 重用 `ApprovalInbox`**。

| 頁面 | producer | executor（approve 後） | riskLevel 預設 | 前置 blocker |
|------|----------|----------------------|---------------|-------------|
| **P2 報價** | `packgo-quote` 拉供應商價草擬 | **出 PDF / 報客人** | **hard_gate**（碰錢 + CST §17550） | supplier-uv 第二輪落地 |
| **P3 行銷** | `packgo-xiaohongshu` / `wechat-oa` 草稿 | 發布（有 API 才自動,否則人工複製） | review | 各平台 API 評估 |
| **P4 財務** | 對帳 / 淨利異常掃描 | **只標已讀 / 留警示,永不自動動錢** | review（警示）| PKG-C 淨利單一真相 |

> P4 吃 PKG-C 的成果：PKG-C 把淨利收斂成 trust-aware 單一真相後,P4 才有「對的數字」可監看。所以 **PKG-C = P4 enabler**。

---

## 5. 排程 / 夜班（reuse，不另起爐灶）

- **複用既有 BullMQ + Redis**（AI 生成已在用,見 CLAUDE.md §3.3）。不引新排程器。
- producer 夜班跑法：BullMQ repeatable job → 產草稿 → `createApprovalTask`（status=pending）。Jeff 早上進指揮中心看 pending。
- Fly.io 上夜班：沿用現有 worker process,**design 不另開新服務**。

## 6. dev 橋接（v1 先 defer）

- proposal 提的「Claude Code 開發 agent 狀態同步進指揮中心」**v1 不做**（dev 半邊靠看板已 ~80% 在跑,只差顯示,非脊椎必需）。
- 留 `lane` enum 之後可加 `"dev"`,table 結構已能容納 → **不擋未來,但 v1 不實作**,避免脊椎肥大。

---

## 7. 需 Jeff 在「合併時」確認的點（不擋派工，merge 前看）

1. **審核箱 table 欄位**：上面 S-1 是依慣例擬的 v1 schema（單一 migration）。worker 實作後,協調者合併前我會把最終 schema 貼給你確認（這是唯一一張新表,值得看一眼）。
2. **客服 auto-send 門檻**：v1 全部 `review`/`hard_gate`（逐筆人工）。哪些未來可降成 `auto`（批次一鍵）= 之後累積信心再開,v1 先不自動送。
3. **報價 hard_gate**：P2 出 PDF/報客人**永遠人工**,已寫死,確認無誤。

---

## 8. 依賴與既有資產
- 基建：AdminV2 shell、tRPC、Drizzle/MySQL、Redis/BullMQ、`auditLog`、logger、Sentry。
- 既有 agents：`server/agents/autonomous/inquiryAgent.ts`（P1 producer）。
- 既有 skills：`packgo-customer-service`（P1 escalation）、`packgo-quote`（P2）、`packgo-xiaohongshu`/`wechat-oa`（P3）。
- 既有後端（P1 直接吃）：`emailService.sendInquiryReply` + `inquiries.addMessage`（已寫,未 commit）。
- enabler：PKG-C（P4 財務單一真相）。

---
_狀態：Stage 2 設計 + 任務切分完成。下一步 → 派**脊椎 S**（單一 DB owner）→ 驗證合併 → 派 **P1 客服 pilot**。P2–P4 待前置解除。_
