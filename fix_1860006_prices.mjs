// Use the tRPC API to update departures
const COOKIE_NAME = 'app_session_id';
const JWT_SECRET = process.env.JWT_SECRET;
const OWNER_OPEN_ID = process.env.OWNER_OPEN_ID;

// Create admin JWT token
const { SignJWT } = await import('jose');
const secret = new TextEncoder().encode(JWT_SECRET);
const token = await new SignJWT({ openId: OWNER_OPEN_ID, role: 'admin' })
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setExpirationTime('1h')
  .sign(secret);

// Get user info first
const meRes = await fetch('http://localhost:3000/api/trpc/auth.me', {
  headers: { Cookie: `${COOKIE_NAME}=${token}` }
});
const meData = await meRes.json();
const userId = meData?.result?.data?.json?.id;
console.log('Admin user ID:', userId);

// Get departures for tour 1860006
const depsRes = await fetch('http://localhost:3000/api/trpc/departures.list?input=%7B%22json%22%3A%7B%22tourId%22%3A1860006%7D%7D', {
  headers: { Cookie: `${COOKIE_NAME}=${token}` }
});
const depsData = await depsRes.json();
const deps = depsData?.result?.data?.json || [];
console.log(`Found ${deps.length} departures for tour 1860006`);

// Update each departure with correct prices
let successCount = 0;
for (const dep of deps) {
  const updateRes = await fetch('http://localhost:3000/api/trpc/departures.update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${COOKIE_NAME}=${token}`
    },
    body: JSON.stringify({
      json: {
        id: dep.id,
        adultPrice: 128900,
        childPrice: 115000,
        infantPrice: 45000
      }
    })
  });
  const updateData = await updateRes.json();
  if (updateData?.result?.data) {
    successCount++;
    console.log(`  ✅ Updated departure ID=${dep.id}: adult=128900, child=115000, infant=45000`);
  } else {
    console.log(`  ❌ Failed to update departure ID=${dep.id}:`, JSON.stringify(updateData).slice(0, 200));
  }
}

console.log(`\nDone: ${successCount}/${deps.length} departures updated`);

// Verify
const verifyRes = await fetch('http://localhost:3000/api/trpc/departures.list?input=%7B%22json%22%3A%7B%22tourId%22%3A1860006%7D%7D', {
  headers: { Cookie: `${COOKIE_NAME}=${token}` }
});
const verifyData = await verifyRes.json();
const verifyDeps = verifyData?.result?.data?.json || [];
console.log('\nVerification:');
for (const dep of verifyDeps) {
  console.log(`  ID=${dep.id} adult=${dep.adultPrice} child=${dep.childPrice} infant=${dep.infantPrice}`);
}
