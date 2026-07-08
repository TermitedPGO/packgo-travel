# 財務部藍圖(2026-07-08 立案,Jeff 已拍板波次順序)

> 指揮(Fable)撰。願景:AI 財務部 = 三崗位 — 記帳員(看帳)、出納合規(管錢)、財務長(建議花錢)。
> 現況依據:`docs/features/finance-map/current-state.md` + 示意圖(2026-07-08 測繪);核心宣稱經三路 fresh 對抗驗證全 CONFIRMED(Stripe 繞過 Trust 遞延、通道整合現況、死碼 UI)。

## 鐵律(每張派工單開頭複述,與客人文件紅線同級)

1. AI 只看、只算、只建議,永遠不動錢。轉帳/付款/退款/認列確認,每個動作都是 Jeff 按。
2. 建議卡永遠附數據來源,搬運不生成;判斷題(該投資什麼)AI 備料不代判。
3. supplierCost 與任何成本數字永不出現在客人可見面(沿用既有慣例)。
4. Trust 規則(CST §17550)用測試釘死,不靠人記。
5. 所有寫入類動作(認領、認列、標記)留審計軌跡。
6. 零 migration 未經指揮授權;財務表 schema 變更一律先過設計審。

## 要解的四個根問題

①對帳斷層(Emerald PHX 漏單、ORD-0003 取數不一致、prod 現有 3 筆共 $15,422 trust 流入 unmatched)②Trust 合規:Stripe 收款完全繞過遞延機制(已驗證:stripeWebhook 直接 createAccountingEntry income,零引用 trustDeferralService)③損益看不見 ④報稅出口。

不做什麼:不重造會計軟體。權威帳 = Plaid bankTransactions。

通道原則(2026-07-08 Jeff 擴充,開放集不綁死清單):有程式整合的只有 Stripe(客人在站上用 Apple Pay/Google Pay 結帳也是走 Stripe,已覆蓋);其他一切通道 — Square、Zelle、Venmo、PayPal、Apple Cash、微信/支付寶轉帳、支票、電匯、以及未來任何新通道 — 最終都落地成銀行入帳,由 Plaid 收口,F1 掛意義。新通道出現不改架構,只是待認領卡多一種銀行摘要樣式。唯一例外是現金:不入行系統看不見,規矩 = 收現金要嘛存入銀行、要嘛手動記一筆,否則是帳的盲區。

## 波次

### F1 對帳引擎(第一批,等客戶頁 Wave 1 塊A/B 收掉開工)
1. 每筆 bankTransactions 對到來源單據(customOrders/invoices/Stripe payout),對不上浮出「待認領」卡:AI 猜候選(金額吻合未收款訂單 + 時間窗,擴建既有 paymentMatch 看門狗,不新造),Jeff 一鍵認領,絕不自動歸。
2. Stripe 收款統一進認列規則引擎:webhook 不再無條件立即記 income,改走與 Plaid 同一套規則(flag 化;CPA 對 §17550 適用範圍的答案只決定 flag 怎麼設,不改架構)。
3. 雙計防護(驗證新抓的風險):Stripe webhook 記的 income 與該筆錢 payout 落銀行後被 Plaid 再分類,兩路要互認(payout 對映),否則同筆錢記兩次。
4. 衛生:recordPayment 寫死 'square' 回退預設拿掉(prod 僅 2 筆已收款單,回填成本低);Plaid sandbox 殘留 24 條 First Platypus Bank 帳戶清理;3 個死碼財務 UI 元件刪除(FinanceTab/FinanceLanding/BankAccountsTab,fresh 驗證零引用)。
5. 完成判準:月底零手工對帳;每筆入帳要嘛有單、要嘛有待認領卡,不存在第三態。

### F2 Trust 合規結構化
1. unmatched trust 流入必浮出卡(現有 3 筆即實例:進了遞延表但無人知道它等著被 link)。
2. 認列看門狗:該認未認(出發日已過仍 pending)、提前認列、reversal 無理由,都叫。
3. Trust 對帳(computeOutstandingTrust 既有函式)接進 D1 週稽核摘要。
4. featureFlags 收口:trustDeferralService 內 3 個裸 process.env 讀取搬進 featureFlags.ts(驗證發現的拼字風險缺口)。

### F3 看帳
P&L 儀表板從權威帳直接算;每條產品線毛利(接 customOrders supplierCost);月報卡;CPA 年度帳一鍵導出;應付追蹤(供應商 Lion/UV/eChinaTours/簽證,資料源待 Jeff 答 Q4:現行怎麼記)。UI 動工時沿用 FinanceReports.tsx live 路徑,admin 設計系統規範適用。
月結核對儀式(2026-07-08 Jeff 對話定角色):月底 BofA 對帳單 PDF 不是記帳資料來源(那是 Plaid 每日同步的事),是核對文件 — Jeff 丟 PDF,系統比對期初期末餘額與筆數 vs 系統內 Plaid 資料,對得上安靜、對不上出卡(抓 Plaid 漏同步:連線過期/pending 未轉正/帳戶斷連);同時作為 CPA 正式憑據歸檔。

### F4 財務長建議卡
訂閱盤點該砍的、手續費損耗(Square 退款不退手續費類)、應收催款、現金流預警。只建議數據能證明的事;吃前三波數據,刻意最後做。

## 節奏

照客戶頁模式:一波一批派工,T2/T6 紀律,批間 soak 二到三天。F1 派工單由指揮簽發,建議模型 sonnet(對帳規則純 code)、Stripe 認列改造塊高風險審查用 opus。

## 待裁決(攢批)

1. [Jeff→CPA] Stripe 信用卡收單是否落入 §17550 trust 監管(答案只調 flag)。
2. [Jeff] 供應商付款現行記錄方式(Excel?記憶?),定 F3 應付資料源。
3. [Jeff,不急] 3 筆 unmatched trust 流入($8,908/4/13、$2,916/6/2、$3,598/6/12)對應哪些案子;若案子不在系統,正好當 F1 待認領流程的首批真實測資。

## 完成定義

月底不用手工對帳、Trust 認列零手誤、隨時看得到真 P&L、年底一鍵出帳。連續一個月四項全成立,財務部封存為營運中。
