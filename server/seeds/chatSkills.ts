/**
 * Chat Skills Seed Data
 * 9 conversation-type skills for AI Chat knowledge base
 * These skills are triggered by keyword matching and inject domain knowledge into the system prompt
 */

export const chatSkillsData = [
  // 1. 簽證諮詢顧問
  {
    skillType: "conversation" as const,
    skillCategory: "reference" as const,
    skillName: "簽證諮詢顧問",
    skillNameEn: "Visa Consultation",
    keywords: JSON.stringify(["簽證", "visa", "護照", "入境", "免簽", "落地簽", "電子簽", "ESTA", "申根"]),
    rules: JSON.stringify({
      conditions: [
        { type: "keyword", keywords: ["簽證", "visa", "ESTA", "申根"], outputLabel: "簽證資訊" },
        { type: "keyword", keywords: ["免簽", "落地簽", "電子簽"], outputLabel: "入境方式" },
        { type: "keyword", keywords: ["護照", "入境"], outputLabel: "入境文件" }
      ]
    }),
    outputLabels: JSON.stringify(["簽證資訊", "入境方式", "入境文件"]),
    description: "提供台灣護照持有者的簽證資訊，包含免簽、落地簽、電子簽等入境方式",
    corePattern: `台灣護照免簽/免辦簽證國家（主要）：
- 日本：免簽90天
- 韓國：免簽90天（K-ETA電子旅行許可）
- 泰國：免簽30天
- 新加坡：免簽30天
- 馬來西亞：免簽30天
- 歐盟申根區：免簽90天（2025年起需ETIAS）
- 英國：免簽6個月（ETA電子旅行許可）
- 加拿大：免簽6個月（需eTA）
- 美國：ESTA電子旅行授權，2年有效
- 澳洲：需申請ETA（電子旅遊簽證）
- 紐西蘭：需申請NZeTA

需辦理簽證國家：中國（台胞證）、印度（電子簽）、俄羅斯、沙烏地阿拉伯等

重要提醒：
- 護照效期需超過6個月（部分國家要求）
- 回程機票或訂房證明可能被要求出示
- 旅遊保險建議投保`,
    isBuiltIn: true,
    isActive: true,
  },

  // 2. 旅遊季節顧問
  {
    skillType: "conversation" as const,
    skillCategory: "reference" as const,
    skillName: "旅遊季節顧問",
    skillNameEn: "Travel Season Advisor",
    keywords: JSON.stringify(["什麼時候去", "最佳季節", "幾月", "天氣", "櫻花季", "楓葉季", "雪季", "旺季", "淡季"]),
    rules: JSON.stringify({
      conditions: [
        { type: "keyword", keywords: ["什麼時候去", "最佳季節", "幾月"], outputLabel: "最佳旅遊時機" },
        { type: "keyword", keywords: ["櫻花季", "楓葉季", "雪季"], outputLabel: "季節景觀" },
        { type: "keyword", keywords: ["天氣", "氣候"], outputLabel: "天氣資訊" }
      ]
    }),
    outputLabels: JSON.stringify(["最佳旅遊時機", "季節景觀", "天氣資訊"]),
    description: "根據目的地提供最佳旅遊月份建議，包含季節性景觀與氣候資訊",
    corePattern: `各目的地最佳旅遊月份：
- 日本：
  * 春季（3-4月）：櫻花季，最熱門
  * 秋季（10-11月）：楓葉季，涼爽宜人
  * 冬季（12-2月）：北海道滑雪、溫泉
  * 夏季（7-8月）：祭典煙火，但濕熱
- 韓國：
  * 春季（4-5月）：櫻花、油菜花
  * 秋季（9-11月）：楓葉、涼爽
  * 冬季（12-2月）：滑雪、冬季仙境
- 歐洲：
  * 5-9月：最佳旅遊季，日照長
  * 6-8月：旺季，人多價高
  * 4-5月/9-10月：肩季，性價比高
- 東南亞（泰國/越南/馬來西亞）：
  * 11-3月：乾季，最佳旅遊期
  * 4-5月：炎熱乾燥
  * 6-10月：雨季，部分地區不宜
- 北海道：
  * 2-3月：雪祭、粉雪滑雪
  * 7-8月：薰衣草花田（富良野）
  * 9-10月：楓葉
- 北歐：
  * 6-8月：白夜、峽灣最美
  * 12-2月：極光（挪威/冰島）`,
    isBuiltIn: true,
    isActive: true,
  },

  // 3. 旅遊預算規劃師
  {
    skillType: "conversation" as const,
    skillCategory: "reference" as const,
    skillName: "旅遊預算規劃師",
    skillNameEn: "Travel Budget Planner",
    keywords: JSON.stringify(["預算", "多少錢", "費用", "價格", "省錢", "便宜", "CP值", "划算", "花費"]),
    rules: JSON.stringify({
      conditions: [
        { type: "keyword", keywords: ["預算", "多少錢", "費用", "花費"], outputLabel: "預算規劃" },
        { type: "keyword", keywords: ["省錢", "便宜", "划算", "CP值"], outputLabel: "省錢建議" },
        { type: "keyword", keywords: ["價格"], outputLabel: "價格參考" }
      ]
    }),
    outputLabels: JSON.stringify(["預算規劃", "省錢建議", "價格參考"]),
    description: "提供各目的地旅遊費用參考，協助客戶規劃合理預算",
    corePattern: `各目的地旅遊費用參考（含機票、住宿、餐食、門票，每人）：
- 日本（5-7天）：NT$ 35,000 - 60,000
  * 機票：NT$ 10,000-20,000（東京直飛）
  * 住宿：NT$ 2,000-5,000/晚
  * 日常消費：NT$ 2,000-3,000/天
- 韓國（4-6天）：NT$ 25,000 - 45,000
  * 機票：NT$ 8,000-15,000
  * 住宿：NT$ 1,500-3,500/晚
- 東南亞（5-7天）：NT$ 20,000 - 40,000
  * 泰國/越南：消費較低
  * 新加坡：消費較高
- 歐洲（10-14天）：NT$ 80,000 - 180,000
  * 機票：NT$ 30,000-50,000
  * 住宿：NT$ 3,000-8,000/晚
  * 日常消費：NT$ 3,000-5,000/天
- 美國（10-14天）：NT$ 90,000 - 200,000
- 澳紐（10-14天）：NT$ 80,000 - 150,000

PACK&GO 跟團優勢：
- 機票+住宿+餐食+門票+導遊一次包辦
- 比自由行省去訂房訂票的麻煩
- 小團制（最多20人）確保品質`,
    isBuiltIn: true,
    isActive: true,
  },

  // 4. 親子旅遊顧問
  {
    skillType: "conversation" as const,
    skillCategory: "pattern" as const,
    skillName: "親子旅遊顧問",
    skillNameEn: "Family Travel Advisor",
    keywords: JSON.stringify(["親子", "小孩", "兒童", "家庭", "遊樂園", "迪士尼", "環球影城", "帶小孩", "孩子"]),
    rules: JSON.stringify({
      conditions: [
        { type: "keyword", keywords: ["親子", "帶小孩", "孩子", "兒童"], outputLabel: "親子旅遊" },
        { type: "keyword", keywords: ["遊樂園", "迪士尼", "環球影城"], outputLabel: "主題樂園" },
        { type: "keyword", keywords: ["家庭"], outputLabel: "家庭旅遊" }
      ]
    }),
    outputLabels: JSON.stringify(["親子旅遊", "主題樂園", "家庭旅遊"]),
    description: "提供親子旅遊目的地推薦、兒童票規定與行程節奏建議",
    corePattern: `親子旅遊推薦目的地：
- 日本：
  * 東京迪士尼樂園/海洋（千葉）
  * 大阪環球影城（哈利波特、任天堂世界）
  * 北海道（農場體驗、動物園）
  * 沖繩（海洋博公園、美麗海水族館）
- 韓國：
  * 首爾樂天世界、愛寶樂園
  * 濟州島（泰迪熊博物館、漢拿山）
- 新加坡：
  * 聖淘沙環球影城
  * 新加坡動物園、夜間野生動物園
- 香港：
  * 迪士尼樂園、海洋公園

兒童票規定（一般）：
- 2歲以下：免費（不佔位）
- 2-11歲：兒童票（約7-8折）
- 12歲以上：成人票

行程節奏建議：
- 每天景點不超過2-3個
- 安排午休時間
- 選擇有兒童設施的飯店
- 避免長途轉機（建議直飛）
- 準備零食、玩具、備用衣物`,
    isBuiltIn: true,
    isActive: true,
  },

  // 5. 銀髮旅遊顧問
  {
    skillType: "conversation" as const,
    skillCategory: "pattern" as const,
    skillName: "銀髮旅遊顧問",
    skillNameEn: "Senior Travel Advisor",
    keywords: JSON.stringify(["爸媽", "父母", "長輩", "銀髮", "老人", "無障礙", "慢遊", "帶爸媽", "年長"]),
    rules: JSON.stringify({
      conditions: [
        { type: "keyword", keywords: ["爸媽", "父母", "長輩", "帶爸媽"], outputLabel: "銀髮旅遊" },
        { type: "keyword", keywords: ["無障礙", "慢遊"], outputLabel: "無障礙旅遊" },
        { type: "keyword", keywords: ["銀髮", "老人", "年長"], outputLabel: "長者友善" }
      ]
    }),
    outputLabels: JSON.stringify(["銀髮旅遊", "無障礙旅遊", "長者友善"]),
    description: "提供長者友善的旅遊建議，包含步行量少的行程、直飛航班與無障礙住宿",
    corePattern: `銀髮旅遊推薦目的地：
- 日本（長者最愛）：
  * 京都（文化古蹟、寺廟、抹茶體驗）
  * 北海道（溫泉、自然景觀）
  * 東京（購物、美食、無障礙設施完善）
- 韓國：首爾（地鐵無障礙、韓式料理）
- 新加坡：（平坦、乾淨、醫療完善）
- 歐洲河輪：（不用每天換飯店，行李一次打包）

行程規劃原則：
- 每天步行量控制在3-5公里以內
- 優先選擇直飛航班（避免轉機）
- 選擇電梯完善的飯店
- 行程節奏放慢，每天2個景點即可
- 安排午休時間

健康注意事項：
- 出發前諮詢醫師，備足常備藥
- 投保旅遊醫療保險（含緊急送醫）
- 攜帶中英文病歷摘要
- 血壓藥、心臟藥等需隨身攜帶（勿托運）
- 高山地區（西藏、秘魯）需特別評估

PACK&GO 銀髮服務：
- 全程有導遊陪同
- 協助行李搬運
- 緊急醫療協助`,
    isBuiltIn: true,
    isActive: true,
  },

  // 6. 蜜月旅遊顧問
  {
    skillType: "conversation" as const,
    skillCategory: "pattern" as const,
    skillName: "蜜月旅遊顧問",
    skillNameEn: "Honeymoon Travel Advisor",
    keywords: JSON.stringify(["蜜月", "honeymoon", "新婚", "浪漫", "情侶", "紀念日", "求婚", "結婚"]),
    rules: JSON.stringify({
      conditions: [
        { type: "keyword", keywords: ["蜜月", "honeymoon", "新婚"], outputLabel: "蜜月旅遊" },
        { type: "keyword", keywords: ["浪漫", "情侶", "紀念日"], outputLabel: "浪漫旅遊" },
        { type: "keyword", keywords: ["求婚", "結婚"], outputLabel: "特殊紀念" }
      ]
    }),
    outputLabels: JSON.stringify(["蜜月旅遊", "浪漫旅遊", "特殊紀念"]),
    description: "提供蜜月旅遊目的地推薦，包含海島型與文化型蜜月選擇",
    corePattern: `蜜月旅遊推薦：
海島型蜜月：
- 馬爾地夫：水上屋、珊瑚礁浮潛，頂級奢華
- 峇里島（印尼）：神廟、梯田、SPA，文化與浪漫兼具
- 帛琉：世界頂級潛水，原始自然
- 沖繩：日本海島，近且美麗
- 普吉島（泰國）：海灘、夜生活、美食

文化型蜜月：
- 巴黎（法國）：愛情之都，鐵塔、博物館、美食
- 義大利：羅馬、威尼斯、托斯卡尼，浪漫無比
- 希臘：聖托里尼藍白建築，愛琴海夕陽
- 日本京都：古都氛圍，和服體驗，溫泉旅館

蜜月特別安排建議：
- 提前告知旅行社，安排驚喜佈置（玫瑰花瓣、蛋糕）
- 升等住宿（蜜月套房）
- 私人晚餐體驗
- 水療/SPA 雙人療程
- 日落遊船/熱氣球

預算建議：
- 峇里島蜜月（7天）：NT$ 60,000-120,000/對
- 馬爾地夫（5天）：NT$ 150,000-300,000/對
- 歐洲蜜月（10天）：NT$ 180,000-350,000/對`,
    isBuiltIn: true,
    isActive: true,
  },

  // 7. 旅遊安全顧問
  {
    skillType: "conversation" as const,
    skillCategory: "reference" as const,
    skillName: "旅遊安全顧問",
    skillNameEn: "Travel Safety Advisor",
    keywords: JSON.stringify(["安全", "治安", "詐騙", "小偷", "保險", "急難救助", "安全嗎", "危險", "緊急"]),
    rules: JSON.stringify({
      conditions: [
        { type: "keyword", keywords: ["安全", "治安", "安全嗎", "危險"], outputLabel: "安全資訊" },
        { type: "keyword", keywords: ["詐騙", "小偷"], outputLabel: "防詐防盜" },
        { type: "keyword", keywords: ["保險", "急難救助", "緊急"], outputLabel: "緊急資源" }
      ]
    }),
    outputLabels: JSON.stringify(["安全資訊", "防詐防盜", "緊急資源"]),
    description: "提供旅遊安全建議，包含常見詐騙手法、保險建議與緊急聯絡資訊",
    corePattern: `旅遊安全重要資訊：
緊急聯絡：
- 外交部急難救助專線：0800-085-095（24小時）
- 外交部旅外國人急難救助：+886-800-085-095（從海外撥）
- 各國台灣辦事處可協助護照遺失補辦

常見觀光詐騙手法：
- 計程車繞路（建議使用APP叫車）
- 假導遊帶去購物店收回扣
- 路邊換錢（匯率差、假鈔）
- 「免費」項鍊/手環後強索費用
- 假警察要求查護照（應堅持去警察局）
- 餐廳菜單無標價（先問清楚）

保險建議：
- 旅遊綜合保險（含意外、醫療、行李）
- 醫療費用建議至少 NT$ 300萬
- 緊急後送（含台灣）
- 旅遊不便險（班機延誤、行李遺失）

各地安全等級（外交部分級）：
- 黃色警示：提高警覺
- 橙色警示：避免非必要旅遊
- 紅色警示：不宜前往
- 出發前請查詢外交部最新旅遊警示

PACK&GO 安全保障：
- 全程有領隊/導遊陪同
- 緊急醫療協助
- 24小時緊急聯絡`,
    isBuiltIn: true,
    isActive: true,
  },

  // 8. 行李打包顧問
  {
    skillType: "conversation" as const,
    skillCategory: "reference" as const,
    skillName: "行李打包顧問",
    skillNameEn: "Packing Advisor",
    keywords: JSON.stringify(["行李", "打包", "帶什麼", "穿什麼", "攜帶", "隨身行李", "轉接頭", "限重", "托運"]),
    rules: JSON.stringify({
      conditions: [
        { type: "keyword", keywords: ["行李", "打包", "帶什麼"], outputLabel: "行李建議" },
        { type: "keyword", keywords: ["穿什麼", "攜帶"], outputLabel: "穿著建議" },
        { type: "keyword", keywords: ["隨身行李", "轉接頭", "限重", "托運"], outputLabel: "航空規定" }
      ]
    }),
    outputLabels: JSON.stringify(["行李建議", "穿著建議", "航空規定"]),
    description: "提供行李打包建議，包含必帶清單、各國插頭型號與航空行李限重規定",
    corePattern: `行李打包必備清單：
證件類：
- 護照（效期6個月以上）
- 簽證/ESTA/ETA（如需要）
- 機票確認單、訂房確認單
- 旅遊保險單
- 緊急聯絡人資料

藥品類：
- 感冒藥、腸胃藥、止痛藥
- 個人慢性病用藥（需備足）
- 暈車/暈船藥
- 防蚊液（東南亞必備）
- 防曬乳（SPF50+）

電子類：
- 手機充電器、行動電源（隨身，不可托運）
- 相機、記憶卡
- 轉接頭（各國插頭）

各國插頭型號：
- 日本/美國/加拿大：A型（兩扁腳）
- 歐洲：C型（兩圓腳）
- 英國：G型（三方腳）
- 澳洲/紐西蘭：I型（兩斜腳）
- 台灣出發建議帶萬用轉接頭

航空行李限重（一般規定）：
- 托運行李：20-30公斤（依航空公司）
- 隨身行李：7-10公斤，55x40x20cm
- 液體：隨身需100ml以下，裝入1L透明袋
- 行動電源：隨身攜帶，不可托運`,
    isBuiltIn: true,
    isActive: true,
  },

  // 9. 旅遊方式顧問
  {
    skillType: "conversation" as const,
    skillCategory: "pattern" as const,
    skillName: "旅遊方式顧問",
    skillNameEn: "Travel Style Advisor",
    keywords: JSON.stringify(["自由行", "跟團", "自助", "團體", "差別", "哪個好", "第一次出國", "適合嗎", "建議"]),
    rules: JSON.stringify({
      conditions: [
        { type: "keyword", keywords: ["自由行", "自助"], outputLabel: "自由行" },
        { type: "keyword", keywords: ["跟團", "團體"], outputLabel: "跟團旅遊" },
        { type: "keyword", keywords: ["差別", "哪個好", "第一次出國"], outputLabel: "旅遊方式比較" }
      ]
    }),
    outputLabels: JSON.stringify(["自由行", "跟團旅遊", "旅遊方式比較"]),
    description: "比較跟團與自由行的優缺點，協助客戶選擇最適合的旅遊方式",
    corePattern: `跟團 vs 自由行比較：

跟團旅遊優點：
✅ 省去訂房、訂票、規劃的麻煩
✅ 有專業領隊/導遊全程陪同
✅ 緊急狀況有人協助處理
✅ 費用透明，不怕超支
✅ 適合語言不通的目的地（如東歐、中東）
✅ 可認識同行旅伴

跟團旅遊缺點：
❌ 時間較固定，自由度低
❌ 行程較緊湊
❌ 需配合團體步調

自由行優點：
✅ 時間自由，想去哪就去哪
✅ 可深度探索小眾景點
✅ 適合有經驗的旅行者

自由行缺點：
❌ 需要自行規劃，耗時費力
❌ 語言不通可能遇到困難
❌ 緊急狀況需自行處理
❌ 費用可能比預期高

PACK&GO 小團制特色：
- 最多20人的精緻小團
- 不進購物店、不強迫消費
- 專業領隊全程陪同
- 彈性行程，可依團員需求微調
- 適合第一次出國、銀髮族、親子家庭

建議跟團的情況：
- 第一次出國
- 語言不通的目的地
- 帶長輩或小孩出遊
- 不想花時間規劃行程
- 想認識新朋友`,
    isBuiltIn: true,
    isActive: true,
  },
];
