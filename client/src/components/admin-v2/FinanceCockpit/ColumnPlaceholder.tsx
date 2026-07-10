/**
 * ColumnPlaceholder —— 塊A 骨架期的欄內占位卡(對齊 B-final .empty 風格)。
 * 塊B/C 落地後各自移除,換成真的卡。圓角外框 + 置中圖示 + 標題 + 副說明。
 */
import { Hammer } from "lucide-react";

export function ColumnPlaceholder({
  title,
  desc,
}: {
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="px-4 py-7 text-center">
        <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-50">
          <Hammer className="h-[18px] w-[18px] text-gray-400" />
        </div>
        <div className="text-sm font-semibold text-gray-800">{title}</div>
        <div className="mt-1 text-xs text-gray-400">{desc}</div>
      </div>
    </div>
  );
}
