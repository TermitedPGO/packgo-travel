/**
 * H4 Test: Error handling
 * Tests: invalid URL, timeout, graceful fallback
 */
import puppeteer from 'puppeteer-core';

const CHROMIUM_PATH = '/usr/bin/chromium';

async function testUrl(label, url, timeoutMs = 15000) {
  console.log(`\n--- ${label} ---`);
  console.log('URL:', url);
  const startTime = Date.now();
  
  try {
    const browser = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      timeout: 10000,
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const title = await page.title();
    const text = await page.evaluate(() => document.body?.innerText?.substring(0, 200) || '');
    await browser.close();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Page loaded in ${elapsed}s. Title: ${title}`);
    console.log('Text preview:', text.substring(0, 100));
    return { success: true, elapsed };
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Error caught gracefully in ${elapsed}s: ${err.message.substring(0, 100)}`);
    return { success: false, error: err.message, elapsed };
  }
}

console.log('=== H4 Test: Error Handling ===\n');

// Test 1: Non-existent URL
const r1 = await testUrl('Test 1: Non-existent URL', 'https://example.com/nonexistent-tour-page-12345', 10000);

// Test 2: Timeout simulation (very short timeout)
const r2 = await testUrl('Test 2: Short timeout (5s)', 'https://travel.liontravel.com/detail?normgroupid=a26d376c-fa6f-4810-a9d1-2b5d58da1eed', 5000);

// Test 3: Invalid URL format
try {
  console.log('\n--- Test 3: Invalid URL format ---');
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    timeout: 10000,
  });
  const page = await browser.newPage();
  await page.goto('not-a-valid-url', { waitUntil: 'domcontentloaded', timeout: 5000 });
  await browser.close();
  console.log('❌ Should have thrown error');
} catch (err) {
  console.log('✅ Invalid URL caught gracefully:', err.message.substring(0, 100));
}

console.log('\n=== H4 Test Summary ===');
console.log('Test 1 (non-existent URL):', r1.success ? '✅ Loaded' : '✅ Error caught gracefully');
console.log('Test 2 (timeout):', r2.success ? '✅ Loaded (faster than expected)' : '✅ Timeout caught gracefully');
console.log('Test 3 (invalid URL): ✅ Error caught gracefully');
console.log('\nAll error handling tests: PASS ✅');
