// Wave1 Block B — errorFunnel 單元測試。純 mock:不碰真實 DB / notifyAgentMessage /
// 網路。mock ../db 讓 getDb 回傳可控的假 drizzle chain,mock ./agentNotify 用 spy 驗
// 卡的形狀。假 db chain 的形狀刻意對齊 errorFunnel.ts 實際呼叫鏈:
//   select({...}).from(agentMessages).where(and(...)).orderBy(desc(...)).limit(1)
//   update(agentMessages).set({...}).where(eq(...))
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

const { getDbMock, notifyAgentMessageMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(async (): Promise<any> => null),
  notifyAgentMessageMock: vi.fn(async () => {}),
}));

vi.mock("../db", () => ({ getDb: getDbMock }));
vi.mock("./agentNotify", () => ({ notifyAgentMessage: notifyAgentMessageMock }));

import { reportFunnelError, wireWorkerFunnel, __resetForTest, __getStateForTest } from "./errorFunnel";

/** 假 drizzle db:select 鏈固定回傳 selectRows(或用 selectImpl 客製,含丟例外);
 * update 鏈記錄每次 .set() 收到的物件,updateThrows 可模擬 UPDATE 失敗。 */
function makeFakeDb(opts: {
  selectRows?: any[];
  selectImpl?: () => Promise<any[]>;
  updateThrows?: boolean;
  onUpdateSet?: (setObj: any) => void;
}) {
  const selectSpy = vi.fn(() => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: () => (opts.selectImpl ? opts.selectImpl() : Promise.resolve(opts.selectRows ?? [])),
        }),
      }),
    }),
  }));
  const updateSpy = vi.fn(() => ({
    set: (setObj: any) => ({
      where: async () => {
        opts.onUpdateSet?.(setObj);
        if (opts.updateThrows) throw new Error("update boom");
      },
    }),
  }));
  return { select: selectSpy, update: updateSpy, __selectSpy: selectSpy, __updateSpy: updateSpy };
}

beforeEach(() => {
  __resetForTest();
  vi.clearAllMocks();
  getDbMock.mockResolvedValue(null); // 預設:DB 不可用 → 每次都直接走 layer 3 貼新卡
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("reportFunnelError — 去重", () => {
  it("同 process 內第二次呼叫走 in-memory 快速路徑:不重查 DB、不重新 insert,只累加 count", async () => {
    const fakeDb = makeFakeDb({ selectRows: [] }); // 第一次查無既有卡
    getDbMock.mockResolvedValue(fakeDb);

    await reportFunnelError({ source: "worker:foo", err: new Error("boom") });
    expect(notifyAgentMessageMock).toHaveBeenCalledTimes(1);
    expect(fakeDb.__selectSpy).toHaveBeenCalledTimes(1);

    await reportFunnelError({ source: "worker:foo", err: new Error("boom") });
    // 第二次:不重新 insert,也完全不碰 DB(in-memory 短路)。
    expect(notifyAgentMessageMock).toHaveBeenCalledTimes(1);
    expect(fakeDb.__selectSpy).toHaveBeenCalledTimes(1);
    expect(fakeDb.__updateSpy).not.toHaveBeenCalled();

    const state = __getStateForTest();
    const entry = [...state.values()][0];
    expect(entry?.count).toBe(2); // in-memory count 累加了
  });

  it("跨 process 場景(用 __resetForTest 清 in-memory,DB 仍有近卡):走 DB 層 → UPDATE count 遞增,不重新 insert", async () => {
    const existingRow = { id: 999, context: JSON.stringify({ source: "worker:foo", name: "Error", message: "boom", count: 1 }) };
    let capturedSet: any = null;
    const fakeDb = makeFakeDb({
      selectRows: [existingRow],
      onUpdateSet: (setObj) => {
        capturedSet = setObj;
      },
    });
    getDbMock.mockResolvedValue(fakeDb);

    await reportFunnelError({ source: "worker:foo", err: new Error("boom") });

    expect(fakeDb.__updateSpy).toHaveBeenCalledTimes(1);
    expect(notifyAgentMessageMock).not.toHaveBeenCalled(); // 不重新 insert
    expect(capturedSet).toBeTruthy();
    const nextContext = JSON.parse(capturedSet.context);
    expect(nextContext.count).toBe(2); // count 從既有卡的 1 遞增到 2
  });

  it("既有卡 context 是壞掉的 JSON → 當作 {count:1} 處理,UPDATE 後 count 變 2", async () => {
    const existingRow = { id: 5, context: "{not valid json" };
    let capturedSet: any = null;
    const fakeDb = makeFakeDb({
      selectRows: [existingRow],
      onUpdateSet: (setObj) => {
        capturedSet = setObj;
      },
    });
    getDbMock.mockResolvedValue(fakeDb);

    await reportFunnelError({ source: "worker:foo", err: new Error("boom") });

    const nextContext = JSON.parse(capturedSet.context);
    expect(nextContext.count).toBe(2);
  });

  it("不同簽名(source 不同)各自成卡", async () => {
    const fakeDb = makeFakeDb({ selectRows: [] });
    getDbMock.mockResolvedValue(fakeDb);

    await reportFunnelError({ source: "worker:foo", err: new Error("boom") });
    await reportFunnelError({ source: "worker:bar", err: new Error("boom") });

    expect(notifyAgentMessageMock).toHaveBeenCalledTimes(2);
    const titles = notifyAgentMessageMock.mock.calls.map((c: any) => c[0].title);
    expect(new Set(titles).size).toBe(2);
    expect(titles[0]).toContain("worker:foo");
    expect(titles[1]).toContain("worker:bar");
  });

  it("不同簽名(錯誤訊息前綴不同)各自成卡", async () => {
    const fakeDb = makeFakeDb({ selectRows: [] });
    getDbMock.mockResolvedValue(fakeDb);

    await reportFunnelError({ source: "worker:foo", err: new Error("disk full") });
    await reportFunnelError({ source: "worker:foo", err: new Error("connection refused") });

    expect(notifyAgentMessageMock).toHaveBeenCalledTimes(2);
    const titles = notifyAgentMessageMock.mock.calls.map((c: any) => c[0].title);
    expect(new Set(titles).size).toBe(2);
  });

  it("P1-1 回歸測試:並發同簽名(Promise.all,模擬 concurrency=5 的 worker 同時因同一次系統性故障失敗)只會貼一張新卡,不是 5 張", async () => {
    const fakeDb = makeFakeDb({ selectRows: [] });
    getDbMock.mockResolvedValue(fakeDb);

    // Array.from 的 mapper 會同步依序呼叫 reportFunnelError 5 次(每次跑到第一個
    // await 前都是同步的),模擬 BullMQ concurrency=5 的 5 個 job 幾乎同時觸發
    // "failed" 事件、幾乎同時呼叫 reportFunnelError 的情境。
    await Promise.all(
      Array.from({ length: 5 }, () =>
        reportFunnelError({ source: "worker:supplierDetailEnrichment", err: new Error("DB connection lost") }),
      ),
    );

    // 修法前:5 個呼叫都會通過「尚無記錄」的 in-memory 檢查,各自查 DB、各自
    // insert,notifyAgentMessageMock 會被呼叫 5 次。修法後應該只有第一個真正
    // insert,其餘 4 個落入 in-memory 快速路徑遞增。
    expect(notifyAgentMessageMock).toHaveBeenCalledTimes(1);
    expect(fakeDb.__selectSpy).toHaveBeenCalledTimes(1);

    const state = __getStateForTest();
    const entry = [...state.values()][0];
    expect(entry?.count).toBe(5); // 5 次呼叫全部被算進同一個 signature 的 count
  });
});

describe("reportFunnelError — 視窗過期重新貼卡(P2,原本無 fake-timer 測試覆蓋)", () => {
  it("超過 30 分鐘去重視窗後,同簽名視為新事件重新貼卡,count 從 1 起跳", async () => {
    vi.useFakeTimers();
    try {
      const fakeDb = makeFakeDb({ selectRows: [] });
      getDbMock.mockResolvedValue(fakeDb);

      await reportFunnelError({ source: "worker:foo", err: new Error("boom") });
      expect(notifyAgentMessageMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(31 * 60 * 1000); // 超過 DEDUP_WINDOW_MS(30 分鐘)

      await reportFunnelError({ source: "worker:foo", err: new Error("boom") });
      expect(notifyAgentMessageMock).toHaveBeenCalledTimes(2); // 視窗過期,重新貼卡而非累加

      const state = __getStateForTest();
      const entry = [...state.values()][0];
      expect(entry?.count).toBe(1); // 新視窗的 count 從 1 重新起跳,不延續舊視窗的累計
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("reportFunnelError — P1-2 count 週期性回寫 DB", () => {
  it("in-memory 命中每 COUNT_FLUSH_EVERY(5)次額外回寫一次 DB count,不必等到跨 process 才落地", async () => {
    let selectCallCount = 0;
    const capturedUpdates: any[] = [];
    const fakeDb = makeFakeDb({
      selectImpl: async () => {
        selectCallCount += 1;
        // 第一次是 Layer 2(Layer3 insert 前)查詢,查無資料 → 走 Layer 3 insert。
        // 之後的查詢來自 flushCountToDb 自己的 select,假裝那張卡已經存在,好讓
        // flush 有東西可以 UPDATE。
        return selectCallCount === 1 ? [] : [{ id: 123, context: JSON.stringify({ count: 1 }) }];
      },
      onUpdateSet: (setObj) => {
        capturedUpdates.push(setObj);
      },
    });
    getDbMock.mockResolvedValue(fakeDb);

    await reportFunnelError({ source: "worker:flush", err: new Error("boom") }); // Layer3 insert,in-memory count=1
    for (let i = 0; i < 4; i++) {
      await reportFunnelError({ source: "worker:flush", err: new Error("boom") }); // count 累加到 2,3,4,5
    }
    // flush 是 fire-and-forget(動態 import + select + update),settles 在這幾次
    // reportFunnelError 呼叫都 resolve 之後。固定 setTimeout(0) 在全套跑（多測試檔
    // 並發）下負載重時 flake(2026-07-03 stripeWebhook.bookings.test.ts 同款教訓)—
    // 改用 vi.waitFor 輪詢正向斷言,對負載不敏感。
    await vi.waitFor(() => {
      expect(capturedUpdates.length).toBe(1); // 第 5 次命中(5 % 5 === 0)觸發剛好一次回寫
    });
    const nextContext = JSON.parse(capturedUpdates[0].context);
    expect(nextContext.count).toBe(5);
  });

  it("count 還沒到 COUNT_FLUSH_EVERY 的倍數 → 完全不打 DB update", async () => {
    const fakeDb = makeFakeDb({ selectRows: [] });
    getDbMock.mockResolvedValue(fakeDb);

    await reportFunnelError({ source: "worker:flush2", err: new Error("boom") }); // count=1
    await reportFunnelError({ source: "worker:flush2", err: new Error("boom") }); // count=2
    await reportFunnelError({ source: "worker:flush2", err: new Error("boom") }); // count=3
    await new Promise((r) => setTimeout(r, 0));

    expect(fakeDb.__updateSpy).not.toHaveBeenCalled();
  });
});

describe("reportFunnelError — never throw", () => {
  it("notifyAgentMessage reject 也不炸", async () => {
    getDbMock.mockResolvedValue(null); // DB 不可用 → 直接嘗試貼卡
    notifyAgentMessageMock.mockRejectedValueOnce(new Error("db down"));
    await expect(reportFunnelError({ source: "worker:x", err: new Error("boom") })).resolves.toBeUndefined();
  });

  it("getDb() 本身丟例外 → 當作 DB 不可用,仍照常貼新卡(不放棄)", async () => {
    getDbMock.mockRejectedValueOnce(new Error("connection pool exhausted"));
    await expect(reportFunnelError({ source: "worker:x", err: new Error("boom") })).resolves.toBeUndefined();
    expect(notifyAgentMessageMock).toHaveBeenCalledTimes(1);
  });

  it("DB select 查詢本身丟例外 → 當作 DB 不可用,仍照常貼新卡", async () => {
    const fakeDb = makeFakeDb({
      selectImpl: () => {
        throw new Error("query timeout");
      },
    });
    getDbMock.mockResolvedValue(fakeDb);
    await expect(reportFunnelError({ source: "worker:x", err: new Error("boom") })).resolves.toBeUndefined();
    expect(notifyAgentMessageMock).toHaveBeenCalledTimes(1);
  });

  it("DB update 丟例外(既有卡 UPDATE 失敗)→ 不炸,也不重新 insert", async () => {
    const existingRow = { id: 1, context: JSON.stringify({ count: 1 }) };
    const fakeDb = makeFakeDb({ selectRows: [existingRow], updateThrows: true });
    getDbMock.mockResolvedValue(fakeDb);
    await expect(reportFunnelError({ source: "worker:x", err: new Error("boom") })).resolves.toBeUndefined();
    expect(notifyAgentMessageMock).not.toHaveBeenCalled();
  });

  it("err 不是 Error instance(例如字串/物件)也不炸,仍能成卡", async () => {
    getDbMock.mockResolvedValue(null);
    await expect(reportFunnelError({ source: "worker:x", err: "raw string error" })).resolves.toBeUndefined();
    await expect(reportFunnelError({ source: "worker:y", err: { weird: true } })).resolves.toBeUndefined();
    expect(notifyAgentMessageMock).toHaveBeenCalledTimes(2);
  });
});

describe("reportFunnelError — priority 鎖死 high", () => {
  it("永遠是 high,即使 context 帶奇怪內容(例如試圖塞 priority)也不會變 critical", async () => {
    getDbMock.mockResolvedValue(null);
    await reportFunnelError({
      source: "trpc:admin.someRoute",
      err: new Error("500"),
      context: { priority: "critical", note: "呼叫端試圖影響優先度,不該生效" },
    });
    expect(notifyAgentMessageMock).toHaveBeenCalledTimes(1);
    const arg = notifyAgentMessageMock.mock.calls[0][0] as any;
    expect(arg.priority).toBe("high");
    expect(arg.agentName).toBe("error-funnel");
    expect(arg.messageType).toBe("alert");
    // 呼叫端的 context 進 extra,不會覆蓋頂層欄位。
    expect(arg.context.extra).toEqual({ priority: "critical", note: "呼叫端試圖影響優先度,不該生效" });
  });

  it("body 至少包含 source + errorName + message", async () => {
    getDbMock.mockResolvedValue(null);
    await reportFunnelError({ source: "cron:weeklyCanary", err: new TypeError("bad shape") });
    const arg = notifyAgentMessageMock.mock.calls[0][0] as any;
    expect(arg.body).toContain("cron:weeklyCanary");
    expect(arg.body).toContain("TypeError");
    expect(arg.body).toContain("bad shape");
  });
});

describe("wireWorkerFunnel", () => {
  it("worker 'failed' 事件觸發 reportFunnelError(透過 notifyAgentMessage 驗證 source 含 queueName)", async () => {
    getDbMock.mockResolvedValue(null);
    const worker = new EventEmitter();
    wireWorkerFunnel(worker as any, "gmailPoll");

    worker.emit("failed", { id: 42 }, new Error("job exploded"));
    // fire-and-forget:等一輪 microtask 讓內部 async 完成。
    await new Promise((r) => setTimeout(r, 0));

    expect(notifyAgentMessageMock).toHaveBeenCalledTimes(1);
    const arg = notifyAgentMessageMock.mock.calls[0][0] as any;
    expect(arg.title).toContain("worker:gmailPoll");
    expect(arg.context.extra).toEqual({ jobId: 42 });
  });

  it("worker 'error' 事件觸發 reportFunnelError", async () => {
    getDbMock.mockResolvedValue(null);
    const worker = new EventEmitter();
    wireWorkerFunnel(worker as any, "customerBackfill");

    worker.emit("error", new Error("redis connection lost"));
    await new Promise((r) => setTimeout(r, 0));

    expect(notifyAgentMessageMock).toHaveBeenCalledTimes(1);
    const arg = notifyAgentMessageMock.mock.calls[0][0] as any;
    expect(arg.title).toContain("worker:customerBackfill");
  });

  it("加掛不取代:worker 已有的 'failed' 監聽器在 wireWorkerFunnel 掛上後仍會被觸發", async () => {
    getDbMock.mockResolvedValue(null);
    const worker = new EventEmitter();
    const existingListener = vi.fn();
    worker.on("failed", existingListener);

    wireWorkerFunnel(worker as any, "duplicateProfileScan");
    worker.emit("failed", { id: 7 }, new Error("boom"));
    await new Promise((r) => setTimeout(r, 0));

    expect(existingListener).toHaveBeenCalledTimes(1); // 原本的監聽器沒被取代
    expect(notifyAgentMessageMock).toHaveBeenCalledTimes(1); // errorFunnel 的監聽器也觸發了
  });

  it("fire-and-forget:即使 reportFunnelError 內部深處丟出未預期例外,worker 事件迴圈也不會炸(同步呼叫不拋出)", async () => {
    getDbMock.mockImplementation(async () => {
      throw new Error("catastrophic");
    });
    const worker = new EventEmitter();
    expect(() => {
      wireWorkerFunnel(worker as any, "q");
      worker.emit("failed", { id: 1 }, new Error("boom"));
    }).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
