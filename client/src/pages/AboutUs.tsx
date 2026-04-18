import GenericPage from "@/components/GenericPage";
import { useLocale } from "@/contexts/LocaleContext";

export default function AboutUs() {
  const { t, language } = useLocale();
  const isEn = language === "en";

  return (
    <GenericPage
      title={t('aboutUs.title')}
      subtitle={t('aboutUs.subtitle')}
    >
      <div className="space-y-6 text-gray-700 max-w-4xl">
        <p className="text-lg">
          {t('aboutUs.intro')}
        </p>

        <h2 className="text-2xl font-bold text-black mt-8">{t('aboutUs.mission.title')}</h2>
        <p>
          {t('aboutUs.mission.content')}
        </p>

        <h2 className="text-2xl font-bold text-black mt-8">{t('aboutUs.servicesTitle')}</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>{t('aboutUs.servicesList.customTours')}</li>
          <li>{t('aboutUs.servicesList.visaServices')}</li>
          <li>{t('aboutUs.servicesList.groupPackages')}</li>
          <li>{t('aboutUs.servicesList.flightBooking')}</li>
          <li>{t('aboutUs.servicesList.airportTransfer')}</li>
          <li>{t('aboutUs.servicesList.hotelBooking')}</li>
        </ul>

        <h2 className="text-2xl font-bold text-black mt-8">
          {isEn ? "Licences & Credentials" : "證照與登記"}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
              {isEn ? "Legal Entity" : "法律主體"}
            </p>
            <p className="font-semibold text-black">Pack & Go, LLC</p>
            <p className="text-sm text-gray-600 mt-1">
              {isEn
                ? "California limited liability company"
                : "依加州法律設立之有限責任公司"}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
              {isEn ? "City Business Licence" : "市政商業執照"}
            </p>
            <p className="font-semibold text-black">Newark #115622</p>
            <p className="text-sm text-gray-600 mt-1">
              {isEn
                ? "Travel Consultant · Customize Trip · Air-Ticket · Effective through Dec 31, 2026"
                : "旅遊顧問・客製行程・機票業務・效期至 2026-12-31"}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
              {isEn ? "California Seller of Travel" : "加州旅遊業者登記"}
            </p>
            <p className="font-semibold text-black">CST #2166984-40</p>
            <p className="text-sm text-gray-600 mt-1">
              {isEn
                ? "Valid Jan 4, 2026 – Jan 3, 2027. Registration as a seller of travel does not constitute approval by the State of California."
                : "效期 2026-01-04 至 2027-01-03。本登記不代表加州政府之背書。"}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
              {isEn ? "Consumer Protection" : "旅客保障"}
            </p>
            <p className="font-semibold text-black">
              {isEn ? "TCRF Participant" : "TCRF 參與者"}
            </p>
            <p className="text-sm text-gray-600 mt-1">
              {isEn
                ? "Client trust account held at Bank of America, N.A. per CA B&P §17550.15."
                : "依加州 B&P §17550.15 於 Bank of America, N.A. 開立客戶信託帳戶。"}
            </p>
          </div>
        </div>

        <h2 className="text-2xl font-bold text-black mt-8">{t('aboutUs.contactTitle')}</h2>
        <p>
          <strong>{t('aboutUs.address')}：</strong>39055 Cedar Blvd #126, Newark, CA 94560, USA<br />
          <strong>{t('aboutUs.phone')}：</strong>+1 (510) 634-2307<br />
          <strong>{t('aboutUs.email')}：</strong>Jeffhsieh09@gmail.com
        </p>
      </div>
    </GenericPage>
  );
}
