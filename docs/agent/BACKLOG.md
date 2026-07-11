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

## 線三 旅遊公開網站(2026-07-10 Jeff 拍板:主線,API 先驗對再重建)

0. [進行中] API 正確性審計(Jeff 令:「先把 API 問題搞清楚,要不一個錯就錯接下來的」):UV 抽樣 20 團逐欄比真值+價格紅線專項(api-audit-uv-20260710.md);Lion throw 病根+NormGroupID 橋接方案(api-audit-lion-20260710.md)。兩報告出 → Jeff 看結論 → 才進 dryRun。
1. 重建順序(拍板):審計過 → dryRun → 日本 UV 25 團試批(Jeff 親驗貨架+圖效果)→ 全量 ~500 → Lion 橋接修好後補入。
2. 商品圖(指揮提案,試批時 Jeff 目視裁決):主力授權圖庫真照片(Unsplash/Pexels 商用授權,按目的地配 hero)+ 冷門景點 AI 補位 + 供應商圖不上客人頁(紅線不動)。骨架黑白極簡、hero 彩色賣景。
3. 動態地圖(Jeff 點名):行程頁模板工作時解凍路線圖引擎(v357 極簡風基準),每團頁掛動態路線圖。
4. [Jeff 未答] TiDB Cloud 查備份保留期(一分鐘,若有 6/17 前備份可直接撈回策展層)。
5. 設計方向提案(照 B-final 模式真實渲染多版型)排在試批之後。

## 基建(2026-07-10 改案:mini 延後,零成本方案先行)

1. [Jeff] Windows 常駐工位上線:照 docs/infra/windows-resident-setup.md 設定(WSL+Claude Code+repo+不休眠),並回報 RAM/WSL 有無/開機時段。定位:指揮值班、夜間衝刺、瀏覽器偵察;不產 PDF、不 ship。
2. [預授權] MacBook 回家補課腳本(iMessage chat.db 增量抓取,只收不發):等通道 Wave 4 動工時由 opus 實作,進 docs/infra/macbook-imessage-catchup.md。
3. Mac mini 延後:iMessage 只收不發不需即時,現階段不買。復議條件:iMessage 量大需即時、或 Windows 常駐證明太麻煩;屆時二手 M2 即可。
4. 過渡期:例行掃描逐步搬雲端排程(Fly cron)。

## 節奏

三線各一 agent 夜間衝刺;每次派工掛 45 分鐘心跳查勤,死了重派;裁決晨晚兩班;每批收尾更新 STATE.md;ship 永遠 Jeff。
