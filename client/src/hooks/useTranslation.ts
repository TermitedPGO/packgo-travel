import { useLocale, Language } from '@/contexts/LocaleContext';
import { trpc } from '@/lib/trpc';
import { useState, useCallback, useEffect } from 'react';

// 本地翻譯快取
const translationCache = new Map<string, string>();

/**
 * 翻譯 Hook - 使用 AI Agent 進行即時翻譯
 */
export function useTranslation() {
  const { language } = useLocale();
  const translateMutation = trpc.translation.translate.useMutation();
  const translateBatchMutation = trpc.translation.translateBatch.useMutation();

  /**
   * 翻譯單個文字
   */
  const translate = useCallback(async (
    text: string,
    targetLang?: Language
  ): Promise<string> => {
    const target = targetLang || language;

    // Translation only supports en (zh-TW is the source). ja/ko are valid
    // i18n locales elsewhere but fall back to source until a translator is wired up.
    if (target !== 'en') {
      return text;
    }

    // 檢查快取
    const cacheKey = `${target}:${text}`;
    const cached = translationCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const result = await translateMutation.mutateAsync({
        text,
        targetLanguage: target,
        sourceLanguage: 'zh-TW',
      });
      
      // 儲存到快取
      translationCache.set(cacheKey, result.translated);
      
      return result.translated;
    } catch (error) {
      console.error('[Translation] Error:', error);
      return text; // 翻譯失敗時返回原文
    }
  }, [language, translateMutation]);

  /**
   * 批量翻譯多個文字
   */
  const translateBatch = useCallback(async (
    texts: string[],
    targetLang?: Language
  ): Promise<string[]> => {
    const target = targetLang || language;

    if (target !== 'en') {
      return texts;
    }

    // 分離已快取和未快取的文字
    const results: string[] = new Array(texts.length);
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    texts.forEach((text, index) => {
      const cacheKey = `${target}:${text}`;
      const cached = translationCache.get(cacheKey);
      if (cached) {
        results[index] = cached;
      } else {
        uncachedIndices.push(index);
        uncachedTexts.push(text);
      }
    });

    // 如果所有文字都已快取，直接返回
    if (uncachedTexts.length === 0) {
      return results;
    }

    try {
      const response = await translateBatchMutation.mutateAsync({
        texts: uncachedTexts,
        targetLanguage: target,
        sourceLanguage: 'zh-TW',
      });

      // 將翻譯結果放入對應位置並快取
      response.translated.forEach((translated, i) => {
        const originalIndex = uncachedIndices[i];
        results[originalIndex] = translated;
        
        const cacheKey = `${target}:${uncachedTexts[i]}`;
        translationCache.set(cacheKey, translated);
      });

      return results;
    } catch (error) {
      console.error('[Translation Batch] Error:', error);
      // 翻譯失敗時返回原文
      uncachedIndices.forEach((index, i) => {
        results[index] = uncachedTexts[i];
      });
      return results;
    }
  }, [language, translateBatchMutation]);

  return {
    translate,
    translateBatch,
    isTranslating: translateMutation.isPending || translateBatchMutation.isPending,
    currentLanguage: language,
  };
}

/**
 * 自動翻譯文字的 Hook
 * 當語言改變時自動重新翻譯
 */
export function useAutoTranslate(originalText: string) {
  const { language } = useLocale();
  const [translatedText, setTranslatedText] = useState(originalText);
  const [isLoading, setIsLoading] = useState(false);
  const { translate } = useTranslation();

  useEffect(() => {
    if (language === 'zh-TW') {
      setTranslatedText(originalText);
      return;
    }

    const doTranslate = async () => {
      setIsLoading(true);
      try {
        const result = await translate(originalText);
        setTranslatedText(result);
      } finally {
        setIsLoading(false);
      }
    };

    doTranslate();
  }, [originalText, language, translate]);

  return { text: translatedText, isLoading };
}

export default useTranslation;
