import { useAuth } from "@/_core/hooks/useAuth";
import { Menu, X, User, Shield, ChevronDown, Phone } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { useLocale } from "@/contexts/LocaleContext";

interface NavDropdownItem {
  labelKey: string;
  href: string;
  descKey?: string;
}

interface NavGroup {
  labelKey: string;
  href?: string;
  children?: NavDropdownItem[];
}

export default function Header() {
  const { user, isAuthenticated } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const { t } = useLocale();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 3-tier navigation: 行程 / 服務 / 聯絡我們
  const navGroups: NavGroup[] = [
    {
      labelKey: "nav.tours",
      children: [
        { labelKey: "nav.groupTours", href: "/group-packages", descKey: "nav.groupToursDesc" },
        { labelKey: "nav.allTours", href: "/tours", descKey: "nav.allToursDesc" },
      ],
    },
    {
      labelKey: "nav.services",
      children: [
        { labelKey: "nav.flightBooking", href: "/flight-booking", descKey: "nav.flightBookingDesc" },
        { labelKey: "nav.hotelBooking", href: "/hotel-booking", descKey: "nav.hotelBookingDesc" },
        { labelKey: "nav.chinaVisa", href: "/china-visa", descKey: "nav.chinaVisaDesc" },
        { labelKey: "nav.customTourRequest", href: "/custom-tour-request", descKey: "nav.customTourRequestDesc" },
        { labelKey: "nav.quickInquiry", href: "/inquiry", descKey: "nav.quickInquiryDesc" },
        { labelKey: "nav.contactUs", href: "/contact-us", descKey: "nav.contactUsDesc" },
      ],
    },
    {
      labelKey: "nav.contactUs",
      href: "/contact-us",
    },
  ];

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="sticky top-0 z-50 w-full bg-white shadow-sm">
      {/* Main Header */}
      <div className="container flex h-20 items-center justify-between" ref={dropdownRef}>
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group shrink-0">
          <img
            src="/images/logo-bag-black-v3.png"
            alt="PACK&GO Logo"
            className="h-10 w-10 object-contain"
          />
          <div className="flex flex-col justify-center pl-1">
            <span className="text-[24px] font-bold tracking-wide text-black leading-none font-sans">
              PACK&amp;GO
            </span>
            <span className="text-[13px] font-medium text-gray-600 tracking-widest mt-1">
              {t("home.slogan")}
            </span>
          </div>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden lg:flex items-center gap-1">
          {navGroups.map((group) => (
            <div key={group.labelKey} className="relative">
              {group.href && !group.children ? (
                // Simple link (no dropdown)
                <Link
                  href={group.href}
                  className="flex items-center gap-1 px-4 py-2 text-[15px] font-medium text-gray-700 hover:text-primary transition-colors rounded-md hover:bg-gray-50"
                >
                  {t(group.labelKey)}
                </Link>
              ) : (
                // Dropdown trigger
                <button
                  className={`flex items-center gap-1 px-4 py-2 text-[15px] font-medium transition-colors rounded-md ${
                    openDropdown === group.labelKey
                      ? "text-primary bg-red-50"
                      : "text-gray-700 hover:text-primary hover:bg-gray-50"
                  }`}
                  onClick={() =>
                    setOpenDropdown(
                      openDropdown === group.labelKey ? null : group.labelKey
                    )
                  }
                >
                  {t(group.labelKey)}
                  <ChevronDown
                    className={`h-4 w-4 transition-transform duration-200 ${
                      openDropdown === group.labelKey ? "rotate-180" : ""
                    }`}
                  />
                </button>
              )}

              {/* Dropdown Panel */}
              {group.children && openDropdown === group.labelKey && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-50">
                  {group.children.map((item, idx) => (
                    <Link
                      key={`${item.href}-${idx}`}
                      href={item.href}
                      className="flex flex-col px-4 py-3 hover:bg-gray-50 transition-colors group"
                      onClick={() => setOpenDropdown(null)}
                    >
                      <span className="text-[14px] font-semibold text-gray-800 group-hover:text-primary transition-colors">
                        {t(item.labelKey)}
                      </span>
                      {item.descKey && (
                        <span className="text-[12px] text-gray-500 mt-0.5">
                          {t(item.descKey)}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Right Side */}
        <div className="hidden md:flex items-center gap-2">
          <LocaleSwitcher />

          {/* Admin Panel Link */}
          {isAuthenticated && user?.role === "admin" && (
            <Link
              href="/admin"
              className="flex items-center gap-1.5 h-8 px-2.5 text-sm font-medium text-gray-700 hover:text-black hover:bg-gray-100 rounded-md transition-colors whitespace-nowrap"
            >
              <Shield className="h-3.5 w-3.5" />
              <span>{t("nav.adminPanel")}</span>
            </Link>
          )}

          {/* User */}
          {isAuthenticated && user ? (
            <Link
              href="/profile"
              className="flex items-center gap-1.5 h-8 px-2.5 text-sm font-semibold text-black hover:bg-gray-100 rounded-md transition-colors whitespace-nowrap"
            >
              <User className="h-3.5 w-3.5" />
              <span>{user.name || user.email}</span>
            </Link>
          ) : (
            <Link
              href="/login"
              className="flex items-center gap-1.5 h-8 px-2.5 text-sm font-semibold text-black hover:bg-gray-100 rounded-md transition-colors whitespace-nowrap"
            >
              <User className="h-3.5 w-3.5" />
              <span>{t("nav.loginRegister")}</span>
            </Link>
          )}
        </div>

        {/* Mobile Menu Button */}
        <button
          className="lg:hidden p-2 text-gray-600"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          aria-label="開啟選單"
        >
          {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile Menu */}
      {isMenuOpen && (
        <div className="lg:hidden absolute top-full left-0 w-full bg-white border-b border-gray-100 shadow-lg z-40">
          <div className="px-4 py-3 flex flex-col gap-1">
            {navGroups.map((group) => (
              <div key={group.labelKey}>
                {group.href && !group.children ? (
                  <Link
                    href={group.href}
                    className="block text-base font-semibold text-gray-800 py-3 border-b border-gray-100"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    {t(group.labelKey)}
                  </Link>
                ) : (
                  <div>
                    <button
                      className="flex items-center justify-between w-full text-base font-semibold text-gray-800 py-3 border-b border-gray-100"
                      onClick={() =>
                        setOpenDropdown(
                          openDropdown === group.labelKey ? null : group.labelKey
                        )
                      }
                    >
                      {t(group.labelKey)}
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${
                          openDropdown === group.labelKey ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                    {openDropdown === group.labelKey && group.children && (
                      <div className="pl-4 pb-2 flex flex-col gap-1 bg-gray-50 rounded-lg mt-1 mb-2">
                        {group.children.map((item) => (
                          <Link
                            key={item.href}
                            href={item.href}
                            className="block text-[14px] font-medium text-gray-700 py-2.5 border-b border-gray-100 last:border-0 hover:text-primary"
                            onClick={() => {
                              setIsMenuOpen(false);
                              setOpenDropdown(null);
                            }}
                          >
                            {t(item.labelKey)}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Mobile Bottom Bar */}
            <div className="flex items-center justify-between pt-3 mt-2 border-t border-gray-100">
              <div className="flex items-center gap-3">
                <LocaleSwitcher />
                {isAuthenticated && user ? (
                  <Link
                    href="/profile"
                    className="flex items-center gap-1 text-sm text-black font-medium"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    <User className="h-4 w-4" />
                    {user.name || user.email}
                  </Link>
                ) : (
                  <Link
                    href="/login"
                    className="flex items-center gap-1 text-sm text-gray-600"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    <User className="h-4 w-4" />
                    {t("nav.memberLogin")}
                  </Link>
                )}
              </div>
              <a
                href="tel:1-510-634-2307"
                className="flex items-center gap-1 text-sm font-bold text-primary"
              >
                <Phone className="h-4 w-4" />
                1 (510) 634-2307
              </a>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
