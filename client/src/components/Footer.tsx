import { Facebook, Instagram, Mail, MapPin, Phone } from "lucide-react";
import { Link } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";

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
            <div className="flex gap-4">
              <a href="#" className="bg-gray-800 p-2 rounded-lg hover:bg-primary transition-colors">
                <Facebook className="h-5 w-5" />
              </a>
              <a href="#" className="bg-gray-800 p-2 rounded-lg hover:bg-primary transition-colors">
                <Instagram className="h-5 w-5" />
              </a>
            </div>
          </div>

          {/* Column 2: Quick Links */}
          <div>
            <h3 className="text-lg font-serif font-bold mb-6 text-white">{t('footer.quickLinks')}</h3>
            <ul className="space-y-4 text-sm text-gray-400">
              <li><Link href="/about-us" className="hover:text-primary transition-colors">{t('nav.aboutUs')}</Link></li>
              <li><Link href="/terms-of-service" className="hover:text-primary transition-colors">{t('nav.termsOfService')}</Link></li>
              <li><Link href="/privacy-policy" className="hover:text-primary transition-colors">{t('nav.privacyPolicy')}</Link></li>
              <li><Link href="/faq" className="hover:text-primary transition-colors">{t('nav.faq')}</Link></li>
              <li><Link href="/contact-us" className="hover:text-primary transition-colors">{t('nav.contactUs')}</Link></li>
            </ul>
          </div>

          {/* Column 3: Services */}
          <div>
            <h3 className="text-lg font-serif font-bold mb-6 text-white">{t('footer.services')}</h3>
            <ul className="space-y-4 text-sm text-gray-400">
              <li><Link href="/custom-tours" className="hover:text-primary transition-colors">{t('services.customTours')}</Link></li>
              <li><Link href="/china-visa" className="hover:text-primary transition-colors">{t('services.visaServices')}</Link></li>
              <li><Link href="/group-packages" className="hover:text-primary transition-colors">{t('services.groupPackages')}</Link></li>
              <li><Link href="/flight-booking" className="hover:text-primary transition-colors">{t('services.flightBooking')}</Link></li>
              <li><Link href="/airport-transfer" className="hover:text-primary transition-colors">{t('services.airportTransfer')}</Link></li>
              <li><Link href="/hotel-booking" className="hover:text-primary transition-colors">{t('services.hotelBooking')}</Link></li>
            </ul>
          </div>

          {/* Column 4: Contact Info */}
          <div>
            <h3 className="text-lg font-serif font-bold mb-6 text-white">{t('footer.contactInfo')}</h3>
            <ul className="space-y-4 text-sm text-gray-400">
              <li className="flex items-start gap-3">
                <MapPin className="h-5 w-5 text-white shrink-0 mt-0.5" />
                <span>39055 Cedar Blvd #126<br />Newark CA 94560</span>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="h-5 w-5 text-white shrink-0" />
                <a href="tel:1-510-634-2307" className="hover:text-gray-300 transition-colors">+1 (510) 634-2307</a>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-white shrink-0" />
                <a href="mailto:Jeffhsieh09@gmail.com" className="hover:text-gray-300 transition-colors">Jeffhsieh09@gmail.com</a>
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

        {/* Bottom Bar */}
        <div className="border-t border-gray-800 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs text-gray-500">
            {t('footer.copyright', { year: new Date().getFullYear() })}
          </p>

        </div>
      </div>
    </footer>
  );
}
