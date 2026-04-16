// Round 59 cleanup: delete all test inquiries and orders
import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';

dotenv.config({ quiet: true });

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Step 1: Check inquiries table name
const [tables] = await conn.execute("SHOW TABLES LIKE '%inquir%'");
console.log('Inquiry-related tables:', tables.map(t => Object.values(t)[0]));

const [tables2] = await conn.execute("SHOW TABLES LIKE '%order%'");
console.log('Order-related tables:', tables2.map(t => Object.values(t)[0]));

// Step 2: Count test inquiries
try {
  const [inquiryCount] = await conn.execute("SELECT COUNT(*) as cnt FROM inquiries");
  console.log(`\nTotal inquiries: ${inquiryCount[0].cnt}`);
  
  const [testInquiries] = await conn.execute("SELECT COUNT(*) as cnt FROM inquiries WHERE email = 'guest@test.com'");
  console.log(`Test inquiries (guest@test.com): ${testInquiries[0].cnt}`);
  
  // Delete all test inquiries
  const [delResult] = await conn.execute("DELETE FROM inquiries WHERE email = 'guest@test.com'");
  console.log(`✅ Deleted ${delResult.affectedRows} test inquiries`);
  
  const [remaining] = await conn.execute("SELECT COUNT(*) as cnt FROM inquiries");
  console.log(`Remaining inquiries: ${remaining[0].cnt}`);
} catch (e) {
  console.log('inquiries table error:', e.message);
}

// Step 3: Count test orders
try {
  const [orderCount] = await conn.execute("SELECT COUNT(*) as cnt FROM orders");
  console.log(`\nTotal orders: ${orderCount[0].cnt}`);
  
  // Find test user ID
  const [testUser] = await conn.execute("SELECT id FROM users WHERE email = 'test@example.com'");
  if (testUser.length > 0) {
    const testUserId = testUser[0].id;
    console.log(`Test user ID: ${testUserId}`);
    
    const [testOrders] = await conn.execute("SELECT COUNT(*) as cnt FROM orders WHERE userId = ?", [testUserId]);
    console.log(`Test orders (test@example.com): ${testOrders[0].cnt}`);
    
    const [delResult] = await conn.execute("DELETE FROM orders WHERE userId = ?", [testUserId]);
    console.log(`✅ Deleted ${delResult.affectedRows} test orders`);
  } else {
    console.log('No test user found with email test@example.com');
    // Try to delete all pending/unpaid orders
    const [pendingOrders] = await conn.execute("SELECT COUNT(*) as cnt FROM orders WHERE status = 'pending'");
    console.log(`Pending orders: ${pendingOrders[0].cnt}`);
    
    const [delResult] = await conn.execute("DELETE FROM orders WHERE status = 'pending'");
    console.log(`✅ Deleted ${delResult.affectedRows} pending orders`);
  }
  
  const [remaining] = await conn.execute("SELECT COUNT(*) as cnt FROM orders");
  console.log(`Remaining orders: ${remaining[0].cnt}`);
} catch (e) {
  console.log('orders table error:', e.message);
  // Try alternate table name
  try {
    const [allTables] = await conn.execute("SHOW TABLES");
    console.log('All tables:', allTables.map(t => Object.values(t)[0]).join(', '));
  } catch (e2) {
    console.log('Cannot list tables:', e2.message);
  }
}

await conn.end();
console.log('\n=== Test data cleanup complete ===');
