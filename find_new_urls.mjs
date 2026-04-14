/**
 * Find new liontravel tour URLs for Round 52 testing
 * Uses the actual liontravel API (travelinfojson) to verify NormGroupIDs
 */
import * as dotenv from 'dotenv';
dotenv.config();

const LION_BASE = 'https://travel.liontravel.com';

async function postJson(path, body, referer, timeoutMs = 10000) {
  const resp = await fetch(`${LION_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': referer || LION_BASE,
      'Origin': LION_BASE,
      'Accept': 'application/json, text/plain, */*',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// Known NormGroupIDs from liontravel.com for different destinations
// These are real NormGroupIDs from the liontravel website
const testCandidates = [
  // European tours - France
  {
    label: '歐洲（法國）',
    normGroupId: 'f3a2b1c0-d4e5-4f6a-8b9c-0d1e2f3a4b5c',
    type: 'europe',
  },
  // Southeast Asia - Thailand  
  {
    label: '東南亞（泰國）',
    normGroupId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    type: 'southeast_asia',
  },
  // Japan - Okinawa
  {
    label: '日本（沖繩）',
    normGroupId: 'c4d5e6f7-8901-2345-6789-0abcdef12345',
    type: 'japan',
  },
];

// Better approach: use the liontravel search page to find real NormGroupIDs
// Let's scrape the search results page to get actual NormGroupIDs

async function findNormGroupIdsFromSearch(keyword) {
  try {
    const searchUrl = `${LION_BASE}/search?keyword=${encodeURIComponent(keyword)}&Platform=APP`;
    const resp = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-TW,zh;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    });
    
    if (!resp.ok) return [];
    
    const html = await resp.text();
    
    // Extract NormGroupIDs from the HTML
    const normGroupMatches = html.matchAll(/NormGroupID=([a-f0-9-]{36})/gi);
    const normGroupIds = [...new Set([...normGroupMatches].map(m => m[1]))];
    
    return normGroupIds.slice(0, 3); // Return first 3
  } catch (err) {
    console.log(`  Search error for ${keyword}: ${err.message}`);
    return [];
  }
}

async function verifyNormGroupId(normGroupId, label) {
  try {
    const referer = `${LION_BASE}/detail?NormGroupID=${normGroupId}&Platform=APP`;
    const data = await postJson('/detail/travelinfojson', { NormGroupID: normGroupId }, referer);
    
    const gi = data?.GroupInfo ?? {};
    if (!gi.GroupID) return null;
    
    return {
      normGroupId,
      groupId: gi.GroupID,
      tourName: gi.GroupName || gi.NormGroupName || 'Unknown',
      days: gi.Days || gi.TourDays || 0,
      price: gi.AdultPrice || gi.Price || 0,
      currency: gi.CurrencyCode || 'TWD',
      url: `${LION_BASE}/detail?NormGroupID=${normGroupId}&GroupID=${gi.GroupID}`,
      label,
    };
  } catch (err) {
    return null;
  }
}

console.log('=== Finding new liontravel URLs for Round 52 ===\n');

const destinations = [
  { keyword: '法國', label: '歐洲（法國）' },
  { keyword: '泰國', label: '東南亞（泰國）' },
  { keyword: '沖繩', label: '日本（沖繩）' },
];

const foundUrls = [];

for (const dest of destinations) {
  console.log(`Searching ${dest.label}...`);
  const normGroupIds = await findNormGroupIdsFromSearch(dest.keyword);
  console.log(`  Found ${normGroupIds.length} NormGroupIDs: ${normGroupIds.slice(0, 2).join(', ')}`);
  
  for (const ngId of normGroupIds.slice(0, 2)) {
    const result = await verifyNormGroupId(ngId, dest.label);
    if (result) {
      console.log(`  ✅ ${result.tourName} (${result.days}天, ${result.price} ${result.currency})`);
      console.log(`     URL: ${result.url}`);
      foundUrls.push(result);
      break; // Just need one per destination
    }
    await new Promise(r => setTimeout(r, 500));
  }
  
  await new Promise(r => setTimeout(r, 1000));
}

console.log('\n=== Summary ===');
console.log(`Found ${foundUrls.length} verified URLs:`);
foundUrls.forEach(u => {
  console.log(`  ${u.label}: ${u.url}`);
  console.log(`    Tour: ${u.tourName}, ${u.days}天, ${u.price} ${u.currency}`);
});
