/**
 * supplierCostVerification (Phase2 2b) — the only allowed gate for writing
 * customOrders.supplierCost. supplierCost is Jeff's internal cost number (used
 * to compute margin); it must NEVER be an LLM-invented figure. The rule is not
 * "no automation" — it's "no fabrication": a number that genuinely appears in
 * an already-uploaded supplier document (invoice/quote/confirmation) may be
 * carried over, but only after this module confirms it's really there.
 *
 * Two responsibilities, deliberately split:
 *   - verifyAmountInDocumentText: pure, no IO, trivially unit-tested.
 *   - resolveAndVerifySupplierCost: DB-touching coordinator (cross-customer
 *     guard + PII-kind exclusion + text extraction via the existing
 *     customerDocsText machinery — no bespoke PDF parsing here).
 *
 * This sits on the opsTools chat-tool-call path (create_custom_order /
 * update_custom_order). It must NEVER throw — any unexpected failure has to
 * degrade to a clear {ok:false, reason} so a bug here can't break Jeff's chat
 * response.
 */
import { createChildLogger } from "./logger";
import { extractDocTextCached, type DocRef } from "./customerDocsText";

const log = createChildLogger({ module: "supplierCostVerification" });

/** Same PII carve-out as customerDocsText.ts — these document kinds must never
 *  be read as cost evidence (and are excluded from OCR entirely upstream). */
const PII_DOC_TYPES = new Set(["passport", "visa", "insurance", "medical"]);

/** Tolerance for float/decimal-string rounding noise. */
const AMOUNT_EPSILON = 0.01;

/**
 * Pull every amount-shaped token out of `docText` and check whether
 * `claimedAmount` matches any of them within AMOUNT_EPSILON. Normalizes common
 * money formats: "$5,794.00", "5794", "NT$172,600", "USD 1,234.5" all reduce
 * to a bare number — this function does not care which currency a token was
 * written in, it only compares digits (currency disambiguation is out of
 * scope here; see 2a's extractInvoiceTotal for that).
 *
 * Pure — no IO, no DB. Defensive on both inputs: an empty/blank docText or a
 * non-finite claimedAmount always returns false (nothing to match against).
 */
export function verifyAmountInDocumentText(claimedAmount: number, docText: string): boolean {
  if (!Number.isFinite(claimedAmount)) return false;
  if (typeof docText !== "string" || !docText.trim()) return false;

  // Matches sequences like 172,600.00 / 5794 / 1,234.5 — with or without a
  // leading currency symbol/code, which we simply don't capture (currency-
  // agnostic on purpose). Comma-grouped form must come first so the
  // alternation doesn't stop early on a plain 4+ digit run with no commas.
  const AMOUNT_TOKEN = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
  const matches = docText.match(AMOUNT_TOKEN);
  if (!matches || matches.length === 0) return false;

  const target = Math.round(claimedAmount * 100);
  for (const raw of matches) {
    const n = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    if (Math.abs(Math.round(n * 100) - target) <= AMOUNT_EPSILON * 100) return true;
  }
  return false;
}

export type SupplierCostVerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * DB-touching coordinator: resolve `sourceDocId` → confirm it belongs to this
 * customer → confirm it isn't a PII scan → extract its text (reusing the
 * existing customerDocsText cache/parse machinery, no new PDF parsing) →
 * verify the claimed amount actually appears in it.
 *
 * Never throws: any unexpected error (DB down, parse blew up, etc.) degrades
 * to {ok:false, reason:"驗證過程發生錯誤"} so a caller on the chat-tool path
 * never sees an unhandled rejection.
 */
export async function resolveAndVerifySupplierCost(params: {
  claimedAmount: number;
  sourceDocId: number;
  customerProfileId: number;
}): Promise<SupplierCostVerifyResult> {
  const { claimedAmount, sourceDocId, customerProfileId } = params;
  try {
    const { getDb } = await import("../db");
    const { customerDocuments } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { ok: false, reason: "驗證過程發生錯誤" };

    const rows = await db
      .select({
        id: customerDocuments.id,
        customerProfileId: customerDocuments.customerProfileId,
        type: customerDocuments.type,
        fileName: customerDocuments.fileName,
        r2Url: customerDocuments.r2Url,
      })
      .from(customerDocuments)
      .where(eq(customerDocuments.id, sourceDocId))
      .limit(1);
    const doc = rows[0];

    if (!doc) return { ok: false, reason: "找不到指定的文件" };

    // Hard cross-customer gate: A's order may never cite B's document as cost
    // evidence, no exceptions.
    if (doc.customerProfileId !== customerProfileId)
      return { ok: false, reason: "這份文件不屬於這位客人" };

    if (PII_DOC_TYPES.has(doc.type))
      return { ok: false, reason: "不可用個資文件作為成本佐證" };

    // type:"other" business docs have no dedicated `kind` on the DB row — the
    // display-layer DocRef.kind is what drives PDF_KINDS parsing eligibility
    // in customerDocsText.ts. Pass an already-whitelisted kind ("invoice") so
    // extractDocTextCached actually parses it instead of skipping.
    const docRef: DocRef = {
      kind: "invoice",
      name: doc.fileName || `document-${doc.id}`,
      url: doc.r2Url,
    };

    const text = await extractDocTextCached(docRef);
    if (!text) return { ok: false, reason: "無法讀取該文件內容,請確認文件可正常開啟" };

    if (!verifyAmountInDocumentText(claimedAmount, text))
      return { ok: false, reason: "這個金額沒有出現在指定文件裡" };

    return { ok: true };
  } catch (err) {
    log.warn(
      { sourceDocId, customerProfileId, err: err instanceof Error ? err.message : String(err) },
      "[supplierCostVerification] unexpected failure — treating as unverified",
    );
    return { ok: false, reason: "驗證過程發生錯誤" };
  }
}
