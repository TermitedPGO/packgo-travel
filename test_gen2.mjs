/**
 * test_gen2.mjs — 建立 admin session (userId-based JWT) + 觸發行程生成
 * Run: node test_gen2.mjs
 */
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import http from 'http';
import mysql2 from 'mysql2/promise';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-not-for-production';
const DATABASE_URL = process.env.DATABASE_URL;
const OWNER_OPEN_ID = process.env.OWNER_OPEN_ID;

if (!DATABASE_URL || !OWNER_OPEN_ID) {
  console.error('Missing DATABASE_URL or OWNER_OPEN_ID');
  process.exit(1);
}

// Connect to DB and get the admin user's ID
const conn = await mysql2.createConnection(DATABASE_URL);
// Try by openId first, then fall back to first admin user
let [rows] = await conn.execute(
  'SELECT id, role, name FROM users WHERE openId = ? LIMIT 1',
  [OWNER_OPEN_ID]
);
if (!rows.length) {
  // Fall back to first admin user
  [rows] = await conn.execute("SELECT id, role, name FROM users WHERE role='admin' ORDER BY id LIMIT 1");
}
await conn.end();

if (!rows.length) {
  console.error('No admin user found in DB.');
  process.exit(1);
}

const adminUser = rows[0];
console.log(`✅ Found admin user: id=${adminUser.id}, role=${adminUser.role}, name=${adminUser.name}`);

// Create JWT token with userId payload (matches server/jwt.ts format)
const token = jwt.sign(
  {
    userId: adminUser.id,
    email: `${OWNER_OPEN_ID}@oauth.local`,
    name: adminUser.name || 'TestAdmin',
    role: adminUser.role,
  },
  JWT_SECRET,
  { expiresIn: '1h' }
);

console.log('✅ JWT token created (userId-based)');

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
    Cookie: `app_session_id=${token}`,
  },
};

console.log('🚀 Triggering tour generation for KKday product 20245...');
console.log('📊 Monitoring log for ClaudeAgent and CalibrationAgent output...');

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => (data += chunk));
  res.on('end', () => {
    console.log(`\nResponse status: ${res.statusCode}`);
    try {
      const parsed = JSON.parse(data);
      const result = parsed[0]?.result?.data?.json;
      if (result) {
        console.log('✅ Generation triggered successfully!');
        console.log('Job ID:', result.jobId || result.id || JSON.stringify(result).substring(0, 200));
      } else {
        console.log('Response:', JSON.stringify(parsed, null, 2).substring(0, 500));
      }
    } catch {
      console.log('Raw response:', data.substring(0, 500));
    }
    console.log('\n⏳ Generation is running in background. Check log with:');
    console.log('  grep -n "ClaudeAgent\\|CalibrationAgent\\|Self-Repair\\|dateExtractor" /home/ubuntu/packgo-travel/.manus-logs/devserver.log | tail -100');
  });
});

req.on('error', (e) => console.error('Request error:', e.message));
req.write(body);
req.end();
