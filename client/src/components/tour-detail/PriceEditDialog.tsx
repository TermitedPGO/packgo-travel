/**
 * PriceEditDialog Component
 * 價格和日期編輯對話框 - 獨立於 Inline Editing
 */

import React, { useState } from "react";
import { Calendar, DollarSign, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ensureReadableOnWhite } from "@/lib/colorUtils";
import { useLocale } from "@/contexts/LocaleContext";

interface PriceEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tourId: number;
  currentPrice: number;
  currentStartDate?: Date | string | null;
  currentEndDate?: Date | string | null;
  onSave: (data: {
    price?: number;
    startDate?: string;
    endDate?: string;
  }) => Promise<void>;
  colorTheme: {
    primary: string;
    secondary: string;
    accent: string;
  };
}

export const PriceEditDialog: React.FC<PriceEditDialogProps> = ({
  open,
  onOpenChange,
  tourId,
  currentPrice,
  currentStartDate,
  currentEndDate,
  onSave,
  colorTheme,
}) => {
  const { t } = useLocale();
  const [price, setPrice] = useState(currentPrice.toString());
  const [startDate, setStartDate] = useState(
    currentStartDate ? formatDateForInput(currentStartDate) : ""
  );
  const [endDate, setEndDate] = useState(
    currentEndDate ? formatDateForInput(currentEndDate) : ""
  );
  const [isSaving, setIsSaving] = useState(false);

  function formatDateForInput(date: Date | string | null | undefined): string {
    if (!date) return "";
    const d = typeof date === "string" ? new Date(date) : date;
    if (isNaN(d.getTime())) return "";
    return d.toISOString().split("T")[0];
  }

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const data: { price?: number; startDate?: string; endDate?: string } = {};
      
      const newPrice = parseInt(price);
      if (!isNaN(newPrice) && newPrice !== currentPrice) {
        data.price = newPrice;
      }
      
      if (startDate) {
        data.startDate = new Date(startDate).toISOString();
      }
      
      if (endDate) {
        data.endDate = new Date(endDate).toISOString();
      }
      
      await onSave(data);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" style={{ color: ensureReadableOnWhite(colorTheme.accent) }} />
            {t('tourDetail.editPriceAndDateTitle')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* 價格 */}
          <div className="space-y-2">
            <Label htmlFor="price" className="text-sm font-medium">
              {t('tourDetail.priceNtdLabel')}
            </Label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                id="price"
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="pl-10"
                placeholder={t('tourDetail.enterPricePlaceholder')}
              />
            </div>
            <p className="text-xs text-gray-500">
              {t('tourDetail.currentPriceHint', { price: currentPrice.toLocaleString() })}
            </p>
          </div>

          {/* 開始日期 */}
          <div className="space-y-2">
            <Label htmlFor="startDate" className="text-sm font-medium">
              {t('tourDetail.priceStartDateLabel')}
            </Label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* 結束日期 */}
          <div className="space-y-2">
            <Label htmlFor="endDate" className="text-sm font-medium">
              {t('tourDetail.priceEndDateLabel')}
            </Label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            style={{ backgroundColor: colorTheme.accent }}
            className="text-white"
          >
            {isSaving ? t('tourDetail.savingInProgress') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
