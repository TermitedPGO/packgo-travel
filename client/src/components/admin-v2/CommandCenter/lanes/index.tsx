/**
 * Lane payload previews + editors — the seam P1-P4 fill in.
 *
 * Each lane (cs / quote / marketing / finance) renders its task payload
 * differently: a cs reply shows the draft body (and lets the admin edit it
 * before sending), a quote shows line items, etc. The spine (v1) shipped ONE
 * generic read-only preview; P1 adds the cs lane:
 *
 *   - LanePayloadPreview — read-only view, used for lanes WITHOUT an editor
 *     (quote / marketing / finance stay generic + unchanged).
 *   - LanePayloadEditor  — OPTIONAL per-lane editor. Returns an editable
 *     component (cs draft textarea) or `null` when the lane has no editor.
 *     ApprovalInbox uses the editor when non-null (editable → sends
 *     editedPayload) and falls back to the read-only preview otherwise. This
 *     keeps the inbox lane-agnostic.
 *
 * Kept deliberately tiny — this is a seam, not a feature.
 */
import { useLocale } from "@/contexts/LocaleContext";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { ApprovalLane } from "../types";

/** Generic fallback: summary + formatted JSON payload. */
function GenericPayloadPreview({
  summary,
  payload,
}: {
  summary?: string | null;
  payload: string;
}) {
  let pretty = payload;
  try {
    pretty = JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    // payload isn't JSON — show it raw.
  }
  return (
    <div className="space-y-3">
      {summary && (
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{summary}</p>
      )}
      <pre className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-xs text-gray-700 overflow-x-auto whitespace-pre-wrap break-words">
        {pretty}
      </pre>
    </div>
  );
}

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
function CsReplyEditor({
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

// ── Quote lane (P2) ─────────────────────────────────────────────────────────

/** Parsed shape the quote producer writes (quoteProducer.ts). */
export interface QuoteDraftPayload {
  tourId: number;
  departureId?: number;
  tourTitle: string;
  customerName?: string;
  customerEmail?: string;
  customerChannel?: string;
  /** Supplier retail price (直客價). Absent on custom trips. */
  supplierPrice?: number;
  /** AI estimate — undefined in v1. */
  aiEstimate?: number;
  /** The price Jeff decides to quote — edited here, seeded from supplierPrice. */
  finalPrice?: number;
  currency?: string;
  notes?: string;
  isCustomTrip?: boolean;
}

/** Safe-parse a quote payload; returns null if the shape is wrong. */
export function parseQuotePayload(payload: string): QuoteDraftPayload | null {
  try {
    const obj = JSON.parse(payload);
    if (obj && typeof obj.tourTitle === "string")
      return obj as QuoteDraftPayload;
  } catch {
    // fall through
  }
  return null;
}

/** Map a customer channel to its i18n key (unknown channels show raw). */
const QUOTE_CHANNEL_I18N: Record<string, string> = {
  ai_assistant: "admin.commandCenter.quoteChannelAiAssistant",
  gmail: "admin.commandCenter.quoteChannelGmail",
  wechat: "admin.commandCenter.quoteChannelWechat",
  line: "admin.commandCenter.quoteChannelLine",
};

/** Percentage gap between AI estimate and supplier price; null if not comparable. */
function quotePriceDiffPct(supplier?: number, ai?: number): number | null {
  if (
    supplier === undefined ||
    ai === undefined ||
    !Number.isFinite(supplier) ||
    supplier === 0
  ) {
    return null;
  }
  return Math.round((Math.abs(ai - supplier) / supplier) * 100);
}

/** Format a price with its currency, or an em dash when absent. */
function fmtQuotePrice(value: number | undefined, currency: string): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return `${currency} ${value.toLocaleString()}`;
}

/**
 * Read-only quote view: tour + customer context and the supplier price vs AI
 * estimate comparison (a colored badge flags a gap > 10%). Custom trips show a
 * "需手動報價" hint instead of prices. Reused as the read-only header of
 * QuoteEditor so the two never drift.
 */
export function QuotePayloadPreview({ payload }: { payload: string }) {
  const { t } = useLocale();
  const parsed = parseQuotePayload(payload);
  if (!parsed) {
    return <GenericPayloadPreview summary={null} payload={payload} />;
  }

  const currency = parsed.currency?.trim() || "USD";
  const who =
    parsed.customerName?.trim() || parsed.customerEmail?.trim() || "—";
  const channelKey = parsed.customerChannel
    ? QUOTE_CHANNEL_I18N[parsed.customerChannel]
    : undefined;
  const channelLabel = channelKey ? t(channelKey) : parsed.customerChannel;
  const diffPct = quotePriceDiffPct(parsed.supplierPrice, parsed.aiEstimate);
  const diffHigh = diffPct !== null && diffPct > 10;

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
      {/* Tour + customer */}
      <div className="space-y-1">
        <div className="flex items-baseline gap-2">
          <span className="w-16 flex-shrink-0 text-xs text-gray-400">
            {t("admin.commandCenter.quoteTour")}
          </span>
          <span className="text-sm font-medium text-gray-900">
            {parsed.tourTitle}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="w-16 flex-shrink-0 text-xs text-gray-400">
            {t("admin.commandCenter.quoteCustomer")}
          </span>
          <span className="text-sm text-gray-700">{who}</span>
          {channelLabel && (
            <span className="rounded-md bg-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600">
              {channelLabel}
            </span>
          )}
        </div>
      </div>

      {parsed.isCustomTrip ? (
        // 客製遊：沒有供應商價，提示手動報價。
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-700">
            <span className="font-medium">
              {t("admin.commandCenter.quoteCustomTrip")}
            </span>
            {" · "}
            {t("admin.commandCenter.quoteCustomTripHint")}
          </p>
        </div>
      ) : (
        // 供應商團：供應商直客價 vs AI 估價並排。
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="text-[11px] text-gray-400">
              {t("admin.commandCenter.quoteSupplierPrice")}
            </div>
            <div className="text-sm font-medium tabular-nums text-gray-900">
              {fmtQuotePrice(parsed.supplierPrice, currency)}
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="text-[11px] text-gray-400">
              {t("admin.commandCenter.quoteAiEstimate")}
            </div>
            <div className="text-sm font-medium tabular-nums text-gray-900">
              {parsed.aiEstimate !== undefined
                ? fmtQuotePrice(parsed.aiEstimate, currency)
                : t("admin.commandCenter.quoteAiEstimateNone")}
            </div>
            {diffPct !== null && (
              <div
                className={`mt-1 inline-block rounded-md px-1.5 py-0.5 text-[11px] ${
                  diffHigh
                    ? "bg-rose-100 text-rose-700"
                    : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {t("admin.commandCenter.quoteDiffHigh", {
                  pct: String(diffPct),
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Quote editor — read-only context (QuotePayloadPreview) plus the two fields
 * Jeff can change before approving: the final quote price (seeded from the
 * supplier price) and an internal note. Edits flow up via onChange as a fresh
 * payload JSON string (the inbox sends it as editedPayload).
 */
function QuoteEditor({
  payload,
  onChange,
}: {
  payload: string;
  onChange: (nextPayload: string) => void;
}) {
  const { t } = useLocale();
  const parsed = parseQuotePayload(payload);

  // Payload not in the expected quote shape — degrade to the generic preview.
  if (!parsed) {
    return <GenericPayloadPreview summary={null} payload={payload} />;
  }

  const currency = parsed.currency?.trim() || "USD";
  // Seed the final price from any prior edit, else the supplier reference price.
  const finalPriceValue = parsed.finalPrice ?? parsed.supplierPrice;

  function handleFinalPriceChange(raw: string) {
    const trimmed = raw.trim();
    const next = trimmed === "" ? undefined : Number(trimmed);
    onChange(
      JSON.stringify({
        ...parsed,
        finalPrice:
          next !== undefined && Number.isFinite(next) ? next : undefined,
      }),
    );
  }

  function handleNotesChange(raw: string) {
    onChange(JSON.stringify({ ...parsed, notes: raw }));
  }

  return (
    <div className="space-y-3">
      <QuotePayloadPreview payload={payload} />

      {/* Editable: final quote price */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600">
          {t("admin.commandCenter.quoteFinalPrice")}
          <span className="ml-1 text-gray-400">({currency})</span>
        </label>
        <Input
          type="number"
          inputMode="decimal"
          value={finalPriceValue ?? ""}
          onChange={(e) => handleFinalPriceChange(e.target.value)}
          className="h-9 rounded-lg text-sm tabular-nums"
          placeholder={
            parsed.supplierPrice !== undefined
              ? String(parsed.supplierPrice)
              : undefined
          }
        />
      </div>

      {/* Editable: internal note */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600">
          {t("admin.commandCenter.quoteNotes")}
        </label>
        <Textarea
          value={parsed.notes ?? ""}
          onChange={(e) => handleNotesChange(e.target.value)}
          rows={3}
          className="rounded-lg text-sm leading-relaxed resize-y"
          placeholder={t("admin.commandCenter.quoteNotesPlaceholder")}
        />
      </div>

      <p className="text-[11px] text-gray-400">
        {t("admin.commandCenter.quoteFinalPriceHint")}
      </p>
    </div>
  );
}

/**
 * Whether a lane provides an editable payload editor. Lanes that return true
 * get an editing UI (and the inbox sends editedPayload); the rest are
 * read-only. Pure — safe to call during render to decide the approve path.
 */
export function laneHasEditor(lane: ApprovalLane): boolean {
  return lane === "cs" || lane === "quote";
}

/**
 * Render the read-only preview for a task's lane. The generic fallback
 * pretty-prints the payload JSON; P2-P4 add richer per-lane read previews.
 */
export function LanePayloadPreview({
  lane,
  summary,
  payload,
}: {
  lane: ApprovalLane;
  summary?: string | null;
  payload: string;
}) {
  switch (lane) {
    case "quote":
      return <QuotePayloadPreview payload={payload} />;
    // P3-P4: add lane-specific read previews here.
    default:
      return <GenericPayloadPreview summary={summary} payload={payload} />;
  }
}

/**
 * Lane payload body — the single component the inbox renders. Lanes WITH an
 * editor (cs) render the editable view; the rest fall back to the read-only
 * preview. Rendered unconditionally as a component so the editor's internal
 * hooks obey rules-of-hooks (the lane switch is stable per open task).
 */
export function LanePayloadBody({
  lane,
  summary,
  payload,
  onChange,
}: {
  lane: ApprovalLane;
  summary?: string | null;
  payload: string;
  onChange: (nextPayload: string) => void;
}) {
  switch (lane) {
    case "cs":
      return <CsReplyEditor payload={payload} onChange={onChange} />;
    case "quote":
      return <QuoteEditor payload={payload} onChange={onChange} />;
    // P3-P4: add editors (marketing post body, finance entry, …) here.
    default:
      return <LanePayloadPreview lane={lane} summary={summary} payload={payload} />;
  }
}
