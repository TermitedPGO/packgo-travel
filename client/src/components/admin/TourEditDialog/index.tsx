/**
 * v2 Wave 2 Module 2.12 — TourEditDialog orchestrator.
 *
 * Pre-split this file was 2,156 LOC carrying:
 *   - dialog shell + tab navigation
 *   - state for editedData / dirty / upload / file ref
 *   - 6 inline tab bodies (basic / itinerary / cost / notice / transport / photos)
 *   - 14 list-mutation helpers
 *   - SaveStatusBadge + isAiPlaceholder
 *
 * Post-split this orchestrator only wires:
 *   - <Dialog> with dirty-aware close
 *   - <TourEditProvider> hosting editedData + handlers
 *   - <Tabs> with 6 <TabsContent> calls (one per extracted file)
 *   - DialogFooter with Save / Cancel + Cmd-S shortcut
 *   - DialogHeader with title preview + SaveStatusBadge
 *
 * Public import surface is unchanged:
 *   `import { TourEditDialog } from "@/components/admin/TourEditDialog"`
 *   auto-resolves to this `index.tsx`. Pre-existing call sites in
 *   `ToursTab.tsx` (× 2) continue to work without change.
 *
 * Tab structure verified at L460/962/1138/1259/1402/1801 of the old monolith.
 * Audit ref: v2-audit-2026-05-19.md §C lines 149, 210.
 */
import { useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Edit, Loader2 } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

import { TourEditProvider, useTourEdit } from "./_context";
import { SaveStatusBadge } from "./_shared";
import BasicTab from "./BasicTab";
import ItineraryTab from "./ItineraryTab";
import CostTab from "./CostTab";
import NoticeTab from "./NoticeTab";
import TransportTab from "./TransportTab";
import PhotosTab from "./PhotosTab";

interface TourEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tourData: any;
  onSave: (editedData: any) => void;
  isSaving: boolean;
}

export function TourEditDialog({
  open,
  onOpenChange,
  tourData,
  onSave,
  isSaving,
}: TourEditDialogProps) {
  // v70: track the snapshot of data the dialog was opened with, so we can
  // detect "dirty" state (unsaved edits) and warn before a destructive close.
  // Without this, accidentally clicking outside the dialog wipes minutes/hours
  // of itinerary editing — Jeff has lost real work to this.
  const initialDataRef = useRef<string>("");

  return (
    <TourEditProvider tourData={tourData} initialDataRef={initialDataRef}>
      <TourEditDialogShell
        open={open}
        onOpenChange={onOpenChange}
        onSave={onSave}
        isSaving={isSaving}
        initialDataRef={initialDataRef}
      />
    </TourEditProvider>
  );
}

// Default-export alias so consumers can `import TourEditDialog from "..."`
// in addition to the existing named import. ToursTab.tsx uses the named
// import; keeping the default available makes the test-file mount path
// cleaner (and matches the pattern Module 5B used for AutonomousAgentsTab).
export default TourEditDialog;

interface ShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (editedData: any) => void;
  isSaving: boolean;
  initialDataRef: React.MutableRefObject<string>;
}

/**
 * Inner shell — split out so it can use `useTourEdit()`. Provider must wrap
 * the consumer; the outer component would otherwise need to remount the
 * provider on every prop change.
 */
function TourEditDialogShell({
  open,
  onOpenChange,
  onSave,
  isSaving,
  initialDataRef,
}: ShellProps) {
  const { t } = useLocale();
  const { editedData, isDirty } = useTourEdit();

  const handleDialogOpenChange = useCallback(
    (next: boolean) => {
      // Allow opens through unconditionally
      if (next) {
        onOpenChange(true);
        return;
      }
      // Block close if dirty unless user confirms
      if (isDirty) {
        const confirmed = window.confirm(
          t('tourEditDialog.unsavedChangesWarning') ||
            "您有未儲存的變更，確定要關閉嗎？關閉後將無法復原。"
        );
        if (!confirmed) return;
      }
      onOpenChange(false);
    },
    [isDirty, onOpenChange, t]
  );

  const handleSave = () => {
    // 將 JSON 欄位轉換為字串
    const dataToSave = {
      ...editedData,
      itineraryDetailed: JSON.stringify(editedData.itineraryDetailed || []),
      costExplanation: JSON.stringify(editedData.costExplanation || {}),
      noticeDetailed: JSON.stringify(editedData.noticeDetailed || {}),
      flights: JSON.stringify(editedData.flights || {}),
      images: JSON.stringify(editedData.images || []),
    };
    // v70: after a successful save, reset the dirty baseline so closing
    // immediately afterwards doesn't re-prompt for unsaved changes.
    try { initialDataRef.current = JSON.stringify(editedData); } catch {}
    onSave(dataToSave);
  };

  // Round 80.21 — keyboard shortcuts:
  //   Cmd/Ctrl + S → save (only when dirty)
  //   Esc handled by Radix Dialog → routes to handleDialogOpenChange
  //     which already prompts on dirty close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (!isSaving && isDirty) handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, isSaving, isDirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2026-05-16 React #310 fix: keep ALL hooks unconditional, gate render below.
  if (!editedData) return null;

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-w-7xl max-h-[90vh] overflow-hidden rounded-xl shadow-2xl flex flex-col">
        {/* Round 80.21 — richer dialog header:
            - Tour title preview (gold accent) so user knows which tour they're editing
            - Save-status badge (未儲存 / 儲存中 / 全部儲存) — replaces the dead
              second-line "修改 AI 生成的行程資訊..." that duplicated the section
              eyebrow inside the form. Real signal Jeff acts on. */}
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <DialogTitle className="flex items-center gap-2 text-foreground">
                <Edit className="h-5 w-5 text-[#c9a563]" />
                {t('tourEditDialog.title')}
              </DialogTitle>
              {editedData?.title ? (
                <DialogDescription className="text-foreground/65 mt-1 truncate">
                  <span className="text-[#c9a563] font-medium">·</span>{' '}
                  <span className="font-medium text-foreground/85">
                    {editedData.title}
                  </span>
                </DialogDescription>
              ) : (
                <DialogDescription className="text-foreground/55 mt-1">
                  {t('tourEditDialog.description')}
                </DialogDescription>
              )}
            </div>
            <SaveStatusBadge isDirty={isDirty} isSaving={isSaving} />
          </div>
        </DialogHeader>

        <Tabs defaultValue="basic" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-6 rounded-lg bg-foreground/5 p-1">
            <TabsTrigger value="basic" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-[#c9a563] focus-visible:ring-2 focus-visible:ring-foreground/20">{t('tourEditDialog.tabBasic')}</TabsTrigger>
            <TabsTrigger value="itinerary" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-[#c9a563] focus-visible:ring-2 focus-visible:ring-foreground/20">{t('tourEditDialog.tabItinerary')}</TabsTrigger>
            <TabsTrigger value="cost" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-[#c9a563] focus-visible:ring-2 focus-visible:ring-foreground/20">{t('tourEditDialog.tabCost')}</TabsTrigger>
            <TabsTrigger value="notice" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-[#c9a563] focus-visible:ring-2 focus-visible:ring-foreground/20">{t('tourEditDialog.tabNotice')}</TabsTrigger>
            <TabsTrigger value="transport" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-[#c9a563] focus-visible:ring-2 focus-visible:ring-foreground/20">{t('tourEditDialog.tabTransport')}</TabsTrigger>
            <TabsTrigger value="photos" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-[#c9a563] focus-visible:ring-2 focus-visible:ring-foreground/20">{t('tourEditDialog.tabPhotos')}</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto py-4">
            <TabsContent value="basic">
              <BasicTab />
            </TabsContent>
            <TabsContent value="itinerary">
              <ItineraryTab />
            </TabsContent>
            <TabsContent value="cost">
              <CostTab />
            </TabsContent>
            <TabsContent value="notice">
              <NoticeTab />
            </TabsContent>
            <TabsContent value="transport">
              <TransportTab />
            </TabsContent>
            <TabsContent value="photos">
              <PhotosTab />
            </TabsContent>
          </div>
        </Tabs>

        {/* Round 80.21 — sticky footer with dirty-aware Save:
            - Save button greyed out when nothing changed (prevents accidental
              empty saves that silently overwrite untouched fields).
            - Cmd+S keyboard shortcut hint — surfaces a power-user feature
              that Jeff already uses unconsciously. */}
        <DialogFooter className="flex items-center justify-between gap-2 border-t border-foreground/10 pt-4 mt-0 flex-shrink-0">
          <span className="text-[11px] text-foreground/45 hidden sm:inline">
            {isDirty
              ? t('tourEditDialog.unsavedHint') || '尚未儲存的變更會在關閉時遺失'
              : t('tourEditDialog.savedHint') || '所有變更已同步'}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => handleDialogOpenChange(false)}
              className="rounded-lg border-gray-300 text-foreground hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-foreground/20"
              disabled={isSaving}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !isDirty}
              className="bg-foreground text-white hover:bg-foreground/85 rounded-lg focus-visible:ring-2 focus-visible:ring-foreground/20 disabled:opacity-50"
              title={t('tourEditDialog.saveShortcut') || 'Cmd/Ctrl + S'}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('tourEditDialog.saving')}
                </>
              ) : (
                <>
                  {t('tourEditDialog.confirmSave')}
                  <kbd className="hidden md:inline ml-2 px-1.5 py-0.5 bg-white/15 text-white/85 text-[10px] rounded font-mono tracking-wide">
                    ⌘S
                  </kbd>
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
