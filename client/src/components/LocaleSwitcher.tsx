import { useLocale, Language, Currency } from '@/contexts/LocaleContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Globe, ChevronDown, DollarSign } from 'lucide-react';

// 語言切換組件 - 黑白簡潔風格
export function LanguageSwitcher() {
  const { language, setLanguage, languageName, t } = useLocale();

  const languages: { code: Language; name: string }[] = [
    { code: 'zh-TW', name: t('language.zhTW') },
    { code: 'en', name: t('language.en') },
    { code: 'ja', name: '日本語' },
    { code: 'ko', name: '한국어' },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-8 px-2 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-black gap-1"
        >
          <Globe className="h-4 w-4" />
          <span>{languageName}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36 bg-white border border-gray-200 shadow-lg">
        {languages.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => setLanguage(lang.code)}
            className={`cursor-pointer ${
              language === lang.code 
                ? 'bg-black text-white' 
                : 'hover:bg-gray-100'
            }`}
          >
            {lang.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// 幣值切換組件 - 黑白簡潔風格
export function CurrencySwitcher() {
  const { currency, setCurrency, t } = useLocale();

  const currencies: { code: Currency; name: string; symbol: string }[] = [
    { code: 'TWD', name: t('currency.twd'), symbol: 'NT$' },
    { code: 'USD', name: t('currency.usd'), symbol: '$' },
    { code: 'JPY', name: 'JPY', symbol: '¥' },
    { code: 'KRW', name: 'KRW', symbol: '₩' },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-8 px-2 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-black gap-1"
        >
          <DollarSign className="h-4 w-4" />
          <span>{currency}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36 bg-white border border-gray-200 shadow-lg">
        {currencies.map((curr) => (
          <DropdownMenuItem
            key={curr.code}
            onClick={() => setCurrency(curr.code)}
            className={`cursor-pointer ${
              currency === curr.code 
                ? 'bg-black text-white' 
                : 'hover:bg-gray-100'
            }`}
          >
            <span className="font-mono mr-2 w-8">{curr.symbol}</span>
            {curr.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator className="bg-gray-200" />
        <div className="px-2 py-1.5 text-[10px] text-gray-500 leading-tight">
          {t('currency.note')}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// 組合組件 - 合併語言和幣值為單一緊湊下拉選單
export function LocaleSwitcher() {
  const { language, setLanguage, languageName, currency, setCurrency, t } = useLocale();

  // v78q: 4 languages — ja/ko fall back to en for missing keys (see i18n/index.ts)
  const languages: { code: Language; name: string }[] = [
    { code: 'zh-TW', name: '繁體中文' },
    { code: 'en', name: 'English' },
    { code: 'ja', name: '日本語' },
    { code: 'ko', name: '한국어' },
  ];

  const currencies: { code: Currency; name: string; symbol: string }[] = [
    { code: 'TWD', name: 'TWD', symbol: 'NT$' },
    { code: 'USD', name: 'USD', symbol: '$' },
    { code: 'JPY', name: 'JPY', symbol: '¥' },
    { code: 'KRW', name: 'KRW', symbol: '₩' },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-black gap-1.5"
        >
          <Globe className="h-3.5 w-3.5" />
          <span>{languageName}</span>
          <span className="text-gray-300">|</span>
          <span>{currency}</span>
          <ChevronDown className="h-3 w-3 opacity-40" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44 bg-white border border-gray-200 shadow-lg p-1">
        <div className="px-2 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{t('language.label')}</div>
        {languages.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => setLanguage(lang.code)}
            className={`cursor-pointer text-sm rounded-md ${
              language === lang.code
                ? 'bg-black text-white'
                : 'hover:bg-gray-100'
            }`}
          >
            {lang.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator className="bg-gray-100 my-1" />
        <div className="px-2 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{t('currency.label')}</div>
        {currencies.map((curr) => (
          <DropdownMenuItem
            key={curr.code}
            onClick={() => setCurrency(curr.code)}
            className={`cursor-pointer text-sm rounded-md ${
              currency === curr.code
                ? 'bg-black text-white'
                : 'hover:bg-gray-100'
            }`}
          >
            <span className="font-mono mr-2 text-xs w-6">{curr.symbol}</span>
            {curr.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default LocaleSwitcher;
