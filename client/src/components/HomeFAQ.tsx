import { useState } from "react";
import { Plus, Minus } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { Link } from "wouter";

export default function HomeFAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const { t } = useLocale();

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
        <div className="max-w-3xl mx-auto">
          {/* Section Header */}
          <div className="text-center mb-12">
            <p className="text-xs font-bold tracking-[0.3em] text-gray-400 uppercase mb-3">
              {t("homeFaq.eyebrow")}
            </p>
            <h2 className="text-3xl md:text-4xl font-serif font-bold text-black mb-4">
              {t("homeFaq.title")}
            </h2>
            <p className="text-gray-500 text-base">
              {t("homeFaq.subtitle")}
            </p>
          </div>

          {/* FAQ Accordion */}
          <div className="space-y-0 border-t border-gray-200">
            {faqs.map((faq, i) => (
              <div key={i} className="border-b border-gray-200">
                <button
                  onClick={() => toggle(i)}
                  className="w-full flex items-center justify-between py-5 text-left group"
                >
                  <span className={`text-base font-semibold pr-8 transition-colors ${openIndex === i ? "text-black" : "text-gray-700 group-hover:text-black"}`}>
                    {faq.q}
                  </span>
                  <span className="flex-shrink-0 w-7 h-7 rounded-md border border-gray-300 group-hover:border-black flex items-center justify-center transition-colors">
                    {openIndex === i
                      ? <Minus className="h-4 w-4 text-black" />
                      : <Plus className="h-4 w-4 text-gray-500 group-hover:text-black" />
                    }
                  </span>
                </button>

                {openIndex === i && (
                  <div className="pb-5 pr-12">
                    <p className="text-gray-600 text-sm leading-relaxed">
                      {faq.a}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="mt-10 text-center">
            <p className="text-gray-500 text-sm mb-4">
              {t("homeFaq.stillHave")}
            </p>
            <Link href="/contact-us">
              <button className="inline-flex items-center gap-2 rounded-lg bg-black text-white px-8 py-3 text-sm font-bold hover:bg-gray-800 transition-colors">
                {t("homeFaq.contactUs")}
              </button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
