/**
 * Marketing lane (P3) — payload shape, parser, read-only preview, and editor.
 * Moved verbatim out of lanes/index.tsx (852-line split, 2026-06-11).
 */
import { useLocale } from "@/contexts/LocaleContext";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { GenericPayloadPreview } from "./GenericPayloadPreview";

/** Parsed shape the marketing producer writes (marketingProducer.ts). */
export interface MarketingPayload {
  contentType: string;
  title: string;
  body: string;
  platform?: string;
  targetAudience?: string;
  tourId?: number;
  tourTitle?: string;
  imageUrl?: string;
  hashtags?: string[];
  sourceRouter?: string;
  supplierText?: string;
  supplierImageUrl?: string;
}

/** Safe-parse a marketing payload; returns null if shape is wrong. */
export function parseMarketingPayload(payload: string): MarketingPayload | null {
  try {
    const obj = JSON.parse(payload);
    if (obj && typeof obj.body === "string" && typeof obj.title === "string") {
      return obj as MarketingPayload;
    }
  } catch {
    // fall through
  }
  return null;
}

/** Content type to human-readable label. */
const MKT_TYPE_LABELS: Record<string, string> = {
  xhs_post: "小紅書貼文",
  wechat_article: "公眾號文章",
  edm: "EDM",
  poster_copy: "海報文案",
  social_post: "社群貼文",
  other: "行銷內容",
};

const MKT_PLATFORM_LABELS: Record<string, string> = {
  xiaohongshu: "小紅書",
  wechat: "微信",
  email: "Email",
  instagram: "Instagram",
  facebook: "Facebook",
};

/**
 * Marketing read-only preview — shown in the inbox list or when the full
 * editor is not needed. Displays platform badge + content type + title +
 * body preview (200 chars) + image thumbnail.
 */
export function MarketingPayloadPreview({ payload }: { payload: string }) {
  const { t } = useLocale();
  const parsed = parseMarketingPayload(payload);
  if (!parsed) return <GenericPayloadPreview summary={null} payload={payload} />;

  const platformLabel = parsed.platform
    ? MKT_PLATFORM_LABELS[parsed.platform] || parsed.platform
    : null;
  const typeLabel = MKT_TYPE_LABELS[parsed.contentType] || parsed.contentType;

  return (
    <div className="space-y-3">
      {/* Badges row */}
      <div className="flex items-center gap-2 flex-wrap">
        {platformLabel && (
          <span className="rounded-md bg-teal-50 border border-teal-200 px-2 py-0.5 text-xs font-medium text-teal-700">
            {platformLabel}
          </span>
        )}
        <span className="rounded-md bg-gray-100 border border-gray-200 px-2 py-0.5 text-xs text-gray-600">
          {typeLabel}
        </span>
      </div>

      {/* Title */}
      <p className="text-sm font-medium text-gray-800">{parsed.title}</p>

      {/* Body preview (first 200 chars) */}
      <p className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-4">
        {parsed.body.slice(0, 200)}
        {parsed.body.length > 200 ? "…" : ""}
      </p>

      {/* Image thumbnail */}
      {parsed.imageUrl && (
        <div className="pt-1">
          <p className="text-xs text-gray-400 mb-1">
            {t("admin.commandCenter.mktImagePreview")}
          </p>
          <img
            src={parsed.imageUrl}
            alt=""
            className="rounded-xl w-32 h-32 object-cover border border-gray-200"
          />
        </div>
      )}

      {/* Hashtags */}
      {parsed.hashtags && parsed.hashtags.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {parsed.hashtags.map((tag, i) => (
            <span
              key={i}
              className="rounded-md bg-gray-50 border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-500"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Marketing editor — lets Jeff edit title + body + hashtags before approving.
 * Read-only sections: platform, contentType, image. Editable: title, body,
 * hashtags (comma-separated input). onChange writes back the full payload JSON.
 */
export function MarketingEditor({
  payload,
  onChange,
}: {
  payload: string;
  onChange: (nextPayload: string) => void;
}) {
  const { t } = useLocale();
  const parsed = parseMarketingPayload(payload);

  if (!parsed) {
    return <GenericPayloadPreview summary={null} payload={payload} />;
  }

  const platformLabel = parsed.platform
    ? MKT_PLATFORM_LABELS[parsed.platform] || parsed.platform
    : null;
  const typeLabel = MKT_TYPE_LABELS[parsed.contentType] || parsed.contentType;

  function handleTitleChange(nextTitle: string) {
    onChange(JSON.stringify({ ...parsed, title: nextTitle }));
  }

  function handleBodyChange(nextBody: string) {
    onChange(JSON.stringify({ ...parsed, body: nextBody }));
  }

  function handleHashtagsChange(raw: string) {
    const tags = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    onChange(JSON.stringify({ ...parsed, hashtags: tags }));
  }

  return (
    <div className="space-y-3">
      {/* Supplier original comparison (collapsible, only if present) */}
      {parsed.supplierText && (
        <details className="rounded-xl border border-gray-200 bg-gray-50">
          <summary className="px-3 py-2 text-xs font-medium text-gray-500 cursor-pointer">
            {t("admin.commandCenter.mktSupplierOriginal")}
          </summary>
          <div className="px-3 pb-3 space-y-2">
            <pre className="text-xs text-gray-600 whitespace-pre-wrap">
              {parsed.supplierText}
            </pre>
            {parsed.supplierImageUrl && (
              <img
                src={parsed.supplierImageUrl}
                alt=""
                className="rounded-xl max-h-48 object-contain"
              />
            )}
          </div>
        </details>
      )}

      {/* Read-only context: platform + type */}
      <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400">
            {t("admin.commandCenter.mktPlatform")}
          </span>
          {platformLabel && (
            <span className="rounded-md bg-teal-50 border border-teal-200 px-2 py-0.5 text-xs font-medium text-teal-700">
              {platformLabel}
            </span>
          )}
          <span className="rounded-md bg-gray-100 border border-gray-200 px-2 py-0.5 text-xs text-gray-600">
            {typeLabel}
          </span>
        </div>
        {parsed.targetAudience && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400">
              {t("admin.commandCenter.mktTargetAudience")}
            </span>
            <span className="text-gray-700">{parsed.targetAudience}</span>
          </div>
        )}
        {parsed.imageUrl && (
          <div className="pt-1">
            <p className="text-xs text-gray-400 mb-1">
              {t("admin.commandCenter.mktImagePreview")}
            </p>
            <img
              src={parsed.imageUrl}
              alt=""
              className="rounded-xl w-24 h-24 object-cover border border-gray-200"
            />
          </div>
        )}
      </div>

      {/* Editable title */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600">
          {t("admin.commandCenter.mktTitle")}
        </label>
        <Input
          value={parsed.title}
          onChange={(e) => handleTitleChange(e.target.value)}
          className="rounded-lg text-sm"
        />
      </div>

      {/* Editable body */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600">
          {t("admin.commandCenter.mktBody")}
        </label>
        <Textarea
          value={parsed.body}
          onChange={(e) => handleBodyChange(e.target.value)}
          rows={12}
          className="rounded-lg text-sm leading-relaxed resize-y min-h-[200px]"
        />
        <p className="text-[11px] text-gray-400">
          {t("admin.commandCenter.mktEditHint")}
        </p>
      </div>

      {/* Editable hashtags */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-gray-600">
          {t("admin.commandCenter.mktHashtags")}
        </label>
        <Input
          value={(parsed.hashtags || []).join(", ")}
          onChange={(e) => handleHashtagsChange(e.target.value)}
          className="rounded-lg text-sm"
          placeholder={t("admin.commandCenter.mktHashtagsPlaceholder")}
        />
      </div>
    </div>
  );
}
