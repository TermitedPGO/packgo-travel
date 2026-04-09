import { useEffect, useState } from "react";
import { useSearch, useLocation } from "wouter";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { CheckCircle, FileText, Clock, Mail, ChevronRight } from "lucide-react";

export default function ChinaVisaSuccess() {
  const { language } = useLocale();
  const isChineseMode = language === "zh-TW";
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const applicationId = parseInt(params.get("application_id") || "0");

  const { data, isLoading } = trpc.visa.getApplicationStatus.useQuery(
    { applicationId },
    { enabled: applicationId > 0 }
  );

  const application = data?.application;

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <Header />
      <main className="flex-grow">
        <div className="container max-w-2xl mx-auto px-4 py-20 text-center">
          {/* Success icon */}
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle className="h-10 w-10 text-green-600" />
            </div>
          </div>

          <h1 className="text-3xl font-serif font-bold mb-4">
            {isChineseMode ? "申請已成功提交！" : "Application Submitted Successfully!"}
          </h1>
          <p className="text-gray-600 mb-8 leading-relaxed">
            {isChineseMode
              ? "感謝您的申請。我們已收到您的付款，並將盡快開始處理您的中國簽證申請。"
              : "Thank you for your application. We have received your payment and will begin processing your China visa application shortly."}
          </p>

          {/* Application details */}
          {application && (
            <div className="border-2 border-gray-200 text-left mb-8">
              <div className="bg-gray-50 px-6 py-3 border-b border-gray-200 font-bold text-sm">
                {isChineseMode ? "申請資訊" : "Application Details"}
              </div>
              <div className="px-6 py-4 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">{isChineseMode ? "申請編號" : "Application ID"}</span>
                  <span className="font-mono font-bold">#{applicationId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{isChineseMode ? "申請人" : "Applicant"}</span>
                  <span className="font-medium">{application.firstName} {application.lastName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{isChineseMode ? "電子郵件" : "Email"}</span>
                  <span>{application.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{isChineseMode ? "付款狀態" : "Payment Status"}</span>
                  <span className="text-green-600 font-bold">
                    {isChineseMode ? "已付款" : "Paid"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{isChineseMode ? "總金額" : "Total Amount"}</span>
                  <span className="font-bold">USD ${Number(application.totalAmount).toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Next steps */}
          <div className="border-2 border-gray-200 text-left mb-8">
            <div className="bg-gray-50 px-6 py-3 border-b border-gray-200 font-bold text-sm">
              {isChineseMode ? "接下來的步驟" : "Next Steps"}
            </div>
            <div className="px-6 py-4 space-y-4">
              {[
                {
                  icon: <Mail className="h-5 w-5 text-blue-600" />,
                  title_zh: "查收確認信",
                  title_en: "Check Confirmation Email",
                  desc_zh: "我們已發送確認信至您的電子郵件，請查收。",
                  desc_en: "We have sent a confirmation email to your registered email address.",
                },
                {
                  icon: <FileText className="h-5 w-5 text-purple-600" />,
                  title_zh: "郵寄護照及文件",
                  title_en: "Mail Passport & Documents",
                  desc_zh: "請將護照正本及所需文件郵寄或親送至我們辦公室。",
                  desc_en: "Please mail or deliver your passport and required documents to our office.",
                },
                {
                  icon: <Clock className="h-5 w-5 text-orange-600" />,
                  title_zh: "等待處理",
                  title_en: "Wait for Processing",
                  desc_zh: "收到文件後，我們將代為送件至領事館並追蹤進度。",
                  desc_en: "After receiving your documents, we will submit to the consulate and track progress.",
                },
              ].map((step, i) => (
                <div key={i} className="flex gap-4">
                  <div className="flex-shrink-0 mt-0.5">{step.icon}</div>
                  <div>
                    <div className="font-bold text-sm mb-1">
                      {isChineseMode ? step.title_zh : step.title_en}
                    </div>
                    <div className="text-gray-600 text-sm">
                      {isChineseMode ? step.desc_zh : step.desc_en}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Mailing address */}
          <div className="bg-gray-50 border border-gray-200 p-6 text-left mb-8">
            <h3 className="font-bold text-sm mb-3">
              {isChineseMode ? "郵寄地址" : "Mailing Address"}
            </h3>
            <address className="not-italic text-sm text-gray-700 leading-relaxed">
              PACK&GO 旅行社<br />
              {isChineseMode ? "簽證部門" : "Visa Department"}<br />
              123 Travel Street, Suite 100<br />
              New York, NY 10001<br />
              {isChineseMode ? "電話：(212) 555-0100" : "Tel: (212) 555-0100"}
            </address>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              onClick={() => navigate(`/china-visa/status/${applicationId}`)}
              className="bg-black text-white hover:bg-gray-800 rounded-none px-8"
            >
              <FileText className="mr-2 h-4 w-4" />
              {isChineseMode ? "查詢申請進度" : "Track Application Status"}
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate("/")}
              className="border-2 border-gray-300 rounded-none"
            >
              {isChineseMode ? "返回首頁" : "Return to Home"}
            </Button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
