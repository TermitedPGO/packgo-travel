/**
 * One-shot script: generate the Japan September 2026 reference quote PDF
 * for Jeff's English-speaking customer.
 *
 * This is a CUSTOM multi-option flyer (5 region options + peak window table)
 * — different shape from the server-side packgo-quote skill which renders a
 * single confirmed itinerary. Final per-option quotes will use the server
 * skill once the customer picks one and Jeff confirms backend prices.
 *
 * Run: node scripts/japan-sept-quote-pdf.mjs
 * Output: ~/Desktop/PACK&GO_Japan_Sept2026_Reference_Quote.pdf
 */

import puppeteer from "puppeteer";
import { writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pull logo from the existing skill assets (already used by server packgo-quote)
const logoRaw = await readFile(
  path.join(__dirname, "..", "server", "services", "skills", "logoConstants.ts"),
  "utf8"
);
const LOGO_NAVY_B64 = logoRaw.match(/LOGO_NAVY_B64 = "([^"]+)"/)?.[1] ?? "";

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>PACK&amp;GO — Japan September 2026 Reference Quote</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Helvetica Neue', Arial, 'Noto Sans', sans-serif;
    color: #111827;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    font-size: 10.5pt;
    line-height: 1.45;
  }
  .page {
    width: 210mm;
    min-height: 297mm;
    padding: 14mm 14mm 12mm;
    page-break-after: always;
  }
  .page:last-child { page-break-after: auto; }

  /* ─── Brand header ─── */
  .brand-header {
    background: #1a2f4e;
    color: #fff;
    padding: 14mm 14mm 10mm;
    margin: -14mm -14mm 10mm;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .brand-header .logo {
    height: 14mm;
    width: auto;
  }
  .brand-header .meta {
    text-align: right;
    font-size: 8.5pt;
    line-height: 1.5;
  }
  .brand-header .meta .quote-id {
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: #d4af37;
  }

  h1 {
    color: #1a2f4e;
    font-size: 22pt;
    font-weight: 800;
    letter-spacing: -0.5px;
    margin: 6mm 0 1mm;
  }
  h1 .accent { color: #d4af37; }
  .subtitle {
    font-size: 11pt;
    color: #6b7280;
    margin-bottom: 5mm;
  }

  /* ─── Section ─── */
  h2 {
    color: #1a2f4e;
    font-size: 11pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    border-bottom: 2px solid #d4af37;
    padding-bottom: 1mm;
    margin: 7mm 0 3mm;
  }

  /* ─── Status banner ─── */
  .status {
    background: #f9f7f0;
    border-left: 3px solid #d4af37;
    padding: 3mm 4mm;
    font-size: 9.5pt;
    color: #4b5563;
    margin-bottom: 6mm;
  }

  /* ─── Peak window table ─── */
  table.peak {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5pt;
  }
  table.peak th {
    background: #1a2f4e;
    color: #fff;
    text-align: left;
    padding: 2mm 3mm;
    font-weight: 600;
    font-size: 9pt;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  table.peak td {
    padding: 2.5mm 3mm;
    border-bottom: 1px solid #e5e7eb;
    vertical-align: top;
  }
  table.peak tr:last-child td { border-bottom: none; }
  table.peak .window {
    font-weight: 700;
    color: #1a2f4e;
    white-space: nowrap;
  }
  table.peak .value {
    background: #ecfdf5;
  }

  /* ─── Option card ─── */
  .option {
    border: 1px solid #e5e7eb;
    border-left: 4px solid #1a2f4e;
    border-radius: 0;
    padding: 5mm 6mm;
    margin-bottom: 5mm;
    page-break-inside: avoid;
  }
  .option.featured {
    border-left-color: #d4af37;
    background: #fefcf5;
  }
  .option .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 3mm;
  }
  .option .title {
    font-size: 12.5pt;
    font-weight: 700;
    color: #1a2f4e;
  }
  .option .title .star { color: #d4af37; margin-right: 1mm; }
  .option .days {
    font-size: 10pt;
    color: #6b7280;
  }
  .option .lt-code {
    background: #f3f4f6;
    border: 1px dashed #9ca3af;
    padding: 2mm 3mm;
    margin-bottom: 3mm;
    font-size: 9pt;
    color: #4b5563;
    font-family: 'Menlo', 'Courier New', monospace;
  }
  .option .lt-code .slot {
    display: inline-block;
    min-width: 60mm;
    border-bottom: 1px solid #6b7280;
    margin: 0 2mm;
  }
  .option .lt-code .note {
    color: #9ca3af;
    font-size: 8pt;
    font-style: italic;
    margin-left: 2mm;
  }
  .option .label {
    font-size: 8.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #1a2f4e;
    margin-top: 2.5mm;
    margin-bottom: 1mm;
  }
  .option ul {
    list-style: none;
    margin-left: 0;
    font-size: 9.5pt;
  }
  .option ul li {
    padding-left: 4mm;
    position: relative;
    margin-bottom: 0.8mm;
  }
  .option ul li::before {
    content: "▸";
    position: absolute;
    left: 0;
    color: #d4af37;
    font-size: 8pt;
  }
  .option .departures {
    background: #f9fafb;
    border-radius: 0;
    padding: 2.5mm 3mm;
    margin-top: 2mm;
    font-size: 9.5pt;
  }
  .option .departures .day {
    display: inline-block;
    margin-right: 3mm;
  }
  .option .departures .day strong { color: #1a2f4e; }
  .option .departures .warn {
    color: #c2410c;
    font-size: 9pt;
    margin-top: 1mm;
    display: block;
  }
  .option .best-for {
    background: #1a2f4e;
    color: #fff;
    display: inline-block;
    padding: 1.5mm 3mm;
    font-size: 8.5pt;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    margin-top: 3mm;
  }

  /* ─── Pricing note ─── */
  .pricing-note {
    background: #1a2f4e;
    color: #fff;
    padding: 5mm 6mm;
    margin-top: 6mm;
    font-size: 9.5pt;
    line-height: 1.55;
  }
  .pricing-note h2 {
    color: #d4af37;
    border-bottom-color: rgba(212, 175, 55, 0.4);
    margin-top: 0;
  }
  .pricing-note ol {
    margin-left: 5mm;
    margin-top: 2mm;
  }
  .pricing-note ol li { margin-bottom: 1mm; }
  .pricing-note .turnaround {
    margin-top: 3mm;
    font-weight: 700;
    color: #d4af37;
  }

  /* ─── Next step ─── */
  .next-step {
    background: #f9f7f0;
    border: 1px solid #d4af37;
    padding: 5mm 6mm;
    margin-top: 5mm;
    font-size: 10pt;
  }
  .next-step h2 {
    margin-top: 0;
    border-bottom: none;
    padding-bottom: 0;
  }
  .next-step ol {
    margin-left: 5mm;
    margin-top: 2mm;
  }
  .next-step ol li { margin-bottom: 1.2mm; }

  /* ─── Footer ─── */
  .footer {
    margin-top: 7mm;
    padding-top: 4mm;
    border-top: 2px solid #1a2f4e;
    text-align: center;
    font-size: 8.5pt;
    color: #6b7280;
  }
  .footer strong { color: #1a2f4e; }
</style>
</head>
<body>

<div class="page">

  <!-- Brand header -->
  <div class="brand-header">
    <img class="logo" src="data:image/png;base64,${LOGO_NAVY_B64}" alt="PACK&amp;GO" style="filter:brightness(0) invert(1);" />
    <div class="meta">
      <div class="quote-id">QUOTE ID · PG-JP-2026-09</div>
      <div>Issued: ${new Date().toISOString().slice(0, 10)}</div>
      <div>Valid for planning until 2026-06-30</div>
    </div>
  </div>

  <h1>Japan <span class="accent">September 2026</span> Reference Quote</h1>
  <div class="subtitle">Five regional options for group tours · Bilingual concierge by PACK&amp;GO</div>

  <div class="status">
    <strong>Status:</strong> Reference itinerary — final price and exact departure dates will be confirmed after supplier (Lion Travel) backend lookup. The options below are pre-curated for September 2026 travel.
  </div>

  <h2>⚠ September 2026 Peak Windows</h2>
  <table class="peak">
    <thead>
      <tr>
        <th style="width:30%">Window</th>
        <th style="width:42%">Reason</th>
        <th style="width:28%">Impact</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="window">Sept 19–23</td>
        <td>Japan Silver Week (Respect for the Aged Day Sept 21 + Autumnal Equinox Sept 22)</td>
        <td>Hotels +20–40%, crowded attractions</td>
      </tr>
      <tr>
        <td class="window">Sept 24–27</td>
        <td>Mid-Autumn Festival (Sept 25) — Asian outbound demand spike</td>
        <td>Flights up, limited group seats</td>
      </tr>
      <tr>
        <td class="window value">Sept 1–10, Sept 28–30</td>
        <td class="value">Best value windows — weekday rates, fewer crowds</td>
        <td class="value">Recommended for budget-conscious travelers</td>
      </tr>
    </tbody>
  </table>

</div>

<div class="page">

  <h2>Five Regional Options</h2>

  <!-- Option 1 -->
  <div class="option">
    <div class="head">
      <div class="title">Option 1 · Tokyo · Mt. Fuji · Hakone</div>
      <div class="days">4–5 days</div>
    </div>
    <div class="lt-code">
      Lion Travel Code: <span class="slot"></span>
      <span class="note">(to confirm from backend)</span>
    </div>

    <div class="label">Highlights</div>
    <ul>
      <li>Shibuya, Asakusa Senso-ji Temple, Akihabara, Tokyo Tower / Skytree</li>
      <li>Mt. Fuji 5th Station + Lake Kawaguchi</li>
      <li>Hakone Open-Air Museum + ropeway + onsen ryokan stay</li>
    </ul>

    <div class="label">Indicative September Departures</div>
    <div class="departures">
      <span class="day"><strong>Tue:</strong> Sept 1, 8, 29</span>
      <span class="day"><strong>Sat:</strong> Sept 5, 12, 26</span>
      <span class="warn">⚠ Avoid: Sept 15, 19, 22</span>
    </div>

    <span class="best-for">Best for: First-time Japan visitors, families</span>
  </div>

  <!-- Option 2 -->
  <div class="option">
    <div class="head">
      <div class="title">Option 2 · Kyoto · Osaka · Nara</div>
      <div class="days">5 days</div>
    </div>
    <div class="lt-code">
      Lion Travel Code: <span class="slot"></span>
      <span class="note">(to confirm from backend)</span>
    </div>

    <div class="label">Highlights</div>
    <ul>
      <li>Kyoto: Kiyomizu-dera, Fushimi Inari Shrine, Arashiyama bamboo grove, Kinkaku-ji</li>
      <li>Osaka: Dotonbori, Osaka Castle, Kuromon Ichiba Market</li>
      <li>Nara: Todai-ji + deer park</li>
    </ul>

    <div class="label">Indicative September Departures</div>
    <div class="departures">
      <span class="day"><strong>Sat:</strong> Sept 5, 12, 26</span>
      <span class="day"><strong>Sun:</strong> Sept 6, 13, 27</span>
      <span class="warn">⚠ Avoid: Sept 19, 20</span>
    </div>

    <span class="best-for">Best for: Culture &amp; food lovers</span>
  </div>

  <!-- Option 3 -->
  <div class="option">
    <div class="head">
      <div class="title">Option 3 · Hokkaido Highlights</div>
      <div class="days">6 days</div>
    </div>
    <div class="lt-code">
      Lion Travel Code: <span class="slot"></span>
      <span class="note">(to confirm from backend)</span>
    </div>

    <div class="label">Highlights</div>
    <ul>
      <li>Sapporo (Odori Park, Susukino, Sapporo Beer Factory)</li>
      <li>Otaru canal + glass workshops</li>
      <li>Furano flower fields (golden post-lavender season)</li>
      <li>Lake Toya + Mt. Usu + Showa Shinzan volcano</li>
      <li>Noboribetsu Jigokudani onsen</li>
    </ul>

    <div class="label">Indicative September Departures</div>
    <div class="departures">
      <span class="day"><strong>Tue:</strong> Sept 1, 8, 29</span>
      <span class="day"><strong>Fri:</strong> Sept 4, 11</span>
      <span class="warn">⚠ Avoid: Sept 18 (peak start), Sept 25 (Mid-Autumn surge)</span>
    </div>

    <span class="best-for">Best for: Nature, seafood, couples</span>
  </div>

</div>

<div class="page">

  <!-- Option 4 -->
  <div class="option">
    <div class="head">
      <div class="title">Option 4 · Kyushu Onsen Loop</div>
      <div class="days">5 days</div>
    </div>
    <div class="lt-code">
      Lion Travel Code: <span class="slot"></span>
      <span class="note">(to confirm from backend)</span>
    </div>

    <div class="label">Highlights</div>
    <ul>
      <li>Fukuoka → Yufuin (canal village) → Beppu (Hells of Beppu hot springs)</li>
      <li>Kumamoto Castle → Mt. Aso active volcano</li>
      <li>Traditional ryokan + kaiseki dinner + open-air hot spring</li>
    </ul>

    <div class="label">Indicative September Departures</div>
    <div class="departures">
      <span class="day"><strong>Sat:</strong> Sept 5, 12, 26</span>
      <span class="warn">⚠ Note: Kyushu has fewer weekly departures than Honshu</span>
    </div>

    <span class="best-for">Best for: Repeat Japan visitors, relaxation seekers</span>
  </div>

  <!-- Option 5 — featured -->
  <div class="option featured">
    <div class="head">
      <div class="title"><span class="star">★</span>Option 5 · Tateyama Kurobe Alpine + Shirakawa-go</div>
      <div class="days">5 days</div>
    </div>
    <div class="lt-code">
      Lion Travel Code: <span class="slot"></span>
      <span class="note">(to confirm from backend)</span>
    </div>

    <div class="label">Highlights</div>
    <ul>
      <li>Tateyama Kurobe Alpine Route: 6 transport modes (cable cars, trolley bus, ropeway, dam walk, alpine bus)</li>
      <li>Snow Valley with lingering September snow walls</li>
      <li>UNESCO Shirakawa-go gassho-zukuri thatched village</li>
      <li>Takayama old town + Kamikochi alpine valley</li>
    </ul>

    <div class="label">Indicative September Departures</div>
    <div class="departures">
      <span class="day"><strong>Tue:</strong> Sept 15, 29</span>
      <span class="warn">⚠ Operates only mid-September through mid-October. Sells out 6–8 weeks ahead.</span>
    </div>

    <span class="best-for">Best for: Experienced Japan travelers, scenic photography</span>
  </div>

  <!-- Pricing Note -->
  <div class="pricing-note">
    <h2>Pricing Note</h2>
    <p>All five options are operated by our Taiwan-based partner agencies (Lion Travel and affiliated networks). PACK&amp;GO acts as your bilingual interface and concierge in the United States. Once you select an option and preferred departure date, we will:</p>
    <ol>
      <li>Confirm exact availability from supplier backend</li>
      <li>Issue a formal quote with all-inclusive package price (USD), round-trip flight estimate, hotel category options (standard / superior / deluxe), and English-speaking guide availability</li>
      <li>Lock in your booking with a 30% deposit (credit card accepted)</li>
    </ol>
    <div class="turnaround">Typical turnaround: 1 business day after your selection</div>
  </div>

  <!-- Next Step -->
  <div class="next-step">
    <h2>Next Step</h2>
    <p>Please reply with the following so we can prepare your formal quote:</p>
    <ol>
      <li>Which option you'd like to proceed with (or up to two to compare)</li>
      <li>Preferred departure date from the indicative list</li>
      <li>Number of travelers (adults and children with ages)</li>
      <li>Any preferences (hotel category, English-speaking guide required, dietary needs)</li>
    </ol>
  </div>

  <div class="footer">
    <strong>PACK&amp;GO Travel</strong> · packgoplay.com · Newark, California, USA<br/>
    Operated by PACK&amp;GO LLC · Contact: jeffhsieh09@gmail.com
  </div>

</div>

</body>
</html>`;

console.log("[quote-pdf] Launching headless Chrome…");
const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0", timeout: 30_000 });
  await page.evaluateHandle("document.fonts.ready");

  const pdfBuffer = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
  });

  const outPath = path.join(
    process.env.HOME ?? "/tmp",
    "Desktop",
    "PACK&GO_Japan_Sept2026_Reference_Quote.pdf"
  );
  await writeFile(outPath, pdfBuffer);
  console.log(`[quote-pdf] ✓ Saved ${pdfBuffer.byteLength} bytes → ${outPath}`);
} finally {
  await browser.close();
}
