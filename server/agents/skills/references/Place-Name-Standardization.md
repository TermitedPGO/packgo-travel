# Place Name Standardization 地名標準化規範

> **PACK&GO Round 80.21 v10** — 此文件由全部 content-generation agents 共用,確保 AI 生成的行程使用 Google Maps / 國際標準的中文地名,而不是 OTA 來源(雄獅、易遊網等)的非標準翻譯。

## 為什麼這重要

PACK&GO 的下游服務(行程路線地圖、SEO、城市搜尋、hotel 對應、活動推薦)都依賴 **可被 Google Maps 解析** 的地名。Lion Travel 的原始資料常出現「蒙投」、「冰河3000」等非標準翻譯,Google geocoder 拒解析,造成:

- ❌ 行程路線地圖該日 marker 消失
- ❌ SEO 結構化資料(Schema.org Place)缺少 lat/lng  
- ❌ 城市搜尋功能找不到行程
- ❌ Hotel 對應 / 活動推薦 fail

## 核心規則

### 1. **第一優先**:用 Google Maps 認得的標準中文名
- 「Montreux」 → **`蒙特勒`**(不是 `蒙投`)
- 「Iseltwald」 → **`伊瑟爾瓦爾德`**(不是 `伊瑟爾特瓦爾德`)
- 「Glacier 3000」 → **`格拉西耶 3000`** 或保留英文 `Glacier 3000`(不是 `冰河3000`)

### 2. **第二優先**:中文不確定時,保留英文原名
- 「Château de Chillon」 → 保留英文,或用 `希永城堡`(不是 `西庸古堡`)
- 「Mont-Saint-Michel」 → 保留英文 `聖米歇爾山`

### 3. **行程標題格式**:`城市A → 城市B → 城市C:當日主題`
- ✓ `蒙特勒 → 西庸城堡 → 格拉西耶3000:阿爾卑斯精華日`
- ✗ `蒙投 → 西庸古堡 → 冰河3000`(用了 3 個非標準名)

### 4. **首次出現附英文**(SEO + 雙語讀者友善)
- ✓ `馬特宏峰 (Matterhorn)`
- ✓ `茨魏西門 (Zweisimmen)`

## 標準對照字典

按地區整理。輸出 itinerary / activities[].location / city 時優先用「標準」欄位。

### 瑞士 / Switzerland

| OTA / 非標準 | 標準中文 | 英文 |
|---|---|---|
| 蒙投 | 蒙特勒 | Montreux |
| 西庸古堡 | 希永城堡 | Château de Chillon |
| 冰河3000 | (保留英文) | Glacier 3000 |
| 黃金列車 | 茨魏西門 (路線中心) | Zweisimmen / GoldenPass |
| 冰河列車 | 安德馬特 (路線中心) | Andermatt / Glacier Express |
| 伊瑟爾特瓦爾德 | 伊瑟爾瓦爾德 | Iseltwald |
| 菲斯特 | 菲爾斯特 / 格林德瓦菲爾斯特 | Grindelwald First |
| 茨魏西門 | 茨魏西門 | Zweisimmen |
| 因特拉肯 | 因特拉肯 | Interlaken |
| 策馬特 | 策馬特 | Zermatt |
| 馬特洪峰 | 馬特宏峰 | Matterhorn |
| 鐵力士山 | 鐵力士山 | Mount Titlis |
| 瓦萊州 | 瓦萊州 / 錫永(首府) | Valais / Sion |
| 聖加侖 | 聖加侖 | St. Gallen |
| 聖莫里茲 | 聖莫里茨 | St. Moritz |
| 盧森 / 琉森 | 琉森 | Lucerne |
| 蘇黎世 | 蘇黎世 | Zürich |
| 伯恩 | 伯恩 | Bern |
| 日內瓦 | 日內瓦 | Geneva |
| 巴塞爾 | 巴塞爾 | Basel |

### 德國 / 巴伐利亞

| OTA / 非標準 | 標準中文 | 英文 |
|---|---|---|
| 林島 | 林道 | Lindau |
| 新天鵝堡 | 新天鵝堡 | Neuschwanstein Castle |
| 楚格峰 | 楚格峰 | Zugspitze |
| 黑森林 | 黑森林 | Black Forest |
| 羅曼蒂克大道 | 羅曼蒂克大道 | Romantic Road |
| 羅滕堡 | 羅滕堡 | Rothenburg ob der Tauber |
| 海德堡 | 海德堡 | Heidelberg |
| 慕尼黑 | 慕尼黑 | Munich |
| 法蘭克福 | 法蘭克福 | Frankfurt |
| 柏林 | 柏林 | Berlin |

### 法國 / France

| OTA / 非標準 | 標準中文 | 英文 |
|---|---|---|
| 凡爾賽 | 凡爾賽宮 | Palace of Versailles |
| 羅亞爾河谷 | 羅亞爾河谷 | Loire Valley |
| 蒙馬特 | 蒙馬特 | Montmartre |
| 杜爾 | 圖爾 | Tours |
| 雪儂梭 | 舍農索堡 | Château de Chenonceau |
| 沙特爾 | 沙特爾 | Chartres |
| 聖米歇爾山 | 聖米歇爾山 | Mont-Saint-Michel |
| 巴斯底 | 巴士底 | Bastille |
| 尼斯 | 尼斯 | Nice |
| 坎城 | 坎城 | Cannes |
| 亞維儂 | 亞維儂 | Avignon |
| 史特拉斯堡 | 史特拉斯堡 | Strasbourg |

### 義大利 / Italy

| OTA / 非標準 | 標準中文 | 英文 |
|---|---|---|
| 比薩 | 比薩 | Pisa |
| 佛羅倫斯 | 佛羅倫斯 | Florence |
| 西恩納 | 西恩納 | Siena |
| 五漁村 | 五漁村 | Cinque Terre |
| 索倫托 | 索倫托 | Sorrento |
| 卡布里 | 卡布里 | Capri |
| 龐貝 | 龐貝 | Pompeii |

### 奧地利 / Austria

| OTA / 非標準 | 標準中文 | 英文 |
|---|---|---|
| 薩爾斯堡 | 薩爾茨堡 | Salzburg |
| 因斯布魯克 | 因斯布魯克 | Innsbruck |
| 哈修塔特 | 哈爾施塔特 | Hallstatt |

### 北歐 / Scandinavia

| OTA / 非標準 | 標準中文 | 英文 |
|---|---|---|
| 卑爾根 | 卑爾根 | Bergen |
| 雷克雅維克 | 雷克雅維克 | Reykjavík |

### 日本 / Japan

| OTA / 非標準 | 標準中文 | 英文 |
|---|---|---|
| 美瑛 | 美瑛 | Biei |
| 富良野 | 富良野 | Furano |
| 小樽 | 小樽 | Otaru |
| 函館 | 函館 | Hakodate |
| 登別 | 登別 | Noboribetsu |
| 洞爺湖 | 洞爺湖 | Lake Toya |
| 白川鄉 | 白川鄉 | Shirakawa-go |
| 嚴島 | 嚴島(宮島) | Itsukushima |
| 倉敷 | 倉敷 | Kurashiki |

### 美國 / USA

| OTA / 非標準 | 標準中文 | 英文 |
|---|---|---|
| 黃石 | 黃石國家公園 | Yellowstone National Park |
| 大峽谷 | 大峽谷 | Grand Canyon |
| 羚羊峽谷 | 羚羊峽谷 | Antelope Canyon |
| 馬蹄灣 | 馬蹄灣 | Horseshoe Bend |
| 茂宜島 | 茂宜島 | Maui |
| 大島 | 夏威夷大島 | Big Island |
| 棕櫚泉 | 棕櫚泉 | Palm Springs |
| 蒙特雷 | 蒙特雷 | Monterey |
| 納帕 | 納帕 | Napa Valley |

## 校驗 checklist (Agent 自我檢查)

每次輸出 itinerary 之前,逐個 day 對照下列 checklist:

- [ ] 每個城市/景點名稱可以在 Google Maps 搜尋到嗎?
- [ ] 標題的 lastChunk(冒號前的最後一段)是該日**真正的終點**嗎?
- [ ] 沒有用 OTA 特殊翻譯(如「蒙投」)?
- [ ] 首次出現的地標附英文?

## 行為準則

1. **如果原始資料用了非標準名 → 標準化處理後輸出**
2. **如果不確定標準 → 保留英文 + 中文音譯**
3. **如果是專有商業/品牌名(火車路線、活動名)→ 保留英文**(像 GoldenPass、Glacier Express)
4. **NEVER 用 OTA 內部代碼**(像 Lion 的 NormGroupID)

## 適用 Agents

此規範必讀:
- `WebScraperAgent` — 抓取時把非標準名標記出來
- `ContentAnalyzerAgent` — 詩意化過程同時標準化地名
- `ItineraryUnifiedAgent` — 每日行程的城市名一律標準化
- `HotelAgent` / `MealAgent` — 飯店/餐廳的所在城市名一律標準化

## 與 placeNameAliases.ts 的關係

`server/_helpers/placeNameAliases.ts` 是**運行時 fallback**,當 geocoder 拿到非標準名時動態翻譯。但**正本來源是這份規範** — 我們希望 AI agents 從一開始就輸出乾淨的標準名,不要靠下游 fallback 救火。

兩者同步維護:新增條目時,**兩邊都要加**。
