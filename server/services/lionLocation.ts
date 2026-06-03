/**
 * deriveLocation — recover the real destination country + city for a
 * supplier tour from its OWN data (title + itinerary), because the import
 * trusted the supplier's unreliable `country` field (e.g. Lion returned TW
 * for China/US tours — see lionBulkImportService.ts:105).
 *
 * NO GUESSING. Country is emitted only when the signals support it:
 *   - title country + itinerary agree, OR
 *   - itinerary alone has >=2 same-country tokens with no foreign conflict, OR
 *   - a Taiwan-county title with ZERO foreign tokens in the itinerary
 *     (a domestic Taiwan tour). Otherwise ABSTAIN (country=null) and the row
 *     is flagged — never written with a guess.
 *
 * Ambiguous tokens are deliberately EXCLUDED so they can't cast a wrong vote:
 *   - 迪士尼/環球影城 (multiple countries)
 *   - 三峽/千島湖 (長江三峽/浙江千島湖 in China collide with 新北三峽/石碇千島湖
 *     in Taiwan)
 */

export interface TourInput {
  id?: number;
  title: string;
  dayTitles?: string[];
  locations?: string[];
}

export interface DerivedLocation {
  country: string | null;
  city: string | null;
  confidence: "high" | "abstain";
  reason: string;
}

// Taiwan departure tokens — where tours DEPART from. Excluded from itinerary
// voting so a Taipei departure can't make an international tour look Taiwanese.
const DEPARTURES = [
  "台北桃園機場", "桃園機場", "松山機場", "台北車站", "台北火車站",
  "高鐵", "新烏日", "新左營",
];

// keyword -> country. Every entry is an unambiguous, verifiable geographic
// fact. Substring match against title and itinerary location strings.
const GAZETTEER: Array<[string, string]> = [
  // --- 美國 (US) ---
  ["美西", "美國"], ["美東", "美國"], ["美國", "美國"], ["關島", "美國"],
  ["夏威夷", "美國"], ["洛杉磯", "美國"], ["舊金山", "美國"], ["拉斯維加斯", "美國"],
  ["優勝美地", "美國"], ["羚羊峽谷", "美國"], ["馬蹄灣", "美國"],
  ["棕櫚泉", "美國"], ["聖塔莫尼卡", "美國"], ["布萊斯", "美國"], ["錫安", "美國"],
  ["黃石", "美國"], ["西雅圖", "美國"], ["紐約", "美國"], ["波士頓", "美國"],
  ["華盛頓", "美國"], ["奧蘭多", "美國"], ["邁阿密", "美國"], ["好萊塢", "美國"],
  ["聖地牙哥", "美國"], ["大瑟爾", "美國"], ["優聖美地", "美國"], ["賭城", "美國"],
  ["Hollywood", "美國"], ["San Francisco", "美國"], ["Los Angeles", "美國"],
  ["Las Vegas", "美國"], ["Yosemite", "美國"], ["Grand Canyon", "美國"],
  ["Golden Gate", "美國"], ["Guam", "美國"], ["Hawaii", "美國"], ["New York", "美國"],
  ["Griffith", "美國"], ["Santa Monica", "美國"],
  // --- 中國 (China) --- (三峽/千島湖 excluded: collide with Taiwan places)
  ["黃山", "中國"], ["杭州", "中國"], ["重慶", "中國"], ["張家界", "中國"],
  ["九寨溝", "中國"], ["成都", "中國"], ["上海", "中國"], ["烏鎮", "中國"],
  ["江南", "中國"], ["江西", "中國"], ["武隆", "中國"], ["鳳凰古城", "中國"],
  ["天門山", "中國"], ["峨眉", "中國"], ["樂山", "中國"], ["北京", "中國"],
  ["西安", "中國"], ["雲南", "中國"], ["昆明", "中國"], ["麗江", "中國"],
  ["大理", "中國"], ["香格里拉", "中國"], ["桂林", "中國"], ["陽朔", "中國"],
  ["廈門", "中國"], ["蘇州", "中國"], ["黃龍", "中國"], ["牟尼溝", "中國"],
  ["屯溪", "中國"], ["宏村", "中國"], ["歙縣", "中國"], ["恩施", "中國"],
  ["湘西", "中國"], ["芙蓉古鎮", "中國"], ["洪崖洞", "中國"], ["解放碑", "中國"],
  ["黃浦江", "中國"], ["外灘", "中國"], ["疊溪", "中國"], ["松潘", "中國"],
  ["仙女山", "中國"], ["瓷都", "中國"], ["景德鎮", "中國"], ["貴州", "中國"],
  ["馬嶺河", "中國"], ["黃果樹", "中國"], ["西江", "中國"], ["千戶苗寨", "中國"],
  ["苗寨", "中國"], ["天龍屯堡", "中國"], ["屯堡", "中國"], ["梵淨山", "中國"],
  ["荔波", "中國"], ["無錫", "中國"], ["拈花灣", "中國"], ["蘇杭", "中國"],
  // --- 日本 (Japan) ---
  ["沖繩", "日本"], ["那霸", "日本"], ["大阪", "日本"], ["京都", "日本"],
  ["奈良", "日本"], ["北海道", "日本"], ["東京", "日本"], ["富士", "日本"],
  ["名古屋", "日本"], ["白川鄉", "日本"], ["合掌村", "日本"], ["立山", "日本"],
  ["北陸", "日本"], ["四國", "日本"], ["九州", "日本"], ["福岡", "日本"],
  ["別府", "日本"], ["由布院", "日本"], ["熊本", "日本"], ["鹿兒島", "日本"],
  ["廣島", "日本"], ["神戶", "日本"], ["橫濱", "日本"], ["箱根", "日本"],
  ["輕井澤", "日本"], ["日光", "日本"], ["仙台", "日本"], ["函館", "日本"],
  ["小樽", "日本"], ["札幌", "日本"], ["石垣島", "日本"], ["宮古島", "日本"],
  ["古宇利", "日本"], ["美麗海", "日本"], ["首里", "日本"], ["伏見稻荷", "日本"],
  ["瀨長島", "日本"], ["北谷", "日本"], ["南城", "日本"], ["今歸仁", "日本"],
  ["國頭郡", "日本"], ["近江八幡", "日本"], ["滋賀", "日本"], ["關西", "日本"],
  // --- 港澳 + 亞洲 (so outbound tours sold at a Taiwan expo, e.g.
  //     "台中旅展．澳門自由行", resolve to the real country, not 台灣) ---
  ["香港", "香港"], ["九龍", "香港"], ["尖沙咀", "香港"], ["銅鑼灣", "香港"],
  ["澳門", "澳門"], ["氹仔", "澳門"], ["路氹", "澳門"],
  ["首爾", "韓國"], ["釜山", "韓國"], ["濟州", "韓國"], ["慶州", "韓國"], ["江原道", "韓國"],
  ["曼谷", "泰國"], ["清邁", "泰國"], ["清萊", "泰國"], ["普吉", "泰國"], ["芭達雅", "泰國"],
  ["華欣", "泰國"], ["北碧", "泰國"], ["桂河", "泰國"], ["蘇美", "泰國"], ["甲米", "泰國"],
  ["河內", "越南"], ["胡志明", "越南"], ["峴港", "越南"], ["下龍", "越南"], ["會安", "越南"],
  ["芽莊", "越南"], ["富國島", "越南"], ["大叻", "越南"],
  ["新加坡", "新加坡"], ["聖淘沙", "新加坡"],
  ["吉隆坡", "馬來西亞"], ["檳城", "馬來西亞"], ["沙巴", "馬來西亞"], ["亞庇", "馬來西亞"], ["蘭卡威", "馬來西亞"],
  ["峇里島", "印尼"], ["雅加達", "印尼"], ["勿里洞", "印尼"], ["日惹", "印尼"],
  ["宿霧", "菲律賓"], ["長灘島", "菲律賓"], ["馬尼拉", "菲律賓"], ["巴拉望", "菲律賓"],
  ["吳哥窟", "柬埔寨"], ["暹粒", "柬埔寨"], ["金邊", "柬埔寨"],
  ["馬爾地夫", "馬爾地夫"], ["印度", "印度"], ["尼泊爾", "尼泊爾"], ["斯里蘭卡", "斯里蘭卡"],
  ["杜拜", "阿聯"], ["阿布達比", "阿聯"], ["土耳其", "土耳其"], ["伊斯坦堡", "土耳其"],
  ["卡帕多奇亞", "土耳其"], ["埃及", "埃及"], ["開羅", "埃及"], ["摩洛哥", "摩洛哥"],
  // --- 歐洲 ---
  ["西班牙", "西班牙"], ["馬德里", "西班牙"], ["巴塞隆納", "西班牙"],
  ["英國", "英國"], ["倫敦", "英國"], ["愛丁堡", "英國"],
  ["法國", "法國"], ["巴黎", "法國"], ["尼斯", "法國"],
  ["義大利", "義大利"], ["羅馬", "義大利"], ["威尼斯", "義大利"], ["佛羅倫斯", "義大利"], ["米蘭", "義大利"],
  ["德國", "德國"], ["慕尼黑", "德國"], ["柏林", "德國"], ["法蘭克福", "德國"],
  ["瑞士", "瑞士"], ["蘇黎世", "瑞士"], ["琉森", "瑞士"], ["策馬特", "瑞士"],
  ["荷蘭", "荷蘭"], ["阿姆斯特丹", "荷蘭"], ["奧地利", "奧地利"], ["維也納", "奧地利"], ["薩爾斯堡", "奧地利"],
  ["希臘", "希臘"], ["雅典", "希臘"], ["聖托里尼", "希臘"], ["捷克", "捷克"], ["布拉格", "捷克"],
  ["匈牙利", "匈牙利"], ["布達佩斯", "匈牙利"], ["葡萄牙", "葡萄牙"], ["里斯本", "葡萄牙"],
  ["挪威", "挪威"], ["瑞典", "瑞典"], ["丹麥", "丹麥"], ["芬蘭", "芬蘭"], ["冰島", "冰島"],
  // --- 美洲 + 大洋洲 ---
  ["加拿大", "加拿大"], ["溫哥華", "加拿大"], ["多倫多", "加拿大"], ["班夫", "加拿大"],
  ["卡加利", "加拿大"], ["洛磯山", "加拿大"], ["尼加拉", "加拿大"],
  ["墨西哥", "墨西哥"], ["坎昆", "墨西哥"], ["秘魯", "秘魯"], ["馬丘比丘", "秘魯"], ["庫斯科", "秘魯"],
  ["智利", "智利"], ["阿根廷", "阿根廷"], ["巴西", "巴西"], ["哥斯大黎加", "哥斯大黎加"],
  ["澳洲", "澳洲"], ["雪梨", "澳洲"], ["墨爾本", "澳洲"], ["布里斯本", "澳洲"], ["凱恩斯", "澳洲"], ["黃金海岸", "澳洲"],
  ["紐西蘭", "紐西蘭"], ["奧克蘭", "紐西蘭"], ["皇后鎮", "紐西蘭"],
  // --- 台灣 (Taiwan) — counties + unambiguous domestic landmarks ---
  ["宜蘭", "台灣"], ["花蓮", "台灣"], ["台東", "台灣"], ["臺東", "台灣"],
  ["台南", "台灣"], ["臺南", "台灣"], ["台中", "台灣"], ["臺中", "台灣"],
  ["新北", "台灣"], ["新竹", "台灣"], ["苗栗", "台灣"], ["彰化", "台灣"],
  ["南投", "台灣"], ["雲林", "台灣"], ["嘉義", "台灣"], ["屏東", "台灣"],
  ["基隆", "台灣"], ["澎湖", "台灣"], ["金門", "台灣"], ["馬祖", "台灣"],
  ["連江", "台灣"], ["小琉球", "台灣"], ["桃園", "台灣"], ["高雄", "台灣"],
  ["阿里山", "台灣"], ["太魯閣", "台灣"], ["日月潭", "台灣"], ["墾丁", "台灣"],
  ["太平山", "台灣"], ["清水斷崖", "台灣"], ["高美濕地", "台灣"], ["奮起湖", "台灣"],
  ["翠峰湖", "台灣"], ["合歡山", "台灣"], ["野柳", "台灣"], ["九份", "台灣"],
  ["十分", "台灣"], ["平溪", "台灣"], ["烏來", "台灣"], ["礁溪", "台灣"],
  ["知本", "台灣"], ["鵝鑾鼻", "台灣"], ["鎮西堡", "台灣"], ["司馬庫斯", "台灣"],
  ["綠島", "台灣"], ["蘭嶼", "台灣"], ["龜山島", "台灣"], ["鯉魚潭", "台灣"],
  ["七美", "台灣"], ["東引", "台灣"], ["南竿", "台灣"], ["北竿", "台灣"],
  ["大坵", "台灣"], ["祥德寺", "台灣"], ["太興", "台灣"],
];

// Region-level keywords we avoid emitting AS a city (we want the actual city).
const REGION_WORDS = new Set([
  "美西", "美東", "美國", "中國", "日本", "江南", "雲南", "湘西", "北陸",
  "四國", "九州", "關西", "北海道", "貴州", "夏威夷", "江西",
  // foreign country-names (use a real city as the city instead)
  "韓國", "泰國", "越南", "馬來西亞", "印尼", "菲律賓", "柬埔寨", "印度",
  "尼泊爾", "斯里蘭卡", "阿聯", "土耳其", "埃及", "摩洛哥", "西班牙", "英國",
  "法國", "義大利", "德國", "瑞士", "荷蘭", "奧地利", "希臘", "捷克", "匈牙利",
  "葡萄牙", "挪威", "瑞典", "丹麥", "芬蘭", "冰島", "加拿大", "墨西哥", "秘魯",
  "智利", "阿根廷", "巴西", "哥斯大黎加", "澳洲", "紐西蘭",
]);

function isDeparture(s: string): boolean {
  return DEPARTURES.some((d) => s.includes(d));
}

/** All countries whose gazetteer keyword appears in `text`. */
function countriesIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const [kw, country] of GAZETTEER) {
    if (text.includes(kw)) out.add(country);
  }
  return out;
}

/** Per-country token counts across itinerary locations (departures excluded). */
function countsByCountry(locations: string[]): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const loc of locations) {
    if (!loc || isDeparture(loc)) continue;
    for (const c of countriesIn(loc)) tally[c] = (tally[c] || 0) + 1;
  }
  return tally;
}

/** Country from the title; null if zero or conflicting keywords. */
function countryFromTitle(title: string): string | null {
  const cs = [...countriesIn(title)];
  return cs.length === 1 ? cs[0] : null;
}

/** First gazetteer CITY keyword (of `country`) in `text`, clean canonical form. */
function cityKeywordIn(text: string, country: string): string | null {
  for (const [kw, c] of GAZETTEER) {
    if (c === country && !REGION_WORDS.has(kw) && text.includes(kw)) return kw;
  }
  return null;
}

export function deriveLocation(input: TourInput): DerivedLocation {
  const title = input.title || "";
  const locations = (input.locations || []).filter(Boolean);
  const dayTitles = input.dayTitles || [];

  const titleCountry = countryFromTitle(title);
  const counts = countsByCountry(locations);
  const foreign = Object.keys(counts).filter((c) => c !== "台灣");
  const twTokens = counts["台灣"] || 0;

  // Country decision (no guessing):
  let country: string | null = null;
  let reason = "";
  if (foreign.length >= 2) {
    reason = "abstain: itinerary spans multiple foreign countries";
  } else if (titleCountry) {
    if (foreign.length === 1) {
      if (foreign[0] === titleCountry) {
        country = titleCountry;
        reason = `title+itinerary agree (${counts[foreign[0]]} tokens)`;
      } else {
        reason = `abstain: title(${titleCountry}) vs itinerary(${foreign[0]}) conflict`;
      }
    } else {
      // no foreign country in the itinerary
      if (titleCountry === "台灣") {
        country = "台灣";
        reason = "Taiwan-county title, zero foreign tokens (domestic)";
      } else {
        reason = `abstain: title says ${titleCountry}, itinerary gives no confirming token`;
      }
    }
  } else {
    // no single title country
    if (foreign.length === 1 && counts[foreign[0]] >= 2) {
      country = foreign[0];
      reason = `itinerary-only, ${counts[foreign[0]]} same-country tokens`;
    } else if (foreign.length === 0 && twTokens >= 2) {
      country = "台灣";
      reason = `itinerary-only Taiwan, ${twTokens} tokens`;
    } else {
      reason = "abstain: no usable signal";
    }
  }

  // City: from day-titles first (the "台北 → 那霸" entry city), then the title
  // (Taiwan counties live there). NEVER from raw `locations` — landmark/
  // nickname tokens there cause false hits. Abstain (null) if none found.
  let city: string | null = null;
  if (country) {
    const day1 = dayTitles[0] || "";
    if (country === "台灣") {
      // Taiwan: the county named in the title is the standard destinationCity
      // (宜蘭/花蓮/嘉義…), preferred over a scenic spot from the day-titles.
      city =
        cityKeywordIn(title, country) ||
        cityKeywordIn(day1, country) ||
        cityKeywordIn(dayTitles.join("  "), country);
    } else {
      // International: the entry city from the day-1 title ("台北 → 那霸").
      city =
        cityKeywordIn(day1, country) ||
        cityKeywordIn(dayTitles.join("  "), country) ||
        cityKeywordIn(title, country);
    }
  }

  return {
    country,
    city,
    confidence: country ? "high" : "abstain",
    reason,
  };
}
