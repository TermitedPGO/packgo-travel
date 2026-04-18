import { useState, useEffect } from "react";
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
import { trackBeginCheckout } from "@/lib/analytics";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

type BookingStep = "date" | "travelers" | "details" | "confirm";

export default function BookTour() {
  const { t, language } = useLocale();
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
  
  // Participant details
  const [participants, setParticipants] = useState<any[]>([]);
  
  // Queries
  const { data: tour, isLoading: tourLoading } = trpc.tours.getById.useQuery({ id: tourId });
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
  
  const totalPrice = calculateTotalPrice();
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

    try {
      const totalParticipants = numberOfAdults + numberOfChildrenWithBed + numberOfChildrenNoBed + numberOfInfants;
      const booking = await createBookingMutation.mutateAsync({
        tourId,
        participants: totalParticipants,
        contactName: customerName,
        contactEmail: customerEmail,
        contactPhone: customerPhone,
        specialRequests: message,
      });
      
      toast.success(t('bookTour.bookingSuccess'), {
        description: t('bookTour.bookingSuccessDesc').replace('{id}', booking.id.toString()),
      });
      
      // Navigate to booking detail page after a short delay
      setTimeout(() => {
        navigate(`/booking/${booking.id}`);
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
  
  if (tourLoading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
      <SEO title="預訂行程" description="預訂 PACK&GO 旅遊行程，填寫旅客資料完成預訂，開始您的旅遊之旅。" url="/book" />
        <Loader2 className="h-8 w-8 animate-spin" />
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
          返回行程詳情
        </button>
        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {[
              { key: "date", label: t('bookTour.steps.date'), icon: Calendar },
              { key: "travelers", label: t('bookTour.steps.travelers'), icon: Users },
              { key: "details", label: t('bookTour.steps.details'), icon: CreditCard },
              { key: "confirm", label: t('bookTour.steps.confirm'), icon: CheckCircle },
            ].map((step, index) => {
              const Icon = step.icon;
              const isActive = currentStep === step.key;
              const isCompleted = 
                (step.key === "date" && selectedDepartureId) ||
                (step.key === "travelers" && numberOfAdults > 0) ||
                (step.key === "details" && customerName && customerEmail && customerPhone);
              
              return (
                <div key={step.key} className="flex-1 flex items-center">
                  <div className="flex flex-col items-center flex-1">
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
                  {index < 3 && (
                    <div
                      className={`h-0.5 flex-1 ${
                        isCompleted ? "bg-gray-800" : "bg-gray-300"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        
        {/* Tour Info */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{tour.title}</CardTitle>
            <CardDescription>
              {tour.destination} · {tour.duration} {t('common.days')}
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
                    
                    return (
                      <div
                        key={departure.id}
                        className={`border rounded-lg p-4 cursor-pointer transition-all ${
                          selectedDepartureId === departure.id
                            ? "border-black bg-gray-50"
                            : isAvailable
                            ? "border-gray-300 hover:border-gray-400"
                            : "border-gray-200 bg-gray-100 cursor-not-allowed opacity-60"
                        }`}
                        onClick={() => isAvailable && setSelectedDepartureId(departure.id)}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-bold text-lg">
                              {new Date(departure.departureDate).toLocaleDateString(getLocaleString(), {
                                year: "numeric",
                                month: "long",
                                day: "numeric",
                              })}
                            </div>
                            <div className="text-sm text-gray-600 mt-1">
                              {t('bookTour.returnDate')}：{new Date(departure.returnDate).toLocaleDateString(getLocaleString())}
                            </div>
                            <div className="text-sm text-gray-600 mt-1">
                              {t('bookTour.remainingSlots')}：{availableSlots} / {departure.totalSlots}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-2xl font-bold">
                              {departure.currency} ${departure.adultPrice.toLocaleString()}
                            </div>
                            <div className="text-sm text-gray-600">{t('bookTour.perPerson')}</div>
                          </div>
                        </div>
                        {!isAvailable && (
                          <div className="mt-2 text-sm text-red-600 font-medium">
                            {departure.status === "cancelled" ? t('bookTour.cancelled') : t('bookTour.soldOut')}
                          </div>
                        )}
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
        
        {/* Step 2: Traveler Configuration */}
        {currentStep === "travelers" && selectedDeparture && (
          <Card>
            <CardHeader>
              <CardTitle>{t('bookTour.selectTravelers')}</CardTitle>
              <CardDescription>{t('bookTour.selectTravelersDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="adults">{t('bookTour.adults')}</Label>
                  <Input
                    id="adults"
                    type="number"
                    min="0"
                    value={numberOfAdults}
                    onChange={(e) => setNumberOfAdults(parseInt(e.target.value) || 0)}
                    className="mt-1"
                  />
                  <div className="text-sm text-gray-600 mt-1">
                    ${selectedDeparture.adultPrice.toLocaleString()} / {t('common.person')}
                  </div>
                </div>
                
                {selectedDeparture.childPriceWithBed && (
                  <div>
                    <Label htmlFor="childrenWithBed">{t('bookTour.childrenWithBed')}</Label>
                    <Input
                      id="childrenWithBed"
                      type="number"
                      min="0"
                      value={numberOfChildrenWithBed}
                      onChange={(e) => setNumberOfChildrenWithBed(parseInt(e.target.value) || 0)}
                      className="mt-1"
                    />
                    <div className="text-sm text-gray-600 mt-1">
                      ${selectedDeparture.childPriceWithBed.toLocaleString()} / {t('common.person')}
                    </div>
                  </div>
                )}
                
                {selectedDeparture.childPriceNoBed && (
                  <div>
                    <Label htmlFor="childrenNoBed">{t('bookTour.childrenNoBed')}</Label>
                    <Input
                      id="childrenNoBed"
                      type="number"
                      min="0"
                      value={numberOfChildrenNoBed}
                      onChange={(e) => setNumberOfChildrenNoBed(parseInt(e.target.value) || 0)}
                      className="mt-1"
                    />
                    <div className="text-sm text-gray-600 mt-1">
                      ${selectedDeparture.childPriceNoBed.toLocaleString()} / {t('common.person')}
                    </div>
                  </div>
                )}
                
                {selectedDeparture.infantPrice && (
                  <div>
                    <Label htmlFor="infants">{t('bookTour.infants')}</Label>
                    <Input
                      id="infants"
                      type="number"
                      min="0"
                      value={numberOfInfants}
                      onChange={(e) => setNumberOfInfants(parseInt(e.target.value) || 0)}
                      className="mt-1"
                    />
                    <div className="text-sm text-gray-600 mt-1">
                      ${selectedDeparture.infantPrice.toLocaleString()} / {t('common.person')}
                    </div>
                  </div>
                )}
                
                {selectedDeparture.singleRoomSupplement && (
                  <div>
                    <Label htmlFor="singleRooms">{t('bookTour.singleRooms')}</Label>
                    <Input
                      id="singleRooms"
                      type="number"
                      min="0"
                      value={numberOfSingleRooms}
                      onChange={(e) => setNumberOfSingleRooms(parseInt(e.target.value) || 0)}
                      className="mt-1"
                    />
                    <div className="text-sm text-gray-600 mt-1">
                      ${selectedDeparture.singleRoomSupplement.toLocaleString()} / {t('bookTour.perRoom')}
                    </div>
                  </div>
                )}
              </div>
              
              {/* Price Summary */}
              <div className="border-t pt-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-lg">
                    <span>{t('bookTour.totalAmount')}</span>
                    <span className="font-bold">${totalPrice.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>{t('bookTour.deposit')}</span>
                    <span>${depositAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>{t('bookTour.balance')}</span>
                    <span>${(totalPrice - depositAmount).toLocaleString()}</span>
                  </div>
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
                  <div>{t('bookTour.tour')}：{tour.title}</div>
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
              
              <div className="border-t pt-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-lg">
                    <span className="font-bold">{t('bookTour.totalAmount')}</span>
                    <span className="font-bold">${totalPrice.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>{t('bookTour.deposit')}</span>
                    <span>${depositAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>{t('bookTour.balance')}</span>
                    <span>${(totalPrice - depositAmount).toLocaleString()}</span>
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
                  {language === 'en'
                    ? 'California Seller of Travel Disclosures'
                    : '加州旅遊業者法定揭露'}
                </p>
                <p>
                  {language === 'en'
                    ? 'Pack & Go, LLC · CST #2166984-40 · 39055 Cedar Blvd #126, Newark, CA 94560 · +1 (510) 634-2307.'
                    : 'Pack & Go, LLC · 加州旅遊業者登記 #2166984-40 · 39055 Cedar Blvd #126, Newark, CA 94560 · +1 (510) 634-2307。'}
                </p>
                <p>
                  {language === 'en'
                    ? 'California law requires certain sellers of travel to have a trust account or bond. This business has a trust account at Bank of America, N.A. All customer funds are deposited directly into that account in compliance with California Business & Professions Code §17550.15.'
                    : '加州法律要求特定旅遊業者持有信託帳戶或履約保證。本公司於 Bank of America, N.A. 開立客戶信託帳戶，所有旅客款項依加州 B&P §17550.15 規定直接存入該帳戶。'}
                </p>
                <p>
                  {language === 'en'
                    ? 'Pack & Go is a participant in the California Travel Consumer Restitution Fund (TCRF). California residents who believe a seller of travel has defaulted may file a claim with the Travel Consumer Restitution Corporation (https://tcrcinfo.org) within 12 months after the scheduled completion of travel. Claim limits are set by statute. If you are NOT a California resident, this transaction is NOT covered by the TCRF.'
                    : 'Pack & Go 為加州旅客消費補償基金（TCRF）參與者。加州居民如認為旅遊業者違約，得於原定行程結束後 12 個月內向 Travel Consumer Restitution Corporation (https://tcrcinfo.org) 提出理賠申請，上限依法規定。若您並非加州居民，本交易不受 TCRF 保障。'}
                </p>
                <p>
                  {language === 'en'
                    ? 'Upon cancellation, all sums paid for services not provided will be promptly refunded, unless you have cancelled in violation of terms clearly disclosed and agreed to. Supplier-side penalties (airline, hotel, cruise) are passed through at cost.'
                    : '取消時，本公司將即時退還未提供服務之款項，但您違反已揭露且同意之取消條款者除外。供應商端罰款（航空公司、飯店、郵輪）將依實際金額轉嫁。'}
                </p>
                <p className="italic text-gray-500">
                  {language === 'en'
                    ? 'Registration as a seller of travel does not constitute approval by the State of California.'
                    : '旅遊業者登記不代表加州政府之背書。'}
                </p>
              </div>

              <div className="flex justify-between mt-6">
                <Button variant="outline" onClick={() => setCurrentStep("details")}>
                  {t('bookTour.previousStep')}
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={createBookingMutation.isPending}
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
