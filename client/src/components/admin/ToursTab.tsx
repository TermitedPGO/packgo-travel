/**
 * ToursTab — admin 行程管理 (Round 80.10 redesign).
 *
 * Orchestrator. UI is split into subcomponents under ./tours/* :
 *   - ToursTabHeader        — title + AI/manual buttons + 4 stat tiles
 *   - ToursTabFilters       — single-row search + status pills + featured + view + sort
 *   - ToursTabRow / Card    — list/grid rendering of one tour
 *   - ToursTabBulkBar       — floating bottom bar when ≥1 selected
 *   - ToursTabQuickCreateDialog — minimal manual create
 *   - ToursTabAiGenerateDialog  — AI gen modal (PDF / URL / PDF+URL)
 *   - ToursTabPreviewDialog     — preview AI-generated tour before save
 *
 * Full-edit (itinerary / departures / cost / hotels / meals) still uses the
 * existing TourEditDialog (1829 lines, has its own internal tabs).
 *
 * Brand baseline (CLAUDE.md): rounded-xl/lg/md only. B&W + gold (#c9a563).
 */
import { useAuth } from "@/_core/hooks/useAuth";
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
import { trpc } from "@/lib/trpc";
import DeparturesManagement from "./DeparturesManagement";
import DeparturePreview from "./DeparturePreview";
import { TourEditDialog } from "./TourEditDialog";
import { ToursTabHeader } from "./tours/ToursTabHeader";
import {
  ToursTabFilters,
  type FeaturedFilter,
  type SortKey,
  type StatusFilter,
  type ViewMode,
} from "./tours/ToursTabFilters";
import { ToursTabRow } from "./tours/ToursTabRow";
import { ToursTabCard } from "./tours/ToursTabCard";
import { ToursTabBulkBar } from "./tours/ToursTabBulkBar";
import {
  ToursTabQuickCreateDialog,
  type QuickCreateFormData,
} from "./tours/ToursTabQuickCreateDialog";
// Round 80.21: ToursTabAiGenerateDialog + ToursTabBulkImportDialog merged
// into ToursTabCreateDialog (unified URL/PDF/bulk via in-dialog mode chips).
// Old files retained as fallbacks but no longer wired.
import { ToursTabCreateDialog } from "./tours/ToursTabCreateDialog";
import { ToursTabPreviewDialog } from "./tours/ToursTabPreviewDialog";
import {
  filterAndSortTours,
  computeStats,
  computeStatusCounts,
  toRowData,
} from "./tours/toursTab.helpers";
import { Loader2, Trash2 } from "lucide-react";
import { LoadingRow } from "@/components/ui/spinner";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type DialogKind =
  | "none"
  | "create"
  | "delete"
  | "batchDelete"
  | "aiGenerate"
  | "aiPreview"
  | "aiPreviewEdit"
  | "fullEdit"
  | "departures"
  | "aiDeparturePreview"
  | "bulkImport"; // v80.24: fast Lion bulk import

const EMPTY_FORM: QuickCreateFormData = {
  title: "",
  destination: "",
  destinationCountry: "",
  destinationCity: "",
  description: "",
  duration: 1,
  price: 0,
  imageUrl: "",
  category: "group",
  status: "active",
  featured: 0,
  maxParticipants: undefined,
  highlights: "",
  includes: "",
  excludes: "",
};

export default function ToursTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { t } = useLocale();

  // Single dialog kind — replaces 14 separate isXOpen booleans
  const [activeDialog, setActiveDialog] = useState<DialogKind>("none");
  const closeDialog = () => setActiveDialog("none");

  // Selection / filters / view
  const [selectedTourId, setSelectedTourId] = useState<number | null>(null);
  const [selectedTourIds, setSelectedTourIds] = useState<number[]>([]);
  const [selectedTourForEdit, setSelectedTourForEdit] = useState<any>(null);
  const [selectedTourForDepartures, setSelectedTourForDepartures] = useState<{
    id: number;
    title: string;
  } | null>(null);
  const [selectedTourForAiPreview, setSelectedTourForAiPreview] = useState<{
    id: number;
    title: string;
  } | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [featuredFilter, setFeaturedFilter] = useState<FeaturedFilter>("all");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("default");
  const [view, setView] = useState<ViewMode>("list");

  // Quick-create form
  const [formData, setFormData] = useState<QuickCreateFormData>(EMPTY_FORM);

  // AI generation state
  const [autoGenerateUrl, setAutoGenerateUrl] = useState("");
  const [forceRegenerate, setForceRegenerate] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfUploading, setPdfUploading] = useState(false);
  const [inputMode, setInputMode] = useState<"url" | "pdf" | "pdf_url">("pdf");
  const [supplementUrl, setSupplementUrl] = useState("");
  const [generatedTourData, setGeneratedTourData] = useState<any>(null);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  // 2026-05-22 fix: getAllTours has default pageSize=100 → admin Tours tab
  // was capped at first 100 rows. PACK&GO has 502 total tours (141 active +
  // 361 draft); the sidebar badge showed 141 (from admin.getStats — full
  // COUNT) but the tab list maxed at 100, causing the "141 vs 100"
  // discrepancy. Request a larger page size that fits all admin-visible
  // tours; pageSize is hard-capped server-side anyway if it grows past
  // a sane bound.
  // 2026-05-25 raised 1000 → 10000 after mass import of 4000+ supplier tours
  // capped admin display at 1000 / 3982 actual.
  const { data: tours, isLoading: toursLoading } = trpc.tours.list.useQuery({ pageSize: 10000 });

  // Round 80.20: Jeff reported sidebar badge stuck at "46" even after
  // deleting all tours, while list showed "0 筆". Cause: only
  // `tours.list` was invalidated on mutations — `admin.getStats` (the
  // sidebar badge source) kept its stale snapshot. This helper
  // invalidates BOTH so badge + list stay in lockstep.
  const invalidateTourCaches = () => {
    utils.tours.list.invalidate();
    utils.admin.getStats.invalidate();
  };

  // ── tRPC mutations (preserved from original) ──────────────────────────────
  const createTourMutation = trpc.tours.create.useMutation({
    onSuccess: () => {
      invalidateTourCaches();
      closeDialog();
      setFormData(EMPTY_FORM);
      toast.success(t("toursTab.createSuccess"));
    },
    onError: (error) => {
      toast.error(t("toursTab.createError").replace("{message}", error.message));
    },
  });

  const updateTourMutation = trpc.tours.update.useMutation({
    onSuccess: () => {
      invalidateTourCaches();
      closeDialog();
      toast.success(t("toursTab.updateSuccess"));
    },
    onError: (error) => {
      toast.error(t("toursTab.updateError").replace("{message}", error.message));
    },
  });

  const deleteTourMutation = trpc.tours.delete.useMutation({
    onSuccess: () => {
      invalidateTourCaches();
      closeDialog();
      setSelectedTourId(null);
      toast.success(t("toursTab.deleteSuccess"));
    },
    onError: (error) => {
      toast.error(t("toursTab.deleteError").replace("{message}", error.message));
    },
  });

  const batchDeleteToursMutation = trpc.tours.batchDelete.useMutation({
    onSuccess: () => {
      invalidateTourCaches();
      closeDialog();
      setSelectedTourIds([]);
      toast.success(t("toursTab.batchDeleteSuccess"));
    },
    onError: (error) => {
      toast.error(
        t("toursTab.batchDeleteError").replace("{message}", error.message)
      );
    },
  });

  const toggleStatusMutation = trpc.tours.toggleStatus.useMutation({
    onSuccess: () => {
      invalidateTourCaches();
      toast.success(t("toursTab.statusUpdateSuccess"));
    },
    onError: (error) => {
      toast.error(
        t("toursTab.statusUpdateError").replace("{message}", error.message)
      );
    },
  });

  const toggleFeaturedMutation = trpc.tours.toggleFeatured.useMutation({
    onSuccess: () => {
      invalidateTourCaches();
      toast.success(t("toursTab.featuredUpdateSuccess"));
    },
    onError: (error) => {
      toast.error(
        t("toursTab.featuredUpdateError").replace("{message}", error.message)
      );
    },
  });

  // patchField is preserved (still used elsewhere; quick-edit category is gone
  // from the row but the mutation remains available for future use)
  trpc.tours.patchField.useMutation({
    onSuccess: () => {
      invalidateTourCaches();
    },
  });

  const duplicateTourMutation = trpc.tours.duplicate.useMutation({
    onSuccess: (newTour) => {
      invalidateTourCaches();
      toast.success(`${t("toursTab.copyTour")} - ${newTour.title}`);
    },
    onError: (error) => {
      toast.error(t("toursTab.createError").replace("{message}", error.message));
    },
  });

  const submitAsyncGenerationMutation =
    trpc.tours.submitAsyncGeneration.useMutation({
      onSuccess: (result) => {
        console.log("[SubmitAsyncGeneration] Job submitted:", result.jobId);
        setCurrentTaskId(result.jobId);
        setIsGenerating(true);
        toast.success(result.message || t("toursTab.generationSubmitted"));
        // Opportunistically request push notification permission
        try {
          if (
            typeof window !== "undefined" &&
            "Notification" in window &&
            Notification.permission === "default"
          ) {
            Notification.requestPermission().catch(() => {
              /* user dismissed */
            });
          }
        } catch {
          /* notification API not available */
        }
      },
      onError: (error) => {
        setIsGenerating(false);
        setCurrentTaskId(null);
        console.error("[SubmitAsyncGeneration] Error:", error);
        setGenerationError(error.message);
      },
    });

  const { data: generationStatus } = trpc.tours.getGenerationStatus.useQuery(
    { jobId: currentTaskId || "" },
    {
      enabled: !!currentTaskId && isGenerating,
      refetchInterval: 3000,
    }
  );

  // Watch generation status
  useEffect(() => {
    if (!generationStatus) return;
    console.log("[GenerationStatus]", generationStatus);

    if (generationStatus.status === "completed") {
      setIsGenerating(false);
      setCurrentTaskId(null);
      setActiveDialog("none");
      setAutoGenerateUrl("");

      invalidateTourCaches();

      if (generationStatus.result?.success) {
        const tourId = generationStatus.result.tourId;
        const tourIdLabel = tourId
          ? t("toursTab.tourIdLabel").replace("{id}", String(tourId))
          : undefined;
        toast.success(t("toursTab.generationSuccess"), {
          description: tourIdLabel,
          duration: 5000,
          action: tourId
            ? {
                label: t("toursTab.viewTourAction") || "查看",
                onClick: () => window.open(`/tour/${tourId}`, "_blank"),
              }
            : undefined,
        });
        try {
          if (
            typeof window !== "undefined" &&
            "Notification" in window &&
            document.visibilityState !== "visible" &&
            Notification.permission === "granted"
          ) {
            const n = new Notification(t("toursTab.generationSuccess"), {
              body: tourIdLabel || "",
              icon: "/favicon.ico",
              tag: `tour-gen-${tourId || "unknown"}`,
            });
            n.onclick = () => {
              window.focus();
              if (tourId) window.open(`/tour/${tourId}`, "_blank");
              n.close();
            };
          }
        } catch {
          /* notification API not available */
        }
      }
    }

    if (generationStatus.status === "failed") {
      setIsGenerating(false);
      setCurrentTaskId(null);
      setGenerationError(
        generationStatus.failedReason || t("toursTab.unknownError")
      );
    }
  }, [generationStatus]);

  const saveFromPreviewMutation = trpc.tours.saveFromPreview.useMutation({
    onSuccess: (result) => {
      invalidateTourCaches();
      setActiveDialog("none");
      setGeneratedTourData(null);
      setAutoGenerateUrl("");
      toast.success(result.message || t("toursTab.saveTourSuccess"), {
        description: t("toursTab.tourIdLabel").replace(
          "{id}",
          String(result.tourId)
        ),
        duration: 5000,
      });
    },
    onError: (error) => {
      toast.error(t("toursTab.updateError").replace("{message}", error.message));
    },
  });

  // ── AI generation handlers ────────────────────────────────────────────────
  // Round 80.21: accept `mode` from the unified create dialog so the user's
  // tab choice (url/pdf) drives the path without an extra round trip via
  // setInputMode. Falls back to the existing inputMode state if no arg.
  const handleAutoGenerate = async (mode?: "url" | "pdf") => {
    if (mode) setInputMode(mode);
    const effectiveMode = mode ?? inputMode;
    setGenerationError(null);
    if (effectiveMode === "url") {
      if (!autoGenerateUrl.trim()) {
        toast.error(t("toursTab.enterUrl"));
        return;
      }
      try {
        const parsed = new URL(autoGenerateUrl.trim());
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch {
        toast.error(
          t("toursTab.invalidUrl") ||
            "請輸入有效的 URL（需以 http:// 或 https:// 開頭）"
        );
        return;
      }
      submitAsyncGenerationMutation.mutate({
        url: autoGenerateUrl,
        forceRegenerate,
        isPdf: false,
      });
    } else if (effectiveMode === "pdf") {
      if (!pdfFile) {
        toast.error(t("toursTab.selectPdf"));
        return;
      }
      try {
        setPdfUploading(true);
        toast.info(t("toursTab.uploadingPdf"));
        const fd = new FormData();
        fd.append("pdf", pdfFile);
        const uploadResponse = await fetch("/api/pdf/upload", {
          method: "POST",
          body: fd,
        });
        if (!uploadResponse.ok) {
          throw new Error(t("toursTab.pdfUploadFailed"));
        }
        const { url: pdfUrl } = await uploadResponse.json();
        setPdfUploading(false);
        toast.success(t("toursTab.pdfUploadSuccess"));
        submitAsyncGenerationMutation.mutate({
          url: pdfUrl,
          forceRegenerate,
          isPdf: true,
        });
      } catch (error: any) {
        setPdfUploading(false);
        console.error("[PDF Upload] Error:", error);
        toast.error(
          t("toursTab.pdfUploadError").replace("{message}", error.message)
        );
      }
    } else {
      // pdf_url
      if (!pdfFile) {
        toast.error(t("toursTab.selectPdf"));
        return;
      }
      if (!supplementUrl.trim()) {
        toast.error(t("toursTab.enterSupplementUrl"));
        return;
      }
      try {
        const parsed = new URL(supplementUrl.trim());
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch {
        toast.error(
          t("toursTab.invalidUrl") ||
            "請輸入有效的 URL（需以 http:// 或 https:// 開頭）"
        );
        return;
      }
      try {
        setPdfUploading(true);
        toast.info(t("toursTab.uploadingPdf"));
        const fd = new FormData();
        fd.append("pdf", pdfFile);
        const uploadResponse = await fetch("/api/pdf/upload", {
          method: "POST",
          body: fd,
        });
        if (!uploadResponse.ok) {
          throw new Error(t("toursTab.pdfUploadFailed"));
        }
        const { url: pdfUrl } = await uploadResponse.json();
        setPdfUploading(false);
        toast.success(t("toursTab.pdfUrlUploadSuccess"));
        submitAsyncGenerationMutation.mutate({
          url: pdfUrl,
          forceRegenerate,
          isPdf: true,
          supplementUrl: supplementUrl.trim(),
        });
      } catch (error: any) {
        setPdfUploading(false);
        console.error("[PDF+URL] Error:", error);
        toast.error(
          t("toursTab.pdfUploadError").replace("{message}", error.message)
        );
      }
    }
  };

  // ── Action handlers ───────────────────────────────────────────────────────
  const handleCreate = () => {
    if (!formData.title || !formData.destination) {
      toast.error(t("toursTab.fillRequired"));
      return;
    }
    createTourMutation.mutate(formData);
  };

  const handleEdit = (tourId: number) => {
    const tour = tours?.find((t) => t.id === tourId);
    if (!tour) return;
    setSelectedTourId(tourId);
    const tourDataForEdit = {
      title: tour.title,
      destination: tour.destination,
      destinationCountry: tour.destinationCountry || "",
      destinationCity: tour.destinationCity || "",
      description: tour.description || "",
      duration: tour.duration,
      price: tour.price,
      priceCurrency: (tour as any).priceCurrency || "TWD",
      heroImage: tour.heroImage || "",
      heroSubtitle: (tour as any).heroSubtitle || "",
      imageUrl: tour.imageUrl || "",
      category: tour.category,
      status: tour.status,
      featured: tour.featured || 0,
      maxParticipants: tour.maxParticipants || undefined,
      startDate: (tour as any).startDate || null,
      endDate: (tour as any).endDate || null,
      highlights: tour.highlights || "",
      includes: tour.includes || "",
      excludes: tour.excludes || "",
      keyFeatures: (tour as any).keyFeatures || "",
      attractions: (tour as any).attractions || "",
      itinerary: (tour as any).itinerary || [],
      itineraryDetailed: (tour as any).itineraryDetailed || "",
      hotels: tour.hotels || [],
      meals: (tour as any).meals || "",
      flights: tour.flights || null,
      images: (tour as any).images || [],
      galleryImages: (tour as any).galleryImages || "",
      costExplanation: tour.costExplanation || null,
      noticeDetailed: (tour as any).noticeDetailed || "",
      poeticContent: (tour as any).poeticContent || "",
      colorTheme: tour.colorTheme || null,
      productCode: (tour as any).productCode || "",
      promotionText: (tour as any).promotionText || "",
      departureCity: (tour as any).departureCity || "",
      departureAirportName: (tour as any).departureAirportName || "",
      notes: tour.notes || null,
      sourceUrl: tour.sourceUrl || "",
    };
    setSelectedTourForEdit(tourDataForEdit);
    setActiveDialog("fullEdit");
  };

  const handleDelete = (tourId: number) => {
    setSelectedTourId(tourId);
    setActiveDialog("delete");
  };

  const confirmDelete = () => {
    if (selectedTourId) deleteTourMutation.mutate({ id: selectedTourId });
  };

  const handleBatchDelete = () => {
    if (selectedTourIds.length === 0) {
      toast.error(t("toursTab.selectToDelete"));
      return;
    }
    setActiveDialog("batchDelete");
  };

  const confirmBatchDelete = () =>
    batchDeleteToursMutation.mutate({ ids: selectedTourIds });

  // Bulk activate / deactivate — uses the existing toggleStatus per-tour mutation,
  // running sequentially. Keeps the API surface unchanged.
  const handleBulkActivate = async () => {
    const toActivate = (tours || []).filter(
      (t) => selectedTourIds.includes(t.id) && t.status !== "active"
    );
    for (const t of toActivate) {
      try {
        await toggleStatusMutation.mutateAsync({ id: t.id });
      } catch {
        /* error toast already raised by mutation onError */
      }
    }
    setSelectedTourIds([]);
    toast.success(t("toursTab.bulkActivateSuccess"));
  };

  const handleBulkDeactivate = async () => {
    const toDeactivate = (tours || []).filter(
      (t) => selectedTourIds.includes(t.id) && t.status === "active"
    );
    for (const t of toDeactivate) {
      try {
        await toggleStatusMutation.mutateAsync({ id: t.id });
      } catch {
        /* error toast already raised by mutation onError */
      }
    }
    setSelectedTourIds([]);
    toast.success(t("toursTab.bulkDeactivateSuccess"));
  };

  // Round 80.14: bulk feature/unfeature — chained per-tour mutations,
  // same pattern as activate/deactivate above.
  const handleBulkFeature = async () => {
    const toFeature = (tours || []).filter(
      (t) => selectedTourIds.includes(t.id) && t.featured !== 1
    );
    for (const tt of toFeature) {
      try {
        await toggleFeaturedMutation.mutateAsync({ id: tt.id });
      } catch {
        /* error already raised */
      }
    }
    setSelectedTourIds([]);
    toast.success(t("toursTab.bulkFeatureSuccess"));
  };

  const handleBulkUnfeature = async () => {
    const toUnfeature = (tours || []).filter(
      (t) => selectedTourIds.includes(t.id) && t.featured === 1
    );
    for (const tt of toUnfeature) {
      try {
        await toggleFeaturedMutation.mutateAsync({ id: tt.id });
      } catch {
        /* error already raised */
      }
    }
    setSelectedTourIds([]);
    toast.success(t("toursTab.bulkUnfeatureSuccess"));
  };

  const handleDuplicate = (tourId: number, tourTitle: string) => {
    if (confirm(`${t("toursTab.copyTour")} - ${tourTitle}?`)) {
      duplicateTourMutation.mutate({ id: tourId });
    }
  };

  const toggleSelectTour = (tourId: number) => {
    setSelectedTourIds((prev) =>
      prev.includes(tourId)
        ? prev.filter((id) => id !== tourId)
        : [...prev, tourId]
    );
  };

  // ── Filter + sort / Stats / StatusCounts ──────────────────────────────────
  // Pure derivations live in ./tours/toursTab.helpers.ts (Phase 5B).
  // Wrapped in useMemo here so React still memoises by the original deps.
  const filteredTours = useMemo(
    () =>
      filterAndSortTours(tours, {
        statusFilter,
        featuredFilter,
        searchKeyword,
        sortBy,
      }),
    [tours, statusFilter, featuredFilter, searchKeyword, sortBy]
  );

  // Round 80.14: "本週新增" tile — count of tours created in last 7 days,
  // derivable directly from tours.createdAt. Real signal Jeff acts on.
  const stats = useMemo(() => computeStats(tours), [tours]);

  const statusCounts = useMemo(() => computeStatusCounts(tours), [tours]);
  // toRowData: imported from ./tours/toursTab.helpers (pure mapper).

  return (
    <div className="space-y-6">
      {/* Floating background generation indicator */}
      {isGenerating && activeDialog !== "aiGenerate" && (
        <div
          className="fixed bottom-6 right-6 z-50 bg-foreground text-white rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3 cursor-pointer"
          onClick={() => setActiveDialog("aiGenerate")}
        >
          <Loader2 className="h-4 w-4 animate-spin text-[#c9a563]" />
          <div>
            <p className="text-xs font-semibold">
              {t("toursTab.aiGenerationInProgress")}
            </p>
            <p className="text-[10px] text-gray-400">
              {t("toursTab.clickToViewProgress")}
            </p>
          </div>
        </div>
      )}

      {/* Header (title + actions + stat tiles).
          Round 80.21: dropped onBulkImport — bulk import is now a tab
          inside the unified create dialog (opened via onAddAi). */}
      <ToursTabHeader
        total={filteredTours?.length || 0}
        stats={stats}
        onAddManual={() => {
          setFormData(EMPTY_FORM);
          setActiveDialog("create");
        }}
        onAddAi={() => {
          setGenerationError(null);
          setActiveDialog("aiGenerate");
        }}
      />

      {/* Filters */}
      <ToursTabFilters
        searchKeyword={searchKeyword}
        onSearchChange={setSearchKeyword}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        statusCounts={statusCounts}
        featuredFilter={featuredFilter}
        onFeaturedToggle={() =>
          setFeaturedFilter(featuredFilter === "featured" ? "all" : "featured")
        }
        view={view}
        onViewChange={setView}
        sortBy={sortBy}
        onSortChange={setSortBy}
      />

      {/* List / Grid */}
      {toursLoading ? (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <LoadingRow text={t("toursTab.loading")} />
        </div>
      ) : filteredTours && filteredTours.length > 0 ? (
        view === "list" ? (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="divide-y divide-gray-100">
              {filteredTours.map((tour) => {
                const rowData = toRowData(tour);
                return (
                  <ToursTabRow
                    key={tour.id}
                    tour={rowData}
                    isSelected={selectedTourIds.includes(tour.id)}
                    onToggleSelect={() => toggleSelectTour(tour.id)}
                    onEdit={() => handleEdit(tour.id)}
                    onToggleStatus={() =>
                      toggleStatusMutation.mutate({ id: tour.id })
                    }
                    onToggleFeatured={() =>
                      toggleFeaturedMutation.mutate({ id: tour.id })
                    }
                    onManageDepartures={() => {
                      setSelectedTourForDepartures({
                        id: tour.id,
                        title: tour.title,
                      });
                      setActiveDialog("departures");
                    }}
                    onAiDeparturePreview={() => {
                      setSelectedTourForAiPreview({
                        id: tour.id,
                        title: tour.title,
                      });
                      setActiveDialog("aiDeparturePreview");
                    }}
                    onDuplicate={() => handleDuplicate(tour.id, tour.title)}
                    onDelete={() => handleDelete(tour.id)}
                    toggleStatusPending={toggleStatusMutation.isPending}
                    toggleFeaturedPending={toggleFeaturedMutation.isPending}
                    duplicatePending={duplicateTourMutation.isPending}
                  />
                );
              })}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTours.map((tour) => {
              const rowData = toRowData(tour);
              return (
                <ToursTabCard
                  key={tour.id}
                  tour={rowData}
                  isSelected={selectedTourIds.includes(tour.id)}
                  onToggleSelect={() => toggleSelectTour(tour.id)}
                  onEdit={() => handleEdit(tour.id)}
                  onToggleStatus={() =>
                    toggleStatusMutation.mutate({ id: tour.id })
                  }
                  onToggleFeatured={() =>
                    toggleFeaturedMutation.mutate({ id: tour.id })
                  }
                  onManageDepartures={() => {
                    setSelectedTourForDepartures({
                      id: tour.id,
                      title: tour.title,
                    });
                    setActiveDialog("departures");
                  }}
                  onAiDeparturePreview={() => {
                    setSelectedTourForAiPreview({
                      id: tour.id,
                      title: tour.title,
                    });
                    setActiveDialog("aiDeparturePreview");
                  }}
                  onDuplicate={() => handleDuplicate(tour.id, tour.title)}
                  onDelete={() => handleDelete(tour.id)}
                  toggleStatusPending={toggleStatusMutation.isPending}
                  toggleFeaturedPending={toggleFeaturedMutation.isPending}
                  duplicatePending={duplicateTourMutation.isPending}
                />
              );
            })}
          </div>
        )
      ) : tours && tours.length > 0 ? (
        // Round 80.18: richer "no filter matches" empty state — show what's
        // filtered + 1-click reset + alternative search suggestion.
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-foreground/5 flex items-center justify-center mb-4">
            <span className="text-2xl">🔎</span>
          </div>
          <h3 className="text-base font-semibold text-foreground mb-1">
            {t("toursTab.noResults")}
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            {t("toursTab.noResultsHint")}
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setStatusFilter("all");
                setFeaturedFilter("all");
                setSearchKeyword("");
              }}
              className="rounded-lg"
            >
              {t("toursTab.clearFilters")}
            </Button>
          </div>
        </div>
      ) : (
        // Round 80.18: richer first-run empty state — illustrative + 2 CTAs
        // (AI gen primary, manual secondary) so Jeff lands directly on the
        // most-used path instead of an apologetic "no data" message.
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-[#c9a563]/10 flex items-center justify-center mb-5">
            <span className="text-3xl">✈️</span>
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {t("toursTab.noData")}
          </h3>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            {t("toursTab.noDataHint")}
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Button
              onClick={() => setActiveDialog("aiGenerate")}
              className="bg-foreground text-white hover:bg-foreground/85 rounded-lg gap-2"
            >
              <Loader2 className="w-4 h-4 hidden" />
              ✨ {t("toursTab.aiAutoGenerate")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setActiveDialog("create")}
              className="rounded-lg"
            >
              + {t("toursTab.addTour")}
            </Button>
          </div>
        </div>
      )}

      {/* Floating bulk action bar */}
      <ToursTabBulkBar
        count={selectedTourIds.length}
        onBulkActivate={handleBulkActivate}
        onBulkDeactivate={handleBulkDeactivate}
        onBulkFeature={handleBulkFeature}
        onBulkUnfeature={handleBulkUnfeature}
        onBulkDelete={handleBatchDelete}
        onClear={() => setSelectedTourIds([])}
        bulkPending={
          toggleStatusMutation.isPending ||
          toggleFeaturedMutation.isPending ||
          batchDeleteToursMutation.isPending
        }
      />

      {/* Quick create dialog (manual 新增) */}
      <ToursTabQuickCreateDialog
        open={activeDialog === "create"}
        onOpenChange={(o) => (o ? setActiveDialog("create") : closeDialog())}
        formData={formData}
        setFormData={setFormData}
        onSubmit={handleCreate}
        isSaving={createTourMutation.isPending}
      />

      {/* Delete confirm dialog */}
      <Dialog
        open={activeDialog === "delete"}
        onOpenChange={(o) => (o ? setActiveDialog("delete") : closeDialog())}
      >
        <DialogContent className="rounded-xl">
          <DialogHeader>
            <DialogTitle>{t("toursTab.deleteDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("toursTab.deleteConfirmDesc").replace(
                "{title}",
                tours?.find((t) => t.id === selectedTourId)?.title || ""
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeDialog}
              className="rounded-lg"
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteTourMutation.isPending}
              className="rounded-lg"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {deleteTourMutation.isPending
                ? t("toursTab.deleting")
                : t("toursTab.confirmDelete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch delete confirm dialog */}
      <Dialog
        open={activeDialog === "batchDelete"}
        onOpenChange={(o) =>
          o ? setActiveDialog("batchDelete") : closeDialog()
        }
      >
        <DialogContent className="rounded-xl">
          <DialogHeader>
            <DialogTitle>{t("toursTab.batchDeleteDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("toursTab.batchDeleteConfirmDesc").replace(
                "{count}",
                String(selectedTourIds.length)
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeDialog}
              className="rounded-lg"
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmBatchDelete}
              disabled={batchDeleteToursMutation.isPending}
              className="rounded-lg"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {batchDeleteToursMutation.isPending
                ? t("toursTab.deleting")
                : t("toursTab.confirmDelete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Round 80.21: unified create dialog (URL / PDF / bulk import).
          Mode is selected by chips inside the dialog. */}
      <ToursTabCreateDialog
        open={activeDialog === "aiGenerate"}
        onOpenChange={(o) =>
          o ? setActiveDialog("aiGenerate") : closeDialog()
        }
        autoGenerateUrl={autoGenerateUrl}
        setAutoGenerateUrl={setAutoGenerateUrl}
        pdfFile={pdfFile}
        setPdfFile={setPdfFile}
        forceRegenerate={forceRegenerate}
        setForceRegenerate={setForceRegenerate}
        isGenerating={isGenerating}
        pdfUploading={pdfUploading}
        currentTaskId={currentTaskId}
        generationStatus={generationStatus}
        generationError={generationError}
        setGenerationError={setGenerationError}
        isPending={submitAsyncGenerationMutation.isPending}
        onGenerate={handleAutoGenerate}
        onClose={() => {
          setActiveDialog("none");
          if (!isGenerating) {
            setAutoGenerateUrl("");
            setForceRegenerate(false);
            setCurrentTaskId(null);
            setGenerationError(null);
            setPdfFile(null);
            setPdfUploading(false);
          }
        }}
      />

      {/* Departures management dialog */}
      <Dialog
        open={activeDialog === "departures"}
        onOpenChange={(o) =>
          o ? setActiveDialog("departures") : closeDialog()
        }
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle>{t("toursTab.departuresDialogTitle")}</DialogTitle>
            <DialogDescription>
              {selectedTourForDepartures?.title}
            </DialogDescription>
          </DialogHeader>
          {selectedTourForDepartures && (
            <DeparturesManagement
              tourId={selectedTourForDepartures.id}
              tourTitle={selectedTourForDepartures.title}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* AI departure preview dialog */}
      {selectedTourForAiPreview && (
        <DeparturePreview
          tourId={selectedTourForAiPreview.id}
          tourTitle={selectedTourForAiPreview.title}
          open={activeDialog === "aiDeparturePreview"}
          onOpenChange={(open) => {
            if (!open) {
              closeDialog();
              setSelectedTourForAiPreview(null);
            }
          }}
          onConfirmed={() => {
            invalidateTourCaches();
          }}
        />
      )}

      {/* AI preview dialog (after generation completes — currently unused due
          to direct save flow, but kept for parity with original) */}
      <ToursTabPreviewDialog
        open={activeDialog === "aiPreview"}
        onOpenChange={(o) => (o ? setActiveDialog("aiPreview") : closeDialog())}
        generatedTourData={generatedTourData}
        isAdmin={isAdmin}
        isSaving={saveFromPreviewMutation.isPending}
        onConfirmSave={() => {
          if (generatedTourData) {
            saveFromPreviewMutation.mutate({ tourData: generatedTourData });
          }
        }}
        onRegenerate={() => {
          setGeneratedTourData(null);
          setActiveDialog("aiGenerate");
        }}
        onEdit={() => setActiveDialog("aiPreviewEdit")}
        onCancel={() => {
          setGeneratedTourData(null);
          setAutoGenerateUrl("");
          closeDialog();
        }}
      />

      {/* AI preview → edit dialog (uses TourEditDialog with all tabs) */}
      <TourEditDialog
        open={activeDialog === "aiPreviewEdit"}
        onOpenChange={(o) =>
          o ? setActiveDialog("aiPreviewEdit") : closeDialog()
        }
        tourData={generatedTourData}
        onSave={(editedData) => {
          saveFromPreviewMutation.mutate({ tourData: editedData });
        }}
        isSaving={saveFromPreviewMutation.isPending}
      />

      {/* Full edit dialog for existing tours (TourEditDialog with all tabs) */}
      <TourEditDialog
        open={activeDialog === "fullEdit"}
        onOpenChange={(o) => (o ? setActiveDialog("fullEdit") : closeDialog())}
        tourData={selectedTourForEdit}
        onSave={(editedData) => {
          if (selectedTourId) {
            updateTourMutation.mutate({
              id: selectedTourId,
              ...editedData,
            });
          }
        }}
        isSaving={updateTourMutation.isPending}
      />
    </div>
  );
}
