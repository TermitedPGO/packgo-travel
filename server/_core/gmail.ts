/**
 * Round 81 — Gmail API wrapper.
 *
 * Encapsulates OAuth client construction + token refresh + the small
 * subset of Gmail operations the agent pipeline needs:
 *   - listMessages(since, query) → message IDs
 *   - getMessage(id) → headers, body, attachments
 *   - markAsRead(id)
 *   - addLabel(id, labelName)
 *
 * Token storage lives in `gmailIntegration` table — callers pass an
 * integration row and we handle refresh + persistence transparently.
 */

import { randomBytes } from "crypto";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { ENV } from "./env";
import { decryptToken } from "./tokenCrypto";
import { createChildLogger } from "./logger";
const log = createChildLogger({ module: "gmail" });

// gmail-push (2026-06-29) — NOTE on scopes + users.watch:
//   The Gmail `users.watch` method (push-notification registration) is
//   authorized by ANY of: https://mail.google.com/ , gmail.modify ,
//   gmail.readonly , gmail.metadata (verified against the METHOD reference at
//   developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch
//   #authorization-scopes — NOT the push guide page, which loosely claims
//   "modify or settings"; that is wrong for watch). We already request
//   gmail.readonly + gmail.modify below, so watch needs NO new scope and Jeff
//   does NOT have to re-authorize. We deliberately do NOT add gmail.settings* —
//   it is unnecessary and would force a fresh consent + re-grant. The push
//   runbook records this.
const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/userinfo.email",
];

function buildRedirectUri(): string {
  const base = (process.env.BASE_URL || "https://packgo-travel.fly.dev").replace(
    /\/$/,
    ""
  );
  return `${base}/api/gmail/oauth/callback`;
}

/** Get the Google OAuth client configured for Gmail scopes. */
export function getGmailOAuthClient(): OAuth2Client {
  const clientId =
    process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret =
    process.env.GMAIL_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET not configured. " +
        "Run: fly secrets set GMAIL_OAUTH_CLIENT_ID=... GMAIL_OAUTH_CLIENT_SECRET=..."
    );
  }
  return new google.auth.OAuth2(clientId, clientSecret, buildRedirectUri());
}

/** Generate the consent-screen URL to redirect Jeff to. */
export function getGmailAuthUrl(state?: string): string {
  const client = getGmailOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline", // request refresh token
    prompt: "consent", // force fresh refresh token (don't silently re-use)
    scope: GMAIL_SCOPES,
    state,
  });
}

/** Exchange an OAuth code for tokens. */
export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  scope: string;
  expiresAt: Date;
  emailAddress: string;
}> {
  const client = getGmailOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error(
      "Gmail OAuth: missing access_token or refresh_token. " +
        "If reconnecting an existing mailbox, revoke first at " +
        "https://myaccount.google.com/permissions and try again."
    );
  }
  // Fetch the email address tied to this token
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const profile = await oauth2.userinfo.get();
  const emailAddress = profile.data.email;
  if (!emailAddress) {
    throw new Error("Gmail OAuth: could not resolve email address from tokens");
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    scope: tokens.scope ?? GMAIL_SCOPES.join(" "),
    expiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600 * 1000),
    emailAddress,
  };
}

/**
 * Build a Gmail client from a stored integration row. Handles refresh.
 *
 * SECURITY_AUDIT_2026_05_14 P1-1: stored tokens may be either the new
 * `enc:v1:` AES-256-GCM envelope (gmailOAuth.ts now encrypts on write)
 * or legacy plaintext (rows that pre-date the fix). `decryptToken` is
 * version-aware and returns plaintext as-is when the prefix is absent,
 * so this call site works for both — the next OAuth refresh re-encrypts
 * the row through the encrypt-on-write path.
 */
export function buildGmailClient(integration: {
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt?: Date | null;
}) {
  const client = getGmailOAuthClient();
  client.setCredentials({
    access_token: decryptToken(integration.accessToken),
    refresh_token: decryptToken(integration.refreshToken),
    expiry_date: integration.tokenExpiresAt
      ? new Date(integration.tokenExpiresAt).getTime()
      : undefined,
  });
  return google.gmail({ version: "v1", auth: client });
}

export type GmailMessageSummary = {
  id: string;
  /**
   * RFC822 `Message-ID` header (angle-brackets stripped), the cross-mailbox
   * idempotency key for filing — the SAME email carries the SAME Message-ID in
   * every mailbox it lands in, whereas the Gmail internal `id` differs per
   * account. Falls back to the Gmail `id` when the header is absent. See
   * `parseRfcMessageId`.
   */
  messageId: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  receivedAt: Date;
  labels: string[];
  /**
   * 2026-05-25 Phase 7 — parsed attachments.
   *
   * Each entry holds the extracted plain-text content from a single
   * Gmail attachment. Empty array when the message has no attachments.
   * Parsing happens lazily inside `listUnreadMessages` so the caller
   * doesn't need to make extra Gmail API calls. Limits live in
   * `_core/attachmentParser.ts` (MAX_RAW_BYTES, MAX_TEXT_CHARS) and the
   * per-message cap (MAX_ATTACHMENTS_PER_MESSAGE below).
   */
  attachments: ParsedAttachment[];
};

export type ParsedAttachment = {
  filename: string;
  mimeType: string;
  kind: string;
  sizeBytes: number;
  text: string;
  parseStatus: string;
  parseError?: string;
};

/**
 * Defense-in-depth — Jeff's inbox is the highest-bandwidth attack vector
 * for cost-blow-up + prompt-injection. We cap attachments per message so
 * a single malicious email can't fan out into 100 attachment fetches +
 * 100 LLM prompts.
 */
const MAX_ATTACHMENTS_PER_MESSAGE = 5;

/**
 * Fetch unread messages since a given internal timestamp, with INBOX
 * filter. Returns up to `maxResults` messages.
 *
 * When `filterLabel` is set (e.g. "PACKGO_SUPPORT"), only messages
 * carrying that Gmail label are returned. This keeps the agent
 * pipeline away from Jeff's personal inbox noise.
 */
export async function listUnreadMessages(
  gmail: ReturnType<typeof buildGmailClient>,
  sinceSeconds?: number,
  maxResults = 25,
  filterLabel?: string
): Promise<GmailMessageSummary[]> {
  const queryParts = ["is:unread", "-from:noreply"];
  if (sinceSeconds) queryParts.push(`after:${sinceSeconds}`);
  if (filterLabel) queryParts.push(`label:${filterLabel}`);
  return fetchSummariesForQuery(gmail, queryParts.join(" "), maxResults);
}

/**
 * Run a Gmail search query and hydrate each hit into a GmailMessageSummary
 * (full headers + parsed attachments). Shared by listUnreadMessages (inbound)
 * and listSentWithAttachments (outbound). Per-message failures are logged and
 * skipped, never fatal.
 */
async function fetchSummariesForQuery(
  gmail: ReturnType<typeof buildGmailClient>,
  query: string,
  maxResults: number
): Promise<GmailMessageSummary[]> {
  const listResp = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });
  const messages = listResp.data.messages ?? [];
  const results: GmailMessageSummary[] = [];
  for (const m of messages) {
    if (!m.id || !m.threadId) continue;
    const summary = await hydrateMessageById(gmail, m.id);
    if (summary) results.push(summary);
  }
  return results;
}

/**
 * Fetch + parse ONE message id into a full GmailMessageSummary (headers, body,
 * parsed attachments). Returns null on any per-message failure (logged, never
 * throws) so callers can keep going. Shared by the query path
 * (fetchSummariesForQuery) and the push path (listMessagesByIds).
 */
async function hydrateMessageById(
  gmail: ReturnType<typeof buildGmailClient>,
  id: string,
): Promise<GmailMessageSummary | null> {
  try {
    const full = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "full",
    });
    const summary = parseMessage(full.data);
    try {
      summary.attachments = await fetchAndParseAttachments(
        gmail,
        id,
        full.data.payload
      );
    } catch (attachErr) {
      log.warn(
        { err: attachErr, messageId: id },
        "[gmail] failed to parse attachments — continuing with body only"
      );
    }
    return summary;
  } catch (e) {
    log.warn({ err: e, messageId: id }, "[gmail] failed to fetch message");
    return null;
  }
}

/**
 * gmail-push — hydrate a known set of message ids (from history.list) into full
 * summaries, mirroring listUnreadMessages' shape so the ingest path is reused
 * verbatim. Per-message failures are skipped (hydrateMessageById returns null).
 * INBOX filter is applied in JS: history.list already scoped to the INBOX
 * label, but a defensive `labels.includes("INBOX")` keeps Trash/Sent edge
 * cases out of the customer-inquiry flow.
 */
export async function listMessagesByIds(
  gmail: ReturnType<typeof buildGmailClient>,
  ids: string[],
): Promise<GmailMessageSummary[]> {
  const out: GmailMessageSummary[] = [];
  for (const id of ids) {
    const summary = await hydrateMessageById(gmail, id);
    if (summary && summary.labels.includes("INBOX")) out.push(summary);
  }
  return out;
}

/**
 * gmail-push — the shared inbox-firewall + dedup gate, mirroring the poll. Keep a
 * hydrated message ONLY if it is not already processed (PACKGO_AI_PROCESSED) AND,
 * when a support label is configured, it carries that label. `filterLabelId` null
 * = no firewall (whole inbox), matching an unset GMAIL_POLL_LABEL. The poll
 * enforces the same firewall at the Gmail-query level (label:NAME); the push diff
 * sees the whole INBOX, so it MUST filter here or it would ingest Jeff's personal
 * mail. Pure so the push/poll parity is unit-tested.
 */
export function selectIngestableMessages<T extends { labels: string[] }>(
  summaries: T[],
  processedLabelId: string,
  filterLabelId: string | null,
): T[] {
  return summaries.filter(
    (m) =>
      !m.labels.includes(processedLabelId) &&
      (!filterLabelId || m.labels.includes(filterLabelId)),
  );
}

/**
 * 2026-06-22 sent-mail capture — list OUTBOUND messages WITH attachments that
 * we haven't filed yet (Jeff sends quotes / itineraries to customers straight
 * from Gmail; those never enter the system). `excludeLabel` carries the
 * bookkeeping label so already-filed messages are skipped; `newerThanDays`
 * caps the backfill window. Mirrors listUnreadMessages' hydration.
 */
export async function listSentWithAttachments(
  gmail: ReturnType<typeof buildGmailClient>,
  opts?: { maxResults?: number; excludeLabel?: string; newerThanDays?: number }
): Promise<GmailMessageSummary[]> {
  const parts = ["in:sent", "has:attachment"];
  if (opts?.newerThanDays) parts.push(`newer_than:${opts.newerThanDays}d`);
  if (opts?.excludeLabel) parts.push(`-label:${opts.excludeLabel}`);
  return fetchSummariesForQuery(gmail, parts.join(" "), opts?.maxResults ?? 25);
}

export interface ThreadHistoryMessage {
  from: string;
  date: Date;
  /** outbound = sent by us (from matches the connected account). */
  direction: "inbound" | "outbound";
  body: string;
}

/**
 * Fetch a Gmail thread's full message history (both directions), trimmed, so
 * the InquiryAgent can reason about the whole back-and-forth instead of only
 * the one triggering email. 2026-06-13 — the pipeline logged just the trigger
 * message, leaving the agent blind to Jeff's manual replies + the customer's
 * follow-ups. Oldest→newest; caps message count + per-message length.
 */
export async function getThreadHistory(
  gmail: ReturnType<typeof buildGmailClient>,
  threadId: string,
  selfEmail: string,
  opts?: { maxMessages?: number; maxCharsPerMessage?: number },
): Promise<ThreadHistoryMessage[]> {
  const maxMessages = opts?.maxMessages ?? 12;
  const maxChars = opts?.maxCharsPerMessage ?? 1200;
  const resp = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  });
  const msgs = (resp.data.messages ?? []) as any[];
  const self = (selfEmail || "").toLowerCase();
  const out: ThreadHistoryMessage[] = [];
  for (const m of msgs) {
    const headers = (m.payload?.headers ?? []) as Array<{
      name?: string | null;
      value?: string | null;
    }>;
    const hmap: Record<string, string> = {};
    for (const h of headers) if (h.name && h.value) hmap[h.name.toLowerCase()] = h.value;
    const from = hmap["from"] ?? "";
    const body = (extractBody(m.payload) || m.snippet || "").trim();
    out.push({
      from,
      date: new Date(Number(m.internalDate ?? Date.now())),
      direction: self && from.toLowerCase().includes(self) ? "outbound" : "inbound",
      body: body.length > maxChars ? body.slice(0, maxChars) + " …(略)" : body,
    });
  }
  return out.slice(-maxMessages);
}

/**
 * 2026-07-02 multi-account thread routing — does THIS mailbox own the thread?
 *
 * Gmail threadIds are per-mailbox: the same customer email lands in each
 * connected account with a DIFFERENT threadId, so a thread-specific send must
 * first find the owning account (see gmailAccountRouting.resolveThreadOwner).
 * `format: "minimal"` keeps the probe as cheap as the API allows. 404 /
 * "Requested entity was not found" = not this account → false; any other
 * error (auth, network) rethrows — swallowing it would misread a dead token
 * as "not my thread".
 */
export async function threadExists(
  gmail: ReturnType<typeof buildGmailClient>,
  threadId: string,
): Promise<boolean> {
  const { isGmailNotFoundError } = await import("./gmailAccountRouting");
  try {
    await gmail.users.threads.get({
      userId: "me",
      id: threadId,
      format: "minimal",
    });
    return true;
  } catch (err) {
    if (isGmailNotFoundError(err)) return false;
    throw err;
  }
}

/**
 * Normalize an RFC822 `Message-ID` header value (strip the surrounding `<>`,
 * trim) into the cross-mailbox dedup key. When the header is missing we fall
 * back to the Gmail internal id — that loses cross-account dedup for that one
 * message but keeps the key non-empty so the UNIQUE(profile, externalId) index
 * still works. Pure → unit-tested.
 */
export function parseRfcMessageId(
  raw: string | undefined | null,
  fallbackGmailId: string,
): string {
  const cleaned = (raw ?? "").trim().replace(/^<|>$/g, "").trim();
  return cleaned || fallbackGmailId;
}

/** Extract the bare email address from a `From`/`To` header value, lowercased. */
function extractEmailAddr(header: string): string {
  const m = header.match(/<([^>]+)>/) || header.match(/([^\s]+@[^\s]+)/);
  return m ? m[1].trim().toLowerCase() : "";
}

/**
 * Decide a message's direction relative to the connected mailbox. Uses an
 * EXACT email-address match (parse the address out of the `From` header, then
 * `===`), not a substring test — a customer whose display name happens to
 * contain the self address must not be misread as outbound. Pure → unit-tested.
 */
export function resolveDirection(
  fromHeader: string,
  selfEmail: string,
): "inbound" | "outbound" {
  const from = extractEmailAddr(fromHeader);
  const self = (selfEmail || "").trim().toLowerCase();
  return !!from && !!self && from === self ? "outbound" : "inbound";
}

/**
 * Flat per-message shape consumed by the thread-filing reconciler
 * (`server/_core/threadFiling.ts`). Distinct from `ThreadHistoryMessage`
 * (LLM context) — this carries the durable dedup key + Trash flag.
 */
export interface FilingMessage {
  /** Gmail internal message id (per-mailbox). */
  id: string;
  /** RFC822 Message-ID (cross-mailbox dedup key); Gmail id fallback. */
  messageId: string;
  threadId: string;
  from: string;
  /** Gmail internalDate — the message's real send/receive time. */
  date: Date;
  direction: "inbound" | "outbound";
  body: string;
  /** True when the message carries the TRASH label; the reconciler skips it. */
  inTrash: boolean;
}

/**
 * gmail-full-thread-filing [2] — fetch EVERY message in a thread (both
 * directions, including Jeff's plain-text replies that the `has:attachment`
 * sent-mail gate misses) as a flat `FilingMessage[]` for durable filing.
 *
 * Deliberately separate from `getThreadHistory` (which is tuned for LLM context:
 * last 12 messages, body trimmed to 1200) and leaves it untouched. Here we keep
 * the whole thread (per-thread cap 200), allow long bodies (cap 20000), carry the
 * `messageId` dedup key, and flag Trash so the reconciler can exclude it. Oldest
 * → newest. Per-message direction via `resolveDirection(selfEmail)`.
 */
export async function listThreadMessagesForFiling(
  gmail: ReturnType<typeof buildGmailClient>,
  threadId: string,
  selfEmail: string,
  opts?: { maxMessages?: number; maxCharsPerMessage?: number },
): Promise<FilingMessage[]> {
  const maxMessages = opts?.maxMessages ?? 200;
  const maxChars = opts?.maxCharsPerMessage ?? 20000;
  const resp = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  });
  const msgs = (resp.data.messages ?? []) as any[];
  const out: FilingMessage[] = [];
  for (const m of msgs) {
    const headers = (m.payload?.headers ?? []) as Array<{
      name?: string | null;
      value?: string | null;
    }>;
    const hmap: Record<string, string> = {};
    for (const h of headers) if (h.name && h.value) hmap[h.name.toLowerCase()] = h.value;
    const from = hmap["from"] ?? "";
    const body = (extractBody(m.payload) || m.snippet || "").trim();
    const labelIds = (m.labelIds ?? []) as string[];
    out.push({
      id: m.id,
      messageId: parseRfcMessageId(hmap["message-id"], m.id),
      threadId: m.threadId ?? threadId,
      from,
      date: new Date(Number(m.internalDate ?? Date.now())),
      direction: resolveDirection(from, selfEmail),
      body: body.length > maxChars ? body.slice(0, maxChars) : body,
      inTrash: labelIds.includes("TRASH"),
    });
  }
  return out.slice(-maxMessages);
}

function parseMessage(msg: any): GmailMessageSummary {
  const headers = msg.payload?.headers ?? [];
  const headerMap: Record<string, string> = {};
  for (const h of headers) {
    if (h.name && h.value) headerMap[h.name.toLowerCase()] = h.value;
  }
  return {
    id: msg.id,
    messageId: parseRfcMessageId(headerMap["message-id"], msg.id),
    threadId: msg.threadId,
    from: headerMap["from"] ?? "",
    to: headerMap["to"] ?? "",
    subject: headerMap["subject"] ?? "(no subject)",
    body: extractBody(msg.payload) || msg.snippet || "",
    receivedAt: new Date(Number(msg.internalDate ?? Date.now())),
    labels: msg.labelIds ?? [],
    attachments: [], // populated by fetchAndParseAttachments
  };
}

/**
 * Walk the Gmail message payload tree, find every attachment part
 * (parts with `body.attachmentId` and non-empty `filename`), fetch the
 * actual bytes via gmail.users.messages.attachments.get, run each through
 * `parseAttachment` from _core/attachmentParser.ts.
 *
 * Returns up to MAX_ATTACHMENTS_PER_MESSAGE entries. Skips inline-image
 * parts (typically embedded in HTML body, filename starts with "image-")
 * unless they're explicitly named — those are presentation, not content.
 */
async function fetchAndParseAttachments(
  gmail: ReturnType<typeof buildGmailClient>,
  messageId: string,
  payload: any
): Promise<ParsedAttachment[]> {
  if (!payload) return [];

  // Collect all parts that carry an attachment
  const parts: Array<{ filename: string; mimeType: string; attachmentId: string; sizeHint: number }> = [];
  collectAttachmentParts(payload, parts);

  if (parts.length === 0) return [];

  // Apply per-message cap (defense-in-depth)
  const capped = parts.slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
  const dropped = parts.length - capped.length;
  if (dropped > 0) {
    log.info(
      { messageId, dropped, kept: capped.length },
      "[gmail] capped attachments per message"
    );
  }

  // Dynamic import — keeps cold start light when no attachment-bearing
  // emails come in.
  const { parseAttachment } = await import("./attachmentParser");

  const out: ParsedAttachment[] = [];
  for (const p of capped) {
    try {
      const attResp = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: p.attachmentId,
      });
      const dataB64 = attResp.data.data;
      if (!dataB64) {
        out.push({
          filename: p.filename,
          mimeType: p.mimeType,
          kind: "unknown",
          sizeBytes: 0,
          text: "",
          parseStatus: "empty",
        });
        continue;
      }
      // Gmail returns base64url-encoded bytes
      const buf = Buffer.from(
        dataB64.replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      );
      const parsed = await parseAttachment(p.filename, p.mimeType, buf);
      out.push(parsed);
    } catch (err) {
      log.warn(
        { err, messageId, filename: p.filename },
        "[gmail] attachment fetch/parse failed"
      );
      out.push({
        filename: p.filename,
        mimeType: p.mimeType,
        kind: "unknown",
        sizeBytes: p.sizeHint,
        text: "",
        parseStatus: "parse_error",
        parseError: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

/** Raw (unparsed) attachment bytes — used by the receipt-intake path which
 * needs the actual file to (a) store in R2 and (b) send to LLM vision. The
 * customer-inquiry path uses ParsedAttachment (text) instead. */
export type RawAttachment = {
  filename: string;
  mimeType: string;
  bytes: Buffer;
};

/** Per-attachment byte cap for the receipt path (defense-in-depth, matches
 * attachmentParser's image/PDF ceiling). Bigger files are skipped, not
 * truncated, so we never feed a half file to vision. */
const MAX_RAW_ATTACHMENT_BYTES = 30 * 1024 * 1024;

/**
 * email-receipt-intake (2026-06-15) — fetch the RAW bytes of a message's
 * attachments (re-fetches the full message; the poll summary discards bytes).
 * Returns up to MAX_ATTACHMENTS_PER_MESSAGE entries. Never throws on a single
 * bad attachment — it's skipped and logged. Caller picks the receipt-looking
 * one (PDF/image).
 */
export async function fetchRawAttachments(
  gmail: ReturnType<typeof buildGmailClient>,
  messageId: string,
): Promise<RawAttachment[]> {
  const full = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });
  const parts: Array<{ filename: string; mimeType: string; attachmentId: string; sizeHint: number }> = [];
  collectAttachmentParts(full.data.payload, parts);
  if (parts.length === 0) return [];

  const capped = parts.slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
  const out: RawAttachment[] = [];
  for (const p of capped) {
    if (p.sizeHint > 0 && p.sizeHint > MAX_RAW_ATTACHMENT_BYTES) {
      log.info(
        { messageId, filename: p.filename, sizeHint: p.sizeHint },
        "[gmail] raw attachment too large — skipped",
      );
      continue;
    }
    try {
      const attResp = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: p.attachmentId,
      });
      const dataB64 = attResp.data.data;
      if (!dataB64) continue;
      const bytes = Buffer.from(
        dataB64.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      );
      if (bytes.length > MAX_RAW_ATTACHMENT_BYTES) continue;
      out.push({ filename: p.filename, mimeType: p.mimeType, bytes });
    } catch (err) {
      log.warn(
        { err, messageId, filename: p.filename },
        "[gmail] raw attachment fetch failed",
      );
    }
  }
  return out;
}

function collectAttachmentParts(
  part: any,
  out: Array<{ filename: string; mimeType: string; attachmentId: string; sizeHint: number }>
): void {
  if (!part) return;
  // A real attachment has filename + attachmentId. Inline parts (body data)
  // are NOT attachments — they're handled by extractBody.
  if (part.filename && part.body?.attachmentId) {
    out.push({
      filename: part.filename,
      mimeType: part.mimeType || "application/octet-stream",
      attachmentId: part.body.attachmentId,
      sizeHint: Number(part.body.size ?? 0),
    });
  }
  if (Array.isArray(part.parts)) {
    for (const sub of part.parts) collectAttachmentParts(sub, out);
  }
}

function extractBody(payload: any): string {
  if (!payload) return "";
  // Prefer text/plain; fall back to text/html stripped of tags
  const plain = findPart(payload, "text/plain");
  if (plain && plain.body?.data) return decodeBase64Url(plain.body.data);
  const html = findPart(payload, "text/html");
  if (html && html.body?.data) {
    return stripHtml(decodeBase64Url(html.body.data));
  }
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  return "";
}

function findPart(part: any, mimeType: string): any | null {
  if (!part) return null;
  if (part.mimeType === mimeType && part.body?.data) return part;
  if (part.parts) {
    for (const sub of part.parts) {
      const found = findPart(sub, mimeType);
      if (found) return found;
    }
  }
  return null;
}

function decodeBase64Url(s: string): string {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf-8"
  );
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Mark a message as read. */
export async function markAsRead(
  gmail: ReturnType<typeof buildGmailClient>,
  messageId: string
): Promise<void> {
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { removeLabelIds: ["UNREAD"] },
  });
}

/** Ensure a label exists, return its ID. */
export async function ensureLabel(
  gmail: ReturnType<typeof buildGmailClient>,
  name: string
): Promise<string> {
  const list = await gmail.users.labels.list({ userId: "me" });
  const existing = list.data.labels?.find((l: any) => l.name === name);
  if (existing?.id) return existing.id;
  const created = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });
  if (!created.data.id) throw new Error(`Failed to create label ${name}`);
  return created.data.id;
}

/** Apply a label to a message. */
export async function applyLabel(
  gmail: ReturnType<typeof buildGmailClient>,
  messageId: string,
  labelId: string
): Promise<void> {
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { addLabelIds: [labelId] },
  });
}

// ────────────────────────────────────────────────────────────────────────
// Phase 2.5 — Actually send email replies
//
// Two safety layers gate every send:
//   1. Env-level: AGENT_DRY_RUN=true → never send, just log "would send"
//   2. Per-message: caller must pass `confirmedAutoSendOk: true`. Pipeline
//      sets this only when policy.autoSendEnabled === true AND
//      confidence >= autoSendMinConfidence AND classification not in
//      alwaysEscalate. So Jeff has 2 kill switches.
//
// Every auto-sent message:
//   - Includes "[本訊息由 PACK&GO AI 助理自動回覆]" disclaimer in body
//   - BCCs jeffhsieh09@gmail.com (so Jeff sees every auto-send in his
//     Sent mirror; can revoke or follow up)
//   - Replies inside the same thread (threadId preserved)
// ────────────────────────────────────────────────────────────────────────

/**
 * 2026-06-15 reply-attachments — one inline attachment for a multipart reply.
 * `content` is the raw bytes; buildMimeReply base64-encodes + RFC5987-encodes
 * the (possibly Chinese) filename.
 */
export type GmailAttachment = {
  filename: string;
  mimeType: string;
  content: Buffer;
};

export type SendReplyInput = {
  threadId: string;
  toEmail: string;
  toName?: string;
  subject: string;
  bodyText: string;
  fromEmail: string;
  confirmedAutoSendOk: boolean;
  inReplyToMessageId?: string;
  /**
   * 2026-06-15 — when present + non-empty, the reply is built as
   * multipart/mixed (body + each file). Absent/empty → plain text/plain,
   * byte-identical to the pre-attachment behavior (regression-tested).
   */
  attachments?: GmailAttachment[];
};

export type SendReplyResult =
  | { ok: true; messageId: string; threadId: string; dryRun: false }
  | { ok: true; dryRun: true; reason: string }
  | { ok: false; error: string };

/**
 * RFC 5987 ext-value encoding for a (possibly Chinese) filename. encodeURIComponent
 * already percent-encodes UTF-8 bytes; we additionally encode the few attr-chars
 * it leaves (' ( ) *) so the result is a valid ext-value.
 */
function encodeRFC5987(str: string): string {
  return encodeURIComponent(str).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** ascii-only fallback for the legacy `filename=` param (modern clients prefer
 *  filename*); non-ascii + quotes collapse to "_". */
function asciiFilenameFallback(str: string): string {
  const cleaned = str.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_").trim();
  return cleaned || "attachment";
}

/** Wrap base64 at 76 chars per RFC 2045. */
function wrapBase64(b64: string): string {
  return b64.match(/.{1,76}/g)?.join("\r\n") ?? b64;
}

/**
 * Build the RFC 2822 raw reply. Exported for tests.
 *
 * No attachments → a single text/plain part (byte-identical to the original
 * behavior). With attachments → multipart/mixed: the body part first, then one
 * base64 part per file. Chinese filenames are RFC5987-encoded in
 * Content-Disposition (filename*=UTF-8'') with an ascii `filename=` fallback.
 */
export function buildMimeReply(input: SendReplyInput): string {
  // RFC 2822 raw email. Subject prefixed with "Re:" if not already.
  const subject = input.subject.startsWith("Re:")
    ? input.subject
    : `Re: ${input.subject}`;

  const fromHeader = input.toName
    ? `${input.fromEmail}`
    : input.fromEmail;
  const toHeader = input.toName
    ? `"${input.toName}" <${input.toEmail}>`
    : input.toEmail;

  // RFC 2047 encoded subject for UTF-8 (Gmail handles raw UTF-8 ok)
  const subjectB64 = Buffer.from(subject, "utf-8").toString("base64");

  const body =
    input.bodyText.trim() +
    "\n\n" +
    "jeffhsieh09@gmail.com · +1 (510) 634-2307";

  const hasAttachments = !!input.attachments && input.attachments.length > 0;

  const headers = [`From: ${fromHeader}`, `To: ${toHeader}`, `Bcc: jeffhsieh09@gmail.com`, `Subject: =?UTF-8?B?${subjectB64}?=`, "MIME-Version: 1.0"];
  if (input.inReplyToMessageId) {
    headers.push(`In-Reply-To: ${input.inReplyToMessageId}`);
    headers.push(`References: ${input.inReplyToMessageId}`);
  }

  if (!hasAttachments) {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    headers.push("Content-Transfer-Encoding: 8bit");
    return [...headers, "", body].join("\r\n");
  }

  // multipart/mixed: body part + one part per attachment.
  const boundary = `packgo_${randomBytes(16).toString("hex")}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

  const lines: string[] = [...headers, ""];
  // Part 1 — the text body.
  lines.push(`--${boundary}`);
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push("Content-Transfer-Encoding: 8bit");
  lines.push("");
  lines.push(body);
  // Parts 2..N — attachments.
  for (const att of input.attachments!) {
    const ascii = asciiFilenameFallback(att.filename);
    const star = encodeRFC5987(att.filename);
    const b64 = wrapBase64(att.content.toString("base64"));
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${att.mimeType}; name="${ascii}"`);
    lines.push(
      `Content-Disposition: attachment; filename="${ascii}"; filename*=UTF-8''${star}`,
    );
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(b64);
  }
  lines.push(`--${boundary}--`);
  return lines.join("\r\n");
}

/**
 * Send a Gmail reply in the same thread. Respects AGENT_DRY_RUN env and
 * requires explicit per-call confirmation from pipeline.
 */
export async function sendReplyInThread(
  gmail: ReturnType<typeof buildGmailClient>,
  input: SendReplyInput
): Promise<SendReplyResult> {
  // Layer 1: env-level kill switch
  if (process.env.AGENT_DRY_RUN === "true") {
    return {
      ok: true,
      dryRun: true,
      reason: "AGENT_DRY_RUN=true env override",
    };
  }
  // Layer 2: caller must confirm (set when all policy gates pass)
  if (!input.confirmedAutoSendOk) {
    return {
      ok: true,
      dryRun: true,
      reason: "confirmedAutoSendOk=false - pipeline did not authorize send",
    };
  }

  try {
    const mime = buildMimeReply(input);
    const raw = Buffer.from(mime, "utf-8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const resp = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw,
        threadId: input.threadId,
      },
    });

    if (!resp.data.id || !resp.data.threadId) {
      return { ok: false, error: "Gmail returned empty id/threadId" };
    }
    return {
      ok: true,
      dryRun: false,
      messageId: resp.data.id,
      threadId: resp.data.threadId,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Test that the integration is still valid (refresh triggers if needed). */
export async function verifyConnection(
  integration: {
    accessToken: string;
    refreshToken: string;
    tokenExpiresAt?: Date | null;
  }
): Promise<{ ok: boolean; emailAddress?: string; error?: string }> {
  try {
    const gmail = buildGmailClient(integration);
    const profile = await gmail.users.getProfile({ userId: "me" });
    return { ok: true, emailAddress: profile.data.emailAddress ?? undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ════════════════════════════════════════════════════════════════════════
// gmail-push (2026-06-29) — Gmail push notifications via Cloud Pub/Sub.
//
// Flow:  users.watch(topic) → Gmail publishes to the Pub/Sub topic whenever
// the mailbox changes → Pub/Sub push-delivers a JSON envelope to
// POST /api/gmail/push → we diff via history.list(startHistoryId) → ingest.
//
// This is layered ON TOP of the existing every-3-min poll, which stays as
// fallback + reconciliation: push can miss messages, and a watch expires
// after ~7 days (must be renewed daily). See queue.ts (scheduleGmailWatchRenew)
// and the runbook docs/features/customer-cockpit/gmail-push-runbook.md.
// ════════════════════════════════════════════════════════════════════════

export type GmailWatchResult = {
  /** Mailbox historyId at the moment watch was (re)registered. */
  historyId: string;
  /** Epoch milliseconds when this watch expires (Gmail returns ms-since-epoch). */
  expirationMs: number;
};

/**
 * Register (or refresh) a Gmail push watch on the INBOX. Idempotent on Gmail's
 * side — calling watch again before expiry simply extends it and returns a
 * fresh historyId/expiration. `topicName` MUST be the fully-qualified Pub/Sub
 * topic, e.g. "projects/<gcp-project>/topics/<topic>".
 *
 * Returns the historyId (store as gmailIntegration.lastHistoryId — it is the
 * baseline the next history.list diffs from) and expirationMs (store as
 * gmailIntegration.watchExpiration so the renew cron knows when to re-arm).
 */
export async function registerGmailWatch(
  gmail: ReturnType<typeof buildGmailClient>,
  topicName: string,
): Promise<GmailWatchResult> {
  const resp = await gmail.users.watch({
    userId: "me",
    requestBody: {
      topicName,
      labelIds: ["INBOX"],
      // Only notify on INBOX changes (not every label flip across the mailbox).
      labelFilterBehavior: "INCLUDE",
    },
  });
  const historyId = resp.data.historyId;
  const expiration = resp.data.expiration; // string, ms-since-epoch
  if (!historyId || !expiration) {
    throw new Error(
      `Gmail watch returned incomplete response (historyId=${historyId}, expiration=${expiration})`,
    );
  }
  return { historyId: String(historyId), expirationMs: Number(expiration) };
}

/**
 * Stop an active Gmail watch (best-effort cleanup, e.g. on disconnect). Never
 * throws — a stop on an already-expired/absent watch is a no-op upstream.
 */
export async function stopGmailWatch(
  gmail: ReturnType<typeof buildGmailClient>,
): Promise<void> {
  try {
    await gmail.users.stop({ userId: "me" });
  } catch (e) {
    log.warn({ err: e }, "[gmail] users.stop failed (non-fatal)");
  }
}

/**
 * Incremental fetch: given the last-seen historyId, return the Gmail message
 * IDs added since then plus the newest historyId to persist as the next
 * baseline. Walks every history.list page (messagesAdded), de-dupes, and caps
 * at `maxMessages` to bound a burst. Only returns ids — the caller hydrates
 * each via the existing per-message path (so attachment parsing / dedup label
 * gating are reused unchanged).
 *
 * NOTE: a 404 from history.list means startHistoryId is too old (Gmail only
 * retains a limited window). The caller must treat that as "fall back to the
 * time-window poll" rather than a hard failure — surfaced via `expired: true`.
 */
export async function listHistoryMessageIds(
  gmail: ReturnType<typeof buildGmailClient>,
  startHistoryId: string,
  opts?: { maxMessages?: number; labelId?: string },
): Promise<{ messageIds: string[]; latestHistoryId: string | null; expired: boolean }> {
  const maxMessages = opts?.maxMessages ?? 100;
  const ids = new Set<string>();
  let latestHistoryId: string | null = null;
  let pageToken: string | undefined;

  try {
    do {
      const resp = await gmail.users.history.list({
        userId: "me",
        startHistoryId,
        historyTypes: ["messageAdded"],
        ...(opts?.labelId ? { labelId: opts.labelId } : {}),
        ...(pageToken ? { pageToken } : {}),
        maxResults: 500,
      });
      if (resp.data.historyId) latestHistoryId = String(resp.data.historyId);
      for (const h of resp.data.history ?? []) {
        for (const added of h.messagesAdded ?? []) {
          const id = added.message?.id;
          if (id) ids.add(id);
        }
      }
      pageToken = resp.data.nextPageToken ?? undefined;
      if (ids.size >= maxMessages) break;
    } while (pageToken);
  } catch (e: any) {
    // 404 → startHistoryId outside Gmail's retention window. Signal expiry so
    // the caller re-baselines + leans on the time-window poll instead.
    const status = e?.code ?? e?.response?.status;
    if (status === 404) {
      log.warn({ startHistoryId }, "[gmail] history.list 404 — historyId expired, falling back to poll");
      return { messageIds: [], latestHistoryId: null, expired: true };
    }
    throw e;
  }

  return {
    messageIds: Array.from(ids).slice(0, maxMessages),
    latestHistoryId,
    expired: false,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Pure parsers for the Pub/Sub push webhook — extracted so the route stays
// thin and these can be unit-tested with zero network / DB / googleapis deps.
// ──────────────────────────────────────────────────────────────────────────

/** The decoded inner payload Gmail publishes inside the Pub/Sub message data. */
export type GmailPushNotification = {
  emailAddress: string;
  /** historyId is a string in the decoded JSON; we keep it as-is. */
  historyId: string;
};

/**
 * Parse a Pub/Sub push envelope (the raw HTTP body) into the Gmail
 * notification. Pub/Sub wraps the payload as:
 *   { message: { data: base64(JSON), messageId, publishTime }, subscription }
 * and the base64-decoded `data` is { emailAddress, historyId }.
 *
 * Returns null for any malformed shape (so the webhook can 204-ack and move on
 * rather than throw — a poison message must not wedge the subscription). Pure.
 */
export function decodePubSubPushBody(
  rawBody: string | Buffer,
): GmailPushNotification | null {
  let envelope: any;
  try {
    const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
    envelope = JSON.parse(text);
  } catch {
    return null;
  }
  const dataB64 = envelope?.message?.data;
  if (typeof dataB64 !== "string" || dataB64.length === 0) return null;
  let inner: any;
  try {
    // Pub/Sub uses standard base64 (not base64url) for message.data.
    inner = JSON.parse(Buffer.from(dataB64, "base64").toString("utf8"));
  } catch {
    return null;
  }
  const emailAddress = inner?.emailAddress;
  const historyId = inner?.historyId;
  if (typeof emailAddress !== "string" || !emailAddress) return null;
  if (historyId === undefined || historyId === null) return null;
  return { emailAddress, historyId: String(historyId) };
}

/**
 * Extract the bare JWT from an `Authorization: Bearer <jwt>` header value.
 * Returns null when the header is absent or not a Bearer token. Pure.
 */
export function extractBearerToken(
  authHeader: string | undefined | null,
): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
