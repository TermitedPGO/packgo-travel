/**
 * AccountingAgent 真實交易實測單 — 「鍛鍊 agent」eval core (2026-05-28).
 *
 * Jeff 的需求:拿真實交易考 agent。唯一可信的「標準答案」是 Jeff 自己
 * 手動改過的 `jeffOverrideCategory`(他親手分類 = ground truth)。本模組
 * 把每一筆「Jeff 已分類」的真實交易餵進 M2 的 preClassify(),比對它的判斷
 * 與 Jeff 的答案,分桶成 verdict,算出今天 M2 規則到底讓 agent 變多準。
 *
 * 設計鐵律(守「不準猜」):
 *   - 標準答案只認 jeffOverrideCategory。沒有 override 的交易不進考卷
 *     (我們沒有可信答案,絕不拿 agentCategory 自己當答案自己改)。
 *   - 本模組「只評分,不改規則」。發現 agent 還會錯的地方 → 列成候選,
 *     交 Jeff 決定要不要加進知識庫。不自動 remap。
 *
 * 這是 LEAF 模組:純函式,import 的 preClassify 也是純 leaf(無 DB/LLM)。
 * 因此可被 server/scripts/accounting-eval.ts 直接 import,也容易單測。
 */
import {
  preClassify,
  type PreClassifyResult,
} from "../agents/autonomous/accountingKnowledge";

/** 一筆考題:prod bankTransactions row(join 帳戶)投影出的最小欄位。 */
export interface EvalRowLike {
  id: number;
  date: string;
  /** Plaid 慣例:>0 出帳, <0 進帳。decimal string 或 number。 */
  amount: string | number | null;
  merchantName: string | null;
  description: string | null;
  originalDescription: string | null;
  /** Plaid payment_meta;preClassify 的 counterparty 取 payee→payer。 */
  paymentMeta?: { payee?: string | null; payer?: string | null } | null;
  accountName: string | null;
  accountType: string | null;
  /** agent 當初的判斷(可能為 null = 沒跑過 / 純 LLM 還沒填)。 */
  agentCategory: string | null;
  /** 標準答案 — Jeff 親手分類。本模組假設呼叫端已過濾成非 null。 */
  jeffOverrideCategory: string | null;
}

export type EvalVerdict =
  | "rule_correct" // 確定性命中(conf≥90)且 == 答案 → ✅ 省 LLM 還答對
  | "rule_wrong" // 確定性命中(conf≥90)卻 != 答案 → 🔴 規則 bug,最該修
  | "hint_correct" // 中信心提示(conf<90)== 答案 → 🟢 提示方向對
  | "hint_wrong" // 中信心提示(conf<90)!= 答案 → 🟠 提示會誤導 LLM
  | "llm_only_agent_ok" // 規則沉默,agentCategory == 答案 → 🟡 當初 LLM 接住了
  | "llm_only_agent_wrong" // 規則沉默,agentCategory != 答案 → 🟠 今天規則仍接不住(新規則候選)
  | "llm_only_no_agent"; // 規則沉默且沒有 agentCategory → ⚪ 無從評分

export interface EvalRecord {
  id: number;
  date: string;
  amount: number;
  /** preClassify 看到的對方(payee→payer)。 */
  counterparty: string;
  merchantName: string;
  accountName: string;
  truth: string; // jeffOverrideCategory
  agentCategory: string | null;
  preCategory: string | null;
  preConfidence: number;
  preSource: PreClassifyResult["source"];
  verdict: EvalVerdict;
}

export interface EvalSummary {
  total: number;
  ruleCorrect: number;
  ruleWrong: number;
  hintCorrect: number;
  hintWrong: number;
  llmOnlyAgentOk: number;
  llmOnlyAgentWrong: number;
  llmOnlyNoAgent: number;
  /** 確定性規則的精度 = ruleCorrect / (ruleCorrect+ruleWrong);無確定性命中 → null。 */
  deterministicAccuracy: number | null;
  /** 確定性覆蓋率 = (ruleCorrect+ruleWrong) / total;agent 有多少比例能不靠 LLM。 */
  deterministicCoverage: number;
  /** 該動手的錯誤集合 = ruleWrong(規則錯)+ llmOnlyAgentWrong(規則接不住且 LLM 也錯過)。 */
  actionableWrong: number;
}

export interface EvalReport {
  records: EvalRecord[];
  summary: EvalSummary;
}

/** payee→payer,對齊 accountingAgentService 的 candidateCounterparty 推導。 */
function deriveCandidate(
  pm: { payee?: string | null; payer?: string | null } | null | undefined,
): string | null {
  return (pm?.payee || pm?.payer || "").toString().trim() || null;
}

function toNum(a: string | number | null): number {
  return parseFloat(a as any) || 0;
}

/** 把一筆真實交易餵進 preClassify,對標準答案評分。 */
export function evalOneRow(row: EvalRowLike): EvalRecord {
  const amount = toNum(row.amount);
  const candidate = deriveCandidate(row.paymentMeta);
  const pre = preClassify({
    amount,
    merchantName: row.merchantName,
    description: row.description,
    originalDescription: row.originalDescription,
    counterparty: candidate,
    accountName: row.accountName,
    accountType: row.accountType,
  });

  const truth = String(row.jeffOverrideCategory ?? "");
  const agent = row.agentCategory ?? null;

  const deterministic = pre.category != null && pre.confidence >= 90;
  const hint = pre.category != null && pre.confidence < 90;

  let verdict: EvalVerdict;
  if (deterministic) {
    verdict = pre.category === truth ? "rule_correct" : "rule_wrong";
  } else if (hint) {
    verdict = pre.category === truth ? "hint_correct" : "hint_wrong";
  } else if (agent == null) {
    verdict = "llm_only_no_agent";
  } else {
    verdict = agent === truth ? "llm_only_agent_ok" : "llm_only_agent_wrong";
  }

  return {
    id: row.id,
    date: row.date,
    amount,
    counterparty: candidate ?? "",
    merchantName: row.merchantName ?? "",
    accountName: row.accountName ?? "",
    truth,
    agentCategory: agent,
    preCategory: pre.category,
    preConfidence: pre.confidence,
    preSource: pre.source,
    verdict,
  };
}

/** 評整份考卷。呼叫端負責先過濾成「jeffOverrideCategory 非 null」。 */
export function foldEvalRows(rows: EvalRowLike[]): EvalReport {
  const records = rows.map(evalOneRow);
  const s: EvalSummary = {
    total: records.length,
    ruleCorrect: 0,
    ruleWrong: 0,
    hintCorrect: 0,
    hintWrong: 0,
    llmOnlyAgentOk: 0,
    llmOnlyAgentWrong: 0,
    llmOnlyNoAgent: 0,
    deterministicAccuracy: null,
    deterministicCoverage: 0,
    actionableWrong: 0,
  };
  for (const r of records) {
    switch (r.verdict) {
      case "rule_correct":
        s.ruleCorrect++;
        break;
      case "rule_wrong":
        s.ruleWrong++;
        break;
      case "hint_correct":
        s.hintCorrect++;
        break;
      case "hint_wrong":
        s.hintWrong++;
        break;
      case "llm_only_agent_ok":
        s.llmOnlyAgentOk++;
        break;
      case "llm_only_agent_wrong":
        s.llmOnlyAgentWrong++;
        break;
      case "llm_only_no_agent":
        s.llmOnlyNoAgent++;
        break;
    }
  }
  const detHits = s.ruleCorrect + s.ruleWrong;
  s.deterministicAccuracy = detHits > 0 ? s.ruleCorrect / detHits : null;
  s.deterministicCoverage = s.total > 0 ? detHits / s.total : 0;
  s.actionableWrong = s.ruleWrong + s.llmOnlyAgentWrong;
  return { records, summary: s };
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function mdTable(records: EvalRecord[]): string {
  const head =
    "| 日期 | 對方/商家 | 金額 | 帳戶 | 答案(Jeff) | 規則判 | 信心 | agent當初 |\n" +
    "|------|-----------|------|------|------------|--------|------|-----------|";
  const lines = records.map((r) => {
    const party = (r.counterparty || r.merchantName || "—").slice(0, 28);
    const acct = (r.accountName || "—").slice(0, 18);
    const pre = r.preCategory ? `${r.preCategory}(${r.preSource})` : "—(交LLM)";
    return `| ${r.date} | ${party} | ${money(r.amount)} | ${acct} | ${r.truth} | ${pre} | ${r.preConfidence || "—"} | ${r.agentCategory ?? "—"} |`;
  });
  return [head, ...lines].join("\n");
}

/**
 * 把評分結果渲染成 markdown 實測單。重點:
 *   1. 摘要(精度 / 覆蓋率 / 該修錯誤數)
 *   2. 🔴 規則判錯 — 最該修(確定性規則 fire 卻跟 Jeff 答案不同 = bug)
 *   3. 🟠 規則仍接不住且 LLM 當初也錯 — 新規則候選(交 Jeff 決定)
 *   4. 🟠 提示會誤導 / ✅ 規則答對抽樣
 */
export function toEvalMarkdown(report: EvalReport): string {
  const { records, summary: s } = report;
  const ruleWrong = records.filter((r) => r.verdict === "rule_wrong");
  const llmWrong = records.filter((r) => r.verdict === "llm_only_agent_wrong");
  const hintWrong = records.filter((r) => r.verdict === "hint_wrong");
  const ruleCorrect = records.filter((r) => r.verdict === "rule_correct");

  const out: string[] = [];
  out.push(`# 記帳 Agent 真實交易實測單`);
  out.push(``);
  out.push(`標準答案 = Jeff 親手分類(jeffOverrideCategory)。考的是 M2 preClassify。`);
  out.push(``);
  out.push(`## 總分`);
  out.push(`- 考題數(Jeff 已分類的真實交易): **${s.total}**`);
  out.push(
    `- 確定性規則命中: **${s.ruleCorrect + s.ruleWrong}** 筆(覆蓋率 ${pct(s.deterministicCoverage)})— 這些不用花 LLM`,
  );
  out.push(
    `- 確定性規則精度: **${s.deterministicAccuracy == null ? "—" : pct(s.deterministicAccuracy)}**(答對 ${s.ruleCorrect} / 命中 ${s.ruleCorrect + s.ruleWrong})`,
  );
  out.push(`- 🔴 規則判錯(最該修): **${s.ruleWrong}**`);
  out.push(`- 🟠 規則接不住 + LLM 當初也錯(新規則候選): **${s.llmOnlyAgentWrong}**`);
  out.push(`- 🟠 中信心提示方向錯: **${s.hintWrong}**`);
  out.push(`- 🟡 規則沉默但 LLM 當初答對: **${s.llmOnlyAgentOk}**`);
  out.push(`- ⚪ 規則沉默且無 agent 紀錄(無從評分): **${s.llmOnlyNoAgent}**`);
  out.push(`- **該動手的錯誤合計: ${s.actionableWrong}**`);
  out.push(``);

  out.push(`## 🔴 規則判錯 — 最該修(${ruleWrong.length})`);
  out.push(
    `> 確定性規則(conf≥90)直接拍板,卻跟 Jeff 的答案不同 = 硬規則在真實交易上判錯,會污染帳。優先修 accountingKnowledge.ts。`,
  );
  out.push(ruleWrong.length ? mdTable(ruleWrong) : `(無 — 沒有規則在真實交易上判錯 ✅)`);
  out.push(``);

  out.push(`## 🟠 規則接不住、LLM 當初也分錯 — 新規則候選(${llmWrong.length})`);
  out.push(
    `> preClassify 沉默交給 LLM,LLM 當初的 agentCategory 跟 Jeff 答案不同。今天的規則還接不住這類。是否加進知識庫由 Jeff 決定(不自動改)。`,
  );
  out.push(llmWrong.length ? mdTable(llmWrong) : `(無)`);
  out.push(``);

  if (hintWrong.length) {
    out.push(`## 🟠 中信心提示方向錯(${hintWrong.length})`);
    out.push(`> memo 提示給了 LLM 錯方向(仍交 LLM 判,未必最終錯,但提示本身誤導)。`);
    out.push(mdTable(hintWrong));
    out.push(``);
  }

  out.push(`## ✅ 規則直接答對抽樣(共 ${ruleCorrect.length},顯示前 10)`);
  out.push(ruleCorrect.length ? mdTable(ruleCorrect.slice(0, 10)) : `(無確定性命中)`);
  out.push(``);
  return out.join("\n");
}
