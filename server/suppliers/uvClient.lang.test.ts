/**
 * uvClient 語言接線測試(feature: supplier-import-language)。
 *
 * 鎖住的核心語義:**預設繁中、非法值不退英文、語言一路傳到底**。
 *
 * 背景(2026-08-04):uvClient 原本四處把語言寫死成 3=英文,而
 * supplierSync/hydration.ts 是零 LLM 純轉換,供應商給的英文字會原封不動寫進
 * tours 對客欄位。所以「語言有沒有正確送出去」不是內部細節,是客人頁會不會
 * 長出英文原文的直接因素。
 *
 * 這裡刻意驗「實際送出的請求」而非「函式回傳值」:語言必須同時出現在 header
 * (languageCode)與 body(productLanguage),兩者不一致正是這類 bug 的形狀。
 * 不打真實 API(測試禁止依賴外部網路)。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

import { listProducts, getProductMain, getProductTravelDetail } from "./uvClient";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = process.env.UV_IMPORT_LANGUAGE;

/** 攔下的請求,供斷言用。 */
type Captured = { url: string; headers: Record<string, string>; body: any };
let captured: Captured[] = [];

const soaOk = (responseData: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({
    ResponseStatus: { Ack: "Success", Errors: [] },
    responseResult: { code: 200, msg: "ok", msgCode: "" },
    responseData,
  }),
});

beforeEach(() => {
  captured = [];
  globalThis.fetch = (async (url: any, init: any) => {
    captured.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    // 回傳形狀足以讓三支函式各自解析成功即可,內容不是本檔重點。
    return soaOk({ pager: { totalCount: 0, pageIndex: 1, pageSize: 1 }, list: [] });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_ENV === undefined) delete process.env.UV_IMPORT_LANGUAGE;
  else process.env.UV_IMPORT_LANGUAGE = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

/** 三支對外函式各跑一次,回傳攔到的請求。 */
async function callAllThree(): Promise<Captured[]> {
  captured = [];
  await listProducts({ page: 1, pageSize: 1 });
  await getProductMain("P00000001");
  await getProductTravelDetail("P00000001");
  return captured;
}

describe("uvClient 語言 — 預設值", () => {
  it("未設 UV_IMPORT_LANGUAGE → 三個端點全部送繁中(header 2 / body 2)", async () => {
    delete process.env.UV_IMPORT_LANGUAGE;
    const reqs = await callAllThree();

    expect(reqs).toHaveLength(3);
    for (const r of reqs) {
      expect(r.headers.languageCode).toBe("2");
      expect(r.body.productLanguage).toBe(2);
    }
  });

  it("未設定時 Accept-Language 也是繁中,不是英文", async () => {
    delete process.env.UV_IMPORT_LANGUAGE;
    const [r] = await callAllThree();
    expect(r.headers["Accept-Language"]).toMatch(/^zh-TW/);
    expect(r.headers["Accept-Language"]).not.toMatch(/^en/);
  });
});

describe("uvClient 語言 — header 與 body 一致(結構性保證)", () => {
  // 兩者不一致 = 語言沒有一路傳到底,正是本 feature 要根除的 bug 形狀。
  it.each(["zh-TW", "zh-CN", "en"])("設 %s 時三個端點的 header 與 body 同語言", async (tag) => {
    process.env.UV_IMPORT_LANGUAGE = tag;
    const reqs = await callAllThree();

    expect(reqs).toHaveLength(3);
    for (const r of reqs) {
      expect(String(r.body.productLanguage)).toBe(r.headers.languageCode);
    }
  });
});

describe("uvClient 語言 — 可切換(證明不是寫死成繁中)", () => {
  it("設 en → 送 3;設 zh-CN → 送 1", async () => {
    process.env.UV_IMPORT_LANGUAGE = "en";
    for (const r of await callAllThree()) {
      expect(r.headers.languageCode).toBe("3");
      expect(r.body.productLanguage).toBe(3);
    }

    process.env.UV_IMPORT_LANGUAGE = "zh-CN";
    for (const r of await callAllThree()) {
      expect(r.headers.languageCode).toBe("1");
      expect(r.body.productLanguage).toBe(1);
    }
  });
});

describe("uvClient 語言 — 非法值退回繁中,不退回英文", () => {
  // 退回英文 = 靜默重蹈覆轍(客人頁又長出英文原文)。這條是本 feature 的核心
  // 語義:失敗要落在我們要的語言,不是我們不要的語言。
  it.each(["", "   ", "zh", "japanese", "2", "true", "EN-GB"])(
    "UV_IMPORT_LANGUAGE=%j → 繁中(2),且明確不等於英文(3)",
    async (bad) => {
      process.env.UV_IMPORT_LANGUAGE = bad;
      const [r] = await callAllThree();
      expect(r.headers.languageCode).toBe("2");
      expect(r.headers.languageCode).not.toBe("3");
      expect(r.body.productLanguage).toBe(2);
    }
  );
});

describe("uvClient 語言 — 呼叫點不得自行夾帶語言", () => {
  it("body 的 productLanguage 由 callSoa 覆寫,呼叫點傳的不算數", async () => {
    // 語言是傳輸層的事。若日後有人在某個端點的 body 塞回 productLanguage,
    // 也不能讓它跟 header 分家 —— 這條鎖住那個回歸。
    process.env.UV_IMPORT_LANGUAGE = "zh-TW";
    const reqs = await callAllThree();
    for (const r of reqs) {
      expect(r.body.productLanguage).toBe(2);
      expect(String(r.body.productLanguage)).toBe(r.headers.languageCode);
    }
  });

  it("每個請求都帶 branchcode 與 requestUser(語言改動未破壞既有欄位)", async () => {
    const reqs = await callAllThree();
    for (const r of reqs) {
      expect(r.headers.branchcode).toBe("B00000003");
      expect(r.body.requestUser).toMatchObject({ branchcode: "B00000003", userName: "GUEST" });
    }
  });
});
