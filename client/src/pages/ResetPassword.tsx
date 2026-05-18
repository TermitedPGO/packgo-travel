import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, CheckCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import SEO from "@/components/SEO";

export default function ResetPassword() {
  const [, navigate] = useLocation();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [token, setToken] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const { t } = useLocale();

  useEffect(() => {
    // Extract token from URL query parameter
    const urlParams = new URLSearchParams(window.location.search);
    const tokenParam = urlParams.get("token");
    if (tokenParam) {
      setToken(tokenParam);
    } else {
      toast.error(t("resetPassword.invalidLink"));
      navigate("/forgot-password");
    }
  }, [navigate, t]);

  const resetPasswordMutation = trpc.auth.resetPassword.useMutation({
    onSuccess: () => {
      setIsSuccess(true);
      toast.success(t("resetPassword.resetSuccess"), {
        description: t("resetPassword.resetSuccessDesc"),
      });
    },
    onError: (error) => {
      toast.error(t("resetPassword.errorTitle"), {
        description: error.message,
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!password || !confirmPassword) {
      toast.error(t("resetPassword.fillAllFields"));
      return;
    }

    if (password !== confirmPassword) {
      toast.error(t("resetPassword.passwordMismatch"), {
        description: t("resetPassword.passwordMismatchDesc"),
      });
      return;
    }

    if (password.length < 8) {
      toast.error(t("resetPassword.passwordTooShort"), {
        description: t("resetPassword.passwordTooShortDesc"),
      });
      return;
    }

    resetPasswordMutation.mutate({ token, newPassword: password });
  };

  return (
    <div className="min-h-screen flex">
      <SEO
        title={{ zh: "重置密碼", en: "Reset Password" }}
        description={{ zh: "重置 PACK&GO 帳戶密碼", en: "Reset your PACK&GO password" }}
        url="/reset-password"
        noindex
      />
      {/* Left Side - Hero Image */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-black">
        <div className="absolute inset-0 bg-gradient-to-br from-black/60 to-black/20 z-10" />
        <img
          src="https://images.unsplash.com/photo-1502602898657-3e91760cbb34?q=80&w=2073&auto=format&fit=crop"
          alt="Travel"
          className="w-full h-full object-cover grayscale"
        />
        <div className="absolute inset-0 z-20 flex flex-col items-start justify-center px-16 text-white">
          <h1 className="text-5xl font-serif font-bold mb-4 tracking-tight">
            PACK&GO
          </h1>
          <p className="text-xl text-gray-300 font-light tracking-wide">
            {t("resetPassword.travelSlogan")}
          </p>
        </div>
      </div>

      {/* Right Side - Form */}
      <div className="flex-1 flex items-center justify-center px-8 py-12 bg-white">
        <div className="w-full max-w-md">
          {/* Logo for mobile — Round 80.7: was /logo.png (404'd) */}
          <div className="lg:hidden mb-8 text-center">
            <Link href="/" className="inline-flex items-center gap-3 text-2xl font-bold text-black">
              <img
                src="/images/logo-bag-black-v3.png"
                alt="PACK&GO"
                className="h-10 w-auto"
              />
              <div className="flex flex-col items-start">
                <span className="text-2xl tracking-tight">PACK&GO</span>
                <span className="text-xs font-normal text-gray-600 tracking-wide">
                  {t("resetPassword.travelSlogan")}
                </span>
              </div>
            </Link>
          </div>

          {!isSuccess ? (
            <>
              <div className="mb-8">
                <h2 className="text-3xl font-bold text-black mb-2">
                  {t("resetPassword.title")}
                </h2>
                <p className="text-gray-600 text-sm">
                  {t("resetPassword.subtitle")}
                </p>
              </div>

              <form className="space-y-6" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-black font-medium">
                    {t("resetPassword.newPassword")}
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <Input
                      id="password"
                      type="password"
                      placeholder={t("resetPassword.newPasswordPlaceholder")}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-12 h-12 border-2 border-black focus:ring-2 focus:ring-black"
                      required
                      minLength={8}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-password" className="text-black font-medium">
                    {t("resetPassword.confirmPassword")}
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <Input
                      id="confirm-password"
                      type="password"
                      placeholder={t("resetPassword.confirmPasswordPlaceholder")}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="pl-12 h-12 border-2 border-black focus:ring-2 focus:ring-black"
                      required
                      minLength={8}
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 bg-black hover:bg-gray-800 text-white font-bold tracking-wide"
                  disabled={resetPasswordMutation.isPending}
                >
                  {resetPasswordMutation.isPending ? t("resetPassword.resetting") : t("resetPassword.submit")}
                </Button>
              </form>
            </>
          ) : (
            <div className="text-center space-y-6">
              <div className="w-16 h-16 bg-[#c9a563]/10 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="w-8 h-8 text-[#c9a563]" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-black mb-2">
                  {t("resetPassword.successTitle")}
                </h2>
                <p className="text-gray-600 text-sm">
                  {t("resetPassword.successDesc")}
                </p>
              </div>
              <Link href="/login">
                <Button
                  className="w-full h-12 bg-black hover:bg-gray-800 text-white font-bold tracking-wide"
                >
                  {t("resetPassword.goToLogin")}
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
