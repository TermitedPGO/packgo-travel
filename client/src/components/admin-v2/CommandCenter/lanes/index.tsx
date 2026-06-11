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
 * Kept deliberately tiny — this is a seam, not a feature. Per-lane
 * implementations live in csLane / quoteLane / marketingLane / financeLane;
 * this index holds only the lane dispatchers + the public re-exports.
 */
import type { ApprovalLane } from "../types";
import { GenericPayloadPreview } from "./GenericPayloadPreview";
import { CsReplyEditor } from "./csLane";
import { QuoteEditor, QuotePayloadPreview } from "./quoteLane";
import { MarketingEditor, MarketingPayloadPreview } from "./marketingLane";
import { FinanceAlertPreview } from "./financeLane";

// Re-exports — the public surface external importers rely on (unchanged by
// the per-lane file split).
export { parseCsPayload } from "./csLane";
export type { CsReplyPayload } from "./csLane";
export { parseQuotePayload, QuotePayloadPreview } from "./quoteLane";
export type { QuoteDraftPayload } from "./quoteLane";
export { parseMarketingPayload } from "./marketingLane";
export type { MarketingPayload } from "./marketingLane";
export type { FinanceAlertPayload } from "./financeLane";

/**
 * Whether a lane provides an editable payload editor. Lanes that return true
 * get an editing UI (and the inbox sends editedPayload); the rest are
 * read-only. Pure — safe to call during render to decide the approve path.
 */
export function laneHasEditor(lane: ApprovalLane): boolean {
  return lane === "cs" || lane === "quote" || lane === "marketing";
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
    case "marketing":
      return <MarketingPayloadPreview payload={payload} />;
    case "finance":
      return <FinanceAlertPreview payload={payload} />;
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
    case "marketing":
      return <MarketingEditor payload={payload} onChange={onChange} />;
    case "finance":
      // Finance alerts are read-only (no editor), show the preview.
      return <FinanceAlertPreview payload={payload} />;
    default:
      return <LanePayloadPreview lane={lane} summary={summary} payload={payload} />;
  }
}
