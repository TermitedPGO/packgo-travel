/**
 * FilterChip — dismissible active filter, h-6.
 *
 * Used in the row above DataTable to show what's filtering the data.
 * Click X to remove the filter.
 */
import { X } from "lucide-react";

export function FilterChip({
  label,
  value,
  onRemove,
}: {
  label: string;
  value: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-gray-100 text-xs text-gray-700">
      <span className="text-gray-500">{label}:</span>
      <span className="font-medium">{value}</span>
      <button
        onClick={onRemove}
        className="text-gray-400 hover:text-gray-700 ml-0.5"
        aria-label={`Remove filter ${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
