import { createRequire } from 'module';
import { SignJWT } from 'jose';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;
const secret = new TextEncoder().encode(JWT_SECRET);

// Create admin session token for user 630001 (Jeff Hsieh)
const token = await new SignJWT({ userId: 630001, role: 'admin' })
  .setProtectedHeader({ alg: 'HS256' })
  .setExpirationTime('1h')
  .sign(secret);

// Use NZ liontravel URL with forceRegenerate: true
const testUrl = 'https://travel.liontravel.com/detail?NormGroupID=4755656c-bdc4-4a27-b558-ccc37b41f9a0&GroupID=26NZ524CX-T&Platform=APP&fr=cg451T0301C0101M01';

// tRPC v11 batch format with superjson
const input = {
  url: testUrl,
  forceRegenerate: true,
  isPdf: false
};

const response = await fetch('http://localhost:3000/api/trpc/tours.submitAsyncGeneration?batch=1', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': `app_session_id=${token}`
  },
  body: JSON.stringify({
    "0": {
      json: input
    }
  })
});

const text = await response.text();
console.log('Status:', response.status);
console.log('Response:', text.slice(0, 500));
