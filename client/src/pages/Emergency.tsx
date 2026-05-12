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

const SEVERITY_LABELS_ZH: Record<Severity, string> = {
  medical: "醫療緊急 / 受傷",
  flight: "班機問題 / 行李遺失",
  passport: "護照 / 證件遺失",
  safety: "人身安全",
  other: "其他緊急",
};
const SEVERITY_LABELS_EN: Record<Severity, string> = {
  medical: "Medical / injury",
  flight: "Flight issue / lost baggage",
  passport: "Passport / document lost",
  safety: "Personal safety",
  other: "Other urgent",
};

export default function Emergency() {
  const { language } = useLocale();
  const isEN = language === "en";
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
      alert(
        (isEN ? "Submit failed: " : "送出失敗:") + (err.message || "unknown")
      ),
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
      alert(isEN ? "Please fill all fields." : "請填寫所有欄位。");
      return;
    }
    mutation.mutate(form);
  };

  const labels = isEN ? SEVERITY_LABELS_EN : SEVERITY_LABELS_ZH;

  return (
    <MarketingLayout
      title={isEN ? "24-Hour Emergency Support" : "24 小時緊急支援"}
      subtitle={
        isEN
          ? "If you're on a PACK&GO trip and need urgent help"
          : "旅程中需要立即協助時的緊急聯絡"
      }
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
                {isEN
                  ? "Call directly if seconds matter"
                  : "如果分秒必爭,請直接撥打"}
              </p>
              <a
                href="tel:+15106342307"
                className="text-3xl font-bold text-red-700 hover:text-red-800 tracking-wide inline-flex items-center gap-2"
              >
                <Phone className="h-7 w-7" />
                +1 (510) 634-2307
              </a>
              <p className="text-xs text-red-800/80 mt-2">
                {isEN
                  ? "Jeff or an on-call partner answers 24h for in-trip PACK&GO customers."
                  : "Jeff 本人或當地合作夥伴 24 小時待命,僅限旅程中的 PACK&GO 客戶。"}
              </p>
            </div>
          </div>
        </div>

        {/* Form */}
        {submitted ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
            <CheckCircle className="h-10 w-10 text-green-600 mx-auto mb-3" />
            <p className="font-semibold text-green-900 mb-1">
              {isEN ? "Received — Jeff has been alerted" : "已收到 — Jeff 已被立即通知"}
            </p>
            <p className="text-sm text-green-800">
              {isEN
                ? "If you need an immediate response, please also call the number above."
                : "如需立即回應,建議同時撥打上方電話。"}
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-white border border-gray-200 rounded-xl p-6 space-y-4"
          >
            <p className="text-sm text-gray-600 mb-2">
              {isEN
                ? "Tell Jeff what's happening. He'll get a high-priority email instantly."
                : "告訴 Jeff 發生了什麼,他會立即收到高優先級 email 通知。"}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">
                  {isEN ? "Your name" : "您的姓名"} *
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
                  {isEN ? "Phone (with country code)" : "電話(含國碼)"} *
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
                {isEN
                  ? "Current location (city, hotel, hospital name…)"
                  : "目前位置(城市、飯店、醫院等)"}{" "}
                *
              </Label>
              <Input
                className="rounded-lg mt-1"
                placeholder={
                  isEN
                    ? "e.g. Reykjavik, Hilton Nordica lobby"
                    : "例:慕尼黑,Hilton Munich 大廳"
                }
                value={form.currentLocation}
                onChange={(e) =>
                  setForm((f) => ({ ...f, currentLocation: e.target.value }))
                }
                required
              />
            </div>

            <div>
              <Label className="text-xs">
                {isEN ? "Type of emergency" : "緊急狀況類型"} *
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
                  {(Object.keys(labels) as Severity[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {labels[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">
                {isEN ? "What's happening?" : "發生了什麼事?"} *
              </Label>
              <Textarea
                className="rounded-lg mt-1 min-h-[100px]"
                placeholder={
                  isEN
                    ? "Describe briefly. Include any local emergency services already contacted."
                    : "請簡述狀況。若已聯絡當地緊急服務,也請註明。"
                }
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
              {isEN ? "Send emergency alert to Jeff" : "立即通知 Jeff"}
            </Button>

            <p className="text-xs text-gray-500 text-center">
              {isEN
                ? "This goes straight to Jeff's personal Gmail with high-priority flag."
                : "此表單直接寄到 Jeff 個人 Gmail,標記為高優先級。"}
            </p>
          </form>
        )}
      </div>
    </MarketingLayout>
  );
}
