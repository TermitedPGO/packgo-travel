/**
 * Gmail classifier eval harness (runner). Run from the repo root with tsx:
 *   tsx scripts/gmail-eval/score.ts [predictions.jsonl]
 *
 * Truth comes from data/gold.jsonl:
 *   truth = row.gold (Jeff's confirmed label) when present,
 *   else the auto-resolved high-confidence prelabel (needsReview === false),
 *   else the row is skipped (unconfirmed: it would only add noise).
 * This keeps the truth set independent of the classifier under test.
 *
 * Predictions: a JSONL of {"id": "...", "predicted": "customer"|"non-customer"}.
 * With no predictions file, the harness reports the trusted-truth class balance
 * only, so you can see whether the corpus even has enough real customers to
 * measure recall before wiring a classifier.
 *
 * Everything is local. No network. Only aggregate counts are printed (no PII).
 */
import * as fs from "fs";
import * as path from "path";
import { computeReport, formatReport, type Labeled } from "../../server/_core/evalEngine/classificationMetrics";

type Bin = "customer" | "non-customer";
const DATA = path.join(process.cwd(), "scripts", "gmail-eval", "data");

function readJsonl(file: string): any[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function binarize(label: string | null | undefined): Bin | null {
  if (!label) return null;
  if (label === "customer") return "customer";
  if (label === "uncertain") return null; // not a decision
  return "non-customer";
}

function trustedTruth(row: any): Bin | null {
  const confirmed = binarize(row.gold); // Jeff's confirmed gold wins
  if (confirmed) return confirmed;
  if (row.needsReview === false) return binarize(row.prelabel); // trust only high-confidence auto-resolved noise
  return null; // unconfirmed -> excluded from the eval set
}

const goldRows = readJsonl(path.join(DATA, "gold.jsonl"));
const predFile = process.argv[2];

const truthById = new Map<string, Bin>();
let excluded = 0;
for (const row of goldRows) {
  const t = trustedTruth(row);
  if (t) truthById.set(row.id, t);
  else excluded++;
}
const nCustomers = [...truthById.values()].filter((v) => v === "customer").length;
const nNon = truthById.size - nCustomers;

console.log(
  `gold rows: ${goldRows.length} | trusted-truth: ${truthById.size} ` +
    `(customer ${nCustomers}, non-customer ${nNon}) | excluded(unconfirmed): ${excluded}`,
);

if (!predFile) {
  console.log("\nNo predictions file given. Showing corpus balance only.");
  console.log('Usage: tsx scripts/gmail-eval/score.ts <predictions.jsonl>  (rows of {"id","predicted"})');
  if (nCustomers === 0) {
    console.log('\nWARNING: 0 trusted "customer" rows. Customer recall is NOT measurable on this corpus.');
    console.log("Add real customer mail (see data/inbox-samples/README.md) or pull a richer inbox before tuning.");
  }
  process.exit(0);
}

const predById = new Map<string, Bin | null>(readJsonl(path.resolve(predFile)).map((p) => [p.id, binarize(p.predicted)]));

const rows: Labeled<Bin>[] = [];
let missingPred = 0;
for (const [id, truth] of truthById) {
  const predicted = predById.get(id);
  if (!predicted) {
    missingPred++;
    continue;
  }
  rows.push({ truth, predicted });
}
if (missingPred) console.log(`(note: ${missingPred} truth rows had no prediction and were skipped)`);

console.log("\n" + formatReport(computeReport(rows, { positiveClass: "customer" }), { title: `Gmail classifier eval (${predFile})` }));
