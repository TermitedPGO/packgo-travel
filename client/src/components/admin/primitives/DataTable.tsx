/**
 * DataTable — dense table primitive. Row height 36px (target density).
 *
 * Features:
 *   - Sticky header
 *   - Sortable columns (click to toggle asc/desc)
 *   - Row click → selected callback
 *   - Hover highlights
 *   - Skeleton rows during loading
 *
 * Anti-features (don't add):
 *   - Pagination controls inside (caller handles)
 *   - Column reordering (overkill for our use)
 *   - Frozen columns (use DetailDrawer instead for wide data)
 */
import { useState } from "react";

export type Column<T> = {
  key: string;
  header: string;
  /** Optional custom header cell (e.g. a select-all checkbox). Falls back to `header`. */
  headerRender?: () => React.ReactNode;
  render: (row: T) => React.ReactNode;
  width?: string; // e.g. "w-32"
  align?: "left" | "right" | "center";
  sortable?: boolean;
  sortValue?: (row: T) => string | number | null | undefined;
};

export function DataTable<T extends { id: number | string }>({
  data,
  columns,
  loading = false,
  emptyText = "暫無資料",
  onRowClick,
  selectedId,
  rowHeight = "h-9",
}: {
  data: T[];
  columns: Column<T>[];
  loading?: boolean;
  emptyText?: string;
  onRowClick?: (row: T) => void;
  selectedId?: number | string;
  rowHeight?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);

  const sorted = (() => {
    if (!sort) return data;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return data;
    const sortFn = col.sortValue;
    return [...data].sort((a, b) => {
      const va = sortFn(a);
      const vb = sortFn(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (va < vb) return sort.dir === "asc" ? -1 : 1;
      if (va > vb) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
  })();

  const toggleSort = (key: string) => {
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: "asc" };
      if (s.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="animate-pulse">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className={`${rowHeight} border-b border-gray-100 last:border-0 bg-gray-50/40`}
            />
          ))}
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50/60 border-b border-gray-200">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`px-3 py-2 font-semibold text-gray-500 uppercase tracking-wider text-[10px] ${
                    c.align === "right"
                      ? "text-right"
                      : c.align === "center"
                      ? "text-center"
                      : "text-left"
                  } ${c.width ?? ""} ${
                    c.sortable
                      ? "cursor-pointer hover:text-gray-900 select-none"
                      : ""
                  }`}
                  onClick={() => c.sortable && toggleSort(c.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.headerRender ? c.headerRender() : c.header}
                    {sort?.key === c.key && (
                      <span className="text-gray-400">
                        {sort.dir === "asc" ? "↑" : "↓"}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map((row) => (
              <tr
                key={row.id}
                onClick={() => onRowClick?.(row)}
                className={`${rowHeight} transition-colors ${
                  onRowClick ? "cursor-pointer" : ""
                } ${
                  selectedId === row.id
                    ? "bg-teal-50/60"
                    : "hover:bg-gray-50/60"
                }`}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 ${
                      c.align === "right"
                        ? "text-right"
                        : c.align === "center"
                        ? "text-center"
                        : "text-left"
                    } ${c.width ?? ""}`}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
