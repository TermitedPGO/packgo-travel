/**
 * Gmail classifier eval — heuristic pre-labeler (NO LLM, NO network).
 *
 * Reads data/corpus.jsonl (from pull-corpus.cjs) and assigns a provisional
 * label using Gmail's own labels + cheap header heuristics. The point is NOT
 * to be the classifier; it is to (a) auto-resolve the obvious noise and
 * (b) surface the genuinely-uncertain + every customer-candidate for Jeff to
 * confirm. Jeff's confirmation is the ground truth.
 *
 * Labels (binary first): customer  vs  non-customer.
 * Non-customer subtypes: spam | newsletter | transactional | notification | personal_noise
 *
 * Outputs:
 *   data/gold.jsonl       — machine: one row per msg with prelabel + needs_review
 *   data/gold-review.md   — human: Jeff confirms the needs_review rows
 * Prints an aggregate summary (no PII) to stdout.
 */

const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "data");
const corpus = fs
  .readFileSync(path.join(DATA, "corpus.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

// Mirror of gmailPipeline.ts KNOWN_NOISE_DOMAINS, split by what they mean so
// the subtype is meaningful for taxonomy work.
const PAYMENT_DOMAINS = ["venmo.com", "paypal.com", "cash.app", "stripe.com", "intuit.com", "quickbooks"];
const NEWSLETTER_DOMAINS = ["substack.com", "beehiiv.com", "mailchimp.com", "convertkit.com", "robly.com", "constantcontact.com", "mailerlite.com", "mailchimpapp.com"];
const SOCIAL_DOMAINS = ["linkedin.com", "facebook.com", "twitter.com", "x.com", "instagram.com"];
const PLATFORM_DOMAINS = ["google.com", "youtube.com", "apple.com", "microsoft.com", "github.com", "notion.so", "slack.com", "fly.io", "cloudflare.com", "godaddy.com"];
const OWN_DOMAINS = ["packgoplay.com", "packgo-travel.fly.dev"];
const NOREPLY_RE = /(^|[._-])(no-?reply|do-?not-?reply|donotreply|noreply|mailer-daemon|postmaster|bounce[s]?|notifications?|alerts?|updates?|info|support|hello|team|news|digest)@/i;
const TXN_RE = /(order|receipt|invoice|payment|paid|statement|confirmation|confirmed|shipped|delivery|booking|reservation|itinerary|訂單|收據|發票|帳單|對帳|預訂|確認|出貨|付款)/i;

function domainOf(from) {
  const m = from.toLowerCase().match(/<([^>]+)>/) || from.toLowerCase().match(/([^\s]+@[^\s]+)/);
  if (!m) return "";
  const addr = m[1].trim();
  const at = addr.lastIndexOf("@");
  return at >= 0 ? addr.slice(at + 1) : "";
}
function hasDisplayName(from) {
  // "Name <a@b.com>" → has name; "a@b.com" → no name
  return /^[^<]*\S[^<]*<[^>]+>/.test(from.trim()) && !/^</.test(from.trim());
}
function domainIn(domain, list) {
  return list.some((d) => domain === d || domain.endsWith("." + d) || domain.includes(d));
}

function prelabel(msg) {
  const from = msg.from || "";
  const domain = domainOf(from);
  const labels = msg.labelIds || [];
  const text = `${msg.subject || ""} ${msg.snippet || ""}`;

  // 1. Gmail spam = strongest non-customer signal.
  if (labels.includes("SPAM")) return { label: "non-customer", subtype: "spam", conf: "high", reason: "Gmail SPAM label" };

  // 2. Bulk-mail header signals (List-Unsubscribe / Precedence / Auto-Submitted).
  if (msg.hasListUnsubscribe) return { label: "non-customer", subtype: "newsletter", conf: "high", reason: "List-Unsubscribe header (bulk mail)" };
  if (msg.precedence && /bulk|list|junk/i.test(msg.precedence)) return { label: "non-customer", subtype: "newsletter", conf: "high", reason: `Precedence: ${msg.precedence}` };
  if (msg.autoSubmitted && !/^no$/i.test(msg.autoSubmitted)) return { label: "non-customer", subtype: "notification", conf: "high", reason: `Auto-Submitted: ${msg.autoSubmitted}` };

  // 3. Sender-address shape: no-reply / role addresses.
  if (NOREPLY_RE.test(from)) return { label: "non-customer", subtype: "notification", conf: "high", reason: "no-reply / role sender address" };

  // 4. Known noise domains by category.
  if (domainIn(domain, OWN_DOMAINS)) return { label: "non-customer", subtype: "notification", conf: "high", reason: "own-system email" };
  if (domainIn(domain, PAYMENT_DOMAINS)) return { label: "non-customer", subtype: "transactional", conf: "high", reason: "payment provider" };
  if (domainIn(domain, NEWSLETTER_DOMAINS)) return { label: "non-customer", subtype: "newsletter", conf: "high", reason: "newsletter platform" };
  if (domainIn(domain, SOCIAL_DOMAINS)) return { label: "non-customer", subtype: "notification", conf: "high", reason: "social platform" };
  if (domainIn(domain, PLATFORM_DOMAINS)) return { label: "non-customer", subtype: "notification", conf: "medium", reason: "SaaS/platform notification" };

  // 5. Gmail category hints.
  if (labels.includes("CATEGORY_PROMOTIONS")) return { label: "non-customer", subtype: "newsletter", conf: "medium", reason: "Gmail Promotions category" };
  if (labels.includes("CATEGORY_UPDATES") && TXN_RE.test(text)) return { label: "non-customer", subtype: "transactional", conf: "medium", reason: "Updates category + txn keywords" };
  if (labels.includes("CATEGORY_UPDATES")) return { label: "non-customer", subtype: "notification", conf: "low", reason: "Updates category (no txn keyword)" };
  if (labels.includes("CATEGORY_SOCIAL")) return { label: "non-customer", subtype: "notification", conf: "high", reason: "Gmail Social category" };
  if (labels.includes("CATEGORY_FORUMS")) return { label: "non-customer", subtype: "notification", conf: "medium", reason: "Gmail Forums category" };

  // 6. Looks human (Personal category, real display name, unknown domain) → customer CANDIDATE.
  if (labels.includes("CATEGORY_PERSONAL") || hasDisplayName(from)) {
    return { label: "customer", subtype: "customer", conf: "low", reason: "human-looking sender, no bulk signals" };
  }

  // 7. Anything left → uncertain.
  return { label: "uncertain", subtype: "uncertain", conf: "low", reason: "no decisive signal" };
}

const gold = corpus.map((m) => {
  const pl = prelabel(m);
  const needsReview = pl.label === "customer" || pl.label === "uncertain" || pl.conf !== "high";
  return { ...m, prelabel: pl.label, subtype: pl.subtype, prelabelConf: pl.conf, prelabelReason: pl.reason, needsReview, gold: null };
});

fs.writeFileSync(path.join(DATA, "gold.jsonl"), gold.map((g) => JSON.stringify(g)).join("\n") + "\n");

// Human review file: needs_review rows first, then a summary of auto-resolved.
const review = gold.filter((g) => g.needsReview);
const auto = gold.filter((g) => !g.needsReview);
function trunc(s, n) { return (s || "").replace(/\s+/g, " ").slice(0, n); }
let md = `# Gold 標注確認 — 請 Jeff 核對\n\n`;
md += `語料:support@ live,${gold.length} 封(180 天)。下面 ${review.length} 封需要你確認;${auto.length} 封高信心雜訊已自動標(抽查即可)。\n\n`;
md += `**怎麼填**:在「你的判定」欄填 \`customer\` 或 \`non-customer\`(可順手改 subtype)。空白 = 同意預標。\n\n`;
md += `## 需確認(${review.length})\n\n`;
md += `| # | 預標 | 信心 | 寄件人 | 主旨 | 摘要 | 你的判定 |\n|---|---|---|---|---|---|---|\n`;
review.forEach((g, i) => {
  md += `| ${i + 1} | ${g.prelabel}/${g.subtype} | ${g.prelabelConf} | ${trunc(g.from, 45)} | ${trunc(g.subject, 40)} | ${trunc(g.snippet, 60)} | |\n`;
});
md += `\n## 自動標為非客人(高信心,抽查;${auto.length})\n\n`;
md += `| # | subtype | 寄件人 | 主旨 | 理由 |\n|---|---|---|---|---|\n`;
auto.forEach((g, i) => {
  md += `| ${i + 1} | ${g.subtype} | ${trunc(g.from, 45)} | ${trunc(g.subject, 38)} | ${g.prelabelReason} |\n`;
});
fs.writeFileSync(path.join(DATA, "gold-review.md"), md);

// Aggregate summary (safe — no PII).
const byLabel = {}, bySub = {};
for (const g of gold) { byLabel[g.prelabel] = (byLabel[g.prelabel] || 0) + 1; bySub[g.subtype] = (bySub[g.subtype] || 0) + 1; }
console.log("total:", gold.length);
console.log("by label:", JSON.stringify(byLabel));
console.log("by subtype:", JSON.stringify(bySub));
console.log("needs_review:", review.length, "| auto-resolved:", auto.length);
console.log("customer candidates:", gold.filter((g) => g.prelabel === "customer").length);
console.log("wrote: data/gold.jsonl, data/gold-review.md");
