import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { 
  Loader2, User, Calendar, LogOut, Heart, ShoppingBag, 
  MapPin, TrendingUp, Award, MessageSquare, ChevronRight, Package, Clock
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import AvatarUpload from "@/components/AvatarUpload";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { profileEditSchema, type ProfileEditFormData } from "@/lib/validationSchemas";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/contexts/LocaleContext";
import { translateDestination } from "@/utils/locationMapping";

export default function Profile() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [isEditing, setIsEditing] = useState(false);
  const { t } = useLocale();
  
  // Form setup
  const { register, handleSubmit, formState: { errors }, reset } = useForm<ProfileEditFormData>({
    resolver: zodResolver(profileEditSchema),
    defaultValues: {
      name: user?.name || "",
      phone: user?.phone || "",
      address: user?.address || "",
    },
  });
  
  // Update form when user data changes
  useEffect(() => {
    if (user) {
      reset({
        name: user.name || "",
        phone: user.phone || "",
        address: user.address || "",
      });
    }
  }, [user, reset]);
  
  // Avatar upload mutation
  const uploadAvatarMutation = trpc.auth.uploadAvatar.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
    },
  });
  
  // Avatar delete mutation
  const deleteAvatarMutation = trpc.auth.deleteAvatar.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
    },
  });
  
  const handleAvatarUpload = async (avatarUrl: string) => {
    try {
      await uploadAvatarMutation.mutateAsync({ avatarUrl });
    } catch (error) {
      console.error("Failed to update avatar:", error);
      alert(t('profile.avatarUpdateFailed'));
    }
  };
  
  const handleAvatarDelete = async () => {
    if (!confirm(t('profile.confirmDeleteAvatar'))) return;
    
    try {
      await deleteAvatarMutation.mutateAsync();
    } catch (error) {
      console.error("Failed to delete avatar:", error);
      alert(t('profile.avatarDeleteFailed'));
    }
  };
  
  // Profile update mutation
  const updateProfileMutation = trpc.auth.updateProfile.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      setIsEditing(false);
      alert(t('profile.updateSuccess'));
    },
    onError: (error: any) => {
      console.error("Failed to update profile:", error);
      alert(t('profile.updateFailed'));
    },
  });
  
  const onSubmit = async (data: ProfileEditFormData) => {
    try {
      await updateProfileMutation.mutateAsync(data);
    } catch (error) {
      // Error handled in mutation
    }
  };
  
  const handleCancelEdit = () => {
    setIsEditing(false);
    reset();
  };

  // Fetch user bookings
  const { data: bookings = [] } = trpc.bookings.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      window.location.href = getLoginUrl();
    }
  }, [loading, isAuthenticated]);

  const handleLogout = async () => {
    await logout();
    setLocation("/");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-black" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // Calculate statistics
  const completedTrips = bookings.filter((b: any) => b.bookingStatus === 'completed').length;
  const upcomingTrips = bookings.filter((b: any) => b.bookingStatus === 'confirmed').length;
  const totalSpent = bookings
    .filter((b: any) => b.paymentStatus === 'paid')
    .reduce((sum: number, b: any) => sum + parseFloat(b.totalPrice), 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Simple Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="container py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-black mb-1">{t('profile.title')}</h1>
              <p className="text-gray-500">Hi, {user.name}</p>
            </div>
            <div className="flex gap-3">
              <Button 
                onClick={() => setLocation("/")}
                variant="outline" 
                className="rounded-lg border-2 border-black hover:bg-black hover:text-white px-6"
              >
                {t('common.backToHome')}
              </Button>
              <Button 
                onClick={handleLogout}
                variant="outline" 
                className="rounded-lg border-2 border-black hover:bg-black hover:text-white px-6"
              >
                <LogOut className="h-4 w-4 mr-2" />
                {t('nav.logout')}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Sidebar - Profile Card */}
          <div className="lg:col-span-3">
            <Card className=" border border-gray-200 bg-white shadow-sm">
              <CardContent className="p-6">
                {/* Avatar */}
                <div className="flex flex-col items-center text-center mb-6">
                  <AvatarUpload 
                    currentAvatar={user.avatar || undefined}
                    onUploadComplete={handleAvatarUpload}
                    onDelete={handleAvatarDelete}
                  />
                  <h3 className="text-xl font-bold text-black">{user.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">{user.email}</p>
                  {user.role === 'admin' && (
                    <div className="mt-3 px-4 py-1 bg-black text-white text-xs font-bold rounded-lg">
                      {t('profile.admin')}
                    </div>
                  )}
                </div>

                {/* Profile Info / Edit Form */}
                <div className="border-t border-gray-200 pt-6">
                  {!isEditing ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 text-sm">
                        <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                          <User className="h-5 w-5 text-gray-600" />
                        </div>
                        <div className="flex-1">
                          <p className="text-gray-500 text-xs">{t('profile.memberId')}</p>
                          <p className="text-black font-medium">#{user.id}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                          <Calendar className="h-5 w-5 text-gray-600" />
                        </div>
                        <div className="flex-1">
                          <p className="text-gray-500 text-xs">{t('profile.registrationDate')}</p>
                          <p className="text-black font-medium">
                            {new Date(user.createdAt).toLocaleDateString('zh-TW')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                          <Award className="h-5 w-5 text-gray-600" />
                        </div>
                        <div className="flex-1">
                          <p className="text-gray-500 text-xs">{t('profile.memberLevel')}</p>
                          <p className="text-black font-medium">
                            {user.role === 'admin' ? t('profile.vipMember') : t('profile.regularMember')}
                          </p>
                        </div>
                      </div>
                      <Button 
                        onClick={() => setIsEditing(true)}
                        className="w-full mt-4 rounded-lg bg-black hover:bg-gray-800 text-white"
                      >
                        {t('profile.editProfile')}
                      </Button>
                    </div>
                  ) : (
                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                      <div>
                        <Label htmlFor="name" className="text-sm font-medium text-gray-700">
                          {t('auth.register.name')}
                        </Label>
                        <Input
                          id="name"
                          {...register("name")}
                          className="mt-1 rounded-lg border-2 border-gray-300 focus:border-black"
                          placeholder={t('auth.register.namePlaceholder')}
                        />
                        {errors.name && (
                          <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>
                        )}
                      </div>
                      <div>
                        <Label htmlFor="phone" className="text-sm font-medium text-gray-700">
                          {t('quickInquiry.form.phone')}
                        </Label>
                        <Input
                          id="phone"
                          {...register("phone")}
                          className="mt-1 rounded-lg border-2 border-gray-300 focus:border-black"
                          placeholder={t('quickInquiry.form.phonePlaceholder')}
                        />
                        {errors.phone && (
                          <p className="text-red-500 text-xs mt-1">{errors.phone.message}</p>
                        )}
                      </div>
                      <div>
                        <Label htmlFor="address" className="text-sm font-medium text-gray-700">
                          {t('contactUs.address')}
                        </Label>
                        <Textarea
                          id="address"
                          {...register("address")}
                          className="mt-1  border-2 border-gray-300 focus:border-black"
                          placeholder={t('profile.addressPlaceholder')}
                          rows={3}
                        />
                        {errors.address && (
                          <p className="text-red-500 text-xs mt-1">{errors.address.message}</p>
                        )}
                      </div>
                      <div className="flex gap-2 mt-4">
                        <Button 
                          type="submit"
                          disabled={updateProfileMutation.isPending}
                          className="flex-1 rounded-lg bg-black hover:bg-gray-800 text-white"
                        >
                          {updateProfileMutation.isPending ? t('common.saving') : t('common.save')}
                        </Button>
                        <Button 
                          type="button"
                          onClick={handleCancelEdit}
                          variant="outline"
                          className="flex-1 rounded-lg border-2 border-black hover:bg-black hover:text-white"
                        >
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-9 space-y-6">
            {/* Statistics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className=" border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-gray-500 mb-2">{t('profile.completedTrips')}</p>
                      <p className="text-3xl font-bold text-black">{completedTrips}</p>
                      <p className="text-xs text-gray-400 mt-2">{t('profile.trips')}</p>
                    </div>
                    <div className="h-14 w-14 rounded-lg bg-gray-100 flex items-center justify-center">
                      <MapPin className="h-7 w-7 text-black" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className=" border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-gray-500 mb-2">{t('profile.upcomingTrips')}</p>
                      <p className="text-3xl font-bold text-black">{upcomingTrips}</p>
                      <p className="text-xs text-gray-400 mt-2">{t('profile.tours')}</p>
                    </div>
                    <div className="h-14 w-14 rounded-lg bg-gray-100 flex items-center justify-center">
                      <Package className="h-7 w-7 text-black" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className=" border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-gray-500 mb-2">{t('profile.totalSpent')}</p>
                      <p className="text-3xl font-bold text-black">${totalSpent.toLocaleString()}</p>
                      <p className="text-xs text-gray-400 mt-2">{t('profile.totalAmount')}</p>
                    </div>
                    <div className="h-14 w-14 rounded-lg bg-gray-100 flex items-center justify-center">
                      <TrendingUp className="h-7 w-7 text-black" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Quick Actions */}
            <Card className=" border border-gray-200 bg-white shadow-sm">
              <CardHeader className="border-b border-gray-200">
                <CardTitle className="text-lg text-black">{t('profile.quickActions')}</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <button
                    onClick={() => setLocation("/profile")}
                    className="flex items-center justify-between p-4  border border-gray-200 hover:border-black hover:bg-gray-50 transition-all group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-lg bg-gray-100 flex items-center justify-center">
                        <ShoppingBag className="h-6 w-6 text-black" />
                      </div>
                      <span className="font-medium text-black">{t('profile.myBookings')}</span>
                    </div>
                    <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-black transition-colors" />
                  </button>

                  <button
                    onClick={() => setLocation("/profile")}
                    className="flex items-center justify-between p-4  border border-gray-200 hover:border-black hover:bg-gray-50 transition-all group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-lg bg-gray-100 flex items-center justify-center">
                        <Heart className="h-6 w-6 text-black" />
                      </div>
                      <span className="font-medium text-black">{t('profile.favorites')}</span>
                    </div>
                    <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-black transition-colors" />
                  </button>

                  <button
                    onClick={() => setLocation("/contact")}
                    className="flex items-center justify-between p-4  border border-gray-200 hover:border-black hover:bg-gray-50 transition-all group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 rounded-lg bg-gray-100 flex items-center justify-center">
                        <MessageSquare className="h-6 w-6 text-black" />
                      </div>
                      <span className="font-medium text-black">{t('profile.contactSupport')}</span>
                    </div>
                    <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-black transition-colors" />
                  </button>
                </div>
              </CardContent>
            </Card>

            {/* Recent Bookings */}
            <Card className=" border border-gray-200 bg-white shadow-sm">
              <CardHeader className="border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg text-black">{t('profile.recentBookings')}</CardTitle>
                  {bookings.length > 0 && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      className="rounded-lg border border-gray-300 hover:border-black hover:bg-gray-50"
                      onClick={() => setLocation("/profile")}
                    >
                      {t('common.viewAll')}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-6">
                {bookings.length > 0 ? (
                  <div className="space-y-3">
                    {bookings.slice(0, 3).map((booking: any) => (
                      <div 
                        key={booking.id}
                        className="flex items-center justify-between p-4  border border-gray-200 hover:border-black hover:bg-gray-50 transition-all cursor-pointer"
                        onClick={() => setLocation(`/booking/${booking.id}`)}
                      >
                        <div className="flex items-center gap-4">
                          <div className="h-12 w-12 rounded-lg bg-gray-100 flex items-center justify-center">
                            <ShoppingBag className="h-6 w-6 text-black" />
                          </div>
                          <div>
                            <p className="font-medium text-black">{t('booking.bookingNumber')}: {booking.bookingNumber}</p>
                            <p className="text-sm text-gray-500 mt-1">
                              {booking.bookingStatus === 'pending' && t('booking.pending')}
                              {booking.bookingStatus === 'confirmed' && t('booking.confirmed')}
                              {booking.bookingStatus === 'cancelled' && t('booking.cancelled')}
                              {booking.bookingStatus === 'completed' && t('booking.completed')}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-black">${parseFloat(booking.totalPrice).toLocaleString()}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            {booking.paymentStatus === 'pending' && t('booking.paymentPending')}
                            {booking.paymentStatus === 'deposit_paid' && t('booking.depositPaid')}
                            {booking.paymentStatus === 'paid' && t('booking.paid')}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-16">
                    <div className="h-20 w-20 rounded-lg bg-gray-100 flex items-center justify-center mx-auto mb-4">
                      <ShoppingBag className="h-10 w-10 text-gray-400" />
                    </div>
                    <p className="text-gray-600 font-medium mb-2">{t('profile.noBookings')}</p>
                    <p className="text-sm text-gray-500 mb-6">{t('profile.startExploring')}</p>
                    <Button 
                      className="rounded-lg bg-black text-white hover:bg-gray-800 px-8"
                      onClick={() => setLocation("/")}
                    >
                      {t('profile.browseTours')}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Favorites */}
            <FavoritesSection setLocation={setLocation} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Favorites Section Component
function FavoritesSection({ setLocation }: { setLocation: (path: string) => void }) {
  const { data: favorites, isLoading } = trpc.favorites.list.useQuery();
  const utils = trpc.useUtils();
  const { t, language } = useLocale();

  const removeMutation = trpc.favorites.remove.useMutation({
    onSuccess: () => {
      utils.favorites.list.invalidate();
      utils.favorites.getIds.invalidate();
    },
  });

  // Batch fetch translations for non-Chinese languages
  const favoriteTourIds = useMemo(
    () => (favorites ?? []).map((t: any) => t.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [(favorites ?? []).map((t: any) => t.id).join(',')]
  );
  const { data: batchTranslations } = trpc.translation.getBatchTourTranslations.useQuery(
    { tourIds: favoriteTourIds, targetLanguage: language as 'zh-TW' | 'en' | 'ja' | 'ko' },
    { enabled: language !== 'zh-TW' && favoriteTourIds.length > 0 }
  );

  const getTranslatedTitle = (tour: any) => {
    if (language === 'zh-TW' || !batchTranslations) return tour.title;
    const tourTrans = (batchTranslations as Record<number, Record<string, string>>)[tour.id];
    return tourTrans?.title || tour.title;
  };

  return (
    <Card className=" border border-gray-200 bg-white shadow-sm">
      <CardHeader className="border-b border-gray-200">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg text-black">{t('profile.favoriteTours')}</CardTitle>
          {favorites && favorites.length > 0 && (
            <span className="text-sm text-gray-500">{favorites.length} {t('profile.tours')}</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-6">
        {isLoading ? (
          <div className="text-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400 mx-auto" />
          </div>
        ) : favorites && favorites.length > 0 ? (
          <div className="space-y-4">
            {favorites.map((tour: any) => (
              <div 
                key={tour.id}
                className="flex items-center gap-4 p-3  border border-gray-200 hover:border-black hover:bg-gray-50 transition-all cursor-pointer group"
                onClick={() => setLocation(`/tours/${tour.id}`)}
              >
                {/* Tour Image */}
                <div className="h-20 w-28 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                  {tour.mainImage || tour.heroImage || tour.imageUrl ? (
                    <img
                      src={tour.mainImage || tour.heroImage || tour.imageUrl}
                      alt={getTranslatedTitle(tour)}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform rounded-xl"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <MapPin className="h-8 w-8 text-gray-300" />
                    </div>
                  )}
                </div>
                
                {/* Tour Info */}
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-black truncate group-hover:text-gray-700">
                    {getTranslatedTitle(tour)}
                  </h4>
                  <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />
                      {translateDestination(tour.destinationCountry || tour.destination || '', language)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {tour.duration} {t('tours.days')}
                    </span>
                  </div>
                  <p className="text-primary font-bold mt-1">
                    NT$ {tour.price?.toLocaleString()}
                  </p>
                </div>
                
                {/* Remove Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeMutation.mutate({ tourId: tour.id });
                  }}
                  className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                  title={t('profile.removeFavorite')}
                >
                  <Heart className="h-5 w-5 fill-red-500 text-red-500" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="h-20 w-20 rounded-lg bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <Heart className="h-10 w-10 text-gray-400" />
            </div>
            <p className="text-gray-600 font-medium mb-2">{t('profile.noFavorites')}</p>
            <p className="text-sm text-gray-500 mb-6">{t('profile.addFavoritesHint')}</p>
            <Button 
              className="rounded-lg bg-black text-white hover:bg-gray-800 px-8"
              onClick={() => setLocation("/")}
            >
              {t('profile.exploreTours')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
