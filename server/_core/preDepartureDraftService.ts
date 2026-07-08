/**
 * preDepartureDraftService — batch 6 m3: LLM-drafted pre-departure messages.
 *
 * Pure function: reads departure + bookings + participants + tour, invokes LLM
 * per customer, stores drafts. Idempotent (skips if drafts already exist for
 * this departure). Jeff reviews each one individually before sending.
 */
import { invokeLLM } from "./llm";
import { createChildLogger } from "./logger";
import { reportFunnelError } from "./errorFunnel";
import * as db from "../db";
import { eq, and } from "drizzle-orm";

const log = createChildLogger({ module: "pre-departure-draft" });

export async function generatePreDepartureMessages(departureId: number) {
  const drizzleDb = (await db.getDb())!;
  const { preDepartureNotifications, bookings: bookingsTable } =
    await import("../../drizzle/schema");

  const existing = await drizzleDb
    .select({ id: preDepartureNotifications.id })
    .from(preDepartureNotifications)
    .where(eq(preDepartureNotifications.departureId, departureId))
    .limit(1);

  if (existing.length > 0) {
    log.info({ departureId }, "drafts already exist, skipping generation");
    return { created: 0, skipped: true };
  }

  const departure = await db.getDepartureById(departureId);
  if (!departure) throw new Error(`Departure ${departureId} not found`);

  const tour = departure.tourId
    ? await db.getTourById(departure.tourId)
    : undefined;

  const activeBookings = await db.getActiveBookingsByDepartureId(departureId);
  if (activeBookings.length === 0) {
    log.info({ departureId }, "no active bookings, nothing to draft");
    return { created: 0, skipped: false };
  }

  const daysUntil = Math.ceil(
    (new Date(departure.departureDate).getTime() - Date.now()) / 86_400_000,
  );

  let created = 0;

  for (const booking of activeBookings) {
    const participants = await db.getBookingParticipants(booking.id);
    const participantNames = participants
      .map((p) => `${p.lastName ?? ""} ${p.firstName ?? ""}`.trim())
      .filter(Boolean);

    const lang = booking.customerLanguage === "en" ? "English" : "Traditional Chinese";
    const prompt = buildPrompt({
      tourTitle: tour?.title ?? "Tour",
      departureDate: new Date(departure.departureDate).toLocaleDateString(),
      returnDate: departure.returnDate
        ? new Date(departure.returnDate).toLocaleDateString()
        : null,
      daysUntil,
      customerName: booking.customerName,
      participantNames,
      language: lang,
    });

    try {
      const result = await invokeLLM({
        messages: [{ role: "user", content: prompt }],
        maxTokens: 800,
        model: "claude-haiku-4-5-20251001",
      });

      const raw = result.choices?.[0]?.message?.content;
      const content = (typeof raw === "string" ? raw : "").trim();
      if (!content) {
        log.warn({ bookingId: booking.id }, "LLM returned empty content");
        continue;
      }

      const subjectMatch = content.match(/^Subject:\s*(.+)/m);
      const subject = subjectMatch?.[1]?.trim() ?? "";
      const body = content.replace(/^Subject:\s*.+\n*/m, "").trim();

      await drizzleDb.insert(preDepartureNotifications).values({
        departureId,
        bookingId: booking.id,
        userId: booking.userId,
        recipientName: booking.customerName,
        recipientEmail: booking.customerEmail,
        subject,
        content: body,
        status: "draft",
      });

      created++;
    } catch (err) {
      log.error({ err, bookingId: booking.id }, "failed to draft message");
      reportFunnelError({ source: "fail-open:preDepartureDraftService:draftMessage", err, context: { departureId, bookingId: booking.id } }).catch(() => {});
    }
  }

  log.info({ departureId, created }, "pre-departure drafts generated");
  return { created, skipped: false };
}

function buildPrompt(ctx: {
  tourTitle: string;
  departureDate: string;
  returnDate: string | null;
  daysUntil: number;
  customerName: string;
  participantNames: string[];
  language: string;
}) {
  return `You are writing a pre-departure reminder email for a travel agency (PACK&GO).

Tour: ${ctx.tourTitle}
Departure: ${ctx.departureDate}${ctx.returnDate ? ` — Return: ${ctx.returnDate}` : ""}
Days until departure: ${ctx.daysUntil}
Customer: ${ctx.customerName}
Travelers: ${ctx.participantNames.join(", ") || ctx.customerName}
Language: ${ctx.language}

Write a warm, concise pre-departure email. Include:
1. Greeting by name
2. Trip countdown and excitement
3. Practical reminders (passport validity, packing, weather, airport logistics)
4. If balance might be unpaid, a gentle reminder
5. Contact info: reply to this email or call us

Format:
- First line: "Subject: <email subject line>"
- Then the email body (plain text, no HTML)
- Keep it under 200 words
- Tone: friendly, professional, not overly formal
- Write entirely in ${ctx.language}`;
}
