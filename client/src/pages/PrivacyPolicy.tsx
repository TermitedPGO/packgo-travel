import GenericPage from "@/components/GenericPage";
import { useLocale } from "@/contexts/LocaleContext";
import { Link } from "wouter";

/**
 * Privacy Policy — Pack & Go, LLC
 *
 * Drafted to satisfy the California Consumer Privacy Act (CCPA) as amended
 * by the California Privacy Rights Act (CPRA), Cal. Civ. Code §§1798.100
 * et seq., including the 9 enumerated consumer rights and the mandatory
 * categorical notice at collection.
 *
 * Review by licensed counsel is recommended before relying on this text
 * in a regulatory inquiry.
 */
export default function PrivacyPolicy() {
  const { language } = useLocale();
  const isEn = language === "en";

  const T = isEn
    ? {
        title: "Privacy Policy",
        subtitle: "How Pack & Go, LLC collects, uses, and protects your personal information.",
        effective: "Effective date",
        intro:
          "This Privacy Policy describes how Pack & Go, LLC (\"Pack & Go\", \"we\", \"us\") collects and processes personal information about visitors to packgo09.manus.space (the \"Site\") and customers of our travel services. It also explains the rights available to California residents under the California Consumer Privacy Act (CCPA), as amended by the California Privacy Rights Act (CPRA).",
        s1h: "1. Categories of personal information we collect",
        s1intro:
          "In the last 12 months we have collected the following categories of personal information, as those categories are defined in Cal. Civ. Code §1798.140:",
        s1list: [
          "Identifiers — name, email address, postal address, telephone number, IP address, online account identifier.",
          "Customer records — billing address, booking history, travel preferences, passport number (only when required to issue tickets or visas; stored encrypted, deleted within 30 days of trip completion unless retention is required by law).",
          "Commercial information — products and services purchased, cancellation history.",
          "Internet activity — pages viewed, referring URL, approximate device and browser type, anonymised analytics via Plausible and Google Tag Manager.",
          "Geolocation — approximate city/country inferred from IP (never precise GPS).",
          "Inferences — rough interest profile used to personalise itinerary suggestions.",
        ],
        s1note:
          "We do NOT collect Social Security numbers, driver's licence numbers, biometric data, health records, or precise geolocation. We do NOT collect information about children under 16.",
        s2h: "2. How we use your information",
        s2list: [
          "To create and fulfil your bookings, including issuing tickets and visas.",
          "To communicate with you about your itinerary, changes, and customer support.",
          "To deposit funds into our client trust account at Bank of America, N.A. in compliance with California Business & Professions Code §17550.15.",
          "To improve the Site and our AI-generated itinerary engine (aggregated, de-identified data only).",
          "To detect, prevent, and investigate fraud, security incidents, and violations of our Terms.",
          "To comply with legal obligations, including tax and California Seller of Travel (CST #2166984-40) recordkeeping.",
        ],
        s3h: "3. Sale or sharing of personal information",
        s3p:
          "Pack & Go does NOT sell your personal information for money, and has not done so in the preceding 12 months. We also do NOT share your personal information for cross-context behavioural advertising. Because we do not sell or share, the CPRA \"Do Not Sell or Share My Personal Information\" mechanism is not operationally applicable; however, you may still submit such a request below and we will honour it.",
        s4h: "4. Your rights as a California resident",
        s4intro:
          "Under CCPA/CPRA you have the right to:",
        s4list: [
          "Know what personal information we have collected about you.",
          "Access a portable copy of that information.",
          "Correct inaccurate personal information.",
          "Delete personal information we hold, subject to statutory exceptions (e.g., bookings subject to CA B&P §17550 recordkeeping).",
          "Opt out of sale or sharing (inapplicable — we do neither).",
          "Limit use of sensitive personal information.",
          "Not receive retaliatory service or pricing for exercising these rights.",
          "Designate an authorised agent to exercise these rights on your behalf.",
          "Appeal the denial of a request to the California Privacy Protection Agency.",
        ],
        s4how:
          "To exercise any of these rights, email privacy@packandgo.com (or Jeffhsieh09@gmail.com during our transition to a dedicated privacy mailbox). We will verify your identity and respond within 45 days, as required by §1798.130.",
        s5h: "5. Data retention",
        s5list: [
          "Booking records: 7 years (tax and CA DOJ recordkeeping requirements).",
          "Marketing email list: until you unsubscribe.",
          "Passport scans: deleted within 30 days of trip completion unless required for dispute resolution.",
          "Analytics logs: 12 months, de-identified.",
        ],
        s6h: "6. Cookies and similar technologies",
        s6p:
          "We use a small number of cookies that are strictly necessary to operate the Site (session, cart, language). Optional cookies for analytics (Plausible, Google Tag Manager) are loaded only after you affirmatively accept them through our cookie banner. You may withdraw consent at any time by clicking \"Cookie preferences\" in the footer.",
        s7h: "7. Third parties with whom we share information",
        s7list: [
          "Payment processor — for charging your card.",
          "Bank of America, N.A. — holder of our client trust account.",
          "Airlines, hotels, and local operators — only the minimum data needed to issue your ticket or reservation.",
          "Plausible Analytics & Google Analytics — aggregated Site usage statistics.",
          "Government authorities — when compelled by subpoena or legal process.",
        ],
        s8h: "8. International transfers",
        s8p:
          "Pack & Go is headquartered in California. If you book travel outside the United States, the minimum personal information needed to fulfil that booking will be transferred to suppliers in the destination country.",
        s9h: "9. Security",
        s9p:
          "We use HTTPS, encryption at rest for sensitive identifiers, role-based access control, and annual vendor reviews. No system is perfectly secure; if we ever suffer a breach of your personal information, we will notify you in accordance with Cal. Civ. Code §1798.82.",
        s10h: "10. Children",
        s10p:
          "The Site is not directed to children under 16. We do not knowingly collect personal information from children under 16. If you believe we have, please email privacy@packandgo.com and we will delete it.",
        s11h: "11. Changes",
        s11p:
          "We will post any update here with a new effective date. If the change is material, we will also notify active customers by email.",
        s12h: "12. Contact",
        s12p:
          "Pack & Go, LLC · Attn: Privacy Officer · 39055 Cedar Blvd #126, Newark, CA 94560 · Jeffhsieh09@gmail.com",
      }
    : {
        title: "隱私權政策",
        subtitle: "Pack & Go, LLC 如何蒐集、使用並保護您的個人資料。",
        effective: "生效日期",
        intro:
          "本隱私權政策說明 Pack & Go, LLC（下稱「本公司」）如何蒐集與處理您造訪 packgo09.manus.space（下稱「本網站」）及使用本公司旅遊服務時之個人資料，並載明加州居民依加州消費者隱私法（CCPA，經 CPRA 修正）所享有之權利。",
        s1h: "一、蒐集之個人資料類別",
        s1intro:
          "過去 12 個月內，本公司依加州民法 §1798.140 所列類別蒐集下列個人資料：",
        s1list: [
          "識別資料——姓名、電郵、地址、電話、IP 位址、線上帳號識別碼。",
          "顧客記錄——帳單地址、訂購紀錄、旅遊偏好、護照號碼（僅於開立機票／簽證所需；加密儲存，行程結束後 30 天內刪除，法令另有保存期限者除外）。",
          "商業資料——所購商品與服務、取消紀錄。",
          "網路活動——瀏覽頁面、來源網址、裝置及瀏覽器約略類型、匿名化統計（Plausible、Google Tag Manager）。",
          "地理位置——依 IP 推定之城市／國家（不蒐集精確 GPS）。",
          "推論資料——用以個人化推薦行程之粗略興趣輪廓。",
        ],
        s1note:
          "本公司不蒐集社會安全號碼、駕照號碼、生物特徵、健康紀錄或精確地理位置。本公司亦不蒐集 16 歲以下兒童之資料。",
        s2h: "二、資料使用目的",
        s2list: [
          "建立並履行您的訂單，包括開立機票與簽證。",
          "就行程、異動及客戶服務與您聯絡。",
          "將款項存入 Bank of America, N.A. 之客戶信託帳戶，以符合加州 B&P §17550.15。",
          "改善本網站及 AI 行程生成引擎（僅使用彙總去識別資料）。",
          "偵測、預防及調查詐欺、資安事件及違反本條款之行為。",
          "遵循法令義務，包括稅務及加州旅遊業者（CST #2166984-40）之紀錄保存。",
        ],
        s3h: "三、資料之出售或分享",
        s3p:
          "本公司不出售您的個人資料以換取金錢，過去 12 個月亦未為之。本公司亦不為跨情境行為廣告而分享您的個人資料。因本公司並不出售或分享，CPRA 所稱「請勿出售或分享我的個人資料」機制並不實際適用；惟您仍得依下列方式提出請求，本公司將予尊重。",
        s4h: "四、加州居民之權利",
        s4intro: "依 CCPA/CPRA，您享有下列權利：",
        s4list: [
          "得知本公司所蒐集之您個人資料。",
          "取得可攜式副本。",
          "請求更正不實個人資料。",
          "請求刪除個人資料（法定例外除外，如須依 CA B&P §17550 保存之訂單紀錄）。",
          "選擇退出出售或分享（本公司不出售不分享，故實質上不適用）。",
          "限制敏感個人資料之使用。",
          "不因行使上述權利而受差別待遇。",
          "指定授權代理人代為行使。",
          "對拒絕處分向加州隱私保護局（CPPA）申訴。",
        ],
        s4how:
          "行使前述權利，請寄信至 privacy@packandgo.com（過渡期間請使用 Jeffhsieh09@gmail.com）。本公司將驗證您的身分後，於加州民法 §1798.130 規定之 45 日內回覆。",
        s5h: "五、資料保存期限",
        s5list: [
          "訂單紀錄：7 年（稅務及加州 DOJ 紀錄保存義務）。",
          "行銷電郵清單：直至您取消訂閱。",
          "護照掃描：行程結束後 30 天內刪除，爭議處理期間除外。",
          "分析日誌：12 個月，去識別化。",
        ],
        s6h: "六、Cookie 及類似技術",
        s6p:
          "本網站僅使用維持網站運作所必需之少量 Cookie（session、購物車、語言）。分析用 Cookie（Plausible、GTM）僅於您經由 Cookie 同意橫幅明確同意後始行載入。您得隨時點選頁尾「Cookie 偏好」撤回同意。",
        s7h: "七、資料分享之對象",
        s7list: [
          "金流服務商——以利信用卡收款。",
          "Bank of America, N.A.——信託帳戶存管銀行。",
          "航空公司、飯店、當地營運商——僅提供開票或訂房所需最少資料。",
          "Plausible Analytics / Google Analytics——彙總之網站使用統計。",
          "政府機關——因傳票或法律程序要求時。",
        ],
        s8h: "八、跨境傳輸",
        s8p:
          "本公司總部設於加州。若您預訂美國以外之行程，完成訂單所必需之最少個人資料將傳輸至目的地之供應商。",
        s9h: "九、資訊安全",
        s9p:
          "本公司採用 HTTPS、敏感識別碼加密儲存、角色式權限控管及每年供應商稽核。若不幸發生個資外洩事件，本公司將依加州民法 §1798.82 通知您。",
        s10h: "十、兒童",
        s10p:
          "本網站非針對 16 歲以下兒童。本公司不會明知蒐集 16 歲以下兒童之個人資料。若您發現有此情事，請寄信至 privacy@packandgo.com，本公司將立即刪除。",
        s11h: "十一、修訂",
        s11p:
          "任何更新將於本頁揭示並更新生效日。重大變更將另以電郵通知活躍客戶。",
        s12h: "十二、聯絡",
        s12p:
          "Pack & Go, LLC · 隱私長收 · 39055 Cedar Blvd #126, Newark, CA 94560, USA · Jeffhsieh09@gmail.com",
      };

  const Section = ({ h, children }: { h: string; children: React.ReactNode }) => (
    <>
      <h2 className="text-2xl font-bold text-black mt-8">{h}</h2>
      <div className="mt-3 space-y-3 leading-relaxed">{children}</div>
    </>
  );

  const List = ({ items }: { items: string[] }) => (
    <ul className="list-disc pl-6 space-y-2">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );

  return (
    <GenericPage title={T.title} subtitle={T.subtitle}>
      <div className="space-y-4 text-gray-700 max-w-4xl">
        <p className="text-sm text-gray-500">{T.effective}: 2026-04-18</p>

        <p className="leading-relaxed">{T.intro}</p>

        <Section h={T.s1h}>
          <p>{T.s1intro}</p>
          <List items={T.s1list} />
          <p className="text-sm text-gray-600 italic">{T.s1note}</p>
        </Section>

        <Section h={T.s2h}>
          <List items={T.s2list} />
        </Section>

        <Section h={T.s3h}>
          <p>{T.s3p}</p>
        </Section>

        <Section h={T.s4h}>
          <p>{T.s4intro}</p>
          <List items={T.s4list} />
          <p>{T.s4how}</p>
        </Section>

        <Section h={T.s5h}>
          <List items={T.s5list} />
        </Section>

        <Section h={T.s6h}>
          <p>{T.s6p}</p>
        </Section>

        <Section h={T.s7h}>
          <List items={T.s7list} />
        </Section>

        <Section h={T.s8h}>
          <p>{T.s8p}</p>
        </Section>

        <Section h={T.s9h}>
          <p>{T.s9p}</p>
        </Section>

        <Section h={T.s10h}>
          <p>{T.s10p}</p>
        </Section>

        <Section h={T.s11h}>
          <p>{T.s11p}</p>
        </Section>

        <Section h={T.s12h}>
          <p>{T.s12p}</p>
        </Section>

        <div className="mt-12 rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-600">
          <p>
            {isEn
              ? "You may also contact the California Privacy Protection Agency at "
              : "您亦得逕向加州隱私保護局（California Privacy Protection Agency）反映："}
            <a
              href="https://cppa.ca.gov"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-black"
            >
              cppa.ca.gov
            </a>
            .
          </p>
          <p className="mt-2">
            {isEn ? "See also our " : "亦請參閱本公司之"}
            <Link href="/terms-of-service" className="underline hover:text-black">
              {isEn ? "Terms of Service" : "服務條款"}
            </Link>
            {isEn ? " for booking-related disclosures." : "，了解訂購相關揭露。"}
          </p>
        </div>
      </div>
    </GenericPage>
  );
}
