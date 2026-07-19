import { ReactNode, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import {
  Home,
  Users,
  Map,
  DollarSign,
  Megaphone,
  Settings,
} from "lucide-react";
import { reportBootOnce, shortBuildSha } from "./adminShellBoot";

const NAV = [
  { path: "/ops", icon: Home, labelKey: "admin.navHome" as const },
  { path: "/ops/customers", icon: Users, labelKey: "admin.navCustomers" as const },
  { path: "/ops/tours", icon: Map, labelKey: "admin.navTours" as const },
  { path: "/ops/finance", icon: DollarSign, labelKey: "admin.navFinance" as const },
  { path: "/ops/marketing", icon: Megaphone, labelKey: "admin.navMarketing" as const },
] as const;

export default function AdminShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { t } = useLocale();

  // customer-unread (0108) — 未讀客人數 badge on the 客人 rail icon.
  // 60s poll matches the customer lists, so the badge and the red dots agree.
  const unreadQ = trpc.admin.customerUnreadCount.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const customerUnread = unreadQ.data?.count ?? 0;

  // 1A0a boot telemetry(plan v4.3 §3.2.9):換版證明上報,orchestration 全在
  // adminShellBoot.ts(可測 Seam),此處只接線。失敗不寫 guard,下次 mount 重試。
  const bootReport = trpc.clientBoot.report.useMutation();
  const reportFn = bootReport.mutateAsync;
  useEffect(() => {
    void reportBootOnce({
      storage: sessionStorage,
      buildSha: __BUILD_SHA__,
      matchMediaFn: (q) => window.matchMedia(q),
      report: (payload) => reportFn(payload),
    });
  }, [reportFn]);

  const isActive = (path: string) => {
    if (path === "/ops") return location === "/ops";
    return location.startsWith(path);
  };

  return (
    <div className="flex h-screen bg-white">
      <nav className="w-14 flex-shrink-0 bg-gray-950 flex flex-col items-center py-3 gap-1">
        <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center mb-4">
          <span className="text-white text-[10px] font-bold tracking-tight">P&G</span>
        </div>

        {NAV.map((item) => {
          const active = isActive(item.path);
          return (
            <Link key={item.path} href={item.path}>
              <button
                type="button"
                className={`relative w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                  active
                    ? "bg-white text-gray-950"
                    : "text-gray-400 hover:text-white hover:bg-white/10"
                }`}
                title={t(item.labelKey)}
              >
                <item.icon className="w-[18px] h-[18px]" />
                {/* customer-unread — 未讀客人數紅底白字小圓 badge(只掛「客人」) */}
                {item.path === "/ops/customers" && customerUnread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-semibold flex items-center justify-center">
                    {customerUnread > 99 ? "99+" : customerUnread}
                  </span>
                )}
              </button>
            </Link>
          );
        })}

        <div className="flex-1" />

        {/* 1A0a:build 短 sha(換版證明第二證,Jeff 肉眼核) */}
        <span className="mb-1 select-all text-[8px] tracking-tight text-gray-600" title="build">
          {shortBuildSha(__BUILD_SHA__)}
        </span>

        <Link href="/ops/settings">
          <button
            type="button"
            className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
              location.startsWith("/ops/settings")
                ? "bg-white text-gray-950"
                : "text-gray-400 hover:text-white hover:bg-white/10"
            }`}
            title={t("admin.navSettings")}
          >
            <Settings className="w-[18px] h-[18px]" />
          </button>
        </Link>
      </nav>

      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
