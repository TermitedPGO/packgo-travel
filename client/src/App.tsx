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
const Admin = lazy(() => import("./pages/Admin"));
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
const SearchResults = lazy(() => import("./pages/SearchResults"));
const Tours = lazy(() => import("./pages/Tours"));
const RegionPage = lazy(() => import("./pages/RegionPage"));
const CountryPage = lazy(() => import("./pages/CountryPage"));
const CruisePage = lazy(() => import("./pages/CruisePage"));
const PaymentSuccess = lazy(() => import("./pages/PaymentSuccess"));
const PaymentFailure = lazy(() => import("./pages/PaymentFailure"));
const TaskHistory = lazy(() => import("./pages/TaskHistory"));

// ─── Loading fallback ─────────────────────────────────────────────────────────
function PageLoader() {
  const { t } = useLocale();
  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin" />
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

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <>
    <RouteTracker />
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
      <Route path={"/admin"} component={Admin} />
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


