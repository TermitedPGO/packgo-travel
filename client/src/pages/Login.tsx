import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, Lock, ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import SEO from "@/components/SEO";

export default function Login() {
  const [activeTab, setActiveTab] = useState<"signin" | "register">("signin");
  const [, setLocation] = useLocation();
  const { t } = useLocale();

  // Sign in form state
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  // Register form state
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState("");

  // Login mutation
  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: () => {
      toast.success(t('auth.login.loginSuccess'), {
        description: t('auth.login.loginSuccessDesc'),
      });
      setLocation("/");
    },
    onError: (error) => {
      toast.error(t('auth.login.loginFailed'), {
        description: error.message,
      });
    },
  });

  // Register mutation
  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: () => {
      toast.success(t('auth.register.registerSuccess'), {
        description: t('auth.register.registerSuccessDesc'),
      });
      setLocation("/");
    },
    onError: (error) => {
      toast.error(t('auth.register.registerFailed'), {
        description: error.message,
      });
    },
  });

  const handleSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!signInEmail || !signInPassword) {
      toast.error(t('common.fillAllFields'));
      return;
    }
    loginMutation.mutate({ email: signInEmail, password: signInPassword, rememberMe });
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!registerName || !registerEmail || !registerPassword || !registerConfirmPassword) {
      toast.error(t('common.fillAllFields'));
      return;
    }

    if (registerPassword !== registerConfirmPassword) {
      toast.error(t('auth.register.passwordMismatch'), {
        description: t('auth.register.passwordMismatchDesc'),
      });
      return;
    }

    if (registerPassword.length < 8) {
      toast.error(t('auth.register.passwordTooShort'), {
        description: t('auth.register.passwordTooShortDesc'),
      });
      return;
    }

    registerMutation.mutate({
      email: registerEmail,
      password: registerPassword,
      name: registerName,
    });
  };

  const handleGoogleLogin = () => {
    window.location.href = "/api/auth/google";
  };

  return (
    <div className="min-h-screen flex">
      <SEO
        title={{ zh: "登入 / 註冊", en: "Sign in / Register" }}
        description={{ zh: "登入或註冊 PACK&GO 旅行社會員", en: "Sign in or register at PACK&GO Travel" }}
        url="/login"
        noindex
      />
      {/* Left Side - Hero Image */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-black">
        <div className="absolute inset-0 bg-gradient-to-br from-black/60 to-black/20 z-10" />
        <img
          src="https://images.unsplash.com/photo-1528360983277-13d401cdc186?q=80&w=2070&auto=format&fit=crop"
          alt="Travel"
          className="w-full h-full object-cover grayscale"
        />
        <div className="absolute inset-0 z-20 flex flex-col items-start justify-center px-16 text-white">
          <h1 className="text-5xl font-serif font-bold mb-4 tracking-tight">
            {t('auth.heroTitle')}
          </h1>
          <p className="text-xl text-gray-300 font-light tracking-wide">
            {t('auth.heroSubtitle')}
          </p>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="flex-1 flex items-center justify-center px-8 py-12 bg-white relative">
        {/* Back to Home Button */}
        <Link
          href="/"
          className="absolute top-8 left-8 flex items-center gap-2 text-gray-600 hover:text-black transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="font-medium">{t('common.backToHome')}</span>
        </Link>

        <div className="w-full max-w-md">
          {/* Logo for mobile — Round 80.7: was /logo.png (404'd), now uses
              actual brand mark. */}
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
                  {t('home.slogan')}
                </span>
              </div>
            </Link>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "signin" | "register")}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2 mb-8 h-12 bg-transparent border border-black rounded-lg">
              <TabsTrigger
                value="signin"
                className="data-[state=active]:bg-black data-[state=active]:text-white text-black font-bold tracking-wide rounded-lg"
              >
                {t('nav.login')}
              </TabsTrigger>
              <TabsTrigger
                value="register"
                className="data-[state=active]:bg-black data-[state=active]:text-white text-black font-bold tracking-wide rounded-lg"
              >
                {t('nav.register')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="space-y-6">
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-black mb-2">
                  {t('auth.login.title')}
                </h2>
                <p className="text-gray-600 text-sm">
                  {t('auth.login.subtitle')}
                </p>
              </div>

              <form className="space-y-6" onSubmit={handleSignIn}>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-black font-medium">
                    {t('auth.login.email')}
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <Input
                      id="email"
                      type="email"
                      placeholder={t('auth.login.emailPlaceholder')}
                      value={signInEmail}
                      onChange={(e) => setSignInEmail(e.target.value)}
                      className="pl-12 h-12 border-2 border-black rounded-lg focus:ring-2 focus:ring-black"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-black font-medium">
                    {t('auth.login.password')}
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <Input
                      id="password"
                      type="password"
                      placeholder={t('auth.login.passwordPlaceholder')}
                      value={signInPassword}
                      onChange={(e) => setSignInPassword(e.target.value)}
                      className="pl-12 h-12 border-2 border-black rounded-lg focus:ring-2 focus:ring-black"
                      required
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="rememberMe"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 rounded-lg border-2 border-black text-black focus:ring-2 focus:ring-black cursor-pointer"
                    />
                    <Label htmlFor="rememberMe" className="text-black font-medium cursor-pointer">
                      {t('auth.login.rememberMe')}
                    </Label>
                  </div>
                  <Link href="/forgot-password" className="text-black hover:underline font-medium">
                    {t('auth.login.forgotPassword')}
                  </Link>
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 bg-black hover:bg-gray-800 text-white font-bold tracking-wide rounded-lg"
                  disabled={loginMutation.isPending}
                >
                  {loginMutation.isPending ? t('auth.login.loggingIn') : t('auth.login.loginButton')}
                </Button>

                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-300"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-4 bg-white text-gray-500">{t('common.orUse')}</span>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-12 border-2 border-gray-300 hover:border-gray-400 hover:bg-gray-50 text-gray-700 font-bold tracking-wide rounded-lg bg-white"
                  onClick={handleGoogleLogin}
                >
                  <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  {t('auth.login.loginWithGoogle')}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="register" className="space-y-6">
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-black mb-2">
                  {t('auth.register.title')}
                </h2>
                <p className="text-gray-600 text-sm">
                  {t('auth.register.subtitle')}
                </p>
              </div>

              <form className="space-y-6" onSubmit={handleRegister}>
                <div className="space-y-2">
                  <Label htmlFor="register-name" className="text-black font-medium">
                    {t('auth.register.name')}
                  </Label>
                  <Input
                    id="register-name"
                    type="text"
                    placeholder={t('auth.register.namePlaceholder')}
                    value={registerName}
                    onChange={(e) => setRegisterName(e.target.value)}
                    className="h-12 border-2 border-black rounded-lg focus:ring-2 focus:ring-black"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="register-email" className="text-black font-medium">
                    {t('auth.register.email')}
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <Input
                      id="register-email"
                      type="email"
                      placeholder={t('auth.register.emailPlaceholder')}
                      value={registerEmail}
                      onChange={(e) => setRegisterEmail(e.target.value)}
                      className="pl-12 h-12 border-2 border-black rounded-lg focus:ring-2 focus:ring-black"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="register-password" className="text-black font-medium">
                    {t('auth.register.password')}
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <Input
                      id="register-password"
                      type="password"
                      placeholder={t('auth.register.passwordPlaceholder')}
                      value={registerPassword}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                      className="pl-12 h-12 border-2 border-black rounded-lg focus:ring-2 focus:ring-black"
                      required
                      minLength={8}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="register-confirm-password" className="text-black font-medium">
                    {t('auth.register.confirmPassword')}
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <Input
                      id="register-confirm-password"
                      type="password"
                      placeholder={t('auth.register.confirmPasswordPlaceholder')}
                      value={registerConfirmPassword}
                      onChange={(e) => setRegisterConfirmPassword(e.target.value)}
                      className="pl-12 h-12 border-2 border-black rounded-lg focus:ring-2 focus:ring-black"
                      required
                      minLength={8}
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 bg-black hover:bg-gray-800 text-white font-bold tracking-wide rounded-lg"
                  disabled={registerMutation.isPending}
                >
                  {registerMutation.isPending ? t('auth.register.registering') : t('auth.register.registerButton')}
                </Button>

                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-300"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-4 bg-white text-gray-500">{t('common.orUse')}</span>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-12 border-2 border-gray-300 hover:border-gray-400 hover:bg-gray-50 text-gray-700 font-bold tracking-wide rounded-lg bg-white"
                  onClick={handleGoogleLogin}
                >
                  <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  {t('auth.register.registerWithGoogle')}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
