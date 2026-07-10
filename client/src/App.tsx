import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import { useEffect } from "react";
import { trackPageView } from "@/lib/analytics";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LocaleProvider, useLocale } from "./contexts/LocaleContext";
import CookieConsentBanner from "./components/CookieConsentBanner";

// ─── Eagerly loaded (critical path) ──────────────────────────────────────────
import Home from "./pages/Home";
import Login from "./pages/Login";

// ─── Lazily loaded (code split) ───────────────────────────────────────────────
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
// 2026-06-29: archived AdminV2 admin removed (Jeff: collapse to admin + test).
// 整合工作台 v3 (chat-first) — 跟 /admin 並存,逐階段切換。design.md。
const Workspace = lazy(() => import("./pages/Workspace"));
// v4 後台重建 — AdminShell + AdminHome (2026-06-17)
const AdminHome = lazy(() => import("./pages/AdminHome"));
const AdminShell = lazy(() => import("./layouts/AdminShell"));
const AdminCustomers = lazy(() => import("./pages/AdminCustomers"));
const AdminTours = lazy(() => import("./pages/AdminTours"));
// F3 財務駕駛艙(2026-07-09)取代舊 AdminFinance placeholder。舊檔保留不刪。
const FinanceCockpit = lazy(() => import("./components/admin-v2/FinanceCockpit"));
const AdminMarketing = lazy(() => import("./pages/AdminMarketing"));
const AdminSettings = lazy(() => import("./pages/AdminSettings"));
const DiagnosticsPage = lazy(() => import("./pages/admin/DiagnosticsPage"));
const Profile = lazy(() => import("./pages/Profile"));
const TourDetailPeony = lazy(() => import("./pages/TourDetailPeony"));
const TourPrintView = lazy(() => import("./pages/TourPrintView"));
const BookTour = lazy(() => import("./pages/BookTour"));
const BookingDetail = lazy(() => import("./pages/BookingDetail"));
const QuickInquiry = lazy(() => import("./pages/QuickInquiry"));
const CustomTourRequest = lazy(() => import("./pages/CustomTourRequest"));
const CustomTours = lazy(() => import("./pages/CustomTours"));
const ChinaVisa = lazy(() => import("./pages/ChinaVisa"));
const ChinaVisaSuccess = lazy(() => import("./pages/ChinaVisaSuccess"));
const ChinaVisaStatus = lazy(() => import("./pages/ChinaVisaStatus"));
const GroupPackages = lazy(() => import("./pages/GroupPackages"));
const FlightBooking = lazy(() => import("./pages/FlightBooking"));
const AirportTransfer = lazy(() => import("./pages/AirportTransfer"));
const HotelBooking = lazy(() => import("./pages/HotelBooking"));
const AboutUs = lazy(() => import("./pages/AboutUs"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const FAQ = lazy(() => import("./pages/FAQ"));
const ContactUs = lazy(() => import("./pages/ContactUs"));
const Emergency = lazy(() => import("./pages/Emergency"));
const Membership = lazy(() => import("./pages/Membership"));
// Round 81 / migration 0075 — AB 390 mandatory auto-renewal disclosure page.
// Linked from Membership.tsx pre-checkout + from Stripe Checkout cancel_url.
const MembershipTerms = lazy(() => import("./pages/MembershipTerms"));
const Rewards = lazy(() => import("./pages/Rewards"));
const SearchResults = lazy(() => import("./pages/SearchResults"));
const Tours = lazy(() => import("./pages/Tours"));
const RegionPage = lazy(() => import("./pages/RegionPage"));
const CountryPage = lazy(() => import("./pages/CountryPage"));
const CruisePage = lazy(() => import("./pages/CruisePage"));
const PaymentSuccess = lazy(() => import("./pages/PaymentSuccess"));
const PaymentFailure = lazy(() => import("./pages/PaymentFailure"));
const TaskHistory = lazy(() => import("./pages/TaskHistory"));
const AIAdvisorMockup = lazy(() => import("./pages/preview/AIAdvisorMockup"));
const ToursTabMockup = lazy(() => import("./pages/preview/ToursTabMockup"));

// ─── Loading fallback ─────────────────────────────────────────────────────────
// Round 80.21 — Jeff reported the previous CSS-border spinner had a "boxy
// pixel" at the join between the black 3/4 arc and the transparent top
// segment (CSS borders use butt caps with no smoothing). Replaced with an
// inline SVG spinner using stroke-linecap="round" — silky-smooth circular
// arc at any zoom, no aliasing, brand-aligned (black + gold accent).
function PageLoader() {
  const { t } = useLocale();
  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="flex flex-col items-center gap-3">
        <svg
          className="h-8 w-8 animate-spin"
          viewBox="0 0 50 50"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
        >
          {/* Background ring (faint) */}
          <circle
            cx="25"
            cy="25"
            r="20"
            fill="none"
            stroke="#e5e7eb"
            strokeWidth="3"
          />
          {/* Active arc — gold, 1/4 sweep, rounded caps */}
          <circle
            cx="25"
            cy="25"
            r="20"
            fill="none"
            stroke="#c9a563"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="125.6"
            strokeDashoffset="94.2"
          />
        </svg>
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      </div>
    </div>
  );
}

function RouteTracker() {
  const [location] = useLocation();
  useEffect(() => {
    trackPageView(location);
  }, [location]);
  return null;
}

/**
 * Round 80.22 Phase D: capture ?ref=CODE on any page load and stash in
 * localStorage with a 90-day TTL. After signup, ProfilePage / Header
 * picks it up and calls claimReferral mutation. Stripping the param from
 * the URL keeps it from re-firing on refresh.
 */
function ReferralCapture() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("ref");
      if (!code) return;
      const normalized = code.trim().toUpperCase();
      if (!/^PACK[A-Z2-9]{4}$/.test(normalized)) return;
      const payload = { code: normalized, ts: Date.now() };
      localStorage.setItem("packgo_ref", JSON.stringify(payload));
      // Clean from URL so refresh doesn't keep firing & affiliate-tracking
      // pixels don't see the param leak through.
      params.delete("ref");
      const cleaned = window.location.pathname + (params.toString() ? "?" + params.toString() : "") + window.location.hash;
      window.history.replaceState({}, "", cleaned);
      console.log("[Referral] Captured code:", normalized);
    } catch (err) {
      console.warn("[Referral] Capture failed", err);
    }
  }, []);
  return null;
}

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <>
    <RouteTracker />
    <ReferralCapture />
    <Suspense fallback={<PageLoader />}>
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/search"} component={SearchResults} />
      <Route path={"/destinations/:region"} component={RegionPage} />
      <Route path={"/destinations/:region/:country"} component={CountryPage} />
      <Route path={"/cruises"} component={CruisePage} />
      <Route path={"/tours"} component={Tours} />
      <Route path={"/login"} component={Login} />
      <Route path={"/forgot-password"} component={ForgotPassword} />
      <Route path={"/reset-password"} component={ResetPassword} />
      <Route path={"/admin/diagnostics"} component={DiagnosticsPage} />
      <Route path={"/admin/task-history"} component={TaskHistory} />
      {/* THE FLIP (2026-06-12, Jeff go): redesign batches shipped, UAT passed.
          /admin and old /admin/v2 redirect to /workspace. 2026-06-29: archived
          AdminV2 (/admin-v2-archive) deleted per Jeff (collapse to admin + test).
          Live admin = /workspace; new build = /ops/*. */}
      <Route path={"/admin"}>{() => { if (typeof window !== "undefined") window.location.replace("/workspace"); return null; }}</Route>
      <Route path={"/workspace"} component={Workspace} />
      <Route path={"/admin/v2"}>{() => { if (typeof window !== "undefined") window.location.replace("/workspace"); return null; }}</Route>
      <Route path={"/profile"} component={Profile} />
      <Route path={"/tours/:id/print"} component={TourPrintView} />
      <Route path={"/tours/:id"} component={TourDetailPeony} />
      <Route path={"/book/:id"} component={BookTour} />
      <Route path={"/bookings/:id"} component={BookingDetail} />
      <Route path={"/payment/success"} component={PaymentSuccess} />
      <Route path={"/payment/failure"} component={PaymentFailure} />
      <Route path={"/inquiry"} component={QuickInquiry} />
      <Route path={"/custom-tour-request"} component={CustomTourRequest} />
      <Route path={"/custom-tours"} component={CustomTours} />
      <Route path={"/china-visa"} component={ChinaVisa} />
      <Route path={"/china-visa/success"} component={ChinaVisaSuccess} />
      <Route path={"/china-visa/status/:id"} component={ChinaVisaStatus} />
      <Route path={"/visa-services"}>{() => { if (typeof window !== 'undefined') window.location.replace("/china-visa"); return null; }}</Route>
      <Route path={"/group-packages"} component={GroupPackages} />
      <Route path={"/flight-booking"} component={FlightBooking} />
      <Route path={"/airport-transfer"} component={AirportTransfer} />
      <Route path={"/hotel-booking"} component={HotelBooking} />
      <Route path={"/about-us"} component={AboutUs} />
      <Route path={"/terms-of-service"} component={TermsOfService} />
      <Route path={"/privacy-policy"} component={PrivacyPolicy} />
      <Route path={"/faq"} component={FAQ} />
      <Route path={"/contact-us"} component={ContactUs} />
      <Route path={"/emergency"} component={Emergency} />
      <Route path={"/membership"} component={Membership} />
      <Route path={"/membership-terms"} component={MembershipTerms} />
      <Route path={"/rewards"} component={Rewards} />

      {/* v4 後台重建 — preview at /ops while iterating */}
      <Route path={"/ops/customers"}>{() => <AdminShell><AdminCustomers /></AdminShell>}</Route>
      <Route path={"/ops/tours"}>{() => <AdminShell><AdminTours /></AdminShell>}</Route>
      <Route path={"/ops/finance"}>{() => <AdminShell><FinanceCockpit /></AdminShell>}</Route>
      <Route path={"/ops/marketing"}>{() => <AdminShell><AdminMarketing /></AdminShell>}</Route>
      <Route path={"/ops/settings"}>{() => <AdminShell><AdminSettings /></AdminShell>}</Route>
      <Route path={"/ops"}>{() => <AdminShell><AdminHome /></AdminShell>}</Route>

      {/* Round 80.9: internal preview routes (mockups for product decisions) */}
      <Route path={"/preview/ai-advisor-mockup"} component={AIAdvisorMockup} />
      <Route path={"/preview/tours-tab-mockup"} component={ToursTabMockup} />

      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
    </Suspense>
    </>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <LocaleProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
            <CookieConsentBanner />
          </TooltipProvider>
        </LocaleProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;


