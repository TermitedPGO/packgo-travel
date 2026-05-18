import { Facebook, Instagram, Mail, MapPin, Phone } from "lucide-react";
import { Link } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";
import { CONTACT } from "@/lib/brand";

export default function Footer() {
  const { t } = useLocale();
  
  return (
    <footer className="bg-black text-white pt-16 pb-8">
      <div className="container">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-16">
          {/* Column 1: Brand & About */}
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <img 
                src="/images/logo-bag-white-v3.png" 
                alt="PACK&GO Logo" 
                className="h-10 w-10 object-contain"
              />
              <div className="flex flex-col justify-center pl-1">
                <span className="text-[28px] font-bold tracking-wide text-white leading-none font-sans">
                  PACK&GO
                </span>
                <span className="text-[15px] font-medium text-gray-400 tracking-widest mt-1">
                  {t('footer.slogan')}
                </span>
              </div>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed">
              {t('footer.description')}
            </p>
            {/* Round 80.7: social icons gated by env vars to remove dead "#"
                links. Set VITE_FACEBOOK_URL / VITE_INSTAGRAM_URL when accounts
                are live. Until then, social row hides entirely (better than
                shipping non-functional icons that suggest the brand is asleep). */}
            {((import.meta as any).env?.VITE_FACEBOOK_URL || (import.meta as any).env?.VITE_INSTAGRAM_URL) && (
              <div className="flex gap-4">
                {(import.meta as any).env?.VITE_FACEBOOK_URL && (
                  <a
                    href={(import.meta as any).env.VITE_FACEBOOK_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Facebook"
                    className="bg-gray-800 p-2 rounded-lg hover:bg-white/15 transition-colors"
                  >
                    <Facebook className="h-5 w-5" />
                  </a>
                )}
                {(import.meta as any).env?.VITE_INSTAGRAM_URL && (
                  <a
                    href={(import.meta as any).env.VITE_INSTAGRAM_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Instagram"
                    className="bg-gray-800 p-2 rounded-lg hover:bg-white/15 transition-colors"
                  >
                    <Instagram className="h-5 w-5" />
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Column 2: Quick Links */}
          <div>
            <h3 className="text-lg font-serif font-bold mb-6 text-white">{t('footer.quickLinks')}</h3>
            <ul className="space-y-4 text-sm text-gray-400">
              <li><Link href="/about-us" className="hover:text-white transition-colors">{t('nav.aboutUs')}</Link></li>
              <li><Link href="/terms-of-service" className="hover:text-white transition-colors">{t('nav.termsOfService')}</Link></li>
              <li><Link href="/privacy-policy" className="hover:text-white transition-colors">{t('nav.privacyPolicy')}</Link></li>
              <li><Link href="/faq" className="hover:text-white transition-colors">{t('nav.faq')}</Link></li>
              <li><Link href="/contact-us" className="hover:text-white transition-colors">{t('nav.contactUs')}</Link></li>
            </ul>
          </div>

          {/* Column 3: Services */}
          <div>
            <h3 className="text-lg font-serif font-bold mb-6 text-white">{t('footer.services')}</h3>
            <ul className="space-y-4 text-sm text-gray-400">
              <li><Link href="/custom-tours" className="hover:text-white transition-colors">{t('services.customTours')}</Link></li>
              <li><Link href="/china-visa" className="hover:text-white transition-colors">{t('services.visaServices')}</Link></li>
              <li><Link href="/group-packages" className="hover:text-white transition-colors">{t('services.groupPackages')}</Link></li>
              <li><Link href="/flight-booking" className="hover:text-white transition-colors">{t('services.flightBooking')}</Link></li>
              <li><Link href="/airport-transfer" className="hover:text-white transition-colors">{t('services.airportTransfer')}</Link></li>
              <li><Link href="/hotel-booking" className="hover:text-white transition-colors">{t('services.hotelBooking')}</Link></li>
            </ul>
          </div>

          {/* Column 4: Contact Info */}
          <div>
            <h3 className="text-lg font-serif font-bold mb-6 text-white">{t('footer.contactInfo')}</h3>
            <ul className="space-y-4 text-sm text-gray-400">
              {/* v80.24: centralized via lib/brand.ts (was hardcoded; phone +
                  email + address now share one source of truth). */}
              <li className="flex items-start gap-3">
                <MapPin className="h-5 w-5 text-white shrink-0 mt-0.5" />
                <span>{CONTACT.address.street}<br />{CONTACT.address.city} {CONTACT.address.state} {CONTACT.address.zip}</span>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="h-5 w-5 text-white shrink-0" />
                <a href={`tel:${CONTACT.whatsapp}`} className="hover:text-gray-300 transition-colors">{CONTACT.phoneDisplay}</a>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-white shrink-0" />
                <a href={`mailto:${CONTACT.email}`} className="hover:text-gray-300 transition-colors">{CONTACT.email}</a>
              </li>
              <li className="flex items-start gap-3 mt-2">
                <div className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <img src="/images/qrcode-wechat.png" alt="WeChat QR" className="h-20 w-20 bg-white p-1 rounded-lg" />
                    <p className="text-xs text-gray-500 mt-1">WeChat</p>
                  </div>
                  <div className="flex flex-col items-center">
                    <img src="/images/qrcode-line.png" alt="LINE QR" className="h-20 w-20 bg-white p-1 rounded-lg" />
                    <p className="text-xs text-gray-500 mt-1">LINE</p>
                  </div>
                </div>
              </li>
            </ul>
          </div>
        </div>

        {/* Trust Credentials Row — Round 80: recoloured from emerald/blue/red
            to monochrome (white-on-black with thin gray borders) per the
            B&W brand baseline. Gold accent on the verified-CST badge keeps
            it the visual anchor. */}
        <div className="border-t border-gray-800 pt-8 pb-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="px-2.5 py-1 rounded-md bg-white/5 border border-[#c9a563]/40 text-[#c9a563] font-mono font-semibold">
                CST #2166984
              </span>
              <span className="text-xs text-gray-400">{t('footer.businessLicense')}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="px-2.5 py-1 rounded-md bg-white/5 border border-white/20 text-white/90 font-semibold text-xs tracking-wide">
                TCRF
              </span>
              <span className="text-xs text-gray-400">{t('footer.tcrfParticipant')}</span>
            </div>
            {/* v78m Sprint 5D: review platform links (set via Fly secrets PACKGO_GOOGLE_REVIEW_URL / PACKGO_YELP_REVIEW_URL) */}
            {(import.meta as any).env?.VITE_GOOGLE_REVIEW_URL && (
              <a
                href={(import.meta as any).env.VITE_GOOGLE_REVIEW_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                <span className="px-2.5 py-1 rounded-md bg-white/5 border border-white/20 text-white/90 font-semibold text-xs tracking-wide">
                  Google Reviews
                </span>
                <span className="text-xs">{t("footer.readReviews") || "查看真實評價 →"}</span>
              </a>
            )}
            {(import.meta as any).env?.VITE_YELP_REVIEW_URL && (
              <a
                href={(import.meta as any).env.VITE_YELP_REVIEW_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                <span className="px-2.5 py-1 rounded-md bg-white/5 border border-white/20 text-white/90 font-semibold text-xs tracking-wide">
                  Yelp
                </span>
                <span className="text-xs">{t("footer.readReviews") || "查看真實評價 →"}</span>
              </a>
            )}
          </div>
        </div>

        {/* Legal Disclosures (California Seller of Travel - B&P §17550 et seq.) */}
        <div className="border-t border-gray-800 pt-6 pb-6">
          <div className="text-xs text-gray-400 leading-relaxed space-y-2 max-w-4xl">
            <p className="font-semibold text-gray-300">
              {t('footer.legalName')} &middot; {CONTACT.address.street}, {CONTACT.address.city}, {CONTACT.address.state} {CONTACT.address.zip}
            </p>
            <p className="text-gray-500">{t('footer.trustAccountStatement')}</p>
            <p className="text-gray-500 italic">{t('footer.stateDisclaimer')}</p>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-gray-800 pt-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs text-gray-500">
            {t('footer.copyright', { year: new Date().getFullYear() })}
          </p>
          <div className="flex gap-4 text-xs text-gray-500">
            <Link href="/privacy-policy" className="hover:text-gray-300 transition-colors">{t('nav.privacyPolicy')}</Link>
            <span>&middot;</span>
            <Link href="/terms-of-service" className="hover:text-gray-300 transition-colors">{t('nav.termsOfService')}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
