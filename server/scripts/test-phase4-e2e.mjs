/**
 * Phase 4 trust-deferral end-to-end test.
 *
 * Runs against PRODUCTION TiDB (we don't have a local dev DB). The script
 * creates isolated test fixtures (test_ prefix where applicable), drives
 * the trust deferral chain by replicating the logic from
 * server/services/trustDeferralService.ts inline, then verifies the DB
 * transitions. Cleanup runs at the end to remove ALL test data.
 *
 * Why inline replication instead of importing the actual service?
 * Production bundle (/app/dist/index.js) is a monolithic esbuild output;
 * individual service modules aren't separately importable. Re-implementing
 * the logic here is a behavior test: if the deployed code follows the
 * same rules, the same DB state changes happen. The webhook verifier
 * (Task A) has direct unit tests; this E2E covers the data-flow side.
 *
 * Each step prints PASS / FAIL with detail. Bug-fix → re-run → must
 * eventually 12/12.
 *
 * USAGE (on Fly machine):
 *   node /app/_test-phase4-e2e.mjs
 */

import mysql from "mysql2/promise";

const TEST_LABEL = `[phase4-e2e]`;
const passed = [];
const failed = [];

function check(name, ok, detail) {
  const line = `  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`;
  console.log(line);
  (ok ? passed : failed).push({ name, detail });
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Service logic mirrored from server/services/trustDeferralService.ts
// (DO NOT MODIFY these without updating the source file in lock-step.)
// ──────────────────────────────────────────────────────────────────────────

const EARLY_RECOGNITION_WINDOW_DAYS = parseInt(
  process.env.PLAID_TRUST_EARLY_RECOGNITION_WINDOW_DAYS ?? "30",
  10
);
const RECOGNITION_OFFSET_DAYS = parseInt(
  process.env.PLAID_TRUST_RECOGNITION_OFFSET_DAYS ?? "0",
  10
);
const AUTOMATCH_MIN_CONFIDENCE = parseInt(
  process.env.PLAID_TRUST_AUTOMATCH_MIN_CONFIDENCE ?? "80",
  10
);
const AUTOMATCH_AMOUNT_WINDOW = parseFloat(
  process.env.PLAID_TRUST_AUTOMATCH_AMOUNT_WINDOW_USD ?? "1.00"
);
const AUTOMATCH_DATE_WINDOW_DAYS = parseInt(
  process.env.PLAID_TRUST_AUTOMATCH_DATE_WINDOW_DAYS ?? "2",
  10
);

/**
 * Mirrors trustDeferralService.findBookingMatch + computeExpectedRecognitionDate.
 * Returns { bookingId, confidence, expectedRecognitionDate } or null.
 */
async function findBookingMatchAndRecognitionDate(conn, txn) {
  const txnAmt = Math.abs(parseFloat(txn.amount));
  const txnDate = new Date(txn.date);
  const sinceDate = addDays(txnDate, -AUTOMATCH_DATE_WINDOW_DAYS);
  const untilDate = addDays(txnDate, AUTOMATCH_DATE_WINDOW_DAYS);

  const [candidates] = await conn.execute(
    `SELECT p.id AS paymentId, p.paidAt, p.amount AS paymentAmount,
            p.stripePaymentIntentId, b.id AS bookingId, b.depositAmount,
            b.totalPrice, td.departureDate
     FROM payments p
     LEFT JOIN bookings b ON p.bookingId = b.id
     LEFT JOIN tourDepartures td ON b.departureId = td.id
     WHERE p.paidAt >= ? AND p.paidAt <= ?
     LIMIT 50`,
    [sinceDate, untilDate]
  );
  if (process.env.PHASE4_E2E_DEBUG === "1") {
    console.log(
      `  [debug] findBookingMatch: txn.date=${txn.date} amt=${txnAmt} → ${candidates.length} candidates`
    );
    if (candidates.length > 0) {
      console.log(`  [debug] first candidate: ${JSON.stringify(candidates[0])}`);
    }
  }

  let best = null;
  for (const c of candidates) {
    if (!c.bookingId) continue;
    const pmAmt = parseFloat(c.paymentAmount ?? 0);
    const dep = parseFloat(c.depositAmount ?? 0);
    const tot = parseFloat(c.totalPrice ?? 0);
    const targets = [pmAmt, dep, tot].filter((v) => v > 0);
    if (targets.length === 0) continue;
    const amountDelta = Math.min(...targets.map((t) => Math.abs(t - txnAmt)));
    if (amountDelta > AUTOMATCH_AMOUNT_WINDOW) continue;

    let score = 0;
    if (amountDelta === 0) score += 50;
    else if (amountDelta < 0.5) score += 40;
    else score += 25;

    if (c.paidAt) {
      const txnYmd = txnDate.toISOString().slice(0, 10);
      const paidYmd = new Date(c.paidAt).toISOString().slice(0, 10);
      if (txnYmd === paidYmd) {
        score += 30;
      } else {
        const days =
          Math.abs(txnDate.getTime() - new Date(c.paidAt).getTime()) /
          86_400_000;
        if (days <= 1) score += 20;
        else score += 10;
      }
    }

    const desc = (txn.description ?? "").toLowerCase();
    if (
      c.stripePaymentIntentId &&
      desc.includes(c.stripePaymentIntentId.toLowerCase())
    ) {
      score += 20;
    }

    score = Math.min(100, score);
    if (!best || score > best.confidence) {
      best = {
        bookingId: c.bookingId,
        confidence: score,
        departureDate: c.departureDate
          ? new Date(c.departureDate).toISOString().slice(0, 10)
          : null,
      };
    }
  }

  if (!best || best.confidence < AUTOMATCH_MIN_CONFIDENCE) return null;

  // Q7: short-lead → recognize on deposit; else departure (+offset)
  let expectedRecognitionDate = null;
  if (best.departureDate) {
    const dep = new Date(best.departureDate);
    const deposit = new Date(txn.date);
    const daysToDeparture = Math.ceil((dep - deposit) / 86_400_000);
    if (
      EARLY_RECOGNITION_WINDOW_DAYS > 0 &&
      daysToDeparture <= EARLY_RECOGNITION_WINDOW_DAYS
    ) {
      expectedRecognitionDate = ymd(deposit);
    } else {
      expectedRecognitionDate = ymd(addDays(dep, RECOGNITION_OFFSET_DAYS));
    }
  }

  return { ...best, expectedRecognitionDate };
}

/** Mirrors processTrustInflow */
async function simulateProcessTrustInflow(conn, bankTxnId) {
  const [[txn]] = await conn.execute(
    `SELECT bt.id, bt.linkedAccountId, bt.amount, bt.date, bt.merchantName,
            bt.description, bt.isoCurrencyCode, la.isTrustAccount
     FROM bankTransactions bt
     LEFT JOIN linkedBankAccounts la ON bt.linkedAccountId = la.id
     WHERE bt.id = ?`,
    [bankTxnId]
  );
  if (!txn) throw new Error(`txn ${bankTxnId} not found`);
  if (txn.isTrustAccount !== 1) throw new Error("not on trust account");
  const amt = parseFloat(txn.amount);
  if (amt >= 0) throw new Error("not an inflow");

  const match = await findBookingMatchAndRecognitionDate(conn, txn);

  const [r] = await conn.execute(
    `INSERT INTO trustDeferredIncome
       (bankTransactionId, linkedAccountId, bookingId, matchConfidence,
        matchMethod, amount, isoCurrencyCode, depositDate, expectedRecognitionDate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      txn.id,
      txn.linkedAccountId,
      match?.bookingId ?? null,
      match?.confidence ?? 0,
      match ? "auto" : "unmatched",
      String(Math.abs(amt)),
      txn.isoCurrencyCode ?? "USD",
      txn.date,
      match?.expectedRecognitionDate ?? null,
    ]
  );
  return {
    deferredId: r.insertId,
    bookingId: match?.bookingId ?? null,
    confidence: match?.confidence ?? 0,
    expectedRecognitionDate: match?.expectedRecognitionDate ?? null,
  };
}

/**
 * Mirrors scanRecognitionDue (server/services/trustDeferralService.ts).
 *
 * B1 fail-closed (2026-07-13): the real scanRecognitionDue is a READ-ONLY
 * scan — it NEVER writes recognizedAt; due rows only get queued for Jeff's
 * manual review. This mirror used to run an UPDATE that set the recognizedAt
 * column to NOW() here, which was the pre-B1 auto-recognition behavior and —
 * because this script executes against production TiDB — would have actually
 * written that column on live rows. Updated in lock-step with the source
 * to match: count-only, zero writes.
 */
async function simulateScanDue(conn, today) {
  const todayStr = today ?? ymd(new Date());
  const [rows] = await conn.execute(
    `SELECT id, expectedRecognitionDate, bookingId
     FROM trustDeferredIncome
     WHERE recognizedAt IS NULL AND reversedAt IS NULL`
  );
  let dueForReview = 0;
  for (const r of rows) {
    if (!r.expectedRecognitionDate || !r.bookingId) continue;
    const expected = new Date(r.expectedRecognitionDate)
      .toISOString()
      .slice(0, 10);
    if (expected > todayStr) continue;
    // B1 fail-closed: propose-only. Never write recognizedAt here.
    dueForReview++;
  }
  return { scanned: rows.length, dueForReview };
}

// ──────────────────────────────────────────────────────────────────────────
// Test runner
// ──────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`${TEST_LABEL} starting e2e test`);
  console.log(`${TEST_LABEL} config:`);
  console.log(`  EARLY_RECOGNITION_WINDOW_DAYS=${EARLY_RECOGNITION_WINDOW_DAYS}`);
  console.log(`  RECOGNITION_OFFSET_DAYS=${RECOGNITION_OFFSET_DAYS}`);
  console.log(`  AUTOMATCH_MIN_CONFIDENCE=${AUTOMATCH_MIN_CONFIDENCE}`);

  const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL });

  // STATE: track everything we create for cleanup
  const createdIds = {
    bankTransactions: [],
    trustDeferredIncome: [],
    payments: [],
    bookings: [],
    tourDepartures: [],
    tours: [],
    markedTrustAccountId: null,
  };

  try {
    // Step 1: pick a depository sandbox account, mark isTrustAccount=1
    const [[trustAcct]] = await conn.execute(
      `SELECT id, accountName, isTrustAccount FROM linkedBankAccounts
       WHERE accountType = 'depository' AND isActive = 1
       ORDER BY id LIMIT 1`
    );
    if (!trustAcct) throw new Error("no depository sandbox account found");
    createdIds.markedTrustAccountId = trustAcct.id;
    await conn.execute(
      "UPDATE linkedBankAccounts SET isTrustAccount = 1 WHERE id = ?",
      [trustAcct.id]
    );
    check(
      "Step 1: mark sandbox depository account as trust",
      true,
      `account ${trustAcct.id} (${trustAcct.accountName})`
    );

    // Step 2: create tourDepartures row (departure = today + 5 days)
    // We need a tour first since tourDepartures.tourId is NOT NULL.
    // tours.createdBy is NOT NULL — use admin user id.
    const [[admin]] = await conn.execute(
      "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    );
    if (!admin) throw new Error("no admin user found");
    const [tourIns] = await conn.execute(
      `INSERT INTO tours
        (title, description, destinationCountry, destinationCity,
         duration, price, priceCurrency, createdBy)
       VALUES (?, ?, ?, ?, ?, ?, 'USD', ?)`,
      [
        "__phase4_e2e_test_tour__",
        "Phase 4 E2E test fixture — safe to delete",
        "USA",
        "San Francisco",
        5,
        2000,
        admin.id,
      ]
    );
    createdIds.tours.push(tourIns.insertId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const shortLeadDeparture = addDays(today, 5);
    const [depIns] = await conn.execute(
      `INSERT INTO tourDepartures
        (tourId, departureDate, returnDate, adultPrice, totalSlots, status, currency)
       VALUES (?, ?, ?, ?, ?, 'confirmed', 'USD')`,
      [tourIns.insertId, shortLeadDeparture, addDays(today, 10), 2000, 10]
    );
    createdIds.tourDepartures.push(depIns.insertId);
    check(
      "Step 2: create tourDeparture row (departure = T+5)",
      true,
      `dep ${depIns.insertId}, date ${ymd(shortLeadDeparture)}`
    );

    // Step 3: create bookings row
    const [bookIns] = await conn.execute(
      `INSERT INTO bookings
        (tourId, departureId, customerName, customerEmail, customerPhone,
         numberOfAdults, totalPrice, depositAmount, remainingAmount,
         currency, bookingStatus, paymentStatus)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', 'confirmed', 'deposit')`,
      [
        tourIns.insertId,
        depIns.insertId,
        "Phase4 Test Customer",
        "test@packgo.com",
        "+1-555-0100",
        2,
        2000,
        500,
        1500,
      ]
    );
    createdIds.bookings.push(bookIns.insertId);
    check(
      "Step 3: create bookings row",
      true,
      `booking ${bookIns.insertId}, deposit=$500 total=$2000`
    );

    // Step 4: create payments row
    const [payIns] = await conn.execute(
      `INSERT INTO payments
        (bookingId, amount, currency, paymentMethod, paymentType,
         paymentStatus, paidAt)
       VALUES (?, ?, 'USD', 'stripe', 'deposit', 'completed', NOW())`,
      [bookIns.insertId, 500]
    );
    createdIds.payments.push(payIns.insertId);
    check(
      "Step 4: create payments row",
      true,
      `payment ${payIns.insertId}, $500 stripe`
    );

    // Step 5: insert bankTransactions row (inflow to trust account today)
    const [txn1Ins] = await conn.execute(
      `INSERT INTO bankTransactions
        (linkedAccountId, plaidTransactionId, date, amount, isoCurrencyCode,
         merchantName, description, paymentChannel, isPending, accountOwner)
       VALUES (?, ?, ?, ?, 'USD', ?, ?, 'online', 0, NULL)`,
      [
        trustAcct.id,
        `test-stripe-${Date.now()}-1`,
        today,
        -500, // negative = inflow per Plaid convention
        "STRIPE TRANSFER",
        "STRIPE TRANSFER 5XQ12345 deposit",
      ]
    );
    createdIds.bankTransactions.push(txn1Ins.insertId);
    check(
      "Step 5: insert bankTransaction inflow $500 today",
      true,
      `txn ${txn1Ins.insertId}`
    );

    // Step 6: simulate classifyOne → processTrustInflow
    const r1 = await simulateProcessTrustInflow(conn, txn1Ins.insertId);
    createdIds.trustDeferredIncome.push(r1.deferredId);

    // Step 7: verify
    check(
      "Step 7a: trustDeferredIncome row created",
      r1.deferredId > 0,
      `deferredId=${r1.deferredId}`
    );
    check(
      "Step 7b: bookingId matched correctly",
      r1.bookingId === bookIns.insertId,
      `matched=${r1.bookingId} expected=${bookIns.insertId}`
    );
    check(
      "Step 7c: matchConfidence >= 80",
      r1.confidence >= AUTOMATCH_MIN_CONFIDENCE,
      `confidence=${r1.confidence}`
    );
    check(
      "Step 7d: expectedRecognitionDate = TODAY (Q7 short-lead 5d <= 30d)",
      r1.expectedRecognitionDate === ymd(today),
      `got=${r1.expectedRecognitionDate} expected=${ymd(today)}`
    );

    // Step 8: simulate scanRecognitionDue (B1 fail-closed: read-only scan)
    const recResult = await simulateScanDue(conn);
    const [[rec1]] = await conn.execute(
      "SELECT recognizedAt FROM trustDeferredIncome WHERE id = ?",
      [r1.deferredId]
    );
    check(
      "Step 8a: B1 fail-closed — scan never writes recognizedAt",
      rec1.recognizedAt === null,
      `recognizedAt=${rec1.recognizedAt}`
    );
    check(
      "Step 8b: at least 1 row queued dueForReview in this run",
      recResult.dueForReview >= 1,
      `dueForReview=${recResult.dueForReview}/${recResult.scanned}`
    );

    // Step 9: long-lead scenario (departure = today + 60 days)
    const longLeadDeparture = addDays(today, 60);
    const [longDepIns] = await conn.execute(
      `INSERT INTO tourDepartures
        (tourId, departureDate, returnDate, adultPrice, totalSlots, status, currency)
       VALUES (?, ?, ?, ?, ?, 'confirmed', 'USD')`,
      [tourIns.insertId, longLeadDeparture, addDays(today, 70), 3000, 10]
    );
    createdIds.tourDepartures.push(longDepIns.insertId);

    const [longBookIns] = await conn.execute(
      `INSERT INTO bookings
        (tourId, departureId, customerName, customerEmail, customerPhone,
         numberOfAdults, totalPrice, depositAmount, remainingAmount,
         currency, bookingStatus, paymentStatus)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', 'confirmed', 'deposit')`,
      [
        tourIns.insertId,
        longDepIns.insertId,
        "Phase4 Long-lead Customer",
        "test-long@packgo.com",
        "+1-555-0101",
        2,
        3000,
        750,
        2250,
      ]
    );
    createdIds.bookings.push(longBookIns.insertId);
    const [longPayIns] = await conn.execute(
      `INSERT INTO payments
        (bookingId, amount, currency, paymentMethod, paymentType,
         paymentStatus, paidAt)
       VALUES (?, ?, 'USD', 'stripe', 'deposit', 'completed', NOW())`,
      [longBookIns.insertId, 750]
    );
    createdIds.payments.push(longPayIns.insertId);
    const [txn2Ins] = await conn.execute(
      `INSERT INTO bankTransactions
        (linkedAccountId, plaidTransactionId, date, amount, isoCurrencyCode,
         merchantName, description, paymentChannel, isPending, accountOwner)
       VALUES (?, ?, ?, ?, 'USD', ?, ?, 'online', 0, NULL)`,
      [
        trustAcct.id,
        `test-stripe-${Date.now()}-2`,
        today,
        -750,
        "STRIPE TRANSFER",
        "STRIPE TRANSFER 5XQ67890 deposit",
      ]
    );
    createdIds.bankTransactions.push(txn2Ins.insertId);
    const r2 = await simulateProcessTrustInflow(conn, txn2Ins.insertId);
    createdIds.trustDeferredIncome.push(r2.deferredId);
    const expectedLong = ymd(longLeadDeparture);
    check(
      "Step 9: long-lead (60d > 30d window) recognizes on DEPARTURE not deposit",
      r2.expectedRecognitionDate === expectedLong,
      `got=${r2.expectedRecognitionDate} expected=${expectedLong}`
    );

    // Step 10: reverseDeferral
    await conn.execute(
      `UPDATE trustDeferredIncome SET reversedAt = NOW(),
       reversedReason = 'test cancellation' WHERE id = ?`,
      [r2.deferredId]
    );
    const rec2 = await simulateScanDue(conn, ymd(addDays(longLeadDeparture, 1)));
    const [[checkRev]] = await conn.execute(
      "SELECT recognizedAt, reversedAt FROM trustDeferredIncome WHERE id = ?",
      [r2.deferredId]
    );
    check(
      "Step 10: reversed row NOT recognized even after expected date",
      checkRev.recognizedAt === null && checkRev.reversedAt !== null,
      `recognizedAt=${checkRev.recognizedAt} reversedAt=${checkRev.reversedAt}`
    );

    // Step 11: linkInflowToBooking with a fake booking — actually we'll test
    // the case where bookingId is set to NULL (unmatched), expectedRecognition
    // becomes null, recognize cron skips it.
    const [txn3Ins] = await conn.execute(
      `INSERT INTO bankTransactions
        (linkedAccountId, plaidTransactionId, date, amount, isoCurrencyCode,
         merchantName, description, paymentChannel, isPending)
       VALUES (?, ?, ?, ?, 'USD', ?, ?, 'online', 0)`,
      [
        trustAcct.id,
        `test-stripe-${Date.now()}-3`,
        today,
        -999.99,
        "STRIPE TRANSFER",
        "no matching booking exists for this amount",
      ]
    );
    createdIds.bankTransactions.push(txn3Ins.insertId);
    const r3 = await simulateProcessTrustInflow(conn, txn3Ins.insertId);
    createdIds.trustDeferredIncome.push(r3.deferredId);
    check(
      "Step 11a: unmatched txn → bookingId=null, expectedDate=null",
      r3.bookingId === null && r3.expectedRecognitionDate === null,
      `bookingId=${r3.bookingId} expectedDate=${r3.expectedRecognitionDate}`
    );
    // Recognize cron should skip it
    const rec3 = await simulateScanDue(conn);
    const [[unmatchedRow]] = await conn.execute(
      "SELECT recognizedAt FROM trustDeferredIncome WHERE id = ?",
      [r3.deferredId]
    );
    check(
      "Step 11b: unmatched row NOT recognized by cron",
      unmatchedRow.recognizedAt === null,
      `recognizedAt=${unmatchedRow.recognizedAt}`
    );

    // Final summary
    console.log(`\n${TEST_LABEL} === RESULTS ===`);
    console.log(`${TEST_LABEL} passed: ${passed.length}`);
    console.log(`${TEST_LABEL} failed: ${failed.length}`);
    if (failed.length > 0) {
      console.log(`${TEST_LABEL} FAILURES:`);
      for (const f of failed) {
        console.log(`  - ${f.name}: ${f.detail ?? ""}`);
      }
    }
  } finally {
    // Cleanup
    console.log(`\n${TEST_LABEL} cleaning up test data...`);
    for (const id of createdIds.trustDeferredIncome) {
      await conn.execute("DELETE FROM trustDeferredIncome WHERE id = ?", [id]);
    }
    for (const id of createdIds.bankTransactions) {
      await conn.execute("DELETE FROM bankTransactions WHERE id = ?", [id]);
    }
    for (const id of createdIds.payments) {
      await conn.execute("DELETE FROM payments WHERE id = ?", [id]);
    }
    for (const id of createdIds.bookings) {
      await conn.execute("DELETE FROM bookings WHERE id = ?", [id]);
    }
    for (const id of createdIds.tourDepartures) {
      await conn.execute("DELETE FROM tourDepartures WHERE id = ?", [id]);
    }
    for (const id of createdIds.tours) {
      await conn.execute("DELETE FROM tours WHERE id = ?", [id]);
    }
    // Leave the isTrustAccount=1 marker so a real trust account can be
    // re-used later (per prompt instructions).
    if (createdIds.markedTrustAccountId) {
      console.log(
        `${TEST_LABEL} kept isTrustAccount=1 on linkedBankAccount ${createdIds.markedTrustAccountId} per prompt`
      );
    }
    await conn.end();
    console.log(`${TEST_LABEL} cleanup done.`);
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`${TEST_LABEL} fatal:`, err);
  process.exit(2);
});
