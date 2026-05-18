/**
 * KPIStrip — single-row stat tile bar. Max ~6 tiles.
 *
 * Density: each tile is ~80px tall, separator-only divider, no card backgrounds.
 * Looks like Linear's metric strip.
 */
import type { StatusTone } from "./StatusDot";

export type KPI = {
  label: string;
  value: string | number;
  hint?: string;
  tone?: StatusTone;
  delta?: { value: string; direction: "up" | "down" | "flat" };
};

export function KPIStrip({ items }: { items: KPI[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y sm:divide-y-0 divide-gray-100">
      {items.map((k, i) => (
        <div key={i} className="p-3 min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 truncate">
            {k.label}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <div
              className={`text-xl font-bold tabular-nums leading-none ${
                k.tone === "danger"
                  ? "text-rose-700"
                  : k.tone === "warn"
                  ? "text-amber-700"
                  : k.tone === "success"
                  ? "text-emerald-700"
                  : "text-gray-900"
              }`}
            >
              {k.value}
            </div>
            {k.delta && (
              <div
                className={`text-[10px] font-semibold tabular-nums ${
                  k.delta.direction === "up"
                    ? "text-emerald-600"
                    : k.delta.direction === "down"
                    ? "text-rose-600"
                    : "text-gray-400"
                }`}
              >
                {k.delta.direction === "up" ? "↑" : k.delta.direction === "down" ? "↓" : "→"}{" "}
                {k.delta.value}
              </div>
            )}
          </div>
          {k.hint && (
            <div className="mt-0.5 text-[10px] text-gray-400 truncate">
              {k.hint}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
