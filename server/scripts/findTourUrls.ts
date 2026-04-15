/**
 * Script to find valid Lion Travel tour URLs for different categories
 * by testing known GroupID patterns
 */
import dotenv from 'dotenv';
dotenv.config();

const BASE = 'https://travel.liontravel.com';

// Known GroupID patterns for different tour types
// GroupID format: YYMM[country_code][date][id]-[type]
// TH = Thailand, KR = Korea, CR = Cruise, TR = Taiwan Rail
const candidateGroupIds = [
  // Thailand tours
  { category: '亞洲團(泰國)', ids: ['26TH415BKK-T', '26TH415CNX-T', '26TH415BKK-K', '26TH515BKK-T', '26TH415CMX-T'] },
  // Cruise tours  
  { category: '郵輪團', ids: ['26CR415EXP-T', '26CR415DRM-T', '26CR415STR-T', '26CR515EXP-T', '26CR415SLN-T'] },
  // Taiwan train tours
  { category: '台灣火車團', ids: ['26TR415ALI-T', '26TR415HUA-T', '26TR415TDG-T', '26TR515ALI-T', '26TR415RWY-T'] },
];

async function checkUrl(groupId: string): Promise<{ valid: boolean; normGroupId?: string; title?: string }> {
  const url = `${BASE}/detail?GroupID=${groupId}&TourSource=Lion&Platform=APP`;
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://travel.liontravel.com/',
      },
      signal: AbortSignal.timeout(10000),
    });
    const html = await resp.text();
    
    // Check if the page contains a valid NormGroupID
    const normMatch = html.match(/NormGroupID=([a-f0-9-]{36})/);
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    
    if (normMatch && !html.includes('此產品已過期或下架')) {
      return { valid: true, normGroupId: normMatch[1], title: titleMatch?.[1] };
    }
    return { valid: false };
  } catch (e) {
    return { valid: false };
  }
}

async function main() {
  console.log('🔍 Searching for valid Lion Travel tour URLs...\n');
  
  for (const { category, ids } of candidateGroupIds) {
    console.log(`\n===== ${category} =====`);
    let found = false;
    for (const id of ids) {
      const result = await checkUrl(id);
      if (result.valid) {
        const url = `${BASE}/detail?NormGroupID=${result.normGroupId}&GroupID=${id}&TourSource=Lion&Platform=APP`;
        console.log(`✅ Found: ${id}`);
        console.log(`   URL: ${url}`);
        console.log(`   Title: ${result.title}`);
        found = true;
        break;
      } else {
        console.log(`❌ ${id}: not found or expired`);
      }
    }
    if (!found) {
      console.log(`⚠️  No valid URL found for ${category}`);
    }
  }
}

main().catch(console.error);
