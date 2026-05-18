import { Button } from "@/components/ui/button";
import { Mail } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";

export default function NewsletterSection() {
  const [email, setEmail] = useState("");
  const { t } = useLocale();
  
  const subscribe = trpc.newsletter.subscribe.useMutation({
    onSuccess: (data: any) => {
      toast.success(data.message);
      setEmail("");
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast.error(t('common.required'));
      return;
    }
    subscribe.mutate({ email });
  };

  return (
    <section className="bg-black py-16 border-b border-gray-800">
      <div className="container">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="text-white md:w-1/2">
            <h3 className="text-2xl font-serif font-bold mb-2">{t('newsletter.title')}</h3>
            <p className="text-gray-300">{t('newsletter.subtitle')}</p>
          </div>
          <form onSubmit={handleSubmit} className="w-full md:w-1/2 flex flex-col sm:flex-row gap-2 sm:gap-0">
            <div className="relative flex-grow">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 h-5 w-5" />
              <input
                type="email"
                id="newsletter-email"
                name="email"
                aria-label={t('newsletter.placeholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('newsletter.placeholder')}
                className="w-full h-12 pl-12 pr-4 bg-white/10 border border-white/20 text-white placeholder:text-gray-500 focus:outline-none focus:border-white focus:ring-1 focus:ring-white transition-all rounded-lg sm:rounded-l-lg sm:rounded-r-none"
                disabled={subscribe.isPending}
                required
                autoComplete="email"
              />
            </div>
            <Button 
              type="submit"
              disabled={subscribe.isPending}
              className="h-12 px-8 bg-white hover:bg-gray-200 text-black rounded-lg sm:rounded-l-none font-bold tracking-wide"
            >
              {subscribe.isPending ? t('common.loading') : t('newsletter.button')}
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}
