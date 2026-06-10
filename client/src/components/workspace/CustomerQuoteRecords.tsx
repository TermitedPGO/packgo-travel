/**
 * CustomerQuoteRecords — 報價記錄 read-only section of the per-customer
 * inbox (批2 m2; extracted from CustomerInbox in the m4 file split, §9.6).
 * aiQuotes funnel facts (quoteNumber · total · status · 開 PDF), bounded 5
 * server-side. tool-quote PDFs are NOT here (no persistence — gap recorded
 * in tasks/batch-2-customers.md).
 */
import { useLocale } from "@/contexts/LocaleContext";
import { formatRelTime } from "./relTime";
import { WorkspaceCard } from "./ws-ui";

export type QuoteRecord = {
  id: number;
  quoteNumber: string;
  estimatedTotal: number | null;
  currency: string;
  pdfUrl: string | null;
  status: string;
  createdAt: Date | string;
};

export default function CustomerQuoteRecords({
  quotes,
}: {
  quotes: QuoteRecord[];
}) {
  const { t } = useLocale();
  if (quotes.length === 0) return null;
  return (
    <>
      <div className="text-[11px] font-semibold text-gray-400 mb-2 mt-5">
        {t("workspace.quoteRecords")} ({quotes.length})
      </div>
      <div className="space-y-2.5">
        {quotes.map((q) => (
          <WorkspaceCard
            key={`aiq:${q.id}`}
            type={t("workspace.laneQuote")}
            time={formatRelTime(q.createdAt, t)}
            state="none"
          >
            <div className="font-medium">{q.quoteNumber}</div>
            <div className="text-gray-500 mt-0.5 text-[12px]">
              {q.estimatedTotal != null
                ? `${q.currency} ${Number(q.estimatedTotal).toLocaleString()} · `
                : ""}
              {q.status}
            </div>
            {q.pdfUrl && (
              <div className="mt-2">
                <a
                  href={q.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 rounded-lg border border-gray-300 text-gray-700 text-[11px] font-medium inline-block"
                >
                  {t("workspace.quoteOpenPdf")}
                </a>
              </div>
            )}
          </WorkspaceCard>
        ))}
      </div>
    </>
  );
}
