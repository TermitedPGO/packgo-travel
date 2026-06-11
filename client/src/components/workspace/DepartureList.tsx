/**
 * DepartureList — batch 6 m2: upcoming departures table in WorkspaceCompany.
 * Renders departureCalendar data as a clickable worklist → DepartureDetailSheet.
 */
import { lazy, Suspense, useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import { LoadingPage } from "@/components/ui/spinner";
import { Badge, BadgeK } from "./ws-ui";

const DepartureDetailSheet = lazy(() => import("./DepartureDetailSheet"));

export default function DepartureList() {
  const { t } = useLocale();
  const q = trpc.admin.departureCalendar.useQuery();
  const [openId, setOpenId] = useState<number | null>(null);

  if (q.isLoading) return <LoadingPage text={t("workspace.loading")} />;
  if (!q.data?.length) {
    return (
      <p className="text-sm text-gray-500 py-8 text-center">
        {t("workspace.depNoUpcoming")}
      </p>
    );
  }

  const now = Date.now();

  return (
    <>
      <h2 className="text-sm font-bold mb-3">{t("workspace.depList")}</h2>

      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="py-1.5 pr-3 font-medium">{t("workspace.depTourName")}</th>
              <th className="py-1.5 pr-3 font-medium">{t("workspace.depDate")}</th>
              <th className="py-1.5 pr-3 font-medium">T-N</th>
              <th className="py-1.5 pr-3 font-medium">{t("workspace.depSlots").replace("{booked}/{total}", "")}</th>
              <th className="py-1.5 pr-3 font-medium">{t("workspace.depOpsStatus")}</th>
              <th className="py-1.5 font-medium">{t("workspace.depLeader")}</th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((dep) => {
              const daysLeft = Math.ceil(
                (new Date(dep.departureDate).getTime() - now) / 86_400_000,
              );
              return (
                <tr
                  key={dep.id}
                  onClick={() => setOpenId(dep.id)}
                  className="border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <td className="py-2 pr-3 font-medium">{dep.tourTitle}</td>
                  <td className="py-2 pr-3">
                    {new Date(dep.departureDate).toLocaleDateString()}
                  </td>
                  <td className="py-2 pr-3">
                    {daysLeft > 0 ? (
                      <Badge>{t("workspace.depTMinus").replace("{n}", String(daysLeft))}</Badge>
                    ) : (
                      <BadgeK>{t("workspace.depOpsOpen")}</BadgeK>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {t("workspace.depSlots")
                      .replace("{booked}", String(dep.bookedSlots ?? 0))
                      .replace("{total}", String(dep.totalSlots ?? 0))}
                  </td>
                  <td className="py-2 pr-3">{dep.opsStatus ?? "-"}</td>
                  <td className="py-2">
                    {dep.tourLeader || t("workspace.depNoLeader")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden space-y-2">
        {q.data.map((dep) => {
          const daysLeft = Math.ceil(
            (new Date(dep.departureDate).getTime() - now) / 86_400_000,
          );
          return (
            <button
              key={dep.id}
              type="button"
              onClick={() => setOpenId(dep.id)}
              className="w-full text-left rounded-xl border border-gray-200 p-3 text-xs"
            >
              <div className="font-medium">{dep.tourTitle}</div>
              <div className="text-gray-500 mt-0.5 flex flex-wrap gap-1.5 items-center">
                <span>{new Date(dep.departureDate).toLocaleDateString()}</span>
                {daysLeft > 0 && (
                  <Badge>{t("workspace.depTMinus").replace("{n}", String(daysLeft))}</Badge>
                )}
                <span>
                  {t("workspace.depSlots")
                    .replace("{booked}", String(dep.bookedSlots ?? 0))
                    .replace("{total}", String(dep.totalSlots ?? 0))}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <Suspense fallback={null}>
        {openId !== null && (
          <DepartureDetailSheet
            departureId={openId}
            open
            onClose={() => setOpenId(null)}
          />
        )}
      </Suspense>
    </>
  );
}
