/**
 * AuditLogTab — read-only viewer for adminAuditLog rows.
 *
 * Audit rows have been collected since v73 (every admin mutation that
 * touches customer data writes one via server/_core/auditLog.ts), but
 * there was no admin UI to browse them. This tab fixes that gap so Jeff
 * can:
 *   - Spot suspicious activity (an unexpected IP, a mass-delete burst)
 *   - Reconstruct what changed and when (refund disputes, accidental
 *     status changes)
 *   - Audit his own past actions before making a similar one
 *
 * Filter by action prefix (e.g. "booking.") or target type to narrow
 * the noise. Newest first.
 */
import { Fragment, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { LoadingRow } from "@/components/ui/spinner";
import {
  Shield,
  Filter,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ShieldAlert,
} from "lucide-react";

type Row = {
  id: number;
  userId: number;
  userEmail: string;
  userRole: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  changes: string | null;
  reason: string | null;
  ipAddress: string | null;
  success: number;
  errorMessage: string | null;
  createdAt: string | Date;
};

const ACTION_PREFIXES = [
  { value: "", labelKey: "admin.auditLog.filterAll" },
  { value: "tour.", label: "Tour" },
  { value: "booking.", label: "Booking" },
  { value: "user.", label: "User" },
  { value: "visa.", label: "Visa" },
  { value: "system.", label: "System" },
];

const TARGET_TYPES = [
  { value: "", labelKey: "admin.auditLog.filterAll" },
  { value: "tour", label: "Tour" },
  { value: "booking", label: "Booking" },
  { value: "user", label: "User" },
  { value: "visa", label: "Visa" },
];

export default function AuditLogTab() {
  const { t } = useLocale();
  const [actionPrefix, setActionPrefix] = useState("");
  const [targetType, setTargetType] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data, isLoading, refetch } = trpc.system.auditLogList.useQuery({
    limit: 100,
    actionPrefix: actionPrefix || undefined,
    targetType: targetType || undefined,
  });

  const rows: Row[] = (data?.items as Row[]) ?? [];

  // SECURITY_AUDIT_2026_05_14 P2-1: hash-chain verifier. Manually triggered
  // — running on every page load would be wasteful. Result panel appears
  // below the filters when verification has been run.
  const verifyChain = trpc.system.auditLogVerifyChain.useQuery(undefined, {
    enabled: false,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Shield className="h-5 w-5 text-gray-700" />
            {t("admin.auditLog.title")}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {t("admin.auditLog.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => verifyChain.refetch()}
            disabled={verifyChain.isFetching}
            className="rounded-lg"
            title={t("admin.auditLog.verifyTooltip")}
          >
            {verifyChain.isFetching ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                {t("admin.auditLog.verifying")}
              </>
            ) : (
              <>
                <Shield className="h-3.5 w-3.5 mr-1.5" />
                {t("admin.auditLog.verifyIntegrity")}
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="rounded-lg"
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              t("admin.auditLog.refreshButton")
            )}
          </Button>
        </div>
      </div>

      {/* Chain-verification result. Appears after the user clicks
          "驗證完整性"; persists until they click again. Green = clean,
          red = anomalies (rows modified or deleted mid-chain). */}
      {verifyChain.data && (
        <div
          className={`rounded-xl border p-4 ${
            verifyChain.data.ok
              ? "bg-emerald-50 border-emerald-200"
              : "bg-red-50 border-red-200"
          }`}
        >
          <div className="flex items-start gap-3">
            {verifyChain.data.ok ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            ) : (
              <ShieldAlert className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <p
                className={`text-sm font-semibold ${
                  verifyChain.data.ok ? "text-emerald-900" : "text-red-900"
                }`}
              >
                {verifyChain.data.ok
                  ? t("admin.auditLog.chainOk")
                  : t("admin.auditLog.chainAnomalies", { count: verifyChain.data.anomalies.length })}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">
                {t("admin.auditLog.totalRows", { count: verifyChain.data.totalRows })}
                {verifyChain.data.hashedRows > 0 && (
                  <span> · {t("admin.auditLog.hashedRows", { count: verifyChain.data.hashedRows })}</span>
                )}
                {verifyChain.data.ungatedRows > 0 && (
                  <span> · {t("admin.auditLog.ungatedRows", { count: verifyChain.data.ungatedRows })}</span>
                )}
              </p>
              {verifyChain.data.anomalies.length > 0 && (
                <div className="mt-3 space-y-1.5 max-h-48 overflow-y-auto">
                  {verifyChain.data.anomalies.slice(0, 20).map((a, i) => (
                    <div
                      key={i}
                      className="text-xs bg-white rounded-md border border-red-200 px-2 py-1.5"
                    >
                      <span className="font-mono font-semibold text-red-700">
                        #{a.rowId}
                      </span>{" "}
                      <span className="font-mono text-red-600">
                        [{a.kind}]
                      </span>{" "}
                      <span className="text-gray-700">{a.detail}</span>
                    </div>
                  ))}
                  {verifyChain.data.anomalies.length > 20 && (
                    <p className="text-xs text-gray-500">
                      {t("admin.auditLog.moreAnomalies", { count: verifyChain.data.anomalies.length - 20 })}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-3.5 w-3.5 text-gray-400" />
        <Select
          value={actionPrefix || "__all__"}
          onValueChange={(v) => setActionPrefix(v === "__all__" ? "" : v)}
        >
          <SelectTrigger className="rounded-lg h-8 text-xs w-32">
            <SelectValue placeholder={t("admin.auditLog.filterActionPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {ACTION_PREFIXES.map((p) => (
              <SelectItem key={p.value || "all"} value={p.value || "__all__"}>
                {p.labelKey ? t(p.labelKey) : p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={targetType || "__all__"}
          onValueChange={(v) => setTargetType(v === "__all__" ? "" : v)}
        >
          <SelectTrigger className="rounded-lg h-8 text-xs w-32">
            <SelectValue placeholder={t("admin.auditLog.filterTargetPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {TARGET_TYPES.map((tt) => (
              <SelectItem key={tt.value || "all"} value={tt.value || "__all__"}>
                {tt.labelKey ? t(tt.labelKey) : tt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(actionPrefix || targetType) && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-8 rounded-lg"
            onClick={() => {
              setActionPrefix("");
              setTargetType("");
            }}
          >
            {t("admin.auditLog.clearFilter")}
          </Button>
        )}
        <span className="text-xs text-gray-400 ml-auto">
          {t("admin.auditLog.rowCount", { count: rows.length })}
        </span>
      </div>

      {isLoading ? (
        <LoadingRow />
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-gray-400 text-sm">
          {t("admin.auditLog.emptyMessage")}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t("admin.auditLog.colTime")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("admin.auditLog.colAction")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("admin.auditLog.colTarget")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("admin.auditLog.colOperator")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("admin.auditLog.colIP")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("admin.auditLog.colResult")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = expanded === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr
                      className={`border-t border-gray-100 hover:bg-gray-50 cursor-pointer ${
                        r.success === 0 ? "bg-red-50/30" : ""
                      }`}
                      onClick={() => setExpanded(isOpen ? null : r.id)}
                    >
                      <td className="px-3 py-2 font-mono text-gray-600">
                        {new Date(r.createdAt).toLocaleString("zh-TW", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-3 py-2 font-medium">{r.action}</td>
                      <td className="px-3 py-2 text-gray-700">
                        {r.targetType ? `${r.targetType}` : "—"}
                        {r.targetId ? (
                          <span className="text-gray-400 ml-1">
                            #{r.targetId}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-gray-600 truncate max-w-[180px]">
                        {r.userEmail}
                      </td>
                      <td className="px-3 py-2 text-gray-500 font-mono">
                        {r.ipAddress || "—"}
                      </td>
                      <td className="px-3 py-2">
                        {r.success === 1 ? (
                          <span className="text-green-700">✓</span>
                        ) : (
                          <span className="text-red-700 inline-flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            {t("admin.auditLog.failed")}
                          </span>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t border-gray-100 bg-gray-50/60">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="space-y-2 text-xs">
                            {r.reason && (
                              <div>
                                <span className="text-gray-500">{t("admin.auditLog.reason")}</span>{" "}
                                <span className="text-gray-800">
                                  {r.reason}
                                </span>
                              </div>
                            )}
                            {r.changes && (
                              <div>
                                <p className="text-gray-500 mb-1">{t("admin.auditLog.changes")}</p>
                                <pre className="bg-white border border-gray-200 rounded p-2 overflow-x-auto text-[11px] leading-relaxed text-gray-700 max-h-64">
                                  {(() => {
                                    try {
                                      return JSON.stringify(
                                        JSON.parse(r.changes),
                                        null,
                                        2
                                      );
                                    } catch {
                                      return r.changes;
                                    }
                                  })()}
                                </pre>
                              </div>
                            )}
                            {r.errorMessage && (
                              <div>
                                <p className="text-red-600 font-semibold">
                                  {t("admin.auditLog.errorMessage")}
                                </p>
                                <p className="text-red-700 bg-red-50 border border-red-200 rounded p-2 mt-1">
                                  {r.errorMessage}
                                </p>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
