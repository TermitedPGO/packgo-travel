/**
 * draftEval — customer-cockpit Phase3 3b「月度草稿誠實度評分」。
 *
 * 起因(Jeff):2026-06-25 手動跑過一次「拿真實客人對話重生草稿,丟給多個獨立
 * 評審 LLM 逐條打分,抓吹牛/重複已交付的承諾/認錯收件人這三宗罪」,抓到真問題
 * 也修好了。這支把那次一次性流程做成每月自動跑的機制,分數寫進
 * docs/features/customer-cockpit/eval-history.md,劣化立刻可見。
 *
 * 這整套是**唯讀評分機制**:
 *   - runInquiryAgent 是純函式、零副作用(不寫 DB、不寄信),重生的草稿只在
 *     記憶體裡活著,拿給評審 LLM 看完就丟掉,絕不落地存進客人看得到的地方。
 *   - 評審 LLM 呼叫一樣零副作用,只回結構化分數。
 *   - 全程不呼叫任何寄信/送出草稿函式(sendEscalationReply 等)。
 *
 * 四層職責分離:
 *   a. selectEvalSampleCustomers — 唯一碰 DB 的「選樣本」函式。
 *   b. runDraftEvalForCustomer — 組 runInquiryAgent 輸入 + 呼叫 + 3 個獨立評審。
 *   c. aggregateDraftEvalScores — 純函式,零 I/O,零 LLM(驗收要求的核心可測函式)。
 *   d. runMonthlyDraftEval — 協調函式,單一客人失敗不拖垮整批,寫 eval-history.md
 *      + 一張 agentMessages 卡。
 *   + parseLastMonthScore — 純函式,零 I/O,讀 eval-history.md 抓上個月分數。
 *
 * runInquiryAgent 輸入怎麼組:照抄 server/agents/autonomous/gmailPipeline.ts
 * 的既有組法(唯一的正式生產呼叫點)——rawMessage 用這位客人最新一筆 inbound
 * interaction 的內容、threadHistory 用這位客人近期 interactions 轉成
 * {direction, body} 陣列(舊→新)、recentInteractions 用最近 5 筆、
 * customerProfile 用 customerProfiles 對應欄位。policyRules 略過不傳
 * (undefined)——runInquiryAgent 內部會 fallback 用 DEFAULT_INQUIRY_POLICY,
 * 評分場景不需要 Jeff 當下生效的 auto-send policy,只需要看草稿品質。
 *
 * Opus 呼叫的 empty-content 防呆:照抄 opsAgentStream.ts 既有邏輯
 * (`if (!turn.content || !turn.content.trim()) continue;`)——組評審看的
 * threadHistory / 對話歷史時,任何空 content 輪次一律先濾掉,否則 Opus 會整個
 * 400。llm.ts 的 InvokeParams 型別本來就沒有 temperature 欄位,不會誤傳。
 */
import { invokeLLM } from "./llm";
import { parseLlmJson } from "./parseLlmJson";
import { todayLA } from "./customerFacts";
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "draftEval" });

const JUDGE_MODEL = "claude-opus-4-6";
const JUDGE_COUNT = 3;
const SAMPLE_LIMIT = 10;
const SAMPLE_WINDOW_DAYS = 30;
const DEGRADE_THRESHOLD = 1; // 綜合分掉 >= 1 分就算劣化

const EVAL_HISTORY_PATH = "docs/features/customer-cockpit/eval-history.md";

// ────────────────────────────────────────────────────────────────────────
// a) selectEvalSampleCustomers — 唯一碰 DB 的「選樣本」函式。
// ────────────────────────────────────────────────────────────────────────

export interface EvalSampleCustomer {
  profileId: number;
  lastInteractionAt: Date;
}

/**
 * 近 30 天(America/Los_Angeles 曆日,用既有 todayLA 取得今天日期,不用 server
 * 本地時間)在 customerInteractions 有紀錄的客人,去重後取最近互動時間最新的
 * 前 10 位。
 *
 * 選擇理由:最近互動的客人代表「這個月系統真的在跟他們互動」,他們的草稿品質
 * 最貼近「Jeff 現在真的在用的系統長什麼樣子」——比隨機取樣更能反映當下風險
 * (例如某個 prompt 改動剛好在這個月上線,最近互動的客人最先踩到)。上限 10
 * 位是為了控制每月評分成本(10 位 * 3 個獨立評審 LLM 呼叫 = 30 次 Opus 呼叫,
 * 一人公司規模下這個量已經足夠代表性,不需要跑全量)。
 */
export async function selectEvalSampleCustomers(): Promise<EvalSampleCustomer[]> {
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) return [];

  const { customerInteractions } = await import("../../drizzle/schema");
  const { sql } = await import("drizzle-orm");

  const today = todayLA();
  const since = new Date(`${today}T00:00:00-07:00`);
  since.setUTCDate(since.getUTCDate() - SAMPLE_WINDOW_DAYS);

  const rows = await db
    .select({
      customerProfileId: customerInteractions.customerProfileId,
      lastAt: sql<Date>`MAX(${customerInteractions.createdAt})`,
    })
    .from(customerInteractions)
    .where(sql`${customerInteractions.createdAt} >= ${since}`)
    .groupBy(customerInteractions.customerProfileId)
    .orderBy(sql`MAX(${customerInteractions.createdAt}) DESC`)
    .limit(SAMPLE_LIMIT);

  return rows
    .filter((r) => r.customerProfileId != null)
    .map((r) => ({
      profileId: r.customerProfileId as number,
      lastInteractionAt: r.lastAt,
    }));
}

// ────────────────────────────────────────────────────────────────────────
// b) runDraftEvalForCustomer — 組 runInquiryAgent 輸入 + 呼叫 + 3 個獨立評審。
// ────────────────────────────────────────────────────────────────────────

export interface JudgeRawResult {
  accuracyScore: number; // 事實準確度 1-10
  toneScore: number; // 語氣得體度 1-10
  completenessScore: number; // 回覆完整度 1-10
  overbold: boolean; // 吹牛(承諾系統辦不到的事/誇大)
  repeatsFulfilledPromise: boolean; // 重複已交付的承諾
  wrongRecipient: boolean; // 認錯收件人(叫錯名字/搞混其他客人的事)
  notes: string;
}

const JUDGE_SYSTEM = `你是 PACK&GO 旅行社草稿品質稽核員。你會收到:(1) 這位客人的真實歷史對話與資料當「事實依據」,(2) AI 剛重生的一份回信草稿(這封草稿從未寄出,只是拿給你評分用)。

你的任務是拿事實依據逐項比對草稿,不是憑語感打分。特別抓三類已經出過真事故的問題:
1. 吹牛(overbold):草稿承諾了系統/公司辦不到的事,或誇大了實際狀況。
2. 重複已交付的承諾(repeatsFulfilledPromise):草稿又提了一次事實依據裡顯示「已經處理完/已經給過」的東西,像是還沒做。
3. 認錯收件人(wrongRecipient):草稿叫錯名字,或把其他客人的行程/訂單細節安在這位客人身上。

三個布林旗標寧可過度標記也不要漏抓——抓到一絲可疑就標 true。
accuracyScore/toneScore/completenessScore 都是 1-10 整數,10 分最好。
只輸出結構化 JSON,不要其他文字。`;

function buildJudgeUserPrompt(params: {
  draftText: string;
  factsBlock: string;
}): string {
  return [
    "<客人真實資料與歷史對話_事實依據>",
    params.factsBlock,
    "</客人真實資料與歷史對話>",
    "",
    "<AI重生的草稿_待評分_從未寄出>",
    params.draftText,
    "</AI重生的草稿>",
  ].join("\n");
}

/**
 * 獨立呼叫一次評審 LLM(不共用對話歷史,每次都是全新的 invokeLLM 呼叫)。
 * 任何失敗都往外 throw——呼叫端(runDraftEvalForCustomer/runMonthlyDraftEval)
 * 負責決定要不要吞掉,讓一位客人評分失敗不拖垮整批。
 */
async function invokeOneJudge(params: {
  draftText: string;
  factsBlock: string;
}): Promise<JudgeRawResult> {
  const result = await invokeLLM({
    model: JUDGE_MODEL,
    messages: [
      { role: "system", content: JUDGE_SYSTEM },
      { role: "user", content: buildJudgeUserPrompt(params) },
    ],
    maxTokens: 1500,
    purpose: "draft_eval_judge",
    outputSchema: {
      name: "draft_eval_judge_result",
      schema: {
        type: "object",
        properties: {
          accuracyScore: { type: "number" },
          toneScore: { type: "number" },
          completenessScore: { type: "number" },
          overbold: { type: "boolean" },
          repeatsFulfilledPromise: { type: "boolean" },
          wrongRecipient: { type: "boolean" },
          notes: { type: "string" },
        },
        required: [
          "accuracyScore",
          "toneScore",
          "completenessScore",
          "overbold",
          "repeatsFulfilledPromise",
          "wrongRecipient",
          "notes",
        ],
      },
    },
  } as Parameters<typeof invokeLLM>[0]);

  const raw =
    result?.choices?.[0]?.message?.content ??
    (result?.choices?.[0]?.message as { tool_calls?: Array<{ function?: { arguments?: string } }> })
      ?.tool_calls?.[0]?.function?.arguments ??
    "";
  const rawText = typeof raw === "string" ? raw : "";
  if (!rawText.trim()) {
    throw new Error("draftEval judge: empty LLM response");
  }

  const parsed = parseLlmJson<Partial<JudgeRawResult>>(rawText);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("draftEval judge: unparseable LLM response");
  }

  return {
    accuracyScore: Number(parsed.accuracyScore ?? 0),
    toneScore: Number(parsed.toneScore ?? 0),
    completenessScore: Number(parsed.completenessScore ?? 0),
    overbold: !!parsed.overbold,
    repeatsFulfilledPromise: !!parsed.repeatsFulfilledPromise,
    wrongRecipient: !!parsed.wrongRecipient,
    notes: typeof parsed.notes === "string" ? parsed.notes : "",
  };
}

/**
 * 濾掉空 content 輪次(照抄 opsAgentStream.ts 既有防呆),把 threadHistory
 * 轉成給評審看的事實依據文字區塊。
 */
function buildFactsBlock(params: {
  customerProfile: { id: number; name?: string | null; email?: string | null } | null;
  threadHistory: Array<{ direction: "inbound" | "outbound"; from?: string; body: string }>;
}): string {
  const lines: string[] = [];
  if (params.customerProfile) {
    lines.push(
      `客人 profileId:${params.customerProfile.id}` +
        (params.customerProfile.name ? `,姓名:${params.customerProfile.name}` : "") +
        (params.customerProfile.email ? `,email:${params.customerProfile.email}` : ""),
    );
  }
  lines.push("");
  lines.push("歷史對話(舊→新):");
  for (const turn of params.threadHistory) {
    if (!turn.body || !turn.body.trim()) continue; // empty-content guard
    lines.push(`[${turn.direction === "inbound" ? "客人" : "PACK&GO"}] ${turn.body.trim()}`);
  }
  return lines.join("\n");
}

/**
 * 用這位客人真實的 customerInteractions 歷史組出 runInquiryAgent 需要的輸入
 * (照抄 gmailPipeline.ts 既有組法),呼叫 runInquiryAgent 重生一份草稿(零副
 * 作用,不落地不寄),再對這份草稿跑 3 個獨立評審 LLM 呼叫。
 */
export async function runDraftEvalForCustomer(
  profileId: number,
): Promise<JudgeRawResult[]> {
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) return [];

  const { customerProfiles, customerInteractions } = await import("../../drizzle/schema");
  const { eq, sql } = await import("drizzle-orm");

  const [profile] = await db
    .select({
      id: customerProfiles.id,
      email: customerProfiles.email,
      name: customerProfiles.name,
      preferredLanguage: customerProfiles.preferredLanguage,
      communicationStyle: customerProfiles.communicationStyle,
      familyContext: customerProfiles.familyContext,
      aiNotes: customerProfiles.aiNotes,
      keyFacts: customerProfiles.keyFacts,
      preferences: customerProfiles.preferences,
      vipScore: customerProfiles.vipScore,
      bookingCount: customerProfiles.bookingCount,
    })
    .from(customerProfiles)
    .where(eq(customerProfiles.id, profileId))
    .limit(1);
  if (!profile) return [];

  // 近期 interactions(舊→新),照 gmailPipeline 既有慣例上限抓一批當
  // threadHistory,另外取最近 5 筆當 recentInteractions 摘要。
  const recentDesc = await db
    .select()
    .from(customerInteractions)
    .where(eq(customerInteractions.customerProfileId, profileId))
    .orderBy(sql`createdAt DESC`)
    .limit(12);

  if (recentDesc.length === 0) return [];

  const threadHistory = [...recentDesc].reverse().map((i) => ({
    direction: i.direction,
    body: i.content,
  }));

  const latestInbound = recentDesc.find((i) => i.direction === "inbound");
  if (!latestInbound) return []; // 沒有 inbound 就沒有「這次要回的信」,跳過這位客人

  const rawMessage = latestInbound.content;

  const decision = await runInquiryAgentForEval({
    rawMessage,
    channel: "email",
    customerProfile: {
      id: profile.id,
      email: profile.email,
      preferredLanguage: profile.preferredLanguage,
      communicationStyle: profile.communicationStyle,
      familyContext: profile.familyContext,
      aiNotes: profile.aiNotes,
      keyFacts: profile.keyFacts,
      preferences: (profile.preferences ?? null) as Record<string, unknown> | null,
      vipScore: profile.vipScore,
      bookingCount: profile.bookingCount,
    },
    recentInteractions: recentDesc.slice(0, 5).map((i) => ({
      direction: i.direction,
      contentSummary: i.contentSummary,
      sentiment: i.sentiment,
      createdAt: i.createdAt,
    })),
    threadHistory,
  });

  const factsBlock = buildFactsBlock({
    customerProfile: { id: profile.id, name: profile.name, email: profile.email },
    threadHistory,
  });

  const judgeResults: JudgeRawResult[] = [];
  for (let i = 0; i < JUDGE_COUNT; i++) {
    // 每次都是獨立的 invokeLLM 呼叫,不共用對話歷史 — 一個評審看不到另一個
    // 評審的答案,否則就不是獨立評分了。
    const result = await invokeOneJudge({
      draftText: decision.draftReply ?? "",
      factsBlock,
    });
    judgeResults.push(result);
  }

  return judgeResults;
}

/**
 * 呼叫既有 runInquiryAgent(純函式、零副作用)。拆成獨立函式方便測試 mock。
 */
async function runInquiryAgentForEval(
  input: Parameters<
    typeof import("../agents/autonomous/inquiryAgent").runInquiryAgent
  >[0],
): Promise<import("../agents/autonomous/inquiryAgent").InquiryAgentOutput> {
  const { runInquiryAgent } = await import("../agents/autonomous/inquiryAgent");
  return runInquiryAgent(input);
}

// ────────────────────────────────────────────────────────────────────────
// c) aggregateDraftEvalScores — 純函式,零 I/O,零 LLM。
// ────────────────────────────────────────────────────────────────────────

export interface AggregatedScore {
  accuracyScore: number;
  toneScore: number;
  completenessScore: number;
  overallScore: number; // 三個維度分平均,四捨五入到小數點後 1 位
  overbold: boolean;
  repeatsFulfilledPromise: boolean;
  wrongRecipient: boolean;
  judgeCount: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * 把多個評審的維度分取平均(四捨五入到小數點後 1 位)。三宗罪(吹牛/重複承諾/
 * 認錯人)用「至少一個評審標記就算命中」聚合——不是多數決,因為這三類問題已經
 * 出過真事故,寧可過度標記也不要漏抓。
 */
export function aggregateDraftEvalScores(
  judgeResults: JudgeRawResult[],
): AggregatedScore {
  if (judgeResults.length === 0) {
    return {
      accuracyScore: 0,
      toneScore: 0,
      completenessScore: 0,
      overallScore: 0,
      overbold: false,
      repeatsFulfilledPromise: false,
      wrongRecipient: false,
      judgeCount: 0,
    };
  }

  const accuracyScore = round1(average(judgeResults.map((j) => j.accuracyScore)));
  const toneScore = round1(average(judgeResults.map((j) => j.toneScore)));
  const completenessScore = round1(average(judgeResults.map((j) => j.completenessScore)));
  const overallScore = round1(average([accuracyScore, toneScore, completenessScore]));

  return {
    accuracyScore,
    toneScore,
    completenessScore,
    overallScore,
    overbold: judgeResults.some((j) => j.overbold),
    repeatsFulfilledPromise: judgeResults.some((j) => j.repeatsFulfilledPromise),
    wrongRecipient: judgeResults.some((j) => j.wrongRecipient),
    judgeCount: judgeResults.length,
  };
}

// ────────────────────────────────────────────────────────────────────────
// parseLastMonthScore — 純函式,零 I/O。
// ────────────────────────────────────────────────────────────────────────

/**
 * eval-history.md 每次追加一節,每節裡有一行固定格式類似
 * 「**綜合分:X.X/10**」。這個函式抓最新一節(檔案最後面那一節)裡的這個數字。
 * 抓不到或檔案是空字串就回 null(代表沒有上個月資料,不做劣化比較)。
 */
export function parseLastMonthScore(mdContent: string): number | null {
  if (!mdContent || !mdContent.trim()) return null;

  const matches = [...mdContent.matchAll(/\*\*綜合分[:：]\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*10\*\*/g)];
  if (matches.length === 0) return null;

  const last = matches[matches.length - 1];
  const n = Number(last[1]);
  return Number.isFinite(n) ? n : null;
}

// ────────────────────────────────────────────────────────────────────────
// d) runMonthlyDraftEval — 協調函式。
// ────────────────────────────────────────────────────────────────────────

export interface PerCustomerResult {
  profileId: number;
  aggregated: AggregatedScore;
}

export interface MonthlyEvalReport {
  monthLabel: string; // YYYY-MM-DD(跑的當天,LA 曆日)
  overallScore: number;
  sampleSize: number;
  perCustomer: PerCustomerResult[];
  overboldCount: number;
  repeatsFulfilledPromiseCount: number;
  wrongRecipientCount: number;
  previousScore: number | null;
  degraded: boolean;
  messageId: number | null;
}

function formatEvalHistorySection(report: MonthlyEvalReport): string {
  const worst = [...report.perCustomer].sort(
    (a, b) => a.aggregated.overallScore - b.aggregated.overallScore,
  )[0];

  const lines: string[] = [];
  lines.push(`## ${report.monthLabel} 月度評分`);
  lines.push("");
  lines.push(`**綜合分:${report.overallScore.toFixed(1)}/10**`);
  lines.push("");
  lines.push(
    `三宗罪計數:吹牛 ${report.overboldCount} / 重複承諾 ${report.repeatsFulfilledPromiseCount} / 認錯人 ${report.wrongRecipientCount}(共 ${report.sampleSize} 個樣本)`,
  );
  lines.push("");
  if (worst) {
    lines.push(
      `最差樣本:profileId ${worst.profileId} — 綜合分 ${worst.aggregated.overallScore.toFixed(1)}/10`,
    );
  } else {
    lines.push("最差樣本:(無有效樣本)");
  }
  if (report.degraded && report.previousScore != null) {
    lines.push("");
    lines.push(
      `[劣化偵測:比上月 (${report.previousScore.toFixed(1)}) 掉 ${(report.previousScore - report.overallScore).toFixed(1)} 分,已標 high]`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * 協調函式:選樣本 → 每位客人評分(單一客人失敗只 log 跳過,不拖垮整批)→
 * 聚合成本月綜合分 → 讀 eval-history.md 拿上個月分數 → 算劣化 → 追加寫入
 * eval-history.md → 寫一張 agentMessages 卡。整段包 try/catch,任何一步失敗
 * 都清楚 log,不讓單一客人評分失敗拖垮整個月度任務。
 */
export async function runMonthlyDraftEval(): Promise<MonthlyEvalReport | null> {
  const monthLabel = todayLA();

  try {
    const sample = await selectEvalSampleCustomers();
    const perCustomer: PerCustomerResult[] = [];

    for (const c of sample) {
      try {
        const judgeResults = await runDraftEvalForCustomer(c.profileId);
        if (judgeResults.length === 0) continue;
        perCustomer.push({
          profileId: c.profileId,
          aggregated: aggregateDraftEvalScores(judgeResults),
        });
      } catch (err) {
        log.warn(
          { err: err instanceof Error ? err.message : String(err), profileId: c.profileId },
          "[draftEval] per-customer eval failed (non-fatal, skipping this customer)",
        );
      }
    }

    if (perCustomer.length === 0) {
      log.warn("[draftEval] monthly eval had zero successful samples; skipping report");
      return null;
    }

    const overallScore = round1(
      average(perCustomer.map((p) => p.aggregated.overallScore)),
    );
    const overboldCount = perCustomer.filter((p) => p.aggregated.overbold).length;
    const repeatsFulfilledPromiseCount = perCustomer.filter(
      (p) => p.aggregated.repeatsFulfilledPromise,
    ).length;
    const wrongRecipientCount = perCustomer.filter((p) => p.aggregated.wrongRecipient).length;

    let previousScore: number | null = null;
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const filePath = path.resolve(process.cwd(), EVAL_HISTORY_PATH);
      const existing = await fs.readFile(filePath, "utf-8").catch(() => "");
      previousScore = parseLastMonthScore(existing);
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "[draftEval] failed to read eval-history.md for previous score (treating as first run)",
      );
    }

    const degraded =
      previousScore != null && previousScore - overallScore >= DEGRADE_THRESHOLD;

    const report: MonthlyEvalReport = {
      monthLabel,
      overallScore,
      sampleSize: perCustomer.length,
      perCustomer,
      overboldCount,
      repeatsFulfilledPromiseCount,
      wrongRecipientCount,
      previousScore,
      degraded,
      messageId: null,
    };

    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const filePath = path.resolve(process.cwd(), EVAL_HISTORY_PATH);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const section = formatEvalHistorySection(report);
      const existing = await fs.readFile(filePath, "utf-8").catch(() => "");
      const next = existing && existing.trim() ? `${existing.trimEnd()}\n\n${section}` : section;
      await fs.writeFile(filePath, `${next.trimEnd()}\n`, "utf-8");
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "[draftEval] failed to write eval-history.md (non-fatal)",
      );
    }

    try {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (db) {
        const { agentMessages } = await import("../../drizzle/schema");
        const bodyLines = [
          `本月草稿評分:綜合分 ${overallScore.toFixed(1)}/10(樣本數 ${perCustomer.length})`,
          `三宗罪:吹牛 ${overboldCount} / 重複承諾 ${repeatsFulfilledPromiseCount} / 認錯人 ${wrongRecipientCount}`,
        ];
        if (degraded && previousScore != null) {
          bodyLines.push(
            `劣化偵測:比上月 (${previousScore.toFixed(1)}) 掉 ${(previousScore - overallScore).toFixed(1)} 分,建議檢查最近的 prompt/policy 改動。`,
          );
        }
        const ins = await db.insert(agentMessages).values({
          agentName: "general",
          senderRole: "agent",
          messageType: "digest",
          title: `[月度草稿評分] ${monthLabel} 綜合分 ${overallScore.toFixed(1)}/10`,
          body: bodyLines.join("\n"),
          context: JSON.stringify(report),
          priority: degraded ? "high" : "normal",
        });
        report.messageId = Number((ins as unknown as Array<{ insertId?: number }>)?.[0]?.insertId ?? 0);
      }
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "[draftEval] failed to write agentMessages card (non-fatal)",
      );
    }

    return report;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[draftEval] monthly eval failed entirely",
    );
    return null;
  }
}
