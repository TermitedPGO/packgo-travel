/**
 * AuditLogTab 鏈驗證結果的承重 render 測試(audit-chain-repair R5-4)。
 *
 * 釘死綠燈語意:有錨(legacyRows>0)時只能顯「自錨點起完整;錨前 N 列未驗證」
 * (chainOkFromAnchor),不得顯整條「未偵測到竄改」(chainOk);多錨顯紅色警示。
 * 刪掉 AuditLogTab 的 legacy 分流或 multiEpochWarning 區塊,對應測試會紅。
 */
import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { React?: typeof React }).React = React;

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v ? `${k}[${Object.values(v).join(",")}]` : k),
    language: "zh-TW",
  }),
}));

type VerifyData = {
  ok: boolean;
  totalRows: number;
  hashedRows: number;
  ungatedRows: number;
  legacyRows: number;
  epochStartId: number | null;
  epochCount: number;
  anomalies: Array<{ rowId: number; kind: string; detail?: string }>;
};
let VERIFY: VerifyData | undefined;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    system: {
      auditLogList: {
        useQuery: () => ({ data: { items: [], total: 0 }, isLoading: false, refetch: () => {} }),
      },
      auditLogVerifyChain: {
        useQuery: () => ({ data: VERIFY, isLoading: false, isFetching: false, refetch: () => {} }),
      },
    },
  },
}));

const { default: AuditLogTab } = await import("./AuditLogTab");

const base: VerifyData = {
  ok: true, totalRows: 340, hashedRows: 3, ungatedRows: 0,
  legacyRows: 337, epochStartId: 1000, epochCount: 1, anomalies: [],
};

describe("AuditLogTab — 鏈驗證綠燈語意(R5-4)", () => {
  it("ok + 有錨 → 顯 chainOkFromAnchor(範圍限定),不得顯整條 chainOk", () => {
    VERIFY = { ...base };
    const html = renderToStaticMarkup(createElement(AuditLogTab));
    expect(html).toContain("admin.auditLog.chainOkFromAnchor[1000,337]");
    expect(html).not.toContain("admin.auditLog.chainOk<"); // 全鏈綠燈文案不得出現
    expect(html).toContain("admin.auditLog.legacyRows[337]");
    expect(html).toContain("admin.auditLog.epochAnchor[1000]");
  });
  it("ok + 無錨無 legacy(全新乾淨表)→ 顯原 chainOk", () => {
    VERIFY = { ...base, legacyRows: 0, epochStartId: null, epochCount: 0, totalRows: 3 };
    const html = renderToStaticMarkup(createElement(AuditLogTab));
    expect(html).toContain("admin.auditLog.chainOk");
    expect(html).not.toContain("chainOkFromAnchor");
  });
  it("R6-4:有錨但 legacyRows=0 → 仍走 chainOkFromAnchor(分流看 epochStartId,非 legacyRows)", () => {
    VERIFY = { ...base, legacyRows: 0, epochStartId: 1000, epochCount: 1, totalRows: 3 };
    const html = renderToStaticMarkup(createElement(AuditLogTab));
    expect(html).toContain("admin.auditLog.chainOkFromAnchor[1000,0]");
    expect(html).not.toContain("admin.auditLog.chainOk<");
  });
  it("多錨(epochCount>1)→ 紅色 multiEpochWarning 出現", () => {
    VERIFY = { ...base, epochCount: 2 };
    const html = renderToStaticMarkup(createElement(AuditLogTab));
    expect(html).toContain("admin.auditLog.multiEpochWarning[2]");
  });
  it("單錨 → 無 multiEpochWarning", () => {
    VERIFY = { ...base };
    const html = renderToStaticMarkup(createElement(AuditLogTab));
    expect(html).not.toContain("multiEpochWarning");
  });
  it("異常 → 顯 chainAnomalies 紅態", () => {
    VERIFY = { ...base, ok: false, anomalies: [{ rowId: 1001, kind: "missing-hash" }] };
    const html = renderToStaticMarkup(createElement(AuditLogTab));
    expect(html).toContain("admin.auditLog.chainAnomalies[1]");
  });
});
