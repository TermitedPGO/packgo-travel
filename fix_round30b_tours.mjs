import * as jose from 'jose';

const JWT_SECRET = '82JNwBHZppvdtgFL29R3xz';

async function createAdminToken() {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return await new jose.SignJWT({ userId: 630001 })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(secret);
}

async function apiCall(token, procedure, input, method = 'GET') {
  const url = `http://localhost:3000/api/trpc/${procedure}`;
  const options = {
    headers: { 
      'Content-Type': 'application/json',
      'Cookie': `app_session_id=${token}`
    }
  };
  
  if (method === 'POST') {
    options.method = 'POST';
    options.body = JSON.stringify({ json: input });
  } else {
    const params = encodeURIComponent(JSON.stringify({ json: input }));
    return fetch(`${url}?input=${params}`, options).then(r => r.json());
  }
  
  return fetch(url, options).then(r => r.json());
}

async function updateTour(token, id, updates) {
  const resp = await fetch('http://localhost:3000/api/trpc/tours.update', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Cookie': `app_session_id=${token}`
    },
    body: JSON.stringify({ json: { id, ...updates } })
  });
  const data = await resp.json();
  if (data.result?.data?.json) {
    const t = data.result.data.json;
    console.log(`  ✅ Updated ID=${id}: dest=${t.destinationCountry}, city=${t.destinationCity}, days=${t.duration}`);
  } else {
    console.log(`  ❌ Failed ID=${id}:`, JSON.stringify(data).substring(0, 300));
  }
}

async function createDeparture(token, tourId, departureDate, adultPrice, childPriceWithBed, childPriceNoBed, infantPrice, totalSlots) {
  const resp = await fetch('http://localhost:3000/api/trpc/departures.create', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Cookie': `app_session_id=${token}`
    },
    body: JSON.stringify({ 
      json: { 
        tourId,
        departureDate: { '$date': departureDate },
        returnDate: { '$date': new Date(new Date(departureDate).getTime() + 5 * 24 * 60 * 60 * 1000).toISOString() },
        adultPrice,
        childPriceWithBed,
        childPriceNoBed,
        infantPrice,
        totalSlots,
        status: 'open'
      } 
    })
  });
  const data = await resp.json();
  if (data.result?.data?.json) {
    console.log(`    ✅ Departure ${departureDate} created`);
  } else {
    console.log(`    ❌ Departure ${departureDate} failed:`, JSON.stringify(data).substring(0, 200));
  }
}

async function checkDepartures(token, tourId) {
  const resp = await fetch(`http://localhost:3000/api/trpc/departures.list?input=${encodeURIComponent(JSON.stringify({ json: { tourId } }))}`, {
    headers: { 'Cookie': `app_session_id=${token}` }
  });
  const data = await resp.json();
  const deps = data.result?.data?.json || [];
  return deps;
}

async function main() {
  const token = await createAdminToken();
  
  console.log('\n=== Fixing Round 30B Tours ===\n');
  
  // 1. Fix Thailand (1890013) - duration=0 -> 5, destinationCity fix
  console.log('1. Fixing Thailand tour (1890013)...');
  await updateTour(token, 1890013, { 
    duration: 5,
    destinationCountry: '泰國',
    destinationCity: '清邁, 清萊'
  });
  
  // Check if Thailand has departures
  const thaiDeps = await checkDepartures(token, 1890013);
  console.log(`   Thailand departures: ${thaiDeps.length}`);
  if (thaiDeps.length === 0) {
    console.log('   Creating Thailand departures...');
    const thaiDates = ['2026-05-08', '2026-05-29', '2026-06-19', '2026-07-10', '2026-07-31'];
    for (const d of thaiDates) {
      await createDeparture(token, 1890013, d, 59900, 53900, 49900, 22000, 20);
    }
  }
  
  // 2. Fix Switzerland (1890012) - destinationCountry empty
  console.log('\n2. Fixing Switzerland tour (1890012)...');
  await updateTour(token, 1890012, { 
    destinationCountry: '瑞士',
    destinationCity: '少女峰, 馬特洪峰, 瑞吉峰'
  });
  
  // Check if Switzerland has departures
  const swissDeps = await checkDepartures(token, 1890012);
  console.log(`   Switzerland departures: ${swissDeps.length}`);
  if (swissDeps.length === 0) {
    console.log('   Creating Switzerland departures...');
    const swissDates = ['2026-05-22', '2026-06-12', '2026-07-03', '2026-07-24', '2026-08-14'];
    for (const d of swissDates) {
      await createDeparture(token, 1890012, d, 119900, 107900, 99900, 42000, 20);
    }
  }
  
  // 3. Check Italy (1890011) departures
  console.log('\n3. Checking Italy tour (1890011)...');
  const italyDeps = await checkDepartures(token, 1890011);
  console.log(`   Italy departures: ${italyDeps.length}`);
  if (italyDeps.length === 0) {
    console.log('   Creating Italy departures...');
    const italyDates = ['2026-05-15', '2026-06-05', '2026-06-26', '2026-07-17', '2026-08-07'];
    for (const d of italyDates) {
      await createDeparture(token, 1890011, d, 89900, 80900, 74900, 35000, 20);
    }
  }
  
  // 4. Check Hokkaido (1890008) departures
  console.log('\n4. Checking Hokkaido tour (1890008)...');
  const hokkaidoDeps = await checkDepartures(token, 1890008);
  console.log(`   Hokkaido departures: ${hokkaidoDeps.length}`);
  if (hokkaidoDeps.length === 0) {
    console.log('   Creating Hokkaido departures...');
    const hokkaidoDates = ['2026-06-01', '2026-06-22', '2026-07-13', '2026-08-03', '2026-08-24'];
    for (const d of hokkaidoDates) {
      await createDeparture(token, 1890008, d, 49900, 42900, 38900, 18000, 25);
    }
  }
  
  console.log('\n=== Final Status Check ===');
  const tourIds = [1890011, 1890012, 1890013, 1890008];
  for (const id of tourIds) {
    const deps = await checkDepartures(token, id);
    console.log(`Tour ${id}: ${deps.length} departures`);
  }
  
  console.log('\nDone!');
}

main().catch(console.error);
