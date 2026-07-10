/**
 * claimCategories 測試 —— 認領分類下拉「鎖 SCHEDULE_C_MAP 枚舉」的結構性保證。
 *
 * 測試檔在 node 環境可同時 import client 鏡像與 server 真枚舉(產品碼不行,
 * 會把 server 打進 bundle);兩邊完全一致,server 加減分類時這裡會紅。
 */
import { describe, it, expect } from "vitest";
import { CLAIM_CATEGORIES, CLAIM_CATEGORY_LABEL_KEY } from "./claimCategories";
import { SCHEDULE_C_MAP } from "../../../../../server/services/bankPLService";

describe("claimCategories — 鎖 SCHEDULE_C_MAP 枚舉", () => {
  it("client 鏡像 = server SCHEDULE_C_MAP 的 key 集合(不多不少)", () => {
    const serverKeys = Object.keys(SCHEDULE_C_MAP).sort();
    const clientKeys = [...CLAIM_CATEGORIES].sort();
    expect(clientKeys).toEqual(serverKeys);
  });

  it("每個分類都有 i18n label key(下拉無裸 code)", () => {
    for (const c of CLAIM_CATEGORIES) {
      expect(CLAIM_CATEGORY_LABEL_KEY[c]).toMatch(/^financeCockpit\.claim\.cat/);
    }
    expect(Object.keys(CLAIM_CATEGORY_LABEL_KEY).sort()).toEqual([...CLAIM_CATEGORIES].sort());
  });
});
