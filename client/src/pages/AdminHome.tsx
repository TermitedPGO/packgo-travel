/**
 * AdminHome —— /ops 首頁,純導航入口(1A0a 重寫)。
 *
 * 1A0a(plan v4.3 §1.1 M1-M4):原五組 mock 常數(messages/todo/finance/tours/agent)
 * 全部清除 —— 假營收/假 Trust $45,000/假同步綠燈/假逾期尾款曾與真值頁同導航並列、
 * 無任何使用者可見標示,Jeff 可能當真值做判斷。本頁改為零數字的導航卡;財務真值
 * 唯一入口 = /ops/finance(FinanceCockpit)。CI grep gate(scripts/check-no-mock.mjs)
 * 釘死非 /preview/ 路徑不得再出現 mock 金額常數。
 */
import { useLocale } from "@/contexts/LocaleContext";
import { Link } from "wouter";
import {
  DollarSign,
  Map,
  Users,
  Inbox,
  ChevronRight,
} from "lucide-react";

function NavCard({
  href,
  icon: Icon,
  title,
  desc,
}: {
  href: string;
  icon: typeof DollarSign;
  title: string;
  desc: string;
}) {
  // Wouter 3:class 直接放 Link,禁 nested anchor(repo 前例 HomeFeaturedSpotlight
  // 記錄過 <Link><a> 舊模式造成 layout collapse;Codex 7-18 P1-2)。
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:bg-gray-50"
    >
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
        <Icon className="h-4 w-4 text-gray-500" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-gray-900">{title}</div>
        <div className="mt-0.5 truncate text-xs text-gray-400">{desc}</div>
      </div>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
    </Link>
  );
}

export default function AdminHome() {
  const { t } = useLocale();
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-1 text-xl font-bold text-gray-900">{t("admin.homeTitle")}</h1>
      <p className="mb-6 text-xs text-gray-400">{t("admin.homeSubtitle")}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NavCard
          href="/ops/finance"
          icon={DollarSign}
          title={t("admin.homeNavFinance")}
          desc={t("admin.homeNavFinanceDesc")}
        />
        <NavCard
          href="/workspace"
          icon={Inbox}
          title={t("admin.homeNavWorkspace")}
          desc={t("admin.homeNavWorkspaceDesc")}
        />
        <NavCard
          href="/ops/customers"
          icon={Users}
          title={t("admin.homeNavCustomers")}
          desc={t("admin.homeNavCustomersDesc")}
        />
        <NavCard
          href="/ops/tours"
          icon={Map}
          title={t("admin.homeNavTours")}
          desc={t("admin.homeNavToursDesc")}
        />
      </div>
    </div>
  );
}
