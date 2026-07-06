/**
 * weeklyCanary — customer-cockpit Phase6 D2「每週 0909 canary(表單版)」
 * (dispatch-phase6.md 塊 D)。
 *
 * WHY: D1(weeklyCorrectnessAudit.ts)驗的是「卡片跟系統事實對不對得上」，但
 * 那條稽核完全繞過真實流量路徑——它直接讀 DB。如果網站表單→建卡→時間軸→
 * 紅點這條「客人真的送出詢問」的公開路徑本身壞掉（部署把某個中間層弄斷、
 * rate-limit 誤傷、tRPC mount 位置改了…），D1 一個字都看不出來，因為它從不
 * 真的打這條路。D2 是這條路徑本身的健康檢查：像一個真客人一樣，對正式公開
 * 端點發一筆真實 HTTP POST，用 0909 測試卡當身分，事後回頭核對三件事真的
 * 發生了。
 *
 * 派工單明文要求（不准直呼內部函式，要測的就是完整真路徑）：
 *   對 inquiries.create 的 HTTP 呼叫必須是真正的 fetch 打
 *   http://127.0.0.1:${PORT}/api/trpc/inquiries.create，不能 import
 *   inquiriesRouter 或 ingestWebsiteInquiryContact 之類的內部函式直接呼叫——
 *   那樣測不出 Express/CORS/tRPC mount 層本身有沒有斷。
 *
 * 硬紅線：
 *   - 這裡新增的唯一「寫」是 inquiries.create 本身允許的公開表單提交（跟一個
 *     真客人在網站上填表單、按送出，完全等價的動作），以及失敗時寫一張
 *     agentMessages 內部卡。除此之外零寫入、零寄信路徑。
 *   - 送出的是 canary 自己的合成資料，身分固定是 0909 測試卡
 *     （testAccounts.ts 的 TEST_ACCOUNT_0909_EMAIL/PROFILE_ID）——已被 A6
 *     排除在稽核/評分樣本外，不會被誤報成「真客人資料異常」。
 *   - 驗證的第 2 項存在正是為了抓「canary 不小心污染了業主本人身分」這個
 *     failure mode：owner email(OWN_EMAILS 的 jeffhsieh09@gmail.com)必須
 *     在 canary 送出後仍然零新卡。
 *
 * 成功只 log（維持辦公室安靜，跟 D1/followupScan/duplicateProfileScan 同一
 * 個 philosophy）；任一項失敗才發一張 high-priority agentMessages 卡。
 *
 * LLM usage: 零。這整支模組是一次 HTTP POST + 三個 DB SELECT + 字串判斷。
 */
import { createChildLogger } from "./logger";
import {
  TEST_ACCOUNT_0909_EMAIL,
  TEST_ACCOUNT_0909_PROFILE_ID,
  OWN_EMAILS,
} from "./testAccounts";

const log = createChildLogger({ module: "weeklyCanary" });

/** dispatch 明文要求的等待:提交後 60 秒才驗(background worker context，不是
 *  request path，可以真的等)。 */
export const CANARY_VERIFY_DELAY_MS = 60_000;

const OWNER_EMAIL = [...OWN_EMAILS].find((e) => e === "jeffhsieh09@gmail.com")!;

// ── pure：日期/文案/payload ─────────────────────────────────────────────────

/** "YYYY-MM-DD" in America/Los_Angeles — 跟 customerFacts.ts todayLA 同一個
 *  時區換算慣例（"今天"一律走 LA 曆日，不是 UTC）。 */
const DAY_LA_ISO = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
});
export function todayLA(now: Date = new Date()): string {
  return DAY_LA_ISO.format(now);
}

/** Pure: canary 訊息裡的可辨識標記文字，格式照派工單原文
 *  「[canary] 週檢 <date>」。未來在 admin 後台看到真實 inquiries 列表時，
 *  這個前綴要讓人一眼認出是雜訊不是真客人詢問。 */
export function buildCanaryMarker(now: Date = new Date()): string {
  return `[canary] 週檢 ${todayLA(now)}`;
}

/**
 * Pure: the "since" boundary for the post-submit verification queries, in ms.
 *
 * WHY floor-to-second minus 2s: MySQL DATETIME is second-precision — it TRUNCATES
 * sub-second digits on write. If the canary submits at 13:00:00.400 and the
 * resulting interaction lands the SAME wall-clock second, MySQL stores its
 * createdAt as 13:00:00 (000ms). A raw `now.getTime()` boundary (13:00:00.400)
 * then fails `createdAt >= since` (13:00:00.000 < 13:00:00.400) → a false canary
 * failure even though the interaction really landed (prod-recorded: interaction
 * 13:00:00 vs since 13:00:00.xxx, two checks falsely failed). Flooring to the
 * whole second and subtracting a 2s margin makes a same-second (and near-second)
 * truncated timestamp still satisfy the gte. The 0909 test profile has no other
 * traffic in that tiny window, so the widened boundary can't false-pass.
 * (General gotcha logged in docs/agent/30-templates.md — second-truncation compares.)
 */
export function computeCanarySinceMs(now: Date): number {
  return Math.floor(now.getTime() / 1000) * 1000 - 2000;
}

export interface CanaryInquiryPayload {
  customerName: string;
  customerEmail: string;
  subject: string;
  message: string;
}

/** Pure: inquiries.create 的完整 zod 輸入 —— 身分固定是 0909 測試卡，
 *  message 帶標記文字。Exported for tests(驗證 marker 確實在 payload 裡，
 *  未來讀 admin 後台的人能認出 canary 噪音）。 */
export function buildCanaryInquiryPayload(now: Date = new Date()): CanaryInquiryPayload {
  const marker = buildCanaryMarker(now);
  return {
    customerName: "PACK&GO 週檢 Canary",
    customerEmail: TEST_ACCOUNT_0909_EMAIL,
    subject: marker,
    message: `${marker}\n\n這是系統自動週檢，驗證網站詢問表單→客戶頁進場路徑是否正常，非真實客人詢問，可忽略。`,
  };
}

// ── pure：驗證邏輯（給定 DB 查詢結果，判斷三件事是否都過） ──────────────────

export interface CanaryCheckInputs {
  /** Check 1: profileId 2760017 底下，canary 提交之後有沒有新 interaction。 */
  newInteractionOnCanaryProfile: boolean;
  /** Check 2: OWNER_EMAIL(jeffhsieh09@gmail.com)在 canary 送出後新增的
   *  customerProfiles 筆數 —— 必須是 0。 */
  ownerNewProfileCount: number;
  /** Check 3: profileId 2760017 的 lastInboundAt 有沒有在 canary 送出時刻
   *  之後（代表這筆新 interaction 真的觸發了 touchLastInbound）。 */
  lastInboundAtAdvanced: boolean;
}

export type CanaryCheckName =
  | "interaction_landed"
  | "owner_not_polluted"
  | "last_inbound_advanced";

export interface CanaryVerificationResult {
  allPassed: boolean;
  failures: CanaryCheckName[];
}

const CHECK_LABEL: Record<CanaryCheckName, string> = {
  interaction_landed: "profileId 2760017 沒有出現新的 customerInteractions",
  owner_not_polluted: "jeffhsieh09@gmail.com（業主本人）意外新增了 customerProfiles 卡",
  last_inbound_advanced: "profileId 2760017 的 lastInboundAt 沒有更新",
};

/**
 * Pure: 給定三個 DB 查詢的結果，判斷 canary 這輪是否全部通過。三項都要過
 * 才算成功；任一項失敗都要列進 failures（不是只回報第一個，讓一張卡能完整
 * 說明所有壞掉的地方）。Exported for tests —— 這是派工單明確要求「pure,
 * DB-free function you can unit test」的那支函式。
 */
export function verifyCanaryOutcome(inputs: CanaryCheckInputs): CanaryVerificationResult {
  const failures: CanaryCheckName[] = [];
  if (!inputs.newInteractionOnCanaryProfile) failures.push("interaction_landed");
  if (inputs.ownerNewProfileCount > 0) failures.push("owner_not_polluted");
  if (!inputs.lastInboundAtAdvanced) failures.push("last_inbound_advanced");
  return { allPassed: failures.length === 0, failures };
}

/** Pure: 失敗時要發的那張 agentMessages 卡（high priority——canary 抓到的是
 *  「客人真實能用的路徑可能斷了」，跟 D1 的資料飄移不是同一個急迫程度）。 */
export function formatCanaryFailureCard(
  result: CanaryVerificationResult,
  runAt: Date,
): { title: string; body: string } {
  const lines = result.failures.map((f) => `- ${CHECK_LABEL[f]}`);
  return {
    title: `週檢 canary 失敗:網站詢問表單路徑可能斷了(${todayLA(runAt)})`,
    body:
      `每週對真實網站詢問表單端點(inquiries.create)送出的 0909 測試提交，60 秒後核對三件事，` +
      `以下 ${result.failures.length} 項沒通過:\n\n${lines.join("\n")}\n\n` +
      `這代表真客人透過網站詢問表單聯絡我們的這條路，可能也壞了 —— 建議盡快人工檢查。`,
  };
}

// ── IO：真實 HTTP 提交 ───────────────────────────────────────────────────────

/** Injectable fetch type so tests can pass a mock and never fire a real
 *  network request under `vitest run`. Defaults to the global fetch at
 *  call time in runWeeklyCanary — tests always pass an explicit mock. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface SubmitCanaryResult {
  ok: boolean;
  status: number;
  bodyText: string;
}

/**
 * 真正的 HTTP POST 到本機正在跑的 server 的 /api/trpc/inquiries.create——
 * 不是 import router 直接呼叫。baseUrl 預設用 `http://127.0.0.1:${PORT}`，
 * 跟 index.ts 的 bot-prerender loopback 同一個慣例（server 自己打自己）。
 *
 * Body 是 tRPC 的單次呼叫(non-batched)wire 格式 `{"json": <input>}` ——
 * 跟 scripts/full-pipeline-test.mjs 的 trpcMutate 完全同款,是已經在這台
 * server(superjson transformer + createExpressMiddleware)上驗證過會動的
 * 格式,不是 client 端 httpBatchLink 用的 `?batch=1` + `{"0":{"json":…}}`
 * 包法(那是 client 為了把多個呼叫塞進一次 HTTP round-trip的批次包裝,單次
 * 呼叫不需要,createExpressMiddleware 兩種都接受)。
 */
export async function submitCanaryInquiry(opts: {
  fetchImpl: FetchLike;
  baseUrl: string;
  now?: Date;
}): Promise<SubmitCanaryResult> {
  const payload = buildCanaryInquiryPayload(opts.now);
  const res = await opts.fetchImpl(`${opts.baseUrl}/api/trpc/inquiries.create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: payload }),
  });
  const bodyText = await res.text();
  return { ok: res.ok, status: res.status, bodyText };
}

// ── IO：DB 讀取 + 執行器 ─────────────────────────────────────────────────────

export type Db = NonNullable<Awaited<ReturnType<typeof import("../db").getDb>>>;

/** Read-only: canary 送出之後(sinceMs)，0909 測試卡有沒有新的
 *  customerInteractions。 */
async function checkNewInteractionOnCanaryProfile(db: Db, sinceMs: number): Promise<boolean> {
  const { customerInteractions } = await import("../../drizzle/schema");
  const { and, eq, gte } = await import("drizzle-orm");
  const rows = (await db
    .select({ id: customerInteractions.id })
    .from(customerInteractions)
    .where(
      and(
        eq(customerInteractions.customerProfileId, TEST_ACCOUNT_0909_PROFILE_ID),
        gte(customerInteractions.createdAt, new Date(sinceMs)),
      ),
    )
    .limit(1)) as Array<{ id: number }>;
  return rows.length > 0;
}

/** Read-only: OWNER_EMAIL 底下，canary 送出之後有沒有新增 customerProfiles
 *  行——canary 絕不能污染業主本人身分。 */
async function countOwnerNewProfiles(db: Db, sinceMs: number): Promise<number> {
  const { customerProfiles } = await import("../../drizzle/schema");
  const { and, eq, gte } = await import("drizzle-orm");
  const rows = (await db
    .select({ id: customerProfiles.id })
    .from(customerProfiles)
    .where(
      and(
        eq(customerProfiles.email, OWNER_EMAIL),
        gte(customerProfiles.createdAt, new Date(sinceMs)),
      ),
    )) as Array<{ id: number }>;
  return rows.length;
}

/** Read-only: 0909 測試卡的 lastInboundAt 有沒有推進到 sinceMs 之後
 *  （代表這次的 inbound interaction 真的觸發了 touchLastInbound）。 */
async function checkLastInboundAdvanced(db: Db, sinceMs: number): Promise<boolean> {
  const { customerProfiles } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const rows = (await db
    .select({ lastInboundAt: customerProfiles.lastInboundAt })
    .from(customerProfiles)
    .where(eq(customerProfiles.id, TEST_ACCOUNT_0909_PROFILE_ID))
    .limit(1)) as Array<{ lastInboundAt: Date | null }>;
  const lastInboundAt = rows[0]?.lastInboundAt ?? null;
  if (!lastInboundAt) return false;
  return new Date(lastInboundAt).getTime() >= sinceMs;
}

export interface WeeklyCanaryResult {
  submitted: boolean;
  allPassed: boolean;
  failures: CanaryCheckName[];
  posted: boolean;
}

/**
 * Weekly executor: 對正式公開路徑真的送一筆 canary 詢問(0909 身分)，等
 * CANARY_VERIFY_DELAY_MS(預設 60 秒)，接著查三件事並判斷。全過 → 只 log；
 * 任一項沒過 → 一張 high-priority agentMessages 卡。
 *
 * fetchImpl 一定要由呼叫端注入（worker 會傳真正的 global fetch）；這支函式
 * 本身沒有預設值指向網路，避免任何測試不小心觸發真實請求。
 */
export async function runWeeklyCanary(
  db: Db,
  opts: {
    fetchImpl: FetchLike;
    baseUrl: string;
    now?: Date;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<WeeklyCanaryResult> {
  const now = opts.now ?? new Date();
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const delayMs = opts.delayMs ?? CANARY_VERIFY_DELAY_MS;

  // 秒級截斷防呆:MySQL DATETIME 只有秒精度,sinceMs 帶毫秒會讓同秒落庫的
  // interaction(createdAt 被截成整秒)gte 誤判為早於 → 假失敗。向下取整到秒 + 2s 餘裕。
  const submitAtMs = computeCanarySinceMs(now);
  let submitted = false;
  try {
    const res = await submitCanaryInquiry({ fetchImpl: opts.fetchImpl, baseUrl: opts.baseUrl, now });
    submitted = res.ok;
    if (!res.ok) {
      log.warn(
        { status: res.status, bodyText: res.bodyText.slice(0, 500) },
        "[weeklyCanary] canary submission HTTP call did not return ok",
      );
    }
  } catch (err) {
    log.warn({ err: (err as Error).message }, "[weeklyCanary] canary submission threw");
  }

  await sleep(delayMs);

  let result: CanaryVerificationResult;
  try {
    const [newInteractionOnCanaryProfile, ownerNewProfileCount, lastInboundAtAdvanced] =
      await Promise.all([
        checkNewInteractionOnCanaryProfile(db, submitAtMs),
        countOwnerNewProfiles(db, submitAtMs),
        checkLastInboundAdvanced(db, submitAtMs),
      ]);
    result = verifyCanaryOutcome({
      newInteractionOnCanaryProfile: submitted && newInteractionOnCanaryProfile,
      ownerNewProfileCount,
      lastInboundAtAdvanced: submitted && lastInboundAtAdvanced,
    });
  } catch (err) {
    log.warn({ err: (err as Error).message }, "[weeklyCanary] verification query failed");
    result = { allPassed: false, failures: ["interaction_landed", "last_inbound_advanced"] };
  }

  if (!submitted) {
    // HTTP 提交本身沒成功 → 一定算失敗，即便三個查詢意外都通過（不太可能，
    // 但誠實起見不要讓「查詢剛好過」掩蓋「提交本身沒送出去」這個事實）。
    if (!result.failures.includes("interaction_landed")) {
      result = { allPassed: false, failures: [...result.failures, "interaction_landed"] };
    }
  }

  if (result.allPassed) {
    log.info({ submitted }, "[weeklyCanary] all checks passed — log only, no card");
    return { submitted, allPassed: true, failures: [], posted: false };
  }

  const { agentMessages } = await import("../../drizzle/schema");
  const card = formatCanaryFailureCard(result, now);
  await db.insert(agentMessages).values({
    agentName: "weekly-canary",
    senderRole: "agent",
    messageType: "alert",
    title: card.title,
    body: card.body,
    priority: "high",
  });
  log.warn({ failures: result.failures }, "[weeklyCanary] checks failed — card posted");
  return { submitted, allPassed: false, failures: result.failures, posted: true };
}
