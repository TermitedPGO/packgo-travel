import { useEffect, useState } from "react";
import { useSearch, useLocation } from "wouter";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { CheckCircle, FileText, Clock, Mail, ChevronRight } from "lucide-react";
import SEO from "@/components/SEO";

export default function ChinaVisaSuccess() {
  const { t } = useLocale();
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const applicationId = parseInt(params.get("application_id") || "0");

  const { data, isLoading } = trpc.visa.getApplicationStatus.useQuery(
    { applicationId },
    { enabled: applicationId > 0 }
  );

  const application = data?.application;

  const steps = [
    {
      icon: <Mail className="h-5 w-5 text-foreground/70" />,
      title: t("visaSuccess.step1Title"),
      desc: t("visaSuccess.step1Desc"),
    },
    {
      icon: <FileText className="h-5 w-5 text-foreground/70" />,
      title: t("visaSuccess.step2Title"),
      desc: t("visaSuccess.step2Desc"),
    },
    {
      icon: <Clock className="h-5 w-5 text-foreground/70" />,
      title: t("visaSuccess.step3Title"),
      desc: t("visaSuccess.step3Desc"),
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <SEO
        title={{ zh: "簽證申請已收到", en: "Visa Application Received" }}
        description={{ zh: "PACK&GO 簽證申請確認", en: "PACK&GO visa application confirmation" }}
        url="/china-visa/success"
        noindex
      />
      <Header />
      <main className="flex-grow">
        <div className="container max-w-2xl mx-auto px-4 py-20 text-center">
          {/* Success icon */}
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-[#c9a563]/10 rounded-full flex items-center justify-center">
              <CheckCircle className="h-10 w-10 text-[#c9a563]" />
            </div>
          </div>

          <h1 className="text-3xl font-serif font-bold mb-4">
            {t("visaSuccess.submittedTitle")}
          </h1>
          <p className="text-gray-600 mb-8 leading-relaxed">
            {t("visaSuccess.thankYouMessage")}
          </p>

          {/* Application details */}
          {application && (
            <div className="border-2 border-gray-200 text-left mb-8">
              <div className="bg-gray-50 px-6 py-3 border-b border-gray-200 font-bold text-sm">
                {t("visaSuccess.applicationDetails")}
              </div>
              <div className="px-6 py-4 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">{t("visaSuccess.applicationIdLabel")}</span>
                  <span className="font-mono font-bold">#{applicationId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{t("visaSuccess.applicantLabel")}</span>
                  <span className="font-medium">{application.firstName} {application.lastName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{t("visaSuccess.emailLabel")}</span>
                  <span>{application.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{t("visaSuccess.paymentStatusLabel")}</span>
                  <span className="text-[#8a6f3a] font-bold">
                    {t("visaSuccess.paidStatus")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{t("visaSuccess.totalAmountLabel")}</span>
                  <span className="font-bold">USD ${Number(application.totalAmount).toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Next steps */}
          <div className="border-2 border-gray-200 text-left mb-8">
            <div className="bg-gray-50 px-6 py-3 border-b border-gray-200 font-bold text-sm">
              {t("visaSuccess.nextStepsTitle")}
            </div>
            <div className="px-6 py-4 space-y-4">
              {steps.map((step, i) => (
                <div key={i} className="flex gap-4">
                  <div className="flex-shrink-0 mt-0.5">{step.icon}</div>
                  <div>
                    <div className="font-bold text-sm mb-1">
                      {step.title}
                    </div>
                    <div className="text-gray-600 text-sm">
                      {step.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Mailing address */}
          <div className="bg-gray-50 border border-gray-200 p-6 text-left mb-8">
            <h3 className="font-bold text-sm mb-3">
              {t("visaSuccess.mailingAddressTitle")}
            </h3>
            <address className="not-italic text-sm text-gray-700 leading-relaxed">
              {t("visaSuccess.companyName")}<br />
              {t("visaSuccess.visaDepartment")}<br />
              123 Travel Street, Suite 100<br />
              New York, NY 10001<br />
              {t("visaSuccess.phoneLabel")}
            </address>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              onClick={() => navigate(`/china-visa/status/${applicationId}`)}
              className="bg-black text-white hover:bg-gray-800 rounded-lg px-8"
            >
              <FileText className="mr-2 h-4 w-4" />
              {t("visaSuccess.trackStatusButton")}
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate("/")}
              className="border-2 border-gray-300 rounded-lg"
            >
              {t("visaSuccess.returnHomeButton")}
            </Button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
