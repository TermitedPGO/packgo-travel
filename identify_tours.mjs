/**
 * Identify Thailand and Okinawa tours from NormGroupIDs found in search page
 */
import * as dotenv from 'dotenv';
dotenv.config();

const LION_BASE = 'https://travel.liontravel.com';

const normGroupIds = [
  '4d01cab3-cb93-42d4-9b9a-2302d4db0776',
  'f73b9ad2-489f-49e1-9b79-dd6d068265b8',
  '47ceaf13-21d3-410d-8de1-babd1d6eced7',
  '310f6d7b-fdcb-4369-b809-aeb0b031224c',
  '4daa5c16-7d15-46ac-84a6-41919a2f0c6a',
  'dfffea51-d8e7-422c-a84b-8e130d1e7b59',
  '3faeae88-a6de-4c41-b46b-36c147dc9f32',
  'ba1ebb11-3dd8-448e-93f9-303f0953b9f2',
  '54a93649-9bda-4058-a43f-61310c577990',
];

async function fetchTourInfo(normGroupId) {
  try {
    const referer = `${LION_BASE}/detail?NormGroupID=${normGroupId}&Platform=APP`;
    const resp = await fetch(`${LION_BASE}/detail/travelinfojson`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        'Referer': referer,
        'Origin': LION_BASE,
        'Accept': 'application/json',
      },
      body: JSON.stringify({ NormGroupID: normGroupId }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const gi = data?.GroupInfo ?? {};
    return {
      normGroupId,
      groupId: gi.GroupID,
      name: gi.NormGroupName || gi.GroupName || '',
      days: gi.Days || gi.TourDays,
      price: gi.AdultPrice || gi.Price,
      currency: gi.CurrencyCode || 'TWD',
    };
  } catch {
    return null;
  }
}

console.log('Identifying tours from NormGroupIDs...\n');

for (const id of normGroupIds) {
  const info = await fetchTourInfo(id);
  if (info && info.name) {
    const isThailand = info.name.includes('泰') || info.name.includes('曼谷') || info.name.includes('清邁') || info.name.includes('泰國');
    const isOkinawa = info.name.includes('沖繩') || info.name.includes('琉球');
    const isJapan = info.name.includes('日本') || info.name.includes('九州') || info.name.includes('東京') || info.name.includes('大阪');
    const flag = isThailand ? '🇹🇭' : isOkinawa ? '🌺' : isJapan ? '🇯🇵' : '🌍';
    console.log(`${flag} ${info.name}`);
    console.log(`   NormGroupID: ${id}`);
    console.log(`   GroupID: ${info.groupId}, Days: ${info.days}, Price: ${info.price} ${info.currency}`);
    console.log(`   URL: ${LION_BASE}/detail?NormGroupID=${id}&GroupID=${info.groupId}`);
    console.log();
  }
  await new Promise(r => setTimeout(r, 300));
}
