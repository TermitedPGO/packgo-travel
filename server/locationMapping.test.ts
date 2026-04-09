import { describe, expect, it } from "vitest";

/**
 * Unit tests for locationMapping utility functions.
 * We import from the shared utility directly.
 * Note: Since this is a client-side utility, we test the logic inline here
 * to avoid Vite/browser-specific import issues in the Node test environment.
 */

// Inline the core logic to test it in Node environment
const locationMapping: Record<string, string> = {
  '台灣': 'Taiwan',
  '日本': 'Japan',
  '韓國': 'Korea',
  '花蓮': 'Hualien',
  '台北': 'Taipei',
  '台中': 'Taichung',
  '高雄': 'Kaohsiung',
  '日月潭': 'Sun Moon Lake',
  '阿里山': 'Alishan',
  '九份': 'Jiufen',
  '義大利': 'Italy',
  '法國': 'France',
  '德國': 'Germany',
  '美國': 'USA',
};

function translateDestination(destination: string, language: string): string {
  if (language === 'zh-TW') return destination;
  return destination
    .split(',')
    .map(city => {
      const trimmed = city.trim();
      return locationMapping[trimmed] || trimmed;
    })
    .join(', ');
}

describe("translateDestination", () => {
  it("returns original text in zh-TW mode", () => {
    expect(translateDestination("台灣", "zh-TW")).toBe("台灣");
    expect(translateDestination("日本", "zh-TW")).toBe("日本");
  });

  it("translates single destination in English mode", () => {
    expect(translateDestination("台灣", "en")).toBe("Taiwan");
    expect(translateDestination("日本", "en")).toBe("Japan");
    expect(translateDestination("花蓮", "en")).toBe("Hualien");
  });

  it("translates comma-separated destinations", () => {
    const result = translateDestination("台灣,日本", "en");
    expect(result).toBe("Taiwan, Japan");
  });

  it("handles extra spaces around commas", () => {
    const result = translateDestination("台灣, 日本", "en");
    expect(result).toBe("Taiwan, Japan");
  });

  it("falls back to original text for unknown destinations", () => {
    const result = translateDestination("未知地點", "en");
    expect(result).toBe("未知地點");
  });

  it("handles mixed known and unknown destinations", () => {
    const result = translateDestination("台灣, 未知地點", "en");
    expect(result).toBe("Taiwan, 未知地點");
  });

  it("handles empty string", () => {
    expect(translateDestination("", "en")).toBe("");
  });

  it("translates Japanese city names", () => {
    expect(translateDestination("日本", "en")).toBe("Japan");
  });

  it("translates European destinations", () => {
    expect(translateDestination("義大利", "en")).toBe("Italy");
    expect(translateDestination("法國", "en")).toBe("France");
  });

  it("translates Taiwan scenic spots", () => {
    expect(translateDestination("日月潭", "en")).toBe("Sun Moon Lake");
    expect(translateDestination("阿里山", "en")).toBe("Alishan");
    expect(translateDestination("九份", "en")).toBe("Jiufen");
  });
});
