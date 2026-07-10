/**
 * ColumnHeader —— 左右欄的小標頭(對齊 B-final .colhead)。
 * h2 14px gray-900 粗體 + 計數 11px gray-500。塊B/C 共用。
 */
export function ColumnHeader({
  title,
  count,
}: {
  title: string;
  count?: string;
}) {
  return (
    <div className="flex items-baseline gap-2 mx-0.5 mb-2">
      <h2 className="text-sm font-bold text-gray-900">{title}</h2>
      {count && <span className="text-[11px] text-gray-500">{count}</span>}
    </div>
  );
}
