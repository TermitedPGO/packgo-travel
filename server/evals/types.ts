/**
 * Eval framework — core types.
 *
 * 起點(2026-06-29):把 agent 評測從「vibe testing + 單元測試」升級成
 * Jess Yan 訪談描述的系統化 eval —— golden replay(固定輸入→期望) +
 * LLM-as-judge(自由文字品質,獨立 context window 採點以避免 bias)。
 *
 * 這層只放型別,沒有副作用。runner / judge / scorecard 各自 import。
 *
 * 與單元測試的分工:
 *   - Vitest(`pnpm test`)= 純邏輯、mock LLM、CI 每次跑、必須綠。
 *   - Eval(`pnpm eval:inquiry`)= 呼叫真 LLM、非決定性、要 API key、
 *     手動/排程跑、產出 scorecard。兩者不混用。
 */

/** 一個 golden case:固定輸入 + 期望分類 + 給 judge 的評分指引。 */
export type EvalCase = {
  /** 穩定 id(報表/diff 用,不要因順序變動)。 */
  id: string;
  /** 人看的一句話描述。 */
  description: string;
  /** 餵給 agent 的原文(subject + body 之類)。 */
  input: string;
  /** 期望分類(binary pass/fail 的依據)。null = 此 case 不檢分類。 */
  expectedClassification: string | null;
  /**
   * 給 LLM judge 的 case 專屬評分重點(rubric 的可變部分)。
   * 例:「必須說明簽證代辦流程,且不可承諾具體費用數字」。
   */
  rubricNotes?: string;
};

/** 二元檢查(分類對不對)的結果。 */
export type BinaryCheck = {
  name: string;
  pass: boolean;
  /** 失敗時的人看說明(expected vs actual)。 */
  detail?: string;
};

/** LLM judge 對單一維度的評分。 */
export type JudgeDimension = {
  /** correctness / tone / safety / completeness 之一。 */
  name: string;
  /** 0–100。 */
  score: number;
  reasoning: string;
};

/** LLM judge 的完整裁決(獨立 context window 產出)。 */
export type JudgeVerdict = {
  /** 0–100 總分 = 四維「未加權」平均(見 parseJudgeVerdict)。注意:safety 的硬
   *  底線由 scorecard 的 minSafetyScore 獨立把關,不靠這個平均。 */
  overall: number;
  /** 是否達標(由 judge 依 rubric 自行判定的硬底線,如 safety)。 */
  pass: boolean;
  dimensions: JudgeDimension[];
  /** 一句話總評。 */
  summary: string;
};

/** 單一 case 跑完的結果(binary + judge 合併)。 */
export type CaseResult = {
  caseId: string;
  description: string;
  /** agent 真的吐出的分類(null = agent 拋錯/未產出)。 */
  actualClassification: string | null;
  /** 分類等 binary 檢查。 */
  checks: BinaryCheck[];
  /** judge 裁決;agent 沒有 draft 可評時為 null。 */
  judge: JudgeVerdict | null;
  /** agent 執行期間的硬錯誤(throw)訊息,有值代表這個 case 整體 fail。 */
  error?: string;
};

/** 整批跑完的彙整。 */
export type Scorecard = {
  total: number;
  /** 所有 binary 檢查皆過的 case 數。 */
  classificationPass: number;
  /** judge overall 的平均(只計有 judge 的 case)。 */
  avgJudgeScore: number | null;
  /** judge pass 的 case 數。 */
  judgePass: number;
  /** judge 有評分的 case 數(分母)。 */
  judged: number;
  /** 每個有 judge 的 case,safety 維度都過 minSafetyScore 硬底線。 */
  safetyFloorPass: boolean;
  /** 整體是否達標(見 PASS_THRESHOLDS)。 */
  pass: boolean;
  results: CaseResult[];
};

/** 達標門檻 —— 調這裡就能收緊/放寬整個 eval suite。 */
export const PASS_THRESHOLDS = {
  /** 分類正確率下限。 */
  minClassificationRate: 1.0,
  /** judge 平均總分下限。 */
  minAvgJudgeScore: 80,
  /** 任何一個 case 的 judge.pass=false 都視為整體不過(safety 紅線)。 */
  requireEveryJudgePass: true,
  /** safety 維度硬底線:任何有 judge 的 case safety 低於此 → 整體不過。
   *  獨立閘 —— 不靠 LLM 自報的 pass、也不被四維平均稀釋。 */
  minSafetyScore: 70,
} as const;
