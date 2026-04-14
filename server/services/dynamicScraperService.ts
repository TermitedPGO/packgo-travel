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
  priceHints?: {               // JS 價格擷取結果（供 dateExtractorAgent 參考）
    adultPrice?: number;
    childWithBedPrice?: number;
    childNoBedPrice?: number;
    infantPrice?: number;
    rawPriceTexts: string[];   // 原始價格文字（供 AI 參考）
  };
  // Round 50: Structured API data intercepted from liontravel.com
  lionApiData?: {
    travelInfo?: any;    // /detail/travelinfojson
    daytrip?: any;       // /detail/daytripinfojson
    pricing?: any;       // /detail/priceinfojson
    notice?: any;        // /detail/noticeinfojson
  };
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
  // 通用 class 名稱
  '[class*="price"]',
  '[class*="pricing"]',
  '[class*="fee"]',
  '[class*="cost"]',
  '[class*="amount"]',
  '[class*="total"]',
  // ID 選擇器
  '[id*="price"]',
  '[id*="pricing"]',
  // 通用 class
  '.tour-price',
  '.price-table',
  '.price-section',
  '.price',
  // data 屬性
  '[data-price]',
  '[data-pricing]',
  // 台灣旅遊網站常見
  '[class*="ntd"]',
  '[class*="twd"]',
  '[class*="dollar"]',
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

    // ═══ Round 50: Capture liontravel structured API data ═══
    const lionApiCapture: {
      travelInfo?: any;
      daytrip?: any;
      pricing?: any;
      notice?: any;
    } = {};

    // ═══ Round 49: API Response Interception Test ═══
    const interceptedApiResponses: Array<{
      url: string;
      status: number;
      contentType: string;
      dataSize: number;
      dataPreview: string;  // 前 500 字元
      fullData?: any;       // 完整 JSON（如果 < 50KB）
    }> = [];

    page.on('response', async (response) => {
      try {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';
        const status = response.status();
        
        // 只攔截 JSON API 回應（排除靜態資源）
        if (
          status === 200 &&
          (contentType.includes('json') || contentType.includes('javascript')) &&
          !url.includes('.js') &&    // 排除 JS bundle
          !url.includes('.css') &&   // 排除 CSS
          !url.includes('google') && // 排除 GA/GTM
          !url.includes('facebook')  // 排除 FB pixel
        ) {
          const text = await response.text().catch(() => '');
          if (text.length > 50 && text.length < 500000) {
            let parsedData: any = null;
            try { parsedData = JSON.parse(text); } catch {}
            
            const entry = {
              url: url.slice(0, 200),
              status,
              contentType: contentType.slice(0, 50),
              dataSize: text.length,
              dataPreview: text.slice(0, 500),
              fullData: text.length < 50000 ? parsedData : undefined,
            };
            interceptedApiResponses.push(entry);
            console.log(`[APIIntercept] 📡 ${status} ${url.slice(0, 100)} (${text.length} bytes)`);

            // Round 50: Capture key liontravel API responses
            if (parsedData && url.includes('liontravel.com/detail/')) {
              if (url.includes('travelinfojson')) lionApiCapture.travelInfo = parsedData;
              else if (url.includes('daytripinfojson')) lionApiCapture.daytrip = parsedData;
              else if (url.includes('priceinfojson')) lionApiCapture.pricing = parsedData;
              else if (url.includes('noticeinfojson')) lionApiCapture.notice = parsedData;
            }
          }
        }
      } catch (e) {
        // 非致命錯誤，忽略
      }
    });
    // ═══ End API Interception ═══

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

    // ═══ Log intercepted API results ═══
    console.log(`\n[APIIntercept] ═══ 攔截結果 ═══`);
    console.log(`[APIIntercept] 共攔截 ${interceptedApiResponses.length} 個 API 回應：`);
    for (const resp of interceptedApiResponses) {
      console.log(`[APIIntercept] ──────────────────────`);
      console.log(`[APIIntercept] URL: ${resp.url}`);
      console.log(`[APIIntercept] Size: ${resp.dataSize} bytes`);
      console.log(`[APIIntercept] Preview: ${resp.dataPreview.slice(0, 300)}`);
      
      // 如果有完整 JSON，列出 top-level keys
      if (resp.fullData && typeof resp.fullData === 'object') {
        const keys = Object.keys(resp.fullData);
        console.log(`[APIIntercept] JSON keys: [${keys.join(', ')}]`);
        
        // 特別標記可能包含行程資料的 API
        const interestingKeys = ['itinerary', 'schedule', 'tour', 'detail', 'price', 
          'departure', 'hotel', 'meal', 'day', 'flight', 'content', 'data', 'result'];
        const matchedKeys = keys.filter(k => 
          interestingKeys.some(ik => k.toLowerCase().includes(ik))
        );
        if (matchedKeys.length > 0) {
          console.log(`[APIIntercept] ⭐ 可能的行程資料 keys: [${matchedKeys.join(', ')}]`);
        }
      }
    }
    console.log(`[APIIntercept] ═══════════════════\n`);
    // ═══ End log ═══

    // ═══ Round 49b: 從瀏覽器內部呼叫雄獅 API ═══
    const lionApiData = await page.evaluate(async () => {
      const results: Record<string, any> = {};
      
      // Step 1: 讀取 SSR 嵌入的 JSON
      try {
        const tourParaEl = document.querySelector('#tourPara');
        if (tourParaEl) {
          const tourParaText = tourParaEl.getAttribute('value') 
            || tourParaEl.textContent 
            || tourParaEl.innerHTML;
          results['tourPara'] = tourParaText?.slice(0, 2000);
        }
      } catch(e) { results['tourPara_error'] = String(e); }
      
      try {
        const seoParaEl = document.querySelector('#seoPara');
        if (seoParaEl) {
          results['seoPara'] = (seoParaEl.getAttribute('value') || seoParaEl.textContent)?.slice(0, 2000);
        }
      } catch(e) {}
      
      // Step 2: 呼叫 API 端點（帶瀏覽器 cookies）
      const apiEndpoints = [
        'daytripinfojson',
        'tourinfojson', 
        'priceinfojson',
        'groupcalendarjson',
        'noticeinfojson',
        'packageinfojson',
        'travelinfojson',
      ];
      
      // 從當前 URL 取得參數
      const params = new URLSearchParams(window.location.search);
      const queryString = params.toString();
      
      for (const endpoint of apiEndpoints) {
        try {
          // 嘗試多種 URL 格式
          const urls = [
            `/${endpoint}?${queryString}`,
            `/detail/${endpoint}?${queryString}`,
            `/Content/TourDetail/${endpoint}?${queryString}`,
          ];
          
          for (const url of urls) {
            try {
              const resp = await fetch(url, {
                credentials: 'include',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
              });
              if (resp.ok) {
                const text = await resp.text();
                results[endpoint] = {
                  url: url,
                  status: resp.status,
                  size: text.length,
                  preview: text.slice(0, 1000),
                  isJson: text.startsWith('{') || text.startsWith('['),
                };
                break; // 找到了就不再試其他 URL 格式
              }
            } catch {}
          }
          
          if (!results[endpoint]) {
            results[endpoint] = { status: 'not_found' };
          }
        } catch(e) {
          results[endpoint] = { error: String(e) };
        }
      }
      
      // Step 3: 搜尋頁面上所有 data-* 屬性中的 JSON
      const allDataAttrs: Record<string, string> = {};
      document.querySelectorAll('[data-json], [data-info], [data-config], [data-para]').forEach((el: Element) => {
        Array.from((el as HTMLElement).attributes).forEach(attr => {
          if (attr.name.startsWith('data-') && attr.value.length > 20) {
            allDataAttrs[`${(el as HTMLElement).id || (el as HTMLElement).className}_${attr.name}`] = attr.value.slice(0, 500);
          }
        });
      });
      if (Object.keys(allDataAttrs).length > 0) {
        results['dataAttributes'] = allDataAttrs;
      }
      
      return results;
    }).catch((e: any) => ({ evaluate_error: String(e) }));

    // 完整印出結果
    console.log(`\n[LionAPI] ═══ 雄獅 API 偵察結果 ═══`);
    for (const [key, value] of Object.entries(lionApiData)) {
      console.log(`[LionAPI] 📡 ${key}:`);
      console.log(`[LionAPI]   ${JSON.stringify(value).slice(0, 500)}`);
    }
    console.log(`[LionAPI] ═══════════════════════\n`);
    // ═══ End Round 49b ═══

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

    // JS 價格擷取：直接從 DOM 讀取價格數字（不依賴截圖）
    // P0-Context Round 39: 升級為 TreeWalker DOM 遍歷 + CSS 選擇器雙策略
    const priceHints = await page.evaluate(() => {
      const rawPriceTexts: string[] = [];
      const pricePatterns = [
        /NT\$?\s*([\d,]+)/gi,
        /\$\s*([\d,]+)/g,
        /([\d,]+)\s*元/g,
        /([\d,]+)\s*TWD/gi,
        /([\d,]+)\s*(?:\/人|\/位)/g,
        // 多幣別
        /(?:USD|US\$)\s*([\d,]+)/gi,
        /(?:EUR|€)\s*([\d,]+)/gi,
        /(?:JPY|¥|･)\s*([\d,]+)/gi,
        /(?:GBP|£)\s*([\d,]+)/gi,
        /(?:KRW|₩)\s*([\d,]+)/gi,
      ];

      // ── 策略 A：CSS 選擇器（快速，適合有 class 的網站）──
      const priceSelectors = [
        '[class*="price"]', '[class*="pricing"]', '[class*="fee"]',
        '[class*="cost"]', '[class*="amount"]', '[data-price]',
        '[class*="ntd"]', '[class*="twd"]',
      ];
      for (const sel of priceSelectors) {
        try {
          const els = document.querySelectorAll(sel);
          els.forEach(el => {
            const text = (el as HTMLElement).innerText || el.textContent || '';
            if (text.match(/[\d,]{4,}/) && text.length < 200) {
              rawPriceTexts.push(text.trim().slice(0, 100));
            }
          });
        } catch {}
      }

      // ── 策略 B：TreeWalker DOM 遍歷（適合混淆 class 的網站，如 liontravel）──
      // 找到包含價格關鍵字的文字節點，取其父元素的上下文文字
      try {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null) !== null) {
          const text = node.textContent || '';
          if (/TWD|NT\$|NTD|USD|US\$|EUR|€|JPY|¥|円|GBP|£|KRW|₩|元\/人|成人|大人|小孩佔床|不佔床|嬰兒|Adult|Price/.test(text) && text.trim().length > 2) {
            const parent = node.parentElement;
            if (parent) {
              const contextEl = parent.closest('tr, li, div, td, p') as HTMLElement | null;
              const contextText = contextEl?.innerText || parent.innerText || text;
              if (contextText && contextText.length < 300) {
                rawPriceTexts.push(contextText.trim().slice(0, 150));
              }
            }
          }
        }
      } catch {}

      // ── 去重 ──
      const uniqueTexts = rawPriceTexts.filter((v, i, arr) => arr.indexOf(v) === i);

      // 從收集到的文字中擷取價格數字
      const allText = uniqueTexts.join(' ');
      const prices: number[] = [];
      for (const pattern of pricePatterns) {
        let m: RegExpExecArray | null;
        const p = new RegExp(pattern.source, pattern.flags);
        while ((m = p.exec(allText)) !== null) {
          const num = parseInt(m[1].replace(/,/g, ''));
          if (num >= 1000 && num <= 500000) prices.push(num);
        }
      }

      prices.sort((a, b) => a - b);
      const uniquePrices = prices.filter((v, i, arr) => arr.indexOf(v) === i);

      // 成人價格：取最高的（旅遊網站通常成人最貴）
      // 子女/嬰兒：取較低的幾個
      const adultPrice = uniquePrices.length > 0 ? uniquePrices[uniquePrices.length - 1] : undefined;
      const childWithBedPrice = uniquePrices.length > 1 ? uniquePrices[Math.floor(uniquePrices.length * 0.6)] : undefined;

      return {
        rawPriceTexts: uniqueTexts.slice(0, 15), // P0: 最多 15 筆（原本 10 筆）
        adultPrice,
        childWithBedPrice,
      };
    }).catch(() => ({ rawPriceTexts: [] as string[], adultPrice: undefined as number | undefined, childWithBedPrice: undefined as number | undefined }));
    
    if (priceHints.rawPriceTexts.length > 0) {
      console.log(`[DynamicScraper] ✓ JS price extraction: ${priceHints.rawPriceTexts.length} price texts found, estimated adultPrice: ${priceHints.adultPrice}`);
    } else {
      console.log(`[DynamicScraper] No price elements found via JS extraction`);
    }

    console.log(`[DynamicScraper] Scrape completed. HTML: ${renderedHtml.length} chars, Text: ${rawText.length} chars`);
    console.log(`[DynamicScraper] Screenshots: fullPage=${fullPageBuffer.length} bytes, dateSection=${dateSectionBuffer?.length || 0} bytes, priceSection=${priceSectionBuffer?.length || 0} bytes`);

    // Round 50: Log lionApiCapture results
    const capturedKeys = Object.keys(lionApiCapture);
    if (capturedKeys.length > 0) {
      console.log(`[DynamicScraper] 🦁 lionApiCapture: captured ${capturedKeys.join(', ')}`);
    }

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
      priceHints,
      lionApiData: capturedKeys.length > 0 ? lionApiCapture : undefined,
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
    
    // 從 static HTML 文字中嘗試擷取價格
    const staticPricePatterns = [
      /(?:TWD|NTD|NT\$)\s*?([\d,]+)/gi,
      /(?:USD|US\$)\s*?([\d,]+)/gi,
      /(?:EUR|€)\s*?([\d,]+)/gi,
      /(?:JPY|¥)\s*?([\d,]+)/gi,
      /(?:成人|大人|每人|售價|團費)[^\d\n]{0,30}([\d,]{4,7})/g,
      /([\d,]{4,7})\s*元/g,
    ];
    const rawPriceTexts: string[] = [];
    const fallbackPrices: number[] = [];
    for (const pattern of staticPricePatterns) {
      let m;
      const re = new RegExp(pattern.source, pattern.flags);
      while ((m = re.exec(text)) !== null) {
        const num = parseInt(m[1].replace(/,/g, ''), 10);
        if (num >= 100 && num <= 9999999) {
          fallbackPrices.push(num);
          const start = Math.max(0, m.index - 30);
          const end = Math.min(text.length, m.index + m[0].length + 30);
          rawPriceTexts.push(text.slice(start, end).trim());
        }
      }
    }
    const sortedPrices = Array.from(new Set(fallbackPrices)).sort((a, b) => a - b);

    return {
      renderedHtml: html,
      rawText: text.slice(0, 50000),
      screenshots: { fullPage: Buffer.alloc(0) },
      pageTitle: html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '',
      sourceUrl: url,
      scrapedAt: new Date(),
      priceHints: sortedPrices.length > 0 ? {
        adultPrice: sortedPrices[sortedPrices.length - 1],
        rawPriceTexts: rawPriceTexts.slice(0, 15),
      } : undefined,
    };
  } catch (err) {
    console.error(`[DynamicScraper] Static fallback also failed:`, err);
    throw err;
  }
}
