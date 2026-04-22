import { cn } from "@/lib/utils";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * PACK&GO Loading Spinner
 * 三個方形點依序閃爍 — 符合黑白極簡方形幾何設計語言
 *
 * Sizes:
 *  - sm: 5px dots (inline use, button icons)
 *  - md: 8px dots (default, section loaders)
 *  - lg: 12px dots (full-page loaders)
 */
interface SpinnerProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  color?: "black" | "white" | "gray";
}

function Spinner({ className, size = "md", color = "black" }: SpinnerProps) {
  const { t } = useLocale();
  const dotClass = cn(
    "packgo-dot",
    size === "sm" && "packgo-dot-sm",
    size === "lg" && "packgo-dot-lg",
    color === "white" && "text-white",
    color === "gray" && "text-gray-400",
    color === "black" && "text-black"
  );

  return (
    <span
      role="status"
      aria-label={t('common.loading')}
      className={cn("inline-flex items-center gap-1.5", className)}
    >
      <span className={dotClass} />
      <span className={dotClass} />
      <span className={dotClass} />
    </span>
  );
}

/**
 * Full-page loading overlay
 */
function LoadingPage({ text }: { text?: string }) {
  const { t } = useLocale();
  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] gap-4">
      <Spinner size="lg" />
      <p className="text-sm text-gray-500 tracking-widest uppercase font-light">{text ?? t('common.loading')}</p>
    </div>
  );
}

/**
 * Inline loading row (replaces Loader2 in table/list contexts)
 */
function LoadingRow({ text }: { text?: string }) {
  const { t } = useLocale();
  return (
    <div className="flex items-center justify-center gap-3 py-8 text-gray-400">
      <Spinner size="md" color="gray" />
      <span className="text-sm">{text ?? t('common.loading')}</span>
    </div>
  );
}

export { Spinner, LoadingPage, LoadingRow };
