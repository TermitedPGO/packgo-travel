/**
 * PageHeader — every page's title row.
 *
 * Layout: serif H1 on left, secondary actions on right, optional caption below.
 * Height: ~48px. No background, no border-bottom (the topbar already separates).
 *
 * The serif font (Noto Serif TC) is intentionally used ONLY here — per project
 * brand rules, the rest of the UI is Inter.
 */
export function PageHeader({
  title,
  caption,
  actions,
}: {
  title: string;
  caption?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 pb-3 mb-3 border-b border-gray-100">
      <div className="min-w-0">
        <h1
          className="text-xl font-semibold text-gray-900 leading-tight tracking-tight"
          style={{ fontFamily: "'Noto Serif TC', serif" }}
        >
          {title}
        </h1>
        {caption && (
          <div className="text-xs text-gray-500 mt-0.5">{caption}</div>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
      )}
    </div>
  );
}
