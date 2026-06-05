/**
 * Gmail classifier eval — corpus puller (READ-ONLY).
 *
 * Pulls a representative sample of RECEIVED mail from the connected support@
 * mailbox: inbox + spam + every Gmail category, read and unread. Emits minimal
 * fields only (from / subject / snippet / Gmail labelIds / date) as JSONL on
 * stdout, so we never bring full bodies to disk. Gmail's own labels (SPAM,
 * CATEGORY_PROMOTIONS, ...) become a pre-label signal for gold annotation.
 *
 * Runs INSIDE the Fly container (needs DATABASE_URL + APP_ENCRYPTION_KEY +
 * GMAIL_OAUTH_CLIENT_ID/SECRET + googleapis). It does NOT write anything back
 * to the DB or Gmail. Invoke via:
 *
 *   B64=$(base64 < scripts/gmail-eval/pull-corpus.cjs | tr -d '\n')
 *   fly ssh console -a packgo-travel -C "sh -c 'echo $B64 | base64 -d | node'" \
 *     > scripts/gmail-eval/data/corpus.jsonl 2> scripts/gmail-eval/data/pull.log
 *
 * Output corpus is gitignored (real customer PII).
 */

const crypto = require("crypto");
const mysql = require("mysql2/promise");
const { google } = require("googleapis");

const MAILBOX = "support@packgoplay.com";
const QUERY = "in:anywhere -in:sent -in:draft -in:chat -in:trash newer_than:180d";
const CAP = 500;
const CONCURRENCY = 10;

function decryptToken(stored) {
  const VERSION = "enc:v1:";
  if (typeof stored !== "string" || !stored.startsWith(VERSION)) return stored;
  const k = process.env.APP_ENCRYPTION_KEY || process.env.PLAID_ENCRYPTION_KEY;
  const key = Buffer.from(k, "base64");
  const buf = Buffer.from(stored.slice(VERSION.length), "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

(async () => {
  const c = await mysql.createConnection({ uri: process.env.DATABASE_URL });
  const [rows] = await c.execute(
    "SELECT accessToken, refreshToken, tokenExpiresAt FROM gmailIntegration WHERE emailAddress=? AND isActive=1 LIMIT 1",
    [MAILBOX],
  );
  await c.end();
  if (!rows[0]) {
    console.error("PULL_ERR: no active integration for " + MAILBOX);
    process.exit(1);
  }

  const oauth = new google.auth.OAuth2(
    process.env.GMAIL_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
    process.env.GMAIL_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth.setCredentials({
    access_token: decryptToken(rows[0].accessToken),
    refresh_token: decryptToken(rows[0].refreshToken),
    expiry_date: rows[0].tokenExpiresAt
      ? new Date(rows[0].tokenExpiresAt).getTime()
      : undefined,
  });
  const gmail = google.gmail({ version: "v1", auth: oauth });

  // 1. List message IDs across the mailbox (paginated).
  const ids = [];
  let pageToken;
  do {
    const r = await gmail.users.messages.list({
      userId: "me",
      q: QUERY,
      maxResults: 500,
      pageToken,
    });
    for (const m of r.data.messages || []) ids.push(m.id);
    pageToken = r.data.nextPageToken;
  } while (pageToken && ids.length < CAP);
  const capped = ids.slice(0, CAP);
  console.error(`PULL: listed ${ids.length} ids, fetching metadata for ${capped.length}`);

  // 2. Metadata-only get for each (no body leaves Gmail).
  const labelCounts = {};
  let emitted = 0;
  for (let i = 0; i < capped.length; i += CONCURRENCY) {
    const chunk = capped.slice(i, i + CONCURRENCY);
    const got = await Promise.all(
      chunk.map((id) =>
        gmail.users.messages
          .get({
            userId: "me",
            id,
            format: "metadata",
            metadataHeaders: ["From", "Subject", "List-Unsubscribe", "Precedence", "Auto-Submitted"],
          })
          .then((r) => r.data)
          .catch((e) => ({ __err: e.message })),
      ),
    );
    for (const g of got) {
      if (g.__err) continue;
      const hs = {};
      for (const h of g.payload?.headers || []) hs[h.name.toLowerCase()] = h.value;
      const labelIds = g.labelIds || [];
      for (const l of labelIds) labelCounts[l] = (labelCounts[l] || 0) + 1;
      process.stdout.write(
        JSON.stringify({
          id: g.id,
          threadId: g.threadId,
          from: hs["from"] || "",
          subject: hs["subject"] || "",
          snippet: g.snippet || "",
          labelIds,
          hasListUnsubscribe: Boolean(hs["list-unsubscribe"]),
          precedence: hs["precedence"] || null,
          autoSubmitted: hs["auto-submitted"] || null,
          internalDate: g.internalDate || null,
        }) + "\n",
      );
      emitted++;
    }
  }
  console.error(`PULL: emitted ${emitted} messages`);
  console.error("PULL: label distribution = " + JSON.stringify(labelCounts));
})().catch((e) => {
  console.error("PULL_ERR " + (e && e.message ? e.message : String(e)));
  process.exit(1);
});
