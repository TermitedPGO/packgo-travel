/**
 * Chinese to English location name mapping for tour cards.
 * Used when displaying destination names in English mode.
 */
export const locationMapping: Record<string, string> = {
  // Country names
  '台灣': 'Taiwan',
  '日本': 'Japan',
  '韓國': 'Korea',
  '中國': 'China',
  '泰國': 'Thailand',
  '越南': 'Vietnam',
  '新加坡': 'Singapore',
  '馬來西亞': 'Malaysia',
  '印尼': 'Indonesia',
  '菲律賓': 'Philippines',
  '印度': 'India',
  '澳洲': 'Australia',
  '紐西蘭': 'New Zealand',
  '美國': 'USA',
  '加拿大': 'Canada',
  '墨西哥': 'Mexico',
  '巴西': 'Brazil',
  '阿根廷': 'Argentina',
  '英國': 'UK',
  '法國': 'France',
  '德國': 'Germany',
  '義大利': 'Italy',
  '西班牙': 'Spain',
  '葡萄牙': 'Portugal',
  '荷蘭': 'Netherlands',
  '比利時': 'Belgium',
  '瑞士': 'Switzerland',
  '奧地利': 'Austria',
  '捷克': 'Czech Republic',
  '匈牙利': 'Hungary',
  '希臘': 'Greece',
  '土耳其': 'Turkey',
  '埃及': 'Egypt',
  '南非': 'South Africa',
  '肯亞': 'Kenya',
  '摩洛哥': 'Morocco',
  '以色列': 'Israel',
  '約旦': 'Jordan',
  '阿聯酋': 'UAE',
  '沙烏地阿拉伯': 'Saudi Arabia',
  '波蘭': 'Poland',
  '蒙古': 'Mongolia',
  '俄羅斯': 'Russia',
  '烏克蘭': 'Ukraine',
  '克羅埃西亞': 'Croatia',
  '斯洛維尼亞': 'Slovenia',
  '北馬其頓': 'North Macedonia',
  '塞爾維亞': 'Serbia',
  '保加利亞': 'Bulgaria',
  '羅馬尼亞': 'Romania',
  '黑山共和國': 'Montenegro',
  '阿爾巴尼亞': 'Albania',
  '科索沃': 'Kosovo',
  '立陶宛': 'Lithuania',
  '拉脫維亞': 'Latvia',
  '愛沙尼亞': 'Estonia',
  '冰島': 'Iceland',
  '挪威': 'Norway',
  '瑞典': 'Sweden',
  '芬蘭': 'Finland',
  '丹麥': 'Denmark',

  // Taiwan cities & regions
  '台北': 'Taipei',
  '台南': 'Tainan',
  '花蓮': 'Hualien',
  '宜蘭': 'Yilan',
  '新竹': 'Hsinchu',
  '南港': 'Nangang',
  '石城': 'Shicheng',
  '大里': 'Dali',
  '吉安': 'Ji\'an',
  '頭城': 'Toucheng',
  '玉里': 'Yuli',
  '瑞穗': 'Ruisui',
  '集集': 'Jiji',
  '日月潭': 'Sun Moon Lake',
  '觀霧': 'Guanwu',
  '雪霸休閒農場': 'Shei-Pa Recreation Farm',
  '桃園機場': 'Taoyuan Airport',

  // Japan
  '北海道': 'Hokkaido',
  '函館': 'Hakodate',
  '札幌': 'Sapporo',
  '小樽': 'Otaru',
  '登別': 'Noboribetsu',
  '支笏湖': 'Lake Shikotsu',
  '富士山': 'Mt. Fuji',
  '關東': 'Kanto',
  '四國': 'Shikoku',
  '香川': 'Kagawa',
  '高松': 'Takamatsu',
  '德島': 'Tokushima',
  '愛媛': 'Ehime',
  '岡山': 'Okayama',
  '廣島': 'Hiroshima',

  // Korea
  '釜山': 'Busan',
  '慶州': 'Gyeongju',

  // Turkey
  '伊斯坦堡': 'Istanbul',
  '番紅花城': 'Safranbolu',
  '安卡拉': 'Ankara',
  '卡帕多奇亞': 'Cappadocia',
  '孔亞': 'Konya',
  '巴穆嘉麗': 'Pamukkale',
  '以弗所': 'Ephesus',
  '庫薩達西': 'Kusadasi',
  '特洛伊': 'Troy',
  '加納卡利': 'Canakkale',

  // Poland & Baltic States
  '克拉科夫': 'Krakow',
  '奧斯維辛集中營': 'Auschwitz',
  '維利奇卡鹽礦': 'Wieliczka Salt Mine',
  '華沙': 'Warsaw',
  '格但斯克': 'Gdansk',
  '索波特': 'Sopot',
  '馬爾堡': 'Malbork',
  '狼穴': 'Wolf\'s Lair',
  '馬祖里周邊小鎮': 'Masuria',
  '維格里': 'Wigry',
  '考納斯': 'Kaunas',
  '維爾紐斯': 'Vilnius',
  '特拉凱': 'Trakai',
  '十字架山': 'Hill of Crosses',
  '隆黛爾宮': 'Rundale Palace',
  '里加': 'Riga',
  '派爾努': 'Parnu',
  '塔林': 'Tallinn',

  // Balkans (country names already in Country section above)

  // Mongolia & Russia
  '烏蘭巴托': 'Ulaanbaatar',
  '哈拉和林': 'Karakorum',
  '特勒吉國家公園': 'Terelj National Park',
  '貝加爾湖': 'Lake Baikal',
  '奧利洪島': 'Olkhon Island',
  '西伯利亞': 'Siberia',
  '伊爾庫茨克': 'Irkutsk',
  '李斯特維揚卡': 'Listvyanka',

  // v78o: Switzerland / Germany / Austria cities (was missing — Zürich/Lucerne etc. shown in Chinese on EN site)
  '蘇黎世': 'Zürich',
  '盧森': 'Lucerne',
  '琉森': 'Lucerne',
  '少女峰': 'Jungfrau',
  '伯恩': 'Bern',
  '日內瓦': 'Geneva',
  '洛桑': 'Lausanne',
  '蒙特勒': 'Montreux',
  '馬特宏峰': 'Matterhorn',
  '策馬特': 'Zermatt',
  '聖莫里茲': 'St. Moritz',
  '巴塞爾': 'Basel',
  '茵特拉肯': 'Interlaken',
  '冰河快車': 'Glacier Express',

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

  // Austria
  '維也納': 'Vienna',
  '薩爾斯堡': 'Salzburg',
  '因斯布魯克': 'Innsbruck',
  '哈爾施塔特': 'Hallstatt',

  // USA cities (East Coast tour route)
  '紐約': 'New York',
  '華盛頓': 'Washington DC',
  '華盛頓特區': 'Washington DC',
  '費城': 'Philadelphia',
  '波士頓': 'Boston',
  '尼加拉瀑布': 'Niagara Falls',
  '舊金山': 'San Francisco',
  '洛杉磯': 'Los Angeles',
  '拉斯維加斯': 'Las Vegas',
  '大峽谷': 'Grand Canyon',
  '芝加哥': 'Chicago',
  '邁阿密': 'Miami',
  '奧蘭多': 'Orlando',
  '夏威夷': 'Hawaii',
  '檀香山': 'Honolulu',

  // France / UK
  '巴黎': 'Paris',
  '里昂': 'Lyon',
  '馬賽': 'Marseille',
  '尼斯': 'Nice',
  '凡爾賽': 'Versailles',
  '倫敦': 'London',
  '愛丁堡': 'Edinburgh',
  '劍橋': 'Cambridge',
  '牛津': 'Oxford',

  // Italy
  '羅馬': 'Rome',
  '佛羅倫斯': 'Florence',
  '威尼斯': 'Venice',
  '米蘭': 'Milan',
  '那不勒斯': 'Naples',
  '比薩': 'Pisa',
  '西西里': 'Sicily',

  // Malaysia
  '吉隆坡': 'Kuala Lumpur',
  '檳城': 'Penang',
  '馬六甲': 'Malacca',
  '沙巴': 'Sabah',
  '亞庇': 'Kota Kinabalu',

  // v78p: Philippines + others (caught by production crawler)
  '宿霧': 'Cebu',
  '馬尼拉': 'Manila',
  '長灘島': 'Boracay',
  '巴拉望': 'Palawan',
  '科隆島': 'Coron',  // Philippines (bare 科隆 maps to Cologne, Germany — line 174)
  '愛妮島': 'El Nido',

  // Indonesia
  '峇里島': 'Bali',
  '雅加達': 'Jakarta',

  // Thailand
  '曼谷': 'Bangkok',
  '清邁': 'Chiang Mai',
  '普吉島': 'Phuket',
  '芭達雅': 'Pattaya',

  // Vietnam
  '河內': 'Hanoi',
  '胡志明市': 'Ho Chi Minh City',
  '下龍灣': 'Ha Long Bay',

  // Korea
  '首爾': 'Seoul',
  '釜山韓國': 'Busan',
};

/**
 * Convert a Chinese destination string to English.
 * Handles comma-separated lists of city names.
 * Falls back to the original name if no mapping is found.
 */
export function translateDestination(destination: string, language: string): string {
  if (language === 'zh-TW') return destination;

  return destination
    .split(',')
    .map(city => {
      const trimmed = city.trim();
      return locationMapping[trimmed] || trimmed;
    })
    .join(', ');
}
