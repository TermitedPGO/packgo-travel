/**
 * aiQuoteService.ts — AI Quote Generator (v78).
 *
 * Customer says "I want 5 days in Japan, 2 adults + 1 kid (7yo), under $5K USD,
 * leaving in May" — we LLM-extract structured params, match against the tour
 * catalog, and generate a polished PDF quote in ~30 seconds.
 *
 * Why this matters for a 1-person operation:
 *   - Manual quoting is the #1 time sink (1+ hour per custom request)
 *   - Slow response loses customers (industry norm: 2-hour first-reply)
 *   - With this, Jeff goes from 5 quotes/day to 50+ without breaking a sweat
 */

import { invokeLLM } from "../_core/llm";
import { storagePut } from "../storage";
import { getDb } from "../db";
import { aiQuotes, tours } from "../../drizzle/schema";
import { and, eq, like, or, gte, lte, sql, desc } from "drizzle-orm";

export interface ExtractedQuoteParams {
  destinationCountry?: string;
  destinationCity?: string;
  days?: number;
  adults?: number;
  children?: number;
  infants?: number;
  budgetMin?: number;
  budgetMax?: number;
  currency?: string;
  departureMonth?: string;     // YYYY-MM
  departureFlexible?: boolean; // true if customer said "anytime" / "flexible"
  preferences?: string[];      // free-form: "honeymoon", "kid-friendly", "luxury", "vegetarian"
  language?: "zh-TW" | "en";
}

const EXTRACTION_SCHEMA = {
  type: "object" as const,
  properties: {
    destinationCountry: { type: "string" },
    destinationCity:    { type: "string" },
    days:               { type: "number" },
    adults:             { type: "number" },
    children:           { type: "number" },
    infants:            { type: "number" },
    budgetMin:          { type: "number" },
    budgetMax:          { type: "number" },
    currency:           { type: "string" },
    departureMonth:     { type: "string" },
    departureFlexible:  { type: "boolean" },
    preferences:        { type: "array", items: { type: "string" } },
    language:           { type: "string", enum: ["zh-TW", "en"] },
  },
  required: ["language"],
  additionalProperties: false,
};

/**
 * Step 1: LLM extracts structured params from the customer's free-form request.
 */
export async function extractQuoteParams(rawRequest: string): Promise<ExtractedQuoteParams> {
  const systemPrompt = `You are a travel agency intake assistant. Extract structured trip parameters from the customer's free-form request.

Rules:
- Return ONLY valid JSON matching the schema; no narrative.
- Numbers must be numeric (e.g. days=5, NOT "5 days").
- If the customer mentions "我們三個人去玩 5 天" → adults=3 by default unless ages given.
- "兒童" / "kid" / "child" with age 2-11 = children; under 2 = infants.
- Budget like "$5K USD" → budgetMax=5000, currency="USD"; "預算 NT$80000 內" → budgetMax=80000, currency="TWD".
- Dates: "5 月去" → departureMonth="2026-05" (assume current/next year), "暑假" → departureMonth="2026-07", "彈性" → departureFlexible=true.
- Detect language from input: zh-TW for any traditional Chinese; en otherwise.
- If a field is not mentioned, OMIT it (don't fill defaults).`;

  const userPrompt = `Customer request:
${rawRequest.slice(0, 2000)}

Extract trip parameters as JSON.`;

  const response = await invokeLLM({
    model: "claude-haiku-4-5-20251001",
    maxTokens: 512,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "trip_intent",
        strict: true,
        schema: EXTRACTION_SCHEMA,
      },
    },
  });

  const content = response?.choices?.[0]?.message?.content;
  if (!content) return { language: "zh-TW" };
  try {
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    return parsed as ExtractedQuoteParams;
  } catch {
    return { language: "zh-TW" };
  }
}

/**
 * Step 2: Search the tour catalog for matches against the extracted params.
 * Returns up to 5 best-fit tours, ranked by simple relevance heuristics.
 */
export async function matchToursForQuote(params: ExtractedQuoteParams) {
  const db = await getDb();
  if (!db) return [];

  const conditions: any[] = [eq(tours.status, "active" as any)];

  // Destination match (LIKE on country or city)
  if (params.destinationCountry) {
    conditions.push(
      or(
        like(tours.destinationCountry, `%${params.destinationCountry}%`),
        like(tours.title, `%${params.destinationCountry}%`)
      )!
    );
  } else if (params.destinationCity) {
    conditions.push(
      or(
        like(tours.destinationCity, `%${params.destinationCity}%`),
        like(tours.title, `%${params.destinationCity}%`)
      )!
    );
  }

  // Duration ±2 days
  if (params.days && params.days > 0) {
    conditions.push(gte(tours.duration, Math.max(1, params.days - 2)));
    conditions.push(lte(tours.duration, params.days + 2));
  }

  // Budget ceiling (rough — server checks departure-specific prices later)
  if (params.budgetMax && params.budgetMax > 0) {
    const totalPax = (params.adults || 1) + (params.children || 0);
    const perPaxBudget = Math.ceil(params.budgetMax / Math.max(1, totalPax));
    // Allow 20% over-budget for borderline matches
    conditions.push(lte(tours.price, Math.ceil(perPaxBudget * 1.2)));
  }

  const results = await db
    .select()
    .from(tours)
    .where(and(...conditions))
    .orderBy(desc(tours.featured), desc(tours.originalityScore), tours.price)
    .limit(5);

  return results;
}

/**
 * Step 3: Build a polished HTML quote.
 *
 * v78f: returns BOTH the raw HTML (always) and an R2 URL if the upload
 * succeeded. Callers persist `html` in `aiQuotes.pdfHtml` and use the URL
 * if present, otherwise fall back to `/api/aiQuotes/:id/view`.
 *
 * Why this changed: R2 bucket misconfigured in production → every
 * `storagePut` returned AccessDenied. Inline-storage gives us a working
 * quote system today; we still try R2 so a future bucket fix benefits
 * cache-friendly delivery.
 */
export async function buildQuotePdf(opts: {
  quoteNumber: string;
  rawRequest: string;
  params: ExtractedQuoteParams;
  tours: any[];
  customerName?: string;
  customerEmail?: string;
  validUntil: Date;
}): Promise<{ html: string; r2Url: string | null }> {
  const { quoteNumber, rawRequest, params, tours: matched, customerName, customerEmail, validUntil } = opts;
  const isEN = params.language === "en";

  const greeting = isEN
    ? `Dear ${customerName || "Traveler"},`
    : `親愛的 ${customerName || "旅客"} 您好，`;

  const intro = isEN
    ? `Thank you for your inquiry. Based on your request, we have prepared the following tour recommendations for your consideration:`
    : `感謝您的詢問！根據您的需求，我們為您精選以下行程建議供參考：`;

  const tourCards = matched
    .map(
      (t, i) => `
    <div style="border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 16px; background: #fafafa;">
      <h3 style="margin: 0 0 8px 0; color: #111827; font-size: 18px;">${i + 1}. ${escapeHtml(t.title)}</h3>
      <p style="margin: 4px 0; color: #6b7280; font-size: 14px;">
        <strong>${isEN ? "Location" : "目的地"}:</strong> ${escapeHtml(t.destinationCity || t.destinationCountry || "—")}
        &nbsp;&middot;&nbsp;
        <strong>${isEN ? "Duration" : "天數"}:</strong> ${t.duration} ${isEN ? "days" : "天"}
        &nbsp;&middot;&nbsp;
        <strong>${isEN ? "Price" : "團費"}:</strong> ${formatCurrency(t.price, t.priceCurrency || params.currency || "USD")}/${isEN ? "person" : "人"}
      </p>
      ${t.heroSubtitle ? `<p style="margin: 8px 0; color: #374151; font-style: italic;">${escapeHtml(t.heroSubtitle)}</p>` : ""}
      <p style="margin: 8px 0 0 0; color: #6b7280; font-size: 13px;">
        <a href="https://packgo-travel.fly.dev/tour/${t.id}" style="color: #0d9488; text-decoration: none;">${isEN ? "View full itinerary →" : "查看完整行程 →"}</a>
      </p>
    </div>`
    )
    .join("");

  const totalPax = (params.adults || 1) + (params.children || 0) + (params.infants || 0);
  const estimateNote = matched.length > 0 && params.adults
    ? (isEN
        ? `Estimated total for ${totalPax} traveler${totalPax > 1 ? "s" : ""}: starting from ${formatCurrency(matched[0].price * totalPax, matched[0].priceCurrency || params.currency || "USD")}`
        : `${totalPax} 位旅客估算總額：${formatCurrency(matched[0].price * totalPax, matched[0].priceCurrency || params.currency || "USD")} 起`)
    : "";

  const html = `<!DOCTYPE html><html lang="${isEN ? "en" : "zh-TW"}"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Quote ${quoteNumber} — Pack & Go</title>
<style>
  body { font-family: -apple-system, "PingFang TC", "Microsoft JhengHei", Arial, sans-serif; max-width: 720px; margin: 0 auto; padding: 32px 24px; color: #111827; }
  .header { text-align: center; padding-bottom: 24px; border-bottom: 2px solid #0d9488; margin-bottom: 24px; }
  .quote-number { color: #0d9488; font-weight: 600; letter-spacing: 0.05em; }
  h1 { font-size: 24px; margin: 12px 0; }
  h2 { font-size: 18px; margin-top: 24px; color: #374151; }
  .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; line-height: 1.7; }
  @media print { body { padding: 16px; } }
</style></head><body>
<div class="header">
  <p class="quote-number">${isEN ? "TOUR RECOMMENDATION" : "行程建議單"} · ${quoteNumber}</p>
  <h1>Pack & Go ${isEN ? "Travel" : "旅行社"}</h1>
  <p style="margin: 0; color: #6b7280; font-size: 13px;">CST #2166984 · 39055 Cedar Blvd #126, Newark, CA 94560 · +1 (510) 634-2307</p>
</div>

<p>${greeting}</p>
<p>${intro}</p>

<h2>${isEN ? "Your Request" : "您的需求"}</h2>
<div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 12px 0; font-size: 14px; color: #374151; white-space: pre-wrap;">${escapeHtml(rawRequest)}</div>

<h2>${isEN ? "Recommended Tours" : "推薦行程"}</h2>
${tourCards || `<p style="color:#6b7280;">${isEN ? "No exact matches found — we'll prepare a custom itinerary for you and follow up by email/phone." : "目前沒有完全符合的現成行程，我們會為您客製化規劃並於 1 個工作日內以 email 或電話與您聯繫。"}</p>`}

${estimateNote ? `<p style="margin-top: 16px; padding: 12px 16px; background: #ecfdf5; border-left: 4px solid #10b981; font-size: 14px; color: #064e3b;">${estimateNote}</p>` : ""}

<h2>${isEN ? "Next Step" : "下一步"}</h2>
<p>${isEN ? "Reply to this email or call us at +1 (510) 634-2307 to confirm your selection. Quotation valid until" : "回覆此 email 或致電 +1 (510) 634-2307 確認您的選擇。報價有效期至"} <strong>${validUntil.toLocaleDateString(isEN ? "en-US" : "zh-TW")}</strong>.</p>

<div class="footer">
  <p><strong>Pack & Go, LLC</strong> · California Seller of Travel #2166984 · TCRF Participant</p>
  <p>${isEN
    ? "Registration as a seller of travel does not constitute approval by the State of California. Estimates above are based on lowest available departure prices and are subject to availability and change until booking is confirmed with deposit."
    : "旅遊業者登記不代表加州政府之背書。本建議單之價格為目前系統參考價，非正式報價。最終費用依實際選擇之出發日及供應商確認為準，需繳訂金後始確認。"}</p>
</div>
</body></html>`;

  // Try R2 upload as a nice-to-have. If it fails (e.g. bucket missing),
  // we still return the HTML so the caller can persist it inline.
  let r2Url: string | null = null;
  try {
    const key = `pdf-uploads/quote-${quoteNumber}-${Date.now()}.html`;
    const result = await storagePut(key, Buffer.from(html, "utf-8"), "text/html");
    r2Url = result?.url || null;
  } catch (err: any) {
    console.warn(
      `[aiQuoteService] R2 upload skipped (${err?.name || "error"}: ${err?.message?.slice(0, 80) || ""}). Quote will be served via /api/aiQuotes/:id/view.`
    );
  }

  return { html, r2Url };
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCurrency(amount: number, currency: string): string {
  if (!amount) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

/**
 * v78: generate sequential quote number QUOTE-YYYY-NNNN
 */
export async function generateQuoteNumber(): Promise<string> {
  const db = await getDb();
  if (!db) return `QUOTE-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
  const year = new Date().getFullYear();
  const yearStart = new Date(year, 0, 1);
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(aiQuotes)
    .where(gte(aiQuotes.createdAt, yearStart));
  const count = Number(result[0]?.count || 0) + 1;
  return `QUOTE-${year}-${String(count).padStart(4, "0")}`;
}
