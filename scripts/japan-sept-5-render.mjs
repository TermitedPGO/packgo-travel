#!/usr/bin/env node
/**
 * Render the Japan September 2026 catalog PDF with day-by-day per option.
 *
 * Reads .audit/japan-sept-5-raw.json (scraped from Lion Travel) and the
 * inline TRANSLATED data below (Claude-translated Chinese → English for
 * each day, since the customer is English-speaking).
 *
 * Output: ~/Desktop/PACK&GO_Japan_Sept2026_Catalog.pdf
 */

import puppeteer from "puppeteer";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pull logo from existing skill assets
const logoRaw = await readFile(
  path.join(__dirname, "..", "server", "services", "skills", "logoConstants.ts"),
  "utf8"
);
const LOGO_NAVY_B64 = logoRaw.match(/LOGO_NAVY_B64 = "([^"]+)"/)?.[1] ?? "";

// Load raw scrape
const raw = JSON.parse(
  await readFile(
    path.join(__dirname, "..", ".audit", "japan-sept-5-raw.json"),
    "utf8"
  )
);
const byBucket = Object.fromEntries(raw.candidates.map((c) => [c.bucket, c]));

// ─── Inline English translations for each option ─────────────────────────────
// Each entry's structure mirrors the raw data day-by-day, so the renderer is
// generic. Hotel brand names kept as-is (universal). Meal lines summarized.

const TRANSLATED = {
  tokyo: {
    title: "Tokyo · Mt. Fuji · Karuizawa Highlights",
    subtitle: "5 days · Tokyo Tower, Kawaguchi-ko, Karuizawa, Kawagoe old town · Crab feast · 2 onsen nights · Hilton stay",
    bestFor: "First-time Japan visitors, families, scenic photography",
    days: [
      {
        day: 1,
        title: "Taipei → Tokyo Narita → Tokyo Tower (city iconic landmark)",
        route: "Taoyuan Intl Airport → Narita International Airport → Tokyo Tower (observation deck not included) → Hotel",
        attractions: ["Tokyo Tower"],
        hotel: "Tokyo / Chiba area select hotel: MONDAY Toyosu / MONDAY Nishi-Kasai / T-MARK Omori / Route Inn Grande or similar",
        meals: { B: "Home", L: "In-flight meal", D: "Japanese sukiyaki hot-pot buffet or Japanese-Western buffet" },
      },
      {
        day: 2,
        title: "Rikugi-en Garden → Kawagoe 'Little Edo' old town → Moomin Valley Park",
        route: "Hotel → Rikugi-en (Japan's most beautiful strolling garden, Watarigetsu Bridge, tea house) → Kawagoe Kura-zukuri Ichibangai (traditional warehouse street, Toki-no-Kane bell tower, candy alley) → Moomin Valley Park",
        attractions: ["Rikugi-en Garden", "Kawagoe Kura-zukuri Ichibangai (Little Edo)", "Moomin Valley Park"],
        hotel: "Gunma onsen area: Myogi GREEN / Renai Prince / Karuizawa 1130 Resort / Karuizawa GreenPlaza or similar",
        meals: { B: "Hotel breakfast", L: "Japanese yakiniku BBQ set (¥2,500 budget)", D: "Hotel buffet: Shinetsu local cuisine" },
      },
      {
        day: 3,
        title: "Karuizawa: Kumoba Pond → Old Karuizawa Ginza → St. Paul's Church → Fuji area onsen",
        route: "Hotel → Kumoba Pond (Karuizawa's 'Swan Lake' tree-lined trail, four-season scenery) → Old Karuizawa Ginza shopping street → St. Paul's Catholic Church → transfer to Fuji area onsen",
        attractions: ["Kumoba Pond", "Old Karuizawa Ginza", "St. Paul's Catholic Church Karuizawa"],
        hotel: "Isawa / Fuji area onsen: Isawa Onsen Kasugai VIEW / Isawa VIEW / Hana Isawa Onsen Hotel / Kawaguchiko FUJI PREMIUM or similar",
        meals: { B: "Hotel breakfast", L: "Japanese gozen set (¥2,500 budget)", D: "★Special arrangement: 70-min crab leg buffet + Wagyu hot pot" },
      },
      {
        day: 4,
        title: "Lake Kawaguchi: Oishi Park (Mt. Fuji panorama) → Oshino Hakkai → Tokyo Bay Hilton",
        route: "Hotel → Oishi Park (lakeside flower street + Mini Fuji view) → Oshino Hakkai (Japan's top 100 waters, National Natural Monument) → tax-free shop → Tokyo Bay Hilton check-in",
        attractions: ["Oishi Park", "Oshino Hakkai", "Tax-free shop"],
        hotel: "★Guaranteed: Hilton Tokyo Bay (5-star international chain)",
        meals: { B: "Hotel (light) breakfast", L: "Yamanashi-style teppanyaki gozen or tempura set", D: "On own (free time for Tokyo exploration)" },
      },
      {
        day: 5,
        title: "Tokyo Narita → Taoyuan",
        route: "Hotel → Narita International Airport → Taoyuan International Airport",
        attractions: [],
        hotel: "Home",
        meals: { B: "Hotel breakfast", L: "In-flight gourmet meal", D: "Home" },
      },
    ],
  },

  kansai: {
    title: "Kansai 4-City Grand Tour: Kyoto · Osaka · Kobe · Nara",
    subtitle: "6 days · Fushimi Inari, Todai-ji, Himeji Castle, Universal Studios Japan, Akashi Bridge",
    bestFor: "Culture, theme parks, food lovers, repeat travelers",
    days: [
      {
        day: 1,
        title: "Taipei → Kobe → Katsuo-ji Temple → Kyoto Station",
        route: "Taoyuan Intl Airport → Kobe Airport → Katsuo-ji Temple (the famous 'daruma' good-luck temple) → Kyoto Station",
        attractions: ["Katsuo-ji Temple"],
        hotel: "Shiga / Kyoto: Lake Biwa Otsu Prince / Hotel MONday Kyoto / ASAI KYOTO SHIJO / Kyoto select hotel",
        meals: { B: "Home", L: "In-flight meal + light snack box + green tea", D: "On own (free time for shopping)" },
      },
      {
        day: 2,
        title: "Fushimi Inari (1,000 torii gates) → Todai-ji (Great Buddha) → Nara deer park → Osaka Dotonbori",
        route: "Fushimi Inari Shrine (1,000 torii gates) → Todai-ji World Heritage temple + deer park → tax-free shop → Namba / Shinsaibashi / Ebisubashi shopping street / Dotonbori food street",
        attractions: ["Fushimi Inari Shrine", "Todai-ji World Heritage Site", "Nara Deer Park"],
        hotel: "Osaka: Shinsaibashi GRAND / Just Sleep Shinsaibashi / Osaka Hommachi MIYAKO CITY / Osaka Hommachi MOXY / Holiday Inn Osaka",
        meals: { B: "Hotel breakfast", L: "Japanese sumo nabe buffet or chicken sukiyaki gozen", D: "On own (Dotonbori food street)" },
      },
      {
        day: 3,
        title: "Universal Studios Japan — full day",
        route: "Full day at Universal Studios Japan — including Super Nintendo World",
        attractions: ["Universal Studios Japan"],
        hotel: "Same as Day 2",
        meals: { B: "Hotel breakfast", L: "On own (inside park)", D: "On own" },
      },
      {
        day: 4,
        title: "Free day in Osaka",
        route: "Full day on your own — recommended: Osaka Castle, Kuromon Market, Umeda Sky Building, or repeat Universal Studios",
        attractions: [],
        hotel: "Same as Day 2",
        meals: { B: "Hotel breakfast", L: "On own", D: "On own" },
      },
      {
        day: 5,
        title: "★Himeji Castle (UNESCO) → Uo-no-Tana Market → Akashi Bridge → Kobe Mosaic",
        route: "★Himeji Castle (UNESCO World Heritage, tenshukaku interior not included) → Uo-no-Tana Shopping Street (octopus market) → Akashi Kaikyo Bridge (Maiko Marine Promenade glass walkway) → MOSAIC Kobe waterfront",
        attractions: ["Himeji Castle (UNESCO)", "Akashi Kaikyo Bridge — Maiko Marine Promenade", "MOSAIC Kobe"],
        hotel: "Kobe: Hewitt Koshien / Kobe Meriken Park Oriental / Kobe Okura / Kobe Portopia / Kobe Monterey series",
        meals: { B: "Hotel breakfast", L: "Himeji Japanese gozen (¥3,000 budget)", D: "Japanese-Western buffet or shabu-shabu" },
      },
      {
        day: 6,
        title: "Kobe → Taoyuan",
        route: "Kobe Airport → Taoyuan International Airport",
        attractions: [],
        hotel: "Home",
        meals: { B: "Hotel breakfast", L: "In-flight meal", D: "Home" },
      },
    ],
  },

  hokkaido: {
    title: "Hokkaido 369: Akan Lake · Furano Lavender · Crab Feast",
    subtitle: "5 days · Sounkyo, Abashiri drift-ice museum, Akan Lake, Manabe Garden, Tomita Farm lavender · 3 onsen nights",
    bestFor: "Nature lovers, seafood, couples, photography",
    days: [
      {
        day: 1,
        title: "Taipei → New Chitose → Sounkyo Gorge",
        route: "Taipei → New Chitose Airport → Sounkyo (Daisetsuzan National Park) → Ginga / Ryusei Falls",
        attractions: ["Sounkyo Gorge", "Ginga Falls / Ryusei Falls"],
        hotel: "Sounkyo Kanko Onsen Hotel or similar",
        meals: { B: "Home", L: "In-flight meal", D: "Hotel buffet or kaiseki welcome dinner" },
      },
      {
        day: 2,
        title: "Kitami Fox Village → Abashiri drift-ice museum → Akan Lake (Ainu village)",
        route: "Kitami Fox Village → Abashiri Okhotsk Sea Drift-Ice Museum + drift-ice room + Mt. Tento observation (★complimentary drift-ice ice cream) → Akan National Park → traditional Ainu village → Lucky Forest shopping street",
        attractions: ["Kitami Fox Village", "Drift-Ice Museum (Tento Mountain)", "Akan Lake & Ainu Village"],
        hotel: "Shin Akan Onsen Hotel or similar",
        meals: { B: "Hotel breakfast", L: "Wafu mini-kaiseki or Japanese yakiniku (¥3,000)", D: "Hotel buffet or kaiseki welcome dinner" },
      },
      {
        day: 3,
        title: "Tancho Crane Park → Ikeda Wine Castle → ★Manabe Garden → Tokachi Millennium Forest",
        route: "Tancho Red-Crowned Crane Natural Park → Ikeda Wine Castle → ★Manabe Garden (fairytale-like wonderland) → Tokachi Millennium Forest (vast nature park)",
        attractions: ["Tancho Crane Park", "Ikeda Wine Castle", "Manabe Garden", "Tokachi Millennium Forest"],
        hotel: "Tokachi Daiheigen Onsen / Daiichi Onsen or similar",
        meals: { B: "Hotel breakfast", L: "Buta-don pork rice bowl or Japanese set", D: "Hotel buffet or kaiseki" },
      },
      {
        day: 4,
        title: "Furano Tomita Farm (lavender) → ★Lavender DIY workshop → 3-crab buffet + free-flow drinks",
        route: "Tomita Farm (Japan's 'Provence' — greenhouse lavender, Hana-bito House, Dry Flower House) → ★6 lavender-themed activities including DIY lavender pillow + postcard (with stamp) → Sapporo tax-free shop",
        attractions: ["Tomita Farm Lavender", "Lavender DIY workshop", "Sapporo tax-free shop"],
        hotel: "Sapporo Prince Hotel / MYSTAYS or similar",
        meals: { B: "Hotel breakfast", L: "Japanese countryside meal + ★melon buffet (¥4,000)", D: "★3-Crab buffet + free-flow drinks (¥10,000)" },
      },
      {
        day: 5,
        title: "Mitsui Outlet → New Chitose → Taipei",
        route: "Hokkaido Outlet shopping (Sapporo Kitahiroshima Mitsui Outlet Park) → New Chitose Airport → Taipei",
        attractions: ["Mitsui Outlet Park Kitahiroshima"],
        hotel: "Home",
        meals: { B: "Hotel breakfast", L: "On own", D: "In-flight meal" },
      },
    ],
  },

  kyushu: {
    title: "Kyushu Onsen Loop: Yufuin · Beppu · Takachiho · Aso",
    subtitle: "5 days · Marine World aquarium, Yufuin Lake Kinrin, Takachiho Gorge, Mt. Aso, scenic railways",
    bestFor: "Repeat Japan visitors, relaxation, ryokan + onsen lovers",
    days: [
      {
        day: 1,
        title: "Kaohsiung → Fukuoka → Tenjin/Nakasu night district (optional)",
        route: "Kaohsiung → Fukuoka Airport → Fukuoka or Kitakyushu area · optional free evening at Tenjin / Nakasu yatai food-stall district",
        attractions: [],
        hotel: "Fukuoka Toei Hotel / ARK Hotel Royal Fukuoka Tenjin / CROSS LIFE Hakata Yanagibashi / Hakata Zen Toshi City Hotel / Nishitetsu Inn",
        meals: { B: "Home", L: "Home", D: "In-flight meal" },
      },
      {
        day: 2,
        title: "Kushida Shrine → plum-wine cellar tasting → Yufuin Lake Kinrin → Beppu / Aso onsen",
        route: "Kushida Shrine → plum-wine brewery tour + tasting → Yufuin & Lake Kinrin (★complimentary half-baked cheese tart) → Beppu or Aso onsen ryokan",
        attractions: ["Kushida Shrine", "Plum-wine cellar Oyama", "Yufuin & Lake Kinrin"],
        hotel: "Beppu Tsurumi SPA Hotel / Oedo Onsen Beppu Seifu / Beppu Kamenoi Hotel / Aso Grand or similar",
        meals: { B: "Hotel breakfast", L: "Yufuin gozen or Oita hell-steamed local cuisine", D: "Hotel kaiseki or Japanese-Western buffet" },
      },
      {
        day: 3,
        title: "Takachiho Gorge → ★Minami-Aso Railway → Kamishikimi Kumano-imasu Shrine (anime film location)",
        route: "Takachiho Gorge (canyon of the gods) → ★Minami-Aso scenic railway → Kamishikimi Kumano-imasu Shrine (real-life setting of the 'Hotarubi no Mori' anime film)",
        attractions: ["Takachiho Gorge", "Minami-Aso Railway", "Kamishikimi Kumano-imasu Shrine"],
        hotel: "Kumamoto ARK (free Wi-Fi) / Kumamoto MY STAYS or similar",
        meals: { B: "Hotel breakfast", L: "Takachiho local gozen", D: "Izakaya or Japanese yakiniku (¥3,500)" },
      },
      {
        day: 4,
        title: "★Moe-Kuma Tram → Yanagawa river-boat → Dazaifu Tenmangu → Hakata Canal City",
        route: "★Moe-Kuma Dentetsu mascot tram (★complimentary Moe-Kuma branded water) → Yanagawa human-powered river boat ('Venice of the East') → Dazaifu Tenmangu (★complimentary plum-branch mochi) → tax-free shop → Hakata Canal City mall",
        attractions: ["Moe-Kuma Train", "Yanagawa River Boat", "Dazaifu Tenmangu Shrine"],
        hotel: "Same as Day 1",
        meals: { B: "Hotel breakfast", L: "Yanagawa eel rice (specialty) or Japanese gozen", D: "On own" },
      },
      {
        day: 5,
        title: "Marine World aquarium → LaLaport Fukuoka → Fukuoka → Kaohsiung",
        route: "Uminonakamichi MARINE WORLD aquarium → LaLaport Fukuoka (Fukuoka's newest shopping landmark) → Fukuoka Airport → Kaohsiung",
        attractions: ["Marine World Uminonakamichi Aquarium", "LaLaport Fukuoka"],
        hotel: "Home",
        meals: { B: "Hotel breakfast", L: "On own", D: "In-flight meal" },
      },
    ],
  },

  alpine: {
    title: "★ Tateyama Kurobe Alpine Route + Shirakawa-go + Takayama",
    subtitle: "5 days · UNESCO Shirakawa-go, alpine route via Starlux to Nagoya, Kenroku-en, Hida Takayama, Enakyo cruise",
    bestFor: "Experienced Japan travelers, scenic photography, alpine landscape",
    days: [
      {
        day: 1,
        title: "Taipei → Nagoya Chubu → Aichi area",
        route: "Taipei → Nagoya Chubu International Airport → Aichi area hotel",
        attractions: [],
        hotel: "Nagoya IBIS / MYSTAYS Nagoya Nishiki / Nagoya VESSEL Campana / Meitetsu Komaki Hotel / Chubu Airport Four Points by Sheraton",
        meals: { B: "Home", L: "Home", D: "In-flight meal" },
      },
      {
        day: 2,
        title: "Enakyo Gorge cruise → ★Magome-juku post town → Nagano onsen",
        route: "Enakyo Gorge sightseeing boat (cruise the dramatic canyon + observation deck) → ★Magome-juku (one of Kiso-kaido's 'Kiso Hakkei' — preserved Edo-era post town) → Nagano onsen area",
        attractions: ["Enakyo Gorge Cruise", "Magome-juku Post Town"],
        hotel: "Omachi Onsen Kurobe Kanko / Azumino Ambient Hotel / Tateyama Prince / Shinano Omachi Kuroyon ANA Holiday Inn or similar",
        meals: { B: "Hotel breakfast", L: "Magome-juku soba set or Nagano local meal (¥2,500)", D: "Hotel buffet or kaiseki (★crab leg buffet add-on)" },
      },
      {
        day: 3,
        title: "★ Tateyama Kurobe Alpine Route — 6 transport modes",
        route: "Ogizawa Station → ★Kanden Tunnel electric bus → Kurobe Dam (walking section) → Kurobe Lake → ★Kurobe Cable Car → Kurobedaira → ★Alpine Ropeway → Daikanbo → ★Tunnel Trolley Bus → Murodo (Tateyama main peak) → ★Highland Bus past Midagahara → Bijodaira → ★Electric Cable Car → Tateyama Station",
        attractions: ["Tateyama Kurobe Alpine Route (6 transport modes)"],
        hotel: "Kanazawa MYSTAYS / Kanazawa VISTA / Kanazawa DORMY INN / Toyama EXCEL Tokyu / Toyama ANA Crowne Plaza or similar",
        meals: { B: "Hotel breakfast", L: "Tateyama unagi rice or Japanese set (¥2,500)", D: "Kappo seafood gozen or shabu-shabu (¥3,500)" },
      },
      {
        day: 4,
        title: "Kenroku-en Garden → UNESCO Shirakawa-go → Hida Takayama old town",
        route: "Kenroku-en Garden (one of Japan's three great gardens) + Kanazawa Castle Ishikawa Gate → UNESCO Shirakawa-go gassho-zukuri village (fairytale gingerbread cottages) → Hida-Takayama old town (Kami-Sannomachi historic district) → Takayama Hida onsen",
        attractions: ["Kenroku-en Garden", "Shirakawa-go (UNESCO)", "Kami-Sannomachi Old Town · Takayama"],
        hotel: "Takayama GREEN / Takayama Hida Plaza / Takayama ASSOCIA / Takayama Tokyu Stay / Oku-Hida Yakedake Hotel or similar",
        meals: { B: "Hotel breakfast", L: "Hoba-miso grilled beef or Gifu local set (¥2,500)", D: "Hotel kaiseki welcome dinner or buffet" },
      },
      {
        day: 5,
        title: "Inuyama Castle (National Treasure) → Sanko Inari → AEON Mall → Nagoya → Taoyuan",
        route: "Inuyama Castle (Japan's oldest wooden tenshu, National Treasure) → Sanko Inari Shrine (fortune & love mini-torii path) → tax-free shop → Tokoname AEON MALL (world's largest 'Maneki-neko' lucky-cat themed mall) → Nagoya Chubu International Airport → Taoyuan",
        attractions: ["Inuyama Castle", "Sanko Inari Shrine", "Tokoname AEON MALL"],
        hotel: "Home",
        meals: { B: "Hotel breakfast", L: "Inuyama local set or Nagoya specialty (¥2,500)", D: "In-flight meal" },
      },
    ],
  },
};

// ─── Day-of-week formatter for departure dates ────────────────────────────────
function fmtDepartures(septDepartures) {
  // Group by day-of-week
  const dayMap = { 一: "Mon", 二: "Tue", 三: "Wed", 四: "Thu", 五: "Fri", 六: "Sat", 日: "Sun" };
  const byDay = {};
  for (const d of septDepartures) {
    const dow = dayMap[d.weekDay] ?? d.weekDay;
    const dateOnly = d.date.match(/2026[/-]09[/-](\d{2})/)?.[1];
    if (!dateOnly) continue;
    // Mark Silver Week (19-23) and Mid-Autumn (24-27) as peak
    const dayNum = parseInt(dateOnly, 10);
    const tag = (dayNum >= 19 && dayNum <= 23)
      ? "⚠"
      : (dayNum >= 24 && dayNum <= 27) ? "⚠" : "";
    (byDay[dow] ??= []).push(`Sept ${dayNum}${tag}`);
  }
  return byDay;
}

// ─── Build the HTML ───────────────────────────────────────────────────────────
function escape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderOption(bucket, opt, raw) {
  const departures = fmtDepartures(raw.septDepartures);
  const departuresHtml = Object.entries(departures)
    .map(([dow, dates]) =>
      `<div class="dep-row"><strong>${dow}:</strong> ${dates.join(", ")}</div>`
    )
    .join("");

  const daysHtml = opt.days.map((d) => `
    <div class="day">
      <div class="day-num">Day ${d.day}</div>
      <div class="day-body">
        <div class="day-title">${escape(d.title)}</div>
        <div class="day-route">${escape(d.route)}</div>
        ${d.attractions.length ? `
        <div class="day-row"><span class="row-label">Attractions:</span> ${d.attractions.map(escape).join(" · ")}</div>
        ` : ""}
        <div class="day-row"><span class="row-label">Hotel:</span> ${escape(d.hotel)} <span class="orsimilar">or similar</span></div>
        <div class="day-row meals">
          <span class="meal"><span class="meal-tag">B</span> ${escape(d.meals.B)}</span>
          <span class="meal"><span class="meal-tag">L</span> ${escape(d.meals.L)}</span>
          <span class="meal"><span class="meal-tag">D</span> ${escape(d.meals.D)}</span>
        </div>
      </div>
    </div>
  `).join("");

  const featured = bucket === "alpine";

  return `
    <div class="page option-page">
      <div class="option-header ${featured ? "featured" : ""}">
        <div class="option-title-row">
          <div class="option-title">${escape(opt.title)}</div>
          <div class="option-meta">${opt.days.length} days · ${raw.septDepartures.length} Sept departures</div>
        </div>
        <div class="option-subtitle">${escape(opt.subtitle)}</div>
        <div class="lt-code">
          <span class="lt-label">Lion Travel Product Code:</span>
          <code>${raw.normGroupId}</code>
        </div>
      </div>

      <div class="best-for-banner">
        <strong>Best for:</strong> ${escape(opt.bestFor)}
      </div>

      <div class="days-section">
        ${daysHtml}
      </div>

      <div class="departures-block">
        <h3>September 2026 Departures (${raw.septDepartures.length} dates available)</h3>
        ${departuresHtml}
        <div class="dep-legend">⚠ = peak window (Silver Week Sept 19-23 or Mid-Autumn Sept 24-27 — higher rates expected)</div>
      </div>
    </div>
  `;
}

const today = new Date().toISOString().slice(0, 10);

const optionPages = ["tokyo", "kansai", "hokkaido", "kyushu", "alpine"]
  .map((b) => renderOption(b, TRANSLATED[b], byBucket[b]))
  .join("\n");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>PACK&amp;GO — Japan September 2026 Catalog</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Helvetica Neue', Arial, 'Noto Sans', sans-serif;
    color: #111827;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    font-size: 10pt;
    line-height: 1.45;
  }
  .page {
    width: 210mm;
    min-height: 297mm;
    padding: 14mm 14mm 12mm;
    page-break-after: always;
  }
  .page:last-child { page-break-after: auto; }

  /* ── Cover ── */
  .brand-header {
    background: #1a2f4e;
    color: #fff;
    padding: 14mm 14mm 10mm;
    margin: -14mm -14mm 10mm;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .brand-header .logo { height: 14mm; }
  .brand-header .meta { text-align: right; font-size: 8.5pt; line-height: 1.5; }
  .brand-header .meta .quote-id {
    font-size: 9pt; font-weight: 700; letter-spacing: 0.5px; color: #d4af37;
  }

  h1 {
    color: #1a2f4e;
    font-size: 22pt;
    font-weight: 800;
    letter-spacing: -0.5px;
    margin: 6mm 0 1mm;
  }
  h1 .accent { color: #d4af37; }
  .cover-subtitle { font-size: 11pt; color: #6b7280; margin-bottom: 5mm; }

  .status {
    background: #f9f7f0;
    border-left: 3px solid #d4af37;
    padding: 3mm 4mm;
    font-size: 9.5pt;
    color: #4b5563;
    margin-bottom: 6mm;
  }

  h2 {
    color: #1a2f4e;
    font-size: 11pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    border-bottom: 2px solid #d4af37;
    padding-bottom: 1mm;
    margin: 6mm 0 3mm;
  }

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
  table.peak .window { font-weight: 700; color: #1a2f4e; white-space: nowrap; }
  table.peak .value { background: #ecfdf5; }

  /* ── Option page ── */
  .option-page { padding: 12mm 14mm; }
  .option-header {
    border-top: 4px solid #1a2f4e;
    padding-top: 4mm;
    margin-bottom: 5mm;
  }
  .option-header.featured { border-top-color: #d4af37; }
  .option-title-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 1mm;
  }
  .option-title {
    color: #1a2f4e;
    font-size: 15pt;
    font-weight: 800;
    line-height: 1.2;
    letter-spacing: -0.2px;
    flex: 1;
    padding-right: 4mm;
  }
  .option-meta {
    color: #6b7280;
    font-size: 9pt;
    white-space: nowrap;
    font-weight: 600;
  }
  .option-subtitle {
    color: #4b5563;
    font-size: 10pt;
    font-style: italic;
    margin-bottom: 3mm;
  }
  .lt-code {
    background: #f3f4f6;
    border: 1px solid #d1d5db;
    padding: 2mm 3mm;
    font-size: 9pt;
    margin-bottom: 4mm;
  }
  .lt-code .lt-label {
    font-weight: 700;
    color: #1a2f4e;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-size: 8pt;
    margin-right: 2mm;
  }
  .lt-code code {
    font-family: 'Menlo', 'Courier New', monospace;
    font-size: 9.5pt;
    color: #c2410c;
    font-weight: 600;
  }

  .best-for-banner {
    background: #1a2f4e;
    color: #fff;
    padding: 2mm 4mm;
    font-size: 9pt;
    margin-bottom: 5mm;
  }
  .best-for-banner strong { color: #d4af37; letter-spacing: 0.5px; }

  /* ── Day ── */
  .days-section { margin-bottom: 5mm; }
  .day {
    display: grid;
    grid-template-columns: 14mm 1fr;
    border-left: 2px solid #d4af37;
    padding: 3mm 0 3mm 3mm;
    margin-bottom: 2mm;
    page-break-inside: avoid;
  }
  .day-num {
    font-family: 'Helvetica Neue', sans-serif;
    font-size: 10pt;
    font-weight: 800;
    color: #1a2f4e;
    letter-spacing: -0.5px;
  }
  .day-title {
    font-weight: 700;
    color: #1a2f4e;
    font-size: 10.5pt;
    margin-bottom: 1.5mm;
    line-height: 1.3;
  }
  .day-route {
    font-size: 9pt;
    color: #4b5563;
    line-height: 1.5;
    margin-bottom: 2mm;
  }
  .day-row {
    font-size: 8.5pt;
    color: #374151;
    margin-bottom: 1mm;
    line-height: 1.4;
  }
  .day-row .row-label {
    font-weight: 700;
    color: #1a2f4e;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    font-size: 7.5pt;
    margin-right: 1mm;
  }
  .day-row .orsimilar {
    color: #9ca3af;
    font-style: italic;
    font-size: 8pt;
  }
  .day-row.meals {
    display: flex;
    gap: 4mm;
    flex-wrap: wrap;
  }
  .day-row.meals .meal {
    font-size: 8.5pt;
    color: #4b5563;
  }
  .day-row.meals .meal-tag {
    background: #d4af37;
    color: #fff;
    width: 4mm;
    height: 4mm;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 7pt;
    font-weight: 700;
    border-radius: 2px;
    margin-right: 1mm;
  }

  /* ── Departures ── */
  .departures-block {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    padding: 3mm 4mm;
    margin-top: 4mm;
  }
  .departures-block h3 {
    font-size: 9pt;
    color: #1a2f4e;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    margin-bottom: 2mm;
  }
  .dep-row {
    font-size: 9pt;
    margin-bottom: 1mm;
    color: #4b5563;
  }
  .dep-row strong {
    color: #1a2f4e;
    display: inline-block;
    min-width: 10mm;
  }
  .dep-legend {
    font-size: 8pt;
    color: #c2410c;
    margin-top: 2mm;
    font-style: italic;
  }

  /* ── Pricing note + next step ── */
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
  .pricing-note ol { margin-left: 5mm; margin-top: 2mm; }
  .pricing-note ol li { margin-bottom: 1mm; }
  .pricing-note .turnaround {
    margin-top: 3mm; font-weight: 700; color: #d4af37;
  }

  .next-step {
    background: #f9f7f0;
    border: 1px solid #d4af37;
    padding: 5mm 6mm;
    margin-top: 5mm;
    font-size: 10pt;
  }
  .next-step h2 { margin-top: 0; border-bottom: none; padding-bottom: 0; }
  .next-step ol { margin-left: 5mm; margin-top: 2mm; }
  .next-step ol li { margin-bottom: 1.2mm; }

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

<!-- Cover page -->
<div class="page">
  <div class="brand-header">
    <img class="logo" src="data:image/png;base64,${LOGO_NAVY_B64}" alt="PACK&amp;GO" style="filter:brightness(0) invert(1);" />
    <div class="meta">
      <div class="quote-id">CATALOG · PG-JP-2026-09</div>
      <div>Issued: ${today}</div>
      <div>Valid for planning until 2026-06-30</div>
    </div>
  </div>

  <h1>Japan <span class="accent">September 2026</span> Reference Catalog</h1>
  <div class="cover-subtitle">Five day-by-day group itineraries · Source: Lion Travel · PACK&amp;GO concierge</div>

  <div class="status">
    <strong>Status:</strong> Reference itineraries pulled live from Lion Travel API. Day-by-day, hotels (or similar), and meal plans below reflect the actual Lion Travel group product. <strong>Final USD price will be quoted by PACK&amp;GO after you select an option and date</strong> — supplier price (TWD) is converted + flight options added per your preferences.
  </div>

  <h2>⚠ September 2026 Peak Windows</h2>
  <table class="peak">
    <thead>
      <tr><th style="width:30%">Window</th><th style="width:42%">Reason</th><th style="width:28%">Impact</th></tr>
    </thead>
    <tbody>
      <tr>
        <td class="window">Sept 19–23</td>
        <td>Japan Silver Week (Respect for the Aged Day Sept 21 + Autumnal Equinox Sept 22)</td>
        <td>Hotels +20-40%, crowded attractions</td>
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

  <h2>Five Regional Options at a Glance</h2>
  <div style="font-size:9pt; line-height:1.7; color:#4b5563;">
    <strong style="color:#1a2f4e;">Option 1.</strong> <strong>Tokyo · Mt. Fuji · Karuizawa</strong> — 5 days, Hilton stay, 24 Sept departures<br/>
    <strong style="color:#1a2f4e;">Option 2.</strong> <strong>Kansai 4 Cities</strong> (Kyoto · Osaka · Kobe · Nara) — 6 days, Universal Studios + Himeji Castle, 6 Sept departures<br/>
    <strong style="color:#1a2f4e;">Option 3.</strong> <strong>Hokkaido 369</strong> — 5 days, Akan + Furano lavender + 3-crab buffet, 12 Sept departures<br/>
    <strong style="color:#1a2f4e;">Option 4.</strong> <strong>Kyushu Onsen Loop</strong> — 5 days, Yufuin + Takachiho + Aso, 3 Sept departures<br/>
    <strong style="color:#1a2f4e;">Option 5. ★</strong> <strong>Tateyama Kurobe Alpine + Shirakawa-go</strong> — 5 days, alpine 6 transport modes + UNESCO village, 17 Sept departures
  </div>
</div>

${optionPages}

<!-- Closing page -->
<div class="page">
  <div class="pricing-note">
    <h2>Pricing &amp; Booking Process</h2>
    <p>All five options are Lion Travel group products. PACK&amp;GO acts as your bilingual interface and concierge in the United States. Once you select an option and preferred departure date, we will:</p>
    <ol>
      <li>Confirm exact availability and lock the group seats from supplier backend</li>
      <li>Issue a formal USD quote including:
        <ul style="margin-left: 4mm; margin-top: 1mm;">
          <li>Lion Travel base package converted to USD at current rate</li>
          <li>Round-trip flight options (separate or combined)</li>
          <li>Hotel category upgrades if available</li>
          <li>English-speaking guide arrangement (where possible)</li>
        </ul>
      </li>
      <li>Lock in your booking with a 30% deposit (credit card accepted)</li>
      <li>Send your final formal quote PDF + Stripe payment link for the deposit</li>
    </ol>
    <div class="turnaround">Typical turnaround after your selection: 1 business day</div>
  </div>

  <div class="next-step">
    <h2>Next Step — Please Reply With</h2>
    <ol>
      <li><strong>Which option</strong> you'd like to proceed with (or up to two to compare side-by-side)</li>
      <li><strong>Preferred departure date</strong> from the September 2026 list — avoid peak windows for best value</li>
      <li><strong>Number of travelers</strong> (adults and children with ages)</li>
      <li><strong>Preferences:</strong> hotel category upgrade, English-speaking guide required, dietary needs, any mobility considerations</li>
    </ol>
  </div>

  <div class="footer">
    <strong>PACK&amp;GO Travel</strong> · packgoplay.com · Newark, California, USA<br/>
    Operated by PACK&amp;GO LLC · Jeff Hsieh · jeffhsieh09@gmail.com<br/>
    Catalog generated ${today} · Data source: Lion Travel API
  </div>
</div>

</body>
</html>`;

console.log("[render] Launching Chrome...");
const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0", timeout: 30_000 });
  await page.evaluateHandle("document.fonts.ready");
  const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
  });
  const outPath = path.join(
    process.env.HOME ?? "/tmp",
    "Desktop",
    "PACK&GO_Japan_Sept2026_Catalog.pdf"
  );
  await writeFile(outPath, pdf);
  console.log(`[render] ✓ ${pdf.byteLength} bytes → ${outPath}`);
} finally {
  await browser.close();
}
