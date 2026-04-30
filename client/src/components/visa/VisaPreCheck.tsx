import { useState } from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

const CHECKS = [
  "chinaVisaSop.preCheck.q1",
  "chinaVisaSop.preCheck.q2",
  "chinaVisaSop.preCheck.q3",
] as const;

export default function VisaPreCheck() {
  const { t } = useLocale();
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});

  const allOk = CHECKS.every((k) => confirmed[k]);

  return (
    <section className="py-16 border-b border-foreground/10">
      <div className="container max-w-3xl mx-auto px-4">
        <div className="rounded-xl border border-foreground/15 bg-white p-6 md:p-8">
          <div className="flex items-start gap-3 mb-5">
            <AlertTriangle className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-xs tracking-[0.25em] uppercase text-primary">
                {t("chinaVisaSop.preCheck.eyebrow")}
              </p>
              <h2 className="font-serif font-bold text-2xl text-foreground mt-1">
                {t("chinaVisaSop.preCheck.heading")}
              </h2>
              <p className="text-sm text-foreground/65 mt-2 leading-relaxed">
                {t("chinaVisaSop.preCheck.helper")}
              </p>
            </div>
          </div>

          <ul className="space-y-3 mt-6">
            {CHECKS.map((key) => (
              <li key={key}>
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={!!confirmed[key]}
                    onChange={(e) =>
                      setConfirmed((c) => ({ ...c, [key]: e.target.checked }))
                    }
                  />
                  <span
                    className={`inline-flex shrink-0 mt-0.5 h-5 w-5 rounded border items-center justify-center transition-colors ${
                      confirmed[key]
                        ? "bg-primary border-primary text-white"
                        : "border-foreground/30 group-hover:border-foreground/60"
                    }`}
                    aria-hidden
                  >
                    {confirmed[key] && <CheckCircle2 className="h-4 w-4" />}
                  </span>
                  <span
                    className={`text-foreground/85 leading-relaxed transition-colors ${
                      confirmed[key] ? "line-through text-foreground/55" : ""
                    }`}
                  >
                    {t(key)}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          {allOk && (
            <div className="mt-6 rounded-lg bg-foreground/[0.03] border border-foreground/10 p-4 text-sm text-foreground/75 leading-relaxed">
              {t("chinaVisaSop.preCheck.allGood")}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
