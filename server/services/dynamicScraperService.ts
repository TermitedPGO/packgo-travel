/**
 * DynamicScraperService
 * 使用 Puppeteer + 系統 Chromium 動態渲染網頁，並截圖供 AI Vision 分析
 */

import puppeteer from 'puppeteer-core';

export interface DynamicScrapeResult {
  renderedHtml: string;        // 完整渲染後 HTML
  rawText: string;             // 頁面純文字
  screenshots: {               // 關鍵區域截圖
    fullPage: Buffer;          // 整頁截圖
    dateSection?: Buffer;      // 日期區塊截圖（如果找到的話）
    priceSection?: Buffer;     // 價格區塊截圖
  };
  pageTitle: string;
  sourceUrl: string;
  scrapedAt: Date;
}

// 系統 Chromium 路徑
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

// 日期區塊的 CSS 選擇器（依優先順序嘗試）
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
  '.trip-date',
];

// 價格區塊的 CSS 選擇器
const PRICE_SELECTORS = [
  '[class*="price"]',
  '[class*="pricing"]',
  '[class*="fee"]',
  '[class*="cost"]',
  '[id*="price"]',
  '.tour-price',
  '.price-table',
  '.price-section',
];

/**
 * 動態爬取網頁，返回渲染後 HTML + 截圖
 */
export async function scrapeDynamicPage(url: string): Promise<DynamicScrapeResult> {
  console.log(`[DynamicScraper] Starting dynamic scrape: ${url}`);
  
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--hide-scrollbars',
        '--metrics-recording-only',
        '--mute-audio',
        '--safebrowsing-disable-auto-update',
      ],
    });

    const page = await browser.newPage();

    // 設定 viewport 和 User-Agent
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // 設定超時 25 秒（給足夠時間但不過長）
    page.setDefaultNavigationTimeout(25000);
    page.setDefaultTimeout(25000);

    // 導航到目標 URL
    // Strategy: try networkidle2 (20s) first for static sites; SPA sites like liontravel.com will timeout
    // and fall back to domcontentloaded (20s) + 5s JS execution wait
    console.log(`[DynamicScraper] Navigating to: ${url}`);
    try {
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 20000, // Reduced from 30s to 20s - SPAs rarely achieve networkidle2
      });
      console.log(`[DynamicScraper] ✓ networkidle2 achieved`);
    } catch (navErr) {
      // SPA sites like liontravel.com will always timeout on networkidle2
      // Fall back to domcontentloaded and wait for JS to execute
      console.warn(`[DynamicScraper] networkidle2 timeout (expected for SPAs), falling back to domcontentloaded`);
      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        // Wait 5 seconds for SPA JS framework to render content (React/Vue/Angular)
        console.log(`[DynamicScraper] domcontentloaded OK, waiting 5s for SPA rendering...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (fallbackErr) {
        console.warn(`[DynamicScraper] Navigation fallback also failed, using partial content`);
      }
    }

    // 自動滾動頁面，觸發 lazy load
    console.log(`[DynamicScraper] Auto-scrolling for lazy load...`);
    await autoScroll(page);

    // 取得頁面標題
    const pageTitle = await page.title().catch(() => '');

    // 取得渲染後 HTML
    const renderedHtml = await page.content().catch(() => '');

    // 取得純文字（移除 script/style 標籤）
    const rawText = await page.evaluate(() => {
      // 移除 script 和 style 元素
      const scripts = document.querySelectorAll('script, style, noscript');
      scripts.forEach(el => el.remove());
      return document.body?.innerText || document.body?.textContent || '';
    }).catch(() => '');

    // 截全頁圖
    console.log(`[DynamicScraper] Taking full page screenshot...`);
    const fullPageBuffer = await page.screenshot({
      fullPage: true,
      type: 'jpeg',
      quality: 80,
    }).catch(() => Buffer.alloc(0)) as Buffer;

    // 嘗試截日期區塊
    let dateSectionBuffer: Buffer | undefined;
    for (const selector of DATE_SELECTORS) {
      try {
        const element = await page.$(selector);
        if (element) {
          const box = await element.boundingBox();
          if (box && box.height > 50 && box.width > 100) {
            dateSectionBuffer = await element.screenshot({
              type: 'jpeg',
              quality: 80,
            }) as Buffer;
            console.log(`[DynamicScraper] Date section found with selector: ${selector}`);
            break;
          }
        }
      } catch {
        // 繼續嘗試下一個選擇器
      }
    }

    // 嘗試截價格區塊
    let priceSectionBuffer: Buffer | undefined;
    for (const selector of PRICE_SELECTORS) {
      try {
        const element = await page.$(selector);
        if (element) {
          const box = await element.boundingBox();
          if (box && box.height > 50 && box.width > 100) {
            priceSectionBuffer = await element.screenshot({
              type: 'jpeg',
              quality: 80,
            }) as Buffer;
            console.log(`[DynamicScraper] Price section found with selector: ${selector}`);
            break;
          }
        }
      } catch {
        // 繼續嘗試下一個選擇器
      }
    }

    console.log(`[DynamicScraper] Scrape completed. HTML: ${renderedHtml.length} chars, Text: ${rawText.length} chars`);
    console.log(`[DynamicScraper] Screenshots: fullPage=${fullPageBuffer.length} bytes, dateSection=${dateSectionBuffer?.length || 0} bytes, priceSection=${priceSectionBuffer?.length || 0} bytes`);

    return {
      renderedHtml,
      rawText,
      screenshots: {
        fullPage: fullPageBuffer,
        dateSection: dateSectionBuffer,
        priceSection: priceSectionBuffer,
      },
      pageTitle,
      sourceUrl: url,
      scrapedAt: new Date(),
    };
  } finally {
    if (browser) {
      await browser.close().catch(err => console.warn('[DynamicScraper] Error closing browser:', err));
    }
  }
}

/**
 * 自動滾動頁面以觸發 lazy load
 */
async function autoScroll(page: any): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 300;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight || totalHeight > 15000) {
          clearInterval(timer);
          window.scrollTo(0, 0); // 滾回頂部
          resolve();
        }
      }, 100);
    });
  }).catch(() => {
    // 忽略滾動錯誤
  });
}

/**
 * Fallback：使用靜態 HTTP 抓取（當 Puppeteer 失敗時）
 */
export async function scrapeStaticFallback(url: string): Promise<Partial<DynamicScrapeResult>> {
  console.log(`[DynamicScraper] Using static HTTP fallback for: ${url}`);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    // 簡單提取文字（移除 HTML 標籤）
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    
    return {
      renderedHtml: html,
      rawText: text.slice(0, 50000), // 限制文字長度
      screenshots: { fullPage: Buffer.alloc(0) },
      pageTitle: html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '',
      sourceUrl: url,
      scrapedAt: new Date(),
    };
  } catch (err) {
    console.error(`[DynamicScraper] Static fallback also failed:`, err);
    throw err;
  }
}
