# AI 端到端跑客人詢問(報價 / 參團)— 客製 + 跟團,可擴充

> 起因(2026-06-15):Jenny 的案子,真正的工作(報價、英文版、英文導遊加價、擬信)全是 Jeff 跟 Claude 在對話框 + Gmail 手做的。系統只做了「分類 → escalate → 一張空白卡」,連 Jeff 回了沒都不知道。
>
> 診斷:現在的後台是「會分類的收件匣」,不是「會幫 Jeff 跑生意的系統」。要把它變成後者。

## 目標(Jeff 拍板的要求)

一封詢問進來,AI 把這位客人從詢問一路跑到「可送出的草稿」:行程/選項擬好、回信擬好、只把價格和不確定的東西留給 Jeff 拍板。Jeff 只做判斷 + 按鍵。後台永遠反映真實對話(含 Jeff 直接在 Gmail 回的)。

## 架構原則(最重要,先定調)

**不寫死決策樹。** 客人百百種,硬分支一定被現實打爆。改成:

1. **一根不變的脊椎**(所有團型共用,見下)。不管客人多奇怪,脊椎不變。
2. **團型只做「粗分流」**(客製 / 跟團 / …),粗分流決定**工作型態**(設計行程 vs 對現成產品),不決定細節。
3. **細節變化交給 AI adapt**。AI 讀這位客人的實際需求去調整草稿,不是再加 code 分支。加新團型 = 掛一個新子流程模組到脊椎上,不重寫脊椎。
4. **AI 把理解攤出來給 Jeff 改**。因為每個客人不一樣,卡片上要顯示「我理解你要的是 X、缺 Y」,不是默默假設然後出錯。等同「不確定就留白問你」。

一句話:**穩定骨架 + 死規矩是寫死的;客人的千變萬化交給 AI 在框架內 adapt,並把理解攤給 Jeff。**

## 脊椎(所有團型共用的固定管線)

1. 來信進來(gmailPipeline 既有)。
2. **抽需求 + 判團型**:AI 開放式抽出這位客人要什麼(目的地、天數、人數、房型、日期、含不含機票、特殊需求…)+ 粗分團型。要素不齊 → 擬一封「釐清需求」回信問清楚,不硬出報價。
3. **走對應子流程**(見下),產出草稿(回信 + 文件骨架),adapt 到這位客人。
4. **價格 + 不確定欄位留白**,escalate 給 Jeff(附參考資料,如供應商底價 / 公布起價)。
5. **上架今日待辦一張「可動作」的卡**:AI 理解的需求摘要 + 草稿回信 + 文件 + 待 Jeff 確認的欄位。不是空白卡。
6. **Jeff 改 + 確認價格 + 送出。**
7. **送出後**:outbound 寫進對話,後台反映真實狀態(含 Jeff 直接在 Gmail 回的 → sent-sync)。對話 = 唯一真相。
8. **追問**:AI 認得追問(英文版、導遊語言、改行程…),走回脊椎再跑一輪。

## 粗分流(會分得更細,但靠掛模組,不靠改脊椎)

- **客製團**(Jenny 這種):客人要照需求設計。AI 組行程骨架、列架構,價格客製(要跟供應商喬)→ escalate。出客製 PDF(packgo-quote skill)。
- **一般參團 / 跟團**(像「九月有沒有日本團」):客人要現成出團產品,行程 + 團費供應商公布好了。AI **不設計行程**,改成:對到哪個產品 / 地區、抓出發班期 + 房型、把公布團費當「起價」列出、標「待後台核實」、把真價核對 escalate 給 Jeff。沿用供應商公布行程。這就是既有的「X月Y國團 → 5 條區域選項 + Lion 代碼 + 旺季警告」流程([[feedback_japan_quote_workflow]]),不重做。
- **自由行**(之後):規劃景點 / 飯店 / 餐廳,不是團([[feedback_packgo_freetrip_planning]])。Jeff 沒要求,先不放,但脊椎要能接。

## 死規矩 / 紅線(所有團型一律,寫死)

- **AI 永不定最終價**。客人文件上的價 = Jeff 確認的**直客售價**,從合約 / 報價拿,**絕不**從供應商 invoice 或 flyer 文字複製([[feedback_no_cost_on_customer_docs]]、[[feedback_packgo_quote_pricing]])。價格一定 escalate 給 Jeff,不是禮貌,是防漏。
- **cost_leak_check gate(機械防線)**:自動出的客人 PDF 一定走 `packgo-quote` skill 那條(有 cost gate + brand-core),**不准一次性腳本**(David 漏價就是繞過 gate)。出檔前把供應商 invoice 成本數字丟 gate 比對,命中就停、不出。自動化讓漏價風險更大,這條非有不可。
- **不確定就留白 + flag,不准猜**(金額、條款、日期一律查證)。
- **Jeff 按最後一鍵**,AI 不自行對外送。

## PDF + 歸檔

- 引擎照既有踩坑筆記:Chrome headless + STHeiti `@font-face file://` + `--virtual-time-budget` + `--run-all-compositor-stages-before-draw`,不設 `min-height`,footer `page-break-inside:avoid`,出完數頁數驗收([[feedback_chrome_headless_font]])。reuse skill,不重造。
- 出好的檔丟 `客人檔案/<姓名_行程>/`,不留桌面([[reference_packgo_filing]])。

## 相依

- reply-attachments(已上線):夾 PDF 進回信。
- packgo-quote skill + brand-core(已升級):出 PDF + cost gate。
- gmailPipeline / InquiryAgent / 今日待辦 / outboundInteraction(既有)。

## 四刀(順序照「最快讓 Jeff 看到 AI 真的在幹活」)

- **第一刀**:脊椎的「抽需求 + 判團型 + 擬草稿 + 留白 escalate + 上架可動作的卡」。**客製團先做**(Jenny 是樣板)。分類器 + 分流先設計好,讓跟團能直接接上。做完:打開卡就看到 AI 已把九成寫好,Jeff 只動價格 + 按鍵。
- **第二刀**:AI 從 server 端跑 skill 出 PDF(過 cost gate)+ 夾上。
- **第三刀**:對話單一真相(sent-sync,含 Jeff 直接在 Gmail 回的)。
- **第四刀**:追問處理(英文版 / 導遊語言 / 改行程)。
- 跟團子流程在第一刀的分流上接(粗分流 + 「X月Y國團」既有 playbook)。

## 非目標

- 全自動寄出(永遠 staged 給 Jeff)。
- 自動定價(永遠人決定)。
- 把整套團型窮舉成 code 分支(靠脊椎 + AI adapt)。

## Rollout

每刀:proposal/design 對齊 → 拆 task → 寫 + 對應 vitest → tsc 0 錯 + 測試綠 → `pnpm ship`(Jeff token)。第一刀先跑通客製這條當樣板。
