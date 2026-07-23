> 【2026-07-12 指揮更正】本檔內「出發後才 recognize/轉 Operating」的信託口徑已撤回(法律定性歸律師/CPA)。現行規則:客戶款項具信託責任,不得僅以出發日推導可提領或可認列;見 CLAUDE.md 紅線 3 與 docs/agent/60-evidence-and-ops.md §7。下方原文僅存設計脈絡,勿據以入帳。

# Email 收據自動收單(proposal + design + playbook)

> 起因(2026-06-15):Jeff 自己拍紙本收據還行,但寄到 Gmail 的收據/發票要手動處理很煩。要讓後台 AI 自動把 Gmail 來的收據接收、讀出金額、排成一筆「待確認支出」給 Jeff 按。

## Jeff 拍板的範圍

- **收哪些**:全部花費都收 — 供應商發票(金宥、雄獅、地接社)＋ 機票、飯店、餐廳、軟體訂閱等所有雜支。
- **收進來放哪**:進後台一個「待確認支出」清單,Jeff 逐筆按確認才入帳。

## 問題

寄到 Gmail 的收據/發票目前全靠人手:轉寄、拍照、打字進帳。Gmail pipeline(gmailPollWorker,每 10 分鐘)已經在收信、分類客人詢問,但不認得「這封是收據」。

## 目標

Gmail 收到收據類的信 → 系統自動:
1. 認出是收據/發票(不是一般信)。
2. 用 LLM(vision)把廠商、金額、幣別、日期、買什麼讀出來。
3. 原始附件(PDF/圖)存 R2。
4. 排成一筆「待確認支出」進後台帳務,Jeff 逐筆按確認才入帳。

## 鐵則:碰到錢,AI 只搬不入帳([[feedback_packgo_admin_ai_boundary]] + [[feedback_packgo_trust_accounting]])

- AI 只做「接收 + 讀出來 + 排好」。**不自己入帳。** 金額對不對、算哪一團、算 Trust(#5442 訂金,出發後才 recognize)還是 Operating(#2174),全由 Jeff 在確認時決定。
- **搬運不生成、100% 正確**:金額/幣別讀不清楚就標「請人工看」,留白,不准猜。
- **絕不碰付款**:只收單歸檔,不發起任何付款/轉帳/刷卡。
- 全部花費都收 = classifier 會比較寬,可能混進訂單確認信、行銷信。沒關係:因為一律 staged 給 Jeff 按,誤判成本低(他在清單裡 reject 即可)。設一個 confidence 門檻,低於就不建卡、只標記。

## 接線(design)

- **分類**:gmailPollWorker 的分類多一類 `receipt`(廠商寄來、帶 PDF/圖附件、有 invoice/receipt/訂單/收據/statement 那種字 + 有金額)。先讀 `server/_core/` 的 Gmail poll + 既有 interaction 分類碼。
- **抽取**:新 extractor,把附件(PDF/圖)丟 LLM vision 讀出 vendor / amount / currency / date / description。多筆品項先抓總額,明細放 description。
- **存檔**:附件存 R2(`server/storage.ts`;進來的附件存取可能跟 reply-attachments 那條共用 plumbing,outgoing vs incoming)。
- **資料表**:先查 `drizzle/schema.ts` + `server/db/accounting.ts` 有沒有現成 expense/AP 表。沒有就加 `pendingExpenses`:id、source、gmailMessageId(**dedup,重複 poll 不重建**)、vendor、amount、currency、receiptDate、description、attachmentKey、status(pending/confirmed/rejected)、linkedTripId(nullable)、account(trust/operating,確認時才填)、createdAt、confirmedAt。
- **後台**:bookkeeping 區加「待確認支出」清單 — 一列一筆,顯示廠商/金額/日期/附件預覽 + 確認(可選團、選 Trust/Operating)/ reject。確認 → 入帳本。
- **i18n**:新字串進 zh-TW + en。

## 非目標

- 自動入帳/自動歸類 Trust vs Operating(永遠 Jeff 確認)。
- 自動付款(永遠不碰)。
- 紙本收據 OCR(Jeff 自己拍那部分這次不做)。

## Rollout

先讓「Gmail 收據 → 抽取 → 進待確認支出清單」這條跑通(供應商發票最準,先驗它),雜支再放寬。tsc 0 錯(OOM 用 `NODE_OPTIONS=--max-old-space-size=6144`)＋ vitest 綠(extractor 用幾張真實收據樣本測金額準度)→ `pnpm ship`(Jeff 放 token,§4.3)。
