/**
 * cs lane (P1) — payload shape, parser, and the draft-reply editor.
 * Moved verbatim out of lanes/index.tsx (852-line split, 2026-06-11).
 */
import { useLocale } from "@/contexts/LocaleContext";
import { Textarea } from "@/components/ui/textarea";
import { GenericPayloadPreview } from "./GenericPayloadPreview";

/** Parsed shape the cs producer writes (inquiryReplyProducer.ts). */
export interface CsReplyPayload {
  inquiryId: number;
  draftBody: string;
  customerEmail?: string;
  customerName?: string;
  subject?: string;
  classification?: string;
  confidence?: number;
  language?: string;
}

/** Safe-parse a cs payload; returns null if the shape is wrong. */
export function parseCsPayload(payload: string): CsReplyPayload | null {
  try {
    const obj = JSON.parse(payload);
    if (obj && typeof obj.draftBody === "string") return obj as CsReplyPayload;
  } catch {
    // fall through
  }
  return null;
}

/**
 * cs draft editor — shows the recipient + subject (read-only context) and the
 * draft body in an editable textarea. Edits flow up via onChange as a fresh
 * payload JSON string (the inbox passes it to approve as editedPayload).
 */
export function CsReplyEditor({
  payload,
  onChange,
}: {
  payload: string;
  onChange: (nextPayload: string) => void;
}) {
  const { t } = useLocale();
  const parsed = parseCsPayload(payload);

  // Payload not in the expected cs shape — degrade to the generic preview so
  // the admin can still see/approve (no editing).
  if (!parsed) {
    return <GenericPayloadPreview summary={null} payload={payload} />;
  }

  const recipient =
    parsed.customerName?.trim() || parsed.customerEmail || `#${parsed.inquiryId}`;

  function handleBodyChange(nextBody: string) {
    onChange(JSON.stringify({ ...parsed, draftBody: nextBody }));
  }

  return (
    <div className="space-y-3">
      {/* Read-only recipient + subject context */}
      <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-400">{t("admin.commandCenter.csTo")}</span>
          <span className="text-gray-700 font-medium">{recipient}</span>
          {parsed.customerEmail && parsed.customerName && (
            <span className="text-gray-400">· {parsed.customerEmail}</span>
          )}
        </div>
        {parsed.subject && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400">
              {t("admin.commandCenter.csSubject")}
            </span>
            <span className="text-gray-700 truncate">{parsed.subject}</span>
          </div>
        )}
      </div>

      {/* Editable draft body */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600">
          {t("admin.commandCenter.csDraftBody")}
        </label>
        <Textarea
          value={parsed.draftBody}
          onChange={(e) => handleBodyChange(e.target.value)}
          rows={10}
          className="rounded-lg text-sm leading-relaxed resize-y min-h-[180px]"
          placeholder={t("admin.commandCenter.csDraftPlaceholder")}
        />
        <p className="text-[11px] text-gray-400">
          {t("admin.commandCenter.csDraftHint")}
        </p>
      </div>
    </div>
  );
}
