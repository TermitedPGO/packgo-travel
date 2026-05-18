/**
 * EmptyState — single-CTA empty placeholder.
 *
 * Concise: icon + 1-line message + 1 CTA. No big illustrations, no
 * marketing copy. Goal is to progress the user.
 */
import { Button } from "@/components/ui/button";

export function EmptyState({
  icon,
  title,
  description,
  cta,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  cta?: { label: string; onClick: () => void };
}) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40 p-8 text-center">
      {icon && <div className="mb-3 flex justify-center text-gray-400">{icon}</div>}
      <div className="text-sm font-semibold text-gray-700">{title}</div>
      {description && (
        <div className="mt-1 text-xs text-gray-500 max-w-md mx-auto">
          {description}
        </div>
      )}
      {cta && (
        <Button
          onClick={cta.onClick}
          size="sm"
          className="mt-4 rounded-lg"
        >
          {cta.label}
        </Button>
      )}
    </div>
  );
}
