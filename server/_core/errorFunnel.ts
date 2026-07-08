/**
 * Wave1 Block B — 錯誤漏斗(error funnel)。
 *
 * 背景:Ann 事故的根因是「系統壞了但只有客人來信才會被發現」——admin tRPC 路由 500、
 * worker/cron job 失敗這些訊號過去只進 Sentry,沒有任何機制保證 Jeff 一定看到。這支
 * 漏斗把「一定被看到」這件事做出來:任何一處呼叫 reportFunnelError() 都會(去重後)
 * 貼一張 high 優先 agentMessages 卡。Sentry 繼續留堆疊細節,職責不重疊。
 *
 * 去重範式照抄 ./llmCreditAlert.ts:
 *   - Layer 1(module 級 in-memory Map):per-process 快速路徑,同簽名 30 分鐘內第二次
 *     呼叫直接累加 count,不查 DB、不重貼。
 *   - Layer 2(DB 級,跨 process/instance):in-memory 沒命中時查 agentMessages。查到既有
 *     卡就把 context 讀出來、count+1、UPDATE 回寫(累計次數可稽核,不只活在某個
 *     process 的記憶體裡),不重新 insert。
 *   - Layer 3:兩層都沒查到(或 DB 不可用,查詢本身丟例外)→ 視為全新事件,直接貼卡。
 *     DB 查詢失敗不代表放棄貼卡 —— 那樣反而會讓漏斗在 DB 抖動時完全失靈。
 *
 * 頭號紅線:reportFunnelError 絕不 throw(呼叫端可能在 BullMQ 事件迴圈 / tRPC error
 * middleware 裡呼叫,沒有人在等這個 promise reject)。priority 對外一律鎖死 "high",
 * 呼叫端的型別上完全沒有管道可以指定 priority,更不可能變成 "critical"(critical 會
 * 觸發 notifyAgentMessage → notifyOwner 寄信,漏斗職責是貼卡不是寄信轟炸)。
 *
 * 已知殘留限制(2026-07 審查記錄,非阻塞,未修):
 *   - Layer 2 的 DB 去重是 select-then-branch,沒有 unique constraint /
 *     upsert。同 process 併發已用 in-memory 佔位鎖解掉(見 P1-1 修法),但
 *     跨 process / 跨機器(若 Fly.io 真的多開 machine)的併發仍可能各自
 *     miss、各自 insert 出重複卡。要完全補齊需要 agentMessages 加
 *     (agentName, title) unique index + INSERT ON DUPLICATE KEY UPDATE,
 *     屬於 schema migration,不在本次修復範圍內。
 *   - `title = signature.slice(0, 200)` 比 in-memory 用的完整 signature更
 *     粗:不同 signature 若前 200 字元相同,理論上會在 DB 層被誤判同卡。
 *     source 標籤都很短(trpc:xxx / worker:xxx / cron:xxx),實務上要撞到
 *     這個門檻機率極低,沒有測試覆蓋、也沒有防禦。
 *   - module 級 `seen` Map 沒有 TTL / 上限。長駐 process 若累積大量帶動態
 *     內容的錯誤訊息(signature 各自不同),理論上會無界成長。
 */
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "errorFunnel" });

const DEDUP_WINDOW_MS = 30 * 60 * 1000; // 30 分鐘去重視窗(in-memory 與 DB 兩層共用同一個窗口長度)
const AGENT_NAME = "error-funnel";
// P1-2 修法:Layer 1(in-memory)命中每逢這個倍數就額外回寫一次 DB count,讓
// 長駐 process 高頻重複的卡片文案不會永遠停在 Layer 3 貼卡當下的 1。挑 5 是
// 「夠即時、又不會每次命中都打 DB」的折衷 —— 洪水情境(例如 30 分鐘內同簽名
// 重複數十次)會在第 5、10、15...次落地一次,不是完全不落地,也不是每次都打。
const COUNT_FLUSH_EVERY = 5;

/** module 級 in-memory 去重狀態:signature → 最近一次貼卡/更新時間 + 累計次數。 */
const seen = new Map<string, { postedAt: number; count: number }>();

function describeError(err: unknown): { name: string; message: string } {
  if (err instanceof Error) {
    return { name: err.name || "Error", message: err.message ?? "" };
  }
  return { name: "Error", message: String(err) };
}

export interface ReportFunnelErrorArgs {
  /** 錯誤來源,例如 "trpc:admin.someRoute"、"worker:gmailPoll"、"cron:weeklyCanary"。 */
  source: string;
  err: unknown;
  /** 選填的額外結構化上下文(會存進卡片 context.extra)。 */
  context?: unknown;
  // 注意:刻意不接受 priority —— 這支漏斗的 priority 永遠是 "high",不開放呼叫端覆寫。
}

/**
 * P1-2 修法:把目前累積的 in-memory count 回寫進既有卡片的 `context.count`。
 * Fire-and-forget 用途(呼叫端不 await),所以整支函式自己吞掉所有例外 ——
 * 一次回寫失敗不該影響任何呼叫端邏輯,下一次(count 再累加 COUNT_FLUSH_EVERY
 * 次)還會再試一次。找不到既有卡(例如兩層都還沒真正落地過)就靜默跳過。
 */
async function flushCountToDb(title: string, count: number, since: Date): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return;
    const { agentMessages } = await import("../../drizzle/schema");
    const { and, eq, gte, desc } = await import("drizzle-orm");
    const existing = await db
      .select({ id: agentMessages.id, context: agentMessages.context })
      .from(agentMessages)
      .where(
        and(
          eq(agentMessages.agentName, AGENT_NAME),
          eq(agentMessages.title, title),
          gte(agentMessages.createdAt, since),
        ),
      )
      .orderBy(desc(agentMessages.createdAt))
      .limit(1);
    if (existing.length === 0) return;
    const row = existing[0];
    let prevContext: Record<string, unknown> = {};
    try {
      prevContext = row.context ? JSON.parse(row.context) : {};
    } catch {
      prevContext = {};
    }
    await db
      .update(agentMessages)
      .set({ context: JSON.stringify({ ...prevContext, count }) })
      .where(eq(agentMessages.id, row.id));
  } catch (err) {
    log.warn({ err, title, count }, "[errorFunnel] periodic count flush failed — non-fatal, will retry next window");
  }
}

/**
 * 上報一筆錯誤事件到錯誤漏斗。去重後(見檔頭說明)貼一張 high 優先 agentMessages 卡。
 * 絕不 throw —— 整支函式最外層包 try/catch,任何子步驟失敗都只記 log 並盡量繼續往下走
 * (DB 查詢失敗 → 當作全新事件直接貼卡,而不是放棄)。
 */
export async function reportFunnelError(args: ReportFunnelErrorArgs): Promise<void> {
  try {
    const { source, err, context } = args;
    const { name, message } = describeError(err);
    const signature = `${source}::${name}::${message.slice(0, 120)}`;
    const title = signature.slice(0, 200);
    const now = Date.now();

    // Layer 1 — in-memory 快速路徑:同簽名 30 分鐘內第二次(含以後)呼叫,只累加
    // count,不查 DB、不重貼。
    const memHit = seen.get(signature);
    if (memHit && now - memHit.postedAt < DEDUP_WINDOW_MS) {
      memHit.count += 1;
      // 2026-07 審查 P1-2 修法:count 只活在 in-memory,長駐 process 高頻重複
      // 時 DB 卡片的 count 完全不動(只有跨 process 命中 Layer 2 才會落地)。
      // 每 COUNT_FLUSH_EVERY 次額外 fire-and-forget 回寫一次 DB,讓卡片文案
      // 定期跟上真實次數,而不是永遠停在 Layer 3 貼卡當下的 1。不 await —— 不
      // 拖慢呼叫端(BullMQ 事件迴圈 / tRPC onError)。
      if (memHit.count % COUNT_FLUSH_EVERY === 0) {
        flushCountToDb(title, memHit.count, new Date(now - DEDUP_WINDOW_MS)).catch(() => {});
      }
      return;
    }

    // 2026-07 審查 P1-1 修法:並發同簽名(例如 supplierDetailEnrichmentWorker
    // concurrency=5 同時 5 個 job 因同一次系統性故障失敗)原本會全部通過上面的
    // `seen.get` miss 檢查,因為 Layer 2/3 之間跨了多個 await(動態 import、DB
    // select),第一個呼叫的 `seen.set` 要等到函式尾端才執行,导致 5 個呼叫各自
    // 貼卡。修法:在任何 await 之前、miss 判定後立刻同步佔位(optimistic lock)。
    // Node.js 單執行緒 —— get 到這行 set 之間沒有 await,所以在同一個 process
    // 內,任何「幾乎同時」的並發呼叫實際上仍會被事件迴圈序列化,一定會看到這個
    // 佔位已經存在,直接落入上面的快速路徑遞增,而不是各自繼續往下跑。
    // 殘留限制(未修,見檔尾 known-limitation 註解):跨 process / 跨機器
    // (Fly.io 若真的多開 machine)的併發仍可能各自 miss——那需要 DB 層
    // unique constraint + upsert,這支 in-memory 鎖只解決同 process 併發。
    seen.set(signature, { postedAt: now, count: 1 });

    const body = `來源:${source}\n錯誤類型:${name}\n訊息:${message || "(無訊息)"}`;

    // Layer 2 — DB 級去重(跨 process / instance)。查詢本身若失敗,視為 DB 不可用,
    // 直接落到 Layer 3(不因為查不到就放棄貼卡)。
    try {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (db) {
        const { agentMessages } = await import("../../drizzle/schema");
        const { and, eq, gte, desc } = await import("drizzle-orm");
        const since = new Date(now - DEDUP_WINDOW_MS);
        const existing = await db
          .select({ id: agentMessages.id, context: agentMessages.context })
          .from(agentMessages)
          .where(
            and(
              eq(agentMessages.agentName, AGENT_NAME),
              eq(agentMessages.title, title),
              gte(agentMessages.createdAt, since),
            ),
          )
          .orderBy(desc(agentMessages.createdAt))
          .limit(1);

        if (existing.length > 0) {
          const row = existing[0];
          let prevContext: Record<string, unknown> = {};
          try {
            prevContext = row.context ? JSON.parse(row.context) : { count: 1 };
          } catch {
            prevContext = { count: 1 };
          }
          const prevCount = typeof prevContext.count === "number" ? prevContext.count : 1;
          const nextCount = prevCount + 1;
          const nextContext = { ...prevContext, count: nextCount };

          try {
            await db
              .update(agentMessages)
              .set({ context: JSON.stringify(nextContext) })
              .where(eq(agentMessages.id, row.id));
          } catch (updateErr) {
            log.warn(
              { err: updateErr, signature },
              "[errorFunnel] DB update (count bump) failed — non-fatal, card already exists",
            );
          }

          seen.set(signature, { postedAt: now, count: nextCount });
          return; // 已有既有卡,不重新 insert。
        }
      }
    } catch (queryErr) {
      log.warn(
        { err: queryErr, signature },
        "[errorFunnel] dedup DB query failed — treating as new event, posting anyway",
      );
    }

    // Layer 3 — 兩層都沒查到既有卡(或 DB 不可用)→ 真正的新事件,貼一張新卡。
    const initialContext: Record<string, unknown> = {
      source,
      name,
      message,
      count: 1,
      ...(context !== undefined ? { extra: context } : {}),
    };

    try {
      const { notifyAgentMessage } = await import("./agentNotify");
      await notifyAgentMessage({
        agentName: AGENT_NAME,
        messageType: "alert",
        priority: "high", // 硬編死,絕不可能是 critical(不寄信轟炸)
        title,
        body,
        context: initialContext,
      });
    } catch (notifyErr) {
      log.error({ err: notifyErr, signature }, "[errorFunnel] failed to post new card (non-fatal)");
    }

    // 佔位已經在 Layer 1 miss 判定後同步寫入(見上方 P1-1 修法),count:1 跟這裡
    // 要寫的值相同,不需要再 set 一次。
  } catch (outerErr) {
    // 頭號紅線:永不 throw。任何未預期的失敗都只記 log。
    log.error({ err: outerErr }, "[errorFunnel] reportFunnelError failed unexpectedly (non-fatal)");
  }
}

/**
 * 結構化型別,只描述 wireWorkerFunnel 需要的 BullMQ Worker 事件面(避免耦合整個
 * bullmq 套件版本;直接傳真正的 `Worker` 實例也完全相容,因為 BullMQ Worker 的
 * `on("failed" | "error", ...)` 簽名是這個介面的超集)。
 */
export interface FunnelWorkerLike {
  on(event: "failed", listener: (job: { id?: string | number } | undefined, err: Error, ...rest: unknown[]) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
}

/**
 * 幫一個 BullMQ Worker 掛上錯誤漏斗監聽。用 `.on(...)` 加掛,不取代呼叫端已經掛的任何
 * 監聽器(Worker 是 EventEmitter,同一事件可以有多個監聽器並存)。fire-and-forget:
 * 不 await reportFunnelError,避免拖慢 BullMQ 事件迴圈;`.catch(() => {})` 是雙保險
 * (reportFunnelError 內部已經自己 try/catch,理論上不會 reject)。
 *
 * 用法:
 *   import { wireWorkerFunnel } from "./_core/errorFunnel";
 *   wireWorkerFunnel(myWorker, "gmailPoll");
 *
 * 契約(2026-07 審查點名,文件化避免未來新 worker 踩雷):`wireWorkerFunnel` 對
 * `"failed"` / `"error"` 一律轉送進漏斗,不分辨「業務預期失敗」跟「系統壞了」。
 * 目前所有 27 個接線 worker 都遵守同一個隱性契約 —— 預期會發生的業務錯誤(例如
 * gmailPollWorker.ts 的 OAuth revoked)要在 job processor 內部自己 try/catch
 * 吞掉,只有真正未預期的例外才讓它 throw 出 job、觸發 BullMQ 的 `"failed"`。
 * 新 worker 若把預期失敗直接 throw 出 job,會被當成事故貼卡 —— 屬於噪音,不是
 * bug,但目前沒有程式碼層面的防呆,寫新 worker 時要自己遵守這條。
 */
export function wireWorkerFunnel(worker: FunnelWorkerLike, queueName: string): void {
  worker.on("failed", (job, err) => {
    reportFunnelError({ source: `worker:${queueName}`, err, context: { jobId: job?.id } }).catch(() => {});
  });
  worker.on("error", (err) => {
    reportFunnelError({ source: `worker:${queueName}`, err }).catch(() => {});
  });
}

// ── 測試鉤子(不影響 production 邏輯) ──────────────────────────────────────────
export function __resetForTest(): void {
  seen.clear();
}
export function __getStateForTest(): Map<string, { postedAt: number; count: number }> {
  return new Map(seen);
}
