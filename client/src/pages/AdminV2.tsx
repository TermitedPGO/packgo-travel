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
import { useIsMobile } from "@/_core/hooks/useIsMobile";
import MobileShell, { type MobileNavId } from "@/components/mobile/MobileShell";
const DailyCheckMobile = lazy(() => import("@/components/mobile/DailyCheckMobile"));
const GlobalSearchSheet = lazy(() => import("@/components/mobile/GlobalSearchSheet"));
const BankTriagePage = lazy(() => import("@/components/mobile/BankTriagePage"));
const ReceiptCameraFAB = lazy(() => import("@/components/mobile/ReceiptCameraFAB"));

// V2 redesigned tabs — Trip.com style. One per file so each can evolve
// independently of the v1 counterpart.
const BookingsTabV2 = lazy(() => import("@/components/admin-v2/BookingsTabV2"));
const InquiriesTabV2 = lazy(() => import("@/components/admin-v2/InquiriesTabV2"));
const ReviewsTabV2 = lazy(() => import("@/components/admin-v2/ReviewsTabV2"));
const PackpointTabV2 = lazy(() => import("@/components/admin-v2/PackpointTabV2"));
const VouchersTabV2 = lazy(() => import("@/components/admin-v2/VouchersTabV2"));
const LlmCostTabV2 = lazy(() => import("@/components/admin-v2/LlmCostTabV2"));
const MonitorDashboardV2 = lazy(() => import("@/components/admin-v2/MonitorDashboardV2"));
const CleanupTabV2 = lazy(() => import("@/components/admin-v2/CleanupTabV2"));
const SupplierEnrichmentTabV2 = lazy(() => import("@/components/admin-v2/SupplierEnrichmentTabV2"));
const BankLedgerV2 = lazy(() => import("@/components/admin-v2/BankLedgerV2"));
const CustomersTabV2 = lazy(() => import("@/components/admin-v2/CustomersTabV2"));

// All other tabs initially come from V1. They're consumed AS-IS; we replace
// them one by one with V2 redesigns. Listed here for the lazy-loader.
const UnifiedInbox = lazy(() => import("@/components/admin/UnifiedInbox"));
const AgentChatPage = lazy(() => import("@/components/admin/AgentChatPage"));
const OpsLanding = lazy(() => import("@/components/admin/landings/OpsLanding"));
const CustomersLanding = lazy(() => import("@/components/admin/landings/CustomersLanding"));
const MarketingLanding = lazy(() => import("@/components/admin/landings/MarketingLanding"));
const FinanceLanding = lazy(() => import("@/components/admin/landings/FinanceLanding"));
const ToursTab = lazy(() => import("@/components/admin/ToursTab"));
const SuppliersTab = lazy(() => import("@/components/admin/SuppliersTab"));
const AiQuotesTab = lazy(() => import("@/components/admin/AiQuotesTab"));
const WechatAssistTab = lazy(() => import("@/components/admin/WechatAssistTab"));
const QuoteToolTab = lazy(() => import("@/components/admin/tools/QuoteToolTab"));
const MarketingTab = lazy(() => import("@/components/admin/MarketingTab"));
const MarketingContentTab = lazy(() => import("@/components/admin/MarketingContentTab"));
const PostersTab = lazy(() => import("@/components/admin/PostersTab"));
const AnalyticsTab = lazy(() => import("@/components/admin/AnalyticsTab"));
const CompetitorMonitorTab = lazy(() => import("@/components/admin/CompetitorMonitorTab"));
const AffiliateTab = lazy(() => import("@/components/admin/AffiliateTab"));
// 2026-05-22 — AccountingTab retired. See finance domain comment.
const InvoicesTab = lazy(() => import("@/components/admin/InvoicesTab"));
const ReconciliationTab = lazy(() => import("@/components/admin/ReconciliationTab"));
const AiHubTab = lazy(() => import("@/components/admin/AiHubTab"));
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
  | "customers-landing" | "customers-crm" | "reviews" | "packpoint" | "vouchers" | "ai-quotes" | "tool-quote" | "wechat-assist"
  // Marketing
  | "marketing-landing" | "marketing" | "marketing-content" | "posters" | "analytics" | "competitor-monitor" | "affiliate"
  // Finance
  | "finance-landing" | "bank-ledger" | "invoices" | "reconciliation"
  // System
  | "ai-hub" | "llm-cost" | "task-history" | "audit-log" | "calibration-review" | "autonomous-agents" | "visa" | "cleanup" | "supplier-enrichment";

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
      { id: "customers-crm", label: "🔍 客戶 CRM" },
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
    // 2026-05-22 — Jeff: "這兩頁意義何在". Dropped legacy "帳務"
    // (AccountingTab) tab. It read from manual financialEntries table
    // that nobody populated (all NT$0) and had hardcoded TWD currency.
    // Plaid → AccountingAgent → BankLedger is the single source of truth now.
    domain: { id: "finance", label: "財務", icon: Wallet },
    primary: [
      { id: "finance-landing", label: "💰 總覽" },
      { id: "bank-ledger", label: "🏦 銀行帳本" },
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
      { id: "supplier-enrichment", label: "🌏 供應商深度同步" },
      { id: "cleanup", label: "🧹 清理" },
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
  const isMobile = useIsMobile();
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

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

  // Mobile Phase 1 (2026-05-22) — branch to MobileShell on narrow screens.
  // Same data layer (renderPage / activePage); only chrome differs.
  if (isMobile) {
    const mobileNavActive: MobileNavId =
      activePage === "today" ? "today"
      : activePage === "bank-ledger" || activePage === "finance-landing" ? "bank"
      : activeDomain === "customers" ? "customers"
      : activePage === "agent-chat" ? "inbox"
      : "more";

    const handleMobileNav = (id: MobileNavId) => {
      if (id === "today") setActivePage("today");
      else if (id === "bank") setActivePage("bank-ledger");
      else if (id === "customers") setActivePage("customers-landing");
      else if (id === "inbox") setActivePage("agent-chat");
      else if (id === "more") setActivePage("ai-hub"); // System landing as "more"
    };

    const mobileBreadcrumbText = breadcrumb
      .filter((b) => !("muted" in b && b.muted))
      .map((b) => b.label)
      .filter(Boolean)
      .join(" · ");

    // Mobile-specific page render — branches off renderPage for pages
    // that have a mobile-tuned counterpart.
    const renderMobilePage = () => {
      switch (activePage) {
        case "today":
          return <DailyCheckMobile onNavigate={(p) => setActivePage(p as PageId)} />;
        case "bank-ledger":
          // Mobile bank-ledger entry point: if ?triage=1 in URL OR Jeff
          // taps "AI 分類 53 筆" we render the swipe triage; otherwise
          // fall back to desktop BankLedgerV2 inside the mobile shell.
          if (typeof window !== "undefined" && new URL(window.location.href).searchParams.get("triage") === "1") {
            return (
              <BankTriagePage
                onExit={() => {
                  const u = new URL(window.location.href);
                  u.searchParams.delete("triage");
                  u.searchParams.delete("triageIdx");
                  window.history.replaceState({}, "", u.toString());
                  setActivePage("today");
                }}
              />
            );
          }
          return renderPage(activePage, setActivePage);
        default:
          return renderPage(activePage, setActivePage);
      }
    };

    return (
      <div className="h-screen bg-gray-50">
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          actions={paletteActions}
        />
        <MobileShell
          active={mobileNavActive}
          onSelect={handleMobileNav}
          breadcrumb={mobileBreadcrumbText}
          onSearchClick={() => setMobileSearchOpen(true)}
        >
          <Suspense fallback={<LoadingPage text="載入中…" />}>
            {renderMobilePage()}
          </Suspense>
        </MobileShell>
        <Suspense fallback={null}>
          <GlobalSearchSheet
            open={mobileSearchOpen}
            onClose={() => setMobileSearchOpen(false)}
            onNavigate={(p) => setActivePage(p as PageId)}
          />
          {/* Mobile Phase 6: persistent receipt camera FAB */}
          <ReceiptCameraFAB />
        </Suspense>
      </div>
    );
  }

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
      // 🆕 V2 redesign #2
      return <InquiriesTabV2 />;
    case "tour-monitor":
      // 🆕 V2 redesign #7
      return <MonitorDashboardV2 />;
    case "suppliers":
      return <SuppliersTab />;

    // Customers
    case "customers-landing":
      return <CustomersLanding onNavigate={(t) => setActivePage(t as PageId)} />;
    case "customers-crm":
      return <CustomersTabV2 />;
    case "reviews":
      // 🆕 V2 redesign #3
      return <ReviewsTabV2 />;
    case "tool-quote":
      return <QuoteToolTab />;
    case "ai-quotes":
      return <AiQuotesTab />;
    case "packpoint":
      // 🆕 V2 redesign #4
      return <PackpointTabV2 />;
    case "vouchers":
      // 🆕 V2 redesign #5
      return <VouchersTabV2 />;
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
    case "bank-ledger":
      return <BankLedgerV2 />;
    case "invoices":
      return <InvoicesTab />;
    case "reconciliation":
      return <ReconciliationTab />;

    // System
    case "ai-hub":
      return <AiHubTab />;
    case "llm-cost":
      // 🆕 V2 redesign #6
      return <LlmCostTabV2 />;
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
    case "cleanup":
      return <CleanupTabV2 />;
    case "supplier-enrichment":
      return <SupplierEnrichmentTabV2 />;

    default:
      return (
        <div className="text-center py-16 text-gray-400">
          Unknown page: {page}
        </div>
      );
  }
}
