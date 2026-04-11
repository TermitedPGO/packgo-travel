import jwt from 'jsonwebtoken';
import superjson from 'superjson';

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
  // Use superjson to serialize the input (handles Date objects)
  const serialized = superjson.serialize(input);
  const body = JSON.stringify(serialized);
  
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
    throw new Error(`TRPC error: ${data.error.json?.message || JSON.stringify(data.error).substring(0, 100)}`);
  }
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
  
  // Departure dates (May-August 2026)
  const departureDates = [
    { month: 5, day: 10 },  // May 10
    { month: 5, day: 25 },  // May 25
    { month: 6, day: 15 },  // June 15
    { month: 7, day: 5 },   // July 5
    { month: 8, day: 10 },  // August 10
  ];
  
  // Tour configurations
  const tourConfigs = {
    1890005: { price: 255900, duration: 15, name: 'Italy' },
    1890006: { price: 111900, duration: 10, name: 'Switzerland' },
    1890007: { price: 29800,  duration: 5,  name: 'Thailand' },
    1890008: { price: 39900,  duration: 6,  name: 'Hokkaido' },
    1890009: { price: 54888,  duration: 10, name: 'Turkey' },
    1890010: { price: 68800,  duration: 10, name: 'Greece' },
  };
  
  console.log('\n=== Adding departure dates ===');
  
  for (const [tourIdStr, config] of Object.entries(tourConfigs)) {
    const tourId = parseInt(tourIdStr);
    let successCount = 0;
    
    for (const { month, day } of departureDates) {
      try {
        const departureDate = new Date(2026, month - 1, day);
        const returnDate = new Date(2026, month - 1, day + config.duration - 1);
        
        const result = await callTRPCMutation('departures.create', {
          tourId,
          departureDate,
          returnDate,
          totalSlots: 20,
          adultPrice: config.price,
          status: 'open'
        }, token);
        successCount++;
      } catch (err) {
        console.error(`  ${config.name} departure error:`, err.message.substring(0, 100));
      }
    }
    console.log(`✅ ${config.name} (${tourId}): added ${successCount} departure dates`);
  }
  
  console.log('\n=== All done! ===');
}

main().catch(console.error);
