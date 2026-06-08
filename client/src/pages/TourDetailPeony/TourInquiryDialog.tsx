/**
 * TourDetailPeony / TourInquiryDialog.tsx
 *
 * Inquiry form dialog for the redesigned action area (feature:
 * tour-page-redesign). Name + email required; phone + note optional. It folds
 * the customer's fit-wizard choices into a human-readable summary in `message`
 * (so InquiryAgent + Jeff read them without a JOIN) and sends the structured
 * relatedTourId + wizardAnswers via trpc.inquiries.create. Submit shaping lives
 * in the pure buildInquiryInput helper. WeChat / phone are separate form-free
 * paths handled by the action area.
 */

import React, { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2 } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import {
  buildInquiryInput,
  type WizardAnswers,
  type WizardPeople,
  type WizardTimeframe,
  type WizardBudget,
  type InquiryMode,
  type InquirySummaryLabels,
  type TourLike,
} from "./actionArea.helpers";
import { type getThemeColorByDestination } from "./helpers";

export type TourInquiryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tour: Pick<TourLike, "id" | "title"> & Record<string, any>;
  wizard: WizardAnswers;
  mode: InquiryMode;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
};

// Map the language-neutral wizard keys to their i18n display-label keys.
const PEOPLE_KEY: Record<WizardPeople, string> = {
  "1-2": "people_1_2",
  "3-5": "people_3_5",
  "6+": "people_6plus",
};
const TIME_KEY: Record<WizardTimeframe, string> = {
  soon: "time_soon",
  school_break: "time_break",
  discuss: "time_discuss",
};
const BUDGET_KEY: Record<WizardBudget, string> = {
  economy: "budget_economy",
  comfort: "budget_comfort",
  luxury: "budget_luxury",
};

export default function TourInquiryDialog({
  open,
  onOpenChange,
  tour,
  wizard,
  mode,
  themeColor,
}: TourInquiryDialogProps) {
  const { t } = useLocale();
  const d = (s: string) => `tourDetail.action.dialog.${s}`;
  const wz = (s: string) => `tourDetail.action.wizard.${s}`;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const createInquiry = trpc.inquiries.create.useMutation();

  // Localized labels for the readable message summary (the helper stays pure).
  const labels: InquirySummaryLabels = useMemo(
    () => ({
      subjectQuote: t("tourDetail.action.summary.subjectQuote"),
      subjectCustom: t("tourDetail.action.summary.subjectCustom"),
      intro: t("tourDetail.action.summary.intro"),
      peopleLabel: t(wz("peopleLabel")),
      timeLabel: t(wz("timeLabel")),
      budgetLabel: t(wz("budgetLabel")),
      people: {
        "1-2": t(wz("people_1_2")),
        "3-5": t(wz("people_3_5")),
        "6+": t(wz("people_6plus")),
      },
      timeframe: {
        soon: t(wz("time_soon")),
        school_break: t(wz("time_break")),
        discuss: t(wz("time_discuss")),
      },
      budget: {
        economy: t(wz("budget_economy")),
        comfort: t(wz("budget_comfort")),
        luxury: t(wz("budget_luxury")),
      },
      fromTourPage: t("tourDetail.action.summary.fromTourPage"),
    }),
    [t],
  );

  const title = mode === "custom" ? t(d("titleCustom")) : t(d("titleQuote"));
  const emailOk = /\S+@\S+\.\S+/.test(email.trim());
  const canSubmit = name.trim().length > 0 && emailOk && !createInquiry.isPending;

  const choiceChips = [
    wizard.people ? t(wz(PEOPLE_KEY[wizard.people])) : null,
    wizard.timeframe ? t(wz(TIME_KEY[wizard.timeframe])) : null,
    wizard.budget ? t(wz(BUDGET_KEY[wizard.budget])) : null,
  ].filter((x): x is string => Boolean(x));

  const reset = () => {
    setName("");
    setEmail("");
    setPhone("");
    setNote("");
    setSubmitted(false);
    createInquiry.reset();
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const payload = buildInquiryInput(
      tour,
      wizard,
      mode,
      { customerName: name, customerEmail: email, customerPhone: phone, note },
      labels,
    );
    createInquiry.mutate(payload, { onSuccess: () => setSubmitted(true) });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle
            className="font-serif text-xl font-bold"
            style={{ color: themeColor.primary }}
          >
            {title}
          </DialogTitle>
        </DialogHeader>

        {submitted ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-12 w-12" style={{ color: themeColor.secondary }} />
            <p className="text-lg font-semibold text-gray-900">{t(d("successTitle"))}</p>
            <p className="text-sm text-gray-600">{t(d("successBody"))}</p>
            <Button
              onClick={() => handleOpenChange(false)}
              className="mt-2 rounded-lg text-white"
              style={{ backgroundColor: themeColor.primary }}
            >
              {t(d("close"))}
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-gray-600">{t(d("intro"))}</p>

            {choiceChips.length > 0 && (
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="mb-1.5 text-xs font-medium text-gray-500">{t(d("yourChoices"))}</p>
                <div className="flex flex-wrap gap-1.5">
                  {choiceChips.map((c, i) => (
                    <span
                      key={i}
                      className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="inq-name">{t(d("name"))}</Label>
              <Input
                id="inq-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t(d("namePlaceholder"))}
                className="rounded-lg"
                required
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inq-email">{t(d("email"))}</Label>
              <Input
                id="inq-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t(d("emailPlaceholder"))}
                className="rounded-lg"
                required
                maxLength={320}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inq-phone">{t(d("phone"))}</Label>
              <Input
                id="inq-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t(d("phonePlaceholder"))}
                className="rounded-lg"
                maxLength={40}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inq-note">{t(d("note"))}</Label>
              <Textarea
                id="inq-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t(d("notePlaceholder"))}
                className="rounded-lg"
                rows={3}
                maxLength={2000}
              />
            </div>

            {createInquiry.isError && (
              <p className="text-sm text-red-600">{t(d("errorGeneric"))}</p>
            )}

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-gray-400">{t(d("requiredHint"))}</p>
              <Button
                type="submit"
                disabled={!canSubmit}
                className="rounded-lg text-white"
                style={{ backgroundColor: themeColor.primary }}
              >
                {createInquiry.isPending ? t(d("submitting")) : t(d("submit"))}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
