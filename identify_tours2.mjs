/**
 * Identify Thailand and Okinawa tours using GroupID-based API
 */
import * as dotenv from 'dotenv';
dotenv.config();

const LION_BASE = 'https://travel.liontravel.com';

// From browser console output - GroupID + NormGroupID pairs
const tours = [
  { normGroupId: '4d01cab3-cb93-42d4-9b9a-2302d4db0776', groupId: '26JT415JXO-T' },
  { normGroupId: 'f73b9ad2-489f-49e1-9b79-dd6d068265b8', groupId: '26TM415CMA-T' },
  { normGroupId: '47ceaf13-21d3-410d-8de1-babd1d6eced7', groupId: '26TN415SZA-T' },
  { normGroupId: '310f6d7b-fdcb-4369-b809-aeb0b031224c', groupId: null },
  { normGroupId: '4daa5c16-7d15-46ac-84a6-41919a2f0c6a', groupId: null },
];

// GroupID prefix guide:
// JT = Japan (Tokyo?)
// TM = Thailand (曼谷 Thaïland Maeklong?)  
// TN = Thailand North (清邁?)
// EF = Europe France

async function fetchTourDetail(normGroupId, groupId) {
  try {
    const url = `${LION_BASE}/detail?NormGroupID=${normGroupId}${groupId ? `&GroupID=${groupId}` : ''}&Platform=APP`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    
    // Extract title from HTML
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    const ogTitleMatch = html.match(/og:title[^>]+content="([^"]+)"/);
    const title = ogTitleMatch?.[1] || titleMatch?.[1] || '';
    
    // Extract price
    const priceMatch = html.match(/(\d{1,3}(?:,\d{3})*)\s*(?:元|TWD|NT\$)/);
    
    return { title, price: priceMatch?.[1], url };
  } catch (err) {
    return { error: err.message };
  }
}

// Also try the travelinfojson with GroupID
async function fetchTravelInfo(normGroupId, groupId) {
  try {
    const body = { NormGroupID: normGroupId };
    if (groupId) body.GroupID = groupId;
    
    const resp = await fetch(`${LION_BASE}/detail/travelinfojson`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': `${LION_BASE}/detail?NormGroupID=${normGroupId}&Platform=APP`,
        'Origin': LION_BASE,
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return { httpError: resp.status };
    const data = await resp.json();
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

console.log('Fetching tour details...\n');

for (const t of tours) {
  console.log(`--- NormGroupID: ${t.normGroupId} (GroupID: ${t.groupId || 'N/A'}) ---`);
  
  // Try travelinfojson first
  const info = await fetchTravelInfo(t.normGroupId, t.groupId);
  const gi = info?.GroupInfo;
  if (gi?.GroupID) {
    console.log(`✅ Name: ${gi.NormGroupName || gi.GroupName}`);
    console.log(`   GroupID: ${gi.GroupID}, Days: ${gi.Days}, Price: ${gi.AdultPrice} ${gi.CurrencyCode || 'TWD'}`);
    console.log(`   URL: ${LION_BASE}/detail?NormGroupID=${t.normGroupId}&GroupID=${gi.GroupID}`);
  } else {
    // Fallback: try HTML scraping
    const detail = await fetchTourDetail(t.normGroupId, t.groupId);
    if (detail?.title) {
      console.log(`📄 Title: ${detail.title}`);
      console.log(`   Price: ${detail.price || 'N/A'}`);
      console.log(`   URL: ${detail.url}`);
    } else {
      console.log(`❌ Failed: ${JSON.stringify(info).slice(0, 100)}`);
    }
  }
  console.log();
  await new Promise(r => setTimeout(r, 500));
}
