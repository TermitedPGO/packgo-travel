import { Button } from "@/components/ui/button";
import { Star } from "lucide-react";
import { LoadingRow } from "@/components/ui/spinner";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocale } from "@/contexts/LocaleContext";

export default function ReviewsTab() {
  const { t } = useLocale();
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");

  // TODO: Implement reviews query when backend is ready
  const reviews: any[] = [];
  const isLoading = false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{t('admin.reviewsTab.title')}</h2>
          <p className="text-sm text-gray-500 mt-1">{t('admin.reviewsTab.totalCount', { n: String(reviews.length) })}</p>
        </div>
        <Select
          value={statusFilter}
          onValueChange={(value: any) => setStatusFilter(value)}
        >
          <SelectTrigger className="w-[160px] border-gray-300 rounded-lg">
            <SelectValue placeholder={t('admin.reviewsTab.filterPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('admin.reviewsTab.statusAll')}</SelectItem>
            <SelectItem value="pending">{t('admin.reviewsTab.statusPending')}</SelectItem>
            <SelectItem value="approved">{t('admin.reviewsTab.statusApproved')}</SelectItem>
            <SelectItem value="rejected">{t('admin.reviewsTab.statusRejected')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Reviews Table */}
      <div className="bg-white border border-gray-200 overflow-hidden rounded-xl">
        {isLoading ? (
          <LoadingRow />
        ) : reviews.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.reviewsTab.columnName')}</th>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.reviewsTab.columnTour')}</th>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.reviewsTab.columnRating')}</th>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.reviewsTab.columnContent')}</th>
                  <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.reviewsTab.columnStatus')}</th>
                  <th className="px-5 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('admin.reviewsTab.columnActions')}</th>
                </tr>
              </thead>
              <tbody>
                {/* Review rows will be mapped here */}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-16 text-center">
            <Star className="h-12 w-12 text-gray-200 mx-auto mb-4" />
            <h3 className="text-base font-semibold text-gray-700 mb-1">{t('admin.reviewsTab.emptyTitle')}</h3>
            <p className="text-sm text-gray-400">{t('admin.reviewsTab.emptyDesc')}</p>
          </div>
        )}
      </div>

      {/* Review Detail Dialog */}
      <Dialog open={isDetailDialogOpen} onOpenChange={setIsDetailDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle>{t('admin.reviewsTab.detailDialogTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500">{t('admin.reviewsTab.columnName')}</p>
                <p className="text-sm font-semibold text-gray-900 mt-0.5">—</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('admin.reviewsTab.columnTour')}</p>
                <p className="text-sm font-semibold text-gray-900 mt-0.5">—</p>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{t('admin.reviewsTab.ratingLabel')}</p>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star key={star} className="h-5 w-5 fill-yellow-400 text-yellow-400" />
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{t('admin.reviewsTab.contentLabel')}</p>
              <div className="bg-gray-50 border border-gray-200 p-4 rounded-lg">
                <p className="text-sm text-gray-700">—</p>
              </div>
            </div>
            <div className="border-t border-gray-200 pt-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{t('admin.reviewsTab.actionsLabel')}</p>
              <Textarea
                placeholder={t('admin.reviewsTab.replyPlaceholder')}
                rows={3}
                className="mb-3 border-gray-300 text-sm rounded-lg"
              />
              <div className="flex gap-2">
                <Button className="bg-black text-white hover:bg-gray-800 text-sm rounded-lg">
                  {t('admin.reviewsTab.approveButton')}
                </Button>
                <Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50 text-sm rounded-lg">
                  {t('admin.reviewsTab.rejectButton')}
                </Button>
                <Button variant="outline" className="border-gray-300 text-gray-700 hover:bg-gray-50 text-sm rounded-lg">
                  {t('admin.reviewsTab.featureButton')}
                </Button>
              </div>
            </div>
            <p className="text-xs text-gray-400 bg-gray-50 border border-gray-200 p-3 rounded-lg">
              {t('admin.reviewsTab.comingSoon')}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
