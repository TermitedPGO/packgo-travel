import { SignJWT } from 'jose';

const JWT_SECRET = process.env.JWT_SECRET;
const BASE_URL = 'http://localhost:3000';
const TOUR_ID = 1890011;

// Create admin JWT token
const secret = new TextEncoder().encode(JWT_SECRET);
const token = await new SignJWT({ userId: 630001, openId: 'owner' })
  .setProtectedHeader({ alg: 'HS256' })
  .setExpirationTime('1h')
  .sign(secret);

const headers = {
  'Content-Type': 'application/json',
  'Cookie': `app_session_id=${token}`
};

async function trpcCall(procedure, input) {
  const url = `${BASE_URL}/api/trpc/${procedure}`;
  const body = JSON.stringify({ json: input });
  const res = await fetch(url, { method: 'POST', headers, body });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.result?.data?.json;
}

// Step 1: Update tour price and publish
console.log('Step 1: Updating Italy tour price and status...');
const updateResult = await trpcCall('tours.update', {
  id: TOUR_ID,
  basePrice: 89900,
  status: 'active'
});
console.log('Update result:', JSON.stringify(updateResult).slice(0, 100));

// Step 2: Create 5 departures
const departureDates = [
  { date: '2026-05-15', seats: 20 },
  { date: '2026-06-05', seats: 20 },
  { date: '2026-06-26', seats: 20 },
  { date: '2026-07-17', seats: 20 },
  { date: '2026-08-07', seats: 20 },
];

console.log('Step 2: Creating departures...');
for (const dep of departureDates) {
  const depDate = new Date(dep.date);
  // Calculate return date (10 days later)
  const returnDate = new Date(depDate);
  returnDate.setDate(returnDate.getDate() + 9);
  
  const result = await trpcCall('departures.create', {
    tourId: TOUR_ID,
    departureDate: { __type: 'Date', value: depDate.toISOString() },
    returnDate: { __type: 'Date', value: returnDate.toISOString() },
    adultPrice: 89900,
    childPriceWithBed: 80900,
    childPriceNoBed: 72900,
    infantPrice: 35000,
    totalSeats: dep.seats,
    availableSeats: dep.seats,
    status: 'available',
    notes: ''
  });
  console.log(`  Created departure ${dep.date}:`, result?.id || 'unknown');
}

console.log('Done! Italy tour setup complete.');
