import * as jose from 'jose';

const JWT_SECRET = '82JNwBHZppvdtgFL29R3xz';

const COVER_IMAGES = {
  1890011: 'https://d2xsxph8kpxj0f.cloudfront.net/310519663159191204/D3XjbQ67JpFf2y4FWefWHw/italy_cover_4ac97f78.jpg',
  1890012: 'https://d2xsxph8kpxj0f.cloudfront.net/310519663159191204/D3XjbQ67JpFf2y4FWefWHw/switzerland_cover_f18e4950.jpg',
  1890013: 'https://d2xsxph8kpxj0f.cloudfront.net/310519663159191204/D3XjbQ67JpFf2y4FWefWHw/thailand_cover_fb67d8ad.jpg',
  1890008: 'https://d2xsxph8kpxj0f.cloudfront.net/310519663159191204/D3XjbQ67JpFf2y4FWefWHw/hokkaido_cover_18727062.jpg',
};

async function createAdminToken() {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return await new jose.SignJWT({ userId: 630001 })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(secret);
}

async function updateTourCover(token, id, imageUrl) {
  const resp = await fetch('http://localhost:3000/api/trpc/tours.update', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Cookie': `app_session_id=${token}`
    },
    body: JSON.stringify({ json: { id, imageUrl } })
  });
  const data = await resp.json();
  if (data.result?.data?.json) {
    const t = data.result.data.json;
    console.log(`  ✅ ID=${id}: imageUrl=${t.imageUrl ? 'SET' : 'NOT SET'}`);
  } else {
    console.log(`  ❌ Failed ID=${id}:`, JSON.stringify(data).substring(0, 200));
  }
}

async function main() {
  const token = await createAdminToken();
  console.log('Updating cover images for 4 new tours...');
  
  for (const [id, url] of Object.entries(COVER_IMAGES)) {
    await updateTourCover(token, parseInt(id), url);
  }
  
  console.log('Done!');
}

main().catch(console.error);
