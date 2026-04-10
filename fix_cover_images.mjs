/**
 * Fix Cover Images Script
 * Fetches Unsplash images for tours without cover images and updates the database
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!UNSPLASH_ACCESS_KEY) {
  console.error('❌ UNSPLASH_ACCESS_KEY not set');
  process.exit(1);
}

/**
 * Search Unsplash for a travel image based on destination keywords
 */
async function searchUnsplashImage(query) {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://api.unsplash.com/search/photos?query=${encodedQuery}&per_page=5&orientation=landscape&content_filter=high`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Client-ID ${UNSPLASH_ACCESS_KEY}`,
    },
  });
  
  if (!response.ok) {
    throw new Error(`Unsplash API error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  
  if (!data.results || data.results.length === 0) {
    return null;
  }
  
  // Pick the best image (first result with good dimensions)
  const photo = data.results[0];
  // Use regular size (1080px wide) for good quality without being too large
  const imageUrl = photo.urls.regular;
  
  console.log(`  📸 Found: ${photo.description || photo.alt_description || 'travel photo'} by ${photo.user.name}`);
  console.log(`  🔗 URL: ${imageUrl.substring(0, 80)}...`);
  
  return imageUrl;
}

// Map Chinese destination names to English for better Unsplash results
const DESTINATION_MAP = {
  '帛琉': 'Palau',
  '台灣': 'Taiwan',
  '台北': 'Taipei',
  '彰化': 'Changhua Taiwan',
  '台南': 'Tainan Taiwan',
  '日本': 'Japan',
  '東京': 'Tokyo',
  '大阪': 'Osaka',
  '京都': 'Kyoto',
  '北海道': 'Hokkaido',
  '沖繩': 'Okinawa',
  '英國': 'United Kingdom',
  '愛爾蘭': 'Ireland',
  '法國': 'France',
  '巴黎': 'Paris',
  '義大利': 'Italy',
  '羅馬': 'Rome',
  '瑞士': 'Switzerland',
  '德國': 'Germany',
  '荷蘭': 'Netherlands',
  '比利時': 'Belgium',
  '捷克': 'Czech Republic',
  '布拉格': 'Prague',
  '奧地利': 'Austria',
  '維也納': 'Vienna',
  '希臘': 'Greece',
  '西班牙': 'Spain',
  '葡萄牙': 'Portugal',
  '泰國': 'Thailand',
  '曼谷': 'Bangkok',
  '清邁': 'Chiang Mai',
  '越南': 'Vietnam',
  '河內': 'Hanoi',
  '胡志明': 'Ho Chi Minh',
  '韓國': 'South Korea',
  '首爾': 'Seoul',
  '新加坡': 'Singapore',
  '馬來西亞': 'Malaysia',
  '吉隆坡': 'Kuala Lumpur',
  '印尼': 'Indonesia',
  '巴里島': 'Bali',
  '峇里島': 'Bali',
  '澳洲': 'Australia',
  '雪梨': 'Sydney',
  '墨爾本': 'Melbourne',
  '紐西蘭': 'New Zealand',
  '美國': 'United States',
  '紐約': 'New York',
  '洛杉磯': 'Los Angeles',
  '加拿大': 'Canada',
  '土耳其': 'Turkey',
  '伊斯坦堡': 'Istanbul',
  '埃及': 'Egypt',
  '開羅': 'Cairo',
  '摩洛哥': 'Morocco',
  '南非': 'South Africa',
  '肯亞': 'Kenya',
  '冰島': 'Iceland',
  '挪威': 'Norway',
  '芬蘭': 'Finland',
  '瑞典': 'Sweden',
  '丹麥': 'Denmark',
  '印度': 'India',
  '尼泊爾': 'Nepal',
  '斯里蘭卡': 'Sri Lanka',
  '菲律賓': 'Philippines',
  '馬爾地夫': 'Maldives',
  '墨西哥': 'Mexico',
  '秘魯': 'Peru',
  '阿根廷': 'Argentina',
  '巴西': 'Brazil',
  '中國': 'China',
  '北京': 'Beijing',
  '上海': 'Shanghai',
  '香港': 'Hong Kong',
  '澳門': 'Macau',
};

function translateToEnglish(text) {
  if (!text) return '';
  // Check if it contains Chinese characters
  if (!/[\u4e00-\u9fff]/.test(text)) return text;
  // Try direct lookup
  if (DESTINATION_MAP[text.trim()]) return DESTINATION_MAP[text.trim()];
  // Try to find partial matches
  for (const [cn, en] of Object.entries(DESTINATION_MAP)) {
    if (text.includes(cn)) return en;
  }
  return text; // Return as-is if no translation found
}

/**
 * Build search query from tour data
 */
function buildSearchQuery(tour) {
  const country = translateToEnglish(tour.destinationCountry || '');
  const city = translateToEnglish((tour.destinationCity || '').split(',')[0].trim());
  const destination = translateToEnglish(tour.destination || '');
  
  // Use country + city for best results
  if (country && city && city !== country) {
    return `${city} ${country} travel landscape`;
  } else if (country) {
    return `${country} travel landscape`;
  } else if (destination) {
    return `${destination} travel landscape`;
  }
  return 'travel landscape';
}

async function main() {
  console.log('=== Fix Cover Images Script ===\n');
  
  const conn = await mysql.createConnection(DATABASE_URL);
  
  // Get all tours without images
  const [tours] = await conn.execute(
    'SELECT id, title, destination, destinationCountry, destinationCity, category, imageUrl FROM tours ORDER BY id'
  );
  
  console.log(`Total tours: ${tours.length}`);
  
  const toursNeedingImages = tours.filter(t => !t.imageUrl || t.imageUrl.length <= 10);
  const toursWithImages = tours.filter(t => t.imageUrl && t.imageUrl.length > 10);
  
  console.log(`Tours with images: ${toursWithImages.length}`);
  console.log(`Tours needing images: ${toursNeedingImages.length}\n`);
  
  let successCount = 0;
  let failCount = 0;
  
  for (const tour of toursNeedingImages) {
    console.log(`\n[${tour.id}] ${tour.title?.substring(0, 50)}...`);
    console.log(`  Destination: ${tour.destination} | Country: ${tour.destinationCountry}`);
    
    const query = buildSearchQuery(tour);
    console.log(`  Search query: "${query}"`);
    
    try {
      const imageUrl = await searchUnsplashImage(query);
      
      if (imageUrl) {
        await conn.execute(
          'UPDATE tours SET imageUrl = ? WHERE id = ?',
          [imageUrl, tour.id]
        );
        console.log(`  ✅ Updated imageUrl for tour ${tour.id}`);
        successCount++;
      } else {
        // Fallback: try a more generic query
        console.log(`  ⚠️ No results for "${query}", trying fallback...`);
        const fallbackQuery = 'travel destination landscape';
        const fallbackUrl = await searchUnsplashImage(fallbackQuery);
        
        if (fallbackUrl) {
          await conn.execute(
            'UPDATE tours SET imageUrl = ? WHERE id = ?',
            [fallbackUrl, tour.id]
          );
          console.log(`  ✅ Updated with fallback image for tour ${tour.id}`);
          successCount++;
        } else {
          console.log(`  ❌ No image found for tour ${tour.id}`);
          failCount++;
        }
      }
      
      // Rate limit: Unsplash allows 50 requests/hour for demo apps
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (err) {
      console.error(`  ❌ Error for tour ${tour.id}:`, err.message);
      failCount++;
    }
  }
  
  await conn.end();
  
  console.log('\n=== Summary ===');
  console.log(`Total tours: ${tours.length}`);
  console.log(`Already had images: ${toursWithImages.length}`);
  console.log(`Successfully updated: ${successCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`\n✅ Done!`);
}

main().catch(console.error);
