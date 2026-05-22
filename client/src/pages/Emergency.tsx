/**
 * Emergency.tsx — public 24h emergency intake.
 *
 * QA audit 2026-05-11 Phase 5 found PACK&GO had no dedicated channel
 * for in-trip emergencies (medical, missed flight, lost passport).
 * Customers in crisis previously used the same "想預訂行程" contact
 * form, which routed through normal Inquiry triage.
 *
 * This page bypasses normal triage:
 *   1. Fires inquiries.createEmergency (NOT inquiries.create)
 *   2. That mutation immediately calls notifyOwner → Jeff's Gmail
 *      with "🆘 [緊急]" prefix
 *   3. Phone number is shown up top so customers don't even need to
 *      fill the form if seconds matter
 *
 * 2026-05-22 P9 polish: every customer-facing string moved out of
 * ternaries into the emergency.* i18n namespace so en / zh-TW UIs stay
 * 100% in sync with the rest of the site.
 */
import { useState } from "react";
import MarketingLayout from "@/components/layouts/MarketingLayout";
import SEO from "@/components/SEO";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Phone, AlertTriangle, CheckCircle, Loader2 } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

type Severity = "medical" | "flight" | "passport" | "safety" | "other";

const SEVERITY_KEYS: Record<Severity, string> = {
  medical: "emergency.severityMedical",
  flight: "emergency.severityFlight",
  passport: "emergency.severityPassport",
  safety: "emergency.severitySafety",
  other: "emergency.severityOther",
};

export default function Emergency() {
  const { t } = useLocale();
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    currentLocation: "",
    severity: "other" as Severity,
    message: "",
  });

  const mutation = trpc.inquiries.createEmergency.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: (err) =>
      alert(t("emergency.submitFailed") + (err.message || "unknown")),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !form.customerName.trim() ||
      !form.customerEmail.trim() ||
      !form.customerPhone.trim() ||
      !form.currentLocation.trim() ||
      !form.message.trim()
    ) {
      alert(t("emergency.fillAllFields"));
      return;
    }
    mutation.mutate(form);
  };

  return (
    <MarketingLayout
      title={t("emergency.pageTitle")}
      subtitle={t("emergency.pageSubtitle")}
    >
      <SEO
        title={{
          zh: "PACK&GO 24 小時緊急支援｜在地客人專屬熱線",
          en: "PACK&GO 24-Hour Emergency Support | In-Trip Hotline",
        }}
        description={{
          zh: "PACK&GO 客戶在旅程中遇到醫療、班機、證件等緊急狀況時的專屬聯絡管道,Jeff 親自接應。",
          en: "Direct emergency channel for PACK&GO customers facing medical, flight, or document emergencies mid-trip. Jeff responds personally.",
        }}
        url="/emergency"
      />

      <div className="max-w-2xl mx-auto py-8">
        {/* CALL FIRST — phone block above everything */}
        <div className="bg-red-50 border-2 border-red-300 rounded-xl p-6 mb-8">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-bold text-red-900 mb-1">
                {t("emergency.callFirstLabel")}
              </p>
              <a
                href="tel:+15106342307"
                className="text-3xl font-bold text-red-700 hover:text-red-800 tracking-wide inline-flex items-center gap-2"
              >
                <Phone className="h-7 w-7" />
                +1 (510) 634-2307
              </a>
              <p className="text-xs text-red-800/80 mt-2">
                {t("emergency.callerNote")}
              </p>
            </div>
          </div>
        </div>

        {/* Form */}
        {submitted ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
            <CheckCircle className="h-10 w-10 text-green-600 mx-auto mb-3" />
            <p className="font-semibold text-green-900 mb-1">
              {t("emergency.receivedTitle")}
            </p>
            <p className="text-sm text-green-800">
              {t("emergency.receivedBody")}
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-white border border-gray-200 rounded-xl p-6 space-y-4"
          >
            <p className="text-sm text-gray-600 mb-2">
              {t("emergency.formIntro")}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">
                  {t("emergency.fieldName")} *
                </Label>
                <Input
                  className="rounded-lg mt-1"
                  value={form.customerName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, customerName: e.target.value }))
                  }
                  required
                />
              </div>
              <div>
                <Label className="text-xs">
                  {t("emergency.fieldPhone")} *
                </Label>
                <Input
                  className="rounded-lg mt-1"
                  type="tel"
                  placeholder="+1 510-xxx-xxxx"
                  value={form.customerPhone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, customerPhone: e.target.value }))
                  }
                  required
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Email *</Label>
              <Input
                className="rounded-lg mt-1"
                type="email"
                value={form.customerEmail}
                onChange={(e) =>
                  setForm((f) => ({ ...f, customerEmail: e.target.value }))
                }
                required
              />
            </div>

            <div>
              <Label className="text-xs">
                {t("emergency.fieldLocation")} *
              </Label>
              <Input
                className="rounded-lg mt-1"
                placeholder={t("emergency.fieldLocationPlaceholder")}
                value={form.currentLocation}
                onChange={(e) =>
                  setForm((f) => ({ ...f, currentLocation: e.target.value }))
                }
                required
              />
            </div>

            <div>
              <Label className="text-xs">
                {t("emergency.fieldType")} *
              </Label>
              <Select
                value={form.severity}
                onValueChange={(v: Severity) =>
                  setForm((f) => ({ ...f, severity: v }))
                }
              >
                <SelectTrigger className="rounded-lg mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SEVERITY_KEYS) as Severity[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(SEVERITY_KEYS[k])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">
                {t("emergency.fieldMessage")} *
              </Label>
              <Textarea
                className="rounded-lg mt-1 min-h-[100px]"
                placeholder={t("emergency.fieldMessagePlaceholder")}
                value={form.message}
                onChange={(e) =>
                  setForm((f) => ({ ...f, message: e.target.value }))
                }
                required
                maxLength={5000}
              />
            </div>

            <Button
              type="submit"
              disabled={mutation.isPending}
              className="w-full rounded-lg bg-red-600 hover:bg-red-700 text-white h-12 text-base font-semibold"
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <AlertTriangle className="h-4 w-4 mr-2" />
              )}
              {t("emergency.submitBtn")}
            </Button>

            <p className="text-xs text-gray-500 text-center">
              {t("emergency.submitFooter")}
            </p>
          </form>
        )}
      </div>
    </MarketingLayout>
  );
}
