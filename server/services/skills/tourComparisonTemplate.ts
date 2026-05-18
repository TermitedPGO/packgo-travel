/**
 * packgo-tour-comparison skill — server-side port.
 *
 * Server-side implementation of the Mac Claude skill at
 *   ~/Library/Application Support/Claude/.../skills/packgo-tour-comparison/
 *
 * This renderer takes a structured `TourComparisonInput` (already-scraped
 * tours + translations) and produces the catalog HTML. The Lion Travel
 * scraping + LLM translation orchestration lives in
 *   server/agents/skills/tourComparison.ts
 * which calls this renderer at the end.
 *
 * Pair with `renderHtmlToPdf` from skillPdfService.ts to get the PDF buffer.
 *
 * Brand palette is the SAME as packgo-quote (navy + gold) — by design, the
 * customer's catalog and their final quote should feel like one document set.
 *
 * IMPORTANT: This template does NOT include any prices. Catalog is the
 * pre-decision stage; prices come from packgo-quote AFTER customer picks.
 */

import { escapeHtml, LOGO_NAVY_B64, LOGO_WHITE_B64 } from "./skillPdfService";

// ─── Types ────────────────────────────────────────────────────────────────

export type ComparisonDay = {
  day: number;
  /** e.g. "Tokyo Tower (city iconic) → hotel" */
  title: string;
  /** Full route description, multi-segment OK */
  route: string;
  /** Comma-separable list of attraction names. Empty array OK. */
  attractions: string[];
  /** Hotel brand or area description. "or similar" appended automatically. */
  hotel: string;
  meals: { B: string; L: string; D: string };
};

export type ComparisonDeparture = {
  /** "Sept 1" or "9月1日" — already formatted for display */
  dateLabel: string;
  /** "Tue", "Sat" — already translated/abbreviated */
  weekDay: string;
  /** true if this date falls in a peak window (renders ⚠) */
  isPeak: boolean;
};

export type ComparisonOption = {
  /** Title shown at top of the option page. Already translated. */
  title: string;
  /** One-line subtitle / highlights. */
  subtitle: string;
  /** Supplier product code (Lion's NormGroupID or UV's productId). CRITICAL — this is how Jeff finds the tour back in supplier backend. */
  supplierCode: string;
  /** Days count (e.g. 5) */
  days: number;
  /** "Best for ..." text. */
  bestFor: string;
  /** Day-by-day. days.length should equal `days`. */
  itinerary: ComparisonDay[];
  /** All departures in the target month for this option. */
  departures: ComparisonDeparture[];
  /** Mark as ⭐ featured (gold border) — usually the most scenic / unique option. */
  featured?: boolean;
};

export type PeakWindow = {
  /** e.g. "Sept 19-23" — date range label */
  window: string;
  reason: string;
  impact: string;
  /** If true, render as a "best value" row (green background). */
  isValueWindow?: boolean;
};

export type TourComparisonInput = {
  country: string; // "Japan", "Korea"
  countryCode: string; // "JP", "KR" — used in catalog ID
  monthName: string; // "September"
  monthNumber: number; // 1-12
  year: number;
  /** Supplier display name (e.g. "Lion Travel"). */
  supplier: string;
  /** ISO date string of catalog issue (defaults to today). */
  issuedDate?: string;
  /** ISO date string of plan-by deadline (defaults to monthEnd minus 30 days). */
  validUntil?: string;
  peakWindows: PeakWindow[];
  options: ComparisonOption[];
};

// ─── Defaults ─────────────────────────────────────────────────────────────

function defaultIssuedDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultValidUntil(year: number, month: number): string {
  // Plan-by date: 1 month before the target month
  const planMonth = month - 1 || 12;
  const planYear = month === 1 ? year - 1 : year;
  const lastDay = new Date(planYear, planMonth, 0).getDate();
  return `${planYear}-${String(planMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

// ─── Helper: group departures by day-of-week ──────────────────────────────

function groupDeparturesByDow(departures: ComparisonDeparture[]): {
  weekDay: string;
  dateLabels: string[];
}[] {
  // Preserve weekday encounter order so the catalog reads consistently
  const order: string[] = [];
  const map = new Map<string, string[]>();
  for (const d of departures) {
    const label = d.isPeak ? `${d.dateLabel}⚠` : d.dateLabel;
    if (!map.has(d.weekDay)) {
      order.push(d.weekDay);
      map.set(d.weekDay, []);
    }
    map.get(d.weekDay)!.push(label);
  }
  // Reorder to canonical Mon-Sun if possible
  const dowOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  order.sort((a, b) => {
    const ia = dowOrder.indexOf(a);
    const ib = dowOrder.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return order.map((wd) => ({ weekDay: wd, dateLabels: map.get(wd)! }));
}

// ─── Render a single option page ──────────────────────────────────────────

function renderOptionPage(opt: ComparisonOption, monthName: string, year: number, supplier: string): string {
  const daysHtml = opt.itinerary
    .map(
      (d) => `
    <div class="day">
      <div class="day-num">Day ${d.day}</div>
      <div>
        <div class="day-title">${escapeHtml(d.title)}</div>
        <div class="day-route">${escapeHtml(d.route)}</div>
        ${d.attractions.length > 0
          ? `<div class="day-row"><span class="row-label">Attractions:</span> ${d.attractions.map(escapeHtml).join(" · ")}</div>`
          : ""}
        <div class="day-row"><span class="row-label">Hotel:</span> ${escapeHtml(d.hotel)} <span class="orsimilar">or similar</span></div>
        <div class="day-row meals">
          <span class="meal"><span class="meal-tag">B</span> ${escapeHtml(d.meals.B || "—")}</span>
          <span class="meal"><span class="meal-tag">L</span> ${escapeHtml(d.meals.L || "—")}</span>
          <span class="meal"><span class="meal-tag">D</span> ${escapeHtml(d.meals.D || "—")}</span>
        </div>
      </div>
    </div>
  `
    )
    .join("");

  const depGroups = groupDeparturesByDow(opt.departures);
  const depRowsHtml = depGroups
    .map(
      (g) =>
        `<div class="dep-row"><strong>${escapeHtml(g.weekDay)}:</strong> ${g.dateLabels.map(escapeHtml).join(", ")}</div>`
    )
    .join("");

  return `
    <div class="page option-page">
      <div class="option-header ${opt.featured ? "featured" : ""}">
        <div class="option-title-row">
          <div class="option-title">${opt.featured ? `<span class="star">★ </span>` : ""}${escapeHtml(opt.title)}</div>
          <div class="option-meta">${opt.days} days · ${opt.departures.length} ${escapeHtml(monthName)} departures</div>
        </div>
        <div class="option-subtitle">${escapeHtml(opt.subtitle)}</div>
        <div class="lt-code">
          <span class="lt-label">${escapeHtml(supplier)} Code:</span>
          <code>${escapeHtml(opt.supplierCode)}</code>
        </div>
      </div>

      <div class="best-for-banner">
        <strong>Best for:</strong> ${escapeHtml(opt.bestFor)}
      </div>

      <div class="days-section">${daysHtml}</div>

      <div class="departures-block">
        <h3>${escapeHtml(monthName)} ${year} Departures (${opt.departures.length} dates available)</h3>
        ${depRowsHtml}
        <div class="dep-legend">⚠ = peak window (higher rates expected)</div>
      </div>
    </div>
  `;
}

// ─── Main entry ───────────────────────────────────────────────────────────

export function renderTourComparisonHtml(input: TourComparisonInput): string {
  const issued = input.issuedDate ?? defaultIssuedDate();
  const valid = input.validUntil ?? defaultValidUntil(input.year, input.monthNumber);
  const ym = `${input.year}${String(input.monthNumber).padStart(2, "0")}`;

  const peakRowsHtml = input.peakWindows
    .map(
      (p) => `
      <tr>
        <td class="window${p.isValueWindow ? " value" : ""}">${escapeHtml(p.window)}</td>
        <td${p.isValueWindow ? ' class="value"' : ""}>${escapeHtml(p.reason)}</td>
        <td${p.isValueWindow ? ' class="value"' : ""}>${escapeHtml(p.impact)}</td>
      </tr>`
    )
    .join("");

  const glanceHtml = input.options
    .map((opt, i) => {
      const star = opt.featured ? "★ " : "";
      return `<div><span class="opt-label">Option ${i + 1}.</span> ${star}<strong>${escapeHtml(opt.title)}</strong> — ${opt.days} days, ${opt.departures.length} ${escapeHtml(input.monthName)} departures</div>`;
    })
    .join("");

  const optionsHtml = input.options
    .map((opt) => renderOptionPage(opt, input.monthName, input.year, input.supplier))
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>PACK&amp;GO — ${escapeHtml(input.country)} ${escapeHtml(input.monthName)} ${input.year} Catalog</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'Noto Sans CJK TC', 'Helvetica Neue', Arial, sans-serif;
  color: #2C2C2C; font-size: 10.5pt; line-height: 1.5; background: white;
}
.page { width: 210mm; min-height: 297mm; padding: 0; page-break-after: always; position: relative; }
.page:last-child { page-break-after: auto; }
@media print {
  .option-page { page-break-after: always; }
  .option-header { page-break-after: avoid; }
  .day { page-break-inside: avoid; }
  .pricing-note, .next-step { page-break-inside: avoid; }
}

.brand-header {
  background: linear-gradient(135deg, #1B2A4A 0%, #2A3F6A 100%);
  color: #fff; padding: 18mm 14mm 12mm;
  display: flex; justify-content: space-between; align-items: flex-end;
  position: relative;
}
.brand-header::after {
  content: ''; position: absolute; bottom: 0; left: 0; right: 0;
  height: 3px; background: #C9A96E;
}
.brand-header .logo { height: 16mm; width: auto; }
.brand-header .meta { text-align: right; font-size: 9pt; line-height: 1.6; }
.brand-header .meta .quote-id { color: #C9A96E; font-weight: 700; letter-spacing: 1px; font-size: 10pt; margin-bottom: 2mm; }
.content { padding: 8mm 14mm 12mm; }

h1 { color: #1B2A4A; font-size: 24pt; font-weight: 800; letter-spacing: -0.5px; margin: 8mm 0 2mm; line-height: 1.15; }
h1 .accent { color: #C9A96E; }
.cover-subtitle { font-size: 11.5pt; color: #555; margin-bottom: 6mm; font-style: italic; }
.status-banner { background: #F9F7F2; border-left: 3px solid #C9A96E; padding: 4mm 5mm; font-size: 10pt; color: #555; margin-bottom: 8mm; line-height: 1.55; }
.status-banner strong { color: #1B2A4A; }

.section-title { display: flex; align-items: center; margin: 7mm 0 3mm; }
.section-title .bar { width: 4px; height: 14pt; background: #C9A96E; margin-right: 6px; }
.section-title h2 { color: #1B2A4A; font-size: 11pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; }

table.peak { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-bottom: 4mm; }
table.peak th { background: #1B2A4A; color: #fff; text-align: left; padding: 2.5mm 3mm; font-weight: 600; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.5px; }
table.peak td { padding: 3mm; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
table.peak tr:last-child td { border-bottom: none; }
table.peak .window { font-weight: 700; color: #1B2A4A; white-space: nowrap; }
table.peak .value { background: #F0F9F2; }

.glance { font-size: 10pt; line-height: 1.85; color: #555; margin-top: 2mm; }
.glance .opt-label { color: #1B2A4A; font-weight: 700; margin-right: 1mm; }
.glance strong { color: #1B2A4A; }

.option-page { padding: 12mm 14mm; }
.option-header { border-top: 4px solid #1B2A4A; padding-top: 5mm; margin-bottom: 6mm; }
.option-header.featured { border-top-color: #C9A96E; }

.option-title-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2mm; }
.option-title { color: #1B2A4A; font-size: 16pt; font-weight: 800; line-height: 1.2; letter-spacing: -0.2px; flex: 1; padding-right: 4mm; }
.option-title .star { color: #C9A96E; }
.option-meta { color: #6b7280; font-size: 9.5pt; white-space: nowrap; font-weight: 600; }
.option-subtitle { color: #555; font-size: 10pt; font-style: italic; margin-bottom: 4mm; }

.lt-code {
  background: #F9F7F2; border: 1px solid #C9A96E; border-left: 4px solid #C9A96E;
  padding: 2.5mm 4mm; font-size: 9.5pt; margin-bottom: 5mm;
  display: flex; align-items: center; gap: 3mm;
}
.lt-code .lt-label { font-weight: 700; color: #1B2A4A; text-transform: uppercase; letter-spacing: 0.5px; font-size: 8.5pt; }
.lt-code code { font-family: 'Menlo', 'Courier New', monospace; font-size: 10pt; color: #C2410C; font-weight: 700; letter-spacing: 0.5px; }

.best-for-banner { background: #1B2A4A; color: #fff; padding: 2.5mm 4mm; font-size: 9.5pt; margin-bottom: 5mm; border-left: 4px solid #C9A96E; }
.best-for-banner strong { color: #C9A96E; letter-spacing: 0.5px; margin-right: 1.5mm; }

.days-section { margin-bottom: 5mm; }
.day { display: grid; grid-template-columns: 16mm 1fr; border-left: 2px solid #C9A96E; padding: 3mm 0 3mm 3mm; margin-bottom: 2mm; }
.day-num { font-size: 10pt; font-weight: 800; color: #1B2A4A; letter-spacing: -0.5px; }
.day-title { font-weight: 700; color: #1B2A4A; font-size: 10.5pt; margin-bottom: 1.5mm; line-height: 1.3; }
.day-route { font-size: 9pt; color: #555; line-height: 1.55; margin-bottom: 2mm; }
.day-row { font-size: 8.5pt; color: #374151; margin-bottom: 1mm; line-height: 1.45; }
.day-row .row-label { font-weight: 700; color: #1B2A4A; text-transform: uppercase; letter-spacing: 0.4px; font-size: 7.5pt; margin-right: 1mm; }
.day-row .orsimilar { color: #999; font-style: italic; font-size: 8pt; }
.day-row.meals { display: flex; gap: 4mm; flex-wrap: wrap; }
.day-row.meals .meal { font-size: 8.5pt; color: #555; }
.day-row.meals .meal-tag {
  background: #C9A96E; color: #fff; width: 4mm; height: 4mm;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 7pt; font-weight: 700; border-radius: 2px; margin-right: 1mm;
}

.departures-block { background: #F9FAFB; border: 1px solid #E5E7EB; padding: 3.5mm 4mm; margin-top: 5mm; }
.departures-block h3 { font-size: 9pt; color: #1B2A4A; text-transform: uppercase; letter-spacing: 0.7px; margin-bottom: 2.5mm; font-weight: 700; }
.dep-row { font-size: 9pt; margin-bottom: 1.5mm; color: #555; }
.dep-row strong { color: #1B2A4A; display: inline-block; min-width: 12mm; }
.dep-legend { font-size: 8pt; color: #C2410C; margin-top: 2.5mm; font-style: italic; }

.pricing-note { background: #1B2A4A; color: #fff; padding: 6mm 8mm; margin-top: 7mm; font-size: 10pt; line-height: 1.55; }
.pricing-note h2 { color: #C9A96E; border-bottom: 2px solid rgba(201, 169, 110, 0.4); padding-bottom: 1.5mm; margin-bottom: 3mm; font-size: 11pt; text-transform: uppercase; letter-spacing: 1.2px; font-weight: 700; }
.pricing-note ol { margin-left: 5mm; margin-top: 2mm; }
.pricing-note ol li { margin-bottom: 1.5mm; }
.pricing-note .turnaround { margin-top: 4mm; font-weight: 700; color: #C9A96E; }

.next-step { background: #F9F7F2; border: 1px solid #C9A96E; padding: 6mm 8mm; margin-top: 5mm; font-size: 10pt; }
.next-step h2 { color: #1B2A4A; margin-bottom: 3mm; font-size: 11pt; text-transform: uppercase; letter-spacing: 1.2px; font-weight: 700; }
.next-step ol { margin-left: 5mm; margin-top: 2mm; }
.next-step ol li { margin-bottom: 1.5mm; }
.next-step ol li strong { color: #1B2A4A; }

.footer { margin-top: 8mm; padding-top: 5mm; border-top: 2px solid #1B2A4A; text-align: center; font-size: 9pt; color: #555; line-height: 1.6; }
.footer strong { color: #1B2A4A; }
.footer .footer-logo { height: 10mm; margin-bottom: 3mm; }
</style>
</head>
<body>

<div class="page cover">
  <div class="brand-header">
    <img class="logo" src="data:image/png;base64,${LOGO_WHITE_B64}" alt="PACK&amp;GO" />
    <div class="meta">
      <div class="quote-id">CATALOG · PG-${escapeHtml(input.countryCode)}-${ym}</div>
      <div>Issued: ${escapeHtml(issued)}</div>
      <div>Valid for planning until ${escapeHtml(valid)}</div>
    </div>
  </div>

  <div class="content">
    <h1>${escapeHtml(input.country)} <span class="accent">${escapeHtml(input.monthName)} ${input.year}</span> Reference Catalog</h1>
    <div class="cover-subtitle">${input.options.length} day-by-day group itineraries · Source: ${escapeHtml(input.supplier)} · PACK&amp;GO concierge</div>

    <div class="status-banner">
      <strong>Status:</strong> Reference itineraries pulled live from ${escapeHtml(input.supplier)} API. Day-by-day, hotels (or similar), and meal plans below reflect the actual ${escapeHtml(input.supplier)} group product. <strong>Final USD price will be quoted by PACK&amp;GO after you select an option and date</strong> — supplier price converted + flight options added per your preferences.
    </div>

    <div class="section-title"><div class="bar"></div><h2>⚠ ${escapeHtml(input.monthName)} ${input.year} Peak Windows</h2></div>
    <table class="peak">
      <thead><tr><th style="width:30%">Window</th><th style="width:42%">Reason</th><th style="width:28%">Impact</th></tr></thead>
      <tbody>${peakRowsHtml}</tbody>
    </table>

    <div class="section-title"><div class="bar"></div><h2>${input.options.length} Regional Options at a Glance</h2></div>
    <div class="glance">${glanceHtml}</div>
  </div>
</div>

${optionsHtml}

<div class="page">
  <div class="content">
    <div class="pricing-note">
      <h2>Pricing &amp; Booking Process</h2>
      <p>All ${input.options.length} options are ${escapeHtml(input.supplier)} group products. PACK&amp;GO acts as your bilingual interface and concierge in the United States. Once you select an option and preferred departure date, we will:</p>
      <ol>
        <li>Confirm exact availability and lock the group seats from supplier backend</li>
        <li>Issue a formal USD quote including:
          <ul style="margin-left: 5mm; margin-top: 1mm;">
            <li>${escapeHtml(input.supplier)} base package converted to USD at current rate</li>
            <li>Round-trip flight options (separate or combined)</li>
            <li>Hotel category upgrades if available</li>
            <li>English-speaking guide arrangement (where possible)</li>
          </ul>
        </li>
        <li>Lock in your booking with a 30% deposit (credit card accepted)</li>
        <li>Send your final formal quote PDF + Stripe payment link</li>
      </ol>
      <div class="turnaround">Typical turnaround after your selection: 1 business day</div>
    </div>

    <div class="next-step">
      <h2>Next Step — Please Reply With</h2>
      <ol>
        <li><strong>Which option</strong> you'd like to proceed with (or up to two to compare side-by-side)</li>
        <li><strong>Preferred departure date</strong> from the ${escapeHtml(input.monthName)} ${input.year} list — avoid peak windows for best value</li>
        <li><strong>Number of travelers</strong> (adults and children with ages)</li>
        <li><strong>Preferences:</strong> hotel category, English-speaking guide required, dietary needs, any mobility considerations</li>
      </ol>
    </div>

    <div class="footer">
      <img class="footer-logo" src="data:image/png;base64,${LOGO_NAVY_B64}" />
      <div><strong>PACK&amp;GO Travel</strong> · packgoplay.com · Newark, California, USA</div>
      <div>Operated by Pack &amp; Go, LLC · CST #2166984-40 · EIN 33-2862740</div>
      <div>Jeff Hsieh · jeffhsieh09@gmail.com · +1 (510) 634-2307</div>
      <div style="margin-top: 2mm; font-size: 8pt; color: #999;">Catalog generated ${escapeHtml(issued)} · Data source: ${escapeHtml(input.supplier)} public API</div>
    </div>
  </div>
</div>

</body>
</html>`;
}
