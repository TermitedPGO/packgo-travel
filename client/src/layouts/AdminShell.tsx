import { ReactNode } from "react";
import { useLocation, Link } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";
import {
  Home,
  Users,
  Map,
  DollarSign,
  Megaphone,
  Settings,
} from "lucide-react";

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
                className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                  active
                    ? "bg-white text-gray-950"
                    : "text-gray-400 hover:text-white hover:bg-white/10"
                }`}
                title={t(item.labelKey)}
              >
                <item.icon className="w-[18px] h-[18px]" />
              </button>
            </Link>
          );
        })}

        <div className="flex-1" />

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
