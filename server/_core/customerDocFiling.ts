/**
 * Pure helpers for filing inbound email attachments as customerDocuments
 * (so they show in the customer page 文件 tab). DB-free + side-effect-free so
 * the "which attachments are real documents" + key-shaping logic is unit-
 * testable; the actual R2 upload + DB insert live in gmailPipeline.
 *
 * Why this exists: before 2026-06-21 the inbound pipeline parsed attachments to
 * TEXT only and NEVER persisted the file — customerDocuments had zero writers,
 * so the 文件 tab was always empty for email customers.
 */
import type { AttachmentKind } from "./attachmentParser";

/** Kinds we file as customer documents (real docs customers send). */
const DOC_KINDS: ReadonlySet<AttachmentKind> = new Set([
  "pdf",
  "xlsx",
  "docx",
  "csv",
]);

/**
 * Images below this are almost always inline logos / e-mail signatures, not a
 * document the customer meant to send (a passport/visa scan is far bigger).
 */
export const MIN_IMAGE_DOC_BYTES = 20 * 1024;

/**
 * Should this inbound email attachment be filed in the customer 文件 tab?
 * `kind` is typed loosely (the parsed summary carries a plain string; the raw
 * path passes detectAttachmentKind's union) — an unrecognized kind is just not
 * a document.
 */
export function isCustomerDocAttachment(
  kind: string,
  sizeBytes: number,
): boolean {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return false;
  if (DOC_KINDS.has(kind as AttachmentKind)) return true;
  if (kind === "image" && sizeBytes >= MIN_IMAGE_DOC_BYTES) return true;
  return false;
}

/** R2/FS-safe filename, capped to fit customerDocuments.fileName (255). */
export function safeDocFilename(filename: string): string {
  const cleaned = (filename || "")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.slice(-120) || "document";
}

/**
 * R2 key under the customer's private doc prefix. Not stored as a public URL —
 * customerDocuments can hold passport/visa scans, so the key is signed to a
 * short-TTL URL on READ (getSecureDocumentUrl), never served raw.
 */
export function customerDocR2Key(
  profileId: number,
  filename: string,
  ts: number,
  rand: string,
): string {
  return `customer-docs/${profileId}/${ts}-${rand}-${safeDocFilename(filename)}`;
}
