import { describe, it, expect } from "vitest";
import { wrapInBrandTemplate, emailButton, emailDivider, emailInfoRow, emailInfoTable, emailHeading, emailParagraph, emailHighlightBox } from "./emailTemplateService";

describe("EmailTemplateService", () => {
  describe("wrapInBrandTemplate", () => {
    it("includes PACK&GO brand header", () => {
      const html = wrapInBrandTemplate({ title: "Test", bodyHtml: "<p>Test</p>" });
      expect(html).toContain("PACK");  // PACK&GO brand name appears in header
    });

    it("includes company address in footer", () => {
      const html = wrapInBrandTemplate({ title: "Test", bodyHtml: "<p>Test</p>" });
      expect(html).toContain("39055 Cedar Blvd #126");
      expect(html).toContain("Newark, CA 94560");
    });

    it("includes phone number in footer", () => {
      const html = wrapInBrandTemplate({ title: "Test", bodyHtml: "<p>Test</p>" });
      expect(html).toContain("+1 (510) 634-2307");
    });

    it("includes unsubscribe link", () => {
      const html = wrapInBrandTemplate({ title: "Test", bodyHtml: "<p>Test</p>" });
      expect(html).toContain("unsubscribe");
      expect(html).toContain("取消訂閱");
    });

    it("includes body HTML content", () => {
      const bodyHtml = "<p>Hello, World!</p>";
      const html = wrapInBrandTemplate({ title: "Test", bodyHtml });
      expect(html).toContain(bodyHtml);
    });

    it("uses brand color #0D9488", () => {
      const html = wrapInBrandTemplate({ title: "Test", bodyHtml: "<p>Test</p>" });
      expect(html).toContain("#0D9488");
    });

    it("includes © 2026 copyright", () => {
      const html = wrapInBrandTemplate({ title: "Test", bodyHtml: "<p>Test</p>" });
      expect(html).toContain("© 2026");
    });

    it("includes preheader when provided", () => {
      const html = wrapInBrandTemplate({ title: "Test", bodyHtml: "<p>Test</p>", preheader: "Preview text" });
      expect(html).toContain("Preview text");
    });

    it("omits footer when showFooter is false", () => {
      const html = wrapInBrandTemplate({ title: "Test", bodyHtml: "<p>Test</p>", showFooter: false });
      expect(html).not.toContain("39055 Cedar Blvd");
    });

    it("includes title in document head", () => {
      const html = wrapInBrandTemplate({ title: "My Email Title", bodyHtml: "<p>Test</p>" });
      expect(html).toContain("<title>My Email Title</title>");
    });
  });

  describe("emailButton", () => {
    it("renders a button with correct text and URL", () => {
      const btn = emailButton("Click Me", "https://example.com");
      expect(btn).toContain("Click Me");
      expect(btn).toContain("https://example.com");
    });

    it("uses brand color by default", () => {
      const btn = emailButton("Test", "https://example.com");
      expect(btn).toContain("#0D9488");
    });

    it("accepts custom color", () => {
      const btn = emailButton("Test", "https://example.com", "#FF0000");
      expect(btn).toContain("#FF0000");
    });
  });

  describe("emailDivider", () => {
    it("renders an HR element", () => {
      const divider = emailDivider();
      expect(divider).toContain("<hr");
    });
  });

  describe("emailInfoRow", () => {
    it("renders label and value", () => {
      const row = emailInfoRow("Name", "John Doe");
      expect(row).toContain("Name");
      expect(row).toContain("John Doe");
    });
  });

  describe("emailInfoTable", () => {
    it("renders all rows", () => {
      const table = emailInfoTable([
        { label: "Name", value: "John" },
        { label: "Email", value: "john@example.com" },
      ]);
      expect(table).toContain("Name");
      expect(table).toContain("John");
      expect(table).toContain("Email");
      expect(table).toContain("john@example.com");
    });
  });

  describe("emailHeading", () => {
    it("renders heading with correct font size for level 1", () => {
      const h = emailHeading("Title", 1);
      expect(h).toContain("24px");
      expect(h).toContain("Title");
    });

    it("renders heading with correct font size for level 2 (default)", () => {
      const h = emailHeading("Title");
      expect(h).toContain("20px");
    });

    it("renders heading with correct font size for level 3", () => {
      const h = emailHeading("Title", 3);
      expect(h).toContain("16px");
    });
  });

  describe("emailParagraph", () => {
    it("renders paragraph with text", () => {
      const p = emailParagraph("Hello World");
      expect(p).toContain("Hello World");
    });
  });

  describe("emailHighlightBox", () => {
    it("renders highlight box with content", () => {
      const box = emailHighlightBox("<p>Important</p>");
      expect(box).toContain("Important");
    });

    it("uses brand color border by default", () => {
      const box = emailHighlightBox("<p>Test</p>");
      expect(box).toContain("#0D9488");
    });
  });
});
