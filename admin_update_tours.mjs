import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-not-for-production';
const BASE_URL = 'http://localhost:3000';
const COOKIE_NAME = 'app_session_id';

// Admin user ID (from the createdBy field in tours data)
const ADMIN_USER_ID = 630001;

// Create admin JWT token
function createAdminToken() {
  return jwt.sign(
    { userId: ADMIN_USER_ID, email: 'admin@packgo.test', role: 'admin', name: 'Admin' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function callTRPCMutation(procedure, input, token) {
  const url = `${BASE_URL}/api/trpc/${procedure}`;
  const body = JSON.stringify({ json: input });
  
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
    throw new Error(`TRPC error: ${JSON.stringify(data.error)}`);
  }
  return data.result?.data?.json;
}

async function main() {
  const token = createAdminToken();
  console.log('Admin token created');
  
  // Test auth
  const authResp = await fetch(`${BASE_URL}/api/trpc/auth.me`, {
    headers: { 'Cookie': `${COOKIE_NAME}=${token}` }
  });
  const authData = await authResp.json();
  const user = authData?.result?.data?.json;
  console.log('Auth check:', user?.id, user?.role, user?.name);
  
  if (!user || user.role !== 'admin') {
    console.error('Not authenticated as admin!');
    return;
  }
  
  // Updates to apply
  const updates = [
    // Fix destinationCity errors
    { id: 1890009, destinationCity: '伊斯坦堡, 卡帕多奇亞', status: 'active' },
    { id: 1890008, destinationCity: '函館, 札幌, 小樽', destinationCountry: '日本', status: 'active' },
    { id: 1890007, destinationCity: '曼谷, 芭達雅', status: 'active' },
    { id: 1890006, destinationCity: '蘇黎世, 少女峰, 盧塞恩', destinationCountry: '瑞士', status: 'active' },
    { id: 1890005, destinationCity: '羅馬, 佛羅倫斯, 威尼斯', status: 'active' },
  ];
  
  for (const update of updates) {
    try {
      const result = await callTRPCMutation('tours.update', update, token);
      console.log(`✅ Updated tour ${update.id}: ${result?.title?.substring(0, 30)}`);
    } catch (err) {
      console.error(`❌ Failed to update tour ${update.id}:`, err.message);
    }
  }
  
  console.log('\nDone! All updates applied.');
}

main().catch(console.error);
