#!/usr/bin/env node
/**
 * gmail-intake-ledger Task 02(b) — classify the 136 messagesFailed (READ-ONLY).
 *
 * HONEST scope note (design + proposal): today the ONLY durable signal for the
 * historic failures is gmailIntegration.messagesFailed — a single monotonic
 * COUNTER with NO per-message breakdown (no date, no error code, no
 * retry-succeeded flag). Application logs are ephemeral (Fly) and not queryable
 * here, so a full mailbox/date/errorCode/retry-success classification is NOT
 * derivable pre-ledger. This tool therefore:
 *   - reports the currently-available dimension: failed COUNT per mailbox, and
 *   - once the ledger has accumulated rows, classifies by failureKind / httpStatus
 *     / day / terminal-vs-retried using real ledger data,
 * and explicitly marks the finer historic dimensions as「需 ledger 上線後累積」
 * rather than fabricating them (做不到完整分類就如實標,不編造).
 *
 * READ-ONLY: no DB writes, no Gmail calls, no email. Deferred live run (with
 * approval): node --import tsx server/scripts/gmail-failed-classify.mjs
 * `node --check` validates syntax; the pure core is unit-tested with mocks.
 */
import { fileURLToPath } from "node:url";

/**
 * Pure classifier. Given per-mailbox failed counters and (optionally) accumulated
 * ledger rows, produce the honest current-state report.
 *
 * @param {{ integrations: Array<{emailAddress:string, messagesFailed:number}>,
 *           ledgerRows?: Array<{status:string, failureKind:string|null, httpStatus:number|null, internalDateMs:number}> }} args
 */
export function classifyFailed({ integrations, ledgerRows = [] }) {
  const perMailbox = integrations.map((i) => ({
    mailboxDomain: senderDomain(i.emailAddress),
    messagesFailed: i.messagesFailed ?? 0,
  }));
  const totalFailedCounter = perMailbox.reduce((s, m) => s + m.messagesFailed, 0);

  const ledgerAvailable = ledgerRows.length > 0;
  const byFailureKind = {};
  const byHttpStatus = {};
  const byDay = {};
  let terminalFailed = 0;
  let retriedThenProcessed = 0;

  for (const r of ledgerRows) {
    if (r.status === "failed") {
      terminalFailed++;
      const kind = r.failureKind || "unknown";
      byFailureKind[kind] = (byFailureKind[kind] || 0) + 1;
      const hs = r.httpStatus == null ? "none" : String(r.httpStatus);
      byHttpStatus[hs] = (byHttpStatus[hs] || 0) + 1;
      const day = new Date(r.internalDateMs || 0).toISOString().slice(0, 10);
      byDay[day] = (byDay[day] || 0) + 1;
    } else if (r.status === "processed" && r.failureKind) {
      // processed row that carries a failureKind = it failed at least once then
      // succeeded on retry (the "是否重試成功" dimension).
      retriedThenProcessed++;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    availableNow: {
      note: "唯一現有可得維度:gmailIntegration.messagesFailed 計數(無 per-message 明細)。",
      totalFailedCounter,
      perMailbox,
    },
    ledgerDerived: ledgerAvailable
      ? {
          terminalFailed,
          retriedThenProcessed,
          byFailureKind,
          byHttpStatus,
          byDay,
          // permanent漏接 = terminal failed never retried-through (design 完成線 8).
          permanentMissApprox: terminalFailed,
        }
      : null,
    unavailableDimensions: ledgerAvailable
      ? []
      : [
          "per-message 日期分佈 — 需 ledger 上線後累積",
          "錯誤碼 / httpStatus 分類 — 需 ledger 上線後累積",
          "是否重試成功 — 需 ledger 上線後累積",
          "永久漏接數 — 需 ledger 上線後累積(現有計數無法區分終態失敗 vs 重試成功)",
        ],
  };
}

/** Domain-only de-identification (shared shape with the backfill tool). */
export function senderDomain(fromHeader) {
  const s = String(fromHeader || "");
  const m = s.match(/<([^>]+)>/) || s.match(/([^\s]+@[^\s]+)/);
  const email = (m ? m[1] : s).trim().toLowerCase();
  const at = email.lastIndexOf("@");
  return at === -1 ? "(unknown)" : email.slice(at + 1);
}

/** LIVE main — dynamic-imports the TS runtime; run under tsx WITH APPROVAL. */
async function main() {
  const args = process.argv.slice(2);
  const outArg = args.find((a) => a.startsWith("--out="));
  const outPath = outArg ? outArg.slice("--out=".length) : `gmail-failed-classify-${Date.now()}.json`;

  const { getDb } = await import("../db.ts");
  const { gmailIntegration, gmailIngestionLedger } = await import("../../drizzle/schema.ts");
  const { promises: fs } = await import("node:fs");

  const db = await getDb();
  if (!db) throw new Error("DATABASE_URL unset — cannot run failed-classify");
  const integrations = await db
    .select({ emailAddress: gmailIntegration.emailAddress, messagesFailed: gmailIntegration.messagesFailed })
    .from(gmailIntegration);

  // Ledger may be empty (pre-accumulation) — the classifier handles [] honestly.
  let ledgerRows = [];
  try {
    ledgerRows = await db
      .select({
        status: gmailIngestionLedger.status,
        failureKind: gmailIngestionLedger.failureKind,
        httpStatus: gmailIngestionLedger.httpStatus,
        internalDateMs: gmailIngestionLedger.internalDateMs,
      })
      .from(gmailIngestionLedger);
  } catch (e) {
    console.warn("[gmail-failed-classify] ledger table not queryable yet:", e?.message ?? e);
  }

  const report = classifyFailed({ integrations, ledgerRows });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`[gmail-failed-classify] wrote ${outPath} (READ-ONLY)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error("[gmail-failed-classify] failed:", e);
    process.exit(1);
  });
}
