/**
 * Workspace — 整合工作台 (chat-first 後台 v3).
 *
 * Faithful to the mockup set in PackGo_示意圖/ (admin-full-pages.html et al):
 * a single black-and-white app with the sidebar `navTop` shell —
 *   與 AI 對話 / 今日待辦(roll-up) / 全公司事務(+記帳·月報·行銷·供應商)
 *   / 客戶逐列 / Jeff footer.
 *
 * The card grammar + state language live in components/workspace/ws-ui.tsx,
 * ported from admin-cards-states.html. Design source of truth:
 *   docs/features/admin-chat-claude-parity/design.md + PackGo_示意圖/*.html
 *
 * Previewed at /workspace while the redesign is built out tab-by-tab. /admin
 * stays on the complete AdminV2 until all 39 tabs are redesigned, then flips
 * here in one switch (Jeff 2026-06-09). New nav target = WsView.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import { LoadingPage } from "@/components/ui/spinner";
import WorkspaceSidebar, {
  type WsView,
  type CompanySub,
} from "@/components/workspace/WorkspaceSidebar";
import WorkspaceToday from "@/components/workspace/WorkspaceToday";

const AgentChatPage = lazy(() => import("@/components/admin/AgentChatPage"));
const CustomerInbox = lazy(
  () => import("@/components/workspace/CustomerInbox"),
);
const GuestCustomerPane = lazy(
  () => import("@/components/workspace/GuestCustomerPane"),
);
const WorkspaceCompany = lazy(
  () => import("@/components/workspace/WorkspaceCompany"),
);

export default function Workspace() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { t } = useLocale();
  const [view, setView] = useState<WsView>({ type: "today" });

  const customersQ = trpc.admin.customerList.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  // 批9 m3 — email 訪客 (Jeff 拍板: sidebar 列 註冊用戶 + 訪客)
  const guestsQ = trpc.admin.guestList.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const statsQ = trpc.commandCenter.stats.useQuery(undefined, {
    enabled: isAuthenticated,
  });

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

  // pending approval tasks + unread escalations (批1 m3b additive field)
  const todayCount =
    (statsQ.data?.totalPending ?? 0) + (statsQ.data?.escalationUnread ?? 0);
  const companyCount =
    (statsQ.data?.pendingByLane.marketing ?? 0) +
    (statsQ.data?.pendingByLane.finance ?? 0);

  const customers = [
    ...(customersQ.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      kind: "user" as const,
    })),
    ...(guestsQ.data ?? []).map((g) => ({
      id: g.profileId,
      name: null,
      email: g.email,
      kind: "guest" as const,
    })),
  ];

  const fallback = <LoadingPage text={t("workspace.loading")} />;
  const fullHeight =
    view.type === "ai" || view.type === "customer" || view.type === "guest";

  return (
    <div className="h-screen flex bg-white overflow-hidden">
      <WorkspaceSidebar
        view={view}
        onSelect={setView}
        todayCount={todayCount}
        companyCount={companyCount}
        customers={customers}
        user={user ?? undefined}
        onLogout={logout}
      />
      <div className="flex-1 flex flex-col min-w-0">
        {fullHeight ? (
          <div className="flex-1 overflow-hidden">
            <Suspense fallback={fallback}>
              {view.type === "ai" && <AgentChatPage />}
              {view.type === "customer" && (
                <CustomerInbox userId={view.userId} />
              )}
              {view.type === "guest" && (
                <GuestCustomerPane profileId={view.profileId} />
              )}
            </Suspense>
          </div>
        ) : (
          <main className="flex-1 overflow-y-auto p-4 md:p-6">
            <Suspense fallback={fallback}>
              {view.type === "today" && (
                <WorkspaceToday
                  onJumpToCustomer={(userId) =>
                    setView({ type: "customer", userId })
                  }
                />
              )}
              {view.type === "company" && (
                <WorkspaceCompany
                  sub={view.sub}
                  onSubChange={(sub: CompanySub) =>
                    setView({ type: "company", sub })
                  }
                />
              )}
            </Suspense>
          </main>
        )}
      </div>
    </div>
  );
}
