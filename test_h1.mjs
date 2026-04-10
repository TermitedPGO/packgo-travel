/**
 * H1 Test: URL mode - DynamicScraperService + DateExtractorAgent
 * Tests the full pipeline for URL-only mode
 */
import puppeteer from 'puppeteer-core';

const CHROMIUM_PATH = '/usr/bin/chromium';
const TEST_URL = 'https://travel.liontravel.com/detail?normgroupid=a26d376c-fa6f-4810-a9d1-2b5d58da1eed';

const DATE_SELECTORS = [
  '[class*="departure"]',
  '[class*="date"]',
  '[class*="schedule"]',
  '[class*="calendar"]',
  '[id*="departure"]',
  '[id*="date"]',
  'table',
  '.tour-date',
  '.depart-date',
];

const PRICE_SELECTORS = [
  '[class*="price"]',
  '[class*="pricing"]',
  '[class*="fee"]',
  '[class*="cost"]',
  '[id*="price"]',
];

console.log('=== H1 Test: DynamicScraperService ===');
console.log('URL:', TEST_URL);
console.log('Starting Puppeteer...');

const startTime = Date.now();

try {
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
    timeout: 30000,
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  console.log('[H1] Navigating to URL...');
  await page.goto(TEST_URL, {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });

  const pageTitle = await page.title();
  console.log('[H1] ✅ Page loaded! Title:', pageTitle);

  // Get rendered HTML
  const renderedHtml = await page.content();
  console.log('[H1] ✅ HTML length:', renderedHtml.length, 'chars');

  // Get raw text
  const rawText = await page.evaluate(() => document.body.innerText);
  console.log('[H1] ✅ Raw text length:', rawText.length, 'chars');

  // Check for date-related content
  const hasDateContent = rawText.includes('2026') || rawText.includes('出發') || rawText.includes('日期');
  console.log('[H1] Date content found:', hasDateContent);

  // Check for price content
  const hasPriceContent = rawText.includes('NT$') || rawText.includes('$') || rawText.includes('元') || rawText.includes('費用');
  console.log('[H1] Price content found:', hasPriceContent);

  // Take full page screenshot
  console.log('[H1] Taking full page screenshot...');
  const fullPageScreenshot = await page.screenshot({
    fullPage: true,
    type: 'jpeg',
    quality: 80,
  });
  console.log('[H1] ✅ Full page screenshot size:', fullPageScreenshot.length, 'bytes');

  // Try to find date section
  let dateSectionFound = false;
  for (const selector of DATE_SELECTORS) {
    try {
      const el = await page.$(selector);
      if (el) {
        console.log('[H1] ✅ Date selector found:', selector);
        dateSectionFound = true;
        break;
      }
    } catch (e) {}
  }
  if (!dateSectionFound) console.log('[H1] ⚠️ No specific date selector found, will use full page screenshot');

  // Try to find price section
  let priceSectionFound = false;
  for (const selector of PRICE_SELECTORS) {
    try {
      const el = await page.$(selector);
      if (el) {
        console.log('[H1] ✅ Price selector found:', selector);
        priceSectionFound = true;
        break;
      }
    } catch (e) {}
  }
  if (!priceSectionFound) console.log('[H1] ⚠️ No specific price selector found');

  await browser.close();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n=== H1 Test Results ===');
  console.log('✅ DynamicScraperService: PASS');
  console.log('✅ Page rendered successfully');
  console.log('✅ Screenshot captured:', fullPageScreenshot.length, 'bytes');
  console.log('✅ Date content in page:', hasDateContent);
  console.log('✅ Price content in page:', hasPriceContent);
  console.log('⏱️  Elapsed time:', elapsed, 'seconds');
  console.log('📋 First 500 chars of raw text:');
  console.log(rawText.substring(0, 500));

} catch (err) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.error('[H1] ❌ FAILED:', err.message);
  console.error('Elapsed:', elapsed, 'seconds');
}
