/**
 * HomeFAQ — v78i: redesigned as an "intent picker" instead of a passive Q&A list.
 *
 * Old design: 5 Q&A in accordion (reactive — user must know what to ask).
 * New design: 4 large cards asking "您現在想做什麼?" — each card leads to the
 * correct page or action, so even tech-illiterate users get guided.
 *
 * Below the cards, the existing accordion FAQ is kept (collapsed by default)
 * for users who want detailed reference.
 */
import { useState } from "react";
import { Plus, Minus, MessageSquare, Search, FileText, Plane, ArrowRight } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { Link } from "wouter";

interface IntentCard {
  icon: any;
  title: string;
  body: string;
  cta: string;
  href?: string;
  onClick?: () => void;
}

export default function HomeFAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { t } = useLocale();

  // 2026-05-22 P16: dropped `|| "中文 fallback"` strings — every key
  // exists in both zh-TW and en, and the Chinese fallbacks were
  // leaking to en users in case of any i18n hiccup.
  const intentCards: IntentCard[] = [
    {
      icon: Search,
      title: t("homeFaq.intent1Title"),
      body: t("homeFaq.intent1Body"),
      cta: t("homeFaq.intent1Cta"),
      href: "/tours",
    },
    {
      icon: FileText,
      title: t("homeFaq.intent2Title"),
      body: t("homeFaq.intent2Body"),
      cta: t("homeFaq.intent2Cta"),
      // v78i fix: was /quote (404). Sprint 3 will build a dedicated /quote page;
      // for now route to the existing custom-tour-request form.
      href: "/custom-tour-request",
    },
    {
      icon: Plane,
      title: t("homeFaq.intent3Title"),
      body: t("homeFaq.intent3Body"),
      cta: t("homeFaq.intent3Cta"),
      href: "/profile",
    },
    {
      icon: MessageSquare,
      title: t("homeFaq.intent4Title"),
      body: t("homeFaq.intent4Body"),
      cta: t("homeFaq.intent4Cta"),
      href: "/contact-us",
    },
  ];

  const faqs = [
    { q: t("homeFaq.q1"), a: t("homeFaq.a1") },
    { q: t("homeFaq.q2"), a: t("homeFaq.a2") },
    { q: t("homeFaq.q3"), a: t("homeFaq.a3") },
    { q: t("homeFaq.q4"), a: t("homeFaq.a4") },
    { q: t("homeFaq.q5"), a: t("homeFaq.a5") },
  ];

  const toggle = (i: number) => setOpenIndex(openIndex === i ? null : i);

  return (
    <section className="py-16 bg-gray-50 border-b border-gray-200">
      <div className="container">
        <div className="max-w-5xl mx-auto">
          {/* Section Header */}
          <div className="text-center mb-12">
            <p className="text-xs font-bold tracking-[0.3em] text-gray-400 uppercase mb-3">
              {t("homeFaq.eyebrow")}
            </p>
            <h2 className="text-3xl md:text-4xl font-serif font-bold text-black mb-4">
              {t("homeFaq.intentTitle")}
            </h2>
            <p className="text-gray-500 text-base">
              {t("homeFaq.intentSubtitle")}
            </p>
          </div>

          {/* Intent Cards (4 columns on desktop, 2 on tablet, 1 on mobile) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
            {intentCards.map((card, i) => {
              const Icon = card.icon;
              const Wrapper = ({ children }: { children: React.ReactNode }) =>
                card.href ? (
                  <Link href={card.href} className="block h-full">
                    {children}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={card.onClick}
                    className="block h-full w-full text-left"
                  >
                    {children}
                  </button>
                );
              return (
                <Wrapper key={i}>
                  <div className="group h-full bg-white rounded-xl border-2 border-gray-200 hover:border-primary hover:shadow-md transition-all p-6 flex flex-col">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 group-hover:bg-primary text-primary group-hover:text-white flex items-center justify-center mb-4 transition-colors">
                      <Icon className="h-6 w-6" />
                    </div>
                    <h3 className="text-base font-bold text-gray-900 mb-2 leading-snug">
                      {card.title}
                    </h3>
                    <p className="text-sm text-gray-600 leading-relaxed mb-4 flex-grow">
                      {card.body}
                    </p>
                    <div className="inline-flex items-center gap-1 text-sm font-semibold text-primary group-hover:gap-2 transition-all">
                      {card.cta}
                      <ArrowRight className="h-4 w-4" />
                    </div>
                  </div>
                </Wrapper>
              );
            })}
          </div>

          {/* Detailed FAQ — collapsed by default for users who want specifics */}
          <div className="max-w-3xl mx-auto">
            <h3 className="text-center text-lg font-semibold text-gray-700 mb-6">
              {t("homeFaq.detailedTitle")}
            </h3>
            <div className="space-y-0 border-t border-gray-200">
              {faqs.map((faq, i) => (
                <div key={i} className="border-b border-gray-200">
                  <button
                    onClick={() => toggle(i)}
                    className="w-full flex items-center justify-between py-5 text-left group"
                  >
                    <span
                      className={`text-base font-semibold pr-8 transition-colors ${openIndex === i ? "text-black" : "text-gray-700 group-hover:text-black"}`}
                    >
                      {faq.q}
                    </span>
                    <span className="flex-shrink-0 w-7 h-7 rounded-md border border-gray-300 group-hover:border-black flex items-center justify-center transition-colors">
                      {openIndex === i ? (
                        <Minus className="h-4 w-4 text-black" />
                      ) : (
                        <Plus className="h-4 w-4 text-gray-500 group-hover:text-black" />
                      )}
                    </span>
                  </button>

                  {openIndex === i && (
                    <div className="pb-5 pr-12">
                      <p className="text-gray-600 text-sm leading-relaxed">{faq.a}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
