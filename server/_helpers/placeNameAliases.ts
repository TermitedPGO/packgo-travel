/**
 * placeNameAliases — Round 80.21 v10.
 *
 * Lion Travel and similar OTA sources sometimes use non-standard
 * Chinese transliterations of foreign place names that Google's
 * geocoder cannot resolve. Examples:
 *
 *   Lion form  →  Standard / English
 *   ─────────────────────────────────
 *   蒙投       →  蒙特勒 / Montreux
 *   冰河3000   →  Glacier 3000 / Les Diablerets
 *   西庸古堡   →  希永城堡 / Château de Chillon
 *
 * Our AI agents (ContentAnalyzer / ItineraryUnified) currently pass
 * these through verbatim, so the route map can't geocode them.
 *
 * This dictionary is checked when a candidate query fails. For each
 * known alias, we add ENGLISH and STANDARD-CHINESE forms to the
 * candidate list, giving the geocoder a fighting chance.
 *
 * Long-term: this should be replaced by an AI normalization step
 * during tour generation (so the data is clean at the source). Until
 * then, this dictionary is a low-cost surgical fix.
 */

export interface PlaceAlias {
  /** English name (most reliable for Google) */
  en: string;
  /** Standard / canonical Chinese name */
  zh?: string;
}

/**
 * Lion / OTA non-standard name → canonical forms.
 * Keys are the literal strings we see in tour data; values are what
 * Google will actually recognize.
 */
export const PLACE_ALIASES: Record<string, PlaceAlias> = {
  // ─── Switzerland ───────────────────────────────────────────────
  "蒙投": { en: "Montreux", zh: "蒙特勒" },
  "西庸古堡": { en: "Château de Chillon", zh: "希永城堡" },
  "冰河3000": { en: "Glacier 3000", zh: "格拉西耶 3000" },
  "黃金列車": { en: "Zweisimmen, Switzerland", zh: "茨魏西門" }, // GoldenPass route hub
  "冰河列車": { en: "Andermatt, Switzerland", zh: "安德馬特" }, // Glacier Express hub
  "伊瑟爾特瓦爾德": { en: "Iseltwald", zh: "伊瑟爾瓦爾德" },
  "菲斯特": { en: "Grindelwald First", zh: "菲爾斯特" },
  "茨魏西門": { en: "Zweisimmen" },
  "因特拉肯": { en: "Interlaken" },
  "策馬特": { en: "Zermatt" },
  "馬特洪峰": { en: "Matterhorn, Zermatt" },
  "鐵力士山": { en: "Mount Titlis" },
  "瓦萊州": { en: "Sion, Valais", zh: "錫永" },
  "聖加侖": { en: "Saint Gallen", zh: "聖加侖" },
  "聖莫里茲": { en: "St. Moritz" },
  "盧森": { en: "Lucerne", zh: "琉森" },
  "琉森": { en: "Lucerne" },
  "蘇黎世": { en: "Zürich" },

  // ─── Germany / Bavaria ─────────────────────────────────────────
  "林島": { en: "Lindau, Bavaria", zh: "林道" },
  "新天鵝堡": { en: "Neuschwanstein Castle" },
  "楚格峰": { en: "Zugspitze" },
  "黑森林": { en: "Black Forest, Germany" },
  "羅曼蒂克大道": { en: "Romantic Road, Germany" },
  "羅滕堡": { en: "Rothenburg ob der Tauber" },
  "海德堡": { en: "Heidelberg" },
  "巴伐利亞": { en: "Bavaria" },

  // ─── France ────────────────────────────────────────────────────
  "凡爾賽宮": { en: "Palace of Versailles" },
  "羅亞爾河": { en: "Loire Valley" },
  "羅亞爾河谷": { en: "Loire Valley" },
  "蒙馬特": { en: "Montmartre, Paris" },
  "聖米歇爾山": { en: "Mont-Saint-Michel" },
  "尼斯": { en: "Nice, France" },
  "坎城": { en: "Cannes" },
  "亞維儂": { en: "Avignon" },
  "里昂": { en: "Lyon" },
  "馬賽": { en: "Marseille" },
  "波爾多": { en: "Bordeaux" },
  "史特拉斯堡": { en: "Strasbourg" },
  "杜爾": { en: "Tours, France", zh: "圖爾" },
  "雪儂梭": { en: "Château de Chenonceau", zh: "舍農索堡" },
  "沙特爾": { en: "Chartres" },
  "巴斯底": { en: "Bastille, Paris" },

  // ─── Italy ─────────────────────────────────────────────────────
  "比薩": { en: "Pisa" },
  "佛羅倫斯": { en: "Florence" },
  "西恩納": { en: "Siena" },
  "五漁村": { en: "Cinque Terre" },
  "索倫托": { en: "Sorrento" },
  "卡布里": { en: "Capri" },
  "阿瑪菲": { en: "Amalfi" },
  "龐貝": { en: "Pompeii" },
  "西西里": { en: "Sicily" },
  "米蘭大教堂": { en: "Duomo di Milano, Milan" },

  // ─── Austria ───────────────────────────────────────────────────
  "薩爾斯堡": { en: "Salzburg" },
  "因斯布魯克": { en: "Innsbruck" },
  "哈修塔特": { en: "Hallstatt" },

  // ─── UK / Ireland ──────────────────────────────────────────────
  "愛丁堡": { en: "Edinburgh" },
  "巨人堤道": { en: "Giant's Causeway" },
  "巴斯": { en: "Bath, UK" },
  "牛津": { en: "Oxford" },
  "劍橋": { en: "Cambridge, UK" },
  "都柏林": { en: "Dublin" },

  // ─── Eastern Europe ────────────────────────────────────────────
  "布拉格": { en: "Prague" },
  "庫倫洛夫": { en: "Český Krumlov" },
  "克魯姆洛夫": { en: "Český Krumlov" },
  "布達佩斯": { en: "Budapest" },
  "華沙": { en: "Warsaw" },
  "克拉科夫": { en: "Kraków" },

  // ─── Scandinavia ───────────────────────────────────────────────
  "斯德哥爾摩": { en: "Stockholm" },
  "哥本哈根": { en: "Copenhagen" },
  "奧斯陸": { en: "Oslo" },
  "卑爾根": { en: "Bergen, Norway" },
  "雷克雅維克": { en: "Reykjavík" },
  "塔林": { en: "Tallinn" },
  "赫爾辛基": { en: "Helsinki" },

  // ─── Japan ─────────────────────────────────────────────────────
  "富士山": { en: "Mount Fuji" },
  "箱根": { en: "Hakone" },
  "鎌倉": { en: "Kamakura" },
  "日光": { en: "Nikko" },
  "輕井澤": { en: "Karuizawa" },
  "白川鄉": { en: "Shirakawa-go" },
  "高山": { en: "Takayama" },
  "金澤": { en: "Kanazawa" },
  "嚴島": { en: "Itsukushima Shrine" },
  "宮島": { en: "Miyajima" },
  "倉敷": { en: "Kurashiki" },
  "美瑛": { en: "Biei, Hokkaido" },
  "富良野": { en: "Furano" },
  "小樽": { en: "Otaru" },
  "函館": { en: "Hakodate" },
  "登別": { en: "Noboribetsu" },
  "洞爺湖": { en: "Lake Toya" },

  // ─── Korea ─────────────────────────────────────────────────────
  "首爾": { en: "Seoul" },
  "釜山": { en: "Busan" },
  "濟州島": { en: "Jeju Island" },

  // ─── USA ───────────────────────────────────────────────────────
  "舊金山": { en: "San Francisco" },
  "洛杉磯": { en: "Los Angeles" },
  "紐約": { en: "New York" },
  "拉斯維加斯": { en: "Las Vegas" },
  "西雅圖": { en: "Seattle" },
  "波士頓": { en: "Boston" },
  "華盛頓": { en: "Washington DC" },
  "黃石": { en: "Yellowstone National Park" },
  "黃石公園": { en: "Yellowstone National Park" },
  "優勝美地": { en: "Yosemite" },
  "大峽谷": { en: "Grand Canyon" },
  "羚羊峽谷": { en: "Antelope Canyon" },
  "馬蹄灣": { en: "Horseshoe Bend, Arizona" },
  "夏威夷": { en: "Hawaii" },
  "歐胡島": { en: "Oahu" },
  "茂宜島": { en: "Maui" },
  "大島": { en: "Big Island, Hawaii" },
  "可愛島": { en: "Kauai" },
  "棕櫚泉": { en: "Palm Springs" },
  "聖地牙哥": { en: "San Diego" },
  "蒙特雷": { en: "Monterey" },
  "納帕": { en: "Napa Valley" },
  "好萊塢": { en: "Hollywood" },

  // ─── Canada ────────────────────────────────────────────────────
  "溫哥華": { en: "Vancouver" },
  "多倫多": { en: "Toronto" },
  "蒙特婁": { en: "Montreal" },
  "渥太華": { en: "Ottawa" },
  "魁北克": { en: "Quebec City" },
  "班夫": { en: "Banff" },
  "露易絲湖": { en: "Lake Louise" },
  "尼加拉瓜瀑布": { en: "Niagara Falls" },

  // ─── Southeast Asia / Tropical ─────────────────────────────────
  "峇里島": { en: "Bali" },
  "巴里島": { en: "Bali" },
  "普吉島": { en: "Phuket" },
  "蘇美島": { en: "Koh Samui" },
  "清邁": { en: "Chiang Mai" },
  "下龍灣": { en: "Ha Long Bay" },
  "胡志明市": { en: "Ho Chi Minh City" },
  "順化": { en: "Hue, Vietnam" },
  "暹粒": { en: "Siem Reap" },
  "吳哥窟": { en: "Angkor Wat" },
  "馬尼拉": { en: "Manila" },
  "宿霧": { en: "Cebu" },
  "長灘島": { en: "Boracay" },
};

/**
 * Get all geocoder-friendly aliases for a Chinese place name.
 * Returns an empty array when no alias is known.
 *
 * Usage in candidate generation:
 *   for (const alias of getAliases(cleaned)) {
 *     candidates.push({ q: alias.en, expectedRegion });
 *     if (alias.zh) candidates.push({ q: alias.zh + ", " + countryEn, expectedRegion });
 *   }
 */
export function getAliases(name: string): PlaceAlias[] {
  if (!name) return [];
  const trimmed = name.trim();
  // Direct match
  if (PLACE_ALIASES[trimmed]) return [PLACE_ALIASES[trimmed]];
  // Prefix match — for compound names like "巴黎右岸" we still want
  // alias("巴黎"). Only triggers when the cleaned starts with an alias key.
  for (const [key, alias] of Object.entries(PLACE_ALIASES)) {
    if (trimmed.startsWith(key) && trimmed.length <= key.length + 4) {
      return [alias];
    }
  }
  return [];
}
