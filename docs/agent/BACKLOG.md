# 任務佇列(2026-07-10 立,指揮維護,閉環預授權制)

> 規則:[預授權] = 指揮可自動開工與續派,不再問;[裁決門] = 停住掛起,晨晚兩班交 Jeff;[Jeff] = 只有他能做的事。做完一項自動接下一項。

## 線一 財務(目標:財務頁優化到沒有缺點)

1. [預授權] F2 重啟:塊A systemAudit → 塊B Trust 認列閉環(migration 0114 已預授權)→ 塊C Square 撥款對映(探真先行)→ 塊D 部分退款/P&L 接線(flag 翻不翻 = 裁決門)。
2. [Jeff] 親驗 v807 駕駛艙,嫌棄清單丟指揮 → [預授權] F3-polish 批次照清單修。
3. [預授權] v807 走查:prod 截圖 vs B-final 並排、listAutoLinked smoke、4px 網格抽查。
4. [Jeff] drift $10,442 查核;transfer netted/gross 最終口徑;321 筆分批認領節奏;存量回填 confirm 時機。

## 線二 客戶頁 + 外接通道(iMessage/WeChat/LINE/社媒)

1. [預授權] channel-map 測繪(唯讀):現有通道現況(gmail 全套、imessage/wechat 半成品)、每通道官方 API 可行性與限制(iMessage 無官方 API,橋接方案風險要誠實評)、統一收件匣架構草案、與客戶頁現有 interactions/threadFiling 的接點。產出 docs/features/channel-hub/current-state.md。
2. [裁決門] 通道藍圖 + 波次計畫給 Jeff 拍板,才動工。
3. 客戶頁硬化 Wave3(時間紀律)/Wave4(回歸考古)/Wave5(韌性演習)排在通道藍圖定案後,與其併波。

## 線三 旅遊公開網站

1. [預授權] 公開站現況盤點(唯讀):首頁/行程頁/預訂流程/SEO/慢與醜的地方,缺口清單。產出 docs/features/public-site/audit.md。
2. [裁決門] 設計方向提案(照 B-final 成功模式:真實渲染多版型)→ Jeff 挑 → 才實作。行程頁翻修含地圖重做(保留狀態在此解凍)。
3. 開放問題(等 Jeff 一句話):「旅遊頁面」= 現站公開頁翻修(指揮暫按此盤點),還是另立獨立新站?

## 基建

1. [Jeff] 採購 Mac mini 當 24/7 AI 主機(建議 M4 16GB $599 或二手 M2;解四件事:指揮常駐/iMessage 橋接先決/專職測試機/筆電解放)。
2. [預授權] 指揮先備妥 mini 開機設定腳本與檢查清單進 docs/infra/(Claude Code/flyctl/repo/常駐 session/遠端進入),到貨十分鐘上線。
3. 過渡期:筆電在家開著就夜間衝刺,不在就攢佇列;例行掃描逐步搬雲端排程。

## 節奏

三線各一 agent 夜間衝刺;每次派工掛 45 分鐘心跳查勤,死了重派;裁決晨晚兩班;每批收尾更新 STATE.md;ship 永遠 Jeff。
