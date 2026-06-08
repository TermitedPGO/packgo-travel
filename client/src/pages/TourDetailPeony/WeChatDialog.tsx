/**
 * TourDetailPeony / WeChatDialog.tsx
 *
 * Shows the existing WeChat QR so a customer can add PACK&GO and chat directly,
 * a form-free path alongside the inquiry form (feature: tour-page-redesign).
 * Uses the existing public asset (no new upload).
 */

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocale } from "@/contexts/LocaleContext";
import { type getThemeColorByDestination } from "./helpers";

export type WeChatDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
};

export default function WeChatDialog({ open, onOpenChange, themeColor }: WeChatDialogProps) {
  const { t } = useLocale();
  const w = (s: string) => `tourDetail.action.wechat.${s}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs rounded-xl">
        <DialogHeader>
          <DialogTitle
            className="text-center font-serif text-lg font-bold"
            style={{ color: themeColor.primary }}
          >
            {t(w("title"))}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          <img
            src="/images/qrcode-wechat.png"
            alt={t(w("qrAlt"))}
            className="h-56 w-56 rounded-xl border border-gray-200 object-contain"
            loading="lazy"
            decoding="async"
          />
          <p className="text-center text-sm text-gray-600">{t(w("scanHint"))}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
