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
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar, CheckCircle2, Edit, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useLocale } from "@/contexts/LocaleContext";

type DepartureFormData = {
  tourId: number;
  departureDate: string;
  returnDate: string;
  adultPrice: number;
  childPriceWithBed?: number;
  childPriceNoBed?: number;
  infantPrice?: number;
  singleRoomSupplement?: number;
  totalSlots: number;
  status: "open" | "full" | "cancelled";
  currency: string;
  notes?: string;
};

interface DeparturesManagementProps {
  tourId: number;
  tourTitle: string;
}

// Format currency display: TWD shows as "NT$"; other currencies show their code.
const formatPrice = (amount: number, currency?: string | null) => {
  const code = (currency || "TWD").toUpperCase();
  const symbol = code === "TWD" ? "NT$" : code;
  return `${symbol} ${amount.toLocaleString()}`;
};

export default function DeparturesManagement({ tourId }: DeparturesManagementProps) {
  const { t } = useLocale();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedDepartureId, setSelectedDepartureId] = useState<number | null>(null);
  const [formData, setFormData] = useState<DepartureFormData>({
    tourId,
    departureDate: "",
    returnDate: "",
    adultPrice: 0,
    childPriceWithBed: 0,
    childPriceNoBed: 0,
    infantPrice: 0,
    singleRoomSupplement: 0,
    totalSlots: 20,
    status: "open",
    currency: "TWD",
    notes: "",
  });

  const utils = trpc.useUtils();
  const { data: departures, isLoading } = trpc.departures.listByTour.useQuery({ tourId });

  // AI Extracted Departures state
  const [isAiImportDialogOpen, setIsAiImportDialogOpen] = useState(false);
  const [selectedExtractedDates, setSelectedExtractedDates] = useState<Set<string>>(new Set());
  const [editedPrices, setEditedPrices] = useState<Record<string, { adultPrice?: number; maxParticipants?: number }>>({});

  // Query extracted departures
  const { data: extractedData, isLoading: isExtractedLoading } =
    trpc.tours.getExtractedDepartures.useQuery(
      { tourId },
      { enabled: isAiImportDialogOpen }
    );

  // Confirm extracted departures mutation
  const confirmExtractedMutation = trpc.tours.confirmExtractedDepartures.useMutation({
    onSuccess: (result) => {
      utils.departures.listByTour.invalidate({ tourId });
      setIsAiImportDialogOpen(false);
      setSelectedExtractedDates(new Set());
      setEditedPrices({});
      toast.success(result.message);
    },
    onError: (error) => {
      toast.error(t('departuresTab.confirmFailed', { message: error.message }));
    },
  });

  const handleAiImportConfirm = () => {
    if (!extractedData?.extractedDepartures?.departureDates) return;
    const pricing = extractedData.extractedDepartures.pricing || {};
    const capacity = extractedData.extractedDepartures.capacity || {};
    const selectedDates = extractedData.extractedDepartures.departureDates
      .filter((d: any) => selectedExtractedDates.has(d.date))
      .map((d: any) => ({
        date: d.date,
        status: 'available' as const,
        adultPrice: editedPrices[d.date]?.adultPrice ?? pricing.adultPrice ?? d.price,
        childWithBedPrice: pricing.childWithBedPrice,
        childNoBedPrice: pricing.childNoBedPrice,
        infantPrice: pricing.infantPrice,
        maxParticipants: editedPrices[d.date]?.maxParticipants ?? capacity.maxParticipants,
        notes: d.notes,
      }));
    if (selectedDates.length === 0) {
      toast.error(t('departuresTab.selectAtLeastOne'));
      return;
    }
    confirmExtractedMutation.mutate({ tourId, selectedDates, clearExtracted: true });
  };

  const createMutation = trpc.departures.create.useMutation({
    onSuccess: () => {
      utils.departures.listByTour.invalidate({ tourId });
      setIsCreateDialogOpen(false);
      resetForm();
      toast.success(t('departuresTab.createSuccess'));
    },
    onError: (error) => {
      toast.error(t('departuresTab.createError', { message: error.message }));
    },
  });

  const updateMutation = trpc.departures.update.useMutation({
    onSuccess: () => {
      utils.departures.listByTour.invalidate({ tourId });
      setIsEditDialogOpen(false);
      resetForm();
      toast.success(t('departuresTab.updateSuccess'));
    },
    onError: (error) => {
      toast.error(t('departuresTab.updateError', { message: error.message }));
    },
  });

  const deleteMutation = trpc.departures.delete.useMutation({
    onSuccess: () => {
      utils.departures.listByTour.invalidate({ tourId });
      setIsDeleteDialogOpen(false);
      setSelectedDepartureId(null);
      toast.success(t('departuresTab.deleteSuccess'));
    },
    onError: (error) => {
      toast.error(t('departuresTab.deleteError', { message: error.message }));
    },
  });

  const resetForm = () => {
    setFormData({
      tourId,
      departureDate: "",
      returnDate: "",
      adultPrice: 0,
      childPriceWithBed: 0,
      childPriceNoBed: 0,
      infantPrice: 0,
      singleRoomSupplement: 0,
      totalSlots: 20,
      status: "open",
      currency: "TWD",
      notes: "",
    });
  };

  const handleCreate = () => {
    createMutation.mutate({
      ...formData,
      departureDate: new Date(formData.departureDate),
      returnDate: new Date(formData.returnDate),
    });
  };

  const handleUpdate = () => {
    if (!selectedDepartureId) return;
    updateMutation.mutate({
      id: selectedDepartureId,
      departureDate: new Date(formData.departureDate),
      returnDate: new Date(formData.returnDate),
      adultPrice: formData.adultPrice,
      childPriceWithBed: formData.childPriceWithBed,
      childPriceNoBed: formData.childPriceNoBed,
      infantPrice: formData.infantPrice,
      singleRoomSupplement: formData.singleRoomSupplement,
      totalSlots: formData.totalSlots,
      status: formData.status as "open" | "full" | "cancelled",
      currency: formData.currency,
      notes: formData.notes || undefined,
    });
  };

  const handleEdit = (departure: any) => {
    setSelectedDepartureId(departure.id);
    setFormData({
      tourId,
      departureDate: format(new Date(departure.departureDate), "yyyy-MM-dd"),
      returnDate: format(new Date(departure.returnDate), "yyyy-MM-dd"),
      adultPrice: departure.adultPrice,
      childPriceWithBed: departure.childPriceWithBed || 0,
      childPriceNoBed: departure.childPriceNoBed || 0,
      infantPrice: departure.infantPrice || 0,
      singleRoomSupplement: departure.singleRoomSupplement || 0,
      totalSlots: departure.totalSlots,
      status: departure.status,
      currency: departure.currency || "TWD",
      notes: departure.notes || "",
    });
    setIsEditDialogOpen(true);
  };

  const handleDelete = (id: number) => {
    setSelectedDepartureId(id);
    setIsDeleteDialogOpen(true);
  };

  // Status chip styling — B&W + Gold palette. Only "full" keeps a muted red
  // because it is a true error/warning state worth flagging.
  const getStatusConfig = (status: string) => {
    const config = {
      open: {
        label: t('departuresTab.statusOpen'),
        className: "bg-foreground/5 text-foreground",
      },
      full: {
        label: t('departuresTab.statusFull'),
        className: "bg-red-50 text-red-700",
      },
      confirmed: {
        label: t('departuresTab.statusConfirmed'),
        className: "bg-[#c9a563]/15 text-[#8a6f3a]",
      },
      cancelled: {
        label: t('departuresTab.statusCancelled'),
        className: "bg-foreground/5 text-foreground/50 line-through",
      },
    };
    return config[status as keyof typeof config] || config.open;
  };

  // Reusable form fields
  const renderFormFields = () => (
    <div className="grid grid-cols-2 gap-4 py-4">
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">{t('departuresTab.fieldDepartureDate')}</Label>
        <Input
          type="date"
          value={formData.departureDate}
          onChange={(e) => setFormData({ ...formData, departureDate: e.target.value })}
          className="border-foreground/20 rounded-lg"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">{t('departuresTab.fieldReturnDate')}</Label>
        <Input
          type="date"
          value={formData.returnDate}
          onChange={(e) => setFormData({ ...formData, returnDate: e.target.value })}
          className="border-foreground/20 rounded-lg"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider whitespace-nowrap">{t('departuresTab.fieldAdultPrice')}</Label>
        <Input
          type="number"
          value={formData.adultPrice}
          onChange={(e) => setFormData({ ...formData, adultPrice: Number(e.target.value) })}
          className="border-foreground/20 rounded-lg"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">{t('departuresTab.fieldChildPriceWithBed')}</Label>
        <Input
          type="number"
          value={formData.childPriceWithBed || ""}
          onChange={(e) => setFormData({ ...formData, childPriceWithBed: e.target.value ? Number(e.target.value) : undefined })}
          className="border-foreground/20 rounded-lg"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">{t('departuresTab.fieldChildPriceNoBed')}</Label>
        <Input
          type="number"
          value={formData.childPriceNoBed || ""}
          onChange={(e) => setFormData({ ...formData, childPriceNoBed: e.target.value ? Number(e.target.value) : undefined })}
          className="border-foreground/20 rounded-lg"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">{t('departuresTab.fieldInfantPrice')}</Label>
        <Input
          type="number"
          value={formData.infantPrice || ""}
          onChange={(e) => setFormData({ ...formData, infantPrice: e.target.value ? Number(e.target.value) : undefined })}
          className="border-foreground/20 rounded-lg"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">{t('departuresTab.fieldSingleRoomSupplement')}</Label>
        <Input
          type="number"
          value={formData.singleRoomSupplement || ""}
          onChange={(e) => setFormData({ ...formData, singleRoomSupplement: e.target.value ? Number(e.target.value) : undefined })}
          className="border-foreground/20 rounded-lg"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">{t('departuresTab.fieldTotalSlots')}</Label>
        <Input
          type="number"
          value={formData.totalSlots}
          onChange={(e) => setFormData({ ...formData, totalSlots: Number(e.target.value) })}
          className="border-foreground/20 rounded-lg"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">{t('departuresTab.fieldStatus')}</Label>
        <Select value={formData.status} onValueChange={(value: any) => setFormData({ ...formData, status: value })}>
          <SelectTrigger className="border-foreground/20 rounded-lg">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">{t('departuresTab.statusOpen')}</SelectItem>
            <SelectItem value="full">{t('departuresTab.statusFull')}</SelectItem>
            <SelectItem value="cancelled">{t('departuresTab.statusCancelled')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">{t('departuresTab.currencyLabel')}</Label>
        <Select value={formData.currency} onValueChange={(value) => setFormData({ ...formData, currency: value })}>
          <SelectTrigger className="border-foreground/20 rounded-lg">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="TWD">{t('departuresTab.currencyTWD')}</SelectItem>
            <SelectItem value="USD">{t('departuresTab.currencyUSD')}</SelectItem>
            <SelectItem value="JPY">{t('departuresTab.currencyJPY')}</SelectItem>
            <SelectItem value="EUR">{t('departuresTab.currencyEUR')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-2 space-y-1.5">
        <Label className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">{t('departuresTab.fieldNotes')}</Label>
        <Textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          rows={2}
          placeholder={t('departuresTab.notesPlaceholder')}
          className="border-foreground/20 text-sm rounded-lg"
        />
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-foreground/40" />
        <span className="ml-2 text-sm text-foreground/60">{t('departuresTab.loading')}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header - title shown in parent Dialog, only show action buttons */}
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => setIsAiImportDialogOpen(true)}
          className="border-foreground/20 h-8 text-xs px-3 gap-1.5 rounded-lg"
        >
          <Sparkles className="w-3.5 h-3.5 text-[#c9a563]" />
          {t('departuresTab.aiBulkImport')}
        </Button>
        <Button
          onClick={() => { resetForm(); setIsCreateDialogOpen(true); }}
          className="bg-foreground text-white hover:bg-foreground/85 h-8 text-xs px-3 rounded-lg"
        >
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          {t('departuresTab.addDeparture')}
        </Button>
      </div>

      {/* Departures List — card grid replaces the cramped table.
          Each card has its own breathing room so status pills and action icons
          never collide. Two cards per row on desktop, one per row on mobile. */}
      {departures && departures.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {departures.map((departure) => {
            const statusConfig = getStatusConfig(departure.status);
            const totalSlots = departure.totalSlots || 0;
            const bookedSlots = departure.bookedSlots || 0;
            const remainingSlots = Math.max(totalSlots - bookedSlots, 0);
            const occupancyPct = totalSlots > 0 ? Math.round((bookedSlots / totalSlots) * 100) : 0;
            // Progress bar shifts from gold → amber → red as fill approaches cap.
            const barColor =
              occupancyPct >= 90
                ? "bg-red-500"
                : occupancyPct >= 70
                  ? "bg-amber-500"
                  : "bg-[#c9a563]";
            return (
              <div
                key={departure.id}
                className="group relative border border-foreground/15 bg-white hover:border-foreground/25 hover:shadow-sm transition-all rounded-xl overflow-hidden"
              >
                {/* Header strip — date + status, never overlap because they're on opposite sides */}
                <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-foreground/10">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <Calendar className="w-4 h-4 text-[#c9a563] flex-shrink-0" />
                      <span className="text-base font-bold text-foreground whitespace-nowrap">
                        {format(new Date(departure.departureDate), "yyyy/MM/dd")}
                      </span>
                    </div>
                    <span className="text-xs text-foreground/55 ml-6">
                      {t('departuresTab.colReturnDate')}：{format(new Date(departure.returnDate), "yyyy/MM/dd")}
                    </span>
                  </div>
                  <span className={`inline-flex items-center px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap rounded-full flex-shrink-0 ${statusConfig.className}`}>
                    {statusConfig.label}
                  </span>
                </div>

                {/* Body — price + slots */}
                <div className="px-4 py-3 space-y-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[11px] font-semibold text-foreground/55 uppercase tracking-wider">
                      {t('departuresTab.colAdultPrice')}
                    </span>
                    <span className="text-base font-bold text-foreground tabular-nums">
                      {formatPrice(departure.adultPrice, departure.currency)}
                    </span>
                  </div>

                  {/* Slots row — progress bar with clear "remaining / total" labels */}
                  <div>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="text-xs font-medium text-foreground">
                        {remainingSlots > 0
                          ? t('departuresTab.slotsRemainingFormat', { n: String(remainingSlots) })
                          : t('departuresTab.slotsFullLabel')}
                      </span>
                      <span className="text-[11px] text-foreground/50 tabular-nums">
                        {t('departuresTab.slotsOfTotalFormat', { booked: String(bookedSlots), total: String(totalSlots) })}
                      </span>
                    </div>
                    <div className="h-1.5 bg-foreground/10 overflow-hidden rounded-full">
                      <div
                        className={`h-full ${barColor} transition-all`}
                        style={{ width: `${occupancyPct}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Footer — action buttons in their own row, no collisions */}
                <div className="flex items-center justify-end gap-1 px-3 py-2 bg-[#FAF8F2]/60 border-t border-foreground/10">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEdit(departure)}
                    className="h-8 px-3 text-xs gap-1.5 hover:bg-foreground/5 rounded-lg"
                  >
                    <Edit className="w-3.5 h-3.5 text-foreground/60" />
                    {t('departuresTab.editTitle')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(departure.id)}
                    className="h-8 px-3 text-xs gap-1.5 hover:bg-red-50 hover:text-red-600 rounded-lg"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="border border-foreground/15 px-4 py-12 text-center rounded-xl">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#FAF8F2] mb-3">
            <Calendar className="w-6 h-6 text-[#c9a563]" />
          </div>
          <p className="text-sm font-medium text-foreground">{t('departuresTab.emptyStateTitle')}</p>
          <p className="text-xs text-foreground/50 mt-1">{t('departuresTab.emptyStateHint')}</p>
          <Button
            onClick={() => { resetForm(); setIsCreateDialogOpen(true); }}
            className="mt-4 bg-foreground text-white hover:bg-foreground/85 h-8 text-xs px-3 rounded-lg"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            {t('departuresTab.addDeparture')}
          </Button>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">{t('departuresTab.createTitle')}</DialogTitle>
            <DialogDescription className="text-xs text-foreground/60">{t('departuresTab.createDesc')}</DialogDescription>
          </DialogHeader>
          {renderFormFields()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)} className="border-foreground/20 rounded-lg">
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} className="bg-foreground text-white hover:bg-foreground/85 rounded-lg">
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('departuresTab.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">{t('departuresTab.editTitle')}</DialogTitle>
            <DialogDescription className="text-xs text-foreground/60">{t('departuresTab.editDesc')}</DialogDescription>
          </DialogHeader>
          {renderFormFields()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} className="border-foreground/20 rounded-lg">
              {t('common.cancel')}
            </Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending} className="bg-foreground text-white hover:bg-foreground/85 rounded-lg">
              {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('departuresTab.update')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Extracted Departures Import Dialog */}
      <Dialog open={isAiImportDialogOpen} onOpenChange={setIsAiImportDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Sparkles className="w-5 h-5 text-[#c9a563]" />
              {t('departuresTab.aiImportTitle')}
            </DialogTitle>
            <DialogDescription className="text-xs text-foreground/60">
              {t('departuresTab.aiImportDesc')}
            </DialogDescription>
          </DialogHeader>

          {isExtractedLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-foreground/40" />
              <span className="ml-2 text-sm text-foreground/60">{t('departuresTab.aiImportLoading')}</span>
            </div>
          ) : !extractedData?.extractedDepartures ? (
            <div className="py-12 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#FAF8F2] mb-3">
                <Sparkles className="w-6 h-6 text-[#c9a563]" />
              </div>
              <p className="text-sm font-medium text-foreground">{t('departuresTab.aiImportEmptyTitle')}</p>
              <p className="text-xs text-foreground/50 mt-1">{t('departuresTab.aiImportEmptyDesc')}</p>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              {/* Pricing Summary */}
              {extractedData.extractedDepartures.pricing && (
                <div className="bg-[#FAF8F2] border border-foreground/10 p-3 text-xs space-y-1 rounded-lg">
                  <p className="font-semibold text-foreground mb-1.5">{t('departuresTab.aiPriceSummary')}</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-foreground/70">
                    {extractedData.extractedDepartures.pricing.adultPrice && (
                      <span>{t('departuresTab.priceAdult', { v: extractedData.extractedDepartures.pricing.adultPrice.toLocaleString() })}</span>
                    )}
                    {extractedData.extractedDepartures.pricing.childWithBedPrice && (
                      <span>{t('departuresTab.priceChildWithBed', { v: extractedData.extractedDepartures.pricing.childWithBedPrice.toLocaleString() })}</span>
                    )}
                    {extractedData.extractedDepartures.pricing.childNoBedPrice && (
                      <span>{t('departuresTab.priceChildNoBed', { v: extractedData.extractedDepartures.pricing.childNoBedPrice.toLocaleString() })}</span>
                    )}
                    {extractedData.extractedDepartures.pricing.infantPrice && (
                      <span>{t('departuresTab.priceInfant', { v: extractedData.extractedDepartures.pricing.infantPrice.toLocaleString() })}</span>
                    )}
                    {extractedData.extractedDepartures.capacity?.maxParticipants && (
                      <span>{t('departuresTab.maxParticipantsFormat', { n: String(extractedData.extractedDepartures.capacity.maxParticipants) })}</span>
                    )}
                    {extractedData.extractedDepartures.pricing.priceNote && (
                      <span className="col-span-2 text-foreground/60">{extractedData.extractedDepartures.pricing.priceNote}</span>
                    )}
                  </div>
                </div>
              )}

              {/* Select All */}
              {extractedData.extractedDepartures.departureDates && extractedData.extractedDepartures.departureDates.length > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="select-all"
                      checked={selectedExtractedDates.size === extractedData.extractedDepartures.departureDates.length}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedExtractedDates(new Set(extractedData.extractedDepartures.departureDates.map((d: any) => d.date)));
                        } else {
                          setSelectedExtractedDates(new Set());
                        }
                      }}
                    />
                    <label htmlFor="select-all" className="text-xs font-medium text-foreground cursor-pointer">
                      {t('departuresTab.selectAllLabel', { n: String(extractedData.extractedDepartures.departureDates.length) })}
                    </label>
                  </div>
                  <span className="text-xs text-foreground/60">{t('departuresTab.selectedCountLabel', { n: String(selectedExtractedDates.size) })}</span>
                </div>
              )}

              {/* Dates List */}
              <div className="border border-foreground/15 overflow-hidden divide-y divide-foreground/10 rounded-lg">
                {extractedData.extractedDepartures.departureDates?.map((dep: any, idx: number) => (
                  <div key={dep.date} className={`flex items-center gap-3 px-3 py-2.5 ${selectedExtractedDates.has(dep.date) ? 'bg-[#FAF8F2]' : 'bg-white'}`}>
                    <Checkbox
                      id={`dep-${idx}`}
                      checked={selectedExtractedDates.has(dep.date)}
                      onCheckedChange={(checked) => {
                        const next = new Set(selectedExtractedDates);
                        if (checked) next.add(dep.date); else next.delete(dep.date);
                        setSelectedExtractedDates(next);
                      }}
                    />
                    <label htmlFor={`dep-${idx}`} className="flex-1 cursor-pointer">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-foreground">
                          {dep.date ? (() => { try { return format(new Date(dep.date), 'yyyy/MM/dd'); } catch { return dep.date; } })() : t('departuresTab.dateUnknown')}
                        </span>
                        {dep.status && (
                          <span className={`text-[11px] px-1.5 py-0.5 font-medium rounded-md whitespace-nowrap ${
                            dep.status === 'available' ? 'bg-[#c9a563]/15 text-[#8a6f3a]' :
                            dep.status === 'soldout' ? 'bg-red-50 text-red-700' :
                            'bg-foreground/5 text-foreground/60'
                          }`}>
                            {dep.status === 'available'
                              ? t('departuresTab.statusAvailable')
                              : dep.status === 'soldout'
                                ? t('departuresTab.statusSoldOut')
                                : dep.status}
                          </span>
                        )}
                        {dep.price && (
                          <span className="text-xs text-foreground/60">{formatPrice(dep.price, 'TWD')}</span>
                        )}
                      </div>
                    </label>
                    {/* Inline price edit */}
                    {selectedExtractedDates.has(dep.date) && (
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          placeholder={t('departuresTab.adultPricePlaceholder')}
                          value={editedPrices[dep.date]?.adultPrice ?? extractedData.extractedDepartures.pricing?.adultPrice ?? dep.price ?? ''}
                          onChange={(e) => setEditedPrices(prev => ({ ...prev, [dep.date]: { ...prev[dep.date], adultPrice: Number(e.target.value) } }))}
                          className="w-24 h-7 text-xs border-foreground/20 rounded-lg"
                        />
                        <Input
                          type="number"
                          placeholder={t('departuresTab.slotsPlaceholder')}
                          value={editedPrices[dep.date]?.maxParticipants ?? extractedData.extractedDepartures.capacity?.maxParticipants ?? ''}
                          onChange={(e) => setEditedPrices(prev => ({ ...prev, [dep.date]: { ...prev[dep.date], maxParticipants: Number(e.target.value) } }))}
                          className="w-16 h-7 text-xs border-foreground/20 rounded-lg"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAiImportDialogOpen(false)} className="border-foreground/20 rounded-lg">
              {t('departuresTab.cancel')}
            </Button>
            <Button
              onClick={handleAiImportConfirm}
              disabled={confirmExtractedMutation.isPending || selectedExtractedDates.size === 0 || !extractedData?.extractedDepartures}
              className="bg-foreground text-white hover:bg-foreground/85 rounded-lg"
            >
              {confirmExtractedMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('departuresTab.creatingLabel')}</>
              ) : (
                <><CheckCircle2 className="w-4 h-4 mr-2" />{t('departuresTab.confirmCreateFormat', { n: String(selectedExtractedDates.size) })}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="max-w-sm rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">{t('departuresTab.deleteTitle')}</DialogTitle>
            <DialogDescription className="text-sm text-foreground/60">
              {t('departuresTab.deleteDesc')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)} className="border-foreground/20 rounded-lg">
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              className="rounded-lg"
              onClick={() => { if (selectedDepartureId) deleteMutation.mutate({ id: selectedDepartureId }); }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
