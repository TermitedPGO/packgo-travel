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
import SEO from "@/components/SEO";

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactElement; i18nKey: string }> = {
  draft:               { color: "gray",   icon: <FileText className="h-4 w-4" />,    i18nKey: "draft" },
  submitted:           { color: "blue",   icon: <Clock className="h-4 w-4" />,       i18nKey: "submitted" },
  paid:                { color: "green",  icon: <CheckCircle className="h-4 w-4" />, i18nKey: "paid" },
  documents_received:  { color: "blue",   icon: <FileText className="h-4 w-4" />,    i18nKey: "documents_received" },
  processing:          { color: "yellow", icon: <Clock className="h-4 w-4" />,       i18nKey: "processing" },
  approved:            { color: "green",  icon: <CheckCircle className="h-4 w-4" />, i18nKey: "approved" },
  rejected:            { color: "red",    icon: <XCircle className="h-4 w-4" />,     i18nKey: "rejected" },
  completed:           { color: "green",  icon: <CheckCircle className="h-4 w-4" />, i18nKey: "completed" },
  cancelled:           { color: "gray",   icon: <XCircle className="h-4 w-4" />,     i18nKey: "cancelled" },
};

const STATUS_COLORS: Record<string, string> = {
  gray:   "bg-gray-100 text-gray-700 border-gray-300",
  blue:   "bg-foreground/[0.04] text-foreground/70 border-foreground/15",
  green:  "bg-[#c9a563]/10 text-[#8a6f3a] border-[#c9a563]/35",
  yellow: "bg-yellow-100 text-yellow-700 border-yellow-300",
  red:    "bg-red-100 text-red-700 border-red-300",
};

export default function ChinaVisaStatus() {
  const { t } = useLocale();
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
      <SEO
        title={{ zh: "簽證辦理進度", en: "Visa Application Status" }}
        description={{ zh: "PACK&GO 中國簽證進度追蹤", en: "PACK&GO China visa status tracking" }}
        url={`/china-visa/status/${routeId || ""}`}
        noindex
      />
      <Header />
      <main className="flex-grow">
        {/* Page header */}
        <div className="bg-[#1A1A1A] text-white py-12">
          <div className="container max-w-3xl mx-auto px-4">
            <h1 className="text-3xl font-serif font-bold mb-2">
              {t("visaStatus.pageTitle")}
            </h1>
            <p className="text-gray-400">
              {t("visaStatus.pageSubtitle")}
            </p>
          </div>
        </div>

        <div className="container max-w-3xl mx-auto px-4 py-10">
          {/* Search bar */}
          <div className="flex gap-3 mb-10">
            <div className="flex-1">
              <Label className="text-sm font-bold mb-1 block">
                {t("visaStatus.applicationId")}
              </Label>
              <Input
                value={searchId}
                onChange={e => setSearchId(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                placeholder={t("visaStatus.idPlaceholder")}
                className="border-2 border-gray-300 rounded-lg font-mono"
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={handleSearch}
                className="bg-black text-white hover:bg-gray-800 rounded-lg px-6 h-10"
              >
                <Search className="mr-2 h-4 w-4" />
                {t("visaStatus.searchButton")}
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
                {t("visaStatus.notFound")}
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
                    {t("visaStatus.applicationStatus")}
                  </span>
                  <span className="text-xs text-gray-500">#{application.id}</span>
                </div>
                <div className="px-6 py-6 flex items-center gap-4">
                  <div className={`flex items-center gap-2 px-4 py-2 border rounded-full text-sm font-bold ${STATUS_COLORS[statusCfg.color]}`}>
                    {statusCfg.icon}
                    <span>{t(`visaStatus.statusLabels.${statusCfg.i18nKey}`)}</span>
                  </div>
                  {application.applicationStatus === "approved" && application.trackingNumber && (
                    <div className="text-sm">
                      <span className="text-gray-500 mr-2">
                        {t("visaStatus.trackingNumber")}
                      </span>
                      <span className="font-mono font-bold">{application.trackingNumber}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Application info */}
              <div className="border-2 border-gray-200">
                <div className="bg-gray-50 px-6 py-3 border-b border-gray-200 font-bold text-sm">
                  {t("visaStatus.applicationInfo")}
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      { label: t("visaStatus.applicant"), value: `${application.firstName} ${application.lastName}` },
                      { label: t("visaStatus.email"), value: application.email },
                      { label: t("visaStatus.passportNumber"), value: application.passportNumber },
                      { label: t("visaStatus.nationality"), value: application.passportCountry },
                      { label: t("visaStatus.visaType"), value: application.visaType },
                      { label: t("visaStatus.entryType"), value: application.entryType },
                      { label: t("visaStatus.paymentStatus"), value: application.paymentStatus === "paid" ? t("visaStatus.paid") : t("visaStatus.unpaid") },
                      { label: t("visaStatus.totalAmount"), value: `USD $${Number(application.totalAmount).toFixed(2)}` },
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
                    {t("visaStatus.statusHistory")}
                  </div>
                  <div className="px-6 py-4 space-y-4">
                    {history.map((h, i) => {
                      const cfg = STATUS_CONFIG[h.toStatus];
                      const color = cfg?.color ?? "gray";
                      const icon = cfg?.icon ?? <Clock className="h-4 w-4" />;
                      const label = cfg ? t(`visaStatus.statusLabels.${cfg.i18nKey}`) : h.toStatus;
                      return (
                        <div key={i} className="flex gap-4">
                          <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border ${STATUS_COLORS[color]}`}>
                            {icon}
                          </div>
                          <div className="flex-1 pt-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-bold text-sm">
                                {label}
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
                <div className="bg-foreground/[0.04] border border-foreground/15 p-4 text-sm">
                  <div className="font-bold text-foreground mb-1">
                    {t("visaStatus.notes")}
                  </div>
                  <p className="text-foreground/70">{application.adminNotes}</p>
                </div>
              )}

              <div className="flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => refetch()}
                  className="border-2 border-gray-300 rounded-lg"
                >
                  {t("visaStatus.refresh")}
                </Button>
              </div>
            </div>
          )}

          {/* Empty state */}
          {queryId === 0 && (
            <div className="text-center py-16 text-gray-400">
              <Search className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>{t("visaStatus.emptyHint")}</p>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
