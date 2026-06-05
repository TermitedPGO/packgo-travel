/**
 * Gmail classifier eval — ingest Jeff-provided sample emails.
 *
 * Reads everything Jeff drops into data/inbox-samples/ and normalizes it into
 * data/provided-corpus.jsonl (same shape as corpus.jsonl). Dependency-free
 * parsing; best-effort From / Subject / body extraction. Supports:
 *
 *   .eml   — a saved single email (drag out of Mail.app / Gmail "Download message")
 *   .mbox  — multiple emails concatenated (Gmail Takeout / Thunderbird export)
 *   .txt   — pasted emails, simple block format (see data/inbox-samples/README.md)
 *   .json  — array of { from, subject, body, label? }
 *
 * If Jeff marks a true label (LABEL: customer | non-customer in .txt, or a
 * `label` field in .json), it is carried through as `providedLabel` and used
 * as gold directly. Otherwise the email goes through the same heuristic
 * pre-label + Jeff-confirm flow as the support@ pull.
 *
 * Output is gitignored (real customer PII).
 */

const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "data", "inbox-samples");
const OUT = path.join(__dirname, "data", "provided-corpus.jsonl");

function stripHtml(s) {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Unfold RFC822 headers and grab the ones we need.
function parseEml(raw) {
  const splitAt = raw.search(/\r?\n\r?\n/);
  const headerPart = splitAt >= 0 ? raw.slice(0, splitAt) : raw;
  let body = splitAt >= 0 ? raw.slice(splitAt).trim() : "";
  const unfolded = headerPart.replace(/\r?\n[ \t]+/g, " ");
  const get = (name) => {
    const m = unfolded.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
    return m ? m[1].trim() : "";
  };
  if (/text\/html/i.test(headerPart) || /<[a-z][\s\S]*>/i.test(body)) body = stripHtml(body);
  return { from: get("From"), subject: get("Subject"), body };
}

function parseMbox(raw) {
  return raw
    .split(/\r?\nFrom .*\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseEml);
}

// .txt block format: header lines then `---` then body; emails separated by `===`.
function parseTxt(raw) {
  return raw
    .split(/\r?\n===+\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const sep = block.search(/\r?\n---+\r?\n/);
      const head = sep >= 0 ? block.slice(0, sep) : block;
      const body = sep >= 0 ? block.slice(block.indexOf("\n", sep + 1) + 1).trim() : "";
      const get = (name) => {
        const m = head.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
        return m ? m[1].trim() : "";
      };
      const label = get("LABEL").toLowerCase();
      return {
        from: get("FROM"),
        subject: get("SUBJECT"),
        body,
        providedLabel: label === "customer" || label === "non-customer" ? label : undefined,
      };
    });
}

if (!fs.existsSync(DIR)) {
  console.error("no inbox-samples dir yet: " + DIR);
  process.exit(0);
}
const files = fs.readdirSync(DIR).filter((f) => /\.(eml|mbox|txt|json)$/i.test(f));
if (files.length === 0) {
  console.log("inbox-samples/ is empty — nothing to ingest yet.");
  process.exit(0);
}

const records = [];
for (const f of files) {
  const raw = fs.readFileSync(path.join(DIR, f), "utf8");
  const ext = path.extname(f).toLowerCase();
  let parsed = [];
  if (ext === ".eml") parsed = [parseEml(raw)];
  else if (ext === ".mbox") parsed = parseMbox(raw);
  else if (ext === ".txt") parsed = parseTxt(raw);
  else if (ext === ".json") parsed = JSON.parse(raw).map((o) => ({ from: o.from || "", subject: o.subject || "", body: o.body || o.snippet || "", providedLabel: o.label }));
  parsed.forEach((p, i) => {
    if (!p.from && !p.subject && !p.body) return;
    records.push({
      id: `provided:${f}:${i}`,
      threadId: null,
      from: p.from || "",
      subject: p.subject || "",
      snippet: (p.body || "").replace(/\s+/g, " ").slice(0, 300),
      body: p.body || "",
      labelIds: [],
      source: "provided",
      providedLabel: p.providedLabel || null,
    });
  });
}

fs.writeFileSync(OUT, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
const withLabel = records.filter((r) => r.providedLabel).length;
console.log(`ingested ${records.length} emails from ${files.length} file(s)`);
console.log(`  with explicit label: ${withLabel} | need heuristic+confirm: ${records.length - withLabel}`);
console.log("wrote: data/provided-corpus.jsonl");
