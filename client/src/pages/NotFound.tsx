import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Compass, Home } from "lucide-react";
import { useLocation } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";

export default function NotFound() {
  const [, setLocation] = useLocation();
  const { t, language } = useLocale();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-[#faf8f3] to-[#f0e4cc]">
      <Card className="w-full max-w-lg mx-4 shadow-lg border border-gray-200 bg-white rounded-xl">
        <CardContent className="pt-10 pb-10 px-8 text-center">
          {/* Round 80.21 v20: was a red AlertCircle that clashed with the
              B&W brand baseline. Replaced with a serif-toned compass icon
              that matches the rest of the travel-agency aesthetic. */}
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="absolute inset-0 bg-[#c9a563]/15 rounded-full" />
              <Compass
                className="relative h-16 w-16 text-[#8a6f3a]"
                strokeWidth={1.5}
              />
            </div>
          </div>

          <h1 className="font-serif text-5xl font-bold text-foreground mb-2 tracking-tight">
            404
          </h1>

          <h2 className="text-xl font-semibold text-foreground/85 mb-4 font-serif">
            {t("notFound.title")}
          </h2>

          <p className="text-foreground/65 mb-8 leading-relaxed">
            {t("notFound.subtitle")}
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              onClick={() => setLocation("/")}
              className="bg-foreground hover:bg-foreground/90 text-white px-6 h-11 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md gap-2"
            >
              <Home className="w-4 h-4" />
              {t("notFound.backToHome")}
            </Button>
            <Button
              onClick={() => setLocation("/tours")}
              variant="outline"
              className="border-foreground/30 text-foreground hover:bg-foreground/5 px-6 h-11 rounded-lg gap-2"
            >
              <Compass className="w-4 h-4" />
              {language === "en" ? "Browse Tours" : "瀏覽行程"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
