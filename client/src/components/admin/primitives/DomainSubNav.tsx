import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * DomainSubNav — horizontal sub-navigation within a domain.
 *
 * Primary items render inline (the daily-flow tabs). Advanced items go into a
 * "進階 ▾" dropdown so the sub-nav stays calm for one-person ops.
 */
export type SubNavItem = {
  id: string;
  label: string;
  badge?: number;
};

export function DomainSubNav({
  primaryItems,
  advancedItems = [],
  active,
  onSelect,
}: {
  primaryItems: SubNavItem[];
  advancedItems?: SubNavItem[];
  active: string;
  onSelect: (id: string) => void;
}) {
  const advancedActive = advancedItems.find((i) => i.id === active);
  const advancedBadgeSum = advancedItems.reduce(
    (s, i) => s + (i.badge ?? 0),
    0,
  );

  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="flex items-center gap-0 px-4 -mb-px overflow-x-auto">
        {primaryItems.map((item) => (
          <SubNavButton
            key={item.id}
            item={item}
            active={item.id === active}
            onSelect={onSelect}
          />
        ))}

        {advancedItems.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={`relative h-10 px-3 text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap focus:outline-none ${
                  advancedActive
                    ? "text-gray-900"
                    : "text-gray-500 hover:text-gray-900"
                }`}
              >
                <span>{advancedActive ? advancedActive.label : "進階"}</span>
                {!advancedActive && advancedBadgeSum > 0 && (
                  <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                    {advancedBadgeSum}
                  </span>
                )}
                <ChevronDown className="h-3 w-3" />
                {advancedActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-900" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="rounded-lg w-56">
              {advancedItems.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  onSelect={() => onSelect(item.id)}
                  className="text-xs cursor-pointer flex items-center justify-between"
                >
                  <span
                    className={item.id === active ? "font-semibold" : ""}
                  >
                    {item.label}
                  </span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                      {item.badge}
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </nav>
  );
}

function SubNavButton({
  item,
  active,
  onSelect,
}: {
  item: SubNavItem;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(item.id)}
      className={`relative h-10 px-3 text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap ${
        active ? "text-gray-900" : "text-gray-500 hover:text-gray-900"
      }`}
    >
      <span>{item.label}</span>
      {item.badge !== undefined && item.badge > 0 && (
        <span
          className={`text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded ${
            active ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"
          }`}
        >
          {item.badge}
        </span>
      )}
      {active && (
        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-900" />
      )}
    </button>
  );
}
