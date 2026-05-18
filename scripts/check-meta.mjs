import puppeteer from "puppeteer";
const browser = await puppeteer.launch({ headless: "new" });
const page = await browser.newPage();
await page.goto("https://packgo-travel.fly.dev/", { waitUntil: "networkidle2", timeout: 60000 });
await new Promise(r => setTimeout(r, 3000));
const m = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('meta[name="description"], meta[property="og:description"], meta[property="og:image"]').forEach(el => {
    out.push({
      attr: el.getAttribute("name") || el.getAttribute("property"),
      content: el.getAttribute("content")
    });
  });
  return { title: document.title, metas: out };
});
console.log(JSON.stringify(m, null, 2));
await browser.close();
