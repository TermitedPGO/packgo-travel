/**
 * Eval scorecard — 純彙整 + 終端機格式化。
 *
 * 沒有副作用、不碰 LLM、不碰 DB ——所有判定邏輯放這裡,才能用 Vitest
 * 窮舉測試(judge / runner 的非決定性部分不進這支)。
 */

import {
  type CaseResult,
  type Scorecard,
  type JudgeVerdict,
  PASS_THRESHOLDS,
} from "./types";

/** 一個 case 的所有 binary 檢查是否全過(沒有檢查 → 視為過)。 */
export function caseChecksPass(r: CaseResult): boolean {
  if (r.error) return false;
  return r.checks.every((c) => c.pass);
}

/** PURE —— 取 judge 的 safety 維度分數(沒 judge / 沒 safety 維度 → null)。 */
export function safetyScore(judge: JudgeVerdict | null): number | null {
  if (!judge) return null;
  const d = judge.dimensions.find((x) => x.name === "safety");
  return d ? d.score : null;
}

/** 把每個 case 的結果彙整成 Scorecard,並依門檻判定整體 pass/fail。 */
export function buildScorecard(results: CaseResult[]): Scorecard {
  const total = results.length;
  const classificationPass = results.filter(caseChecksPass).length;

  const judgedResults = results.filter((r) => r.judge !== null);
  const judged = judgedResults.length;
  const judgePass = judgedResults.filter((r) => r.judge!.pass).length;
  const avgJudgeScore =
    judged === 0
      ? null
      : Math.round(
          judgedResults.reduce((sum, r) => sum + r.judge!.overall, 0) / judged
        );

  const classRate = total === 0 ? 1 : classificationPass / total;
  const everyJudgePass = judged === 0 ? true : judgePass === judged;

  // safety 硬底線:任何有 judge 的 case，safety 維度低於 minSafetyScore → 整體不過。
  // 這條獨立於 LLM 自報的 pass，也不會被四維平均稀釋(safety=55、其他=90，平均 81
  // 也照樣擋掉)。少了它,一個橡皮圖章的 judge 就能讓爛草稿溜過去。
  const safetyFloorPass = judgedResults.every((r) => {
    const s = safetyScore(r.judge);
    return s === null || s >= PASS_THRESHOLDS.minSafetyScore;
  });

  const pass =
    classRate >= PASS_THRESHOLDS.minClassificationRate &&
    (avgJudgeScore === null ||
      avgJudgeScore >= PASS_THRESHOLDS.minAvgJudgeScore) &&
    (!PASS_THRESHOLDS.requireEveryJudgePass || everyJudgePass) &&
    safetyFloorPass;

  return {
    total,
    classificationPass,
    avgJudgeScore,
    judgePass,
    judged,
    safetyFloorPass,
    pass,
    results,
  };
}

/** 把 Scorecard 渲染成可貼進終端機的字串(runner 用 console.log 印)。 */
export function formatScorecard(card: Scorecard): string {
  const lines: string[] = [];
  const tick = (b: boolean) => (b ? "PASS" : "FAIL");

  lines.push("");
  lines.push("════════════════ INQUIRY AGENT EVAL ════════════════");
  for (const r of card.results) {
    const cls = caseChecksPass(r) ? "PASS" : "FAIL";
    const j = r.judge ? `judge ${r.judge.overall}/100 ${tick(r.judge.pass)}` : "judge —";
    lines.push(`  [${cls}] ${r.caseId.padEnd(22)} ${j}`);
    if (r.error) {
      lines.push(`         ✗ error: ${r.error}`);
    }
    for (const c of r.checks.filter((c) => !c.pass)) {
      lines.push(`         ✗ ${c.name}: ${c.detail ?? "failed"}`);
    }
    if (r.judge && !r.judge.pass) {
      lines.push(`         ✗ judge: ${r.judge.summary}`);
    }
    const s = safetyScore(r.judge);
    if (s !== null && s < PASS_THRESHOLDS.minSafetyScore) {
      lines.push(
        `         ✗ safety floor: safety ${s} < ${PASS_THRESHOLDS.minSafetyScore}`
      );
    }
  }
  lines.push("─────────────────────────────────────────────────────");
  lines.push(
    `  classification: ${card.classificationPass}/${card.total} correct`
  );
  if (card.judged > 0) {
    lines.push(
      `  judge:          avg ${card.avgJudgeScore}/100 · ${card.judgePass}/${card.judged} passed`
    );
    if (!card.safetyFloorPass) {
      lines.push(
        `  safety floor:   FAIL — a case scored safety < ${PASS_THRESHOLDS.minSafetyScore}`
      );
    }
  }
  lines.push(`  OVERALL:        ${tick(card.pass)}`);
  lines.push("═════════════════════════════════════════════════════");
  lines.push("");
  return lines.join("\n");
}
