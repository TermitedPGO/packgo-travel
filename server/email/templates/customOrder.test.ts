/**
 * 訂製單 email 三封信測試。design.md §4.4 + 紅線。
 * 蓋:語言挑選、**信內無破折號**、**無成本字眼**、幣別符號、金額格式、CTA 連結。
 *
 * 用 vi.hoisted 捕捉 sendMail 參數;mock SMTP(假 transporter)+ notifyOwner。
 * 與 SUT 同層放置,讓 "../_shared" / "../../_core/notification" 解析一致。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ sent: [] as any[], sendMailShouldThrow: false }));

vi.mock("../_shared", () => ({
  EMAIL_FROM: "test@packgo.com",
  getTransporter: () => ({
    sendMail: async (m: any) => {
      if (h.sendMailShouldThrow) {
        throw new Error("SMTP connection reset by peer");
      }
      h.sent.push(m);
      return { messageId: "x" };
    },
  }),
}));
vi.mock("../../_core/notification", () => ({
  notifyOwner: async () => true,
}));

// 生產碼呼叫端一律 reportFunnelError(...).catch(() => {}) —— mock 必須永遠回
// resolved promise,不能依賴 reportFunnelErrorMock 自己的回傳值(vi.fn()
// 預設回傳 undefined,mockReset() 後更是如此,.catch 會直接炸掉呼叫端)。
const reportFunnelErrorMock = vi.fn();
vi.mock("../../_core/errorFunnel", () => ({
  reportFunnelError: (...args: unknown[]) => {
    reportFunnelErrorMock(...args);
    return Promise.resolve();
  },
}));

import {
  sendCustomOrderQuoteEmail,
  sendCustomOrderCollectionEmail,
  sendCustomOrderConfirmationEmail,
} from "./customOrder";

const last = () => h.sent[h.sent.length - 1];
const allText = (m: any) => `${m.subject}\n${m.text}\n${m.html}`;

beforeEach(() => {
  h.sent.length = 0;
  h.sendMailShouldThrow = false;
  reportFunnelErrorMock.mockReset();
});

describe("redline — no em dashes, no cost ever", () => {
  const cases: Array<[string, () => Promise<boolean>]> = [
    ["quote-zh", () => sendCustomOrderQuoteEmail({ customerEmail: "a@b.co", customerName: "王先生", orderNumber: "ORD-2026-0001", title: "台灣12天", quotePdfUrl: "https://x/q.pdf" })],
    ["quote-en", () => sendCustomOrderQuoteEmail({ customerEmail: "a@b.co", customerName: "John", orderNumber: "ORD-2026-0001", title: "Taiwan 12 days", language: "en", quotePdfUrl: "https://x/q.pdf" })],
    ["deposit-zh", () => sendCustomOrderCollectionEmail({ customerEmail: "a@b.co", customerName: "王先生", orderNumber: "ORD-2026-0001", title: "台灣12天", kind: "deposit", amount: 1200, paymentLink: "https://sq/pay" })],
    ["balance-en", () => sendCustomOrderCollectionEmail({ customerEmail: "a@b.co", customerName: "John", orderNumber: "ORD-2026-0001", title: "Taiwan", kind: "balance", amount: 3400, language: "en", paymentLink: "https://sq/pay" })],
    ["confirm-zh", () => sendCustomOrderConfirmationEmail({ customerEmail: "a@b.co", customerName: "王先生", orderNumber: "ORD-2026-0001", title: "台灣12天", confirmationPdfUrl: "https://x/c.pdf", departureDate: "2026-12-20" })],
    ["confirm-en", () => sendCustomOrderConfirmationEmail({ customerEmail: "a@b.co", customerName: "John", orderNumber: "ORD-2026-0001", title: "Taiwan", language: "en", confirmationPdfUrl: "https://x/c.pdf" })],
  ];
  it.each(cases)("%s contains no em dash and no cost wording", async (_label, run) => {
    await run();
    const blob = allText(last());
    expect(blob).not.toContain("—"); // em dash
    expect(blob).not.toContain("–"); // en dash
    expect(blob.toLowerCase()).not.toContain("supplier");
    expect(blob.toLowerCase()).not.toContain("cost");
    expect(blob).not.toContain("成本");
    expect(blob).not.toContain("供應商");
  });
});

describe("language selection", () => {
  it("zh quote uses Chinese subject + brand line", async () => {
    await sendCustomOrderQuoteEmail({ customerEmail: "a@b.co", customerName: "王先生", orderNumber: "ORD-1", title: "台灣" });
    const m = last();
    expect(m.subject).toContain("行程報價");
    expect(m.text).toContain("PACK&GO 旅行社");
  });
  it("en quote uses English subject + brand line", async () => {
    await sendCustomOrderQuoteEmail({ customerEmail: "a@b.co", customerName: "John", orderNumber: "ORD-1", title: "Taiwan", language: "en" });
    const m = last();
    expect(m.subject).toContain("Your quote");
    expect(m.text).toContain("PACK&GO Travel");
  });
});

describe("currency + money formatting", () => {
  it("USD deposit renders $ and thousands separators", async () => {
    await sendCustomOrderCollectionEmail({ customerEmail: "a@b.co", orderNumber: "ORD-1", title: "X", kind: "deposit", amount: 1200, currency: "USD" });
    expect(last().text).toContain("$1,200");
  });
  it("TWD balance renders NT$ never bare $", async () => {
    await sendCustomOrderCollectionEmail({ customerEmail: "a@b.co", orderNumber: "ORD-1", title: "X", kind: "balance", amount: 45000, currency: "TWD" });
    expect(last().text).toContain("NT$45,000");
  });
});

describe("delivery + CTA", () => {
  it("returns true when transporter present and includes the pay link", async () => {
    const ok = await sendCustomOrderCollectionEmail({ customerEmail: "a@b.co", orderNumber: "ORD-1", title: "X", kind: "deposit", amount: 100, paymentLink: "https://sq/pay/abc" });
    expect(ok).toBe(true);
    expect(last().html).toContain("https://sq/pay/abc");
  });
  it("greeting falls back gracefully with no name", async () => {
    await sendCustomOrderQuoteEmail({ customerEmail: "a@b.co", orderNumber: "ORD-1", title: "X" });
    expect(last().text.startsWith("您好,")).toBe(true);
  });
});

// fail-open 盤點代表性樣本(highRiskType: customer-output) — SMTP sendMail
// 實際丟例外(server/email/templates/customOrder.ts:87)。舊行為:catch 只
// console.error + notifyOwner 心安通知,deliver() 吞掉回傳 false,客人可能
// 完全收不到報價/確認信卻無人被明確告警。上一輪接線加了 reportFunnelError,
// 行為不變(仍然吞掉、仍然回 false,不拋出到呼叫端)。
describe("fail-open funnel wiring — SMTP send failure (server/email/templates/customOrder.ts:87)", () => {
  it("sendMail throws → funnel gets the error, deliver() still resolves false (not throw)", async () => {
    h.sendMailShouldThrow = true;

    const ok = await sendCustomOrderQuoteEmail({
      customerEmail: "a@b.co",
      customerName: "王先生",
      orderNumber: "ORD-2026-0099",
      title: "台灣12天",
      quotePdfUrl: "https://x/q.pdf",
    });

    // 原本行為:不拋出,回傳 false,呼叫端(adminCustomerOrders send* mutation)
    // 自己決定怎麼呈現失敗,不會意外把例外炸到 tRPC 層。
    expect(ok).toBe(false);
    expect(h.sent).toHaveLength(0);

    // 新增行為:漏斗被觸發,source + context.logLabel 精確匹配接線點。
    expect(reportFunnelErrorMock).toHaveBeenCalledTimes(1);
    expect(reportFunnelErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "fail-open:customOrder:deliverSmtpSend",
        context: expect.objectContaining({ logLabel: "custom-order quote ORD-2026-0099" }),
      }),
    );
  });

  it("happy path (sendMail succeeds) → no funnel noise", async () => {
    const ok = await sendCustomOrderQuoteEmail({
      customerEmail: "a@b.co",
      orderNumber: "ORD-1",
      title: "X",
    });
    expect(ok).toBe(true);
    expect(reportFunnelErrorMock).not.toHaveBeenCalled();
  });
});
