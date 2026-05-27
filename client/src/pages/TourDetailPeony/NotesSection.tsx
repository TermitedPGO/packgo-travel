/**
 * TourDetailPeony / NotesSection.tsx
 *
 * Notes Section — preparation / documents / health / emergency / terms cards.
 * Extracted from TourDetailPeony.tsx v2 Wave 2 Module 2.8.
 */

import React from "react";
import {
  Luggage,
  FileText,
  Heart,
  PhoneCall,
  ChevronRight,
  Info,
  Building2,
} from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { detectSupplier, type getThemeColorByDestination } from "./helpers";

export type NotesSectionProps = {
  noticeDetailed: any;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
  sectionRef: React.RefObject<HTMLElement | null>;
  ensureArray: (val: any) => any[];
  sourceUrl?: string | null;
};

export default function NotesSection({
  noticeDetailed,
  themeColor,
  sectionRef,
  ensureArray,
  sourceUrl,
}: NotesSectionProps) {
  const { t } = useLocale();
  const supplier = detectSupplier(sourceUrl);

  return (
    <section ref={sectionRef} id="notes" className="py-16 lg:py-24 bg-gray-50">
      <div className="max-w-5xl mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-serif font-bold tracking-tight text-center mb-4" style={{ color: themeColor.primary }}>
          {t('tourDetail.notices')}
        </h2>
        <p className="text-lg text-gray-700 text-center mb-12">{t('tourDetail.noticesDesc')}</p>

        {/* Supplier Disclosure — shown at top of notices for Lion/UV tours */}
        {supplier && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-8">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                <Building2 className="h-5 w-5 text-amber-700" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
                  {supplier === 'lion'
                    ? t('tourDetail.supplierDisclosureLion')
                    : t('tourDetail.supplierDisclosureUv')}
                </p>
              </div>
            </div>
          </div>
        )}

        {noticeDetailed ? (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Preparation */}
            {noticeDetailed.preparation && ensureArray(noticeDetailed.preparation).length > 0 && (
              <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${themeColor.secondary}15` }}>
                    <Luggage className="h-5 w-5" style={{ color: themeColor.secondary }} />
                  </div>
                  <h3 className="text-lg font-bold">{t('tourDetail.preTrip')}</h3>
                </div>
                <ul className="space-y-2">
                  {ensureArray(noticeDetailed.preparation).map((item: string, index: number) => (
                    <li key={index} className="flex items-start gap-3 text-gray-600 text-sm">
                      <ChevronRight className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: themeColor.secondary }} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Documents */}
            {noticeDetailed.documents && ensureArray(noticeDetailed.documents).length > 0 && (
              <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${themeColor.secondary}15` }}>
                    <FileText className="h-5 w-5" style={{ color: themeColor.secondary }} />
                  </div>
                  <h3 className="text-lg font-bold">{t('tourDetail.documents')}</h3>
                </div>
                <ul className="space-y-2">
                  {ensureArray(noticeDetailed.documents).map((item: string, index: number) => (
                    <li key={index} className="flex items-start gap-3 text-gray-600 text-sm">
                      <ChevronRight className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: themeColor.secondary }} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Health */}
            {noticeDetailed.health && ensureArray(noticeDetailed.health).length > 0 && (
              <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${themeColor.secondary}15` }}>
                    <Heart className="h-5 w-5" style={{ color: themeColor.secondary }} />
                  </div>
                  <h3 className="text-lg font-bold">{t('tourDetail.health')}</h3>
                </div>
                <ul className="space-y-2">
                  {ensureArray(noticeDetailed.health).map((item: string, index: number) => (
                    <li key={index} className="flex items-start gap-3 text-gray-600 text-sm">
                      <ChevronRight className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: themeColor.secondary }} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Emergency Contact */}
            {noticeDetailed.emergency && ensureArray(noticeDetailed.emergency).length > 0 && (
              <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${themeColor.secondary}15` }}>
                    <PhoneCall className="h-5 w-5" style={{ color: themeColor.secondary }} />
                  </div>
                  <h3 className="text-lg font-bold">{t('tourDetail.emergency')}</h3>
                </div>
                <ul className="space-y-2">
                  {ensureArray(noticeDetailed.emergency).map((item: string, index: number) => (
                    <li key={index} className="flex items-start gap-3 text-gray-600 text-sm">
                      <ChevronRight className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: themeColor.secondary }} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Terms */}
            {noticeDetailed.terms && ensureArray(noticeDetailed.terms).length > 0 && (
              <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow md:col-span-2">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${themeColor.secondary}15` }}>
                    <Info className="h-5 w-5" style={{ color: themeColor.secondary }} />
                  </div>
                  <h3 className="text-lg font-bold">{t('tourDetail.terms')}</h3>
                </div>
                <ul className="grid md:grid-cols-2 gap-2">
                  {ensureArray(noticeDetailed.terms).map((item: string, index: number) => (
                    <li key={index} className="flex items-start gap-3 text-gray-600 text-sm">
                      <ChevronRight className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: themeColor.secondary }} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-700">
            <Info className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>{t('tourDetail.noticesAdvisor')}</p>
          </div>
        )}
      </div>
    </section>
  );
}
