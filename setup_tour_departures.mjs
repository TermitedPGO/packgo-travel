/**
 * Generic script to set up tour departures using superjson date format
 * Usage: TOUR_ID=xxx ADULT_PRICE=xxx ... node setup_tour_departures.mjs
 */
import { SignJWT } from 'jose';
import superjson from 'superjson';

const JWT_SECRET = process.env.JWT_SECRET;
const BASE_URL = 'http://localhost:3000';
const TOUR_ID = parseInt(process.env.TOUR_ID);
const ADULT_PRICE = parseInt(process.env.ADULT_PRICE || '89900');
const CHILD_WITH_BED = parseInt(process.env.CHILD_WITH_BED || '80900');
const CHILD_NO_BED = parseInt(process.env.CHILD_NO_BED || '72900');
const INFANT_PRICE = parseInt(process.env.INFANT_PRICE || '35000');
const TOTAL_SLOTS = parseInt(process.env.TOTAL_SLOTS || '20');
const DURATION_DAYS = parseInt(process.env.DURATION_DAYS || '9'); // return = departure + DURATION_DAYS
const BASE_PRICE = parseInt(process.env.BASE_PRICE || ADULT_PRICE);
const DATES = process.env.DATES ? process.env.DATES.split(',') : [
  '2026-05-15', '2026-06-05', '2026-06-26', '2026-07-17', '2026-08-07'
];

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

async function trpcMutation(procedure, input) {
  const url = `${BASE_URL}/api/trpc/${procedure}`;
  // Use superjson to serialize the input (handles Date objects)
  const serialized = superjson.serialize(input);
  const body = JSON.stringify({ json: serialized.json, meta: serialized.meta });
  const res = await fetch(url, { method: 'POST', headers, body });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error.json?.message || data.error));
  return data.result?.data?.json;
}

async function trpcQuery(procedure, input) {
  const serialized = superjson.serialize(input);
  const params = encodeURIComponent(JSON.stringify({ json: serialized.json, meta: serialized.meta }));
  const url = `${BASE_URL}/api/trpc/${procedure}?input=${params}`;
  const res = await fetch(url, { method: 'GET', headers });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error.json?.message || data.error));
  return data.result?.data?.json;
}

console.log(`Setting up Tour ID: ${TOUR_ID}`);
console.log(`Adult Price: ${ADULT_PRICE}, Slots: ${TOTAL_SLOTS}`);
console.log(`Dates: ${DATES.join(', ')}`);

// Step 1: Update tour base price and publish
console.log('\nStep 1: Updating tour price and status to active...');
const updateResult = await trpcMutation('tours.update', {
  id: TOUR_ID,
  basePrice: BASE_PRICE,
  status: 'active'
});
console.log('  Updated:', updateResult?.title?.slice(0, 50));

// Step 2: Create departures
console.log('\nStep 2: Creating departures...');
for (const dateStr of DATES) {
  const departureDate = new Date(dateStr + 'T00:00:00Z');
  const returnDate = new Date(departureDate);
  returnDate.setDate(returnDate.getDate() + DURATION_DAYS);
  
  try {
    const result = await trpcMutation('departures.create', {
      tourId: TOUR_ID,
      departureDate,
      returnDate,
      adultPrice: ADULT_PRICE,
      childPriceWithBed: CHILD_WITH_BED,
      childPriceNoBed: CHILD_NO_BED,
      infantPrice: INFANT_PRICE,
      totalSlots: TOTAL_SLOTS,
      status: 'open',
      notes: ''
    });
    console.log(`  ✅ Created departure ${dateStr}: ID=${result?.id}`);
  } catch (err) {
    console.error(`  ❌ Failed to create departure ${dateStr}:`, err.message?.slice(0, 200));
  }
}

// Step 3: Verify
console.log('\nStep 3: Verifying departures...');
const departures = await trpcQuery('departures.list', { tourId: TOUR_ID });
console.log(`  Total departures: ${departures?.length || 0}`);
if (departures?.length > 0) {
  departures.forEach(d => {
    const date = new Date(d.departureDate).toISOString().split('T')[0];
    console.log(`  - ${date}: adult=${d.adultPrice}, slots=${d.totalSlots}, status=${d.status}`);
  });
}

console.log('\n✅ Done!');
