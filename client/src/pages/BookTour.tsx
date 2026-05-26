import { useState, useEffect, useRef, Fragment } from "react";
import SEO from "@/components/SEO";
import { useParams, useLocation, useRoute } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Calendar, Users, CreditCard, CheckCircle, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { useLocale } from "@/contexts/LocaleContext";
import { translateDestination } from "@/utils/locationMapping";
import { trackBeginCheckout } from "@/lib/analytics";
import { track as trackPosthog } from "@/_core/analytics";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

type BookingStep = "date" | "travelers" | "details" | "confirm";
const BOOKING_STEP_ORDER: BookingStep[] = ["date", "travelers", "details", "confirm"];

export default function BookTour() {
  const { t, language, formatPrice } = useLocale();
  const params = useParams();
  const [, navigate] = useLocation();
  const { user, loading: authLoading } = useAuth();
  
  const tourId = params.id ? parseInt(params.id) : 0;
  const [currentStep, setCurrentStep] = useState<BookingStep>("date");
  
  // Selected data
  const [selectedDepartureId, setSelectedDepartureId] = useState<number | null>(null);
  const [numberOfAdults, setNumberOfAdults] = useState(1);
  const [numberOfChildrenWithBed, setNumberOfChildrenWithBed] = useState(0);
  const [numberOfChildrenNoBed, setNumberOfChildrenNoBed] = useState(0);
  const [numberOfInfants, setNumberOfInfants] = useState(0);
  const [numberOfSingleRooms, setNumberOfSingleRooms] = useState(0);
  
  // Customer details
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [message, setMessage] = useState("");
  // v76: explicit consent to CST disclosures + cancellation policy. Required by
  // CA B&P §17550 — buyer must affirm receipt of mandatory disclosures before
  // payment. Without this, the booking cannot be submitted.
  const [acceptedDisclosures, setAcceptedDisclosures] = useState(false);

  // Round 80.22: Packpoint redemption — how many points to apply to this
  // booking. 0 = none; max is capped at min(balance, 50% of subtotal × 100).
  // Only USD departures honor this server-side; UI hides the input on TWD.
  const [pointsToRedeem, setPointsToRedeem] = useState(0);
  const { data: packpointStatus } = trpc.packpoint.getStatus.useQuery();
  
  // Participant details
  const [participants, setParticipants] = useState<any[]>([]);
  
  // Queries
  const { data: tour, isLoading: tourLoading } = trpc.tours.getById.useQuery({ id: tourId });

  // Fetch single-tour translation when not in Chinese mode
  const { data: tourTranslation } = trpc.translation.getTourTranslations.useQuery(
    { tourId, targetLanguage: language as 'zh-TW' | 'en' | 'ja' | 'ko' },
    { enabled: language !== 'zh-TW' && tourId > 0 }
  );
  const displayTitle = language === 'zh-TW'
    ? (tour?.title || '')
    : (tourTranslation?.title || tour?.title || '');
  const { data: departures, isLoading: departuresLoading } = trpc.departures.listByTour.useQuery({ tourId });
  const createBookingMutation = trpc.bookings.create.useMutation();
  
  const selectedDeparture = departures?.find(d => d.id === selectedDepartureId);
  
  // Pre-fill customer details from user
  useEffect(() => {
    if (user && !customerName) {
      setCustomerName(user.name || "");
      setCustomerEmail(user.email || "");
    }
  }, [user, customerName]);

  // v2 Wave 1 Module 1.4 — PostHog `booking_start`. Fires once when the
  // tour resolves (user reached the booking page with a valid tour id).
  // Tour price uses `tour.price` directly — the departure-specific price
  // isn't selected yet at this point.
  const bookingStartFiredRef = useRef(false);
  useEffect(() => {
    if (!tour || bookingStartFiredRef.current) return;
    bookingStartFiredRef.current = true;
    trackPosthog("booking_start", {
      tourId: tour.id,
      tourPrice: (tour as any).price ?? 0,
    });
  }, [tour]);

  // v2 Wave 1 Module 1.4 — PostHog `booking_step` on each step transition.
  // Step names ("date" | "travelers" | "details" | "confirm") mirror the
  // local `BookingStep` union — keep them in sync. stepIndex is the 0-based
  // position in `BOOKING_STEP_ORDER`.
  useEffect(() => {
    if (!tour) return;
    trackPosthog("booking_step", {
      tourId: tour.id,
      stepName: currentStep,
      stepIndex: BOOKING_STEP_ORDER.indexOf(currentStep),
    });
  }, [currentStep, tour?.id]);
  
  // Calculate total price
  const calculateTotalPrice = () => {
    if (!selectedDeparture) return 0;
    
    let total = 0;
    total += numberOfAdults * selectedDeparture.adultPrice;
    if (selectedDeparture.childPriceWithBed) {
      total += numberOfChildrenWithBed * selectedDeparture.childPriceWithBed;
    }
    if (selectedDeparture.childPriceNoBed) {
      total += numberOfChildrenNoBed * selectedDeparture.childPriceNoBed;
    }
    if (selectedDeparture.infantPrice) {
      total += numberOfInfants * selectedDeparture.infantPrice;
    }
    if (selectedDeparture.singleRoomSupplement) {
      total += numberOfSingleRooms * selectedDeparture.singleRoomSupplement;
    }
    
    return total;
  };
  
  const subtotalPrice = calculateTotalPrice();
  // Round 80.22 Phase D: Packpoint discount supports any currency via FX.
  // Frontend displays USD value (100 pt = $1); server converts to booking
  // currency at the time of booking. The 50% cap uses balance × 100 (worst
  // case: every pt redeemed even if FX makes it more than 50% of subtotal).
  const bookingCurrency = ((selectedDeparture?.currency || "TWD") as string).toUpperCase();
  const balance = packpointStatus?.balance ?? 0;
  const maxRedeemableByBalance = balance;
  // Cap at 50% of subtotal (policy §5). For TWD bookings, ~31 TWD = 100 pt;
  // for USD bookings, $1 = 100 pt. Approximation: use 100 pt = 1 unit of
  // booking currency for the slider cap (server enforces the real cap).
  const maxRedeemableByPolicy = Math.floor(subtotalPrice * 50);
  const maxRedeemable = Math.min(maxRedeemableByBalance, maxRedeemableByPolicy);
  const safePointsToRedeem = Math.min(pointsToRedeem, maxRedeemable);
  // Display discount in USD (100 pt = $1). Server will convert at FX time.
  const packpointDiscount = safePointsToRedeem / 100;
  const totalPrice = Math.max(0, subtotalPrice - packpointDiscount);
  const depositAmount = Math.round(totalPrice * 0.2);
  
  // Get locale string for date formatting
  const getLocaleString = () => {
    switch (language) {
      case 'en': return 'en-US';
      default: return 'zh-TW';
    }
  };
  
  // Handle booking submission
  const handleSubmit = async () => {
    if (!user) {
      toast.error(t('bookTour.loginRequired'), {
        description: t('bookTour.loginRequiredDesc'),
      });
      window.location.href = getLoginUrl();
      return;
    }
    
    if (!selectedDepartureId) {
      toast.error(t('bookTour.selectDateFirst'));
      return;
    }
    
    if (numberOfAdults === 0 && numberOfChildrenWithBed === 0 && numberOfChildrenNoBed === 0) {
      toast.error(t('bookTour.selectTravelerFirst'));
      return;
    }
    
    if (!customerName || !customerEmail || !customerPhone) {
      toast.error(t('bookTour.fillAllInfo'));
      return;
    }
    
    // Validate participants
    const totalPeople = numberOfAdults + numberOfChildrenWithBed + numberOfChildrenNoBed + numberOfInfants;
    if (participants.length !== totalPeople) {
      toast.error(t('bookTour.fillAllTravelers'));
      return;
    }
    
    // GA4: begin_checkout event
    if (tour) {
      trackBeginCheckout({
        tourId: tour.id,
        tourName: tour.title,
        price: totalPrice,
        currency: "TWD",
        numTravelers: numberOfAdults + numberOfChildrenWithBed + numberOfChildrenNoBed + numberOfInfants,
      });
    }

    if (!selectedDepartureId) {
      toast.error(t('bookTour.pickDepartureFirst'));
      return;
    }
    try {
      // v74: pass per-passenger breakdown + departureId so server can compute
      // the canonical total price using departure-specific rates (was previously
      // ignoring child/infant pricing on the server side).
      const booking = await createBookingMutation.mutateAsync({
        tourId,
        departureId: selectedDepartureId,
        numberOfAdults,
        numberOfChildrenWithBed,
        numberOfChildrenNoBed,
        numberOfInfants,
        numberOfSingleRooms: 0,
        contactName: customerName,
        contactEmail: customerEmail,
        contactPhone: customerPhone,
        specialRequests: message,
        // v78x: pass current locale so booking confirmation email matches customer's UI language
        language: language === "en" ? "en" : "zh-TW",
        // Round 80.22: pass redemption (server validates against balance + caps)
        pointsToRedeem: safePointsToRedeem > 0 ? safePointsToRedeem : undefined,
      });

      // v2 Wave 1 Module 1.4 — PostHog booking_complete. Fires only on
      // successful mutation; bookingId comes from the server response.
      trackPosthog("booking_complete", {
        tourId,
        bookingId: booking.id,
        totalAmount: totalPrice,
        participantCount:
          numberOfAdults + numberOfChildrenWithBed + numberOfChildrenNoBed + numberOfInfants,
      });

      toast.success(t('bookTour.bookingSuccess'), {
        description: t('bookTour.bookingSuccessDesc').replace('{id}', booking.id.toString()),
      });
      
      // Navigate to booking detail page after a short delay.
      // App.tsx route is "/bookings/:id" (plural). Was "/booking/" before
      // which silently 404'd post-checkout — users got a 404 right after
      // a successful booking submit. Fixed to plural to match the route.
      setTimeout(() => {
        navigate(`/bookings/${booking.id}`);
      }, 1500);
    } catch (error: any) {
      toast.error(t('bookTour.bookingFailed'), {
        description: error.message || t('bookTour.tryAgain'),
      });
    }
  };
  
  // Initialize participants array when traveler numbers change
  useEffect(() => {
    const totalPeople = numberOfAdults + numberOfChildrenWithBed + numberOfChildrenNoBed + numberOfInfants;
    const newParticipants = [];
    
    for (let i = 0; i < numberOfAdults; i++) {
      newParticipants.push({
        participantType: "adult",
        firstName: participants[i]?.firstName || "",
        lastName: participants[i]?.lastName || "",
        gender: participants[i]?.gender || undefined,
        dateOfBirth: participants[i]?.dateOfBirth || "",
        passportNumber: participants[i]?.passportNumber || "",
        passportExpiry: participants[i]?.passportExpiry || "",
        nationality: participants[i]?.nationality || "",
        dietaryRequirements: participants[i]?.dietaryRequirements || "",
        specialNeeds: participants[i]?.specialNeeds || "",
      });
    }
    
    for (let i = 0; i < numberOfChildrenWithBed + numberOfChildrenNoBed; i++) {
      const idx = numberOfAdults + i;
      newParticipants.push({
        participantType: "child",
        firstName: participants[idx]?.firstName || "",
        lastName: participants[idx]?.lastName || "",
        gender: participants[idx]?.gender || undefined,
        dateOfBirth: participants[idx]?.dateOfBirth || "",
        passportNumber: participants[idx]?.passportNumber || "",
        passportExpiry: participants[idx]?.passportExpiry || "",
        nationality: participants[idx]?.nationality || "",
        dietaryRequirements: participants[idx]?.dietaryRequirements || "",
        specialNeeds: participants[idx]?.specialNeeds || "",
      });
    }
    
    for (let i = 0; i < numberOfInfants; i++) {
      const idx = numberOfAdults + numberOfChildrenWithBed + numberOfChildrenNoBed + i;
      newParticipants.push({
        participantType: "infant",
        firstName: participants[idx]?.firstName || "",
        lastName: participants[idx]?.lastName || "",
        gender: participants[idx]?.gender || undefined,
        dateOfBirth: participants[idx]?.dateOfBirth || "",
        passportNumber: participants[idx]?.passportNumber || "",
        passportExpiry: participants[idx]?.passportExpiry || "",
        nationality: participants[idx]?.nationality || "",
        dietaryRequirements: participants[idx]?.dietaryRequirements || "",
        specialNeeds: participants[idx]?.specialNeeds || "",
      });
    }
    
    setParticipants(newParticipants);
  }, [numberOfAdults, numberOfChildrenWithBed, numberOfChildrenNoBed, numberOfInfants]);
  
  // v71: was only checking tourLoading + authLoading; departuresLoading was
  // missing → page rendered with a half-loaded form (price calculator pulled
  // from undefined departures) until the second query landed. Now we show a
  // proper skeleton until ALL critical queries complete.
  if (tourLoading || authLoading || departuresLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SEO
          title={{ zh: "預訂行程", en: "Book Tour" }}
          description={{
            zh: "預訂 PACK&GO 旅遊行程，填寫旅客資料完成預訂，開始您的旅遊之旅。",
            en: "Book your PACK&GO tour — fill in traveler details to complete your reservation and start your journey.",
          }}
          url="/book"
        />
        <div className="container mx-auto px-4 py-8 max-w-5xl animate-pulse">
          {/* Title skeleton */}
          <div className="h-8 w-2/3 bg-gray-200 rounded-lg mb-3" />
          <div className="h-4 w-1/3 bg-gray-200 rounded-lg mb-8" />
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Form column skeleton */}
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-white rounded-xl p-6 border border-gray-100 space-y-3">
                <div className="h-5 w-1/4 bg-gray-200 rounded" />
                <div className="h-10 w-full bg-gray-100 rounded-lg" />
                <div className="h-10 w-full bg-gray-100 rounded-lg" />
                <div className="h-10 w-3/4 bg-gray-100 rounded-lg" />
              </div>
              <div className="bg-white rounded-xl p-6 border border-gray-100 space-y-3">
                <div className="h-5 w-1/3 bg-gray-200 rounded" />
                <div className="h-24 w-full bg-gray-100 rounded-lg" />
              </div>
            </div>
            {/* Summary column skeleton */}
            <div className="bg-white rounded-xl p-6 border border-gray-100 space-y-3 h-fit">
              <div className="h-6 w-1/2 bg-gray-200 rounded" />
              <div className="h-4 w-full bg-gray-100 rounded" />
              <div className="h-4 w-5/6 bg-gray-100 rounded" />
              <div className="h-12 w-full bg-gray-200 rounded-lg mt-4" />
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  if (!tour) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">{t('bookTour.tourNotFound')}</h1>
          <Button onClick={() => navigate("/")}>{t('common.backToHome')}</Button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-1 py-12">
      <div className="container max-w-4xl">
        {/* Back Button */}
        <button
          onClick={() => navigate(`/tours/${tourId}`)}
          className="flex items-center gap-2 text-gray-600 hover:text-black transition-colors mb-6 text-sm font-medium"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('bookTour.backToTourDetail')}
        </button>
        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {[
              { key: "date", label: t('bookTour.steps.date'), icon: Calendar },
              { key: "travelers", label: t('bookTour.steps.travelers'), icon: Users },
              { key: "details", label: t('bookTour.steps.details'), icon: CreditCard },
              { key: "confirm", label: t('bookTour.steps.confirm'), icon: CheckCircle },
            ].map((step, index, arr) => {
              const Icon = step.icon;
              const isActive = currentStep === step.key;
              const isCompleted =
                (step.key === "date" && selectedDepartureId) ||
                (step.key === "travelers" && numberOfAdults > 0) ||
                (step.key === "details" && customerName && customerEmail && customerPhone);

              return (
                <Fragment key={step.key}>
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-12 h-12 rounded-lg flex items-center justify-center border-2 ${
                        isActive
                          ? "bg-black text-white border-black"
                          : isCompleted
                          ? "bg-gray-800 text-white border-gray-800"
                          : "bg-white text-gray-400 border-gray-300"
                      }`}
                    >
                      <Icon className="h-6 w-6" />
                    </div>
                    <span className={`mt-2 text-xs sm:text-sm hidden sm:block ${isActive ? "font-bold" : ""}`}>
                      {step.label}
                    </span>
                  </div>
                  {index < arr.length - 1 && (
                    <div
                      className={`h-0.5 flex-1 mx-2 ${
                        isCompleted ? "bg-gray-800" : "bg-gray-300"
                      }`}
                    />
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
        
        {/* Tour Info */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{displayTitle}</CardTitle>
            <CardDescription>
              {translateDestination(tour.destination || '', language)} · {tour.duration} {t('common.days')}
            </CardDescription>
          </CardHeader>
        </Card>
        
        {/* Step 1: Date Selection */}
        {currentStep === "date" && (
          <Card>
            <CardHeader>
              <CardTitle>{t('bookTour.selectDate')}</CardTitle>
              <CardDescription>{t('bookTour.selectDateDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              {departuresLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : departures && departures.length > 0 ? (
                <div className="space-y-4">
                  {departures.map(departure => {
                    const availableSlots = departure.totalSlots - departure.bookedSlots;
                    const isAvailable = availableSlots > 0 && departure.status === "open";
                    // v78s: status pill labels matching tour list cards
                    const statusPill =
                      departure.status === "cancelled"
                        ? { label: t("bookTour.cancelled"), cls: "bg-red-50 text-red-700 border-red-200" }
                        : departure.status === "full" || availableSlots <= 0
                          ? { label: t("bookTour.soldOut"), cls: "bg-gray-100 text-gray-500 border-gray-200" }
                          : (departure as any).status === "confirmed"
                            ? { label: t("bookTour.confirmedDeparture"), cls: "bg-[#c9a563]/15 text-[#8a6f3a] border-[#c9a563]/35" }
                            : { label: t("bookTour.availableForBooking"), cls: "bg-foreground/[0.04] text-foreground/75 border-foreground/15" };
                    const lowSeats = isAvailable && availableSlots > 0 && availableSlots <= 3;

                    return (
                      <div
                        key={departure.id}
                        className={`border-2 rounded-xl p-4 transition-all ${
                          selectedDepartureId === departure.id
                            ? "border-primary bg-primary/5 shadow-sm"
                            : isAvailable
                              ? "border-gray-200 hover:border-gray-400 cursor-pointer"
                              : "border-gray-200 bg-gray-50 cursor-not-allowed opacity-60"
                        }`}
                        onClick={() => isAvailable && setSelectedDepartureId(departure.id)}
                      >
                        <div className="flex justify-between items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <div className="font-bold text-base md:text-lg">
                                {new Date(departure.departureDate).toLocaleDateString(getLocaleString(), {
                                  year: "numeric", month: "long", day: "numeric",
                                })}
                              </div>
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border ${statusPill.cls}`}>
                                {statusPill.label}
                              </span>
                            </div>
                            <div className="text-xs md:text-sm text-gray-600 mt-1">
                              {t('bookTour.returnDate')}：{new Date(departure.returnDate).toLocaleDateString(getLocaleString())}
                            </div>
                            <div className={`text-xs md:text-sm mt-1 ${lowSeats ? "text-amber-700 font-medium" : "text-gray-600"}`}>
                              {lowSeats && (
                                <span className="inline-flex items-center gap-1 mr-2">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                </span>
                              )}
                              {t('bookTour.remainingSlots')}：{availableSlots} / {departure.totalSlots}
                              {lowSeats && t("bookTour.almostFull")}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-xl md:text-2xl font-bold" style={{ color: "#0d9488" }}>
                              {formatPrice(Number(departure.adultPrice), ((departure.currency as any) || "TWD"))}
                            </div>
                            <div className="text-xs text-gray-500">{t('bookTour.perPerson')}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-600">
                  {t('bookTour.noAvailableDates')}
                </div>
              )}
              
              <div className="flex justify-end mt-6">
                <Button
                  onClick={() => setCurrentStep("travelers")}
                  disabled={!selectedDepartureId}
                >
                  {t('bookTour.nextStep')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* Step 2: Traveler Configuration — v78t: stepper UI + status pills + formatPrice */}
        {currentStep === "travelers" && selectedDeparture && (
          <Card>
            <CardHeader>
              <CardTitle>{t('bookTour.selectTravelers')}</CardTitle>
              <CardDescription>{t('bookTour.selectTravelersDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* v78t: ±-stepper buttons replace bare number inputs (better mobile UX, friendlier).
                  Each row: [- 0 +] big touch targets, label left, price right. */}
              {(() => {
                const cur = (selectedDeparture.currency as any) || "TWD";
                type Row = { label: string; value: number; setValue: (n: number) => void; price: number; perKey: string };
                const rows: Row[] = [
                  { label: t('bookTour.adults'), value: numberOfAdults, setValue: setNumberOfAdults, price: selectedDeparture.adultPrice, perKey: 'common.person' },
                ];
                if (selectedDeparture.childPriceWithBed)
                  rows.push({ label: t('bookTour.childrenWithBed'), value: numberOfChildrenWithBed, setValue: setNumberOfChildrenWithBed, price: selectedDeparture.childPriceWithBed, perKey: 'common.person' });
                if (selectedDeparture.childPriceNoBed)
                  rows.push({ label: t('bookTour.childrenNoBed'), value: numberOfChildrenNoBed, setValue: setNumberOfChildrenNoBed, price: selectedDeparture.childPriceNoBed, perKey: 'common.person' });
                if (selectedDeparture.infantPrice)
                  rows.push({ label: t('bookTour.infants'), value: numberOfInfants, setValue: setNumberOfInfants, price: selectedDeparture.infantPrice, perKey: 'common.person' });
                if (selectedDeparture.singleRoomSupplement)
                  rows.push({ label: t('bookTour.singleRooms'), value: numberOfSingleRooms, setValue: setNumberOfSingleRooms, price: selectedDeparture.singleRoomSupplement, perKey: 'bookTour.perRoom' });
                return (
                  <div className="space-y-3">
                    {rows.map((row, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-3 p-4 rounded-xl border-2 border-gray-200 hover:border-gray-300 transition-colors">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900">{row.label}</p>
                          <p className="text-sm text-gray-500">
                            {formatPrice(Number(row.price), cur)} / {t(row.perKey)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => row.setValue(Math.max(0, row.value - 1))}
                            disabled={row.value <= 0}
                            className="w-9 h-9 rounded-full border border-gray-300 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed text-lg font-medium text-gray-700"
                            aria-label={`${t('common.decrease')} ${row.label}`}
                          >
                            −
                          </button>
                          <span className="w-8 text-center font-bold text-lg tabular-nums">{row.value}</span>
                          <button
                            type="button"
                            onClick={() => row.setValue(row.value + 1)}
                            className="w-9 h-9 rounded-full border border-gray-300 hover:bg-gray-100 text-lg font-medium text-gray-700"
                            aria-label={`${t('common.increase')} ${row.label}`}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Price Summary — v78t: card-style with currency-aware formatting */}
              <div className="rounded-xl border-2 border-gray-200 bg-gray-50 p-5 space-y-2.5">
                <div className="flex justify-between items-center pb-2 border-b border-gray-200">
                  <span className="text-base font-semibold text-gray-900">{t('bookTour.totalAmount')}</span>
                  <span className="text-2xl font-bold" style={{ color: "#0d9488" }}>
                    {formatPrice(totalPrice, ((selectedDeparture.currency as any) || "TWD"))}
                  </span>
                </div>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>{t('bookTour.deposit')}</span>
                  <span className="font-medium">{formatPrice(depositAmount, ((selectedDeparture.currency as any) || "TWD"))}</span>
                </div>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>{t('bookTour.balance')}</span>
                  <span className="font-medium">{formatPrice(totalPrice - depositAmount, ((selectedDeparture.currency as any) || "TWD"))}</span>
                </div>
              </div>

              <div className="flex justify-between mt-6">
                <Button variant="outline" onClick={() => setCurrentStep("date")}>
                  {t('bookTour.previousStep')}
                </Button>
                <Button
                  onClick={() => setCurrentStep("details")}
                  disabled={numberOfAdults === 0 && numberOfChildrenWithBed === 0 && numberOfChildrenNoBed === 0}
                >
                  {t('bookTour.nextStep')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* Step 3: Customer & Participant Details */}
        {currentStep === "details" && (
          <Card>
            <CardHeader>
              <CardTitle>{t('bookTour.fillDetails')}</CardTitle>
              <CardDescription>{t('bookTour.fillDetailsDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Customer Contact */}
              <div>
                <h3 className="font-bold text-lg mb-4">{t('bookTour.contactInfo')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="customerName">{t('bookTour.name')} *</Label>
                    <Input
                      id="customerName"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="mt-1"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="customerEmail">{t('bookTour.email')} *</Label>
                    <Input
                      id="customerEmail"
                      type="email"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      className="mt-1"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="customerPhone">{t('bookTour.phone')} *</Label>
                    <Input
                      id="customerPhone"
                      type="tel"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      className="mt-1"
                      required
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <Label htmlFor="message">{t('bookTour.notes')}</Label>
                  <Textarea
                    id="message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="mt-1"
                    rows={3}
                    placeholder={t('bookTour.notesPlaceholder')}
                  />
                </div>
              </div>
              
              {/* Participants */}
              <div>
                <h3 className="font-bold text-lg mb-4">{t('bookTour.travelerInfo')}</h3>
                <div className="space-y-6">
                  {participants.map((participant, index) => (
                    <div key={index} className="border rounded-lg p-4">
                      <h4 className="font-medium mb-3">
                        {t('bookTour.traveler')} {index + 1} ({participant.participantType === "adult" ? t('bookTour.adult') : participant.participantType === "child" ? t('bookTour.child') : t('bookTour.infant')})
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label>{t('bookTour.firstName')} *</Label>
                          <Input
                            value={participant.firstName}
                            onChange={(e) => {
                              const newParticipants = [...participants];
                              newParticipants[index].firstName = e.target.value;
                              setParticipants(newParticipants);
                            }}
                            className="mt-1"
                            required
                          />
                        </div>
                        <div>
                          <Label>{t('bookTour.lastName')} *</Label>
                          <Input
                            value={participant.lastName}
                            onChange={(e) => {
                              const newParticipants = [...participants];
                              newParticipants[index].lastName = e.target.value;
                              setParticipants(newParticipants);
                            }}
                            className="mt-1"
                            required
                          />
                        </div>
                        <div>
                          <Label>{t('bookTour.gender')}</Label>
                          <Select
                            value={participant.gender}
                            onValueChange={(value) => {
                              const newParticipants = [...participants];
                              newParticipants[index].gender = value;
                              setParticipants(newParticipants);
                            }}
                          >
                            <SelectTrigger className="mt-1">
                              <SelectValue placeholder={t('bookTour.selectGender')} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="male">{t('bookTour.male')}</SelectItem>
                              <SelectItem value="female">{t('bookTour.female')}</SelectItem>
                              <SelectItem value="other">{t('bookTour.other')}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>{t('bookTour.dateOfBirth')}</Label>
                          <Input
                            type="date"
                            value={participant.dateOfBirth}
                            onChange={(e) => {
                              const newParticipants = [...participants];
                              newParticipants[index].dateOfBirth = e.target.value;
                              setParticipants(newParticipants);
                            }}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label>{t('bookTour.passportNumber')}</Label>
                          <Input
                            value={participant.passportNumber}
                            onChange={(e) => {
                              const newParticipants = [...participants];
                              newParticipants[index].passportNumber = e.target.value;
                              setParticipants(newParticipants);
                            }}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label>{t('bookTour.passportExpiry')}</Label>
                          <Input
                            type="date"
                            value={participant.passportExpiry}
                            onChange={(e) => {
                              const newParticipants = [...participants];
                              newParticipants[index].passportExpiry = e.target.value;
                              setParticipants(newParticipants);
                            }}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label>{t('bookTour.nationality')}</Label>
                          <Input
                            value={participant.nationality}
                            onChange={(e) => {
                              const newParticipants = [...participants];
                              newParticipants[index].nationality = e.target.value;
                              setParticipants(newParticipants);
                            }}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label>{t('bookTour.dietaryRequirements')}</Label>
                          <Input
                            value={participant.dietaryRequirements}
                            onChange={(e) => {
                              const newParticipants = [...participants];
                              newParticipants[index].dietaryRequirements = e.target.value;
                              setParticipants(newParticipants);
                            }}
                            className="mt-1"
                            placeholder={t('bookTour.dietaryPlaceholder')}
                          />
                        </div>
                        <div className="md:col-span-2">
                          <Label>{t('bookTour.specialNeeds')}</Label>
                          <Input
                            value={participant.specialNeeds}
                            onChange={(e) => {
                              const newParticipants = [...participants];
                              newParticipants[index].specialNeeds = e.target.value;
                              setParticipants(newParticipants);
                            }}
                            className="mt-1"
                            placeholder={t('bookTour.specialNeedsPlaceholder')}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="flex justify-between mt-6">
                <Button variant="outline" onClick={() => setCurrentStep("travelers")}>
                  {t('bookTour.previousStep')}
                </Button>
                <Button onClick={() => setCurrentStep("confirm")}>
                  {t('bookTour.nextStep')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* Step 4: Confirmation */}
        {currentStep === "confirm" && selectedDeparture && (
          <Card>
            <CardHeader>
              <CardTitle>{t('bookTour.confirmBooking')}</CardTitle>
              <CardDescription>{t('bookTour.confirmBookingDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="font-bold mb-2">{t('bookTour.tourInfo')}</h3>
                <div className="text-sm space-y-1">
                  <div>{t('bookTour.tour')}：{displayTitle}</div>
                  <div>
                    {t('bookTour.departureDate')}：{new Date(selectedDeparture.departureDate).toLocaleDateString(getLocaleString())}
                  </div>
                  <div>
                    {t('bookTour.returnDate')}：{new Date(selectedDeparture.returnDate).toLocaleDateString(getLocaleString())}
                  </div>
                </div>
              </div>
              
              <div>
                <h3 className="font-bold mb-2">{t('bookTour.travelerCount')}</h3>
                <div className="text-sm space-y-1">
                  {numberOfAdults > 0 && <div>{t('bookTour.adults')}：{numberOfAdults} {t('bookTour.people')}</div>}
                  {numberOfChildrenWithBed > 0 && <div>{t('bookTour.childrenWithBed')}：{numberOfChildrenWithBed} {t('bookTour.people')}</div>}
                  {numberOfChildrenNoBed > 0 && <div>{t('bookTour.childrenNoBed')}：{numberOfChildrenNoBed} {t('bookTour.people')}</div>}
                  {numberOfInfants > 0 && <div>{t('bookTour.infants')}：{numberOfInfants} {t('bookTour.people')}</div>}
                  {numberOfSingleRooms > 0 && <div>{t('bookTour.singleRooms')}：{numberOfSingleRooms} {t('bookTour.rooms')}</div>}
                </div>
              </div>
              
              <div>
                <h3 className="font-bold mb-2">{t('bookTour.contactInfo')}</h3>
                <div className="text-sm space-y-1">
                  <div>{t('bookTour.name')}：{customerName}</div>
                  <div>{t('bookTour.email')}：{customerEmail}</div>
                  <div>{t('bookTour.phone')}：{customerPhone}</div>
                </div>
              </div>
              
              {/* Round 80.22 Phase D: Packpoint redemption. Available for any
                  currency (FX converted server-side). Show only when user has
                  100+ pts. Live USD-display; server re-validates with real FX. */}
              {balance >= 100 && subtotalPrice > 0 && (
                <div className="border-t pt-4">
                  <div className="rounded-xl border border-[#c9a563]/30 bg-[#FAF8F2] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-semibold text-foreground">
                          🪙 {t("bookTour.usePackpoint")}
                        </span>
                        <span className="text-xs text-foreground/60">
                          {t("bookTour.pointsBalance", { balance: balance.toLocaleString() })}
                        </span>
                      </div>
                      {packpointDiscount > 0 && (
                        <span className="text-sm font-semibold text-[#8a6f3a]">
                          -${packpointDiscount.toFixed(2)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={maxRedeemable}
                        step={100}
                        value={safePointsToRedeem}
                        onChange={(e) => setPointsToRedeem(parseInt(e.target.value, 10))}
                        className="flex-1 accent-[#c9a563]"
                      />
                      <input
                        type="number"
                        min={0}
                        max={maxRedeemable}
                        step={100}
                        value={pointsToRedeem}
                        onChange={(e) =>
                          setPointsToRedeem(
                            Math.min(maxRedeemable, Math.max(0, parseInt(e.target.value, 10) || 0))
                          )
                        }
                        className="w-24 h-9 px-2 rounded-lg border border-foreground/20 text-sm text-right tabular-nums"
                      />
                      <span className="text-xs text-foreground/60">{t("bookTour.pointsUnit")}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-foreground/50">
                      <span>{t("bookTour.pointsMin")}</span>
                      <span>{t("bookTour.pointsMaxLabel").replace("{max}", maxRedeemable.toLocaleString())}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="border-t pt-4">
                <div className="space-y-2">
                  {packpointDiscount > 0 && (
                    <>
                      <div className="flex justify-between text-sm text-gray-600">
                        <span>{t('bookTour.totalAmount')}({t('bookTour.totalBeforeDiscount')})</span>
                        <span>{formatPrice(subtotalPrice, bookingCurrency as any)}</span>
                      </div>
                      <div className="flex justify-between text-sm text-[#8a6f3a]">
                        <span>{t('bookTour.pointsDiscountRow', { points: safePointsToRedeem.toLocaleString() })}</span>
                        <span>-{formatPrice(packpointDiscount, bookingCurrency as any)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-lg">
                    <span className="font-bold">{t('bookTour.totalAmount')}</span>
                    <span className="font-bold">{formatPrice(totalPrice, bookingCurrency as any)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>{t('bookTour.deposit')}</span>
                    <span>{formatPrice(depositAmount, bookingCurrency as any)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>{t('bookTour.balance')}</span>
                    <span>{formatPrice(totalPrice - depositAmount, bookingCurrency as any)}</span>
                  </div>
                </div>
              </div>
              
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm">
                <p className="font-medium mb-2">{t('bookTour.paymentInfo')}：</p>
                <ul className="list-disc list-inside space-y-1 text-gray-700">
                  <li>{t('bookTour.paymentNote1')}</li>
                  <li>{t('bookTour.paymentNote2')}</li>
                  <li>{t('bookTour.paymentNote3')}</li>
                  <li>{t('bookTour.paymentNote4')}</li>
                </ul>
              </div>

              {/* California Seller of Travel mandatory disclosures
                  (CA B&P §§17550.13 – 17550.14; DOJ Disclosures From Sellers of Travel).
                  Required to appear on the booking confirmation / itinerary. */}
              <div className="rounded-xl border border-gray-300 bg-gray-50 p-4 text-xs text-gray-700 space-y-2">
                <p className="font-semibold text-gray-900">
                  {t('bookTour.cstTitle')}
                </p>
                <p>
                  {t('bookTour.cstEntity')}
                </p>
                <p>
                  {t('bookTour.cstTrust')}
                </p>
                <p>
                  {t('bookTour.cstTcrf')}
                </p>
                {/* v76: 3-business-day right of rescission required by CA B&P §17550.13 */}
                <p className="font-semibold text-gray-900">
                  {t('bookTour.cstThreeDayRight')}
                </p>
                <p>
                  {t('bookTour.cstCancellation')}
                </p>
                <p className="italic text-gray-500">
                  {t('bookTour.cstDisclaimer')}
                </p>
              </div>

              {/* v76: mandatory consent checkbox — without this the booking
                  button stays disabled. CA B&P §17550 requires affirmative
                  acknowledgement of disclosures before charging. */}
              <label className="flex items-start gap-3 mt-4 cursor-pointer rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300 transition-colors">
                <input
                  type="checkbox"
                  checked={acceptedDisclosures}
                  onChange={(e) => setAcceptedDisclosures(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-black focus:ring-black"
                />
                <span className="text-sm text-gray-700 leading-relaxed">
                  {t('bookTour.acceptDisclosures')}
                </span>
              </label>

              <div className="flex justify-between mt-6">
                <Button variant="outline" onClick={() => setCurrentStep("details")}>
                  {t('bookTour.previousStep')}
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={createBookingMutation.isPending || !acceptedDisclosures}
                  title={!acceptedDisclosures ? t('bookTour.acceptRequired') : undefined}
                >
                  {createBookingMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {t('bookTour.confirmBtn')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      </main>
      <Footer />
    </div>
  );
}
