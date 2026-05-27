import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { translate, translateArray } from '@/i18n';
import { trpc } from '@/lib/trpc';

export type Language = 'zh-TW' | 'en';

// 支援的幣值（v78q: 加入 JPY + KRW，搭配新語言）
export type Currency = 'TWD' | 'USD' | 'JPY' | 'KRW';

// 語言顯示名稱（用該語言的母語表示）
export const languageNames: Record<Language, string> = {
  'zh-TW': '繁體中文',
  'en': 'English',
};

// 幣值顯示名稱和符號
export const currencyInfo: Record<Currency, { name: string; symbol: string }> = {
  'TWD': { name: '新台幣', symbol: 'NT$' },
  'USD': { name: '美金', symbol: '$' },
  'JPY': { name: '日圓', symbol: '¥' },
  'KRW': { name: '韓圓', symbol: '₩' },
};

// 備用匯率（當 API 不可用時使用，per 1 USD）
const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  TWD: 32.5,
  JPY: 156,
  KRW: 1380,
};

interface LocaleContextType {
  // 語言相關
  language: Language;
  setLanguage: (lang: Language) => void;
  languageName: string;
  
  // 幣值相關
  currency: Currency;
  setCurrency: (curr: Currency) => void;
  currencySymbol: string;
  currencyName: string;
  
  // 價格轉換函數（支援指定原始貨幣）
  convertPrice: (price: number, originalCurrency?: Currency) => number;
  formatPrice: (price: number, originalCurrency?: Currency) => string;
  
  // 匯率相關
  exchangeRate: number | null;
  isLoadingRate: boolean;
  rateDisclaimer: string;
  
  // 翻譯函數
  t: (key: string, params?: Record<string, string | number>) => string;
  // 翻譯函數（回傳陣列）
  tArray: (key: string) => string[];
}

const LocaleContext = createContext<LocaleContextType | undefined>(undefined);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // Read localStorage directly in useState initializer to avoid flash of wrong language on first render
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window !== 'undefined') {
      const savedLang = localStorage.getItem('packgo-language');
      if (savedLang && ['zh-TW', 'en'].includes(savedLang)) {
        return savedLang as Language;
      }
    }
    return 'zh-TW';
  });

  const [currency, setCurrencyState] = useState<Currency>('USD');

  // 在客戶端初始化時從 localStorage 讀取貨幣設定
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('packgo-currency');
      if (saved && ['TWD', 'USD', 'JPY', 'KRW'].includes(saved)) {
        setCurrencyState(saved as Currency);
      }
    }
  }, []);

  // v78o: 支援 URL 參數 ?lang=en 與 ?currency=USD（外部分享連結用）
  // 例如 packgo-travel.fly.dev/?lang=en 直接切英文，避免使用者每次都要點開選單
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const urlLang = params.get('lang');
    const urlCurrency = params.get('currency');

    if (urlLang && ['en', 'zh-TW'].includes(urlLang)) {
      setLanguageState(urlLang as Language);
      localStorage.setItem('packgo-language', urlLang);
    }
    if (urlCurrency && ['USD', 'TWD', 'JPY', 'KRW'].includes(urlCurrency)) {
      setCurrencyState(urlCurrency as Currency);
      localStorage.setItem('packgo-currency', urlCurrency);
    }
  }, []);

  // 獲取即時匯率
  const { data: ratesData, isLoading: isLoadingRate } = trpc.exchangeRate.getRates.useQuery(
    undefined,
    {
      staleTime: 60 * 60 * 1000, // 1 小時
      refetchOnWindowFocus: false,
    }
  );

  // 設定語言並儲存到 localStorage
  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    if (typeof window !== 'undefined') {
      localStorage.setItem('packgo-language', lang);
    }
  }, []);

  // 設定幣值並儲存到 localStorage
  const setCurrency = useCallback((curr: Currency) => {
    setCurrencyState(curr);
    if (typeof window !== 'undefined') {
      localStorage.setItem('packgo-currency', curr);
    }
  }, []);

  // 獲取匯率（優先使用 API 資料，否則使用備用匯率）
  // API 返回的匯率是以 USD 為基準：USD=1, TWD=32.5
  // 轉換公式：金額 / fromRate * toRate
  // 例如：3130 TWD -> USD = 3130 / 32.5 * 1 = 96.3
  // 例如：100 USD -> TWD = 100 / 1 * 32.5 = 3250
  const getRate = useCallback((fromCurrency: Currency, toCurrency: Currency): number => {
    if (fromCurrency === toCurrency) return 1;
    
    const rates = ratesData?.rates || FALLBACK_RATES;
    const fromRate = rates[fromCurrency] || FALLBACK_RATES[fromCurrency] || 1;
    const toRate = rates[toCurrency] || FALLBACK_RATES[toCurrency] || 1;
    
    // 返回轉換率：toRate / fromRate
    // 例如 TWD->USD: 1/32.5 = 0.0307
    // 例如 USD->TWD: 32.5/1 = 32.5
    return toRate / fromRate;
  }, [ratesData]);

  // 價格轉換（支援指定原始貨幣）
  const convertPrice = useCallback((price: number, originalCurrency: Currency = 'TWD'): number => {
    if (originalCurrency === currency) return price;
    
    const rate = getRate(originalCurrency, currency);
    
    // 根據目標貨幣決定是否取整
    if (currency === 'TWD') {
      return Math.round(price * rate);
    } else {
      // USD 等貨幣保留小數點後兩位
      return Math.round(price * rate * 100) / 100;
    }
  }, [currency, getRate]);

  // 格式化價格顯示
  const formatPrice = useCallback((price: number, originalCurrency: Currency = 'TWD'): string => {
    const converted = convertPrice(price, originalCurrency);
    const symbol = currencyInfo[currency].symbol;
    
    if (currency === 'TWD') {
      return `${symbol}${converted.toLocaleString()}`;
    } else {
      return `${symbol}${converted.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
  }, [currency, convertPrice]);

  // 計算當前顯示的匯率（TWD to USD 或 USD to TWD）
  const exchangeRate = useMemo(() => {
    if (!ratesData?.rates) return null;
    return getRate('TWD', 'USD');
  }, [ratesData, getRate]);

  // 翻譯函數
  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    return translate(key, language, params);
  }, [language]);

  // 翻譯函數（回傳陣列）
  const tArray = useCallback((key: string): string[] => {
    return translateArray(key, language);
  }, [language]);

  const value = useMemo<LocaleContextType>(() => ({
    language,
    setLanguage,
    languageName: languageNames[language],
    currency,
    setCurrency,
    currencySymbol: currencyInfo[currency].symbol,
    currencyName: currencyInfo[currency].name,
    convertPrice,
    formatPrice,
    exchangeRate,
    isLoadingRate,
    rateDisclaimer: ratesData?.disclaimer || t('currency.rateDisclaimer'),
    t,
    tArray,
  }), [language, setLanguage, currency, setCurrency, convertPrice, formatPrice, exchangeRate, isLoadingRate, ratesData, t, tArray]);

  return (
    <LocaleContext.Provider value={value}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (context === undefined) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return context;
}
