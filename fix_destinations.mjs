import * as jose from 'jose';

const JWT_SECRET = process.env.JWT_SECRET || '82JNwBHZppvdtgFL29R3xz';

async function createAdminToken() {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return await new jose.SignJWT({ userId: 630001 })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(secret);
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
    console.log(`  ✅ Updated ID=${id}: dest=${t.destinationCountry}, city=${t.destinationCity}`);
  } else {
    console.log(`  ❌ Failed ID=${id}:`, JSON.stringify(data).substring(0, 200));
  }
}

async function main() {
  const token = await createAdminToken();
  console.log('Fixing tour destinations...');
  
  // Fix Thailand tour (ID=1890013) - destinationCountry was empty, city was '雄獅旅遊'
  await updateTour(token, 1890013, { 
    destinationCountry: '泰國', 
    destinationCity: '清邁, 清萊' 
  });
  
  console.log('Done!');
}

main().catch(console.error);
