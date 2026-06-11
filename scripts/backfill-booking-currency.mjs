#!/usr/bin/env node
/**
 * One-shot backfill: fix bookings whose currency column was never persisted
 * (defaulted to "TWD") but should be "USD" based on the departure or tour.
 *
 * Logic (mirrors bookings.create Phase 0.1):
 *   booking.currency should be "USD" when:
 *     - departures.currency = "USD"   (UV supplier departures)
 *     - OR tours.priceCurrency = "USD" (UV tours predating departures.currency)
 *   Otherwise stays "TWD".
 *
 * Dry-run by default — prints what would change. Pass --apply to UPDATE.
 */
import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
const APPLY = process.argv.includes("--apply");

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

async function main() {
  const db = await mysql.createConnection(DATABASE_URL);

  // Find bookings that are TWD but should be USD
  const [rows] = await db.execute(`
    SELECT
      b.id            AS bookingId,
      b.currency      AS currentCurrency,
      b.bookingStatus,
      b.totalPrice,
      d.currency      AS departureCurrency,
      t.priceCurrency AS tourPriceCurrency,
      t.tourName
    FROM bookings b
    LEFT JOIN departures d ON d.id = b.departureId
    LEFT JOIN tours t      ON t.id = b.tourId
    WHERE b.currency = 'TWD'
      AND (d.currency = 'USD' OR t.priceCurrency = 'USD')
    ORDER BY b.id
  `);

  if (rows.length === 0) {
    console.log("✓ No mismatched bookings found. Nothing to do.");
    await db.end();
    return;
  }

  console.log(`Found ${rows.length} booking(s) with wrong currency:\n`);
  for (const r of rows) {
    const flag = r.bookingStatus === "pending" ? " ⚠️  UNPAID" : "";
    console.log(
      `  #${r.bookingId}  status=${r.bookingStatus}  total=${r.totalPrice}  ` +
      `dep.currency=${r.departureCurrency}  tour.priceCurrency=${r.tourPriceCurrency}` +
      `${flag}  "${r.tourName}"`
    );
  }

  if (!APPLY) {
    console.log(
      `\nDry-run complete. Run with --apply to UPDATE these ${rows.length} rows.`
    );
    await db.end();
    return;
  }

  const ids = rows.map((r) => r.bookingId);
  const placeholders = ids.map(() => "?").join(",");
  const [result] = await db.execute(
    `UPDATE bookings SET currency = 'USD' WHERE id IN (${placeholders})`,
    ids
  );

  console.log(`\n✓ Updated ${result.affectedRows} booking(s) to currency = 'USD'.`);

  // Also fix the corresponding payments table rows
  const [payResult] = await db.execute(
    `UPDATE payments SET currency = 'USD'
     WHERE bookingId IN (${placeholders}) AND currency = 'TWD'`,
    ids
  );
  console.log(`✓ Updated ${payResult.affectedRows} payment(s) to currency = 'USD'.`);

  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
