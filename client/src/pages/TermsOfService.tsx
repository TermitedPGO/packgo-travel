import GenericPage from "@/components/GenericPage";
import { useLocale } from "@/contexts/LocaleContext";

/**
 * Terms of Service — Pack & Go, LLC
 *
 * Includes the mandatory disclosures required of a California registered
 * Seller of Travel under California Business & Professions Code
 * §§17550 – 17550.30, and the 9 itinerary-level disclosures enumerated
 * in "Disclosures From Sellers of Travel" (CA DOJ, 2015-08-28 rev.).
 *
 * The text below is PLAIN LANGUAGE reflecting the statutes; review by
 * licensed California counsel is still recommended before relying on
 * these terms in a contested transaction.
 */
export default function TermsOfService() {
  const { language } = useLocale();
  const isEn = language === "en";

  const T = isEn
    ? {
        title: "Terms of Service",
        subtitle: "The contract governing every booking with Pack & Go, LLC.",
        effective: "Effective date",
        intro:
          "These Terms of Service (the \"Terms\") govern your use of the website packgo-travel.fly.dev (the \"Site\") and any travel services booked through Pack & Go, LLC (\"Pack & Go\", \"we\", \"us\"). By booking a tour, submitting an inquiry, or creating an account, you agree to these Terms.",
        s1h: "1. Who we are",
        s1p: [
          "Pack & Go, LLC is a California limited liability company with its principal place of business at 39055 Cedar Blvd #126, Newark, CA 94560, USA.",
          "Newark Business License #115622 authorises Pack & Go to operate as a Travel Consultant, Customize Trip, and Air-Ticket provider.",
          "Pack & Go is a registered California Seller of Travel. Registration Number 2166984-40. Registration is valid January 4, 2026 through January 3, 2027 and is renewable annually. Registration as a seller of travel does not constitute approval by the State of California.",
        ],
        s2h: "2. Trust account & California Travel Consumer Restitution Fund (TCRF)",
        s2p: [
          "California law requires certain sellers of travel to have a trust account or bond. Pack & Go has a trust account at Bank of America, N.A.. All customer funds are deposited directly into that client trust account and are only withdrawn in compliance with California Business & Professions Code §17550.15.",
          "Pack & Go is a participant in the Travel Consumer Restitution Fund (TCRF). If you are a California resident and we fail to perform or refund, you may be entitled to file a claim against the TCRF.",
          "Claims must be filed with the Travel Consumer Restitution Corporation within twelve (12) months after the scheduled completion of travel. The maximum recovery per claimant is set by statute. Filing instructions are available at https://tcrcinfo.org.",
          "If you are NOT a California resident, this transaction is NOT covered by the TCRF.",
        ],
        s3h: "3. What we sell",
        s3p: [
          "Pack & Go sells packaged tours, custom itineraries, air tickets, hotel reservations, ground transfers, and travel-related visa consulting. On many itineraries we act solely as an intermediary between you and third-party suppliers (airlines, cruise lines, hotels, local operators). The ultimate provider of each component is identified on your itinerary and receipt.",
        ],
        s4h: "4. Booking, payment, and what your receipt will show",
        s4p: [
          "Each completed booking will be confirmed by a written itinerary or receipt that states, at minimum: (a) our business name, address, and telephone number; (b) the total amount you paid and any balance still due, itemised; (c) the provider of each air or sea transportation or travel service and the date, time, and place of each departure, or the conditions under which those will be determined; and (d) all terms, penalties, and cancellation conditions that apply to your booking.",
          "Payment is accepted by major credit card or bank transfer. Funds are deposited into the Pack & Go client trust account upon receipt.",
        ],
        s5h: "5. Cancellations & refunds",
        s5p: [
          "Upon cancellation of a transportation or travel service, all sums paid to Pack & Go for services that were not provided to the passenger will be promptly paid to the passenger, provided the passenger is not at fault and has not cancelled in violation of terms previously clearly and conspicuously disclosed to, and agreed to by, the passenger.",
          "Supplier-side penalties (airline change fees, non-refundable hotel nights, cruise-line cancellation charges) are passed through at cost and will be itemised on your refund statement.",
          "A written cancellation notice is required. Email to Jeffhsieh09@gmail.com constitutes valid written notice.",
        ],
        s6h: "6. Travel documents, insurance, and your responsibilities",
        s6p: [
          "You are responsible for holding a valid passport, any required visas, and any health certificates required by your destination. Pack & Go's visa consulting service is advisory; the issuing authority has sole discretion to grant or deny entry.",
          "Travel insurance (medical, trip-cancellation, baggage) is strongly recommended and is NOT included unless expressly purchased as an add-on.",
        ],
        s7h: "7. Limitation of liability",
        s7p: [
          "Except where Pack & Go acts as the principal provider of a service, our liability is limited to the amount you paid us for the affected booking. We are not liable for delays, injuries, losses, or damages caused by independent third-party suppliers, force majeure events, weather, acts of government, or any cause beyond our reasonable control.",
          "Nothing in these Terms limits any right you have under California law that cannot, as a matter of law, be waived.",
        ],
        s8h: "8. Intellectual property",
        s8p: [
          "All content on the Site — including text, AI-generated itineraries, photographs, logos, and trade dress — is owned by or licensed to Pack & Go, LLC. You may view and print itineraries for personal, non-commercial use; any other reproduction requires our written permission.",
        ],
        s9h: "9. Governing law & dispute resolution",
        s9p: [
          "These Terms are governed by the laws of the State of California, without regard to conflict-of-laws principles. Any dispute shall be resolved in the state or federal courts located in Alameda County, California, and you consent to personal jurisdiction there.",
          "Small-claims matters may be brought in the small-claims court for Alameda County.",
        ],
        s10h: "10. Changes to these Terms",
        s10p: [
          "We may update these Terms from time to time. Material changes will be announced on this page with an updated effective date. Continued use of the Site after the effective date constitutes acceptance of the revised Terms.",
        ],
        s11h: "11. Contact",
        s11p: [
          "Pack & Go, LLC · 39055 Cedar Blvd #126, Newark, CA 94560 · +1 (510) 634-2307 · Jeffhsieh09@gmail.com",
        ],
      }
    : {
        title: "服務條款",
        subtitle: "與 Pack & Go, LLC 所有訂單之契約依據。",
        effective: "生效日期",
        intro:
          "本服務條款（下稱「本條款」）規範您使用 packgo-travel.fly.dev 網站（下稱「本網站」）及透過 Pack & Go, LLC（下稱「本公司」、「我們」）預訂之任何旅遊服務。一旦您下單、送出諮詢或建立會員，即視為接受本條款。",
        s1h: "一、公司資訊",
        s1p: [
          "Pack & Go, LLC 為依加州法律成立之有限責任公司，主事務所設於 39055 Cedar Blvd #126, Newark, CA 94560, USA。",
          "Newark 市商業執照 #115622 授權本公司經營旅遊顧問（Travel Consultant）、客製化行程（Customize Trip）及機票（Air-Ticket）業務。",
          "本公司為合法登記之加州旅遊業者（California Seller of Travel），登記證號 2166984-40，登記有效期間 2026 年 1 月 4 日至 2027 年 1 月 3 日，每年得續登記。旅遊業者登記不代表加州政府之背書。",
        ],
        s2h: "二、信託帳戶與加州旅客消費補償基金（TCRF）",
        s2p: [
          "加州法律要求特定旅遊業者持有信託帳戶或履約保證。本公司於 Bank of America, N.A. 開立客戶信託帳戶。所有旅客款項均直接存入該信託帳戶，並僅依加州 B&P §17550.15 規定提領。",
          "本公司為加州旅客消費補償基金（TCRF）之參與者。若您為加州居民且本公司未履行服務或未退款，您可對 TCRF 提出理賠申請。",
          "理賠須於原定行程結束後 12 個月內向 Travel Consumer Restitution Corporation 提出；單一理賠上限依法規定。申請說明詳見 https://tcrcinfo.org。",
          "若您並非加州居民，本交易不受 TCRF 保障。",
        ],
        s3h: "三、我們的銷售內容",
        s3p: [
          "本公司銷售包套行程、客製化行程、機票、飯店、接送與簽證顧問服務。於多數行程中，本公司僅為您與第三方供應商（航空公司、郵輪公司、飯店、當地營運商）之中介。實際供應商將於您的行程單／收據上具名。",
        ],
        s4h: "四、訂購、付款與收據揭露",
        s4p: [
          "每一筆確認訂單，本公司將以書面行程單或收據揭露下列資訊：(a) 本公司商號、地址與電話；(b) 您已付金額與尚餘款項之項目化明細；(c) 各航空／海運／旅遊服務之實際提供者，及每次出發之日期、時間、地點（或該等資訊之決定條件）；(d) 所有適用之條款、罰款及取消條件。",
          "付款方式包括主要信用卡與銀行轉帳。款項收妥後立即存入本公司客戶信託帳戶。",
        ],
        s5h: "五、取消與退款",
        s5p: [
          "於取消運送或旅遊服務後，凡已付予本公司但未實際提供之服務款項，將即時退還旅客；但旅客須非有責方，且未違反事前已清楚揭露並經旅客同意之條款。",
          "供應商端之罰款（航空公司改票費、不可退訂飯店、郵輪取消罰金等）將依實際金額轉嫁，並於退款明細中項目化列出。",
          "須以書面通知取消。寄至 Jeffhsieh09@gmail.com 之電子郵件視為有效書面通知。",
        ],
        s6h: "六、證件、保險與旅客責任",
        s6p: [
          "旅客應自行持有有效護照、目的地所要求之簽證及健康證明。本公司之簽證顧問服務僅為協助性質，是否核發簽證之最終裁量權屬於簽證核發機關。",
          "旅遊保險（醫療、取消、行李）強烈建議投保，但除非另行加購，否則不包含於行程費用中。",
        ],
        s7h: "七、責任限制",
        s7p: [
          "除本公司為服務主體提供者外，本公司之責任以您支付予本公司之該筆訂單金額為上限。對於因獨立第三方供應商、不可抗力、天候、政府行為或其他本公司合理控制範圍外之事由所致之延誤、傷害、損失或損害，本公司不負責任。",
          "本條款不限制加州法律中依法不得拋棄之任何旅客權利。",
        ],
        s8h: "八、智慧財產權",
        s8p: [
          "本網站之所有內容——包含文字、AI 生成之行程、圖片、商標與商業外觀——均為 Pack & Go, LLC 所有或取得授權。您得為個人非商業目的瀏覽及列印行程單；其餘任何重製須事先取得本公司書面同意。",
        ],
        s9h: "九、準據法與管轄",
        s9p: [
          "本條款以美國加州法律為準據法，不適用其衝突法則。任何爭議應於加州 Alameda 郡之州法院或聯邦法院解決，您同意接受該法院之管轄。",
          "小額訴訟得於加州 Alameda 郡小額訴訟法庭提起。",
        ],
        s10h: "十、條款修訂",
        s10p: [
          "本公司得不時更新本條款。重大變更將於本頁揭示並更新生效日。您於新生效日後繼續使用本網站，即視為接受修訂後之條款。",
        ],
        s11h: "十一、聯絡我們",
        s11p: [
          "Pack & Go, LLC · 39055 Cedar Blvd #126, Newark, CA 94560, USA · +1 (510) 634-2307 · Jeffhsieh09@gmail.com",
        ],
      };

  const Section = ({ h, p }: { h: string; p: string[] }) => (
    <>
      <h2 className="text-2xl font-bold text-black mt-8">{h}</h2>
      {p.map((para, i) => (
        <p key={i} className="mt-3 leading-relaxed">
          {para}
        </p>
      ))}
    </>
  );

  return (
    <GenericPage title={T.title} subtitle={T.subtitle}>
      <div className="space-y-4 text-gray-700 max-w-4xl">
        <p className="text-sm text-gray-500">
          {T.effective}: 2026-04-18
        </p>

        <p className="leading-relaxed">{T.intro}</p>

        <Section h={T.s1h} p={T.s1p} />
        <Section h={T.s2h} p={T.s2p} />
        <Section h={T.s3h} p={T.s3p} />
        <Section h={T.s4h} p={T.s4p} />
        <Section h={T.s5h} p={T.s5p} />
        <Section h={T.s6h} p={T.s6p} />
        <Section h={T.s7h} p={T.s7p} />
        <Section h={T.s8h} p={T.s8p} />
        <Section h={T.s9h} p={T.s9p} />
        <Section h={T.s10h} p={T.s10p} />
        <Section h={T.s11h} p={T.s11p} />

        <div className="mt-12 rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-600">
          <p>
            {isEn
              ? "Seller of Travel Program · Office of the Attorney General · 300 South Spring Street, Suite 1702, Los Angeles, CA 90013 · (213) 269-6564 · sellers.travel@doj.ca.gov · https://oag.ca.gov/travel"
              : "加州旅遊業者計畫 · 加州檢察總長辦公室 · 300 South Spring Street, Suite 1702, Los Angeles, CA 90013 · (213) 269-6564 · sellers.travel@doj.ca.gov · https://oag.ca.gov/travel"}
          </p>
        </div>
      </div>
    </GenericPage>
  );
}
