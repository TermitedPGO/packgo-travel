/**
 * CustomerVisaSection — batch 6 m4: visa applications in CustomerInbox.
 * Renders active visa cards with a 6-step stepper, document count,
 * passport security bar, and admin notes.
 */
import { useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { Badge, BadgeK, Vault, Kv } from "./ws-ui";

const STEPS = [
  "submitted",
  "paid",
  "documents_received",
  "processing",
  "approved",
  "completed",
] as const;

type VisaItem = {
  id: number;
  visaType: string;
  applicationStatus: string;
  firstName: string;
  lastName: string;
  trackingNumber: string | null;
  adminNotes: string | null;
  uploadedDocuments: string | null;
  createdAt: Date | string;
};

export default function CustomerVisaSection({
  visas,
  onRequestDocs,
}: {
  visas: VisaItem[];
  onRequestDocs?: () => void;
}) {
  const { t } = useLocale();

  if (!visas.length) return null;

  return (
    <section className="mt-4">
      <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
        {t("workspace.visaSection")}
      </h3>
      <div className="space-y-3">
        {visas.map((v) => (
          <VisaCard
            key={v.id}
            visa={v}
            onRequestDocs={onRequestDocs}
          />
        ))}
      </div>
    </section>
  );
}

function VisaCard({
  visa,
  onRequestDocs,
}: {
  visa: VisaItem;
  onRequestDocs?: () => void;
}) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);

  const docCount = parseDocCount(visa.uploadedDocuments);
  const statusKey = `workspace.visaSt${capitalize(camelCase(visa.applicationStatus))}`;

  return (
    <div className="rounded-xl border border-gray-200 text-xs">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-3 flex items-center justify-between"
      >
        <div>
          <span className="font-medium">
            {visa.lastName} {visa.firstName}
          </span>
          <span className="text-gray-500 ml-2">
            {visa.visaType.replace(/_/g, " ")}
          </span>
        </div>
        <Badge>{t(statusKey)}</Badge>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-gray-100 pt-3">
          {/* Stepper */}
          <div>
            <div className="text-[10px] font-medium text-gray-500 mb-1.5">
              {t("workspace.visaStepper")}
            </div>
            <Stepper current={visa.applicationStatus} />
          </div>

          {/* Passport security bar */}
          <Vault>{t("workspace.visaPassportBar")}</Vault>

          {/* Document count */}
          <Kv
            k={t("workspace.visaDocs").replace("{n}", "")}
            v={
              docCount > 0
                ? t("workspace.visaDocs").replace("{n}", String(docCount))
                : t("workspace.visaDocsNone")
            }
          />

          {/* Tracking number */}
          {visa.trackingNumber && (
            <Kv k={t("workspace.visaTracking")} v={visa.trackingNumber} />
          )}

          {/* Admin notes */}
          {visa.adminNotes && (
            <div>
              <div className="text-[10px] font-medium text-gray-500 mb-0.5">
                {t("workspace.visaNotes")}
              </div>
              <div className="text-gray-700 whitespace-pre-wrap">
                {visa.adminNotes}
              </div>
            </div>
          )}

          {/* Request docs button */}
          {onRequestDocs && (
            <button
              type="button"
              onClick={onRequestDocs}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium"
            >
              {t("workspace.visaRequestDocs")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- 6-step stepper ---------- */

function Stepper({ current }: { current: string }) {
  const { t } = useLocale();
  const currentIdx = STEPS.indexOf(current as (typeof STEPS)[number]);

  return (
    <div className="flex items-center gap-0.5">
      {STEPS.map((step, i) => {
        const done = currentIdx >= i;
        const active = currentIdx === i;
        const key = `workspace.visaSt${capitalize(camelCase(step))}`;
        return (
          <div key={step} className="flex-1 min-w-0">
            <div
              className={`h-1.5 rounded-full ${
                done ? "bg-black" : "bg-gray-200"
              }`}
            />
            <div
              className={`text-[9px] mt-0.5 truncate ${
                active ? "font-bold" : "text-gray-400"
              }`}
            >
              {t(key)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- helpers ---------- */

function parseDocCount(docs: string | null): number {
  if (!docs) return 0;
  try {
    const arr = JSON.parse(docs);
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function camelCase(s: string) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
