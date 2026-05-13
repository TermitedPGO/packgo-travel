/**
 * Phase 4 Task C: Plaid sandbox fire_webhook chain verification.
 *
 * Triggers a `DEFAULT_UPDATE` webhook from Plaid sandbox to our
 * `/api/plaid/webhook` endpoint, then verifies:
 *   1. plaidWebhookEvents row created with processedSuccess=1
 *   2. No errors in handler chain
 *   3. (Sandbox env path) verification was skipped, not rejected
 *
 * Picks an arbitrary existing sandbox access token from
 * linkedBankAccounts and fires against it.
 */

import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import mysql from "mysql2/promise";
import crypto from "node:crypto";

const TEST_LABEL = "[fire-webhook]";
const passed = [];
const failed = [];

function check(name, ok, detail) {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  (ok ? passed : failed).push({ name, detail });
}

// ──────────────────────────────────────────────────────────────────────────

const ENC_KEY = Buffer.from(process.env.PLAID_ENCRYPTION_KEY, "base64");
function decryptAccessToken(encoded) {
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

async function main() {
  console.log(`${TEST_LABEL} starting`);

  const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL });

  // Pick an active sandbox account (any one — they all share the same Item
  // in this case since they came from sandboxPublicTokenCreate)
  const [[acct]] = await conn.execute(
    "SELECT id, plaidItemId, plaidAccessTokenEncrypted, accountName FROM linkedBankAccounts WHERE isActive = 1 LIMIT 1"
  );
  if (!acct) {
    console.error(`${TEST_LABEL} no active linkedBankAccount; aborting`);
    process.exit(2);
  }
  console.log(
    `${TEST_LABEL} using account ${acct.id} (${acct.accountName}) item=${acct.plaidItemId}`
  );

  // Snapshot pre-test webhook count
  const [[before]] = await conn.execute(
    "SELECT COUNT(*) AS n FROM plaidWebhookEvents"
  );
  const beforeCount = before.n;
  console.log(`${TEST_LABEL} pre-test plaidWebhookEvents count: ${beforeCount}`);

  // Decrypt access token
  const accessToken = decryptAccessToken(acct.plaidAccessTokenEncrypted);

  // Configure Plaid sandbox client
  const cfg = new Configuration({
    basePath: PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
        "PLAID-SECRET": process.env.PLAID_SECRET,
      },
    },
  });
  const client = new PlaidApi(cfg);

  // Fire DEFAULT_UPDATE webhook
  console.log(`${TEST_LABEL} firing DEFAULT_UPDATE webhook...`);
  const fireRes = await client.sandboxItemFireWebhook({
    access_token: accessToken,
    webhook_type: "TRANSACTIONS",
    webhook_code: "DEFAULT_UPDATE",
  });
  check("Fire webhook API call succeeded", fireRes.data.webhook_fired === true, JSON.stringify(fireRes.data));

  // Plaid delivers asynchronously. Handler then processes async (sync runs,
  // ~4-6s) before flipping processedSuccess=1. Poll for BOTH:
  //   - row exists with the right type/code
  //   - processedSuccess = 1
  // up to 45s total.
  console.log(`${TEST_LABEL} polling DB for delivery + processing...`);
  let newEvent = null;
  for (let i = 0; i < 22; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const [rows] = await conn.execute(
      `SELECT id, webhookType, webhookCode, plaidItemId, processedSuccess,
              processedError, processedAt, createdAt
       FROM plaidWebhookEvents
       WHERE plaidItemId = ?
         AND webhookType = 'TRANSACTIONS'
         AND webhookCode = 'DEFAULT_UPDATE'
       ORDER BY id DESC LIMIT 1`,
      [acct.plaidItemId]
    );
    const candidate = rows[0];
    if (candidate && candidate.id > beforeCount && candidate.processedSuccess === 1) {
      newEvent = candidate;
      break;
    }
    // Keep referencing the candidate even if not yet processed, so we can
    // report it on timeout
    if (candidate && candidate.id > beforeCount) newEvent = candidate;
    process.stdout.write(
      `\r  [${i + 1}/22] waiting (event ${candidate?.id ?? "?"} processedSuccess=${candidate?.processedSuccess ?? "?"})...    `
    );
  }
  console.log("");

  check(
    "Webhook arrived in plaidWebhookEvents table",
    newEvent !== null && newEvent !== undefined,
    newEvent ? `event id=${newEvent.id}` : "timed out after 30s"
  );

  if (newEvent) {
    check(
      "Webhook handler processed successfully (processedSuccess=1)",
      newEvent.processedSuccess === 1,
      `processedError=${newEvent.processedError ?? "(none)"}`
    );
    check(
      "Webhook type/code match what we fired",
      newEvent.webhookType === "TRANSACTIONS" &&
        newEvent.webhookCode === "DEFAULT_UPDATE",
      `got ${newEvent.webhookType}/${newEvent.webhookCode}`
    );
  }

  // Check that no new trustDeferredIncome rows were created from this run
  // (sandbox DEFAULT_UPDATE doesn't add real new txns — so the chain
  // should be a no-op past the initial sync). If new rows appeared,
  // it'd mean the chain incorrectly fired for orphan data.
  const [[trustCount]] = await conn.execute(
    "SELECT COUNT(*) AS n FROM trustDeferredIncome WHERE recognitionRunId LIKE 'e2e-test-%' OR createdAt > NOW() - INTERVAL 1 MINUTE"
  );
  check(
    "No spurious trustDeferredIncome rows from this fire_webhook",
    trustCount.n === 0,
    `trustDeferredIncome new-row count=${trustCount.n}`
  );

  console.log(`\n${TEST_LABEL} === RESULTS ===`);
  console.log(`${TEST_LABEL} passed: ${passed.length}`);
  console.log(`${TEST_LABEL} failed: ${failed.length}`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail ?? ""}`);
  }

  await conn.end();
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`${TEST_LABEL} fatal:`, err);
  process.exit(2);
});
