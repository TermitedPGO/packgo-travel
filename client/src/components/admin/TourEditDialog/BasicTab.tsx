/**
 * v2 Wave 2 Module 2.12 — Basic info tab.
 *
 * Verbatim JSX extraction from TourEditDialog L460-959 (the biggest tab).
 * Covers: title / productCode / promotionText / duration / price+currency /
 * maxParticipants / dates / description / location fields / Packpoint
 * (倍率 + commission + 排除) / supplier / hero image + subtitle.
 *
 * State + setters pulled from the shared edit context. `isAiPlaceholder`
 * helper imported from `_shared` (used to strip AI placeholder strings out
 * of the form fields without nuking the saved value).
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocale } from "@/contexts/LocaleContext";
import { useTourEdit } from "./_context";
import { isAiPlaceholder } from "./_shared";

export default function BasicTab() {
  const { t } = useLocale();
  const { editedData, setEditedData } = useTourEdit();

  return (
    <div className="mt-0 space-y-6">
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 space-y-4">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50 mb-4 pb-2 border-b border-foreground/5">{t('tourEditDialog.basicInfo')}</h3>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label htmlFor="title" className="text-sm font-medium">
              {t('tourEditDialog.tourTitle')} <span className="text-red-500">*</span>
            </Label>
            <Input
              id="title"
              value={editedData.title || ""}
              onChange={(e) => setEditedData({ ...editedData, title: e.target.value })}
              className="mt-2"
            />
          </div>

          {/* Round 80.21 — productCode now has a clear hint instead of
              letting user wonder what "26EC10MM02" is. Same for
              promotionText (placeholder example). */}
          <div>
            <Label htmlFor="productCode" className="text-sm font-medium">
              {t('tourEditDialog.productCode')}
            </Label>
            <Input
              id="productCode"
              value={editedData.productCode || ""}
              onChange={(e) => setEditedData({ ...editedData, productCode: e.target.value })}
              placeholder="例如:LION-26EC10MM02"
              className="mt-2"
            />
            <p className="text-[11px] text-foreground/50 mt-1.5">
              內部追蹤用,可保留原 OTA 的商品代碼方便對帳
            </p>
          </div>

          <div>
            <Label htmlFor="promotionText" className="text-sm font-medium">
              {t('tourEditDialog.promotionText')}
              <span className="text-foreground/40 font-normal ml-1">(選填)</span>
            </Label>
            <Input
              id="promotionText"
              value={editedData.promotionText || ""}
              onChange={(e) => setEditedData({ ...editedData, promotionText: e.target.value })}
              placeholder="早鳥優惠 / 限時 8 折 / 首發特價"
              className="mt-2"
            />
            <p className="text-[11px] text-foreground/50 mt-1.5">
              會顯示在行程卡片右上角的金色徽章上
            </p>
          </div>

          <div>
            <Label htmlFor="duration" className="text-sm font-medium">
              {t('tourEditDialog.duration')} <span className="text-red-500">*</span>
            </Label>
            <Input
              id="duration"
              type="number"
              min="1"
              value={editedData.duration ?? 1}
              onChange={(e) => setEditedData({ ...editedData, duration: parseInt(e.target.value) || 1 })}
              className="mt-2"
            />
            {/* Auto-show nights hint to reduce mental math */}
            <p className="text-[11px] text-foreground/50 mt-1.5">
              {(editedData.duration ?? 0) >= 2
                ? `共 ${editedData.duration} 天 ${Math.max(0, (editedData.duration ?? 1) - 1)} 晚`
                : '至少 1 天'}
            </p>
          </div>

          <div>
            <Label htmlFor="price" className="text-sm font-medium">
              {t('tourEditDialog.price')} <span className="text-red-500">*</span>
            </Label>
            <div className="flex gap-2 mt-2">
              <Input
                id="price"
                type="number"
                min="0"
                value={editedData.price ?? 0}
                onChange={(e) => setEditedData({ ...editedData, price: parseInt(e.target.value) || 0 })}
                className="flex-1 min-w-[140px]"
              />
              {/* Round 80.21: SelectTrigger now uses SelectValue so the
                  currency code is visible (was showing the placeholder
                  string "幣別" indefinitely). Added EUR/JPY/CNY/HKD
                  for multi-region support. */}
              <Select
                value={editedData.priceCurrency || 'TWD'}
                onValueChange={(value) => setEditedData({ ...editedData, priceCurrency: value })}
              >
                <SelectTrigger className="w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TWD">TWD 台幣</SelectItem>
                  <SelectItem value="USD">USD 美元</SelectItem>
                  <SelectItem value="EUR">EUR 歐元</SelectItem>
                  <SelectItem value="JPY">JPY 日圓</SelectItem>
                  <SelectItem value="CNY">CNY 人民幣</SelectItem>
                  <SelectItem value="HKD">HKD 港幣</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-foreground/50 mt-1.5">
              每人起價,顯示在行程卡片與詳情頁
            </p>
          </div>

          {/* Row: 手動修正 AI 抽取的人數與日期（修正提取錯誤） */}
          <div className="col-span-2 grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="maxParticipants" className="text-sm font-medium">
                {t('tourEditDialog.maxParticipantsLabel')}
              </Label>
              <Input
                id="maxParticipants"
                type="number"
                min="0"
                value={editedData.maxParticipants ?? ''}
                placeholder={t('tourEditDialog.maxParticipantsPlaceholder')}
                onChange={(e) => {
                  const v = e.target.value;
                  setEditedData({ ...editedData, maxParticipants: v === '' ? null : parseInt(v) || 0 });
                }}
                className="mt-2"
              />
              <p className="text-[11px] text-foreground/50 mt-1.5">
                每團上限,留白代表不限制
              </p>
            </div>
            <div>
              <Label htmlFor="startDate" className="text-sm font-medium">
                {t('tourEditDialog.startDate')}
              </Label>
              <Input
                id="startDate"
                type="date"
                value={editedData.startDate ? new Date(editedData.startDate).toISOString().slice(0, 10) : ''}
                onChange={(e) => {
                  const v = e.target.value;
                  // Round 80.21: when user picks a start date and no
                  // end date exists yet, auto-fill end = start + (天數-1).
                  // Saves a manual click 80% of the time. User can
                  // still override the end date afterwards.
                  const newStart = v ? new Date(v) : null;
                  let nextData: any = { ...editedData, startDate: newStart };
                  if (newStart && !editedData.endDate && (editedData.duration ?? 0) >= 1) {
                    const autoEnd = new Date(newStart);
                    autoEnd.setDate(autoEnd.getDate() + (editedData.duration - 1));
                    nextData.endDate = autoEnd;
                  }
                  setEditedData(nextData);
                }}
                className="mt-2"
              />
              <p className="text-[11px] text-foreground/50 mt-1.5">
                首發團出發日
              </p>
            </div>
            <div>
              <Label htmlFor="endDate" className="text-sm font-medium">
                {t('tourEditDialog.endDate')}
              </Label>
              <Input
                id="endDate"
                type="date"
                value={editedData.endDate ? new Date(editedData.endDate).toISOString().slice(0, 10) : ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setEditedData({ ...editedData, endDate: v ? new Date(v) : null });
                }}
                className="mt-2"
              />
              <p className="text-[11px] text-foreground/50 mt-1.5">
                {editedData.startDate && (editedData.duration ?? 0) >= 1
                  ? '可由出發日 + 天數自動算出'
                  : '末團返回日(若有)'}
              </p>
            </div>
          </div>

          <div className="col-span-2">
            <Label htmlFor="description" className="text-sm font-medium">
              {t('tourEditDialog.description')}
            </Label>
            <Textarea
              id="description"
              value={editedData.description || ""}
              onChange={(e) => setEditedData({ ...editedData, description: e.target.value })}
              rows={4}
              placeholder="2-3 句話介紹這個行程的特色與賣點"
              className="mt-2"
            />
            <div className="flex items-center justify-between mt-1.5">
              <p className="text-[11px] text-foreground/50">
                會顯示在 Hero 主圖下方,影響搜尋引擎收錄
              </p>
              <p className="text-[11px] text-foreground/50 tabular-nums">
                {(editedData.description || '').length} 字
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 space-y-4">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50 mb-4 pb-2 border-b border-foreground/5">{t('tourEditDialog.locationInfo')}</h3>

        <div className="grid grid-cols-2 gap-4">
          {/* Round 80.21 — AI placeholder cleanup:
              The agents sometimes write 「待確認」 / 「未知」 / 「Unknown」
              into fields they couldn't extract. The previous form
              rendered those as actual values (Jeff: 出發機場 顯示
              「待確認」 like data leak). Now we strip them on display
              so the input looks empty + shows a real placeholder
              hint, but we keep the saved value if user types into
              another field (so we don't accidentally erase real
              "待確認" the user genuinely wants). */}
          <div>
            <Label htmlFor="departureCity" className="text-sm font-medium">
              {t('tourEditDialog.departureCity')}
            </Label>
            <Input
              id="departureCity"
              value={isAiPlaceholder(editedData.departureCity) ? '' : (editedData.departureCity || '')}
              onChange={(e) => setEditedData({ ...editedData, departureCity: e.target.value })}
              placeholder="例如:台北 / TPE / 加州 LA"
              className="mt-2"
            />
          </div>

          <div>
            <Label htmlFor="departureAirportName" className="text-sm font-medium">
              {t('tourEditDialog.departureAirport')}
            </Label>
            <Input
              id="departureAirportName"
              value={isAiPlaceholder(editedData.departureAirportName) ? '' : (editedData.departureAirportName || '')}
              onChange={(e) => setEditedData({ ...editedData, departureAirportName: e.target.value })}
              placeholder="例如:桃園國際機場 TPE"
              className="mt-2"
            />
          </div>

          <div>
            <Label htmlFor="destinationCountry" className="text-sm font-medium">
              {t('tourEditDialog.destinationCountry')} <span className="text-red-500">*</span>
            </Label>
            <Input
              id="destinationCountry"
              value={isAiPlaceholder(editedData.destinationCountry) ? '' : (editedData.destinationCountry || '')}
              onChange={(e) => setEditedData({ ...editedData, destinationCountry: e.target.value })}
              placeholder="例如:瑞士 / 日本 / 美國"
              className="mt-2"
            />
          </div>

          <div>
            <Label htmlFor="destinationCity" className="text-sm font-medium">
              {t('tourEditDialog.destinationCity')}
            </Label>
            <Input
              id="destinationCity"
              value={isAiPlaceholder(editedData.destinationCity) ? '' : (editedData.destinationCity || '')}
              onChange={(e) => setEditedData({ ...editedData, destinationCity: e.target.value })}
              placeholder="例如:蘇黎世 / 東京 / 紐約"
              className="mt-2"
            />
          </div>
        </div>
      </div>

      {/* Round 80.22: Packpoint per-tour multiplier + commission cost
          calculator. Default 0.25x is the thin-margin safe rate; Jeff
          bumps to 1x/2x for promo tours. The estimated commission
          field is optional but unlocks the live cost-vs-margin
          preview when filled. */}
      <div className="bg-gradient-to-br from-[#c9a563]/8 to-foreground/[0.02] border border-[#c9a563]/30 rounded-xl p-6 space-y-4">
        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#8a6f3a] pb-2 border-b border-[#c9a563]/20">
            Packpoint 設定
          </h3>
          <p className="text-xs text-foreground/60 mt-2">
            控制此團發出多少 Packpoint。預設 0.25x(薄利安全)。做活動時調 1x / 2x。
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="pointsEarnRate" className="text-sm font-medium text-foreground">
              點數倍率
            </Label>
            <select
              id="pointsEarnRate"
              value={(editedData as any).pointsEarnRate ?? 25}
              onChange={(e) =>
                setEditedData({
                  ...editedData,
                  pointsEarnRate: parseInt(e.target.value, 10),
                } as any)
              }
              className="mt-2 w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus-visible:ring-2 focus-visible:ring-foreground/20"
            >
              <option value={0}>0x — 不發點數(虧本/促銷)</option>
              <option value={25}>0.25x — 薄利團(預設)</option>
              <option value={50}>0.5x — 標準</option>
              <option value={100}>1x — 活動</option>
              <option value={200}>2x — 雙倍特推</option>
            </select>
          </div>
          <div>
            <Label htmlFor="estimatedCommissionPct" className="text-sm font-medium text-foreground">
              預估 Commission %(選填)
            </Label>
            <Input
              id="estimatedCommissionPct"
              type="number"
              min={0}
              max={100}
              step="0.5"
              value={
                (editedData as any).estimatedCommissionPct != null
                  ? ((editedData as any).estimatedCommissionPct / 100).toFixed(1)
                  : ""
              }
              onChange={(e) => {
                const v = e.target.value;
                setEditedData({
                  ...editedData,
                  estimatedCommissionPct: v === "" ? null : Math.round(parseFloat(v) * 100),
                } as any);
              }}
              placeholder="例如 15"
              className="mt-2 rounded-lg focus-visible:ring-2 focus-visible:ring-foreground/20"
            />
            <p className="text-[10px] text-foreground/50 mt-1">填了才能看 cost vs profit</p>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={(editedData as any).excludeFromPackpoint ?? false}
                onChange={(e) =>
                  setEditedData({
                    ...editedData,
                    excludeFromPackpoint: e.target.checked,
                  } as any)
                }
                className="h-4 w-4 rounded border-foreground/30"
              />
              <span className="font-medium">完全排除此團</span>
            </label>
          </div>
        </div>
        {/* Live cost calculator — only when commission is filled */}
        {(() => {
          const rate = ((editedData as any).pointsEarnRate ?? 25) / 100;
          const commissionPct = (editedData as any).estimatedCommissionPct;
          const sample = 1000; // sample $1,000 booking
          const excluded = (editedData as any).excludeFromPackpoint;
          if (excluded) {
            return (
              <div className="text-xs bg-foreground/5 rounded-lg p-3 text-foreground/70">
                🚫 此團不發 Packpoint(commission 全保留)
              </div>
            );
          }
          const plusPoints = sample * 1 * 5 * rate;
          const conciergePoints = sample * 1 * 10 * rate;
          const plusCost = plusPoints / 100;
          const conciergeCost = conciergePoints / 100;
          const showProfit = commissionPct != null && commissionPct > 0;
          const commissionAmt = showProfit ? (sample * commissionPct) / 10000 : null;
          return (
            <div className="text-xs bg-foreground/5 rounded-lg p-3 space-y-1.5">
              <p className="font-semibold text-foreground/80">$1,000 訂單試算({rate}x):</p>
              <div className="grid grid-cols-2 gap-2 text-foreground/70">
                <div>Plus 客拿 <strong className="text-foreground">{plusPoints.toLocaleString()} pts</strong>(${plusCost.toFixed(2)})</div>
                <div>Concierge 客拿 <strong className="text-foreground">{conciergePoints.toLocaleString()} pts</strong>(${conciergeCost.toFixed(2)})</div>
              </div>
              {showProfit && commissionAmt != null && (
                <div className="pt-1 mt-1 border-t border-foreground/10 grid grid-cols-2 gap-2">
                  <div className={plusCost <= commissionAmt ? "text-green-700" : "text-red-700"}>
                    Plus 淨利:${(commissionAmt - plusCost).toFixed(2)} {plusCost <= commissionAmt ? "✓" : "⚠️ 虧本!"}
                  </div>
                  <div className={conciergeCost <= commissionAmt ? "text-green-700" : "text-red-700"}>
                    Concierge 淨利:${(commissionAmt - conciergeCost).toFixed(2)} {conciergeCost <= commissionAmt ? "✓" : "⚠️ 虧本!"}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* v78l Sprint 4A: Supplier contact for auto-notify on booking confirm */}
      <div className="bg-[#c9a563]/8 border border-[#c9a563]/20 rounded-xl p-6 space-y-4">
        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#8a6f3a] pb-2 border-b border-[#c9a563]/20">{t('tourEditDialog.supplierSection')}</h3>
          <p className="text-xs text-foreground/60 mt-2">
            {t('tourEditDialog.supplierSectionHint')}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="supplierName" className="text-sm font-medium text-foreground">
              {t('tourEditDialog.supplierName')}
            </Label>
            <Input
              id="supplierName"
              value={(editedData as any).supplierName || ""}
              onChange={(e) => setEditedData({ ...editedData, supplierName: e.target.value } as any)}
              placeholder={t('tourEditDialog.supplierNamePlaceholder')}
              className="mt-2 rounded-lg focus-visible:ring-2 focus-visible:ring-foreground/20"
            />
          </div>
          <div>
            <Label htmlFor="supplierEmail" className="text-sm font-medium text-foreground">
              {t('tourEditDialog.supplierEmail')}
            </Label>
            <Input
              id="supplierEmail"
              type="email"
              value={(editedData as any).supplierEmail || ""}
              onChange={(e) => setEditedData({ ...editedData, supplierEmail: e.target.value } as any)}
              placeholder={t('tourEditDialog.supplierEmailPlaceholder')}
              className="mt-2 rounded-lg focus-visible:ring-2 focus-visible:ring-foreground/20"
            />
          </div>
          <div>
            <Label htmlFor="supplierPhone" className="text-sm font-medium text-foreground">
              {t('tourEditDialog.supplierPhone')}
            </Label>
            <Input
              id="supplierPhone"
              value={(editedData as any).supplierPhone || ""}
              onChange={(e) => setEditedData({ ...editedData, supplierPhone: e.target.value } as any)}
              placeholder={t('tourEditDialog.supplierPhonePlaceholder')}
              className="mt-2 rounded-lg focus-visible:ring-2 focus-visible:ring-foreground/20"
            />
          </div>
          <div>
            <Label htmlFor="supplierNotes" className="text-sm font-medium text-foreground">
              {t('tourEditDialog.supplierNotes')}
            </Label>
            <Input
              id="supplierNotes"
              value={(editedData as any).supplierNotes || ""}
              onChange={(e) => setEditedData({ ...editedData, supplierNotes: e.target.value } as any)}
              placeholder={t('tourEditDialog.supplierNotesPlaceholder')}
              className="mt-2 rounded-lg focus-visible:ring-2 focus-visible:ring-foreground/20"
            />
          </div>
        </div>
      </div>

      <div className="bg-[#FAF8F2] border border-[#c9a563]/20 rounded-xl p-6 space-y-4">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#8a6f3a] mb-4 pb-2 border-b border-[#c9a563]/20">{t('tourEditDialog.heroImageSection')}</h3>

        <div className="space-y-4">
          <div>
            <Label htmlFor="heroImage" className="text-sm font-medium">
              {t('tourEditDialog.imageUrl')}
            </Label>
            <Input
              id="heroImage"
              value={editedData.heroImage || ""}
              onChange={(e) => setEditedData({ ...editedData, heroImage: e.target.value })}
              className="mt-2"
              placeholder="https://..."
            />
          </div>

          {editedData.heroImage && (
            <div className="relative rounded-lg overflow-hidden">
              <img
                src={editedData.heroImage}
                alt="Hero Preview"
                className="w-full h-48 object-cover rounded-lg"
              />
            </div>
          )}

          <div>
            <Label htmlFor="heroSubtitle" className="text-sm font-medium">
              {t('tourEditDialog.heroSubtitle')}
            </Label>
            <Input
              id="heroSubtitle"
              value={editedData.heroSubtitle || ""}
              onChange={(e) => setEditedData({ ...editedData, heroSubtitle: e.target.value })}
              className="mt-2"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
