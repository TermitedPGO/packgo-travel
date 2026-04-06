import { useState } from "react";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { enUS } from "date-fns/locale/en-US";
import { DayPicker, DateRange } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useLocale } from "@/contexts/LocaleContext";

interface DateRangePickerProps {
  value?: DateRange;
  onChange?: (range: DateRange | undefined) => void;
  placeholder?: string;
  className?: string;
}

export function DateRangePicker({
  value,
  onChange,
  placeholder = "選擇日期",
  className,
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { language } = useLocale();
  const dateLocale = language === 'zh-TW' ? zhTW : enUS;

  const handleSelect = (range: DateRange | undefined) => {
    onChange?.(range);
    // Auto close when both dates are selected
    if (range?.from && range?.to) {
      setIsOpen(false);
    }
  };

  const formatDateRange = () => {
    if (!value?.from) return placeholder;
    if (!value?.to) return format(value.from, "yyyy/MM/dd", { locale: dateLocale });
    return `${format(value.from, "yyyy/MM/dd", { locale: dateLocale })} ~ ${format(value.to, "yyyy/MM/dd", { locale: dateLocale })}`;
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full h-12 px-4 justify-start text-left font-normal border border-gray-300 bg-white hover:border-gray-400 transition-all",
            !value && "text-gray-500",
            className
          )}
        >
          <Calendar className="mr-2 h-5 w-5 text-gray-600" />
          <span>{formatDateRange()}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 shadow-2xl border-2 border-gray-200" align="start">
        <div className="p-4">
          <DayPicker
            mode="range"
            selected={value}
            onSelect={handleSelect}
            numberOfMonths={2}
            locale={dateLocale}
            disabled={{ before: new Date() }}
            classNames={{
              months: "flex gap-4",
              month: "space-y-4",
              caption: "flex justify-center pt-1 relative items-center",
              caption_label: "text-base font-semibold text-black",
              nav: "space-x-1 flex items-center",
              nav_button: cn(
                "h-8 w-8 bg-transparent p-0 opacity-50 hover:opacity-100 rounded-lg hover:bg-gray-100 transition-all"
              ),
              nav_button_previous: "absolute left-1",
              nav_button_next: "absolute right-1",
              table: "w-full border-collapse space-y-1",
              head_row: "flex",
              head_cell: "text-gray-600 rounded-lg w-10 font-medium text-sm",
              row: "flex w-full mt-2",
              cell: cn(
                "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-gray-100 [&:has([aria-selected].day-range-end)]:rounded-r-lg [&:has([aria-selected].day-range-start)]:rounded-l-lg first:[&:has([aria-selected])]:rounded-l-lg last:[&:has([aria-selected])]:rounded-r-lg"
              ),
              day: cn(
                "h-10 w-10 p-0 font-normal aria-selected:opacity-100 rounded-lg hover:bg-gray-100 transition-all"
              ),
              day_range_start: "day-range-start bg-black text-white hover:bg-black hover:text-white",
              day_range_end: "day-range-end bg-black text-white hover:bg-black hover:text-white",
              day_selected:
                "bg-black text-white hover:bg-black hover:text-white focus:bg-black focus:text-white",
              day_today: "bg-gray-100 text-black font-semibold",
              day_outside: "text-gray-400 opacity-50",
              day_disabled: "text-gray-300 opacity-50",
              day_range_middle:
                "aria-selected:bg-gray-100 aria-selected:text-black",
              day_hidden: "invisible",
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
