import Header from "@/components/Header";
import SEO from "@/components/SEO";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Check, MapPin, Calendar, Users, DollarSign, MessageCircle, Star } from "lucide-react";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";

export default function CustomTours() {
  const { t } = useLocale();
  const [formData, setFormData] = useState({
    customerName: "",
    email: "",
    phone: "",
    destination: "",
    duration: "",
    travelers: "",
    budget: "",
    departureDate: "",
    requirements: "",
  });

  const createInquiry = trpc.inquiries.create.useMutation({
    onSuccess: () => {
      toast.success(t('customTours.success.title'));
      setFormData({
        customerName: "",
        email: "",
        phone: "",
        destination: "",
        duration: "",
        travelers: "",
        budget: "",
        departureDate: "",
        requirements: "",
      });
    },
    onError: (error) => {
      toast.error(error.message || t('common.error'));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createInquiry.mutate({
      customerName: formData.customerName,
      customerEmail: formData.email,
      customerPhone: formData.phone,
      subject: `${t('customTours.title')} - ${formData.destination}`,
      message: `${t('customTours.form.destination')}：${formData.destination}\n${t('common.days')}：${formData.duration}\n${t('common.people')}：${formData.travelers}\n${t('customTours.form.budget')}：${formData.budget}\n${t('customTours.form.startDate')}：${formData.departureDate}\n${t('customTours.form.specialRequests')}：${formData.requirements}`,
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <SEO
        title={{ zh: "客製行程", en: "Custom Tours" }}
        description={{
          zh: "讓 PACK&GO 為您量身打造專屬旅遊行程，從路線規劃到住宿安排，一切由您決定。",
          en: "Let PACK&GO tailor a one-of-a-kind itinerary for you — from routing to accommodation, every detail is yours to decide.",
        }}
        url="/custom-tours"
      />
      <Header />

      {/* Hero Section.
          Round 80.7: was loading /images/custom-tours-hero.jpg which 404s,
          and the onError fallback /images/hero-travel.webp ALSO 404s — that
          loop was emitting 57 identical 404 errors per page load. Now points
          at hero-sakura.webp which exists in client/public/images, with a
          safe one-shot onError that sets a CSS fallback bg instead of looping. */}
      <section className="relative h-[400px] flex items-center justify-center overflow-hidden bg-foreground">
        <div className="absolute inset-0 z-0">
          <img
            src="/images/hero-sakura.webp"
            alt={t('customTours.title')}
            className="w-full h-full object-cover rounded-xl"
            onError={(e) => {
              // One-shot guard: hide the img element rather than swap to
              // another potentially-broken URL.
              e.currentTarget.style.display = "none";
            }}
          />
          <div className="absolute inset-0 bg-black/40" />
        </div>
        <div className="container relative z-10 text-center text-white">
          <h1 className="text-5xl font-bold font-serif mb-4">{t('customTours.title')}</h1>
          <p className="text-xl">{t('customTours.subtitle')}</p>
        </div>
      </section>

      <main className="flex-grow">
        {/* Service Introduction */}
        <section className="py-20 bg-white">
          <div className="container max-w-5xl">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold font-serif mb-6">{t('customTours.title')}</h2>
              <p className="text-gray-600 text-lg leading-relaxed max-w-3xl mx-auto">
                {t('customTours.description')}
              </p>
            </div>

            {/* Features Grid */}
            <div className="grid md:grid-cols-2 gap-8 mb-20">
              {[
                {
                  icon: <MapPin className="h-8 w-8" />,
                  title: t('customTours.form.destination'),
                  description: t('customTours.form.destinationPlaceholder')
                },
                {
                  icon: <Calendar className="h-8 w-8" />,
                  title: t('customTours.form.travelDates'),
                  description: t('customTours.form.flexible')
                },
                {
                  icon: <Users className="h-8 w-8" />,
                  title: t('customTours.form.travelers'),
                  description: t('customTours.travelersDescription')
                },
                {
                  icon: <Star className="h-8 w-8" />,
                  title: t('customTours.form.interests'),
                  description: t('customTours.interestsDescription')
                },
              ].map((feature, idx) => (
                <div key={idx} className="flex gap-6 p-8 bg-gray-50  hover:shadow-lg transition-all">
                  <div className="flex-shrink-0 w-16 h-16 bg-black text-white rounded-lg flex items-center justify-center">
                    {feature.icon}
                  </div>
                  <div>
                    <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
                    <p className="text-gray-600 leading-relaxed">{feature.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Inquiry Form Section */}
        <section className="py-20 bg-gray-50">
          <div className="container max-w-3xl">
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold font-serif mb-6">{t('customTours.form.submitRequest')}</h2>
              <p className="text-gray-600 text-lg">{t('customTours.success.description')}</p>
            </div>

            <form onSubmit={handleSubmit} className="bg-white  p-12 shadow-lg">
              <div className="grid md:grid-cols-2 gap-6 mb-6">
                <div>
                  <label className="block text-sm font-medium mb-2">{t('quickInquiry.form.name')} *</label>
                  <input
                    type="text"
                    required
                    value={formData.customerName}
                    onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
                    placeholder={t('quickInquiry.form.namePlaceholder')}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">{t('quickInquiry.form.email')} *</label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
                    placeholder={t('quickInquiry.form.emailPlaceholder')}
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6 mb-6">
                <div>
                  <label className="block text-sm font-medium mb-2">{t('quickInquiry.form.phone')} *</label>
                  <input
                    type="tel"
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
                    placeholder={t('quickInquiry.form.phonePlaceholder')}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">{t('customTours.form.destination')} *</label>
                  <input
                    type="text"
                    required
                    value={formData.destination}
                    onChange={(e) => setFormData({ ...formData, destination: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
                    placeholder={t('customTours.form.destinationPlaceholder')}
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-6 mb-6">
                <div>
                  <label className="block text-sm font-medium mb-2">{t('common.days')} *</label>
                  <input
                    type="text"
                    required
                    value={formData.duration}
                    onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
                    placeholder="7"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">{t('customTours.form.travelers')} *</label>
                  <input
                    type="text"
                    required
                    value={formData.travelers}
                    onChange={(e) => setFormData({ ...formData, travelers: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
                    placeholder="2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">{t('customTours.form.budget')}</label>
                  <input
                    type="text"
                    value={formData.budget}
                    onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
                    placeholder={t('customTours.form.budgetPerPerson')}
                  />
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium mb-2">{t('customTours.form.startDate')}</label>
                <input
                  type="date"
                  value={formData.departureDate}
                  onChange={(e) => setFormData({ ...formData, departureDate: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
                />
              </div>

              <div className="mb-8">
                <label className="block text-sm font-medium mb-2">{t('customTours.form.specialRequests')}</label>
                <textarea
                  rows={6}
                  value={formData.requirements}
                  onChange={(e) => setFormData({ ...formData, requirements: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300  focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all resize-none"
                  placeholder={t('customTours.form.specialRequestsPlaceholder')}
                />
              </div>

              <Button
                type="submit"
                disabled={createInquiry.isPending}
                className="w-full h-14 bg-black hover:bg-gray-800 text-white rounded-lg text-lg font-bold transition-all"
              >
                <MessageCircle className="h-5 w-5 mr-2" />
                {createInquiry.isPending ? t('customTours.form.submitting') : t('customTours.form.submitRequest')}
              </Button>
            </form>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
