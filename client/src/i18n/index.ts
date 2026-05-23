import * as Sentry from '@sentry/react';
import { zhTW } from './zh-TW';
import { en } from './en';
import { ja } from './ja';
import { ko } from './ko';
import type { Language } from '@/contexts/LocaleContext';

/**
 * 2026-05-22 i18n coverage hardening:
 *
 *   - `_reportedMissing` de-duplicates missing-key reports so we don't flood
 *     Sentry. First miss per (lang, key) hits Sentry; subsequent hits skip.
 *   - `_reportedFallback` does the same for the "en silently used zh-TW" case
 *     — Jeff was seeing Chinese on the English UI because translate() falls
 *     back to zh-TW when an en key is missing. The Vitest parity test +
 *     scripts/audit-i18n.ts catch this at build time; this catches anything
 *     that slips through (e.g. dynamic keys assembled at runtime).
 */
const _reportedMissing = new Set<string>();
const _reportedFallback = new Set<string>();

function _report(level: 'missing' | 'fallback', language: Language, key: string) {
  const sigKey = `${level}|${language}|${key}`;
  const dedup = level === 'missing' ? _reportedMissing : _reportedFallback;
  if (dedup.has(sigKey)) return;
  dedup.add(sigKey);

  if (level === 'missing') {
    console.warn(`[i18n] Missing translation for key: ${key} (lang=${language})`);
  } else {
    console.warn(`[i18n] ${language} fell back to zh-TW for key: ${key}`);
  }

  // Prod telemetry — only when Sentry is initialised (no-op in dev/test).
  try {
    if (typeof window !== 'undefined') {
      Sentry.captureMessage(
        level === 'missing'
          ? `[i18n] Missing key: ${key}`
          : `[i18n] ${language} → zh-TW fallback: ${key}`,
        {
          level: 'warning',
          tags: { i18n: level, language, key },
        },
      );
    }
  } catch {
    // Sentry not initialised or already failed — silent.
  }
}

// 翻譯資源（v78q: 加入 ja + ko，先用 en 為後備）
export const translations = {
  'zh-TW': zhTW,
  'en': en,
  'ja': ja,
  'ko': ko,
} as const;

export type TranslationKeys = typeof zhTW;

// 獲取嵌套物件的值（字串）
function getNestedValue(obj: any, path: string): string | undefined {
  const keys = path.split('.');
  let current = obj;
  
  for (const key of keys) {
    if (current === undefined || current === null) {
      return undefined;
    }
    current = current[key];
  }
  
  return typeof current === 'string' ? current : undefined;
}

// 獲取嵌套物件的值（陣列）
function getNestedArrayValue(obj: any, path: string): string[] | undefined {
  const keys = path.split('.');
  let current = obj;
  
  for (const key of keys) {
    if (current === undefined || current === null) {
      return undefined;
    }
    current = current[key];
  }
  
  return Array.isArray(current) ? current as string[] : undefined;
}

// 翻譯函數（回傳字串）
export function translate(
  key: string,
  language: Language,
  params?: Record<string, string | number>
): string {
  const translation = translations[language];
  let text = getNestedValue(translation, key);

  // v78q: Fallback chain — for ja/ko fall back to en (so users see English not Chinese)
  // For en fall back to zh-TW (legacy behavior). For zh-TW just return key.
  if (text === undefined) {
    if (language === 'ja' || language === 'ko') {
      text = getNestedValue(translations['en'], key);
      if (text === undefined) text = getNestedValue(translations['zh-TW'], key);
      // 2026-05-22: ja/ko fall through to zh-TW means a Korean/Japanese visitor
      // sees Chinese — definitely a bug. Report it.
      if (text !== undefined && getNestedValue(translations['en'], key) === undefined) {
        _report('fallback', language, key);
      }
    } else if (language === 'en') {
      text = getNestedValue(translations['zh-TW'], key);
      if (text !== undefined) {
        // 2026-05-22: this is the bug Jeff saw — English UI showing Chinese.
        _report('fallback', language, key);
      }
    }
  }

  // 如果還是找不到，返回 key
  if (text === undefined) {
    _report('missing', language, key);
    return key;
  }
  
  // 替換參數
  if (params) {
    Object.entries(params).forEach(([paramKey, value]) => {
      text = text!.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(value));
    });
  }
  
  return text;
}

// 翻譯函數（回傳陣列）
export function translateArray(
  key: string,
  language: Language
): string[] {
  const translation = translations[language];
  let arr = getNestedArrayValue(translation, key);
  
  // v78q: Same fallback chain as translate() — ja/ko → en → zh-TW
  if (arr === undefined) {
    if (language === 'ja' || language === 'ko') {
      arr = getNestedArrayValue(translations['en'], key);
      if (arr === undefined) arr = getNestedArrayValue(translations['zh-TW'], key);
    } else if (language === 'en') {
      arr = getNestedArrayValue(translations['zh-TW'], key);
    }
  }

  // 如果還是找不到，返回空陣列並警告
  if (arr === undefined) {
    _report('missing', language, key);
    return [];
  }
  
  return arr;
}

export { zhTW, en, ja, ko };
