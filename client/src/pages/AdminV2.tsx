/**
 * PACK&GO Admin V2 — 6-domain redesign (2026-05-22).
 *
 * Parallel to /admin (old). Reachable at /admin/v2. Old admin continues
 * to work; Jeff can daily-driver this until comfortable, then we delete
 * /admin entirely. No shared state, no destructive overrides.
 *
 * 6 domains (Jeff split Finance OUT of System per 2026-05-22 spec):
 *   - 🏢 辦公室     today inbox, agent chat
 *   - 📋 營運       tours, bookings, inquiries, departures, suppliers
 *   - 👥 客戶       customers, reviews, packpoint, vouchers, quote tools
 *   - 📢 行銷       marketing automation, posters, content, analytics, competitor, affiliate
 *   - 💰 財務       accounting, invoices, reconciliation, finance landing
 *   - ⚙️ 系統       AI infra (cost, sessions, monitor, calibration, audit log, visa)
 *
 * Pilot redesign tab: Bookings — uses Trip.com booking admin as visual reference.
 * Other tabs initially render the existing v1 component; we polish them in
 * subsequent batches.
 *
 * Design system spec:
 *   ~/.claude/projects/-Users-jeff-Desktop---/memory/feedback_admin_design_system.md
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoadingPage } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import {
  Building2,
  ClipboardList,
  Users,
  Megaphone,
  Wallet,
  Settings,
} from "lucide-react";

import {
  TopBar,
  DomainSidebar,
  DomainSubNav,
  CommandPalette,
  type Domain,
  type SubNavItem,
} from "@/components/admin/primitives";
import { useCommandPaletteHotkey } from "@/components/admin/primitives/CommandPalette";

// V2 redesigned pilot — Trip.com style booking admin.
const BookingsTabV2 = lazy(() => import("@/components/admin-v2/BookingsTabV2"));

// All other tabs initially come from V1. They're consumed AS-IS; we replace
// them one by one with V2 redesigns. Listed here for the lazy-loader.
const UnifiedInbox = lazy(() => import("@/components/admin/UnifiedInbox"));
const AgentChatPage = lazy(() => import("@/components/admin/AgentChatPage"));
const OpsLanding = lazy(() => import("@/components/admin/landings/OpsLanding"));
const CustomersLanding = lazy(() => import("@/components/admin/landings/CustomersLanding"));
const MarketingLanding = lazy(() => import("@/components/admin/landings/MarketingLanding"));
const FinanceLanding = lazy(() => import("@/components/admin/landings/FinanceLanding"));
const ToursTab = lazy(() => import("@/components/admin/ToursTab"));
const InquiriesTab = lazy(() => import("@/components/admin/InquiriesTab"));
const SuppliersTab = lazy(() => import("@/components/admin/SuppliersTab"));
const MonitorDashboard = lazy(() => import("@/components/admin/MonitorDashboard"));
const ReviewsTab = lazy(() => import("@/components/admin/ReviewsTab"));
const PackpointTab = lazy(() => import("@/components/admin/PackpointTab"));
const VouchersTab = lazy(() => import("@/components/admin/VouchersTab"));
const AiQuotesTab = lazy(() => import("@/components/admin/AiQuotesTab"));
const WechatAssistTab = lazy(() => import("@/components/admin/WechatAssistTab"));
const QuoteToolTab = lazy(() => import("@/components/admin/tools/QuoteToolTab"));
const MarketingTab = lazy(() => import("@/components/admin/MarketingTab"));
const MarketingContentTab = lazy(() => import("@/components/admin/MarketingContentTab"));
const PostersTab = lazy(() => import("@/components/admin/PostersTab"));
const AnalyticsTab = lazy(() => import("@/components/admin/AnalyticsTab"));
const CompetitorMonitorTab = lazy(() => import("@/components/admin/CompetitorMonitorTab"));
const AffiliateTab = lazy(() => import("@/components/admin/AffiliateTab"));
const AccountingTab = lazy(() => import("@/components/admin/AccountingTab"));
const InvoicesTab = lazy(() => import("@/components/admin/InvoicesTab"));
const ReconciliationTab = lazy(() => import("@/components/admin/ReconciliationTab"));
const AiHubTab = lazy(() => import("@/components/admin/AiHubTab"));
const LlmCostTab = lazy(() => import("@/components/admin/LlmCostTab"));
const TaskHistoryContent = lazy(() => import("@/components/admin/TaskHistoryContent"));
const AuditLogTab = lazy(() => import("@/components/admin/AuditLogTab"));
const CalibrationReviewTab = lazy(() => import("@/components/admin/CalibrationReviewTab"));
const AutonomousAgentsTab = lazy(() => import("@/components/admin/AutonomousAgentsTab"));
const VisaManagementTab = lazy(() => import("@/components/admin/VisaManagementTab"));

// ────────────────────────────────────────────────────────────────────────
// Information architecture — 6 domains
// ────────────────────────────────────────────────────────────────────────

type PageId =
  // Office
  | "today" | "agent-chat"
  // Operations
  | "ops-landing" | "tours" | "bookings" | "inquiries" | "tour-monitor" | "suppliers"
  // Customers
  | "customers-landing" | "reviews" | "packpoint" | "vouchers" | "ai-quotes" | "tool-quote" | "wechat-assist"
  // Marketing
  | "marketing-landing" | "marketing" | "marketing-content" | "posters" | "analytics" | "competitor-monitor" | "affiliate"
  // Finance
  | "finance-landing" | "accounting" | "invoices" | "reconciliation"
  // System
  | "ai-hub" | "llm-cost" | "task-history" | "audit-log" | "calibration-review" | "autonomous-agents" | "visa";

type DomainId = "office" | "ops" | "customers" | "marketing" | "finance" | "system";

type PageDef = { id: PageId; label: string };

const IA: Record<DomainId, { domain: Domain; primary: PageDef[]; advanced: PageDef[] }> = {
  office: {
    domain: { id: "office", label: "辦公室", icon: Building2 },
    primary: [
      { id: "today", label: "🏠 今日總覽" },
      { id: "agent-chat", label: "💬 Agent Chat" },
    ],
    advanced: [],
  },
  ops: {
    domain: { id: "ops", label: "營運", icon: ClipboardList },
    primary: [
      { id: "ops-landing", label: "🗺 總覽" },
      { id: "bookings", label: "訂單" },
      { id: "tours", label: "行程" },
      { id: "inquiries", label: "詢問" },
    ],
    advanced: [
      { id: "tour-monitor", label: "供應商監控" },
      { id: "suppliers", label: "🔌 供應商同步" },
    ],
  },
  customers: {
    domain: { id: "customers", label: "客戶", icon: Users },
    primary: [
      { id: "customers-landing", label: "👥 總覽" },
      { id: "reviews", label: "評價" },
      { id: "tool-quote", label: "📄 報價單" },
    ],
    advanced: [
      { id: "ai-quotes", label: "AI 報價單" },
      { id: "packpoint", label: "Packpoint" },
      { id: "vouchers", label: "Voucher" },
      { id: "wechat-assist", label: "WeChat 助手" },
    ],
  },
  marketing: {
    domain: { id: "marketing", label: "行銷", icon: Megaphone },
    primary: [
      { id: "marketing-landing", label: "📢 總覽" },
      { id: "posters", label: "海報" },
      { id: "marketing-content", label: "AI 文案" },
    ],
    advanced: [
      { id: "marketing", label: "自動化" },
      { id: "analytics", label: "流量分析" },
      { id: "competitor-monitor", label: "競品" },
      { id: "affiliate", label: "Trip.com 聯盟" },
    ],
  },
  finance: {
    domain: { id: "finance", label: "財務", icon: Wallet },
    primary: [
      { id: "finance-landing", label: "💰 總覽" },
      { id: "accounting", label: "帳務" },
    ],
    advanced: [
      { id: "invoices", label: "發票" },
      { id: "reconciliation", label: "對帳" },
    ],
  },
  system: {
    domain: { id: "system", label: "系統", icon: Settings },
    primary: [
      { id: "ai-hub", label: "AI 中心" },
      { id: "llm-cost", label: "AI 成本" },
      { id: "autonomous-agents", label: "自主 Agent" },
    ],
    advanced: [
      { id: "calibration-review", label: "QA 審查" },
      { id: "task-history", label: "任務記錄" },
      { id: "audit-log", label: "審計日誌" },
      { id: "visa", label: "中國簽證" },
    ],
  },
};

function allPages(cfg: { primary: PageDef[]; advanced: PageDef[] }): PageDef[] {
  return [...cfg.primary, ...cfg.advanced];
}

const PAGE_TO_DOMAIN: Record<PageId, DomainId> = Object.fromEntries(
  Object.entries(IA).flatMap(([d, cfg]) =>
    allPages(cfg).map((p) => [p.id, d])
  )
) as Record<PageId, DomainId>;

// ────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────

export default function AdminV2() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [activePage, setActivePage] = useState<PageId>("today");
  const [paletteOpen, setPaletteOpen] = useCommandPaletteHotkey();
  const activeDomain = PAGE_TO_DOMAIN[activePage] ?? "office";

  // Badge counts — same wires as v1 admin
  const { data: statsData } = trpc.admin.getStats.useQuery();
  const { data: competitorUnread } = trpc.competitor.unreadAlertCount.useQuery();
  const { data: unreadAgents } = trpc.agent.unreadPerAgent.useQuery();
  const { data: pendingForJeff } = trpc.agent.pendingForJeff.useQuery();

  useEffect(() => {
    if (!loading && !isAuthenticated) setLocation("/login");
  }, [loading, isAuthenticated, setLocation]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <LoadingPage text="載入中…" />
      </div>
    );
  }
  if (!isAuthenticated) return null;

  // Domain badges
  const totalUnreadAgents = unreadAgents
    ? Object.values(unreadAgents).reduce((s, n) => s + n, 0)
    : 0;
  const officeBadge = totalUnreadAgents + (pendingForJeff?.length ?? 0);
  const opsBadge = statsData?.pendingInquiries;
  const marketingBadge =
    typeof competitorUnread === "number" && competitorUnread > 0
      ? competitorUnread
      : undefined;

  const domains: Domain[] = [
    { ...IA.office.domain, badge: officeBadge > 0 ? officeBadge : undefined },
    { ...IA.ops.domain, badge: opsBadge },
    { ...IA.customers.domain },
    { ...IA.marketing.domain, badge: marketingBadge },
    { ...IA.finance.domain },
    { ...IA.system.domain },
  ];

  const handleSelectDomain = (id: string) => {
    const def = IA[id as DomainId];
    if (!def) return;
    setActivePage(def.primary[0].id);
  };

  const toSubNavItem = (p: PageDef): SubNavItem => {
    let badge: number | undefined;
    if (p.id === "inquiries") badge = statsData?.pendingInquiries;
    if (p.id === "tours") badge = statsData?.activeTours;
    if (p.id === "competitor-monitor")
      badge =
        typeof competitorUnread === "number" && competitorUnread > 0
          ? competitorUnread
          : undefined;
    if (p.id === "autonomous-agents")
      badge = totalUnreadAgents > 0 ? totalUnreadAgents : undefined;
    return { id: p.id, label: p.label, badge };
  };
  const primaryItems: SubNavItem[] = IA[activeDomain].primary.map(toSubNavItem);
  const advancedItems: SubNavItem[] = IA[activeDomain].advanced.map(toSubNavItem);

  const activePageMeta = allPages(IA[activeDomain]).find((p) => p.id === activePage);
  const breadcrumb = [
    { label: "v2", muted: true as const },
    { label: IA[activeDomain].domain.label },
    { label: activePageMeta?.label ?? "" },
  ];

  // CommandPalette actions: every page across all 6 domains
  const paletteActions = Object.entries(IA).flatMap(([domainId, cfg]) =>
    allPages(cfg).map((p) => ({
      id: p.id,
      // Strip leading emoji (anything before the first CJK or word char)
      label: p.label.replace(/^[^一-鿿A-Za-z0-9]+/, ""),
      group: cfg.domain.label,
      onSelect: () => setActivePage(p.id),
    }))
  );

  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        actions={paletteActions}
      />

      <div className="flex-1 flex min-h-0">
        <DomainSidebar
          domains={domains}
          active={activeDomain}
          onSelect={handleSelectDomain}
          user={user ? { name: user.name, email: user.email } : undefined}
          onLogout={() => {
            logout();
            setLocation("/");
          }}
          onHome={() => setLocation("/")}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <TopBar
            breadcrumb={breadcrumb}
            onSearchClick={() => setPaletteOpen(true)}
          />
          <DomainSubNav
            primaryItems={primaryItems}
            advancedItems={advancedItems}
            active={activePage}
            onSelect={(id) => setActivePage(id as PageId)}
          />
          <main
            className={
              activePage === "agent-chat"
                ? "flex-1 overflow-hidden"
                : "flex-1 overflow-auto px-4 lg:px-6 py-4"
            }
          >
            <Suspense fallback={<LoadingPage text="載入中…" />}>
              {renderPage(activePage, setActivePage)}
            </Suspense>
          </main>
        </div>
      </div>
    </div>
  );
}

function renderPage(page: PageId, setActivePage: (p: PageId) => void) {
  switch (page) {
    // Office
    case "today":
      return <UnifiedInbox onNavigate={(t) => setActivePage(t as PageId)} />;
    case "agent-chat":
      return <AgentChatPage />;

    // Operations
    case "ops-landing":
      return <OpsLanding onNavigate={(t) => setActivePage(t as PageId)} />;
    case "tours":
      return <ToursTab />;
    case "bookings":
      // 🆕 V2 pilot redesign
      return <BookingsTabV2 />;
    case "inquiries":
      return <InquiriesTab />;
    case "tour-monitor":
      return <MonitorDashboard />;
    case "suppliers":
      return <SuppliersTab />;

    // Customers
    case "customers-landing":
      return <CustomersLanding onNavigate={(t) => setActivePage(t as PageId)} />;
    case "reviews":
      return <ReviewsTab />;
    case "tool-quote":
      return <QuoteToolTab />;
    case "ai-quotes":
      return <AiQuotesTab />;
    case "packpoint":
      return <PackpointTab />;
    case "vouchers":
      return <VouchersTab />;
    case "wechat-assist":
      return <WechatAssistTab />;

    // Marketing
    case "marketing-landing":
      return <MarketingLanding onNavigate={(t) => setActivePage(t as PageId)} />;
    case "marketing":
      return <MarketingTab />;
    case "marketing-content":
      return <MarketingContentTab />;
    case "posters":
      return <PostersTab />;
    case "analytics":
      return <AnalyticsTab />;
    case "competitor-monitor":
      return <CompetitorMonitorTab />;
    case "affiliate":
      return <AffiliateTab />;

    // Finance
    case "finance-landing":
      return <FinanceLanding onNavigate={(t) => setActivePage(t as PageId)} />;
    case "accounting":
      return <AccountingTab />;
    case "invoices":
      return <InvoicesTab />;
    case "reconciliation":
      return <ReconciliationTab />;

    // System
    case "ai-hub":
      return <AiHubTab />;
    case "llm-cost":
      return <LlmCostTab />;
    case "task-history":
      return <TaskHistoryContent />;
    case "audit-log":
      return <AuditLogTab />;
    case "calibration-review":
      return <CalibrationReviewTab />;
    case "autonomous-agents":
      return <AutonomousAgentsTab />;
    case "visa":
      return <VisaManagementTab />;

    default:
      return (
        <div className="text-center py-16 text-gray-400">
          Unknown page: {page}
        </div>
      );
  }
}
