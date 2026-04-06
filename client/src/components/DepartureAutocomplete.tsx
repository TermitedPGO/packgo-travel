import { useState, useEffect, useRef, useCallback } from "react";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";

interface DepartureAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (departure: string) => void;
  placeholder?: string;
  className?: string;
}

export function DepartureAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "輸入出發地",
  className,
}: DepartureAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useLocale();

  // Fetch departure cities from DB — only cities with active tours
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toursRouter = (trpc as any).tours;
  const { data: departureCities = [], isLoading } = toursRouter.getDepartureCities.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

  type DepartureCity = { city: string; country: string; count: number };

  // Filter cities based on input value
  const filteredCities: DepartureCity[] = (departureCities as DepartureCity[]).filter((c: DepartureCity) =>
    !value.trim() ||
    c.city.toLowerCase().includes(value.toLowerCase()) ||
    c.country.toLowerCase().includes(value.toLowerCase())
  );

  // Calculate fixed-position dropdown coordinates to escape overflow:hidden parents
  const updateDropdownPosition = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: "fixed",
      top: rect.bottom + 2,
      left: rect.left,
      width: rect.width,
      zIndex: 99999,
    });
  }, []);

  // Recalculate position on scroll/resize while open
  useEffect(() => {
    if (!isOpen) return;
    updateDropdownPosition();
    window.addEventListener("scroll", updateDropdownPosition, true);
    window.addEventListener("resize", updateDropdownPosition);
    return () => {
      window.removeEventListener("scroll", updateDropdownPosition, true);
      window.removeEventListener("resize", updateDropdownPosition);
    };
  }, [isOpen, updateDropdownPosition]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (city: { city: string; country: string; count: number }) => {
    onChange(city.city);
    setIsOpen(false);
    onSelect?.(city.city);
  };

  const handleFocus = () => {
    updateDropdownPosition();
    setIsOpen(true);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    if (!isOpen) {
      updateDropdownPosition();
      setIsOpen(true);
    }
  };

  const showDropdown = isOpen && (filteredCities.length > 0 || isLoading);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative group">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-black transition-colors">
          <MapPin className="h-5 w-5" />
        </div>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onFocus={handleFocus}
          placeholder={placeholder}
          className="w-full h-12 pl-12 pr-4 border-2 border-black bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none transition-all rounded-lg"
        />
      </div>

      {/* Fixed-position dropdown — fully escapes overflow:hidden parents */}
      {showDropdown && (
        <div
          style={dropdownStyle}
          className="bg-white border-2 border-black max-h-72 overflow-y-auto"
        >
          {isLoading ? (
            <div className="px-4 py-3 text-sm text-gray-400">{t('common.loading') || '載入中...'}</div>
          ) : filteredCities.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-400">{t('hero.noDeparture') || '找不到符合的出發地'}</div>
          ) : (
            filteredCities.map((city, index) => (
              <button
                key={index}
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent blur before click fires
                  handleSelect(city);
                }}
                className="w-full px-4 py-3 text-left hover:bg-black hover:text-white transition-colors flex items-center justify-between gap-3 border-b border-gray-100 last:border-b-0 group/item"
              >
                <div className="flex items-center gap-3">
                  <MapPin className="h-4 w-4 text-gray-400 group-hover/item:text-white shrink-0" />
                  <span className="text-gray-900 group-hover/item:text-white font-medium">{city.city}</span>
                </div>
                <span className="text-xs text-gray-400 group-hover/item:text-gray-300">
                  {city.count} {t('hero.tourCount') || '個行程'}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
