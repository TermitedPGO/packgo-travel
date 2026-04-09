/**
 * marketingServices.test.ts
 * Unit tests for marketingCopyService, posterGeneratorService, emailMarketingService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// marketingCopyService tests
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../db", () => ({
  getTourById: vi.fn(),
  updateMarketingCampaign: vi.fn(),
}));

vi.mock("../_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

vi.mock("../storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ url: "https://s3.example.com/poster.png" }),
}));

vi.mock("puppeteer", () => ({
  default: {
    launch: vi.fn(),
  },
}));

import { getTourById, updateMarketingCampaign } from "../db";
import { invokeLLM } from "../_core/llm";
import {
  generateSocialCopy,
  generateAllPlatformCopy,
  type SocialCopyResult,
} from "./marketingCopyService";
import {
  generateNewsletterHtml,
  sendNewsletter,
  type NewsletterTourCard,
} from "./emailMarketingService";
import {
  buildPosterHtml,
  generatePoster,
  type PosterOptions,
} from "./posterGeneratorService";
import puppeteer from "puppeteer";

const mockTour = {
  id: 1,
  title: "日本關西賞楓 5 天 4 夜",
  destination: "日本大阪・京都・奈良",
  duration: 5,
  price: 1299,
  priceCurrency: "USD",
  highlights: JSON.stringify(["嵐山竹林", "伏見稻荷", "奈良鹿公園"]),
  meals: JSON.stringify([{ name: "懷石料理" }, { name: "抹茶體驗" }]),
  hotels: JSON.stringify([{ name: "京都四季酒店" }]),
};

const mockCopyResult: SocialCopyResult = {
  copyText: "秋天的京都，楓葉如火如荼！",
  hashtags: ["#PACKGO旅行社", "#日本旅遊", "#京都"],
  callToAction: "立即報名",
  imageCaption: "嵐山竹林秋色",
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. marketingCopyService
// ─────────────────────────────────────────────────────────────────────────────

describe("marketingCopyService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getTourById as ReturnType<typeof vi.fn>).mockResolvedValue(mockTour);
    (invokeLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify(mockCopyResult),
          },
        },
      ],
    });
  });

  it("should generate Facebook copy successfully", async () => {
    const result = await generateSocialCopy({
      tourId: 1,
      platform: "facebook",
    });
    expect(result.copyText).toBeTruthy();
    expect(result.hashtags).toBeInstanceOf(Array);
    expect(result.callToAction).toBeTruthy();
  });

  it("should generate Instagram copy successfully", async () => {
    const result = await generateSocialCopy({
      tourId: 1,
      platform: "instagram",
    });
    expect(result.copyText).toBeTruthy();
    expect(result.hashtags.length).toBeGreaterThan(0);
  });

  it("should generate LINE copy successfully", async () => {
    const result = await generateSocialCopy({
      tourId: 1,
      platform: "line",
    });
    expect(result.copyText).toBeTruthy();
    expect(result.callToAction).toBeTruthy();
  });

  it("should throw error when tour not found", async () => {
    (getTourById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      generateSocialCopy({ tourId: 999, platform: "facebook" })
    ).rejects.toThrow("Tour 999 not found");
  });

  it("should ensure hashtags start with #", async () => {
    (invokeLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              ...mockCopyResult,
              hashtags: ["PACKGO旅行社", "#日本旅遊"],
            }),
          },
        },
      ],
    });
    const result = await generateSocialCopy({ tourId: 1, platform: "facebook" });
    result.hashtags.forEach((tag) => {
      expect(tag).toMatch(/^#/);
    });
  });

  it("should handle markdown-fenced JSON response", async () => {
    (invokeLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      choices: [
        {
          message: {
            content: "```json\n" + JSON.stringify(mockCopyResult) + "\n```",
          },
        },
      ],
    });
    const result = await generateSocialCopy({ tourId: 1, platform: "instagram" });
    expect(result.copyText).toBe(mockCopyResult.copyText);
  });

  it("should throw error when LLM returns empty response", async () => {
    (invokeLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      choices: [{ message: { content: "" } }],
    });
    await expect(
      generateSocialCopy({ tourId: 1, platform: "facebook" })
    ).rejects.toThrow("LLM returned empty response");
  });

  it("should generate all platform copies in parallel", async () => {
    const result = await generateAllPlatformCopy(1, "exciting", "zh-TW");
    expect(result).toHaveProperty("facebook");
    expect(result).toHaveProperty("instagram");
    expect(result).toHaveProperty("line");
    // invokeLLM should be called 3 times
    expect(invokeLLM).toHaveBeenCalledTimes(3);
  });

  it("should use default tone=exciting when not specified", async () => {
    await generateSocialCopy({ tourId: 1, platform: "facebook" });
    const callArgs = (invokeLLM as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).toContain("熱情、興奮、充滿活力");
  });

  it("should use luxury tone when specified", async () => {
    await generateSocialCopy({ tourId: 1, platform: "facebook", tone: "luxury" });
    const callArgs = (invokeLLM as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userMessage = callArgs.messages.find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).toContain("高端、奢華、精緻體驗");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. posterGeneratorService (buildPosterHtml unit tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("posterGeneratorService - buildPosterHtml", () => {
  const baseOptions: PosterOptions & { width: number; height: number } = {
    tourId: 1,
    format: "landscape",
    heroImageUrl: "https://example.com/hero.jpg",
    title: "日本關西賞楓 5 天 4 夜",
    destination: "日本大阪・京都",
    duration: "5天4夜",
    price: "USD $1,299 起",
    highlights: ["嵐山竹林", "伏見稻荷", "奈良鹿公園"],
    width: 1200,
    height: 630,
  };

  it("should generate valid HTML for landscape format", () => {
    const html = buildPosterHtml(baseOptions);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("日本關西賞楓 5 天 4 夜");
    expect(html).toContain("USD $1,299 起");
  });

  it("should generate valid HTML for square format", () => {
    const html = buildPosterHtml({ ...baseOptions, format: "square", width: 1080, height: 1080 });
    expect(html).toContain("1080px");
    expect(html).toContain("1080px");
  });

  it("should generate valid HTML for story format", () => {
    const html = buildPosterHtml({ ...baseOptions, format: "story", width: 1080, height: 1920 });
    expect(html).toContain("1920px");
    expect(html).toContain("PACK&amp;GO");
  });

  it("should include up to 3 highlights", () => {
    const html = buildPosterHtml({
      ...baseOptions,
      highlights: ["亮點1", "亮點2", "亮點3", "亮點4"],
    });
    expect(html).toContain("亮點1");
    expect(html).toContain("亮點3");
    // 4th highlight should not appear
    expect(html).not.toContain("亮點4");
  });

  it("should escape HTML special characters in title", () => {
    const html = buildPosterHtml({
      ...baseOptions,
      title: "Tour <script>alert('xss')</script>",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("should use custom overlay color when provided", () => {
    const html = buildPosterHtml({
      ...baseOptions,
      overlayColor: "rgba(255, 0, 0, 0.7)",
    });
    expect(html).toContain("rgba(255, 0, 0, 0.7)");
  });

  it("should use default overlay color when not provided", () => {
    const html = buildPosterHtml(baseOptions);
    expect(html).toContain("rgba(13, 148, 136, 0.82)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. emailMarketingService - generateNewsletterHtml
// ─────────────────────────────────────────────────────────────────────────────

describe("emailMarketingService - generateNewsletterHtml", () => {
  const mockTours: NewsletterTourCard[] = [
    {
      id: 1,
      title: "日本關西賞楓",
      destination: "日本大阪",
      duration: "5天4夜",
      price: 1299,
      heroImage: "https://example.com/japan.jpg",
      highlights: ["嵐山竹林", "伏見稻荷"],
    },
    {
      id: 2,
      title: "韓國首爾春遊",
      destination: "韓國首爾",
      duration: "4天3夜",
      price: 999,
      heroImage: "https://example.com/korea.jpg",
      highlights: ["景福宮", "明洞購物"],
    },
  ];

  it("should generate valid HTML email with tours", () => {
    const html = generateNewsletterHtml({
      subject: "春季特惠行程",
      preheader: "限時優惠，立即預訂",
      tours: mockTours,
    });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("日本關西賞楓");
    expect(html).toContain("韓國首爾春遊");
  });

  it("should include price in correct format", () => {
    const html = generateNewsletterHtml({
      subject: "特惠行程",
      preheader: "限時優惠",
      tours: mockTours,
    });
    expect(html).toContain("USD $1,299 起");
    expect(html).toContain("USD $999 起");
  });

  it("should include up to 3 highlights per tour", () => {
    const html = generateNewsletterHtml({
      subject: "特惠行程",
      preheader: "限時優惠",
      tours: [
        {
          ...mockTours[0],
          highlights: ["亮點1", "亮點2", "亮點3", "亮點4"],
        },
      ],
    });
    expect(html).toContain("亮點1");
    expect(html).toContain("亮點3");
    expect(html).not.toContain("亮點4");
  });

  it("should include custom header and footer messages", () => {
    const html = generateNewsletterHtml({
      subject: "特惠行程",
      preheader: "限時優惠",
      tours: mockTours,
      headerMessage: "自訂標題訊息",
      footerMessage: "自訂頁尾訊息",
    });
    expect(html).toContain("自訂標題訊息");
    expect(html).toContain("自訂頁尾訊息");
  });

  it("should escape HTML in tour title", () => {
    const html = generateNewsletterHtml({
      subject: "特惠行程",
      preheader: "限時優惠",
      tours: [
        {
          ...mockTours[0],
          title: "Tour <script>xss</script>",
        },
      ],
    });
    expect(html).not.toContain("<script>xss</script>");
  });

  it("should return empty string when no tours provided", () => {
    const html = generateNewsletterHtml({
      subject: "特惠行程",
      preheader: "限時優惠",
      tours: [],
    });
    // Should still be valid HTML but with no tour cards
    expect(html).toContain("<!DOCTYPE html>");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. emailMarketingService - sendNewsletter
// ─────────────────────────────────────────────────────────────────────────────

describe("emailMarketingService - sendNewsletter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (updateMarketingCampaign as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    // Clear transporter cache
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_PASSWORD;
  });

  afterEach(() => {
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_PASSWORD;
  });

  it("should return 0 sent when no SMTP config", async () => {
    const result = await sendNewsletter({
      campaignId: 1,
      subject: "測試電子報",
      htmlContent: "<html><body>Test</body></html>",
      subscribers: ["test@example.com"],
    });
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
  });

  it("should handle empty subscriber list", async () => {
    const result = await sendNewsletter({
      campaignId: 1,
      subject: "測試電子報",
      htmlContent: "<html><body>Test</body></html>",
      subscribers: [],
    });
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
  });
});
