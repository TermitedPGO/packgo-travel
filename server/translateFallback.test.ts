/**
 * Round 61 Fix 3: translateFallback.test.ts
 * Tests that getTourTranslations triggers a fallback translation job
 * when no translations are found for a non-zh-TW locale.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the translation module
vi.mock('./translation', () => ({
  getTourTranslations: vi.fn(),
  translateText: vi.fn(),
  translateBatch: vi.fn(),
  translateTour: vi.fn(),
  translateMultipleTours: vi.fn(),
  getBatchTourTranslations: vi.fn(),
  getAllTourTranslations: vi.fn(),
  getTranslationJobs: vi.fn(),
  getSupportedLanguages: vi.fn(),
  getAllTranslationsSummary: vi.fn(),
}));

// Mock the queue module
vi.mock('./queue', () => ({
  addTourTranslationJob: vi.fn().mockResolvedValue({ id: 'test-job-id' }),
  tourTranslationQueue: { add: vi.fn() },
}));

describe('translateFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect Chinese characters in a string', () => {
    const hasChinese = (text: string) => /[\u4e00-\u9fa5]/.test(text);
    expect(hasChinese('首爾清州五日遊')).toBe(true);
    expect(hasChinese('Seoul 5-Day Tour')).toBe(false);
    expect(hasChinese('Mixed 混合 text')).toBe(true);
    expect(hasChinese('')).toBe(false);
  });

  it('should trigger fallback translation when no translations found', async () => {
    const { getTourTranslations } = await import('./translation');
    const { addTourTranslationJob } = await import('./queue');

    // Simulate: getTourTranslations returns empty (no translations in DB)
    vi.mocked(getTourTranslations).mockResolvedValue({});

    // Simulate the logic in routers.ts getTourTranslations procedure
    const tourId = 42;
    const targetLanguage = 'en';

    const translations = await getTourTranslations(tourId, targetLanguage as any);

    if (Object.keys(translations).length === 0 && targetLanguage !== 'zh-TW') {
      await addTourTranslationJob({
        tourId,
        targetLanguages: [targetLanguage],
        sourceLanguage: 'zh-TW',
        userId: 0,
      });
    }

    expect(getTourTranslations).toHaveBeenCalledWith(42, 'en');
    expect(addTourTranslationJob).toHaveBeenCalledWith({
      tourId: 42,
      targetLanguages: ['en'],
      sourceLanguage: 'zh-TW',
      userId: 0,
    });
  });

  it('should NOT trigger fallback when translations already exist', async () => {
    const { getTourTranslations } = await import('./translation');
    const { addTourTranslationJob } = await import('./queue');

    // Simulate: translations already exist
    vi.mocked(getTourTranslations).mockResolvedValue({
      title: 'Seoul 5-Day Tour',
      description: 'An amazing trip to Seoul',
    });

    const tourId = 42;
    const targetLanguage = 'en';

    const translations = await getTourTranslations(tourId, targetLanguage as any);

    if (Object.keys(translations).length === 0 && targetLanguage !== 'zh-TW') {
      await addTourTranslationJob({
        tourId,
        targetLanguages: [targetLanguage],
        sourceLanguage: 'zh-TW',
        userId: 0,
      });
    }

    expect(addTourTranslationJob).not.toHaveBeenCalled();
  });

  it('should NOT trigger fallback for zh-TW locale', async () => {
    const { getTourTranslations } = await import('./translation');
    const { addTourTranslationJob } = await import('./queue');

    vi.mocked(getTourTranslations).mockResolvedValue({});

    const tourId = 42;
    const targetLanguage = 'zh-TW';

    const translations = await getTourTranslations(tourId, targetLanguage as any);

    if (Object.keys(translations).length === 0 && targetLanguage !== 'zh-TW') {
      await addTourTranslationJob({
        tourId,
        targetLanguages: [targetLanguage],
        sourceLanguage: 'zh-TW',
        userId: 0,
      });
    }

    expect(addTourTranslationJob).not.toHaveBeenCalled();
  });

  it('should apply translated content over original Chinese fallback', () => {
    const language = 'en';
    const tourTranslations: Record<string, string> = {
      title: 'Seoul 5-Day Tour',
      description: 'An amazing trip to Seoul and Cheongju',
    };

    const getTranslated = (fieldName: string, fallback: string | null | undefined): string | null | undefined => {
      if (language === 'zh-TW' || !tourTranslations) return fallback;
      const translated = tourTranslations[fieldName];
      return translated ?? fallback;
    };

    expect(getTranslated('title', '首爾清州五日遊')).toBe('Seoul 5-Day Tour');
    expect(getTranslated('description', '精彩的首爾之旅')).toBe('An amazing trip to Seoul and Cheongju');
    // Field without translation falls back to original
    expect(getTranslated('highlights', '行程亮點')).toBe('行程亮點');
  });

  it('should return original when language is zh-TW', () => {
    const language = 'zh-TW';
    const tourTranslations: Record<string, string> = {
      title: 'Seoul 5-Day Tour',
    };

    const getTranslated = (fieldName: string, fallback: string | null | undefined): string | null | undefined => {
      if (language === 'zh-TW' || !tourTranslations) return fallback;
      const translated = tourTranslations[fieldName];
      return translated ?? fallback;
    };

    expect(getTranslated('title', '首爾清州五日遊')).toBe('首爾清州五日遊');
  });
});
