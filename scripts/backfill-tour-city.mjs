#!/usr/bin/env node
/**
 * Round 80.17 backfill: re-detect destinationCountry / destinationCity for
 * old liontravel tours where the AI generation pre-Round-80.16 wrongly set
 * city to a departure/transit city (桃園 / 台北 etc.).
 *
 * Strategy:
 *   1. Pull every liontravel tour from DB
 *   2. For each, re-fetch Lion API to get fresh tourName + dailyItinerary +
 *      Country code
 *   3. Re-run the same country/city detection logic that masterAgent uses
 *      now (Pass 1 keyword first, Pass 0 ISO fallback skip TW, Taiwan
 *      cities reordered, departureCity stripped)
 *   4. UPDATE the tour row only when detection differs from current value
 *      AND new value is more specific (not empty / not departure city)
 *
 * Dry-run by default. Pass --apply to write changes.
 */
import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
const APPLY = process.argv.includes("--apply");
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const LION_BASE = "https://travel.liontravel.com";

// ── Detection logic mirrors masterAgent.ts (Round 80.16 P0a v3) ──────────────

const COUNTRY_PATTERNS = {
  // International — short keys ordered specifically (most-specific first)
  "北海道": "日本", "沖縄": "日本", "沖繩": "日本", "九州": "日本",
  "東京": "日本", "大阪": "日本", "京都": "日本", "名古屋": "日本",
  "福岡": "日本", "廣島": "日本", "神戶": "日本", "奈良": "日本",
  "四國": "日本", "關西": "日本", "京阪神": "日本",
  "那霸": "日本", "石垣": "日本", "宮古": "日本", "與那國": "日本",
  "首爾": "韓國", "釜山": "韓國", "濟州": "韓國",
  "曼谷": "泰國", "清邁": "泰國", "普吉": "泰國",
  "河內": "越南", "胡志明": "越南", "峴港": "越南", "下龍灣": "越南",
  "巴里島": "印尼", "峇里島": "印尼",
  "馬尼拉": "菲律賓", "宿霧": "菲律賓", "長灘島": "菲律賓",
  "吉隆坡": "馬來西亞", "沙巴": "馬來西亞", "檳城": "馬來西亞",
  "維也納": "奧地利", "薩爾斯堡": "奧地利", "哈修塔特": "奧地利",
  "布拉格": "捷克", "庫倫洛夫": "捷克",
  "蘇黎世": "瑞士", "日內瓦": "瑞士", "琉森": "瑞士",
  "羅馬": "義大利", "米蘭": "義大利", "威尼斯": "義大利", "佛羅倫斯": "義大利",
  "巴黎": "法國", "尼斯": "法國", "里昂": "法國",
  "倫敦": "英國", "愛丁堡": "英國",
  "柏林": "德國", "慕尼黑": "德國", "法蘭克福": "德國",
  "巴塞隆納": "西班牙", "馬德里": "西班牙",
  "雅典": "希臘", "聖托里尼": "希臘",
  "伊斯坦堡": "土耳其", "卡帕多奇亞": "土耳其",
  "阿姆斯特丹": "荷蘭", "布魯塞爾": "比利時",
  "雷克雅維克": "冰島", "奧斯陸": "挪威",
  "斯德哥爾摩": "瑞典", "哥本哈根": "丹麥", "赫爾辛基": "芬蘭",
  "紐約": "美國", "華盛頓": "美國", "波士頓": "美國", "洛杉磯": "美國",
  "舊金山": "美國", "拉斯維加斯": "美國", "西雅圖": "美國", "邁阿密": "美國",
  "夏威夷": "美國", "阿拉斯加": "美國",
  "溫哥華": "加拿大", "多倫多": "加拿大", "魁北克": "加拿大",
  "雪梨": "澳洲", "墨爾本": "澳洲", "黃金海岸": "澳洲", "布里斯本": "澳洲",
  "奧克蘭": "紐西蘭", "基督城": "紐西蘭", "皇后鎮": "紐西蘭",
  "馬丘比丘": "秘魯", "庫斯科": "秘魯",
  "里約": "巴西", "聖保羅": "巴西", "布宜諾斯艾利斯": "阿根廷",
  // Country names directly
  "英國": "英國", "愛爾蘭": "愛爾蘭", "法國": "法國", "義大利": "義大利",
  "日本": "日本", "韓國": "韓國", "泰國": "泰國", "越南": "越南",
  "美國": "美國", "德國": "德國", "西班牙": "西班牙", "希臘": "希臘",
  "土耳其": "土耳其", "澳洲": "澳洲", "紐西蘭": "紐西蘭", "加拿大": "加拿大",
  "奧地利": "奧地利", "捷克": "捷克", "瑞士": "瑞士",
  "冰島": "冰島", "挪威": "挪威", "瑞典": "瑞典", "丹麥": "丹麥", "芬蘭": "芬蘭",
  "印度": "印度", "尼泊爾": "尼泊爾", "斯里蘭卡": "斯里蘭卡",
  "巴西": "巴西", "阿根廷": "阿根廷", "智利": "智利", "秘魯": "秘魯",
  // Multi-region
  "奧捷": "奧地利", "北歐": "挪威", "東歐": "捷克", "南歐": "義大利", "西歐": "法國",
  "美東": "美國", "美西": "美國", "美加": "美國",
  "中歐": "德國", "英愛": "英國", "法瑞義": "法國", "德奧": "德國",
  // Taiwan (last)
  "花東": "台灣", "花蓮": "台灣", "台東": "台灣",
  "南投": "台灣", "雲林": "台灣", "嘉義": "台灣", "台南": "台灣",
  "宜蘭": "台灣", "澎湖": "台灣", "金門": "台灣", "馬祖": "台灣",
  "苗栗": "台灣", "彰化": "台灣", "屏東": "台灣",
  "新竹": "台灣", "新北": "台灣", "基隆": "台灣",
  "阿里山": "台灣", "日月潭": "台灣", "墾丁": "台灣", "太魯閣": "台灣",
  "鳴日號": "台灣",
  "桃園": "台灣", "台北": "台灣", "高雄": "台灣", "台中": "台灣",
};

// City patterns — destination-priority order (rural first, departure cities last)
const CITY_PATTERNS = {
  // Japan
  "北海道": "北海道", "沖縄": "沖繩", "沖繩": "沖繩", "九州": "九州",
  "關西": "關西", "京阪神": "京阪神",
  "東京": "東京", "大阪": "大阪", "京都": "京都", "名古屋": "名古屋",
  "福岡": "福岡", "廣島": "廣島", "神戶": "神戶", "奈良": "奈良", "四國": "四國",
  "那霸": "沖繩", "石垣": "沖繩", "宮古": "沖繩", "與那國": "沖繩",
  // Korea
  "首爾": "首爾", "釜山": "釜山", "濟州": "濟州",
  // SE Asia
  "曼谷": "曼谷", "清邁": "清邁", "普吉": "普吉",
  "河內": "河內", "胡志明": "胡志明", "峴港": "峴港", "下龍灣": "下龍灣",
  "巴里島": "巴里島", "峇里島": "峇里島",
  "馬尼拉": "馬尼拉", "宿霧": "宿霧", "長灘島": "長灘島",
  "吉隆坡": "吉隆坡", "沙巴": "沙巴", "檳城": "檳城",
  // Europe
  "維也納": "維也納", "薩爾斯堡": "薩爾斯堡", "哈修塔特": "哈修塔特",
  "布拉格": "布拉格", "庫倫洛夫": "庫倫洛夫",
  "蘇黎世": "蘇黎世", "日內瓦": "日內瓦", "琉森": "琉森",
  "羅馬": "羅馬", "米蘭": "米蘭", "威尼斯": "威尼斯", "佛羅倫斯": "佛羅倫斯",
  "巴黎": "巴黎", "尼斯": "尼斯", "里昂": "里昂",
  "倫敦": "倫敦", "愛丁堡": "愛丁堡",
  "柏林": "柏林", "慕尼黑": "慕尼黑", "法蘭克福": "法蘭克福",
  "巴塞隆納": "巴塞隆納", "馬德里": "馬德里",
  "雅典": "雅典", "聖托里尼": "聖托里尼",
  "伊斯坦堡": "伊斯坦堡", "卡帕多奇亞": "卡帕多奇亞",
  "阿姆斯特丹": "阿姆斯特丹", "布魯塞爾": "布魯塞爾",
  "雷克雅維克": "雷克雅維克", "奧斯陸": "奧斯陸",
  "斯德哥爾摩": "斯德哥爾摩", "哥本哈根": "哥本哈根", "赫爾辛基": "赫爾辛基",
  // Americas
  "紐約": "紐約", "華盛頓": "華盛頓", "波士頓": "波士頓",
  "洛杉磯": "洛杉磯", "舊金山": "舊金山", "拉斯維加斯": "拉斯維加斯",
  "西雅圖": "西雅圖", "邁阿密": "邁阿密", "夏威夷": "夏威夷", "阿拉斯加": "阿拉斯加",
  "溫哥華": "溫哥華", "多倫多": "多倫多", "魁北克": "魁北克",
  // Oceania
  "雪梨": "雪梨", "墨爾本": "墨爾本", "黃金海岸": "黃金海岸",
  "奧克蘭": "奧克蘭", "基督城": "基督城", "皇后鎮": "皇后鎮",
  // South America
  "馬丘比丘": "馬丘比丘", "庫斯科": "庫斯科",
  "里約": "里約", "聖保羅": "聖保羅", "布宜諾斯艾利斯": "布宜諾斯艾利斯",
  // Taiwan — destination-priority order
  "太魯閣": "花蓮", "七星潭": "花蓮", "瑞穗": "花蓮",
  "知本": "台東", "綠島": "台東", "蘭嶼": "台東", "池上": "台東",
  "阿里山": "阿里山", "日月潭": "日月潭", "墾丁": "墾丁",
  "礁溪": "宜蘭", "羅東": "宜蘭",
  "南投": "南投", "雲林": "雲林", "嘉義": "嘉義", "台南": "台南",
  "宜蘭": "宜蘭", "花蓮": "花蓮", "台東": "台東", "花東": "花東",
  "澎湖": "澎湖", "金門": "金門", "馬祖": "馬祖",
  "苗栗": "苗栗", "彰化": "彰化", "屏東": "屏東",
  "新竹": "新竹",
  // Departure cities LAST
  "台中": "台中", "高雄": "高雄", "新北": "新北", "基隆": "基隆",
  "桃園": "桃園", "台北": "台北",
};

const CITY_TO_COUNTRY = {
  ...Object.fromEntries(Object.entries(CITY_PATTERNS).map(([k, v]) => [v, ""])),
  // Japan
  "北海道": "日本", "沖繩": "日本", "九州": "日本", "東京": "日本", "大阪": "日本",
  "京都": "日本", "名古屋": "日本", "福岡": "日本", "廣島": "日本", "神戶": "日本",
  "奈良": "日本", "四國": "日本", "關西": "日本", "京阪神": "日本",
  // Others
  "首爾": "韓國", "釜山": "韓國", "濟州": "韓國",
  "曼谷": "泰國", "清邁": "泰國", "普吉": "泰國",
  "河內": "越南", "胡志明": "越南", "峴港": "越南", "下龍灣": "越南",
  "巴里島": "印尼", "峇里島": "印尼",
  "馬尼拉": "菲律賓", "宿霧": "菲律賓", "長灘島": "菲律賓",
  "吉隆坡": "馬來西亞", "沙巴": "馬來西亞", "檳城": "馬來西亞",
  "維也納": "奧地利", "薩爾斯堡": "奧地利", "哈修塔特": "奧地利",
  "布拉格": "捷克", "庫倫洛夫": "捷克",
  "蘇黎世": "瑞士", "日內瓦": "瑞士", "琉森": "瑞士",
  "羅馬": "義大利", "米蘭": "義大利", "威尼斯": "義大利", "佛羅倫斯": "義大利",
  "巴黎": "法國", "尼斯": "法國", "里昂": "法國",
  "倫敦": "英國", "愛丁堡": "英國",
  "柏林": "德國", "慕尼黑": "德國", "法蘭克福": "德國",
  "巴塞隆納": "西班牙", "馬德里": "西班牙",
  "雅典": "希臘", "聖托里尼": "希臘",
  "伊斯坦堡": "土耳其", "卡帕多奇亞": "土耳其",
  "阿姆斯特丹": "荷蘭", "布魯塞爾": "比利時",
  "雷克雅維克": "冰島", "奧斯陸": "挪威",
  "斯德哥爾摩": "瑞典", "哥本哈根": "丹麥", "赫爾辛基": "芬蘭",
  "紐約": "美國", "華盛頓": "美國", "波士頓": "美國",
  "洛杉磯": "美國", "舊金山": "美國", "拉斯維加斯": "美國", "西雅圖": "美國",
  "邁阿密": "美國", "夏威夷": "美國", "阿拉斯加": "美國",
  "溫哥華": "加拿大", "多倫多": "加拿大", "魁北克": "加拿大",
  "雪梨": "澳洲", "墨爾本": "澳洲", "黃金海岸": "澳洲",
  "奧克蘭": "紐西蘭", "基督城": "紐西蘭", "皇后鎮": "紐西蘭",
  "馬丘比丘": "秘魯", "庫斯科": "秘魯",
  "里約": "巴西", "聖保羅": "巴西", "布宜諾斯艾利斯": "阿根廷",
  // Taiwan
  "南投": "台灣", "雲林": "台灣", "嘉義": "台灣", "台南": "台灣",
  "宜蘭": "台灣", "花蓮": "台灣", "台東": "台灣", "花東": "台灣",
  "澎湖": "台灣", "金門": "台灣", "馬祖": "台灣",
  "苗栗": "台灣", "彰化": "台灣", "屏東": "台灣", "新竹": "台灣",
  "阿里山": "台灣", "日月潭": "台灣", "墾丁": "台灣",
  "台中": "台灣", "高雄": "台灣", "新北": "台灣", "基隆": "台灣",
  "桃園": "台灣", "台北": "台灣",
};

async function fetchLion(normGroupId) {
  try {
    const resp = await fetch(`${LION_BASE}/detail/travelinfojson`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0",
        Referer: `${LION_BASE}/detail?NormGroupID=${normGroupId}`,
      },
      body: new URLSearchParams({ NormGroupID: normGroupId }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const gi = data?.GroupInfo ?? {};
    if (!gi.GroupID) return null;
    const departureCity = (gi.StartFromCityList ?? [])[0]?.CityName || "";

    // Also fetch dailyItinerary for richer city detection
    const dayResp = await fetch(`${LION_BASE}/detail/daytripinfojson`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0",
        Referer: `${LION_BASE}/detail?NormGroupID=${normGroupId}`,
      },
      body: new URLSearchParams({
        NormGroupID: normGroupId,
        GroupID: gi.GroupID,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    let itineraryText = "";
    if (dayResp.ok) {
      const dayData = await dayResp.json();
      const dailyList = dayData?.DailyList ?? [];
      itineraryText = dailyList
        .map((d) => [d.TravelPoint || "", d.Summary || ""].join(" "))
        .join(" ");
    }

    return {
      tourName: gi.TourName || "",
      country: gi.Country || "",
      departureCity,
      arriveAirport: gi.GoArriveAirport || "",
      itineraryText,
    };
  } catch {
    return null;
  }
}

function detect(lionData) {
  // Build search text — strip departure city
  const searchText = [
    lionData.tourName,
    lionData.itineraryText,
    lionData.arriveAirport,
  ]
    .join(" ")
    .replace(new RegExp(lionData.departureCity || "___NEVER___", "g"), "");

  // Country detection: Pass 1 keyword first
  let country = "";
  for (const [kw, c] of Object.entries(COUNTRY_PATTERNS)) {
    if (searchText.includes(kw)) {
      country = c;
      break;
    }
  }
  // Pass 0 fallback (skip TW)
  if (!country && lionData.country && lionData.country !== "TW") {
    const iso = {
      JP: "日本", KR: "韓國", CN: "中國", HK: "香港", MO: "澳門",
      TH: "泰國", VN: "越南", PH: "菲律賓", MY: "馬來西亞", ID: "印尼",
      SG: "新加坡", IN: "印度", US: "美國", CA: "加拿大", MX: "墨西哥",
      GB: "英國", FR: "法國", IT: "義大利", DE: "德國", ES: "西班牙",
      AT: "奧地利", CZ: "捷克", CH: "瑞士", AU: "澳洲", NZ: "紐西蘭",
      BR: "巴西", AR: "阿根廷",
    };
    if (iso[lionData.country]) country = iso[lionData.country];
  }

  // City detection: Pass 1 same-country match
  let city = "";
  for (const [kw, c] of Object.entries(CITY_PATTERNS)) {
    if (searchText.includes(kw)) {
      const cc = CITY_TO_COUNTRY[c];
      if (!cc || !country || cc === country) {
        city = c;
        break;
      }
    }
  }

  // Backfill country from city if empty
  if (city && !country && CITY_TO_COUNTRY[city]) {
    country = CITY_TO_COUNTRY[city];
  }

  return { country, city };
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log(`Mode: ${APPLY ? "APPLY (will write to DB)" : "DRY RUN"}\n`);

const conn = await mysql.createConnection(DATABASE_URL);
const [rows] = await conn.execute(
  `SELECT id, title, sourceUrl, destinationCountry, destinationCity
   FROM tours WHERE sourceUrl LIKE '%liontravel%' ORDER BY id`
);

console.log(`Scanning ${rows.length} liontravel tours...\n`);

let toUpdate = [];
for (const t of rows) {
  const m = t.sourceUrl?.match(/NormGroupID=([a-f0-9-]{36})/i);
  if (!m) continue;
  const normGroupId = m[1];
  const lionData = await fetchLion(normGroupId);
  if (!lionData) {
    console.log(`  [${t.id}] SKIP - Lion API failed`);
    continue;
  }
  const newDetect = detect(lionData);
  const sameCountry = (t.destinationCountry || "").trim() === newDetect.country;
  const sameCity = (t.destinationCity || "").trim() === newDetect.city;

  if (sameCountry && sameCity) {
    console.log(`  [${t.id}] OK - ${t.destinationCountry}/${t.destinationCity}`);
    continue;
  }
  if (!newDetect.country || !newDetect.city) {
    console.log(`  [${t.id}] SKIP - new detection empty`);
    continue;
  }

  toUpdate.push({
    id: t.id,
    title: t.title?.substring(0, 40),
    oldCountry: t.destinationCountry,
    oldCity: t.destinationCity,
    newCountry: newDetect.country,
    newCity: newDetect.city,
  });
  console.log(
    `  [${t.id}] WILL UPDATE - "${t.destinationCountry}/${t.destinationCity}" → "${newDetect.country}/${newDetect.city}"`
  );
  console.log(`           (title: ${t.title?.substring(0, 60)})`);
  await new Promise((r) => setTimeout(r, 200));
}

console.log(`\nFound ${toUpdate.length} tours to update.\n`);

if (APPLY && toUpdate.length > 0) {
  for (const u of toUpdate) {
    await conn.execute(
      "UPDATE tours SET destinationCountry = ?, destinationCity = ?, destination = ? WHERE id = ?",
      [u.newCountry, u.newCity, u.newCity || u.newCountry, u.id]
    );
    console.log(`  ✓ updated [${u.id}]`);
  }
  console.log(`\n✅ Applied ${toUpdate.length} updates`);
} else if (!APPLY) {
  console.log("Dry run only — pass --apply to write changes");
}

await conn.end();
