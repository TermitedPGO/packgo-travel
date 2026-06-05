/**
 * Generic classification eval metrics. Pure, dependency free.
 *
 * This is the reusable core of the agent improvement engine ("AI 練 AI"):
 * every agent we tune (Gmail customer-vs-noise classifier first, the
 * bookkeeping classifier next) produces (predicted, truth) pairs, and this
 * module turns them into the numbers a change is judged by. No guessing: a
 * change ships only if these metrics move the right way against a frozen gold
 * set.
 *
 * Design notes:
 *  - A metric that is genuinely undefined returns null, never a fake 0 or NaN.
 *    The Gmail case is exactly why: support@ had ~0 real customers, so customer
 *    recall has no denominator. Reporting "recall 0.0" there would be a lie.
 *    null says "not measurable with this corpus", which is the honest signal.
 *  - positiveClass lets a caller name the class it cares about most (customer),
 *    surfaced separately because for this engine customer recall is the
 *    priority metric: missing a real customer is the costly error.
 */

export interface Labeled<L extends string = string> {
  predicted: L;
  truth: L;
}

export interface PerClassMetrics {
  label: string;
  /** rows whose truth is this label */
  support: number;
  /** rows predicted as this label */
  predictedCount: number;
  tp: number;
  fp: number;
  fn: number;
  /** tp / (tp + fp); null when nothing was predicted as this label */
  precision: number | null;
  /** tp / (tp + fn); null when there are no true examples (support 0) */
  recall: number | null;
  /** harmonic mean of precision and recall; null when either is null */
  f1: number | null;
}

export interface ClassificationReport {
  /** total rows scored */
  n: number;
  /** every label seen in truth or predictions (sorted), plus any caller-declared */
  classes: string[];
  /** correct / n; null when n is 0 */
  accuracy: number | null;
  perClass: Record<string, PerClassMetrics>;
  /** mean of the per-class F1 values that are defined; null when none are */
  macroF1: number | null;
  /** confusion[truth][predicted] = count */
  confusion: Record<string, Record<string, number>>;
  /** copy of the caller's priority class metrics, when positiveClass is given */
  positive?: PerClassMetrics;
}

function f1Of(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null) return null;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Score a set of (predicted, truth) rows. classes/positiveClass are optional;
 * any label appearing in the data is included automatically.
 */
export function computeReport<L extends string>(
  rows: ReadonlyArray<Labeled<L>>,
  opts: { positiveClass?: L; classes?: ReadonlyArray<L> } = {},
): ClassificationReport {
  const classSet = new Set<string>(opts.classes ?? []);
  for (const r of rows) {
    classSet.add(r.truth);
    classSet.add(r.predicted);
  }
  const classes = [...classSet].sort();

  const confusion: Record<string, Record<string, number>> = {};
  for (const t of classes) {
    confusion[t] = {};
    for (const p of classes) confusion[t][p] = 0;
  }

  let correct = 0;
  for (const r of rows) {
    confusion[r.truth][r.predicted]++;
    if (r.truth === r.predicted) correct++;
  }

  const perClass: Record<string, PerClassMetrics> = {};
  for (const label of classes) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let support = 0;
    let predictedCount = 0;
    for (const r of rows) {
      const isTruth = r.truth === label;
      const isPred = r.predicted === label;
      if (isTruth) support++;
      if (isPred) predictedCount++;
      if (isTruth && isPred) tp++;
      else if (isPred) fp++;
      else if (isTruth) fn++;
    }
    const precision = tp + fp === 0 ? null : tp / (tp + fp);
    const recall = support === 0 ? null : tp / support;
    perClass[label] = { label, support, predictedCount, tp, fp, fn, precision, recall, f1: f1Of(precision, recall) };
  }

  const definedF1 = classes.map((c) => perClass[c].f1).filter((v): v is number => v !== null);
  const macroF1 = definedF1.length ? definedF1.reduce((a, b) => a + b, 0) / definedF1.length : null;

  const report: ClassificationReport = {
    n: rows.length,
    classes,
    accuracy: rows.length === 0 ? null : correct / rows.length,
    perClass,
    macroF1,
    confusion,
  };

  if (opts.positiveClass !== undefined) {
    // Always present, even if the class never appeared, so callers get a stable shape.
    report.positive =
      perClass[opts.positiveClass] ??
      {
        label: opts.positiveClass,
        support: 0,
        predictedCount: 0,
        tp: 0,
        fp: 0,
        fn: 0,
        precision: null,
        recall: null,
        f1: null,
      };
  }
  return report;
}

/** Render a report as a compact, PII-free text block safe to log or share. */
export function formatReport(report: ClassificationReport, opts: { title?: string } = {}): string {
  const pct = (v: number | null) => (v === null ? "  n/a" : `${(v * 100).toFixed(1).padStart(5)}%`);
  const lines: string[] = [];
  if (opts.title) lines.push(opts.title);
  lines.push(
    `n=${report.n}  accuracy=${report.accuracy === null ? "n/a" : `${(report.accuracy * 100).toFixed(1)}%`}  ` +
      `macroF1=${report.macroF1 === null ? "n/a" : report.macroF1.toFixed(3)}`,
  );
  lines.push("");
  lines.push("class            support  pred   prec   recall    f1");
  for (const c of report.classes) {
    const m = report.perClass[c];
    lines.push(
      `${c.padEnd(15)} ${String(m.support).padStart(7)} ${String(m.predictedCount).padStart(5)} ` +
        `${pct(m.precision)} ${pct(m.recall)} ${m.f1 === null ? "  n/a" : m.f1.toFixed(3).padStart(6)}`,
    );
  }
  if (report.positive) {
    lines.push("");
    lines.push(`priority class "${report.positive.label}": recall ${pct(report.positive.recall)} (support ${report.positive.support})`);
    if (report.positive.support === 0) {
      lines.push(`  NOTE: 0 true "${report.positive.label}" examples in this corpus, so recall is not measurable. Need a corpus with real positives.`);
    }
  }
  lines.push("");
  lines.push("confusion (rows=truth, cols=pred):");
  lines.push("truth\\pred".padEnd(15) + report.classes.map((c) => c.slice(0, 10).padStart(11)).join(""));
  for (const t of report.classes) {
    lines.push(t.padEnd(15) + report.classes.map((p) => String(report.confusion[t][p]).padStart(11)).join(""));
  }
  return lines.join("\n");
}
