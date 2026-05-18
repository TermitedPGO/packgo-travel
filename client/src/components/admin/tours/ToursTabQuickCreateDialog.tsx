/**
 * ToursTabQuickCreateDialog — minimal "manual 新增" path.
 *
 * Round 80.10: keeps a small create-only dialog for the rare case where Jeff
 * wants to manually start a tour. After save, the row appears and the user
 * can click 編輯 to open the full TourEditDialog with all tabs.
 *
 * Brand baseline: rounded-xl dialog, rounded-lg inputs.
 */
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type QuickCreateFormData = {
  title: string;
  destination: string;
  destinationCountry: string;
  destinationCity: string;
  description: string;
  duration: number;
  price: number;
  imageUrl?: string;
  category: "group" | "custom" | "package" | "cruise" | "theme";
  status: "active" | "inactive" | "soldout";
  featured: number;
  maxParticipants?: number;
  highlights?: string;
  includes?: string;
  excludes?: string;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formData: QuickCreateFormData;
  setFormData: React.Dispatch<React.SetStateAction<QuickCreateFormData>>;
  onSubmit: () => void;
  isSaving: boolean;
}

export function ToursTabQuickCreateDialog({
  open,
  onOpenChange,
  formData,
  setFormData,
  onSubmit,
  isSaving,
}: Props) {
  const { t } = useLocale();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl">
        <DialogHeader>
          <DialogTitle>{t("toursTab.createDialogTitle")}</DialogTitle>
          <DialogDescription>{t("toursTab.createDialogDesc")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          {/* Basic Info */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-gray-200">
              <div className="h-1.5 w-1.5 rounded-full bg-foreground"></div>
              <h3 className="text-sm font-semibold text-foreground">
                {t("toursTab.formBasicInfo")}
              </h3>
            </div>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="qc-title">
                  {t("toursTab.formTourTitle")}{" "}
                  <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="qc-title"
                  value={formData.title}
                  onChange={(e) =>
                    setFormData({ ...formData, title: e.target.value })
                  }
                  placeholder={t("toursTab.formTourTitlePlaceholder")}
                  className="rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="qc-destCountry">
                    {t("toursTab.formDestCountry")}{" "}
                    <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="qc-destCountry"
                    value={formData.destinationCountry}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        destinationCountry: e.target.value,
                      })
                    }
                    placeholder={t("toursTab.formDestCountryPlaceholder")}
                    className="rounded-lg"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="qc-destCity">
                    {t("toursTab.formDestCity")}
                  </Label>
                  <Input
                    id="qc-destCity"
                    value={formData.destinationCity}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        destinationCity: e.target.value,
                      })
                    }
                    placeholder={t("toursTab.formDestCityPlaceholder")}
                    className="rounded-lg"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="qc-destDisplay">
                  {t("toursTab.formDestDisplay")}{" "}
                  <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="qc-destDisplay"
                  value={formData.destination}
                  onChange={(e) =>
                    setFormData({ ...formData, destination: e.target.value })
                  }
                  placeholder={t("toursTab.formDestDisplayPlaceholder")}
                  className="rounded-lg"
                />
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-gray-200">
              <div className="h-1.5 w-1.5 rounded-full bg-foreground"></div>
              <h3 className="text-sm font-semibold text-foreground">
                {t("toursTab.formTourDetails")}
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="qc-duration">{t("toursTab.formDays")}</Label>
                <Input
                  id="qc-duration"
                  type="number"
                  min={1}
                  value={formData.duration}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      duration: parseInt(e.target.value) || 1,
                    })
                  }
                  className="rounded-lg"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="qc-price">{t("toursTab.formPrice")}</Label>
                <Input
                  id="qc-price"
                  type="number"
                  min={0}
                  value={formData.price}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      price: parseInt(e.target.value) || 0,
                    })
                  }
                  className="rounded-lg"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="qc-description">
                {t("toursTab.formDescription")}
              </Label>
              <Textarea
                id="qc-description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder={t("toursTab.formDescriptionPlaceholder")}
                rows={3}
                className="rounded-lg"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="qc-imageUrl">
                {t("toursTab.formImageUrl")}
              </Label>
              <Input
                id="qc-imageUrl"
                value={formData.imageUrl}
                onChange={(e) =>
                  setFormData({ ...formData, imageUrl: e.target.value })
                }
                placeholder="https://..."
                className="rounded-lg"
              />
            </div>
          </div>

          {/* Category & Status */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-gray-200">
              <div className="h-1.5 w-1.5 rounded-full bg-foreground"></div>
              <h3 className="text-sm font-semibold text-foreground">
                {t("toursTab.formCategoryStatus")}
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>{t("toursTab.formCategory")}</Label>
                <Select
                  value={formData.category}
                  onValueChange={(v: any) =>
                    setFormData({ ...formData, category: v })
                  }
                >
                  <SelectTrigger className="rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="group">
                      {t("toursTab.categoryGroup")}
                    </SelectItem>
                    <SelectItem value="custom">
                      {t("toursTab.categoryCustom")}
                    </SelectItem>
                    <SelectItem value="package">
                      {t("toursTab.categoryPackage")}
                    </SelectItem>
                    <SelectItem value="cruise">
                      {t("toursTab.categoryCruise")}
                    </SelectItem>
                    <SelectItem value="theme">
                      {t("toursTab.categoryTheme")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{t("toursTab.formStatus")}</Label>
                <Select
                  value={formData.status}
                  onValueChange={(v: any) =>
                    setFormData({ ...formData, status: v })
                  }
                >
                  <SelectTrigger className="rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">
                      {t("toursTab.statusActive")}
                    </SelectItem>
                    <SelectItem value="inactive">
                      {t("toursTab.statusInactive")}
                    </SelectItem>
                    <SelectItem value="soldout">
                      {t("toursTab.statusSoldOut")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Hint that full edit is available after save */}
          <p className="text-xs text-gray-500 leading-relaxed bg-gray-50 border border-gray-200 rounded-lg p-3">
            {t("toursTab.quickCreateFullEditHint")}
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-lg"
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={onSubmit}
            disabled={isSaving}
            className="bg-foreground text-white hover:bg-foreground/85 rounded-lg"
          >
            {isSaving ? t("toursTab.creating") : t("toursTab.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
