import React, { useState } from "react";
import { useRoute, useLocation } from "wouter";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/contexts/LocaleContext";
import { Search, CheckCircle, Clock, AlertCircle, XCircle, FileText, Loader2 } from "lucide-react";

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactElement; zh: string; en: string }> = {
  draft:               { color: "gray",   icon: <FileText className="h-4 w-4" />,    zh: "草稿",       en: "Draft" },
  submitted:           { color: "blue",   icon: <Clock className="h-4 w-4" />,       zh: "已提交",     en: "Submitted" },
  paid:                { color: "green",  icon: <CheckCircle className="h-4 w-4" />, zh: "已付款",     en: "Paid" },
  documents_received:  { color: "blue",   icon: <FileText className="h-4 w-4" />,    zh: "文件已收到", en: "Documents Received" },
  processing:          { color: "yellow", icon: <Clock className="h-4 w-4" />,       zh: "處理中",     en: "Processing" },
  approved:            { color: "green",  icon: <CheckCircle className="h-4 w-4" />, zh: "已核准",     en: "Approved" },
  rejected:            { color: "red",    icon: <XCircle className="h-4 w-4" />,     zh: "已拒絕",     en: "Rejected" },
  completed:           { color: "green",  icon: <CheckCircle className="h-4 w-4" />, zh: "已完成",     en: "Completed" },
  cancelled:           { color: "gray",   icon: <XCircle className="h-4 w-4" />,     zh: "已取消",     en: "Cancelled" },
};

const STATUS_COLORS: Record<string, string> = {
  gray:   "bg-gray-100 text-gray-700 border-gray-300",
  blue:   "bg-blue-100 text-blue-700 border-blue-300",
  green:  "bg-green-100 text-green-700 border-green-300",
  yellow: "bg-yellow-100 text-yellow-700 border-yellow-300",
  red:    "bg-red-100 text-red-700 border-red-300",
};

export default function ChinaVisaStatus() {
  const { language } = useLocale();
  const isChineseMode = language === "zh-TW";
  const [, params] = useRoute("/china-visa/status/:id");
  const routeId = params?.id ? parseInt(params.id) : 0;

  const [searchId, setSearchId] = useState(routeId ? String(routeId) : "");
  const [queryId, setQueryId] = useState(routeId || 0);

  const { data, isLoading, error, refetch } = trpc.visa.getApplicationStatus.useQuery(
    { applicationId: queryId },
    { enabled: queryId > 0 }
  );

  const handleSearch = () => {
    const id = parseInt(searchId);
    if (id > 0) setQueryId(id);
  };

  const application = data?.application;
  const history = data?.history ?? [];

  const statusCfg = application ? STATUS_CONFIG[application.applicationStatus] : null;

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <Header />
      <main className="flex-grow">
        {/* Page header */}
        <div className="bg-[#1A1A1A] text-white py-12">
          <div className="container max-w-3xl mx-auto px-4">
            <h1 className="text-3xl font-serif font-bold mb-2">
              {isChineseMode ? "簽證申請進度查詢" : "Visa Application Status"}
            </h1>
            <p className="text-gray-400">
              {isChineseMode
                ? "輸入您的申請編號以查詢最新進度"
                : "Enter your application ID to check the latest status"}
            </p>
          </div>
        </div>

        <div className="container max-w-3xl mx-auto px-4 py-10">
          {/* Search bar */}
          <div className="flex gap-3 mb-10">
            <div className="flex-1">
              <Label className="text-sm font-bold mb-1 block">
                {isChineseMode ? "申請編號" : "Application ID"}
              </Label>
              <Input
                value={searchId}
                onChange={e => setSearchId(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                placeholder={isChineseMode ? "例如：12345" : "e.g. 12345"}
                className="border-2 border-gray-300 rounded-none font-mono"
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={handleSearch}
                className="bg-black text-white hover:bg-gray-800 rounded-none px-6 h-10"
              >
                <Search className="mr-2 h-4 w-4" />
                {isChineseMode ? "查詢" : "Search"}
              </Button>
            </div>
          </div>

          {/* Loading */}
          {isLoading && queryId > 0 && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 p-4 text-sm text-red-700 flex gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>
                {isChineseMode
                  ? "找不到此申請編號，請確認後重試。"
                  : "Application not found. Please verify your ID and try again."}
              </span>
            </div>
          )}

          {/* Application details */}
          {application && statusCfg && (
            <div className="space-y-6">
              {/* Status card */}
              <div className="border-2 border-gray-200">
                <div className="bg-gray-50 px-6 py-3 border-b border-gray-200 flex items-center justify-between">
                  <span className="font-bold text-sm">
                    {isChineseMode ? "申請狀態" : "Application Status"}
                  </span>
                  <span className="text-xs text-gray-500">#{application.id}</span>
                </div>
                <div className="px-6 py-6 flex items-center gap-4">
                  <div className={`flex items-center gap-2 px-4 py-2 border rounded-full text-sm font-bold ${STATUS_COLORS[statusCfg.color]}`}>
                    {statusCfg.icon}
                    <span>{isChineseMode ? statusCfg.zh : statusCfg.en}</span>
                  </div>
                  {application.applicationStatus === "approved" && application.trackingNumber && (
                    <div className="text-sm">
                      <span className="text-gray-500 mr-2">
                        {isChineseMode ? "追蹤號碼：" : "Tracking #:"}
                      </span>
                      <span className="font-mono font-bold">{application.trackingNumber}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Application info */}
              <div className="border-2 border-gray-200">
                <div className="bg-gray-50 px-6 py-3 border-b border-gray-200 font-bold text-sm">
                  {isChineseMode ? "申請資訊" : "Application Information"}
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      { label: isChineseMode ? "申請人" : "Applicant", value: `${application.firstName} ${application.lastName}` },
                      { label: isChineseMode ? "電子郵件" : "Email", value: application.email },
                      { label: isChineseMode ? "護照號碼" : "Passport Number", value: application.passportNumber },
                      { label: isChineseMode ? "護照國籍" : "Nationality", value: application.passportCountry },
                      { label: isChineseMode ? "簽證類型" : "Visa Type", value: application.visaType },
                      { label: isChineseMode ? "入境次數" : "Entry Type", value: application.entryType },
                      { label: isChineseMode ? "處理速度" : "Processing Speed", value: application.processingSpeed },
                      { label: isChineseMode ? "付款狀態" : "Payment Status", value: application.paymentStatus === "paid" ? (isChineseMode ? "已付款" : "Paid") : (isChineseMode ? "待付款" : "Unpaid") },
                      { label: isChineseMode ? "總金額" : "Total Amount", value: `USD $${Number(application.totalAmount).toFixed(2)}` },
                    ].map((row, i) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="px-6 py-3 text-gray-500 w-1/3">{row.label}</td>
                        <td className="px-6 py-3 font-medium">{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Status history */}
              {history.length > 0 && (
                <div className="border-2 border-gray-200">
                  <div className="bg-gray-50 px-6 py-3 border-b border-gray-200 font-bold text-sm">
                    {isChineseMode ? "狀態歷史記錄" : "Status History"}
                  </div>
                  <div className="px-6 py-4 space-y-4">
                    {history.map((h, i) => {
                      const cfg = STATUS_CONFIG[h.toStatus] ?? { color: "gray", icon: <Clock className="h-4 w-4" />, zh: h.toStatus, en: h.toStatus };
                      return (
                        <div key={i} className="flex gap-4">
                          <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border ${STATUS_COLORS[cfg.color]}`}>
                            {cfg.icon}
                          </div>
                          <div className="flex-1 pt-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-bold text-sm">
                                {isChineseMode ? cfg.zh : cfg.en}
                              </span>
                              <span className="text-xs text-gray-400">
                                {new Date(h.createdAt).toLocaleString()}
                              </span>
                            </div>
                            {h.note && (
                              <p className="text-sm text-gray-600">{h.note}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Admin notes (visible if available) */}
              {application.adminNotes && (
                <div className="bg-blue-50 border border-blue-200 p-4 text-sm">
                  <div className="font-bold text-blue-800 mb-1">
                    {isChineseMode ? "備註" : "Notes"}
                  </div>
                  <p className="text-blue-700">{application.adminNotes}</p>
                </div>
              )}

              <div className="flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => refetch()}
                  className="border-2 border-gray-300 rounded-none"
                >
                  {isChineseMode ? "重新整理" : "Refresh"}
                </Button>
              </div>
            </div>
          )}

          {/* Empty state */}
          {queryId === 0 && (
            <div className="text-center py-16 text-gray-400">
              <Search className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>{isChineseMode ? "請輸入申請編號以查詢進度" : "Please enter your application ID to check status"}</p>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
