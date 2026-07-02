# 客戶頁 scorecard — 2026-07-01(v773 部署後首考)

> 考卷:桌面 客人檔案/(Jeff 手工核對過的真相)。受測:prod /ops/customers。
> 方法:prod DB dump(唯讀)+ 真實瀏覽器實測 + 3 條並行對抗驗證(左欄過濾 / 真相條看門狗實算 / 金額覆核)。
> 五維度依 requirements.md §八。

## 總結論

終極問題「明天只准用這一頁做生意敢不敢」:
- Gmail 進來的客人(Jenny、Emerald):基本敢,真相條/摘要/文件對得上考卷,今天看門狗零誤報。
- 微信 / iMessage / 電話客人(David、Wu、連先生、三寶寺、金宥、林朝安、陳、美玲、Wang、Wendy):不敢,因為根本不在系統裡。考卷 16 個案子只有 2 個在駕駛艙。這是目前最大的洞,不是 code bug,是資料進不來(這些客人從沒被建檔)。

## 逐維度

### 1. 正確性(一票否決)— 不及格(1 條 P0)

- P0:ORD-2026-0003(劉偉國 Air China)totalPrice 顯示 $6,635,真實 invoice 實收 $6,621.40(差 $13.60)。
  根因:$6,635 是 6/22 客人授權刷卡前的報價價,建單時(7/1 backfill)沒對 invoice。
  加重:同欄位 ORD-2026-0001 卻取 invoice 實收價 $8,488.03(授權原文是 $8,488.33),取數方法不一致。
- P2:訂單標題用「劉衛國」,考卷(Jeff 核對過)用「劉偉國」。
- 設計內待辦(不算系統錯):三張機票單全 draft、付款戳全空、帳務 tab 顯示「未付款」,實際全 PAID。付款狀態本來就是 Jeff 手動標,notes 也誠實寫著「已付清,待 Jeff 手動標」。但只要沒標,畫面上的付款狀態就跟現實相反。
- P2:profile 內部計數 totalSpend=0 / bookingCount=0,與實際多筆已收款不符(欄位從未被這些手動流程餵)。

### 2. 完整性 — 兩個洞

- 考卷 6 個重點客人只有 2 個在系統(Jenny、Emerald)。四個微信/iMessage 客人(David、Wu、連、三寶寺)完全缺席。
- Emerald 漏一筆已完成交易:SUZUKI+CATALAN PEK⇄PHX 家庭票,6/29 已出票已收 $5,705.30。護照照片、詢價信、報價信都在系統裡,7/1 手動補的 4 張單就是漏了這張。
- aiSummary 連鎖失真:nextStep 還在「等客人回信確認報價」,實際 6/29 已出票(出票走 Trip.com + Jeff 親刷,系統看不見)。

### 3. 五秒真相 — 及格

- Jenny:「換你回 · 3 天沒往來 · 跟進日 2026-07-21」,跟進日修復確認生效。摘要(要什麼/做了什麼/給了什麼)與考卷一致,4 份交付 PDF 全列對。
- Emerald:「等客人回 · 2 天沒往來」正確。專案 chips 4 張單可切,概覽跟著專案走。
- 軟誤報(設計取捨):Jenny 的「換你回」是被一句「謝謝🙏」觸發的,與 Jeff 自設 7/21 跟進日和 AI 的「等客人」建議矛盾。純 who-spoke-last 規則的已知代價。
- 口徑不一:「N 天沒往來」用 24 小時塊,跟進日/看門狗用 LA 曆日(Jenny 顯示 3 天,LA 曆日是 4 天)。

### 4. 跑腿完成度 — Jenny 面佳;一封已寄出的舊跟進信有兩個大問題

- Jenny:收信齊、歸檔對、口氣合格、工具憑證 chip 在聊天裡可見。
- 6/29 寄給 Emerald 的跟進信(Jeff 核准寄出,早於本批修復):
  1. 抬頭「Hi Leslie」,實際回覆的是 Emerald 的信(AI 客人理解自己都記了這筆:跟進郵件誤將 Emerald 當 Leslie)。
  2. 內文宣稱「I sent over the quotes ... a little while back」,系統內查無任何已寄報價紀錄,吹牛(違反不吹牛鐵律)。
  這封證明:跟進草稿的「已交付事實」還沒接 deterministic gate,收件人也沒有「必須=原信寄件人」的硬擋。

### 5. 攔錯 — 今天零誤報零漏報;兩個前瞻風險

- 今天:該靜默的全靜默(draft 跳過、缺成本就停、0 訂單 0 徽章),沒有叫錯。
- 前瞻 1(7/5 會誤叫):簽證單 ORD-2026-0004 是 deposit_paid 且永遠不會有「確認書」,7/5 LA 起 confirmationUnsent 會叫錯。visa category 未被豁免。Jeff 在 7/5 前推進狀態可避開。
- 前瞻 2(永久盲區):Emerald 兩張大單($8,488 / $6,635)supplierCost 全空,margin 防線對這客人最大的錢是盲的,直到有人補成本。

## UI 實測其他發現

- 左欄過濾有效:prod 179 個 profile(約 170 個 newsletter/noreply 雜訊)只顯示 4 個。gate = source manual 或有 inquiry 或有 escalation(adminCustomers.ts v694 hotfix)。
- 「Better way To survive」(jeffhsieh0909@gmail.com,Jeff 自己的信箱)出現在左欄當客人,該藏。
- Jenny 左欄與 header 顯示「jenny.chang.info」(email 帳號),name 欄從沒被填「Jenny Chang」。
- 專案 chips 列的水平捲軸蓋在 chips 上,尾端「未分類」chip 連點三次都點不到(自動化實測)。
- 隱藏/還原機制正常(uvbookings、uptimerobot、測試客人已被藏,可勾選顯示)。
- 測試客人空狀態誠實(看不出需求/沒對外動作/沒交付/一切就緒)。
- console 零錯誤。

## 沒測到的(誠實聲明)

寫入類操作(chat 指令建檔/備註/跟進日、拖 PDF 建單、送草稿)被本次自動化的安全層擋下(不對 prod 寫入),未實測。留給 Jeff 手測,或下次在本機 preview 環境跑。

## 建議微調(等 Jeff 裁示)

資料手動修(不用寫 code,Jeff 或我出指令):
1. 補 PHX 家庭票訂單($5,705.30,已出票已收)。
2. ORD-2026-0003 改 $6,621.40(以 invoice 為準)。
3. 三張機票單標付款狀態、推進簽證單狀態(順便解掉 7/5 誤叫)。
4. Jenny name 填「Jenny Chang」;藏「Better way To survive」。
5. 訂單標題「劉衛國」改「劉偉國」。

code 級(逐項問過再動):
1. 跟進草稿接 deterministic 已交付事實 + 收件人硬擋(=原信寄件人),斷根「吹牛+認錯人」。
2. watchdog:visa/無確認書流程的 category 豁免 confirmationUnsent。
3. 「N 天沒往來」改 LA 曆日,跟全站口徑一致。
4. 建單時 totalPrice 標注來源(報價價 vs invoice 價),或補單流程強制對 invoice。
5. 微信/iMessage 客人的進場路(拖聊天截圖/檔案建檔已有,缺的是把 14 個現存案子建進來,可批次)。
