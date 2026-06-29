/**
 * Eval runner —— InquiryAgent golden suite。
 *
 * 跑法:`pnpm eval:inquiry`(底層 `tsx server/evals/runInquiryEval.ts`)。
 * 需要真 LLM 金鑰(會打真 API + 花 token),所以**不**進 `pnpm test`。
 *
 * 退出碼:達標 0 / 未達標 1 —— 可直接接 CI gate 或排程(cron)。
 *
 * 這支是唯一允許 console.* 的檔(CLI 輸出);判定與彙整邏輯都在純的
 * scorecard.ts(有 Vitest),這裡只負責編排與印表。
 */

import { GOLDEN_CASES, evaluateCase } from "./inquiryGolden";
import { buildScorecard, formatScorecard } from "./scorecard";
import type { CaseResult } from "./types";

async function main() {
  console.log(`Running InquiryAgent eval — ${GOLDEN_CASES.length} golden cases...`);

  const results: CaseResult[] = [];
  // 序列跑:量小、避免 rate-limit,輸出順序穩定(好 diff)。
  for (const c of GOLDEN_CASES) {
    process.stdout.write(`  · ${c.id} ... `);
    const r = await evaluateCase(c);
    console.log(r.error ? "ERROR" : "done");
    results.push(r);
  }

  const card = buildScorecard(results);
  console.log(formatScorecard(card));

  process.exit(card.pass ? 0 : 1);
}

main().catch((e) => {
  console.error("eval runner crashed:", e);
  process.exit(1);
});
