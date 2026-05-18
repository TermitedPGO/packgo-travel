/**
 * ToursTabPreviewDialog — preview AI-generated tour before save.
 *
 * Round 80.10: pulled out of ToursTab.tsx. Already B&W + gold (Round 80.9).
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
import {
  Edit,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  generatedTourData: any;
  isAdmin: boolean;
  isSaving: boolean;
  onConfirmSave: () => void;
  onRegenerate: () => void;
  onEdit: () => void;
  onCancel: () => void;
}

export function ToursTabPreviewDialog({
  open,
  onOpenChange,
  generatedTourData,
  isAdmin,
  isSaving,
  onConfirmSave,
  onRegenerate,
  onEdit,
  onCancel,
}: Props) {
  const { t } = useLocale();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#c9a563]" />
            {t("toursTab.previewTitle")}
          </DialogTitle>
          <DialogDescription>{t("toursTab.previewDesc")}</DialogDescription>
        </DialogHeader>
        {generatedTourData && (
          <div className="grid gap-6 py-4">
            {generatedTourData.heroImage && (
              <div className="relative rounded-lg overflow-hidden">
                <img
                  src={generatedTourData.heroImage}
                  alt="Hero"
                  className="w-full h-48 object-cover rounded-lg"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute bottom-4 left-4 right-4 text-white">
                  <h3 className="text-xl font-bold">
                    {generatedTourData.poeticTitle || generatedTourData.title}
                  </h3>
                  <p className="text-sm opacity-90 mt-1">
                    {generatedTourData.heroSubtitle ||
                      generatedTourData.promotionText}
                  </p>
                </div>
              </div>
            )}

            <div className="bg-[#c9a563]/8 border border-[#c9a563]/20 rounded-lg p-4">
              <h3 className="font-semibold text-[#8a6f3a] mb-3">
                {t("toursTab.previewBasicInfo")}
              </h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">
                    {t("toursTab.previewTitle")}
                  </span>
                  <span className="ml-2 font-medium">
                    {generatedTourData.title}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">
                    {t("toursTab.previewCode")}
                  </span>
                  <span className="ml-2">
                    {generatedTourData.productCode || "-"}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">
                    {t("toursTab.previewPromo")}
                  </span>
                  <span className="ml-2 text-red-600">
                    {generatedTourData.promotionText || "-"}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">
                    {t("toursTab.previewDays")}
                  </span>
                  <span className="ml-2">
                    {t("toursTab.previewDaysNights")
                      .replace("{days}", String(generatedTourData.duration))
                      .replace(
                        "{nights}",
                        String(
                          generatedTourData.nights ||
                            generatedTourData.duration - 1
                        )
                      )}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">
                    {t("toursTab.previewPrice")}
                  </span>
                  <span className="ml-2 font-bold text-lg text-foreground">
                    NT$ {generatedTourData.price?.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h3 className="font-semibold text-foreground mb-3">
                {t("toursTab.previewLocation")}
              </h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">
                    {t("toursTab.previewDepartureCity")}
                  </span>
                  <span className="ml-2">
                    {generatedTourData.departureCountry} /{" "}
                    {generatedTourData.departureCity}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">
                    {t("toursTab.previewDepartureAirport")}
                  </span>
                  <span className="ml-2">
                    {generatedTourData.departureAirportCode}{" "}
                    {generatedTourData.departureAirportName}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">
                    {t("toursTab.previewDestCity")}
                  </span>
                  <span className="ml-2 font-medium">
                    {generatedTourData.destinationCountry} /{" "}
                    {generatedTourData.destinationCity}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">
                    {t("toursTab.previewDestAirport")}
                  </span>
                  <span className="ml-2">
                    {generatedTourData.destinationAirportCode}{" "}
                    {generatedTourData.destinationAirportName}
                  </span>
                </div>
              </div>
            </div>

            {generatedTourData.itineraryDetailed && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h3 className="font-semibold text-foreground mb-3">
                  {t("toursTab.previewItinerary")}
                </h3>
                <div className="space-y-2 text-sm max-h-40 overflow-y-auto">
                  {(() => {
                    try {
                      const itinerary = JSON.parse(
                        generatedTourData.itineraryDetailed
                      );
                      return itinerary
                        .slice(0, 3)
                        .map((day: any, index: number) => (
                          <div key={index} className="flex gap-2">
                            <span className="font-medium text-[#8a6f3a]">
                              Day {day.day || index + 1}:
                            </span>
                            <span className="text-gray-700">
                              {day.title ||
                                day.description?.substring(0, 50) ||
                                "-"}
                            </span>
                          </div>
                        ));
                    } catch {
                      return (
                        <p className="text-gray-500">
                          {t("toursTab.previewParseError")}
                        </p>
                      );
                    }
                  })()}
                  {(() => {
                    try {
                      const itinerary = JSON.parse(
                        generatedTourData.itineraryDetailed
                      );
                      if (itinerary.length > 3) {
                        return (
                          <p className="text-[#8a6f3a] text-xs">
                            {t("toursTab.previewMoreDays").replace(
                              "{count}",
                              String(itinerary.length - 3)
                            )}
                          </p>
                        );
                      }
                    } catch {
                      return null;
                    }
                  })()}
                </div>
              </div>
            )}

            {generatedTourData.costExplanation && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h3 className="font-semibold text-foreground mb-3">
                  {t("toursTab.previewCost")}
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {(() => {
                    try {
                      const cost = JSON.parse(
                        generatedTourData.costExplanation
                      );
                      return (
                        <>
                          <div>
                            <span className="text-gray-500">
                              {t("toursTab.previewIncludes")}
                            </span>
                            <span className="ml-2">
                              {t("toursTab.previewIncludesCount").replace(
                                "{count}",
                                String(cost.includes?.length || 0)
                              )}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500">
                              {t("toursTab.previewExcludes")}
                            </span>
                            <span className="ml-2">
                              {t("toursTab.previewExcludesCount").replace(
                                "{count}",
                                String(cost.excludes?.length || 0)
                              )}
                            </span>
                          </div>
                        </>
                      );
                    } catch {
                      return (
                        <p className="text-gray-500">
                          {t("toursTab.previewCostParseError")}
                        </p>
                      );
                    }
                  })()}
                </div>
              </div>
            )}

            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="font-semibold text-foreground mb-3">
                {t("toursTab.previewDescription")}
              </h3>
              <p className="text-sm text-gray-700 whitespace-pre-wrap line-clamp-4">
                {generatedTourData.description}
              </p>
            </div>

            {isAdmin && generatedTourData.sourceUrl && (
              <div className="text-xs text-gray-400 flex items-center gap-2">
                <ExternalLink className="h-3 w-3" />
                {t("toursTab.sourceLabel")}
                <a
                  href={generatedTourData.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground hover:text-[#c9a563] hover:underline transition-colors"
                >
                  {generatedTourData.sourceUrl}
                </a>
              </div>
            )}

            {generatedTourData.executionReport && (
              <details className="text-xs text-gray-400">
                <summary className="cursor-pointer hover:text-gray-600">
                  {t("toursTab.viewReport")}
                </summary>
                <pre className="mt-2 p-2 bg-gray-100 rounded-lg overflow-x-auto whitespace-pre-wrap">
                  {generatedTourData.executionReport}
                </pre>
              </details>
            )}
          </div>
        )}
        <DialogFooter className="flex gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            className="rounded-lg"
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="outline"
            onClick={onRegenerate}
            className="rounded-lg border-[#c9a563]/40 text-[#8a6f3a] hover:bg-[#c9a563]/10"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {t("toursTab.regenerate")}
          </Button>
          <Button
            variant="outline"
            onClick={onEdit}
            className="rounded-lg border-[#c9a563]/40 text-[#8a6f3a] hover:bg-[#c9a563]/10"
          >
            <Edit className="h-4 w-4 mr-2" />
            {t("common.edit")}
          </Button>
          <Button
            onClick={onConfirmSave}
            disabled={isSaving}
            className="bg-foreground text-white hover:bg-foreground/85 rounded-lg"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t("toursTab.saving")}
              </>
            ) : (
              t("toursTab.saveDirectly")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
