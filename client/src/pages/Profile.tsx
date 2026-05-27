import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  Loader2, User, Calendar, LogOut, Heart, ShoppingBag,
  MapPin, TrendingUp, Award, MessageSquare, ChevronRight, Package, Clock,
  Coins, ArrowDownRight, ArrowUpRight, Gift, Star, RefreshCcw,
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
import SEO from "@/components/SEO";

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

  // Round 80.22 Phase D: auto-claim a referral code captured pre-signup.
  // The code is stashed in localStorage (90-day TTL) by ReferralCapture in
  // App.tsx; we consume it here once the user is logged in. Server is
  // idempotent — if user already has referredBy, claimReferral is a no-op.
  const claimReferralMutation = trpc.packpoint.claimReferral.useMutation();
  useEffect(() => {
    if (!user) return;
    try {
      const raw = localStorage.getItem("packgo_ref");
      if (!raw) return;
      const payload = JSON.parse(raw) as { code: string; ts: number };
      const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
      if (Date.now() - payload.ts > NINETY_DAYS_MS) {
        localStorage.removeItem("packgo_ref");
        return;
      }
      claimReferralMutation.mutate(
        { code: payload.code },
        {
          onSettled: () => {
            // Clear regardless of attached/skip — code is single-use per user
            localStorage.removeItem("packgo_ref");
          },
        }
      );
    } catch {
      // Bad JSON — clear it
      localStorage.removeItem("packgo_ref");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  
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

  // v71: replace bare spinner with a content-shaped skeleton so the page
  // doesn't visually "jump" when data arrives. Previously users saw a blank
  // page → spinner → fully-rendered profile, which is jarring.
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200">
          <div className="container py-8">
            <div className="flex items-center gap-6 animate-pulse">
              <div className="h-20 w-20 rounded-full bg-gray-200" />
              <div className="flex-1 space-y-3">
                <div className="h-6 w-1/3 bg-gray-200 rounded-lg" />
                <div className="h-4 w-1/4 bg-gray-100 rounded-lg" />
              </div>
            </div>
          </div>
        </div>
        <div className="container py-8 grid md:grid-cols-3 gap-4 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl p-6 border border-gray-100 space-y-3">
              <div className="h-4 w-1/2 bg-gray-100 rounded" />
              <div className="h-8 w-1/3 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
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
      <SEO
        title={{ zh: "個人中心", en: "My Profile" }}
        description={{ zh: "PACK&GO 會員個人中心", en: "PACK&GO member profile" }}
        url="/profile"
        noindex
      />
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
                            {/* Round 80.22: tier-driven label (was hardcoded VIP/regular). */}
                            {(() => {
                              const tier = (user as any).tier as 'free' | 'plus' | 'concierge' | undefined;
                              if (tier === 'concierge') return t('profile.tierConciergeMember');
                              if (tier === 'plus') return t('profile.tierPlusMember');
                              return t('profile.tierFreeMember');
                            })()}
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
          {/* v78z-z3 Sprint 9: per UX audit, removed 3 vanity stat cards
              (completedTrips/upcomingTrips/totalSpent) and Quick Actions
              section (3 buttons that linked back to same page or existing nav).
              Customer profile is now 2 sections: My Bookings + Favorites. */}
          <div className="lg:col-span-9 space-y-6">
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
                        className="flex items-center justify-between p-4 rounded-lg border border-gray-200 hover:border-black hover:bg-gray-50 transition-all cursor-pointer"
                        onClick={() => setLocation(`/bookings/${booking.id}`)}
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

            {/* Round 80.22: Packpoint balance + recent transactions */}
            <PackpointSection />

            {/* Favorites */}
            <FavoritesSection setLocation={setLocation} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Round 80.22: Packpoint section on user profile.
 * Shows balance, lifetime earned, expiry countdown, and last 10 transactions.
 * Empty state pushes user toward earning ways (refer / review / book promo).
 */
function PackpointSection() {
  const { t, language } = useLocale();
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const { data: status } = trpc.packpoint.getStatus.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });
  const { data: history } = trpc.packpoint.getHistory.useQuery({ limit: 10 });
  const { data: referral } = trpc.packpoint.getReferralStatus.useQuery();

  // Round 80.22 Phase E: birthday capture inline in Packpoint section
  const [birthInput, setBirthInput] = useState("");
  const userBirthDate = (user as any)?.birthDate as string | Date | null | undefined;
  const hasBirthday = !!userBirthDate;
  const birthdayMutation = trpc.auth.updateProfile.useMutation({
    onSuccess: async () => {
      const { toast } = await import("sonner");
      toast.success(t("profile.packpoint.birthdaySavedToast"));
      utils.auth.me.invalidate();
    },
    onError: async (e) => {
      const { toast } = await import("sonner");
      toast.error(e.message);
    },
  });

  const balance = status?.balance ?? 0;
  const lifetime = status?.lifetimeEarned ?? 0;
  const dollarValue = (balance / 100).toFixed(2);

  const handleCopyReferral = async () => {
    if (!referral?.shareUrl) return;
    try {
      await navigator.clipboard.writeText(referral.shareUrl);
      // Use toast if available; falling back to alert
      const { toast } = await import("sonner");
      toast.success(t("rewards.referralCopied"));
    } catch {
      alert(t("rewards.copyFailed"));
    }
  };

  return (
    <Card className="border border-gray-200 bg-white shadow-sm">
      <CardHeader className="border-b border-gray-200">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg text-black flex items-center gap-2">
            <Coins className="h-5 w-5 text-[#c9a563]" />
            Packpoint
          </CardTitle>
          {status?.daysUntilExpiry !== null && status?.daysUntilExpiry !== undefined && balance > 0 && (
            <span className="text-xs text-foreground/60">
              <Clock className="h-3 w-3 inline mr-1" />
              {status.daysUntilExpiry > 30
                ? t("rewards.expiresInMonths", { months: String(Math.floor(status.daysUntilExpiry / 30)) })
                : t("rewards.expiresInDaysShort", { days: String(status.daysUntilExpiry) })}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-6">
        {/* Balance summary */}
        <div className="grid grid-cols-3 gap-4 mb-6 pb-6 border-b border-gray-200">
          <div>
            <p className="text-xs uppercase tracking-wider text-foreground/50 mb-1">{t('profile.currentBalance')}</p>
            <p className="text-3xl font-bold tabular-nums text-black">{balance.toLocaleString()}</p>
            <p className="text-xs text-[#8a6f3a] mt-1">{t('profile.redemptionEquivalent').replace('{amount}', String(dollarValue))}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-foreground/50 mb-1">{t('profile.lifetimeEarned')}</p>
            <p className="text-3xl font-bold tabular-nums text-foreground/80">
              {lifetime.toLocaleString()}
            </p>
            <p className="text-xs text-foreground/50 mt-1">{t('profile.neverExpires')}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-foreground/50 mb-1">{t('profile.currentTier')}</p>
            <p className="text-xl font-bold capitalize text-black">{status?.tier ?? "free"}</p>
            {status?.tier === "free" && (
              <p className="text-xs text-foreground/50 mt-1">{t('profile.autoUpgradeHint')}</p>
            )}
          </div>
        </div>

        {/* Round 80.22 Phase D: Referral card — always shown so users see the
            growth lever immediately. The pending count + paid count gives
            transparency on what's "in the pipe" vs what's been awarded. */}
        {referral?.code && (
          <div className="bg-gradient-to-br from-[#c9a563]/12 to-foreground/[0.02] border border-[#c9a563]/30 rounded-lg p-4 mb-4">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-sm font-semibold text-foreground flex items-center gap-1">
                  <Gift className="h-4 w-4 text-[#c9a563]" /> {t("profile.packpoint.yourReferralCode")}
                </p>
                <p className="text-xs text-foreground/60 mt-0.5">
                  {t("profile.packpoint.referralDescription", { reward: String(referral.rewardPerReferral) })}
                </p>
              </div>
              <div className="text-right text-xs text-foreground/60">
                {referral.successfulCount > 0 && (
                  <p>
                    {t("profile.packpoint.successfulCount", { count: String(referral.successfulCount) })}
                  </p>
                )}
                {referral.pendingCount > 0 && (
                  <p>
                    {t("profile.packpoint.pendingCount", { count: String(referral.pendingCount) })}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <code className="flex-1 bg-white border border-foreground/10 rounded-lg px-3 py-2 text-sm font-mono tabular-nums tracking-wider text-foreground select-all">
                {referral.code}
              </code>
              <button
                type="button"
                onClick={handleCopyReferral}
                className="rounded-lg border border-foreground/20 hover:bg-foreground/5 px-3 py-2 text-sm font-medium flex items-center gap-1 transition-colors"
              >
                <RefreshCcw className="h-3.5 w-3.5" /> {t("profile.packpoint.copyLink")}
              </button>
            </div>
            {referral.shareUrl && (
              <p className="text-[10px] text-foreground/50 mt-2 truncate">
                {referral.shareUrl}
              </p>
            )}
          </div>
        )}

        {/* Round 80.22 Phase E: Birthday input — set-once. Prompts user when
            empty, just shows the saved date when set (anti-fraud rule
            prevents changing it via API). */}
        {!hasBirthday ? (
          <div className="bg-[#FAF8F2] border border-[#c9a563]/20 rounded-lg p-4 mb-4">
            <p className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1">
              {t("profile.packpoint.setBirthdayTitle")}
            </p>
            <p className="text-xs text-foreground/60 mb-3">
              {t("profile.packpoint.setBirthdayDesc")}
            </p>
            <div className="flex gap-2">
              <input
                type="date"
                value={birthInput}
                onChange={(e) => setBirthInput(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
                min="1900-01-01"
                className="flex-1 h-9 px-3 rounded-lg border border-foreground/20 text-sm"
              />
              <button
                type="button"
                onClick={() =>
                  birthInput &&
                  birthdayMutation.mutate({ birthDate: birthInput })
                }
                disabled={!birthInput || birthdayMutation.isPending}
                className="rounded-lg bg-[#c9a563] hover:bg-[#d4b478] text-foreground px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {birthdayMutation.isPending ? "..." : t("profile.packpoint.save")}
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-foreground/5 rounded-lg p-3 mb-4 text-xs text-foreground/70 flex items-center justify-between">
            <span>
              {t("profile.packpoint.birthdayLabel")}
              {new Date(userBirthDate as any).toLocaleDateString(language === "en" ? "en-US" : "zh-TW", {
                month: "long",
                day: "numeric",
              })}
            </span>
            <span className="text-[10px] text-foreground/50">
              {t("profile.packpoint.birthdayAutoReward")}
            </span>
          </div>
        )}

        {/* Earning hooks (when balance is low) */}
        {balance < 200 && (
          <div className="bg-[#FAF8F2] border border-[#c9a563]/20 rounded-lg p-4 mb-4">
            <p className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1">
              <Gift className="h-4 w-4 text-[#c9a563]" /> {t("profile.packpoint.earnMoreTitle")}
            </p>
            <ul className="text-xs text-foreground/70 space-y-1">
              <li>{t("profile.packpoint.earnReview")}</li>
              <li>{t("profile.packpoint.earnReferral")}</li>
              <li>{t("profile.packpoint.earnBooking")}</li>
            </ul>
          </div>
        )}

        {/* Transaction history */}
        <div>
          <h4 className="text-sm font-semibold text-foreground mb-3">{t('profile.recentTransactions')}</h4>
          {history?.items && history.items.length > 0 ? (
            <ul className="space-y-2">
              {history.items.map((tx) => (
                <li
                  key={tx.id}
                  className="flex items-center justify-between py-2 border-b border-foreground/5 last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        tx.delta > 0 ? "bg-[#c9a563]/15" : "bg-foreground/5"
                      }`}
                    >
                      {tx.delta > 0 ? (
                        <ArrowUpRight className="h-4 w-4 text-[#8a6f3a]" />
                      ) : (
                        <ArrowDownRight className="h-4 w-4 text-foreground/60" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {t(`rewards.reasons.${tx.reason}`) || tx.reason}
                      </p>
                      {tx.description && (
                        <p className="text-xs text-foreground/50 truncate">{tx.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    <p
                      className={`text-sm font-semibold tabular-nums ${
                        tx.delta > 0 ? "text-[#8a6f3a]" : "text-foreground/70"
                      }`}
                    >
                      {tx.delta > 0 ? "+" : ""}
                      {tx.delta.toLocaleString()}
                    </p>
                    <p className="text-[10px] text-foreground/40">
                      {new Date(tx.createdAt).toLocaleDateString(language === "en" ? "en-US" : "zh-TW", {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-foreground/50 py-4 text-center">{t('profile.noTransactionsYet')}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// 2026-05-22 P13: labelForReason replaced by t("rewards.reasons.<reason>")
// inline lookup with t() in PackpointSection's render path. Kept inline so
// the function can pick up the user's UI language directly.

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
    { tourIds: favoriteTourIds, targetLanguage: language as 'zh-TW' | 'en' },
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
