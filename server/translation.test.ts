import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { translateText, translateBatch, translateObject, clearTranslationCache, getTranslationCacheStats, getSupportedLanguages } from './translation';

// Mock Redis to prevent cross-test cache contamination via Redis
// (clearTranslationCache only clears in-memory cache, not Redis)
vi.mock('./redis', () => {
  const store = new Map<string, string>();
  return {
    default: {
      ping: vi.fn().mockResolvedValue('PONG'),
      get: vi.fn().mockImplementation((key: string) => Promise.resolve(store.get(key) ?? null)),
      setex: vi.fn().mockImplementation((key: string, _ttl: number, value: string) => {
        store.set(key, value);
        return Promise.resolve('OK');
      }),
      del: vi.fn().mockImplementation((key: string) => {
        store.delete(key);
        return Promise.resolve(1);
      }),
      on: vi.fn(),
    },
    redis: {
      ping: vi.fn().mockResolvedValue('PONG'),
      get: vi.fn().mockImplementation((key: string) => Promise.resolve(store.get(key) ?? null)),
      setex: vi.fn().mockImplementation((key: string, _ttl: number, value: string) => {
        store.set(key, value);
        return Promise.resolve('OK');
      }),
      del: vi.fn().mockImplementation((key: string) => {
        store.delete(key);
        return Promise.resolve(1);
      }),
      on: vi.fn(),
    },
    __store: store,
  };
});

// Mock the LLM module
vi.mock('./_core/llm', () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{
      message: {
        content: 'Translated text'
      }
    }]
  })
}));

describe('Translation Agent', () => {
  beforeEach(async () => {
    // Clear both in-memory cache and the mocked Redis store
    clearTranslationCache();
    // Also clear the mocked Redis store
    const redisMock = await import('./redis');
    (redisMock as any).__store?.clear();
    // Reset mock call counts
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('translateText', () => {
    it('should return original text when source and target language are the same', async () => {
      const text = '你好世界';
      const result = await translateText(text, 'zh-TW', 'zh-TW');
      expect(result).toBe(text);
    });

    it('should return empty string for empty input', async () => {
      const result = await translateText('', 'en', 'zh-TW');
      expect(result).toBe('');
    });

    it('should return whitespace-only string as is', async () => {
      const result = await translateText('   ', 'en', 'zh-TW');
      expect(result).toBe('   ');
    });

    it('should translate text using LLM', async () => {
      const result = await translateText('你好', 'en', 'zh-TW');
      expect(result).toBe('Translated text');
    });

    it('should use cache for repeated translations', async () => {
      const { invokeLLM } = await import('./_core/llm');
      
      // First call - should invoke LLM
      await translateText('你好', 'en', 'zh-TW');
      expect(invokeLLM).toHaveBeenCalledTimes(1);
      
      // Second call with same parameters should use cache (memory or Redis mock)
      await translateText('你好', 'en', 'zh-TW');
      expect(invokeLLM).toHaveBeenCalledTimes(1); // Still 1, cache hit
    });
  });

  describe('translateBatch', () => {
    it('should return empty array for empty input', async () => {
      const result = await translateBatch([], 'en', 'zh-TW');
      expect(result).toEqual([]);
    });

    it('should translate multiple texts', async () => {
      const texts = ['你好', '世界'];
      const result = await translateBatch(texts, 'en', 'zh-TW');
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('Translated text');
      expect(result[1]).toBe('Translated text');
    });
  });

  describe('translateObject', () => {
    it('should translate specified fields in an object', async () => {
      const obj = {
        title: '日本旅遊',
        description: '精彩的日本之旅',
        price: 50000,
      };
      
      const result = await translateObject(obj, ['title', 'description'], 'en', 'zh-TW');
      
      expect(result.title).toBe('Translated text');
      expect(result.description).toBe('Translated text');
      expect(result.price).toBe(50000);
    });

    it('should not modify fields not in the list', async () => {
      const obj = {
        title: '日本旅遊',
        notes: '注意事項',
      };
      
      const result = await translateObject(obj, ['title'], 'en', 'zh-TW');
      
      expect(result.title).toBe('Translated text');
      expect(result.notes).toBe('注意事項');
    });
  });

  describe('clearTranslationCache', () => {
    it('should clear all cached translations', async () => {
      await translateText('你好', 'en', 'zh-TW');
      
      let stats = getTranslationCacheStats();
      expect(stats.size).toBeGreaterThan(0);
      
      clearTranslationCache();
      
      stats = getTranslationCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe('getSupportedLanguages', () => {
    it('should return list of supported languages', () => {
      const languages = getSupportedLanguages();
      
      expect(languages).toBeInstanceOf(Array);
      expect(languages.length).toBeGreaterThan(0);
      
      const zhTW = languages.find(l => l.code === 'zh-TW');
      expect(zhTW).toBeDefined();
      expect(zhTW?.name).toBe('Traditional Chinese (Taiwan)');
      expect(zhTW?.nativeName).toBe('繁體中文');
      
      const en = languages.find(l => l.code === 'en');
      expect(en).toBeDefined();
      expect(en?.name).toBe('English');
      expect(en?.nativeName).toBe('English');
    });

    it('should support exactly zh-TW and en (product scope)', () => {
      // `type Language = 'zh-TW' | 'en'` — Japanese/Korean are intentionally
      // out of scope (PACK&GO ships 繁中 + English only). This guards against
      // accidental additions or removals to the supported set.
      const codes = getSupportedLanguages().map(l => l.code).sort();
      expect(codes).toEqual(['en', 'zh-TW']);
    });
  });
});
