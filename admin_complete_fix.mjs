import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-not-for-production';
const BASE_URL = 'http://localhost:3000';
const COOKIE_NAME = 'app_session_id';
const ADMIN_USER_ID = 630001;

function createAdminToken() {
  return jwt.sign(
    { userId: ADMIN_USER_ID, email: 'admin@packgo.test', role: 'admin', name: 'Admin' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function callTRPCMutation(procedure, input, token) {
  const url = `${BASE_URL}/api/trpc/${procedure}`;
  const body = JSON.stringify({ json: input });
  
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `${COOKIE_NAME}=${token}`
    },
    body
  });
  
  const data = await resp.json();
  if (data.error) {
    throw new Error(`TRPC error: ${JSON.stringify(data.error)}`);
  }
  return data.result?.data?.json;
}

async function callTRPCQuery(procedure, input) {
  const url = `${BASE_URL}/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const resp = await fetch(url);
  const data = await resp.json();
  return data.result?.data?.json;
}

async function main() {
  const token = createAdminToken();
  const user = (await fetch(`${BASE_URL}/api/trpc/auth.me`, {
    headers: { 'Cookie': `${COOKIE_NAME}=${token}` }
  }).then(r => r.json()))?.result?.data?.json;
  
  console.log('Auth:', user?.id, user?.role);
  if (!user || user.role !== 'admin') {
    console.error('Not admin!'); return;
  }
  
  // 1. Fix Greece tour (1890010) - fix destination and activate
  console.log('\n=== Fixing Greece tour ===');
  try {
    const result = await callTRPCMutation('tours.update', {
      id: 1890010,
      destinationCity: '雅典, 聖托里尼',
      destinationCountry: '希臘',
      status: 'active'
    }, token);
    console.log(`✅ Greece: dest=${result?.destinationCity}, status=${result?.status}`);
  } catch (err) {
    console.error('❌ Greece fix failed:', err.message.substring(0, 100));
  }
  
  // 2. Fix Switzerland cover image (1890006)
  console.log('\n=== Adding Switzerland cover image ===');
  try {
    const result = await callTRPCMutation('tours.update', {
      id: 1890006,
      imageUrl: 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=800&q=80'
    }, token);
    console.log(`✅ Switzerland img: ${result?.imageUrl?.substring(0, 50)}`);
  } catch (err) {
    console.error('❌ Switzerland img failed:', err.message.substring(0, 100));
  }
  
  // 3. Add departure dates for new tours (1890005 to 1890010)
  console.log('\n=== Adding departure dates ===');
  
  const newTourIds = [1890005, 1890006, 1890007, 1890008, 1890009, 1890010];
  
  // Generate 5 departure dates for each tour (May-August 2026)
  const departureDates = [
    { month: 5, day: 10 },  // May 10
    { month: 5, day: 25 },  // May 25
    { month: 6, day: 15 },  // June 15
    { month: 7, day: 5 },   // July 5
    { month: 8, day: 10 },  // August 10
  ];
  
  // Tour-specific prices
  const tourPrices = {
    1890005: 255900, // Italy
    1890006: 111900, // Switzerland
    1890007: 29800,  // Thailand
    1890008: 39900,  // Hokkaido
    1890009: 54888,  // Turkey
    1890010: 68800,  // Greece (estimated)
  };
  
  // Tour durations for calculating return date
  const tourDurations = {
    1890005: 15, // Italy 15 days
    1890006: 10, // Switzerland 10 days
    1890007: 5,  // Thailand 5 days
    1890008: 6,  // Hokkaido 6 days
    1890009: 10, // Turkey 10 days
    1890010: 10, // Greece 10 days
  };
  
  for (const tourId of newTourIds) {
    let successCount = 0;
    for (const { month, day } of departureDates) {
      try {
        const departureDate = new Date(2026, month - 1, day);
        const duration = tourDurations[tourId] || 7;
        const returnDate = new Date(2026, month - 1, day + duration - 1);
        const result = await callTRPCMutation('departures.create', {
          tourId,
          departureDate,
          returnDate,
          totalSlots: 20,
          adultPrice: tourPrices[tourId] || 50000,
          status: 'open'
        }, token);
        successCount++;
      } catch (err) {
        console.error(`  Tour ${tourId} departure error:`, err.message.substring(0, 80));
      }
    }
    console.log(`✅ Tour ${tourId}: added ${successCount} departure dates`);
  }
  
  console.log('\n=== All done! ===');
}

main().catch(console.error);
