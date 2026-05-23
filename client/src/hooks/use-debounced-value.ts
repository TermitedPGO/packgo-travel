import { useEffect, useState } from "react";

/**
 * Returns a debounced version of the given value. New values are buffered
 * for `delayMs` before being committed. Useful for live-search inputs.
 *
 * Mobile Phase 3 (2026-05-22).
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
