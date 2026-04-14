/**
 * Verify new liontravel URLs for Round 52
 * Tests France, Thailand, Okinawa URLs via travelinfojson API
 */
import * as dotenv from 'dotenv';
dotenv.config();

const LION_BASE = 'https://travel.liontravel.com';

async function postJson(path, body, referer) {
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
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// France tour found from browser
const franceUrl = 'https://travel.liontravel.com/detail?NormGroupID=f6266527-ca13-44a8-b9cf-e2ee6f33a08b&GroupID=26EF415EK-T';
const franceNormGroupId = 'f6266527-ca13-44a8-b9cf-e2ee6f33a08b';

// Try to find Thailand and Okinawa NormGroupIDs from known product codes
// Thailand 7-day tour - typical product code pattern
const candidateNormGroupIds = [
  // These are guesses based on known liontravel URL patterns
  // We'll verify them via API
  { label: '泰國（曼谷清邁）', normGroupId: '3a4b5c6d-7e8f-9012-3456-789abcdef012' },
  { label: '沖繩（5日）', normGroupId: '9f8e7d6c-5b4a-3210-fedc-ba9876543210' },
];

async function verifyUrl(normGroupId, label) {
  try {
    const referer = `${LION_BASE}/detail?NormGroupID=${normGroupId}&Platform=APP`;
    const data = await postJson('/detail/travelinfojson', { NormGroupID: normGroupId }, referer);
    
    const gi = data?.GroupInfo ?? {};
    if (!gi.GroupID) {
      console.log(`  ❌ ${label}: No GroupID returned`);
      return null;
    }
    
    console.log(`  ✅ ${label}: ${gi.GroupName || gi.NormGroupName}`);
    console.log(`     GroupID: ${gi.GroupID}, Days: ${gi.Days || gi.TourDays}, Price: ${gi.AdultPrice || gi.Price} ${gi.CurrencyCode || 'TWD'}`);
    return {
      normGroupId,
      groupId: gi.GroupID,
      tourName: gi.GroupName || gi.NormGroupName,
      days: gi.Days || gi.TourDays,
      price: gi.AdultPrice || gi.Price,
      currency: gi.CurrencyCode || 'TWD',
      url: `${LION_BASE}/detail?NormGroupID=${normGroupId}&GroupID=${gi.GroupID}`,
    };
  } catch (err) {
    console.log(`  ❌ ${label}: ${err.message}`);
    return null;
  }
}

console.log('=== Verifying France URL ===');
const franceResult = await verifyUrl(franceNormGroupId, 'ClubMed法國蒂涅Tignes7日');

console.log('\n=== Testing candidate NormGroupIDs ===');
for (const c of candidateNormGroupIds) {
  await verifyUrl(c.normGroupId, c.label);
  await new Promise(r => setTimeout(r, 500));
}

console.log('\n=== Final URLs for Round 52 ===');
console.log('Existing tours (forceRegenerate):');
console.log('1. 南美雙奇景15日: https://travel.liontravel.com/detail?NormGroupID=456a2a25-ed86-4cc3-9196-100aee9ccb56&GroupID=26XA501BRA-T');
console.log('2. 四國四鐵道7日: https://travel.liontravel.com/detail?NormGroupID=e8db523b-2e25-4287-8d0d-0a5dd33f1a62&GroupID=26JY712CIG-T');
console.log('3. 北海道五日: https://travel.liontravel.com/detail?NormGroupID=c684d4d8-4860-47a3-94e3-debb05bce5b2&Origin=LION&Platform=APP');
console.log('4. 福森號二日: https://travel.liontravel.com/detail?NormGroupID=2a81ad7d-c617-446c-b781-6f045f9c8113&GroupID=26XA501BRA-T');
console.log('5. 汶萊沙巴五日: https://www.liontravel.com/webpd/webpdsh00.aspx?sKind=1&sProd=24JO217BRC-T');

if (franceResult) {
  console.log('\nNew tours:');
  console.log(`6. 法國7日: ${franceResult.url}`);
}
