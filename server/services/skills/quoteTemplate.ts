/**
 * packgo-quote skill — server-side port.
 *
 * Generates the 2-page Quote PDF (頁 1: itinerary, 頁 2: pricing + terms)
 * using PACK&GO's navy/gold brand palette. Adapted from the original
 * skill template at
 *   ~/Downloads/packgo-skills-bundle/.claude/skills/packgo-quote/references/template.html
 *
 * Defaults align with skill docs:
 *   - Payment: credit card, 30% deposit within 2 days, balance 14 days before
 *   - Cancellation: 35d+ full refund / 16-34d 50% / 8-15d 20% / 7d none
 *   - Quote valid 5 days, hotels add 「或同級」
 */

import { escapeHtml, fmtNum, LOGO_WHITE_B64 } from "./skillPdfService";

export type QuoteHotel = {
  date: string; // e.g. "8/22 (週六)"
  name: string; // e.g. "Hilton Chicago Magnificent Mile Suites"
  location?: string; // optional column
};

export type QuoteDay = {
  day: number;
  date?: string; // e.g. "8/22 (週六)"
  title: string; // e.g. "抵達芝加哥 · 城市初探"
  description: string; // 50-200 字
};

export type QuoteInput = {
  // Hero
  tripName: string;
  subtitle?: string; // e.g. "5天5夜 專屬包車行程" — defaults computed
  // Basic info
  departureDate: string; // free text, e.g. "2026 年 8 月 22 日 — 8 月 26 日"
  passengers: string; // e.g. "4 大人"
  carService?: string; // e.g. "GMC Yukon XL 7 人座 / 一車一導"
  serviceConfig?: string[]; // bullet list of inclusions for the service tier
  // Hotels
  hotels: QuoteHotel[];
  hotelNote?: string; // small print under hotel table
  // Itinerary
  days: QuoteDay[];
  // Pricing — 可留白(null/undefined)= 「待確認」。AI 永不報價(報價留人);
  // Jeff 確認直客售價後才填。客人文件只放直客售價,絕不放供應商成本。
  totalUSD?: number | null;
  perPersonUSD?: number | null;
  twdRate?: number; // default 32
  // Lists
  includes: string[];
  excludes: string[];
  payment?: string[]; // override defaults
  cancellation?: string[]; // override defaults
  // Meta
  quoteDate?: string; // defaults to today
  validDays?: number; // defaults to 5
  clientName?: string; // optional — appears in header
};

const DEFAULT_PAYMENT = [
  "接受信用卡刷卡付款(美金計價,台幣依刷卡當日匯率換算)",
  "訂金:確認行程後 2 日內支付團費之 30%",
  "尾款:出發前 14 天付清全額",
];

const DEFAULT_CANCELLATION = [
  "出發前 35 天及以上:退還全額(需扣除銀行手續費)",
  "出發前 16–34 天:退還 50%",
  "出發前 8–15 天:退還 20%",
  "出發前 7 天以內:不可退款",
];

export function renderQuoteHtml(input: QuoteInput): string {
  const twdRate = input.twdRate ?? 32;
  const hasPrice =
    typeof input.totalUSD === "number" && typeof input.perPersonUSD === "number";
  const totalTWD = hasPrice ? Math.round((input.totalUSD as number) * twdRate) : 0;
  const perPersonTWD = hasPrice ? Math.round((input.perPersonUSD as number) * twdRate) : 0;
  const today = input.quoteDate ?? new Date().toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const validDays = input.validDays ?? 5;
  const subtitle = input.subtitle ?? `${input.days.length}天${input.days.length - 1}夜 專屬行程`;

  const payment = input.payment ?? DEFAULT_PAYMENT;
  const cancellation = input.cancellation ?? DEFAULT_CANCELLATION;

  const hotelsHtml = input.hotels
    .map(
      (h) => `
    <tr>
      <td>${escapeHtml(h.date)}</td>
      <td>${escapeHtml(h.name)}<span style="color:#888"> 或同級</span></td>
      ${h.location ? `<td>${escapeHtml(h.location)}</td>` : "<td></td>"}
    </tr>`
    )
    .join("");

  const daysHtml = input.days
    .map(
      (d, i) => `
    <div class="day-block">
      <div class="day-marker">
        <div class="day-circle">DAY ${d.day}</div>
        ${i < input.days.length - 1 ? '<div class="day-line"></div>' : ""}
      </div>
      <div class="day-content">
        ${d.date ? `<div class="day-date">${escapeHtml(d.date)}</div>` : ""}
        <div class="day-title">${escapeHtml(d.title)}</div>
        <div class="day-desc">${escapeHtml(d.description)}</div>
      </div>
    </div>`
    )
    .join("");

  const serviceConfigHtml = (input.serviceConfig ?? [])
    .map((s) => `<div class="info-row"><span class="diamond">◆</span><span class="value">${escapeHtml(s)}</span></div>`)
    .join("");

  const includesHtml = input.includes
    .map((s) => `<div class="check-item"><span class="icon ink">✓</span>${escapeHtml(s)}</div>`)
    .join("");

  const excludesHtml = input.excludes
    .map((s) => `<div class="check-item"><span class="icon ink">※</span>${escapeHtml(s)}</div>`)
    .join("");

  const paymentHtml = payment.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
  const cancellationHtml = cancellation.map((s) => `<li>${escapeHtml(s)}</li>`).join("");

  return /* html */ `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Noto Sans CJK TC', 'WenQuanYi Zen Hei', sans-serif; color: #2C2C2C; font-size: 10.5pt; line-height: 1.6; background: white; }
.page { width: 100%; min-height: 297mm; padding: 0; page-break-after: always; position: relative; }
.page:last-child { page-break-after: auto; }

/* Header — PACK&GO 黑白:深底白字(#1A1A1A 黑底),不用 navy/gold */
.header { background: #1A1A1A; padding: 24px 28px 20px; text-align: center; position: relative; }
.header-logo { width: 48px; height: auto; margin-bottom: 6px; }
.header h1 { color: #FFFFFF; font-size: 22pt; font-weight: 700; letter-spacing: 4px; margin-bottom: 4px; }
.header .subtitle { color: #C8C8C8; font-size: 12pt; font-weight: 400; letter-spacing: 2px; }
.header .gold-line { width: 80px; height: 2px; background: #FFFFFF; margin: 10px auto 0; }
.header .client { color: rgba(255,255,255,0.6); font-size: 9pt; margin-top: 6px; }

/* Section */
.content { padding: 18px 28px 12px; }
.section-title { display: flex; align-items: center; margin: 20px 0 12px; padding-bottom: 8px; border-bottom: 1.5px solid #D2D2D2; }
.section-title .bar { width: 4px; height: 20px; background: #1A1A1A; margin-right: 10px; flex-shrink: 0; }
.section-title h2 { font-size: 13pt; color: #1A1A1A; font-weight: 700; }

.info-grid { margin-left: 8px; }
.info-row { display: flex; align-items: baseline; margin-bottom: 5px; }
.info-row .diamond { color: #1A1A1A; margin-right: 8px; font-size: 8pt; }
.info-row .label { color: #555; font-weight: 500; width: 95px; flex-shrink: 0; font-size: 10pt; }
.info-row .value { color: #1A1A1A; font-size: 10pt; }

/* Hotel table */
.hotel-table { width: 100%; margin: 8px 0; border-collapse: collapse; font-size: 9.5pt; }
.hotel-table th { background: #ECECEC; color: #1A1A1A; font-weight: 600; padding: 6px 10px; text-align: left; border-bottom: 2px solid #1A1A1A; }
.hotel-table td { padding: 6px 10px; border-bottom: 1px solid #EAEAEA; }
.hotel-table tr:last-child td { border-bottom: none; }
.hotel-note { font-size: 8.5pt; color: #888; margin-top: 4px; margin-left: 4px; }

/* Itinerary day blocks */
.day-block { display: flex; margin-bottom: 10px; position: relative; }
.day-marker { flex-shrink: 0; width: 55px; text-align: center; position: relative; }
.day-circle { width: 36px; height: 36px; background: #1A1A1A; border-radius: 50%; color: #FFFFFF; font-size: 8pt; font-weight: 700; display: flex; align-items: center; justify-content: center; margin: 0 auto; }
.day-line { width: 2px; background: #D2D2D2; position: absolute; left: 50%; top: 38px; bottom: -10px; transform: translateX(-50%); }
.day-content { flex: 1; padding-left: 8px; padding-top: 2px; }
.day-date { color: #1A1A1A; font-weight: 700; font-size: 10.5pt; }
.day-title { color: #1A1A1A; font-weight: 600; font-size: 10.5pt; margin-bottom: 2px; }
.day-desc { color: #555; font-size: 9.5pt; line-height: 1.5; }

/* Price box */
.price-box { border: 1.5px solid #1A1A1A; border-radius: 8px; background: #F2F2F2; padding: 18px 25px; margin: 12px 0; }
.price-row { display: flex; align-items: baseline; margin-bottom: 10px; }
.price-row:last-child { margin-bottom: 0; }
.price-label { color: #1A1A1A; font-weight: 700; font-size: 12pt; width: 100px; }
.price-value { color: #1A1A1A; font-weight: 700; font-size: 20pt; margin-right: 15px; }
.price-twd { color: #888; font-size: 9pt; }

.check-list { margin-left: 5px; }
.check-item { display: flex; align-items: flex-start; margin-bottom: 5px; font-size: 10pt; }
.check-item .icon { flex-shrink: 0; width: 20px; font-size: 11pt; font-weight: 700; }
.check-item .icon.ink { color: #1A1A1A; }

.policy-list { margin-left: 15px; font-size: 9.5pt; color: #555; line-height: 1.7; }
.policy-list li { margin-bottom: 3px; }

.mini-header { background: #1A1A1A; padding: 10px 28px; text-align: center; color: #FFFFFF; font-weight: 600; font-size: 11pt; letter-spacing: 2px; }

.footer { text-align: center; padding: 15px 28px; border-top: 1.5px solid #D2D2D2; margin: 20px 28px 0; }
.footer-logo { width: 42px; height: auto; margin-bottom: 5px; }
.footer .company { color: #1A1A1A; font-weight: 700; font-size: 11pt; margin-bottom: 3px; }
.footer .info { color: #666; font-size: 8.5pt; line-height: 1.5; }
.footer .valid { color: #888; font-size: 8pt; margin-top: 6px; }
</style>
</head>
<body>

<!-- Page 1: Itinerary -->
<div class="page">
  <div class="header">
    ${LOGO_WHITE_B64 ? `<img class="header-logo" src="data:image/png;base64,${LOGO_WHITE_B64}" />` : ""}
    <h1>${escapeHtml(input.tripName)}</h1>
    <div class="subtitle">${escapeHtml(subtitle)}</div>
    <div class="gold-line"></div>
    ${input.clientName ? `<div class="client">致 ${escapeHtml(input.clientName)}</div>` : ""}
  </div>

  <div class="content">
    <div class="section-title"><div class="bar"></div><h2>行程基本資訊</h2></div>
    <div class="info-grid">
      <div class="info-row"><span class="diamond">◆</span><span class="label">出發日期</span><span class="value">${escapeHtml(input.departureDate)}</span></div>
      <div class="info-row"><span class="diamond">◆</span><span class="label">出行人數</span><span class="value">${escapeHtml(input.passengers)}</span></div>
      ${input.carService ? `<div class="info-row"><span class="diamond">◆</span><span class="label">專屬用車</span><span class="value">${escapeHtml(input.carService)}</span></div>` : ""}
    </div>
    ${serviceConfigHtml ? `<div class="info-grid" style="margin-top:8px">${serviceConfigHtml}</div>` : ""}

    ${input.hotels.length > 0 ? `
    <div class="section-title"><div class="bar"></div><h2>住宿安排</h2></div>
    <table class="hotel-table">
      <thead><tr><th style="width:25%">日期</th><th>飯店名稱</th><th style="width:25%">地點</th></tr></thead>
      <tbody>${hotelsHtml}</tbody>
    </table>
    ${input.hotelNote ? `<div class="hotel-note">＊ ${escapeHtml(input.hotelNote)}</div>` : ""}
    ` : ""}

    <div class="section-title"><div class="bar"></div><h2>每日行程大綱</h2></div>
    ${daysHtml}
  </div>
</div>

<!-- Page 2: Pricing + Terms -->
<div class="page">
  <div class="mini-header">報價資訊與費用說明</div>
  <div class="content">
    <div class="section-title"><div class="bar"></div><h2>報價資訊</h2></div>
    <div class="price-box">
      ${hasPrice ? `
      <div class="price-row">
        <span class="price-label">整團總價</span>
        <span class="price-value">$${fmtNum(input.totalUSD as number)} USD</span>
        <span class="price-twd">(約合台幣 ${fmtNum(totalTWD)} 元,實際以結帳當日匯率為準)</span>
      </div>
      <div class="price-row">
        <span class="price-label">每人均價</span>
        <span class="price-value">$${fmtNum(input.perPersonUSD as number)} USD</span>
        <span class="price-twd">(約合台幣 ${fmtNum(perPersonTWD)} 元,實際以結帳當日匯率為準)</span>
      </div>` : `
      <div class="price-row">
        <span class="price-label">報價</span>
        <span class="price-value" style="font-size:15pt">待確認</span>
        <span class="price-twd">(實際售價由 Pack &amp; Go 確認後提供)</span>
      </div>`}
    </div>

    <div class="section-title"><div class="bar"></div><h2>費用包含</h2></div>
    <div class="check-list">${includesHtml}</div>

    <div class="section-title"><div class="bar"></div><h2>費用不含</h2></div>
    <div class="check-list">${excludesHtml}</div>

    <div class="section-title"><div class="bar"></div><h2>付款方式</h2></div>
    <ul class="policy-list">${paymentHtml}</ul>

    <div class="section-title"><div class="bar"></div><h2>取消政策</h2></div>
    <ul class="policy-list">${cancellationHtml}</ul>
  </div>

  <div class="footer">
    <div class="company">PACK &amp; GO, LLC</div>
    <div class="info">CST: #2166984-40 · 39055 Cedar Blvd #126, Newark, CA 94560 · packgoplay.com</div>
    <div class="info">謝俊甫 Jeff Hsieh · jeffhsieh09@gmail.com · +1 (510) 634-2307</div>
    <div class="valid">報價有效期 ${validDays} 天 · ${escapeHtml(today)}</div>
  </div>
</div>

</body>
</html>`;
}
