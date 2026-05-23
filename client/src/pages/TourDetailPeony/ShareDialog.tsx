/**
 * TourDetailPeony / ShareDialog.tsx
 *
 * Social-share dialog for PACK&GO. Supports the Mandarin-speaking
 * market's three primary share surfaces in addition to Western
 * channels:
 *   - Facebook / LINE / X / WhatsApp / Email — URL share intents
 *   - WeChat                — QR sub-view (WeChat has no URL intent;
 *                             render QR + Scan → 掃一掃 instruction)
 *   - 小紅書 (Xiaohongshu)  — copy-template sub-view (RED has no URL
 *                             intent; copy a pre-formatted note with
 *                             title + URL + hashtags into the clipboard
 *                             for paste into the RED app)
 *   - Native iOS / Android share-sheet (when navigator.share is present)
 *   - Print (window.print)
 *
 * View states (single Dialog, three views):
 *   - "main" : default — list of channels + copy-link bar
 *   - "wechat" : QR code for the tour URL, instructions
 *   - "xiaohongshu" : copy-template card + copy button + instructions
 *
 * Extracted from TourDetailPeony.tsx (v2 Wave 2 Module 2.8).
 * 2026-05-22 — added WeChat / 小紅書 / QR sub-view + i18n cleanup.
 */

import React, { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import type { getThemeColorByDestination } from "./helpers";

export type ShareDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayTitle: string;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
};

type ViewMode = "main" | "wechat" | "xiaohongshu";

/**
 * Pure-URL QR code via the QR Server free API. Avoids pulling the
 * `qrcode` runtime (which lacks bundled @types) for what is just an
 * <img src=...>. The endpoint is HTTPS, cached at the edge, and
 * accepts size + data params only — no PII risk.
 */
function qrCodeImageUrl(data: string, size = 220): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(data)}`;
}

export default function ShareDialog({
  open,
  onOpenChange,
  displayTitle,
  themeColor,
}: ShareDialogProps) {
  const { t } = useLocale();
  const [view, setView] = useState<ViewMode>("main");

  // Reset sub-view when the dialog re-opens.
  React.useEffect(() => {
    if (open) setView("main");
  }, [open]);

  // Mobile Phase 4 (2026-05-22) — tag shared URLs with ?ref=jeff so
  // PostHog can attribute conversions back to admin shares vs organic.
  // If the URL already has query params, append; else add.
  const pageUrl = (() => {
    if (typeof window === "undefined") return "";
    const raw = window.location.href;
    if (raw.includes("ref=")) return raw;
    return raw.includes("?") ? `${raw}&ref=jeff` : `${raw}?ref=jeff`;
  })();

  const shareText = useMemo(
    () => t("tourDetail.lineShareText").replace("{title}", displayTitle),
    [displayTitle, t],
  );

  const xiaohongshuPost = useMemo(() => {
    const template = t("tourDetail.xiaohongshuCopyTemplate");
    return template
      .replace("{title}", displayTitle)
      .replace("{url}", pageUrl);
  }, [displayTitle, pageUrl, t]);

  const copyToClipboard = async (text: string, successKey: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t(successKey));
    } catch {
      toast.error(t("tourDetail.copyFailed"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            {view !== "main" && (
              <button
                type="button"
                onClick={() => setView("main")}
                aria-label={t("tourDetail.backToShare")}
                className="rounded-lg p-1 hover:bg-gray-100"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            {view === "main" && t("tourDetail.shareThisTour")}
            {view === "wechat" && t("tourDetail.wechatQrTitle")}
            {view === "xiaohongshu" && t("tourDetail.xiaohongshuShareTitle")}
          </DialogTitle>
        </DialogHeader>

        {/* ===== MAIN VIEW ===== */}
        {view === "main" && (
          <div className="space-y-4 py-4">
            <p className="text-gray-600 text-sm">
              {t("tourDetail.shareRecommend").replace(
                "{title}",
                displayTitle,
              )}
            </p>

            {/* Native iOS/Android share sheet (when supported) */}
            {typeof navigator !== "undefined" &&
              typeof (navigator as any).share === "function" && (
                <Button
                  onClick={async () => {
                    try {
                      await (navigator as any).share({
                        title: displayTitle,
                        text: shareText,
                        url: pageUrl,
                      });
                    } catch {
                      // user cancelled
                    }
                  }}
                  className="w-full h-10 rounded-lg"
                  style={{ backgroundColor: themeColor.primary }}
                >
                  <svg
                    className="w-4 h-4 mr-2"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                    />
                  </svg>
                  {t("tourDetail.shareNative")}
                </Button>
              )}

            {/* Copy link row */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={pageUrl}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 h-10"
              />
              <Button
                onClick={() =>
                  copyToClipboard(pageUrl, "tourDetail.linkCopied")
                }
                className="shrink-0 h-10 rounded-lg"
                style={{ backgroundColor: themeColor.primary }}
              >
                {t("tourDetail.copyLink")}
              </Button>
            </div>

            {/* Mandarin-market channels — WeChat + 小紅書 sub-views */}
            <div className="grid grid-cols-4 gap-3 pt-2">
              {/* WeChat (sub-view: QR code) */}
              <button
                onClick={() => setView("wechat")}
                className="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="w-10 h-10 bg-[#07C160] rounded-lg flex items-center justify-center">
                  <svg
                    className="w-5 h-5 text-white"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M8.667 11.333c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25c.69 0 1.25.56 1.25 1.25s-.56 1.25-1.25 1.25zm6.667 0c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25c.69 0 1.25.56 1.25 1.25s-.56 1.25-1.25 1.25zM9.5 3C4.806 3 1 6.246 1 10.25c0 2.308 1.265 4.36 3.234 5.687a.39.39 0 01.158.413l-.41 1.534a.388.388 0 00.561.43l2.014-1.158a.61.61 0 01.476-.062c.927.265 1.926.406 2.967.406.21 0 .416-.006.62-.018a4.4 4.4 0 01-.18-1.232c0-2.81 2.732-5.087 6.103-5.087.122 0 .243.003.363.009C16.435 7.962 13.317 3 9.5 3zm12.5 12c0-2.348-2.477-4.25-5.533-4.25S11.434 12.652 11.434 15c0 2.348 2.476 4.25 5.533 4.25.66 0 1.296-.088 1.886-.252a.51.51 0 01.39.05l1.69.97a.323.323 0 00.467-.36l-.34-1.275a.323.323 0 01.13-.343C22.948 17.155 24 15.654 22 15zm-7.667-1.5c-.553 0-1-.448-1-1s.447-1 1-1 1 .448 1 1-.447 1-1 1zm4 0c-.552 0-1-.448-1-1s.448-1 1-1c.553 0 1 .448 1 1s-.447 1-1 1z" />
                  </svg>
                </div>
                <span className="text-xs text-gray-600">
                  {t("tourDetail.wechat")}
                </span>
              </button>

              {/* 小紅書 — Mobile Phase 4 (2026-05-22): try xhsdiscover:// deeplink
                  first (opens native app if installed); on mobile that's much
                  smoother than copy-then-paste. Always copy caption to clipboard
                  as the fallback path. */}
              <button
                onClick={() => {
                  // Copy caption first so even if deeplink succeeds, the user has it ready.
                  void copyToClipboard(xiaohongshuPost, "tourDetail.xiaohongshuCopied");
                  // Try native deeplink — silently fails on desktop (no handler), opens app on mobile.
                  if (typeof window !== "undefined" && /Mobi|Android|iPhone/i.test(navigator.userAgent)) {
                    window.location.href = "xhsdiscover://";
                  } else {
                    setView("xiaohongshu");
                  }
                }}
                className="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="w-10 h-10 bg-[#FF2E4D] rounded-lg flex items-center justify-center text-white font-bold text-base leading-none">
                  小
                </div>
                <span className="text-xs text-gray-600">
                  {t("tourDetail.xiaohongshu")}
                </span>
              </button>

              {/* LINE */}
              <button
                onClick={() => {
                  const url = encodeURIComponent(pageUrl);
                  const text = encodeURIComponent(shareText);
                  window.open(
                    `https://social-plugins.line.me/lineit/share?url=${url}&text=${text}`,
                    "_blank",
                    "width=600,height=400",
                  );
                }}
                className="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="w-10 h-10 bg-[#00B900] rounded-lg flex items-center justify-center">
                  <svg
                    className="w-5 h-5 text-white"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                  </svg>
                </div>
                <span className="text-xs text-gray-600">LINE</span>
              </button>

              {/* Facebook */}
              <button
                onClick={() => {
                  const url = encodeURIComponent(pageUrl);
                  window.open(
                    `https://www.facebook.com/sharer/sharer.php?u=${url}`,
                    "_blank",
                    "width=600,height=400",
                  );
                }}
                className="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="w-10 h-10 bg-[#1877F2] rounded-lg flex items-center justify-center">
                  <svg
                    className="w-5 h-5 text-white"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                  </svg>
                </div>
                <span className="text-xs text-gray-600">Facebook</span>
              </button>

              {/* WhatsApp */}
              <button
                onClick={() => {
                  const url = encodeURIComponent(pageUrl);
                  const text = encodeURIComponent(shareText + " ");
                  window.open(
                    `https://wa.me/?text=${text}${url}`,
                    "_blank",
                    "width=600,height=400",
                  );
                }}
                className="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="w-10 h-10 bg-[#25D366] rounded-lg flex items-center justify-center">
                  <svg
                    className="w-5 h-5 text-white"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                  </svg>
                </div>
                <span className="text-xs text-gray-600">WhatsApp</span>
              </button>

              {/* X / Twitter */}
              <button
                onClick={() => {
                  const url = encodeURIComponent(pageUrl);
                  const text = encodeURIComponent(shareText);
                  window.open(
                    `https://twitter.com/intent/tweet?url=${url}&text=${text}`,
                    "_blank",
                    "width=600,height=400",
                  );
                }}
                className="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="w-10 h-10 bg-black rounded-lg flex items-center justify-center">
                  <svg
                    className="w-4 h-4 text-white"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                </div>
                <span className="text-xs text-gray-600">X</span>
              </button>
            </div>

            {/* Email + Print row */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100 mt-2">
              <button
                onClick={() => {
                  const subject = encodeURIComponent(displayTitle);
                  const body = encodeURIComponent(
                    shareText + "\n\n" + pageUrl,
                  );
                  window.location.href = `mailto:?subject=${subject}&body=${body}`;
                }}
                className="flex items-center justify-center gap-2 h-10 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-sm text-gray-700"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
                Email
              </button>
              <button
                onClick={() => window.print()}
                className="flex items-center justify-center gap-2 h-10 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-sm text-gray-700"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                  />
                </svg>
                {t("tourDetail.print")}
              </button>
            </div>
          </div>
        )}

        {/* ===== WECHAT QR SUB-VIEW ===== */}
        {view === "wechat" && (
          <div className="space-y-4 py-4">
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-xl border border-gray-200 bg-white p-3">
                <img
                  src={qrCodeImageUrl(pageUrl, 220)}
                  alt="WeChat QR"
                  className="w-[220px] h-[220px] rounded-lg"
                />
              </div>
              <p className="text-sm text-gray-700 text-center leading-relaxed">
                {t("tourDetail.wechatQrInstruction")}
              </p>
              <Button
                onClick={() =>
                  copyToClipboard(pageUrl, "tourDetail.linkCopied")
                }
                variant="outline"
                className="w-full h-10 rounded-lg"
              >
                {t("tourDetail.copyLink")}
              </Button>
            </div>
          </div>
        )}

        {/* ===== XIAOHONGSHU COPY SUB-VIEW ===== */}
        {view === "xiaohongshu" && (
          <div className="space-y-4 py-4">
            <p className="text-sm text-gray-700">
              {t("tourDetail.xiaohongshuInstruction")}
            </p>
            <textarea
              readOnly
              value={xiaohongshuPost}
              rows={8}
              className="w-full rounded-lg border border-gray-300 bg-gray-50 p-3 text-sm font-mono leading-relaxed"
            />
            <Button
              onClick={() =>
                copyToClipboard(xiaohongshuPost, "tourDetail.postCopied")
              }
              className="w-full h-10 rounded-lg"
              style={{ backgroundColor: themeColor.primary }}
            >
              {t("tourDetail.copyPost")}
            </Button>
            <div className="rounded-lg bg-[#FFF5F6] border border-[#FFDDE2] p-3 text-xs text-[#A00026] leading-relaxed">
              {t("tourDetail.xiaohongshuTip")}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
