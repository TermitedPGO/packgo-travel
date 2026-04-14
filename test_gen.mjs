/**
 * test_gen.mjs — 建立 admin session + 觸發行程生成
 * Run: node test_gen.mjs
 */
import 'dotenv/config';
import { SignJWT } from 'jose';
import http from 'http';

const JWT_SECRET = process.env.JWT_SECRET;
const OWNER_OPEN_ID = process.env.OWNER_OPEN_ID;
const VITE_APP_ID = process.env.VITE_APP_ID;

if (!JWT_SECRET || !OWNER_OPEN_ID) {
  console.error('Missing JWT_SECRET or OWNER_OPEN_ID');
  process.exit(1);
}

// Create a session token for the owner (admin)
const secretKey = new TextEncoder().encode(JWT_SECRET);
const token = await new SignJWT({
  openId: OWNER_OPEN_ID,
  appId: VITE_APP_ID || '',
  name: 'TestAdmin',
})
  .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
  .setExpirationTime('1h')
  .sign(secretKey);

console.log('✅ Admin session token created');

// Trigger tour generation via tRPC
const body = JSON.stringify({
  '0': {
    json: {
      url: 'https://www.kkday.com/zh-tw/product/20245',
      forceRegenerate: true,
      isPdf: false,
    },
  },
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/trpc/tours.submitAsyncGeneration?batch=1',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    Cookie: `session=${token}`,
  },
};

console.log('🚀 Triggering tour generation for KKday product 20245...');

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => (data += chunk));
  res.on('end', () => {
    console.log(`Response status: ${res.statusCode}`);
    try {
      const parsed = JSON.parse(data);
      console.log('Response:', JSON.stringify(parsed, null, 2).substring(0, 500));
    } catch {
      console.log('Raw response:', data.substring(0, 500));
    }
  });
});

req.on('error', (e) => console.error('Request error:', e.message));
req.write(body);
req.end();
