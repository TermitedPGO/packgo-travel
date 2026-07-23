# Trip.com Affiliate Redirect MVP — Proposal（第一階段:純導流,不施工於付款）

> **現況(batch-4 起)= homepage-only redirect**:Codex 終驗裁定收口,自建深連結程式碼
> 已整組移除。本檔 §三~§五描述的「自建查詢格式深連結」方案是**歷史實驗紀錄**
> (batch-1~3,其參數實測為第二階段的事實基礎),不是現行實作;現行架構見
> design.md §七與 tasks/batch-4.md、batch-5.md。§一的階段界定仍有效。
>
> 2026-07-16 建立。隔離工作樹 `網站-trip-affiliate`,分支 `trip-affiliate-redirect-mvp`,
> 基準 commit `4c86254`。**未 commit、未 push、未部署**,等 Jeff/Codex 裁。
> 每項事實標【已親證】(本次實測)【文件顯示】(Trip.com 官方說法)【尚未確認】。

## 一、這個階段到底做什麼(先把話講白)

- 第一階段**只是 affiliate clickout(導流)**。客人在 PACK&GO 自製搜尋框輸入條件,按下搜尋後
  被導到 Trip.com,交易全程在 Trip.com 完成。
- **Trip.com 才是預訂與付款方**。PACK&GO 不經手這條線的任何款項,不產生訂單,不負責出票或入住。
- **PACK&GO 不顯示 Trip.com 即時庫存**。畫面上不會有 Trip.com 的價格、房型或艙等結果,
  搜尋框只是條件收集器加跳轉按鈕。
- **不嵌 iframe、不做 MCP、不接 Hotel/Flight API**。
- **尚未取得 Trip.com Hotel／Flight API 資格**【尚未確認:未申請,無資格證明在檔】。
- **尚未實作 MCP**,本階段完全不涉及。
- **導流請求不等於有效佣金**。`affiliateClicks` 每列只證明「收到一筆可重放的 redirect request 並回了 302」,
  不證明人類、不證明抵達、不證明唯一點擊。
- **飯店／機票佣金最終以 Trip.com Affiliate 報表為準**,repo 內任何數字都不是佣金真相源。

## 二、為什麼要動(這不是加功能,是修一條在漏的線)

原本的任務是「驗收 + 窄修 popup 攔截」。實測發現底下更嚴重的事:

**舊 `/t/{素材ID}` 連結形狀在觀察中掉光參數,且未見任何 Union 歸因 cookie 被設。**【已親證】
(能親證的就到這裡:歸因參數沒有進入 Trip.com 的可觀察狀態。**佣金是否實際支付只有
Trip.com Affiliate 報表能定案** —— 觀察不到歸因極可能等於沒有佣金,但那是推論,不是實證。)

`server/services/affiliateLinkService.ts` 當時產生的是 `https://www.trip.com/t/{素材ID}?allianceId=..&sid=..`。
實測(唯讀 GET;未登入,未讀 Jeff 個人 cookie;過程觀察的是測試瀏覽器自身的 attribution cookie 狀態):

| 連結 | 結果 |
|------|------|
| `/t/D13390057?...&dcity=SFO&acity=NRT&ddate=..` | `302 → location: /`,**整串 query 被丟掉** → `302 → us.trip.com` → 200。**無 Union cookie** |
| `/t/D15196722?...&city=Tokyo&checkin=..` | 同上,參數全掉,**無 Union cookie** |
| `/t/D13390050?allianceId=..&sid=..` | 同上,參數全掉,**無 Union cookie** |
| Jeff 核准主入口 `hk.trip.com/?Allianceid=..&SID=..&trip_sub3=D13390050` | 200 直達,**Union cookie 有設**(30 天) |

### 對照實驗(這條是關鍵,排除「素材ID失效」這個解釋)【已親證】

`D13390050` 是**出現在 Jeff 核准入口裡的素材**(僅此而已 —— 不宣稱它「有效」或「佣金會認列」,
因為下表同時證明 cookie 驗不出素材有效性)。同一個 ID:

| 形式 | Union cookie |
|------|--------------|
| `?trip_sub3=D13390050`(查詢格式,核准入口素材) | **有設 ✓** |
| `?trip_sub3=D13390057`(查詢格式,機票素材) | **有設 ✓** |
| `?trip_sub3=D99999999`(查詢格式,**亂編的ID**) | **有設 ✓** |
| `/t/D13390050`(路徑格式,核准入口素材) | **不設 ✗** |

結論:**兩種 URL 形狀對同一素材的可觀察行為不同**。`/t/{素材ID}` 形狀掉參數且未見歸因 cookie。

附帶警告:亂編的素材 ID 也會設 Union cookie,代表 `trip_sub3` 只是不做驗證的透傳標籤。
**cookie 有設 ≠ 素材有效 ≠ 佣金會付**。這條直接支撐「佣金以報表為準」的紅線。

影響範圍:`FlightBooking`、`HotelBooking`、`TourDetailPeony/PriceComparisonWidget` 三處出站連結
當時全部觀察不到歸因。

## 三、Jeff 已裁(2026-07-16)【歷史:已被同日稍晚的收口裁定取代】

1. 連結格式:用已驗證查詢格式自建深連結(`?Allianceid=&SID=&trip_sub3=` + 搜尋參數)。
2. 飯店城市:未驗證城市一律回退已核准主入口,寧可少一層方便也不把客人送到錯的城市。

> **取代裁定(Codex 終驗 §八,Jeff 核,同日)**:停止自建深連結,第一階段收口為
> homepage-only redirect;深連結程式碼整組移除,待 Trip.com Link Builder 正式連結
> 或書面確認後另案。以下 §四~§五 為歷史施工紀錄。

## 四、本次範圍

做:
- 連結格式改為已驗證的查詢格式(機票/飯店深連結 + 已核准主入口當回退)。
- 修 popup 被攔截(submit 當下同步開空白頁,拿到 URL 才導向,失敗關掉)。
- 後端獨佔 affiliate 身分,瀏覽器不得提供或覆寫 Alliance ID / SID / 素材 ID;移除 `ouid` 透傳。
- 目標網址只允許 Trip.com 官方 HTTPS 網域(前後端雙閘),不得形成任意 open redirect。
- 點擊紀錄只記後端推導出的 canonical target,不收瀏覽器給的 URL。
- URL / 追蹤參數不含姓名、email、電話、護照或其他 PII。
- 補測試(見 tasks/batch-1.md)。

不做(明確禁動):
- 不重做現有搜尋框 UI、不動版面。
- 不碰付款、Gmail、migration、credential、deployment。
- 不碰 inquiries.ts 電話 hotfix、Safe Booking Saga、PDF parser 修復。
- 不建立任何正式 Trip.com 訂單。
- 不 commit、不 push、不部署。

## 五、未解、需要 Jeff 或 Trip.com 才能定的事

1. **佣金資格未經 Trip.com 書面確認**【尚未確認】。自建深連結會設 Union cookie,
   但「會不會真的認列佣金」從站外驗不出來,且亂編 ID 也會設 cookie。
   Trip.com FAQ 說「勿自行修改平台產生的聯盟連結」,自建深連結與這句話存在張力。
   建議:上線前由 Jeff 在 Affiliate 後台或向支援確認深連結格式與佣金資格。
2. **已驗證的飯店城市 ID 目前只有 Tokyo=228**。其餘城市一律回退主入口(依 Jeff 裁示)。
   要擴充必須逐一做同樣的唯讀落地驗證,**禁止用猜的**。
3. **Premium Economy 沒有獨立艙等代碼**【已親證:`class=w` 與 `class=p` 都靜默變成 Economy】。
   Trip.com 自己的艙等篩選把「Economy/premium economy」併成一桶,故本次對應到 `y`。
