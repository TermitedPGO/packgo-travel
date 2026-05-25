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

import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { ENV } from "./env";
import { decryptToken } from "./tokenCrypto";
import { createChildLogger } from "./logger";
const log = createChildLogger({ module: "gmail" });

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
 */
export async function listUnreadMessages(
  gmail: ReturnType<typeof buildGmailClient>,
  sinceSeconds?: number,
  maxResults = 25
): Promise<GmailMessageSummary[]> {
  const queryParts = ["is:unread", "-from:noreply"];
  if (sinceSeconds) queryParts.push(`after:${sinceSeconds}`);
  const query = queryParts.join(" ");
  const listResp = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });
  const messages = listResp.data.messages ?? [];
  const results: GmailMessageSummary[] = [];
  for (const m of messages) {
    if (!m.id || !m.threadId) continue;
    try {
      const full = await gmail.users.messages.get({
        userId: "me",
        id: m.id,
        format: "full",
      });
      const summary = parseMessage(full.data);
      // 2026-05-25 Phase 7 — fetch + parse attachments inline.
      // Failures don't block the message; we just log + leave attachments=[].
      try {
        summary.attachments = await fetchAndParseAttachments(
          gmail,
          m.id,
          full.data.payload
        );
      } catch (attachErr) {
        log.warn(
          { err: attachErr, messageId: m.id },
          "[gmail] failed to parse attachments — continuing with body only"
        );
      }
      results.push(summary);
    } catch (e) {
      log.warn({ err: e, messageId: m.id }, "[gmail] failed to fetch message");
    }
  }
  return results;
}

function parseMessage(msg: any): GmailMessageSummary {
  const headers = msg.payload?.headers ?? [];
  const headerMap: Record<string, string> = {};
  for (const h of headers) {
    if (h.name && h.value) headerMap[h.name.toLowerCase()] = h.value;
  }
  return {
    id: msg.id,
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

export type SendReplyInput = {
  threadId: string;
  toEmail: string;
  toName?: string;
  subject: string;
  bodyText: string;
  fromEmail: string;
  confirmedAutoSendOk: boolean;
  inReplyToMessageId?: string;
};

export type SendReplyResult =
  | { ok: true; messageId: string; threadId: string; dryRun: false }
  | { ok: true; dryRun: true; reason: string }
  | { ok: false; error: string };

function buildMimeReply(input: SendReplyInput): string {
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
    "—\n" +
    "本訊息由 PACK&GO AI 助理自動回覆。如需直接聯絡 Jeff,請回覆此信。\n" +
    "PACK&GO Travel · jeffhsieh09@gmail.com · +1 (510) 634-2307";

  const lines = [
    `From: ${fromHeader}`,
    `To: ${toHeader}`,
    `Bcc: jeffhsieh09@gmail.com`,
    `Subject: =?UTF-8?B?${subjectB64}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  if (input.inReplyToMessageId) {
    lines.push(`In-Reply-To: ${input.inReplyToMessageId}`);
    lines.push(`References: ${input.inReplyToMessageId}`);
  }
  lines.push("");
  lines.push(body);
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
      reason: "confirmedAutoSendOk=false — pipeline did not authorize send",
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
