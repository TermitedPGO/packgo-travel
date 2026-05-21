/**
 * v2 Wave 2 Module 2.12 — Transport tab.
 *
 * Verbatim JSX extraction from TourEditDialog L1402-1798. State pulled from
 * the shared edit context. Per-type subforms (FLIGHT / TRAIN / CRUISE / BUS
 * / CAR) preserved exactly — type inference logic at parse time stays in
 * the context.
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
import { Plane, Train, Ship, Bus, Car } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { useTourEdit } from "./_context";

export default function TransportTab() {
  const { t } = useLocale();
  const { editedData, setEditedData } = useTourEdit();

  return (
    <div className="mt-0 space-y-6">
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 space-y-6">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50 mb-4 pb-2 border-b border-foreground/5">{t('tourEditDialog.transportSettings')}</h3>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <Label className="text-sm font-medium">{t('tourEditDialog.transportType')}</Label>
            <Select
              value={editedData.flights?.type || 'FLIGHT'}
              onValueChange={(value) => setEditedData({
                ...editedData,
                flights: { ...editedData.flights, type: value }
              })}
            >
              <SelectTrigger className="mt-2">
                <SelectValue placeholder={t('tourEditDialog.selectTransportType')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FLIGHT">
                  <div className="flex items-center gap-2">
                    <Plane className="h-4 w-4" />
                    {t('tourEditDialog.transportFlight')}
                  </div>
                </SelectItem>
                <SelectItem value="TRAIN">
                  <div className="flex items-center gap-2">
                    <Train className="h-4 w-4" />
                    {t('tourEditDialog.transportTrain')}
                  </div>
                </SelectItem>
                <SelectItem value="CRUISE">
                  <div className="flex items-center gap-2">
                    <Ship className="h-4 w-4" />
                    {t('tourEditDialog.transportCruise')}
                  </div>
                </SelectItem>
                <SelectItem value="BUS">
                  <div className="flex items-center gap-2">
                    <Bus className="h-4 w-4" />
                    {t('tourEditDialog.transportBus')}
                  </div>
                </SelectItem>
                <SelectItem value="CAR">
                  <div className="flex items-center gap-2">
                    <Car className="h-4 w-4" />
                    {t('tourEditDialog.transportCar')}
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-sm font-medium">{t('tourEditDialog.transportName')}</Label>
            <Input
              value={editedData.flights?.typeName || ''}
              onChange={(e) => setEditedData({
                ...editedData,
                flights: { ...editedData.flights, typeName: e.target.value }
              })}
              className="mt-2"
              placeholder={t('tourEditDialog.transportNamePlaceholder')}
            />
          </div>
        </div>

        {/* 火車詳細資訊 */}
        {editedData.flights?.type === 'TRAIN' && (
          <div className="bg-white rounded-lg p-4 space-y-4 border border-gray-200">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50 pb-2 border-b border-foreground/5">{t('tourEditDialog.trainDetails')}</h4>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">{t('tourEditDialog.trainName')}</Label>
                <Input
                  value={editedData.flights?.trainName || ''}
                  onChange={(e) => setEditedData({
                    ...editedData,
                    flights: { ...editedData.flights, trainName: e.target.value }
                  })}
                  className="mt-2"
                  placeholder={t('tourEditDialog.trainNamePlaceholder')}
                />
              </div>
              <div>
                <Label className="text-sm font-medium">{t('tourEditDialog.trainType')}</Label>
                <Input
                  value={editedData.flights?.trainType || ''}
                  onChange={(e) => setEditedData({
                    ...editedData,
                    flights: { ...editedData.flights, trainType: e.target.value }
                  })}
                  className="mt-2"
                  placeholder={t('tourEditDialog.trainTypePlaceholder')}
                />
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium">{t('tourEditDialog.trainDesc')}</Label>
              <Textarea
                value={editedData.flights?.description || ''}
                onChange={(e) => setEditedData({
                  ...editedData,
                  flights: { ...editedData.flights, description: e.target.value }
                })}
                className="mt-2"
                rows={3}
                placeholder={t('tourEditDialog.trainDescPlaceholder')}
              />
            </div>

            <div>
              <Label className="text-sm font-medium">{t('tourEditDialog.trainFeatures')}</Label>
              <Textarea
                value={editedData.flights?.features?.join('\n') || ''}
                onChange={(e) => setEditedData({
                  ...editedData,
                  flights: { ...editedData.flights, features: e.target.value.split('\n').filter((f: string) => f.trim()) }
                })}
                className="mt-2"
                rows={4}
                placeholder={t('tourEditDialog.trainFeaturesPlaceholder')}
              />
            </div>

            <div>
              <Label className="text-sm font-medium">{t('tourEditDialog.trainRoute')}</Label>
              <Textarea
                value={editedData.flights?.route?.join('\n') || ''}
                onChange={(e) => setEditedData({
                  ...editedData,
                  flights: { ...editedData.flights, route: e.target.value.split('\n').filter((r: string) => r.trim()) }
                })}
                className="mt-2"
                rows={4}
                placeholder={t('tourEditDialog.trainRoutePlaceholder')}
              />
            </div>
          </div>
        )}

        {/* 郵輪詳細資訊 */}
        {editedData.flights?.type === 'CRUISE' && (
          <div className="bg-white rounded-lg p-4 space-y-4 border border-gray-200">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50 pb-2 border-b border-foreground/5">{t('tourEditDialog.cruiseDetails')}</h4>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">{t('tourEditDialog.shipName')}</Label>
                <Input
                  value={editedData.flights?.shipName || ''}
                  onChange={(e) => setEditedData({
                    ...editedData,
                    flights: { ...editedData.flights, shipName: e.target.value }
                  })}
                  className="mt-2"
                  placeholder={t('tourEditDialog.shipNamePlaceholder')}
                />
              </div>
              <div>
                <Label className="text-sm font-medium">{t('tourEditDialog.cruiseRoute')}</Label>
                <Input
                  value={editedData.flights?.cruiseRoute || ''}
                  onChange={(e) => setEditedData({
                    ...editedData,
                    flights: { ...editedData.flights, cruiseRoute: e.target.value }
                  })}
                  className="mt-2"
                  placeholder={t('tourEditDialog.cruiseRoutePlaceholder')}
                />
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium">{t('tourEditDialog.cruiseDesc')}</Label>
              <Textarea
                value={editedData.flights?.description || ''}
                onChange={(e) => setEditedData({
                  ...editedData,
                  flights: { ...editedData.flights, description: e.target.value }
                })}
                className="mt-2"
                rows={3}
                placeholder={t('tourEditDialog.cruiseDescPlaceholder')}
              />
            </div>

            <div>
              <Label className="text-sm font-medium">{t('tourEditDialog.cruiseFacilities')}</Label>
              <Textarea
                value={editedData.flights?.features?.join('\n') || ''}
                onChange={(e) => setEditedData({
                  ...editedData,
                  flights: { ...editedData.flights, features: e.target.value.split('\n').filter((f: string) => f.trim()) }
                })}
                className="mt-2"
                rows={4}
                placeholder={t('tourEditDialog.cruiseFacilitiesPlaceholder')}
              />
            </div>
          </div>
        )}

        {/* 飛機詳細資訊 */}
        {editedData.flights?.type === 'FLIGHT' && (
          <div className="bg-white rounded-lg p-4 space-y-4 border border-gray-200">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50 pb-2 border-b border-foreground/5">{t('tourEditDialog.flightDetails')}</h4>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">{t('tourEditDialog.airline')}</Label>
                <Input
                  value={editedData.flights?.airline || ''}
                  onChange={(e) => setEditedData({
                    ...editedData,
                    flights: { ...editedData.flights, airline: e.target.value }
                  })}
                  className="mt-2"
                  placeholder={t('tourEditDialog.airlinePlaceholder')}
                />
              </div>
              <div>
                <Label className="text-sm font-medium">{t('tourEditDialog.flightNumber')}</Label>
                <Input
                  value={editedData.flights?.flightNumber || ''}
                  onChange={(e) => setEditedData({
                    ...editedData,
                    flights: { ...editedData.flights, flightNumber: e.target.value }
                  })}
                  className="mt-2"
                  placeholder={t('tourEditDialog.flightNumberPlaceholder')}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">{t('tourEditDialog.outboundDeparture')}</Label>
                <Input
                  value={editedData.flights?.outbound?.departureTime || ''}
                  onChange={(e) => setEditedData({
                    ...editedData,
                    flights: {
                      ...editedData.flights,
                      outbound: { ...editedData.flights?.outbound, departureTime: e.target.value }
                    }
                  })}
                  className="mt-2"
                  placeholder={t('tourEditDialog.outboundDeparturePlaceholder')}
                />
              </div>
              <div>
                <Label className="text-sm font-medium">{t('tourEditDialog.outboundArrival')}</Label>
                <Input
                  value={editedData.flights?.outbound?.arrivalTime || ''}
                  onChange={(e) => setEditedData({
                    ...editedData,
                    flights: {
                      ...editedData.flights,
                      outbound: { ...editedData.flights?.outbound, arrivalTime: e.target.value }
                    }
                  })}
                  className="mt-2"
                  placeholder={t('tourEditDialog.outboundArrivalPlaceholder')}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">{t('tourEditDialog.inboundDeparture')}</Label>
                <Input
                  value={editedData.flights?.inbound?.departureTime || ''}
                  onChange={(e) => setEditedData({
                    ...editedData,
                    flights: {
                      ...editedData.flights,
                      inbound: { ...editedData.flights?.inbound, departureTime: e.target.value }
                    }
                  })}
                  className="mt-2"
                  placeholder={t('tourEditDialog.inboundDeparturePlaceholder')}
                />
              </div>
              <div>
                <Label className="text-sm font-medium">{t('tourEditDialog.inboundArrival')}</Label>
                <Input
                  value={editedData.flights?.inbound?.arrivalTime || ''}
                  onChange={(e) => setEditedData({
                    ...editedData,
                    flights: {
                      ...editedData.flights,
                      inbound: { ...editedData.flights?.inbound, arrivalTime: e.target.value }
                    }
                  })}
                  className="mt-2"
                  placeholder={t('tourEditDialog.inboundArrivalPlaceholder')}
                />
              </div>
            </div>
          </div>
        )}

        {/* 巴士詳細資訊 */}
        {editedData.flights?.type === 'BUS' && (
          <div className="bg-white rounded-lg p-4 space-y-4 border border-gray-200">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50 pb-2 border-b border-foreground/5">{t('tourEditDialog.busDetails')}</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">{t('tourEditDialog.busCompany')}</Label>
                <Input
                  value={editedData.flights?.busCompany || ''}
                  onChange={(e) => setEditedData({
                    ...editedData,
                    flights: { ...editedData.flights, busCompany: e.target.value }
                  })}
                  className="mt-2"
                  placeholder={t('tourEditDialog.busCompanyPlaceholder')}
                />
              </div>
              <div>
                <Label className="text-sm font-medium">{t('tourEditDialog.busRoute')}</Label>
                <Input
                  value={editedData.flights?.busRoute || ''}
                  onChange={(e) => setEditedData({
                    ...editedData,
                    flights: { ...editedData.flights, busRoute: e.target.value }
                  })}
                  className="mt-2"
                  placeholder={t('tourEditDialog.busRoutePlaceholder')}
                />
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium">{t('tourEditDialog.busDesc')}</Label>
              <Textarea
                value={editedData.flights?.description || ''}
                onChange={(e) => setEditedData({
                  ...editedData,
                  flights: { ...editedData.flights, description: e.target.value }
                })}
                className="mt-2"
                rows={3}
                placeholder={t('tourEditDialog.busDescPlaceholder')}
              />
            </div>
          </div>
        )}

        {/* 自駕/租車詳細資訊 */}
        {editedData.flights?.type === 'CAR' && (
          <div className="bg-white rounded-lg p-4 space-y-4 border border-gray-200">
            <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50 pb-2 border-b border-foreground/5">{t('tourEditDialog.carDetails')}</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">{t('tourEditDialog.carType')}</Label>
                <Input
                  value={editedData.flights?.carType || ''}
                  onChange={(e) => setEditedData({
                    ...editedData,
                    flights: { ...editedData.flights, carType: e.target.value }
                  })}
                  className="mt-2"
                  placeholder={t('tourEditDialog.carTypePlaceholder')}
                />
              </div>
              <div>
                <Label className="text-sm font-medium">{t('tourEditDialog.carCompany')}</Label>
                <Input
                  value={editedData.flights?.carCompany || ''}
                  onChange={(e) => setEditedData({
                    ...editedData,
                    flights: { ...editedData.flights, carCompany: e.target.value }
                  })}
                  className="mt-2"
                  placeholder={t('tourEditDialog.carCompanyPlaceholder')}
                />
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium">{t('tourEditDialog.carDesc')}</Label>
              <Textarea
                value={editedData.flights?.description || ''}
                onChange={(e) => setEditedData({
                  ...editedData,
                  flights: { ...editedData.flights, description: e.target.value }
                })}
                className="mt-2"
                rows={3}
                placeholder={t('tourEditDialog.carDescPlaceholder')}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
