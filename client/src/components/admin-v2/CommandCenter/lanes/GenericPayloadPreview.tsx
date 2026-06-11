/**
 * Shared fallback preview for all lanes — summary + formatted JSON payload.
 * Each per-lane file degrades to this when its payload fails to parse.
 */

/** Generic fallback: summary + formatted JSON payload. */
export function GenericPayloadPreview({
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
