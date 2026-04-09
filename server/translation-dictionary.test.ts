import { describe, expect, it } from "vitest";
import {
  PROPER_NOUN_DICTIONARY,
  applyProperNounDictionary,
  applyDictionaryToJson,
  buildProperNounSystemPrompt,
} from "./translation-dictionary";

describe("PROPER_NOUN_DICTIONARY", () => {
  it("contains core train brand entries", () => {
    expect(PROPER_NOUN_DICTIONARY["鳴日號"]).toBe("The Future (NARU)");
    expect(PROPER_NOUN_DICTIONARY["鳴日廚房"]).toBe("The Moving Kitchen");
    expect(PROPER_NOUN_DICTIONARY["鳴日"]).toBe("The Future");
  });

  it("contains core hotel entries", () => {
    expect(PROPER_NOUN_DICTIONARY["君品collection"]).toBe("Palais de Chine Collection");
    expect(PROPER_NOUN_DICTIONARY["瑞穗天合國際觀光酒店"]).toBe("Grand Cosmos Resort Ruisui");
  });

  it("contains Taiwan place names", () => {
    expect(PROPER_NOUN_DICTIONARY["台灣"]).toBe("Taiwan");
    expect(PROPER_NOUN_DICTIONARY["花蓮"]).toBe("Hualien");
    expect(PROPER_NOUN_DICTIONARY["日月潭"]).toBe("Sun Moon Lake");
  });
});

describe("applyProperNounDictionary", () => {
  it("replaces 鳴日號 with The Future (NARU)", () => {
    const result = applyProperNounDictionary("搭乘鳴日號前往花蓮");
    expect(result).toContain("The Future (NARU)");
    expect(result).not.toContain("鳴日號");
  });

  it("replaces 鳴日廚房 before 鳴日 (longest match first)", () => {
    const result = applyProperNounDictionary("鳴日廚房的美食");
    expect(result).toContain("The Moving Kitchen");
    expect(result).not.toContain("鳴日廚房");
    // Should NOT replace 鳴日廚房 with 'The Future廚房'
    expect(result).not.toContain("The Future廚房");
  });

  it("replaces multiple occurrences", () => {
    const result = applyProperNounDictionary("鳴日號 and 鳴日號");
    expect(result).toBe("The Future (NARU) and The Future (NARU)");
  });

  it("handles empty string", () => {
    expect(applyProperNounDictionary("")).toBe("");
  });

  it("handles non-string input gracefully", () => {
    // @ts-expect-error testing runtime safety
    expect(applyProperNounDictionary(null)).toBe(null);
    // @ts-expect-error testing runtime safety
    expect(applyProperNounDictionary(undefined)).toBe(undefined);
  });

  it("does not alter text with no matching terms", () => {
    const text = "Hello world, this is a test.";
    expect(applyProperNounDictionary(text)).toBe(text);
  });

  it("replaces 君品collection correctly", () => {
    const result = applyProperNounDictionary("入住君品collection");
    expect(result).toContain("Palais de Chine Collection");
  });
});

describe("applyDictionaryToJson", () => {
  it("translates string values in a plain object", () => {
    const input = { name: "鳴日號", location: "花蓮" };
    const result = applyDictionaryToJson(input) as Record<string, string>;
    expect(result.name).toBe("The Future (NARU)");
    expect(result.location).toBe("Hualien");
  });

  it("translates nested objects recursively", () => {
    const input = { hotel: { name: "君品酒店" } };
    const result = applyDictionaryToJson(input) as { hotel: { name: string } };
    expect(result.hotel.name).toBe("Palais de Chine Hotel");
  });

  it("translates string values in arrays", () => {
    const input = ["鳴日號", "花蓮", "unchanged"];
    const result = applyDictionaryToJson(input) as string[];
    expect(result[0]).toBe("The Future (NARU)");
    expect(result[1]).toBe("Hualien");
    expect(result[2]).toBe("unchanged");
  });

  it("passes through numbers and booleans unchanged", () => {
    const input = { price: 50000, available: true };
    const result = applyDictionaryToJson(input) as { price: number; available: boolean };
    expect(result.price).toBe(50000);
    expect(result.available).toBe(true);
  });

  it("handles null gracefully", () => {
    expect(applyDictionaryToJson(null)).toBeNull();
  });
});

describe("buildProperNounSystemPrompt", () => {
  it("returns a non-empty string", () => {
    const prompt = buildProperNounSystemPrompt();
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(100);
  });

  it("contains the IMPORTANT header", () => {
    const prompt = buildProperNounSystemPrompt();
    expect(prompt).toContain("IMPORTANT");
    expect(prompt).toContain("Proper Noun Dictionary");
  });

  it("includes key entries from the dictionary", () => {
    const prompt = buildProperNounSystemPrompt();
    expect(prompt).toContain("鳴日號");
    expect(prompt).toContain("The Future (NARU)");
    expect(prompt).toContain("君品collection");
    expect(prompt).toContain("Palais de Chine Collection");
  });
});
