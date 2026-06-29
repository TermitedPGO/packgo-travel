/**
 * customerIntakeExtract — pure helpers for the「拖一個檔案進來新增客人」intake.
 *
 * The actual mutation (admin.extractCustomerFromFile in
 * server/routers/adminCustomers.ts) does the IO: base64 decode, parseAttachment,
 * invokeLLM. Everything testable-without-IO lives here so it has unit coverage
 * (local has no DB / no ANTHROPIC_API_KEY — we can't exercise the LLM or parser
 * live, but these pure functions we can).
 *
 * customer-intake 2026-06-29
 */

/** Decoded-buffer size ceiling for an uploaded intake file. Over this we bounce
 *  with reason "too_large" instead of feeding the parser / LLM a huge blob. */
export const MAX_INTAKE_BYTES = 15 * 1024 * 1024; // 15 MB

/** Cap on the document text we hand to the extraction LLM (cost control — a
 *  name/email/phone always sits near the top of any document). */
export const MAX_EXTRACT_TEXT_CHARS = 8000;

/** The normalized customer fields the mutation returns to the client. */
export type ExtractedCustomer = {
  name: string;
  email: string | null;
  phone: string | null;
};

/**
 * True when a decoded intake buffer is over the size ceiling (→ the caller
 * returns { ok:false, reason:"too_large" } without throwing). Pure so the
 * boundary is unit-tested.
 */
export function isIntakeTooLarge(byteLength: number): boolean {
  return byteLength > MAX_INTAKE_BYTES;
}

/** Trim a string-ish value; non-strings / undefined become "". */
function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Normalize the LLM's raw extraction object into the wire shape:
 *   - every field trimmed
 *   - empty / whitespace-only email → null
 *   - empty / whitespace-only phone → null
 *   - missing name → "" (the client lets the user fill it in; we still return ok)
 *
 * Pure — no IO. This is the unit under test.
 */
export function normalizeExtractedCustomer(raw: {
  name?: string;
  email?: string;
  phone?: string;
} | null | undefined): ExtractedCustomer {
  const name = clean(raw?.name);
  const email = clean(raw?.email);
  const phone = clean(raw?.phone);
  return {
    name,
    email: email || null,
    phone: phone || null,
  };
}
