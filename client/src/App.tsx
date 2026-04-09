import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import { useEffect } from "react";
import { trackPageView } from "@/lib/analytics";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LocaleProvider } from "./contexts/LocaleContext";
import Home from "./pages/Home";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Admin from "./pages/Admin";
import DiagnosticsPage from "./pages/admin/DiagnosticsPage";
import Profile from "./pages/Profile";
import TourDetailPeony from "./pages/TourDetailPeony";
import TourPrintView from "./pages/TourPrintView";
import BookTour from "./pages/BookTour";
import BookingDetail from "./pages/BookingDetail";
import QuickInquiry from "./pages/QuickInquiry";
import CustomTourRequest from "./pages/CustomTourRequest";
import CustomTours from "./pages/CustomTours";
import ChinaVisa from "./pages/ChinaVisa";
import ChinaVisaSuccess from "./pages/ChinaVisaSuccess";
import ChinaVisaStatus from "./pages/ChinaVisaStatus";
import GroupPackages from "./pages/GroupPackages";
import FlightBooking from "./pages/FlightBooking";
import AirportTransfer from "./pages/AirportTransfer";
import HotelBooking from "./pages/HotelBooking";
import AboutUs from "./pages/AboutUs";
import TermsOfService from "./pages/TermsOfService";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import FAQ from "./pages/FAQ";
import ContactUs from "./pages/ContactUs";
import SearchResults from "./pages/SearchResults";
import Tours from "./pages/Tours";
import RegionPage from "./pages/RegionPage";
import CountryPage from "./pages/CountryPage";
import CruisePage from "./pages/CruisePage";
import PaymentSuccess from "./pages/PaymentSuccess";
import PaymentFailure from "./pages/PaymentFailure";
import TaskHistory from "./pages/TaskHistory";

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
          </TooltipProvider>
        </LocaleProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
