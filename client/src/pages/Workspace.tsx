/**
 * Workspace — 整合工作台 (chat-first 後台 v3).
 *
 * 跟現有 /admin 並存的新路由 /workspace。一個介面、四區檢視:
 *   與AI對話 / 今日待辦 / 全公司事務 / 客戶清單。
 *
 * P1 (地基): 重用現有能跑的元件零新後端 —
 *   - 與AI對話  → <AgentChatPage>      (SSE 串流 ops agent)
 *   - 今日待辦  → commandCenter.stats KPIStrip + <ApprovalInbox> (審核箱)
 *   - 客戶清單  → <CustomersTabV2>
 *   - 全公司事務 → P2 placeholder
 *
 * 設計定案: docs/features/admin-chat-claude-parity/design.md
 * 後續階段 (per-customer 聚合 / 項目卡 / slash@ / 6 平台) 見 progress.md。
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import { LoadingPage } from "@/components/ui/spinner";
import {
  DomainSidebar,
  PageHeader,
  KPIStrip,
  type Domain,
  type KPI,
} from "@/components/admin/primitives";
import { MessageSquare, Sun, Building2, Users } from "lucide-react";

const AgentChatPage = lazy(() => import("@/components/admin/AgentChatPage"));
const WorkspaceCustomers = lazy(
  () => import("@/components/workspace/WorkspaceCustomers"),
);
const ApprovalInbox = lazy(
  () => import("@/components/admin-v2/CommandCenter/ApprovalInbox"),
);
const WorkspaceCompany = lazy(
  () => import("@/components/workspace/WorkspaceCompany"),
);

type SectionId = "ai" | "today" | "company" | "customers";

export default function Workspace() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { t } = useLocale();
  const [active, setActive] = useState<SectionId>("today");

  useEffect(() => {
    if (!loading && !isAuthenticated) setLocation("/login");
  }, [loading, isAuthenticated, setLocation]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <LoadingPage text={t("workspace.loading")} />
      </div>
    );
  }
  if (!isAuthenticated) return null;

  const domains: Domain[] = [
    { id: "ai", label: t("workspace.ai"), icon: MessageSquare },
    { id: "today", label: t("workspace.today"), icon: Sun },
    { id: "company", label: t("workspace.company"), icon: Building2 },
    { id: "customers", label: t("workspace.customers"), icon: Users },
  ];

  const isChat = active === "ai";

  return (
    <div className="h-screen flex bg-white overflow-hidden">
      <DomainSidebar
        domains={domains}
        active={active}
        onSelect={(id) => setActive(id as SectionId)}
        user={user ?? undefined}
        onLogout={logout}
        onHome={() => setActive("today")}
      />
      <div className="flex-1 flex flex-col min-w-0">
        {isChat ? (
          // chat owns its own scroll + composer (mirror AdminV2 chat container)
          <div className="flex-1 overflow-hidden">
            <Suspense fallback={<LoadingPage text={t("workspace.loading")} />}>
              <AgentChatPage />
            </Suspense>
          </div>
        ) : active === "customers" ? (
          // customers = full-height master-detail (owns its own scroll)
          <div className="flex-1 overflow-hidden">
            <Suspense fallback={<LoadingPage text={t("workspace.loading")} />}>
              <WorkspaceCustomers />
            </Suspense>
          </div>
        ) : (
          <main className="flex-1 overflow-y-auto p-4 md:p-6">
            <Suspense fallback={<LoadingPage text={t("workspace.loading")} />}>
              {active === "today" && <WorkspaceToday />}
              {active === "company" && <WorkspaceCompany />}
            </Suspense>
          </main>
        )}
      </div>
    </div>
  );
}

/**
 * 今日待辦 — P1 reuses the 審核箱 spine: pending-count KPIs + the generic
 * <ApprovalInbox>. The per-customer roll-up + 3-bucket grouping land in P2/P3.
 */
function WorkspaceToday() {
  const { t } = useLocale();
  const { data: stats } = trpc.commandCenter.stats.useQuery();

  const kpis: KPI[] = [
    {
      label: t("workspace.todayPending"),
      value: stats?.totalPending ?? 0,
      tone: (stats?.totalPending ?? 0) > 0 ? "warn" : "muted",
    },
    { label: t("admin.commandCenter.laneCs"), value: stats?.pendingByLane.cs ?? 0 },
    { label: t("admin.commandCenter.laneQuote"), value: stats?.pendingByLane.quote ?? 0 },
    {
      label: t("admin.commandCenter.laneMarketing"),
      value: stats?.pendingByLane.marketing ?? 0,
    },
    {
      label: t("admin.commandCenter.laneFinance"),
      value: stats?.pendingByLane.finance ?? 0,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("workspace.today")}
        caption={t("workspace.todayCaption")}
      />
      <KPIStrip items={kpis} />
      <ApprovalInbox />
    </div>
  );
}

