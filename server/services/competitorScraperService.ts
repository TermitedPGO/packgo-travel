/**
 * Competitor Scraper Service
 * 競品監控爬蟲服務
 *
 * 負責：
 * 1. 爬取雄獅旅遊出團日期、價格、座位
 * 2. 比對新舊快照，偵測變動
 * 3. 根據變動產生告警
 */
import puppeteer, { type Browser } from "puppeteer";
import { LionTravelPrintParser } from "../agents/parsers/lionTravelPrintParser";

// ── Types ──────────────────────────────────────────────────────

export interface DepartureInfo {
  departureDate: string;    // "2026-05-15"
  returnDate?: string;
  adultPrice?: number;
  childPrice?: number;
  singleSupplement?: number;
  totalSeats?: number;
  availableSeats?: number;
  status: "open" | "full" | "cancelled" | "guaranteed";
}

export interface CompetitorScrapeResult {
  success: boolean;
  tourTitle?: string;
  destination?: string;
  duration?: number;
  departures: DepartureInfo[];
  error?: string;
}

export interface ChangeDetection {
  type: "price_drop" | "price_increase" | "low_seats" | "sold_out" | "new_departure" | "tour_cancelled" | "guaranteed";
  departureDate: string;
  oldValue?: number;
  newValue?: number;
  message: string;
  severity: "info" | "warning" | "critical";
}

// ── Helpers ────────────────────────────────────────────────────

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractNormGroupId(url: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get("NormGroupID");
  } catch {
    return null;
  }
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ── Core Scraper ───────────────────────────────────────────────

/**
 * 爬取雄獅旅遊行程頁面，提取出團日期、價格、座位
 */
export async function scrapeLionTravelTour(url: string): Promise<CompetitorScrapeResult> {
  console.log(`[CompetitorScraper] Starting scrape: ${url}`);
  let browser: Browser | null = null;

  try {
    // 隨機延遲 2-5 秒，避免被封鎖
    await randomDelay(2000, 5000);

    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 720 });

    // 嘗試 1: 直接爬 detail 頁面
    console.log("[CompetitorScraper] Strategy 1: Puppeteer detail page");
    const detailResult = await scrapeDetailPage(page, url);
    if (detailResult.success && detailResult.departures.length > 0) {
      await browser.close();
      return detailResult;
    }

    // 嘗試 2: 用 Firecrawl API（如果可用）
    const firecrawlKey = process.env.FIRECRAWL_API_KEY;
    if (firecrawlKey) {
      console.log("[CompetitorScraper] Strategy 2: Firecrawl API");
      const firecrawlResult = await scrapeWithFirecrawl(url, firecrawlKey);
      if (firecrawlResult.success && firecrawlResult.departures.length > 0) {
        await browser.close();
        return firecrawlResult;
      }
    }

    // 嘗試 3: Fallback 到 print 頁面
    console.log("[CompetitorScraper] Strategy 3: Print page fallback");
    const printResult = await scrapePrintPage(page, url);
    await browser.close();
    return printResult;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[CompetitorScraper] Scrape failed: ${errMsg}`);
    if (browser) await browser.close().catch(() => {});
    return { success: false, departures: [], error: errMsg };
  }
}

/**
 * Strategy 1: Puppeteer 爬取 detail 頁面
 */
async function scrapeDetailPage(
  page: Awaited<ReturnType<Browser["newPage"]>>,
  url: string
): Promise<CompetitorScrapeResult> {
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    // 等待頁面載入
    await randomDelay(2000, 3000);

    // 嘗試等待出團日期區塊
    try {
      await page.waitForSelector(
        ".departure-list, .date-list, .calendar-price, .tourDate, [class*=departure], [class*=calendar]",
        { timeout: 8000 }
      );
    } catch {
      console.log("[CompetitorScraper] No departure selector found, trying generic extraction");
    }

    // 提取行程基本資訊
    const basicInfo = await page.evaluate(() => {
      const titleEl =
        document.querySelector("h1") ||
        document.querySelector(".tour-title") ||
        document.querySelector("[class*=title]");
      const title = titleEl?.textContent?.trim() || "";

      // 嘗試提取目的地和天數
      let destination = "";
      let duration = 0;
      const metaEls = document.querySelectorAll(
        ".tour-info span, .tour-meta span, [class*=info] span"
      );
      metaEls.forEach((el) => {
        const text = el.textContent?.trim() || "";
        const dayMatch = text.match(/(\d+)\s*[天日]/);
        if (dayMatch) duration = parseInt(dayMatch[1]);
      });

      // 從標題提取天數
      if (!duration) {
        const titleDayMatch = title.match(/(\d+)\s*[天日]/);
        if (titleDayMatch) duration = parseInt(titleDayMatch[1]);
      }

      return { title, destination, duration };
    });

    // 提取出團日期和價格
    const departures = await page.evaluate(() => {
      const results: Array<{
        departureDate: string;
        returnDate?: string;
        adultPrice?: number;
        availableSeats?: number;
        status: string;
      }> = [];

      // 策略 A: 找 table 行
      const rows = document.querySelectorAll(
        "table tr, .departure-item, .date-item, [class*=departure-row], [class*=date-row]"
      );
      rows.forEach((row) => {
        const text = row.textContent || "";
        // 找日期格式 YYYY/MM/DD 或 YYYY-MM-DD
        const dateMatch = text.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
        if (!dateMatch) return;

        const year = dateMatch[1];
        const month = dateMatch[2].padStart(2, "0");
        const day = dateMatch[3].padStart(2, "0");
        const departureDate = `${year}-${month}-${day}`;

        // 找價格
        const priceMatch = text.match(/(?:NT\$?|TWD|＄)\s*([\d,]+)/);
        const adultPrice = priceMatch
          ? parseInt(priceMatch[1].replace(/,/g, ""))
          : undefined;

        // 找座位
        const seatMatch = text.match(/(?:剩|餘|可售|available)\s*(\d+)/i);
        const availableSeats = seatMatch ? parseInt(seatMatch[1]) : undefined;

        // 判斷狀態
        let status = "open";
        if (/滿團|額滿|sold\s*out/i.test(text)) status = "full";
        else if (/取消|cancelled/i.test(text)) status = "cancelled";
        else if (/確認出團|guaranteed|成團/i.test(text)) status = "guaranteed";

        results.push({ departureDate, adultPrice, availableSeats, status });
      });

      // 策略 B: 找日曆格式
      if (results.length === 0) {
        const calendarItems = document.querySelectorAll(
          ".calendar-price, [class*=calendar] [class*=price], [class*=date-price]"
        );
        calendarItems.forEach((item) => {
          const text = item.textContent || "";
          const dateMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})/);
          const priceMatch = text.match(/([\d,]+)/);
          if (dateMatch && priceMatch) {
            const now = new Date();
            const month = dateMatch[1].padStart(2, "0");
            const day = dateMatch[2].padStart(2, "0");
            let year = now.getFullYear();
            if (parseInt(month) < now.getMonth() + 1) year++;
            results.push({
              departureDate: `${year}-${month}-${day}`,
              adultPrice: parseInt(priceMatch[1].replace(/,/g, "")),
              status: "open",
            });
          }
        });
      }

      return results;
    });

    const typedDepartures: DepartureInfo[] = departures.map((d) => ({
      departureDate: d.departureDate,
      returnDate: d.returnDate,
      adultPrice: d.adultPrice,
      availableSeats: d.availableSeats,
      status: (d.status as DepartureInfo["status"]) || "open",
    }));

    console.log(
      `[CompetitorScraper] Detail page: found ${typedDepartures.length} departures`
    );
    return {
      success: typedDepartures.length > 0,
      tourTitle: basicInfo.title || undefined,
      destination: basicInfo.destination || undefined,
      duration: basicInfo.duration || undefined,
      departures: typedDepartures,
    };
  } catch (error) {
    console.error("[CompetitorScraper] Detail page scrape error:", error);
    return { success: false, departures: [] };
  }
}

/**
 * Strategy 2: Firecrawl API 抓取
 */
async function scrapeWithFirecrawl(
  url: string,
  apiKey: string
): Promise<CompetitorScrapeResult> {
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        waitFor: 5000,
      }),
    });

    if (!response.ok) {
      console.error(`[CompetitorScraper] Firecrawl API error: ${response.status}`);
      return { success: false, departures: [] };
    }

    const data = (await response.json()) as {
      success: boolean;
      data?: { markdown?: string };
    };
    if (!data.success || !data.data?.markdown) {
      return { success: false, departures: [] };
    }

    const markdown = data.data.markdown;
    return parseMarkdownForDepartures(markdown);
  } catch (error) {
    console.error("[CompetitorScraper] Firecrawl error:", error);
    return { success: false, departures: [] };
  }
}

/**
 * Strategy 3: Print 頁面 fallback
 */
async function scrapePrintPage(
  page: Awaited<ReturnType<Browser["newPage"]>>,
  url: string
): Promise<CompetitorScrapeResult> {
  try {
    const printUrl = LionTravelPrintParser.convertToPrintUrl(url);
    console.log(`[CompetitorScraper] Navigating to print page: ${printUrl}`);

    await page.goto(printUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await randomDelay(1000, 2000);

    const content = await page.content();
    // 簡單提取 markdown-like content
    const textContent = await page.evaluate(() => document.body.innerText);

    const parser = new LionTravelPrintParser(textContent);
    const printData = parser.parse();

    if (!printData) {
      return { success: false, departures: [] };
    }

    // Print 頁面通常只有一個基準價格，沒有出團日期列表
    const departures: DepartureInfo[] = [];
    if (printData.pricing.price) {
      departures.push({
        departureDate: printData.basicInfo.departureDate || "unknown",
        adultPrice: printData.pricing.price,
        status: "open",
      });
    }

    return {
      success: true,
      tourTitle: printData.basicInfo.title,
      destination: `${printData.location.destinationCountry} ${printData.location.destinationCity}`.trim(),
      duration: printData.duration.days,
      departures,
    };
  } catch (error) {
    console.error("[CompetitorScraper] Print page error:", error);
    return { success: false, departures: [] };
  }
}

/**
 * 從 Markdown 內容解析出團日期
 */
function parseMarkdownForDepartures(markdown: string): CompetitorScrapeResult {
  const departures: DepartureInfo[] = [];
  let tourTitle: string | undefined;
  let duration: number | undefined;

  // 提取標題（第一個 # 標題）
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  if (titleMatch) tourTitle = titleMatch[1].trim();

  // 提取天數
  const dayMatch = markdown.match(/(\d+)\s*[天日]/);
  if (dayMatch) duration = parseInt(dayMatch[1]);

  // 提取日期和價格
  const datePattern = /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/g;
  const lines = markdown.split("\n");
  for (const line of lines) {
    const match = datePattern.exec(line);
    if (!match) continue;

    const year = match[1];
    const month = match[2].padStart(2, "0");
    const day = match[3].padStart(2, "0");
    const departureDate = `${year}-${month}-${day}`;

    const priceMatch = line.match(/(?:NT\$?|TWD|＄)\s*([\d,]+)/);
    const adultPrice = priceMatch
      ? parseInt(priceMatch[1].replace(/,/g, ""))
      : undefined;

    let status: DepartureInfo["status"] = "open";
    if (/滿團|額滿|sold\s*out/i.test(line)) status = "full";
    else if (/取消|cancelled/i.test(line)) status = "cancelled";
    else if (/確認出團|guaranteed|成團/i.test(line)) status = "guaranteed";

    departures.push({ departureDate, adultPrice, status });
  }

  return {
    success: departures.length > 0,
    tourTitle,
    duration,
    departures,
  };
}

// ── Comparison Logic ───────────────────────────────────────────

export interface PreviousDeparture {
  departureDate: string;
  adultPrice: number | null;
  availableSeats: number | null;
  departureStatus: string;
}

/**
 * 比對新舊出團快照，偵測變動
 */
export function compareDepartures(
  previousDepartures: PreviousDeparture[],
  newDepartures: DepartureInfo[]
): ChangeDetection[] {
  const changes: ChangeDetection[] = [];

  // 建立舊資料 map（以 departureDate 為 key）
  const prevMap = new Map<string, PreviousDeparture>();
  for (const dep of previousDepartures) {
    prevMap.set(dep.departureDate, dep);
  }

  for (const newDep of newDepartures) {
    const prev = prevMap.get(newDep.departureDate);

    if (!prev) {
      // 新增出團日期
      changes.push({
        type: "new_departure",
        departureDate: newDep.departureDate,
        newValue: newDep.adultPrice,
        message: `新增出團日期 ${newDep.departureDate}${newDep.adultPrice ? `，價格 NT$${newDep.adultPrice.toLocaleString()}` : ""}`,
        severity: "info",
      });
      continue;
    }

    // 價格變動
    if (
      prev.adultPrice != null &&
      newDep.adultPrice != null &&
      prev.adultPrice !== newDep.adultPrice
    ) {
      const priceDiff = newDep.adultPrice - prev.adultPrice;
      const pctChange = Math.abs(priceDiff / prev.adultPrice) * 100;

      if (priceDiff < 0) {
        changes.push({
          type: "price_drop",
          departureDate: newDep.departureDate,
          oldValue: prev.adultPrice,
          newValue: newDep.adultPrice,
          message: `${newDep.departureDate} 降價 NT$${Math.abs(priceDiff).toLocaleString()}（${pctChange.toFixed(1)}%）：NT$${prev.adultPrice.toLocaleString()} → NT$${newDep.adultPrice.toLocaleString()}`,
          severity: pctChange > 10 ? "critical" : "warning",
        });
      } else {
        changes.push({
          type: "price_increase",
          departureDate: newDep.departureDate,
          oldValue: prev.adultPrice,
          newValue: newDep.adultPrice,
          message: `${newDep.departureDate} 漲價 NT$${priceDiff.toLocaleString()}（${pctChange.toFixed(1)}%）：NT$${prev.adultPrice.toLocaleString()} → NT$${newDep.adultPrice.toLocaleString()}`,
          severity: "warning",
        });
      }
    }

    // 座位變動
    if (newDep.availableSeats != null) {
      if (newDep.availableSeats === 0 || newDep.status === "full") {
        if (prev.departureStatus !== "full") {
          changes.push({
            type: "sold_out",
            departureDate: newDep.departureDate,
            oldValue: prev.availableSeats ?? undefined,
            newValue: 0,
            message: `${newDep.departureDate} 已售罄`,
            severity: "critical",
          });
        }
      } else if (newDep.availableSeats < 5 && (prev.availableSeats == null || prev.availableSeats >= 5)) {
        changes.push({
          type: "low_seats",
          departureDate: newDep.departureDate,
          oldValue: prev.availableSeats ?? undefined,
          newValue: newDep.availableSeats,
          message: `${newDep.departureDate} 剩餘座位不足 5 席（剩 ${newDep.availableSeats} 席）`,
          severity: "warning",
        });
      }
    }

    // 確認出團
    if (
      newDep.status === "guaranteed" &&
      prev.departureStatus !== "guaranteed"
    ) {
      changes.push({
        type: "guaranteed",
        departureDate: newDep.departureDate,
        message: `${newDep.departureDate} 確認出團`,
        severity: "info",
      });
    }

    // 取消
    if (
      newDep.status === "cancelled" &&
      prev.departureStatus !== "cancelled"
    ) {
      changes.push({
        type: "tour_cancelled",
        departureDate: newDep.departureDate,
        message: `${newDep.departureDate} 行程已取消`,
        severity: "critical",
      });
    }
  }

  return changes;
}

// ── Alert Generation ───────────────────────────────────────────

export interface AlertData {
  competitorTourId: number;
  alertType: string;
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
  metadata: string; // JSON string
}

/**
 * 根據變動偵測結果，產生告警資料
 */
export function generateAlerts(
  competitorTourId: number,
  tourTitle: string,
  changes: ChangeDetection[]
): AlertData[] {
  return changes.map((change) => ({
    competitorTourId,
    alertType: change.type,
    title: `[${tourTitle}] ${getAlertTypeLabel(change.type)}`,
    message: change.message,
    severity: change.severity,
    metadata: JSON.stringify({
      departureDate: change.departureDate,
      oldValue: change.oldValue,
      newValue: change.newValue,
    }),
  }));
}

function getAlertTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    price_drop: "降價通知",
    price_increase: "漲價通知",
    low_seats: "座位不足",
    sold_out: "已售罄",
    new_departure: "新增出團",
    tour_cancelled: "行程取消",
    guaranteed: "確認出團",
  };
  return labels[type] || type;
}
