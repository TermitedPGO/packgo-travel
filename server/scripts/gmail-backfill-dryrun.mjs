#!/usr/bin/env node
/**
 * gmail-intake-ledger Task 02(a) — 30-day backfill DRY RUN (READ-ONLY).
 *
 * Lists, for up to two mailboxes, the last 30 days of INBOX messages NOT yet
 * carrying PACKGO_AI_PROCESSED, as a DE-IDENTIFIED metadata report:
 *   { id, threadId, internalDate, fromDomain, alreadyFiled, priority }
 * — no attachment download, no order/booking creation, no email sent, no DB
 * write. Sender is reduced to its DOMAIN only (from 網域級去識別). `priority`
 * flags messages within the last 14 days (the intake生死線 window). Output is
 * written to a JSON file; nothing is ever ingested.
 *
 * SAFETY: this file only DELIVERS code + a mock dry-run test this batch. Hitting
 * the real Gmail API requires Jeff's explicit approval and is run separately:
 *   node --import tsx server/scripts/gmail-backfill-dryrun.mjs --out=report.json
 * `node --check server/scripts/gmail-backfill-dryrun.mjs` validates syntax
 * (tsc does not apply to .mjs). The pure core (buildBackfillReport) is unit
 * tested in gmail-backfill-dryrun.test.ts with a mocked client — no network.
 */
import { fileURLToPath } from "node:url";

const PRIORITY_WINDOW_DAYS = 14;
const BACKFILL_WINDOW_DAYS = 30;

/** Domain-only de-identification: "Alice <a@example.com>" → "example.com". */
export function senderDomain(fromHeader) {
  const s = String(fromHeader || "");
  const m = s.match(/<([^>]+)>/) || s.match(/([^\s]+@[^\s]+)/);
  const email = (m ? m[1] : s).trim().toLowerCase();
  const at = email.lastIndexOf("@");
  return at === -1 ? "(unknown)" : email.slice(at + 1);
}

/**
 * Pure report builder — takes ALREADY-FETCHED metadata + the set of thread ids
 * already present in customerInteractions, returns the de-identified report.
 * No I/O; fully unit-testable.
 *
 * @param {{ messages: Array<{id:string, threadId:string, internalDateMs:number, from:string}>,
 *           knownThreadIds: Set<string>, nowMs: number, priorityDays?: number }} args
 */
export function buildBackfillReport({ messages, knownThreadIds, nowMs, priorityDays = PRIORITY_WINDOW_DAYS }) {
  const priorityCutoff = nowMs - priorityDays * 24 * 60 * 60 * 1000;
  const rows = messages
    .slice()
    .sort((a, b) => b.internalDateMs - a.internalDateMs)
    .map((m) => ({
      id: m.id,
      threadId: m.threadId,
      internalDate: new Date(m.internalDateMs).toISOString(),
      fromDomain: senderDomain(m.from),
      // thread-level "already filed" proxy: metadata carries no RFC822
      // Message-ID, so we match on gmailThreadId presence in customerInteractions.
      alreadyFiled: knownThreadIds.has(m.threadId),
      priority: m.internalDateMs >= priorityCutoff,
    }));
  return {
    total: rows.length,
    priorityCount: rows.filter((r) => r.priority).length,
    alreadyFiledCount: rows.filter((r) => r.alreadyFiled).length,
    notYetFiledCount: rows.filter((r) => !r.alreadyFiled).length,
    rows,
  };
}

/** LIVE main — dynamic-imports the TS runtime; run under tsx WITH APPROVAL. */
async function main() {
  const args = process.argv.slice(2);
  const outArg = args.find((a) => a.startsWith("--out="));
  const outPath = outArg ? outArg.slice("--out=".length) : `gmail-backfill-dryrun-${Date.now()}.json`;
  const maxMailboxes = 2;

  const { getDb } = await import("../db.ts");
  const { gmailIntegration, customerInteractions } = await import("../../drizzle/schema.ts");
  const { and, eq, inArray, isNotNull } = await import("drizzle-orm");
  const { buildGmailClient, listMessageMetadataForQuery } = await import("../_core/gmail.ts");
  const { promises: fs } = await import("node:fs");

  const db = await getDb();
  if (!db) throw new Error("DATABASE_URL unset — cannot run backfill dry-run");
  const integrations = (
    await db.select().from(gmailIntegration).where(eq(gmailIntegration.isActive, 1))
  ).slice(0, maxMailboxes);

  const nowMs = Date.now();
  const report = { generatedAt: new Date(nowMs).toISOString(), windowDays: BACKFILL_WINDOW_DAYS, mailboxes: [] };
  for (const integ of integrations) {
    const gmail = buildGmailClient(integ);
    // metadata-only, ALL pages, no attachment bytes; unprocessed INBOX only.
    const messages = await listMessageMetadataForQuery(
      gmail,
      `newer_than:${BACKFILL_WINDOW_DAYS}d -label:PACKGO_AI_PROCESSED in:inbox`,
      2000,
    );
    const threadIds = [...new Set(messages.map((m) => m.threadId).filter(Boolean))];
    const known = threadIds.length
      ? await db
          .select({ threadId: customerInteractions.gmailThreadId })
          .from(customerInteractions)
          .where(and(isNotNull(customerInteractions.gmailThreadId), inArray(customerInteractions.gmailThreadId, threadIds)))
      : [];
    const knownThreadIds = new Set(known.map((k) => k.threadId));
    report.mailboxes.push({
      // de-identify the mailbox too: domain only.
      mailboxDomain: senderDomain(integ.emailAddress),
      ...buildBackfillReport({ messages, knownThreadIds, nowMs }),
    });
  }
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`[gmail-backfill-dryrun] wrote ${outPath} (READ-ONLY, nothing ingested)`);
}

// Only run main() when executed directly (not when imported by the unit test),
// so importing this file loads nothing but the pure functions above.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error("[gmail-backfill-dryrun] failed:", e);
    process.exit(1);
  });
}
