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

/**
 * Whether a lane provides an editable payload editor. Lanes that return true
 * get an editing UI (and the inbox sends editedPayload); the rest are
 * read-only. Pure — safe to call during render to decide the approve path.
 */
export function laneHasEditor(lane: ApprovalLane): boolean {
  return lane === "cs";
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
    // P2-P4: add lane-specific read previews here.
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
    // P2-P4: add editors (quote line items, marketing post body, …) here.
    default:
      return <LanePayloadPreview lane={lane} summary={summary} payload={payload} />;
  }
}
