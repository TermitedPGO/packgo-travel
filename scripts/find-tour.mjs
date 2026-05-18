import puppeteer from "puppeteer";
const browser = await puppeteer.launch({ headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto("https://packgo-travel.fly.dev/tours", { waitUntil: "networkidle2" });
await new Promise(r => setTimeout(r, 1500));
const ids = await page.evaluate(() => Array.from(document.querySelectorAll('a[href^="/tours/"]')).map(a => a.getAttribute('href')).filter(h => /\/tours\/\d+/.test(h)).slice(0, 3));
console.log(JSON.stringify(ids));
await browser.close();
