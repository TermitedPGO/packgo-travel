/**
 * Lane payload previews — the seam P1-P4 fill in.
 *
 * Each lane (cs / quote / marketing / finance) renders its task payload
 * differently: a cs reply shows the draft body, a quote shows line items,
 * etc. The spine (v1) ships ONE generic preview that pretty-prints the
 * payload JSON; lanes swap in a richer preview by extending the switch in
 * `LanePayloadPreview` when their phase lands.
 *
 * Kept deliberately tiny — this is a seam, not a feature.
 */
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

/**
 * Render the right preview for a task's lane. v1 routes every lane to the
 * generic preview; P1-P4 add `case "cs":` etc. returning their own component.
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
    // P1-P4: add lane-specific previews here.
    default:
      return <GenericPayloadPreview summary={summary} payload={payload} />;
  }
}
