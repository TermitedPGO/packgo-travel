import { useState } from "react";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

type Identity =
  | "renewal"
  | "first_china"
  | "first_hk"
  | "first_other"
  | "first_usborn"
  | "minor";

interface IdentityCard {
  id: Identity;
  titleKey: string;
  subtitleKey: string;
  docsKey: string;
}

const IDENTITIES: IdentityCard[] = [
  {
    id: "renewal",
    titleKey: "chinaVisaSop.identity.renewal.title",
    subtitleKey: "chinaVisaSop.identity.renewal.subtitle",
    docsKey: "chinaVisaSop.identity.renewal.docs",
  },
  {
    id: "first_china",
    titleKey: "chinaVisaSop.identity.first_china.title",
    subtitleKey: "chinaVisaSop.identity.first_china.subtitle",
    docsKey: "chinaVisaSop.identity.first_china.docs",
  },
  {
    id: "first_hk",
    titleKey: "chinaVisaSop.identity.first_hk.title",
    subtitleKey: "chinaVisaSop.identity.first_hk.subtitle",
    docsKey: "chinaVisaSop.identity.first_hk.docs",
  },
  {
    id: "first_other",
    titleKey: "chinaVisaSop.identity.first_other.title",
    subtitleKey: "chinaVisaSop.identity.first_other.subtitle",
    docsKey: "chinaVisaSop.identity.first_other.docs",
  },
  {
    id: "first_usborn",
    titleKey: "chinaVisaSop.identity.first_usborn.title",
    subtitleKey: "chinaVisaSop.identity.first_usborn.subtitle",
    docsKey: "chinaVisaSop.identity.first_usborn.docs",
  },
  {
    id: "minor",
    titleKey: "chinaVisaSop.identity.minor.title",
    subtitleKey: "chinaVisaSop.identity.minor.subtitle",
    docsKey: "chinaVisaSop.identity.minor.docs",
  },
];

export default function VisaIdentitySelector() {
  const { t, tArray } = useLocale();
  const [selected, setSelected] = useState<Identity | null>(null);

  const card = IDENTITIES.find((c) => c.id === selected);

  return (
    <section className="py-16 md:py-20 border-b border-foreground/10">
      <div className="container max-w-5xl mx-auto px-4">
        <div className="text-center mb-10">
          <p className="text-xs tracking-[0.3em] uppercase text-primary mb-3">
            {t("chinaVisaSop.identity.eyebrow")}
          </p>
          <h2 className="text-3xl md:text-4xl font-serif font-bold text-foreground tracking-tight">
            {t("chinaVisaSop.identity.heading")}
          </h2>
          <p className="mt-3 text-foreground/65 max-w-2xl mx-auto">
            {t("chinaVisaSop.identity.helper")}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {IDENTITIES.map((c, idx) => {
            const isSelected = selected === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                className={`text-left rounded-xl border p-5 transition-all ${
                  isSelected
                    ? "border-foreground bg-foreground text-white"
                    : "border-foreground/15 bg-white hover:border-foreground/40"
                }`}
              >
                <div
                  className={`text-xs font-semibold tracking-widest mb-2 ${
                    isSelected ? "text-white/60" : "text-foreground/40"
                  }`}
                >
                  {String(idx + 1).padStart(2, "0")}
                </div>
                <div
                  className={`font-serif font-bold text-lg leading-tight ${
                    isSelected ? "text-white" : "text-foreground"
                  }`}
                >
                  {t(c.titleKey)}
                </div>
                <div
                  className={`text-sm mt-1 leading-relaxed ${
                    isSelected ? "text-white/75" : "text-foreground/60"
                  }`}
                >
                  {t(c.subtitleKey)}
                </div>
              </button>
            );
          })}
        </div>

        {card && (
          <div className="rounded-xl border border-foreground/15 bg-white p-6 md:p-8">
            <div className="flex items-start gap-3 mb-5 pb-5 border-b border-foreground/10">
              <ChevronRight className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-xs tracking-[0.2em] uppercase text-primary mb-1">
                  {t("chinaVisaSop.identity.docsForLabel")}
                </p>
                <p className="font-serif font-bold text-xl text-foreground">
                  {t(card.titleKey)}
                </p>
              </div>
            </div>
            <ul className="space-y-3">
              {tArray(card.docsKey).map((doc, i) => (
                <li key={i} className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <span className="text-foreground/80 leading-relaxed">{doc}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!card && (
          <p className="text-center text-foreground/45 text-sm">
            {t("chinaVisaSop.identity.tapPrompt")}
          </p>
        )}
      </div>
    </section>
  );
}
