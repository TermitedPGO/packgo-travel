/**
 * caseDocumentImport tests (批十一 塊A). 純函式 + 硬紅線紅綠例。協調函式(importCaseDocuments)
 * 碰 R2/DB,照 repo 慣例上線後 prod 驗;這裡鎖分類、計畫、與「key 絕不落 reply-attachments/」
 * 這條架構級紅線。
 */
import { describe, it, expect } from "vitest";
import {
  classifyCaseDoc,
  assertNotOutboundKey,
  buildCaseDocPlan,
  summarizeCaseDocPlan,
  fileExt,
  contentTypeForName,
  type CaseDocFileInput,
} from "./caseDocumentImport";
import { customerDocR2Key } from "./customerDocFiling";
import { REPLY_ATTACHMENT_KEY_PREFIX } from "./replyAttachments";

describe("classifyCaseDoc — 分類", () => {
  it("護照/簽證/保險/醫療 → 對應 PII type,非內部成本", () => {
    expect(classifyCaseDoc("來源", "楊惠珍_passport.pdf")).toMatchObject({ upload: true, type: "passport", isInternalCost: false });
    expect(classifyCaseDoc("交付", "客人護照掃描.jpg")).toMatchObject({ type: "passport" });
    expect(classifyCaseDoc("來源", "visa_加拿大.pdf")).toMatchObject({ type: "visa" });
    expect(classifyCaseDoc("來源", "旅遊保險.pdf")).toMatchObject({ type: "insurance" });
    expect(classifyCaseDoc("來源", "病歷.pdf")).toMatchObject({ type: "medical" });
  });

  it("來源/ 的供應商 invoice/報價/成本 → other + isInternalCost", () => {
    expect(classifyCaseDoc("來源", "金宥_纵横_Invoice_JP0001154.pdf")).toEqual({ upload: true, type: "other", isInternalCost: true });
    expect(classifyCaseDoc("來源", "金宥_地接報價_纵横_0410.xlsx")).toEqual({ upload: true, type: "other", isInternalCost: true });
  });

  it("交付/ 的給客人產物 → other,非內部成本", () => {
    expect(classifyCaseDoc("交付", "Wu_Family_Proposal_20260627.pdf")).toEqual({ upload: true, type: "other", isInternalCost: false });
    expect(classifyCaseDoc("交付", "陳_付款收據_2人.pdf")).toEqual({ upload: true, type: "other", isInternalCost: false });
  });

  it(".md / .txt / .DS_Store / 隱藏檔 → 不歸檔(upload:false)", () => {
    expect(classifyCaseDoc("來源", "Wu_對話經驗_20260628.md")).toMatchObject({ upload: false, skipReason: "not_document_artifact" });
    expect(classifyCaseDoc("來源", "微信對話.txt")).toMatchObject({ upload: false, skipReason: "not_document_artifact" });
    expect(classifyCaseDoc("交付", ".DS_Store")).toMatchObject({ upload: false, skipReason: "hidden_or_meta" });
    expect(classifyCaseDoc("來源", ".hidden.pdf")).toMatchObject({ upload: false, skipReason: "hidden_or_meta" });
  });

  it("fileExt / contentTypeForName", () => {
    expect(fileExt("a.PDF")).toBe(".pdf");
    expect(fileExt("noext")).toBe("");
    expect(contentTypeForName("x.pdf")).toBe("application/pdf");
    expect(contentTypeForName("x.xlsx")).toContain("spreadsheet");
    expect(contentTypeForName("x.zzz")).toBe("application/octet-stream");
  });
});

describe("⛔ 硬紅線:案件文件 key 絕不落 reply-attachments/", () => {
  it("assertNotOutboundKey 紅例:reply-attachments/ 前綴 → throw", () => {
    expect(() => assertNotOutboundKey(`${REPLY_ATTACHMENT_KEY_PREFIX}9001/x.pdf`)).toThrow(/架構紅線/);
  });

  it("assertNotOutboundKey 綠例:customer-docs/ 前綴 → 放行", () => {
    expect(() => assertNotOutboundKey("customer-docs/9001/123-ab-invoice.pdf")).not.toThrow();
  });

  it("customerDocR2Key 產生的 key 一律 customer-docs/,永遠通過守門(架構級保證)", () => {
    for (const name of ["纵横_Invoice.pdf", "護照.jpg", "報價.xlsx", ".DS_Store", "x".repeat(300) + ".pdf"]) {
      const key = customerDocR2Key(2760048, name, 1_700_000_000_000, "ab12cd");
      expect(key.startsWith("customer-docs/")).toBe(true);
      expect(key.startsWith(REPLY_ATTACHMENT_KEY_PREFIX)).toBe(false);
      expect(() => assertNotOutboundKey(key)).not.toThrow();
    }
  });
});

describe("buildCaseDocPlan + summarizeCaseDocPlan — 計畫 + 冪等", () => {
  const files: CaseDocFileInput[] = [
    { subfolder: "來源", name: "金宥_纵横_Invoice_JP0001154.pdf", sizeBytes: 120_000 },
    { subfolder: "來源", name: "金宥_地接報價_纵横_0410.xlsx", sizeBytes: 40_000 },
    { subfolder: "來源", name: "金宥_供應商報價紀錄.md", sizeBytes: 3_000 },
    { subfolder: "交付", name: ".DS_Store", sizeBytes: 6_148 },
  ];

  it("首次:文件上傳、.md/.DS_Store 跳過", () => {
    const plan = buildCaseDocPlan(files, new Set());
    expect(plan.map((p) => p.action)).toEqual(["upload", "upload", "skip_not_document", "skip_not_document"]);
    expect(summarizeCaseDocPlan(plan)).toEqual({ total: 4, toUpload: 2, skippedDuplicate: 0, skippedNotDocument: 2 });
  });

  it("冪等:已匯入的 fileName → skip_duplicate", () => {
    const plan = buildCaseDocPlan(files, new Set(["金宥_纵横_Invoice_JP0001154.pdf"]));
    expect(plan[0].action).toBe("skip_duplicate");
    expect(plan[1].action).toBe("upload");
    expect(summarizeCaseDocPlan(plan)).toMatchObject({ toUpload: 1, skippedDuplicate: 1 });
  });
});
