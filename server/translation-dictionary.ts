/**
 * Proper Noun Dictionary for Translation Agent
 * 
 * These are official English names for Taiwan tourism proper nouns.
 * Applied BEFORE and AFTER LLM translation to ensure consistency.
 */

export const PROPER_NOUN_DICTIONARY: Record<string, string> = {
  // 台灣鐵路觀光 - Taiwan Rail Tourism
  '鳴日號': 'The Future (NARU)',
  '鳴日廚房': 'The Moving Kitchen',
  '鳴日': 'The Future',
  '藍皮解憂號': 'Blue Skin Carefree Train',
  '環島之星': 'Star of Taiwan',
  '普悠瑪': 'Puyuma Express',
  '太魯閣號': 'Taroko Express',
  '自強號': 'Tze-Chiang Limited Express',

  // 飯店 - Hotels
  '君品collection': 'Palais de Chine Collection',
  '君品酒店': 'Palais de Chine Hotel',
  '瑞穗天合國際觀光酒店': 'Grand Cosmos Resort Ruisui',
  '天合國際觀光酒店': 'Grand Cosmos Resort',
  '晶華酒店': 'Regent Hotel',
  '老爺酒店': 'Royal Hotel',
  '圓山大飯店': 'The Grand Hotel',
  '日月潭涵碧樓': 'The Lalu Sun Moon Lake',
  '長榮桂冠酒店': 'Evergreen Laurel Hotel',
  '福華大飯店': 'Howard Hotel',
  '寒舍艾美酒店': 'Le Méridien Taipei',
  '台北喜來登大飯店': 'Sheraton Grand Taipei Hotel',
  '台北文華東方酒店': 'Mandarin Oriental Taipei',
  '台北君悅酒店': 'Grand Hyatt Taipei',
  '台北W飯店': 'W Taipei',
  '台北101觀景台': 'Taipei 101 Observatory',

  // 台灣地名 - Taiwan Place Names
  '台灣': 'Taiwan',
  '台北': 'Taipei',
  '台中': 'Taichung',
  '台南': 'Tainan',
  '高雄': 'Kaohsiung',
  '花蓮': 'Hualien',
  '南港': 'Nangang',
  '玉里': 'Yuli',
  '瑞穗': 'Ruisui',
  '日月潭': 'Sun Moon Lake',
  '集集': 'Jiji',
  '安平': 'Anping',
  '阿里山': 'Alishan',
  '太魯閣': 'Taroko',
  '墾丁': 'Kenting',
  '九份': 'Jiufen',
  '淡水': 'Tamsui',
  '北投': 'Beitou',
  '石城': 'Shicheng',
  '大里': 'Dali',
  '蘭陽平原': 'Lanyang Plain',
  '龜山島': 'Guishan Island (Turtle Island)',
  '宜蘭': 'Yilan',
  '基隆': 'Keelung',
  '新竹': 'Hsinchu',
  '嘉義': 'Chiayi',
  '屏東': 'Pingtung',
  '澎湖': 'Penghu',
  '金門': 'Kinmen',
  '馬祖': 'Matsu',
  '綠島': 'Green Island',
  '蘭嶼': 'Orchid Island',
  '小琉球': 'Liuqiu Island',
  '烏來': 'Wulai',
  '平溪': 'Pingxi',
  '十分': 'Shifen',
  '野柳': 'Yehliu',
  '三峽': 'Sanxia',
  '鶯歌': 'Yingge',
  '三義': 'Sanyi',
  '溪頭': 'Xitou',

  // 交通 - Transportation
  '觀光列車': 'Sightseeing Train',
  '高鐵': 'HSR (High Speed Rail)',
  '台鐵': 'TRA (Taiwan Railways)',
  '捷運': 'MRT',
  '台灣高鐵': 'Taiwan High Speed Rail (THSR)',
  '台灣鐵路': 'Taiwan Railways Administration (TRA)',

  // 餐食通用 - Meal Names
  '溫暖的家': 'Home-cooked meal',
  '飯店早餐': 'Hotel breakfast',
  '飯店晚餐或同級': 'Hotel dinner or equivalent',
  '移動美學・品味饗宴': 'Moving Aesthetics · Culinary Feast',
  '移動美學．品味饗宴': 'Moving Aesthetics · Culinary Feast',
  '移動美學·品味饗宴': 'Moving Aesthetics · Culinary Feast',
  '自理': 'Own arrangements',
  '含早餐': 'Breakfast included',
  '含午餐': 'Lunch included',
  '含晚餐': 'Dinner included',
  '特色餐廳': 'Local specialty restaurant',

  // 國家 - Countries
  '黑山共和國': 'Montenegro',
  '北馬其頓': 'North Macedonia',
  '波蘭': 'Poland',
  '立陶宛': 'Lithuania',
  '拉脫維亞': 'Latvia',
  '愛沙尼亞': 'Estonia',
  '阿爾巴尼亞': 'Albania',
  '科索沃': 'Kosovo',
  '保加利亞': 'Bulgaria',
  '羅馬尼亞': 'Romania',
  '塞爾維亞': 'Serbia',
  '克羅埃西亞': 'Croatia',
  '斯洛維尼亞': 'Slovenia',
  '波士尼亞': 'Bosnia and Herzegovina',
  '蒙古': 'Mongolia',
  '日本': 'Japan',
  '韓國': 'South Korea',
  '中國': 'China',
  '泰國': 'Thailand',
  '越南': 'Vietnam',
  '柬埔寨': 'Cambodia',
  '馬來西亞': 'Malaysia',
  '新加坡': 'Singapore',
  '印尼': 'Indonesia',
  '菲律賓': 'Philippines',
  '印度': 'India',
  '土耳其': 'Turkey',
  '以色列': 'Israel',
  '約旦': 'Jordan',
  '埃及': 'Egypt',
  '摩洛哥': 'Morocco',
  '南非': 'South Africa',
  '肯亞': 'Kenya',
  '坦尚尼亞': 'Tanzania',
  '義大利': 'Italy',
  '法國': 'France',
  '德國': 'Germany',
  '西班牙': 'Spain',
  '葡萄牙': 'Portugal',
  '英國': 'United Kingdom',
  '荷蘭': 'Netherlands',
  '比利時': 'Belgium',
  '瑞士': 'Switzerland',
  '奧地利': 'Austria',
  '捷克': 'Czech Republic',
  '匈牙利': 'Hungary',
  '希臘': 'Greece',
  '美國': 'United States',
  '加拿大': 'Canada',
  '澳洲': 'Australia',
  '紐西蘭': 'New Zealand',

  // v78p: 歐洲城市 - European Cities (added because tours were leaving these in zh)
  // Switzerland
  '蘇黎世': 'Zürich',
  '伯恩': 'Bern',
  '日內瓦': 'Geneva',
  '洛桑': 'Lausanne',
  '蒙特勒': 'Montreux',
  '蒙投': 'Montreux',
  '巴塞爾': 'Basel',
  '馬特宏峰': 'Matterhorn',
  '策馬特': 'Zermatt',
  '聖莫里茲': 'St. Moritz',
  '茵特拉肯': 'Interlaken',
  '少女峰': 'Jungfrau',
  '冰河快車': 'Glacier Express',
  '冰河3000': 'Glacier 3000',
  '黃金列車': 'Golden Pass Train',
  '聖加侖': 'St. Gallen',
  '伊瑟爾特瓦爾德': 'Iseltwald',
  '菲斯特': 'First',
  '瓦萊州': 'Valais',
  '盧森': 'Luzern',
  '琉森': 'Lucerne',
  '林島': 'Lindau',
  '西庸古堡': 'Chillon Castle',
  // Germany
  '柏林': 'Berlin',
  '慕尼黑': 'Munich',
  '法蘭克福': 'Frankfurt',
  '漢堡': 'Hamburg',
  '科隆': 'Cologne',
  '海德堡': 'Heidelberg',
  '紐倫堡': 'Nuremberg',
  '羅滕堡': 'Rothenburg',
  '德勒斯登': 'Dresden',
  '萊比錫': 'Leipzig',
  '波茨坦': 'Potsdam',
  '黑森林': 'Black Forest',
  '新天鵝堡': 'Neuschwanstein Castle',
  '羅曼蒂克大道': 'Romantic Road',
  // Austria
  '維也納': 'Vienna',
  '薩爾斯堡': 'Salzburg',
  '因斯布魯克': 'Innsbruck',
  '哈爾施塔特': 'Hallstatt',
  // France & Italy & UK
  '巴黎': 'Paris',
  '羅馬': 'Rome',
  '佛羅倫斯': 'Florence',
  '威尼斯': 'Venice',
  '米蘭': 'Milan',
  '比薩': 'Pisa',
  '倫敦': 'London',
  '愛丁堡': 'Edinburgh',
  // USA East Coast (for the 美東 tour)
  '紐約': 'New York',
  '華盛頓': 'Washington DC',
  '華盛頓特區': 'Washington DC',
  '費城': 'Philadelphia',
  '波士頓': 'Boston',
  '尼加拉瀑布': 'Niagara Falls',
  '大都會博物館': 'The Metropolitan Museum of Art',
  '盧雷洞穴': 'Luray Caverns',
  // Japan extras
  '北海道': 'Hokkaido',
  '函館': 'Hakodate',
  '札幌': 'Sapporo',
  '小樽': 'Otaru',
  '登別': 'Noboribetsu',
  '富士山': 'Mt. Fuji',
  '福岡': 'Fukuoka',
  '九州': 'Kyushu',
  // Malaysia
  '吉隆坡': 'Kuala Lumpur',
  '檳城': 'Penang',
  '馬六甲': 'Malacca',
  '亞庇': 'Kota Kinabalu',
  // Common travel terms
  '四星級': '4-star',
  '五星級': '5-star',
  '三星級': '3-star',
  '六星級': '6-star',
  '待確認': 'To be confirmed',
  '機上餐點': 'In-flight meal',
  '早餐': 'Breakfast',
  '午餐': 'Lunch',
  '晚餐': 'Dinner',
  // Generic placeholders (caught by crawler — appear when activity title is empty in source data)
  '景點 1': 'Attraction 1',
  '景點 2': 'Attraction 2',
  '景點 3': 'Attraction 3',
  '景點 4': 'Attraction 4',
  '景點 5': 'Attraction 5',
  '景點 6': 'Attraction 6',
  '景點 7': 'Attraction 7',
  '景點 8': 'Attraction 8',
  '景點': 'Attraction',
  // Hotel location suffixes
  '市中心': ' City Center',
  '市區': ' City Center',
  '黃金地段': ' Prime Area',
  '湖畔': ' Lakeside',
  '機場附近': ' Airport Area',
  '西側': ' West',
  '東側': ' East',
  '北側': ' North',
  '南側': ' South',
  '靠近世界文化遺產景區': 'near UNESCO World Heritage Site',
  '錫永': 'Sion',
  '附近': ' nearby',
  '長榮航空': 'EVA Air',
  '中華航空': 'China Airlines',
  '星宇航空': 'STARLUX Airlines',
  '日本航空': 'Japan Airlines',
  '全日空': 'ANA',
  '新加坡航空': 'Singapore Airlines',
  '阿聯酋航空': 'Emirates',
  '國泰航空': 'Cathay Pacific',
};

/**
 * Apply proper noun dictionary to text (find-and-replace)
 * Used for post-processing after LLM translation
 */
export function applyProperNounDictionary(text: string): string {
  if (!text || typeof text !== 'string') return text;
  
  let result = text;
  
  // Sort by length (longest first) to avoid partial replacements
  const sortedEntries = Object.entries(PROPER_NOUN_DICTIONARY)
    .sort(([a], [b]) => b.length - a.length);
  
  for (const [chinese, english] of sortedEntries) {
    // Use global replace to catch all occurrences
    result = result.split(chinese).join(english);
  }
  
  return result;
}

/**
 * Apply proper noun dictionary to a JSON object recursively
 * Used for post-processing complex JSON fields (itineraryDetailed, hotels, meals, etc.)
 */
export function applyDictionaryToJson(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return applyProperNounDictionary(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(item => applyDictionaryToJson(item));
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = applyDictionaryToJson(value);
    }
    return result;
  }
  return obj;
}

/**
 * Build the system prompt addition for LLM translation
 * Instructs LLM to use official English names
 */
export function buildProperNounSystemPrompt(): string {
  const dictionaryJson = JSON.stringify(PROPER_NOUN_DICTIONARY, null, 2);
  return `\n\nIMPORTANT - Proper Noun Dictionary (MUST USE THESE EXACT TRANSLATIONS):
The following is an official proper noun reference table. When translating, you MUST use these exact English names and MUST NOT translate them differently:
${dictionaryJson}

These are official names used by Taiwan tourism authorities, hotels, and transportation companies. Do not translate them differently under any circumstances.`;
}
