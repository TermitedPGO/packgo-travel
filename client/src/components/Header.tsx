import { useAuth } from "@/_core/hooks/useAuth";
import {
  Menu, X, User, Shield, ChevronDown, Phone,
  Plane, Users, Sparkles, Ticket, Hotel, FileText, ArrowRight,
  Coins,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";

/**
 * Round 80.22: Packpoint balance badge in the top-right header strip.
 * Hidden when balance is 0 to avoid clutter for brand-new users (signup
 * bonus +50 means most logged-in users will see it within seconds).
 * Click goes to /membership where user can see the full breakdown.
 */
function PackpointBadge() {
  const { data } = trpc.packpoint.getStatus.useQuery(undefined, {
    staleTime: 60_000,
  });
  if (!data?.isLoggedIn) return null;
  if (data.balance === 0) return null;
  return (
    <Link
      href="/rewards"
      className="flex items-center gap-1 hover:text-white transition-colors"
      title={`Packpoint: ${data.balance.toLocaleString()} pts ($${(data.balance / 100).toFixed(2)} 折抵價值) — 點擊進入兌換中心`}
    >
      <Coins className="h-3 w-3 text-[#c9a563]" />
      <span className="tabular-nums">{data.balance.toLocaleString()}</span>
      <span className="text-white/50 text-[10px]">pt</span>
    </Link>
  );
}

type LucideIcon = typeof Plane;

interface NavDropdownItem {
  labelKey: string;
  href: string;
  descKey?: string;
  icon?: LucideIcon;
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

  // Round 80.11: Lion-Travel-inspired mega menu structure for "行程".
  // Now 3 columns: Type / Destinations / Seasonal — same UX pattern Mandarin
  // travelers already know from 雄獅, just B&W + gold instead of red.
  type MegaColumn = {
    headingKey: string;
    items: NavDropdownItem[];
  };
  type NavGroupExt = NavGroup & { mega?: MegaColumn[] };

  const navGroups: NavGroupExt[] = [
    {
      labelKey: "nav.tours",
      mega: [
        {
          headingKey: "nav.megaTypeHeading",
          items: [
            // Round 80.12: removed 包團旅遊 — Jeff's inventory IS group tours,
            // so the distinction between "group tour" and "all tours" is
            // confusing. 所有行程 + 客製規劃 covers the actual two paths.
            { labelKey: "nav.allTours", href: "/tours", descKey: "nav.allToursDesc", icon: Plane },
            { labelKey: "nav.customTourRequest", href: "/custom-tour-request", descKey: "nav.customTourRequestDesc", icon: Sparkles },
          ],
        },
        {
          headingKey: "nav.megaDestinationsHeading",
          items: [
            { labelKey: "nav.destJapan", href: "/destinations/asia/japan" },
            { labelKey: "nav.destCanada", href: "/destinations/americas/canada" },
            { labelKey: "nav.destEurope", href: "/destinations/europe" },
            { labelKey: "nav.destUSWest", href: "/destinations/americas" },
          ],
        },
        {
          headingKey: "nav.megaSeasonHeading",
          items: [
            { labelKey: "nav.seasonSpring", href: "/tours?season=spring" },
            { labelKey: "nav.seasonAutumn", href: "/tours?season=autumn" },
            { labelKey: "nav.seasonWinter", href: "/tours?season=winter" },
          ],
        },
      ],
    },
    {
      labelKey: "nav.services",
      children: [
        { labelKey: "nav.flightBooking", href: "/flight-booking", descKey: "nav.flightBookingDesc", icon: Ticket },
        { labelKey: "nav.hotelBooking", href: "/hotel-booking", descKey: "nav.hotelBookingDesc", icon: Hotel },
        { labelKey: "nav.chinaVisa", href: "/china-visa", descKey: "nav.chinaVisaDesc", icon: FileText },
      ],
    },
    {
      // Round 80.21: Membership added to top nav for visibility.
      labelKey: "nav.membership",
      href: "/membership",
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
      {/* Round 80.11 → 80.12: PACK&GO-specific simplification.
          Utility bar now: phone (left) · locale + login (right). CST badge
          moved into the logo area where trust signals belong. Boutique
          one-person agency = quieter chrome, fewer items per row. */}
      <div className="hidden md:block bg-foreground text-white/85 text-xs">
        <div className="container flex items-center justify-between h-9">
          <a
            href="tel:+15106342307"
            className="flex items-center gap-1.5 hover:text-white transition-colors group"
            aria-label="Call PACK&GO"
          >
            <Phone className="h-3 w-3 text-[#c9a563] group-hover:scale-110 transition-transform" />
            <span className="font-medium tracking-wide">+1 (510) 634-2307</span>
            <span className="text-white/50 hidden lg:inline">· {t("homeHero.phoneNote")}</span>
          </a>
          <div className="flex items-center gap-3">
            <LocaleSwitcher variant="dark" />
            {isAuthenticated && user?.role === "admin" && (
              <>
                <span className="text-white/20">·</span>
                <Link
                  href="/admin"
                  className="flex items-center gap-1 hover:text-white transition-colors"
                >
                  <Shield className="h-3 w-3" />
                  <span>{t("nav.adminPanel")}</span>
                </Link>
              </>
            )}
            <span className="text-white/20">·</span>
            {isAuthenticated && user ? (
              <>
                {/* Round 80.22: Packpoint balance pill — small, subtle, only
                    visible when logged in. Click goes to membership page where
                    user can see history + redemption value. */}
                <PackpointBadge />
                <span className="text-white/20">·</span>
                <Link
                  href="/profile"
                  className="flex items-center gap-1 hover:text-white transition-colors"
                >
                  <User className="h-3 w-3" />
                  {/* 2026-05-22: bumped max-w 120 → 180px so "Pack&Go LLC Support"
                      (18 chars) shows full instead of "Pack&Go LLC Supp…". */}
                  <span className="truncate max-w-[180px]">{user.name || user.email}</span>
                </Link>
              </>
            ) : (
              <Link
                href="/login"
                className="flex items-center gap-1 hover:text-white transition-colors"
              >
                <User className="h-3 w-3" />
                <span>{t("nav.loginRegister")}</span>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Signature gold accent line — echoes hero baseline + footer. */}
      <div className="h-px bg-gradient-to-r from-transparent via-[#c9a563]/40 to-transparent" aria-hidden />


      {/* Main Header */}
      <div className="container flex h-16 md:h-20 items-center justify-between" ref={dropdownRef}>
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 md:gap-3 group shrink-0">
          <img
            src="/images/logo-bag-black-v3.png"
            alt="PACK&GO Logo"
            className="h-8 w-8 md:h-10 md:w-10 object-contain"
          />
          <div className="flex flex-col justify-center pl-0.5 md:pl-1">
            <span className="text-[20px] md:text-[24px] font-bold tracking-wide text-black leading-none font-sans">
              PACK&amp;GO
            </span>
            <span className="text-[11px] md:text-[13px] font-medium text-gray-600 tracking-widest mt-0.5 md:mt-1">
              {t("home.slogan")}
            </span>
          </div>
        </Link>

        {/* Desktop Navigation — Round 80.10: nav now flex-1 + justify-center
            so it occupies the visual middle between logo and right-side
            actions. Buttons get focus-visible ring (no more browser default
            outline boxes), more spacing (gap-2 + px-4), and the dropdown
            card is rounded-xl with icons + gold hover accent. */}
        <nav className="hidden lg:flex flex-1 justify-center items-center gap-2">
          {navGroups.map((group) => (
            <div key={group.labelKey} className="relative">
              {group.href && !group.children && !group.mega ? (
                // Simple link (no dropdown)
                <Link
                  href={group.href}
                  className="flex items-center gap-1 px-4 py-5 text-[15px] font-medium tracking-wide text-foreground/75 hover:text-foreground transition-colors border-b-2 border-transparent hover:border-[#c9a563] focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 focus-visible:rounded-md"
                >
                  {t(group.labelKey)}
                </Link>
              ) : (
                // Dropdown trigger
                <button
                  className={`flex items-center gap-1.5 px-4 py-5 text-[15px] font-medium tracking-wide transition-colors border-b-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 focus-visible:rounded-md ${
                    openDropdown === group.labelKey
                      ? "text-foreground border-[#c9a563]"
                      : "text-foreground/75 hover:text-foreground border-transparent hover:border-[#c9a563]"
                  }`}
                  onClick={() =>
                    setOpenDropdown(
                      openDropdown === group.labelKey ? null : group.labelKey
                    )
                  }
                  aria-expanded={openDropdown === group.labelKey}
                >
                  {t(group.labelKey)}
                  <ChevronDown
                    className={`h-4 w-4 transition-transform duration-200 ${
                      openDropdown === group.labelKey ? "rotate-180" : ""
                    }`}
                  />
                </button>
              )}

              {/* Round 80.11: Lion-Travel-inspired mega menu (when group.mega
                  is defined) OR legacy single-column dropdown. The mega
                  variant is wider (3 columns), centered under the trigger,
                  and surfaces destinations + seasons alongside types. */}
              {group.mega && openDropdown === group.labelKey && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-[640px] bg-white shadow-2xl border border-foreground/10 rounded-xl overflow-hidden z-50">
                  <div className="grid grid-cols-3 gap-0 divide-x divide-gray-100">
                    {group.mega.map((column) => (
                      <div key={column.headingKey} className="p-4">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/40 mb-3 px-2">
                          {t(column.headingKey)}
                        </p>
                        <div className="flex flex-col gap-0.5">
                          {column.items.map((item, idx) => {
                            const Icon = item.icon;
                            return (
                              <Link
                                key={`${item.href}-${idx}`}
                                href={item.href}
                                className="flex items-start gap-3 px-2 py-2 rounded-lg hover:bg-[#c9a563]/8 transition-colors group"
                                onClick={() => setOpenDropdown(null)}
                              >
                                {Icon && (
                                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-foreground/5 group-hover:bg-[#c9a563]/15 flex items-center justify-center transition-colors">
                                    <Icon className="h-3.5 w-3.5 text-foreground/70 group-hover:text-[#8a6f3a] transition-colors" />
                                  </div>
                                )}
                                <div className="flex-1 min-w-0 pt-0.5">
                                  <span className="block text-[13px] font-semibold tracking-wide text-foreground group-hover:text-[#8a6f3a] transition-colors">
                                    {t(item.labelKey)}
                                  </span>
                                  {item.descKey && (
                                    <span className="block text-[11px] text-foreground/55 mt-0.5 leading-snug">
                                      {t(item.descKey)}
                                    </span>
                                  )}
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* PACK&GO signature footer — phone-first, "talk to a
                      human" energy. Lion has banner ads / discount banners
                      here; we put Jeff's actual phone number. Boutique. */}
                  <div className="px-4 py-3 bg-foreground/[0.03] border-t border-foreground/8 flex items-center justify-between gap-4">
                    <p className="text-xs text-foreground/60">
                      {t("nav.megaFooterHint")}
                    </p>
                    <div className="flex items-center gap-3">
                      <a
                        href="tel:+15106342307"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-[#8a6f3a] transition-colors"
                      >
                        <Phone className="h-3 w-3 text-[#c9a563]" />
                        +1 (510) 634-2307
                      </a>
                      <span className="text-foreground/20">·</span>
                      <Link
                        href="/custom-tour-request"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#8a6f3a] hover:text-[#c9a563] transition-colors"
                        onClick={() => setOpenDropdown(null)}
                      >
                        <Sparkles className="h-3 w-3" />
                        {t("nav.megaFooterCTA")}
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                </div>
              )}

              {/* Legacy single-column Dropdown Panel — used when group has
                  children (not mega). Kept for 服務 dropdown. */}
              {group.children && openDropdown === group.labelKey && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-[340px] bg-white shadow-2xl border border-foreground/10 rounded-xl overflow-hidden z-50">
                  <div className="p-2">
                    {group.children.map((item, idx) => {
                      const Icon = item.icon;
                      return (
                        <Link
                          key={`${item.href}-${idx}`}
                          href={item.href}
                          className="flex items-start gap-3 px-3 py-3 rounded-lg hover:bg-[#c9a563]/8 transition-colors group"
                          onClick={() => setOpenDropdown(null)}
                        >
                          {Icon && (
                            <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-foreground/5 group-hover:bg-[#c9a563]/15 flex items-center justify-center transition-colors">
                              <Icon className="h-4 w-4 text-foreground/70 group-hover:text-[#8a6f3a] transition-colors" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0 pt-0.5">
                            <span className="block text-[14px] font-semibold tracking-wide text-foreground">
                              {t(item.labelKey)}
                            </span>
                            {item.descKey && (
                              <span className="block text-[12px] text-foreground/55 mt-0.5 leading-snug">
                                {t(item.descKey)}
                              </span>
                            )}
                          </div>
                          <ArrowRight className="h-3.5 w-3.5 text-foreground/0 group-hover:text-[#c9a563] transition-all flex-shrink-0 mt-2 -translate-x-1 group-hover:translate-x-0" />
                        </Link>
                      );
                    })}
                  </div>
                  {/* Subtle bottom accent line */}
                  <div className="h-px bg-gradient-to-r from-transparent via-[#c9a563]/30 to-transparent" />
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Round 80.12: right side intentionally empty on desktop. All
            secondary actions (locale, login, admin, phone) live in the
            utility bar above. Boutique = quieter chrome, less to scan. */}

        {/* Mobile Menu Button */}
        <button
          className="lg:hidden p-2 text-gray-600"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          aria-label={t('common.openMenu')}
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
                {group.href && !group.children && !group.mega ? (
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
                    {openDropdown === group.labelKey && (group.children || group.mega) && (
                      <div className="pl-4 pb-2 flex flex-col gap-1 bg-gray-50 rounded-lg mt-1 mb-2">
                        {/* Round 80.11: mobile flattens mega columns with
                            their column heading as a section divider */}
                        {group.mega
                          ? group.mega.flatMap((column) => [
                              <p
                                key={`heading-${column.headingKey}`}
                                className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground/40 mt-3 first:mt-0 px-2"
                              >
                                {t(column.headingKey)}
                              </p>,
                              ...column.items.map((item) => (
                                <Link
                                  key={item.href}
                                  href={item.href}
                                  className="block text-[14px] font-medium text-gray-700 py-2.5 px-2 border-b border-gray-100 last:border-0 hover:text-foreground"
                                  onClick={() => {
                                    setIsMenuOpen(false);
                                    setOpenDropdown(null);
                                  }}
                                >
                                  {t(item.labelKey)}
                                </Link>
                              )),
                            ])
                          : group.children?.map((item) => (
                              <Link
                                key={item.href}
                                href={item.href}
                                className="block text-[14px] font-medium text-gray-700 py-2.5 border-b border-gray-100 last:border-0 hover:text-foreground"
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
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 mt-2 border-t border-gray-100">
              <div className="flex items-center gap-3 min-w-0">
                <LocaleSwitcher />
                {isAuthenticated && user ? (
                  <Link
                    href="/profile"
                    className="flex items-center gap-1 text-sm text-black font-medium min-w-0"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    <User className="h-4 w-4 shrink-0" />
                    <span className="truncate max-w-[120px]">{user.name || user.email}</span>
                  </Link>
                ) : (
                  <Link
                    href="/login"
                    className="flex items-center gap-1 text-sm text-gray-600"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    <User className="h-4 w-4 shrink-0" />
                    {t("nav.memberLogin")}
                  </Link>
                )}
              </div>
              <a
                href="tel:1-510-634-2307"
                className="flex items-center gap-1 text-sm font-bold text-foreground shrink-0"
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
