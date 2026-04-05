import { useState, useEffect, useRef } from "react";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/contexts/LocaleContext";

interface DestinationAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (destination: string) => void;
  placeholder?: string;
  className?: string;
}

const popularDestinations = [
  { zh: "日本", en: "Japan", keywords: ["日本", "japan", "東京", "大阪", "京都", "北海道", "沖繩", "tokyo", "osaka", "kyoto", "hokkaido", "okinawa"] },
  { zh: "韓國", en: "Korea", keywords: ["韓國", "korea", "首爾", "釜山", "濟州島", "seoul", "busan", "jeju"] },
  { zh: "泰國", en: "Thailand", keywords: ["泰國", "thailand", "曼谷", "清邁", "普吉島", "bangkok", "chiang mai", "phuket"] },
  { zh: "新加坡", en: "Singapore", keywords: ["新加坡", "singapore"] },
  { zh: "馬來西亞", en: "Malaysia", keywords: ["馬來西亞", "malaysia", "吉隆坡", "檳城", "kuala lumpur", "penang"] },
  { zh: "越南", en: "Vietnam", keywords: ["越南", "vietnam", "河內", "胡志明市", "峴港", "hanoi", "ho chi minh", "da nang"] },
  { zh: "歐洲", en: "Europe", keywords: ["歐洲", "europe", "法國", "義大利", "西班牙", "英國", "德國", "france", "italy", "spain", "uk", "germany"] },
  { zh: "美國", en: "USA", keywords: ["美國", "usa", "america", "紐約", "洛杉磯", "舊金山", "new york", "los angeles", "san francisco"] },
  { zh: "澳洲", en: "Australia", keywords: ["澳洲", "australia", "雪梨", "墨爾本", "sydney", "melbourne"] },
  { zh: "紐西蘭", en: "New Zealand", keywords: ["紐西蘭", "new zealand", "奧克蘭", "基督城", "auckland", "christchurch"] },
];

export function DestinationAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "請輸入目的地、景點、關鍵字",
  className,
}: DestinationAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filteredDestinations, setFilteredDestinations] = useState<typeof popularDestinations>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const { language } = useLocale();

  const getDestName = (dest: typeof popularDestinations[0]) =>
    language === "en" ? dest.en : dest.zh;

  useEffect(() => {
    if (value.trim()) {
      const searchLower = value.toLowerCase();
      const filtered = popularDestinations.filter((dest) =>
        dest.keywords.some((keyword) => keyword.toLowerCase().includes(searchLower)) ||
        dest.en.toLowerCase().includes(searchLower) ||
        dest.zh.includes(value)
      );
      setFilteredDestinations(filtered);
      setIsOpen(filtered.length > 0);
    } else {
      setFilteredDestinations([]);
      setIsOpen(false);
    }
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (dest: typeof popularDestinations[0]) => {
    onChange(getDestName(dest));
    setIsOpen(false);
    onSelect?.(getDestName(dest));
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative group">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-black transition-colors">
          <MapPin className="h-5 w-5" />
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            if (value.trim() && filteredDestinations.length > 0) {
              setIsOpen(true);
            }
          }}
          placeholder={placeholder}
          className="w-full h-12 pl-12 pr-4 border-2 border-black bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none transition-all rounded-lg"
        />
      </div>

      {isOpen && filteredDestinations.length > 0 && (
        <div className="absolute z-[9999] w-full mt-1 bg-white border-2 border-black shadow-none max-h-60 overflow-y-auto">
          {filteredDestinations.map((dest, index) => (
            <button
              key={index}
              onClick={() => handleSelect(dest)}
              className="w-full px-4 py-3 text-left hover:bg-black hover:text-white transition-colors flex items-center gap-3 border-b border-gray-200 last:border-b-0"
            >
              <MapPin className="h-4 w-4 text-gray-400" />
              <span className="text-gray-900">{getDestName(dest)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
