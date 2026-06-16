/**
 * reply-attachments (2026-06-15) — shared logic for 把附件夾進後台回信.
 *
 * BOTH outbound admin-reply paths funnel through this so they behave
 * identically (design.md「保持兩條送信路徑一致」):
 *   - server/_core/escalationBox.ts  sendEscalationReply → Gmail raw MIME
 *   - server/_core/inquiryReply.ts   sendAdminInquiryReply → nodemailer/SendGrid
 *
 * Responsibilities:
 *   1. mimeType 白名單 + 單檔大小上限 — validated at presign time
 *      (commandCenter.createReplyAttachmentUpload) and re-asserted here.
 *   2. Load bytes from R2 (storageGetBytes), guarding the key namespace so an
 *      outbound email can NEVER exfiltrate an arbitrary R2 object (passport
 *      scans live in the same bucket).
 *   3. Gmail's 25MB ceiling is measured on the BASE64-ENCODED message, not the
 *      raw bytes. Split files into inline attachments vs overflow; overflow
 *      becomes a 7-day download link appended to the body (design.md:
 *      ">25MB 改放下載連結").
 *
 * The byte-loading + link-making are injected (deps) so the splitter is a pure,
 * trivially-tested function — no module mocking needed for the size/Chinese
 * filename/overflow cases.
 */

/**
 * Allowed attachment MIME types. This is a SECURITY control on an outbound
 * channel, so keep it tight: PDF (quotes / itineraries), Excel, and the common
 * image types Jeff screenshots into. Anything else is rejected at presign.
 */
export const ALLOWED_ATTACHMENT_MIME: ReadonlySet<string> = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "image/png",
  "image/jpeg",
  "image/webp",
]);

/** Per-file upload cap (claimed size, checked at presign). 50MB leaves room
 *  for the >25MB→link path to actually be reachable + testable. */
export const MAX_REPLY_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/** Gmail rejects a send whose RAW (base64-encoded) message exceeds 25MB.
 *  We compare the cumulative ENCODED attachment size against this ceiling. */
export const GMAIL_MAX_ENCODED_BYTES = 25 * 1024 * 1024;

/** R2 key namespace every reply attachment must live under. The send paths
 *  refuse any key outside it — an outbound email must not be able to attach,
 *  say, customerDocuments/<id>/passport.jpg by passing its key. */
export const REPLY_ATTACHMENT_KEY_PREFIX = "reply-attachments/";

/** Download-link TTL for the >25MB fallback. 7 days = long enough for a
 *  customer to fetch it without the link going dead mid-week. */
export const DOWNLOAD_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface ReplyAttachmentRef {
  /** R2 key returned by createReplyAttachmentUpload. */
  key: string;
  /** Original filename (Chinese intact) — carried separately because the R2
   *  key is ascii-sanitised; the email needs the real name for the customer. */
  filename: string;
}

/** A file small enough to ride inline in the message. */
export interface LoadedReplyAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

/** A file too big to attach → offered as a download link in the body. */
export interface ReplyAttachmentLink {
  filename: string;
  url: string;
}

export interface ResolvedReplyAttachments {
  inline: LoadedReplyAttachment[];
  links: ReplyAttachmentLink[];
}

/** Typed validation failure so the router can map it to a 400 (vs a 500 for
 *  an unexpected infra error). */
export class ReplyAttachmentError extends Error {
  constructor(
    public readonly code: "unsupported_mime" | "too_large",
    message: string,
  ) {
    super(message);
    this.name = "ReplyAttachmentError";
  }
}

export function isAllowedAttachmentMime(mime: string): boolean {
  return ALLOWED_ATTACHMENT_MIME.has(mime.trim().toLowerCase());
}

/** Base64-encoded byte size of `rawBytes` raw bytes (4 output chars / 3 input
 *  bytes, padded up to the next multiple of 4). */
export function encodedSize(rawBytes: number): number {
  return Math.ceil(rawBytes / 3) * 4;
}

/** ascii/url-safe segment for the R2 key path (NOT for the email — that uses
 *  the raw filename). Keeps the extension; collapses everything unsafe. */
function safeKeySegment(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot + 1).replace(/[^A-Za-z0-9]/g, "") : "";
  const base = (dot > 0 ? filename.slice(0, dot) : filename)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64);
  const safeBase = base || "file";
  return ext ? `${safeBase}.${ext.toLowerCase().slice(0, 12)}` : safeBase;
}

/**
 * Build the R2 key a reply attachment is stored under:
 *   reply-attachments/<scope>/<ts>-<rand>-<safeName>
 * scope = customer profile id, or "guest". ts + rand guarantee uniqueness so
 * two same-named uploads never collide.
 */
export function buildReplyAttachmentKey(scope: string, filename: string): string {
  const safeScope = /^\d+$/.test(scope) ? scope : "guest";
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${REPLY_ATTACHMENT_KEY_PREFIX}${safeScope}/${ts}-${rand}-${safeKeySegment(filename)}`;
}

/**
 * Validate + presign one upload. Pure orchestration (the actual presign is
 * injected) so the whitelist + size gate is unit-testable without a tRPC
 * caller. Throws ReplyAttachmentError on a rejected file.
 */
export async function prepareReplyAttachmentUpload(
  input: { filename: string; mimeType: string; size: number; profileId?: number },
  deps: { presign: (key: string, mimeType: string) => Promise<{ key: string; putUrl: string }> },
): Promise<{ key: string; putUrl: string; filename: string }> {
  if (!isAllowedAttachmentMime(input.mimeType)) {
    throw new ReplyAttachmentError(
      "unsupported_mime",
      "不支援的檔案類型(只接受 PDF / Excel / PNG / JPG / WebP)",
    );
  }
  if (input.size > MAX_REPLY_ATTACHMENT_BYTES) {
    throw new ReplyAttachmentError(
      "too_large",
      `檔案過大(單檔上限 ${Math.floor(MAX_REPLY_ATTACHMENT_BYTES / 1024 / 1024)}MB)`,
    );
  }
  const scope = input.profileId != null ? String(input.profileId) : "guest";
  const key = buildReplyAttachmentKey(scope, input.filename);
  const { putUrl } = await deps.presign(key, input.mimeType);
  return { key, putUrl, filename: input.filename };
}

/**
 * Resolve attachment refs into {inline, links} for one outbound message.
 *
 *   - keys outside REPLY_ATTACHMENT_KEY_PREFIX throw (namespace guard).
 *   - files whose cumulative ENCODED size would push the message past Gmail's
 *     25MB ceiling spill over to download links instead of being attached.
 *     (A single file bigger than the ceiling on its own also becomes a link.)
 *
 * `getBytes` + `makeLink` are injected so callers wire in the real
 * storageGetBytes / getSecureDocumentUrl and tests stay pure.
 */
export async function resolveReplyAttachments(
  refs: ReplyAttachmentRef[],
  deps: {
    getBytes: (key: string) => Promise<{ bytes: Buffer; mimeType: string; contentLength: number }>;
    makeLink: (key: string) => Promise<string>;
  },
): Promise<ResolvedReplyAttachments> {
  const inline: LoadedReplyAttachment[] = [];
  const links: ReplyAttachmentLink[] = [];
  let cumulativeEncoded = 0;

  for (const ref of refs) {
    if (!ref.key.startsWith(REPLY_ATTACHMENT_KEY_PREFIX)) {
      // Never let an outbound email pull an arbitrary R2 object.
      throw new Error(`reply attachment key out of namespace: ${ref.key}`);
    }
    const { bytes, mimeType } = await deps.getBytes(ref.key);
    const enc = encodedSize(bytes.length);
    if (cumulativeEncoded + enc > GMAIL_MAX_ENCODED_BYTES) {
      links.push({ filename: ref.filename, url: await deps.makeLink(ref.key) });
      continue;
    }
    cumulativeEncoded += enc;
    inline.push({ filename: ref.filename, mimeType, content: bytes });
  }

  return { inline, links };
}

/**
 * Append a plain-text download-link section for overflow attachments. No
 * em-dashes / no markdown (customer-facing, per Jeff's message-style rules).
 */
export function appendDownloadLinksToBody(
  body: string,
  links: ReplyAttachmentLink[],
): string {
  if (links.length === 0) return body;
  const lines = links.map((l) => `${l.filename}: ${l.url}`);
  return (
    body.trimEnd() +
    "\n\n" +
    "附件較大,改用下載連結(7 天內有效):\n" +
    lines.join("\n")
  );
}
