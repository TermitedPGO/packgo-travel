/**
 * PACK&GO Admin — chat-first shell. Canonical at /admin since 2026-05-29.
 *
 * Component/file stay named AdminV2 (Jeff: keep filenames, just drop the
 * user-facing "v2"). v1 shell is retired; /admin/v2 redirects here.
 *
 * 3 domains (2026-05-31 v4):
 *   - 💬 Chat       agent chat (home). 詢問 / 指揮中心 / 今日 are ⌘K-only.
 *   - 📖 帳本       交易明細 + 報表 (Jeff 每天看帳).
 *   - 📋 工作台      訂單 + 行程.
 *
 * Every other page (~30) stays registered in IA under a `hidden` tier,
 * NOT on the sidebar, but still indexed by ⌘K. See IA + allPages() below.
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
  MessageSquare,
  ClipboardList,
  BookOpen,
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
import MobileShell from "@/components/mobile/MobileShell";
import MobileMenuDrawer from "@/components/mobile/MobileMenuDrawer";
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
// 2026-05-29 — 5 張財務報表 (損益表/對帳/發票/客人訂金/報稅匯出) 收進這個
// hub 的內層切換。ProfitLossV2 / TrustComplianceV2 / AccountingTab /
// InvoicesTab / ReconciliationTab 現在都由 FinanceReports 內部 lazy-import。
const FinanceReports = lazy(() => import("@/components/admin-v2/FinanceReports"));
const CustomersTabV2 = lazy(() => import("@/components/admin-v2/CustomersTabV2"));
const NewsletterTabV2 = lazy(() => import("@/components/admin-v2/NewsletterTabV2"));
const DepartureCalendarV2 = lazy(() => import("@/components/admin-v2/DepartureCalendarV2"));
// 指揮中心 (Command Center) — 審核箱 spine (S-4). Four lanes grow on it (P1-P4).
const CommandCenterTab = lazy(() => import("@/components/admin-v2/CommandCenter/CommandCenterTab"));

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
const AiHubTab = lazy(() => import("@/components/admin/AiHubTab"));
const TaskHistoryContent = lazy(() => import("@/components/admin/TaskHistoryContent"));
const AuditLogTab = lazy(() => import("@/components/admin/AuditLogTab"));
const CalibrationReviewTab = lazy(() => import("@/components/admin/CalibrationReviewTab"));
const AutonomousAgentsTab = lazy(() => import("@/components/admin/AutonomousAgentsTab"));
const VisaManagementTab = lazy(() => import("@/components/admin/VisaManagementTab"));
const SkillsTab = lazy(() => import("@/components/admin/SkillsTab"));

// ────────────────────────────────────────────────────────────────────────
// Information architecture — 3 domains (Chat / 帳本 / 工作台)
// ────────────────────────────────────────────────────────────────────────

type PageId =
  // Office
  | "command-center" | "today" | "agent-chat"
  // Operations
  | "ops-landing" | "tours" | "bookings" | "inquiries" | "tour-monitor" | "suppliers" | "departures-calendar"
  // Customers
  | "customers-landing" | "customers-crm" | "reviews" | "packpoint" | "vouchers" | "ai-quotes" | "tool-quote" | "wechat-assist" | "newsletter"
  // Marketing
  | "marketing-landing" | "marketing" | "marketing-content" | "posters" | "analytics" | "competitor-monitor" | "affiliate"
  // Finance — 3 visible tabs (總覽/帳本/報表); the 5 report ids stay as
  // routable deep-link aliases that resolve into the 報表 hub.
  | "finance-landing" | "bank-ledger" | "finance-reports"
  | "profit-loss" | "trust-compliance" | "invoices" | "reconciliation" | "accounting"
  // System
  | "ai-hub" | "llm-cost" | "task-history" | "audit-log" | "calibration-review" | "autonomous-agents" | "skills" | "visa" | "cleanup" | "supplier-enrichment";

type DomainId = "chat" | "ledger" | "workspace";

type PageDef = { id: PageId; label: string };

// 2026-05-31 v4 (Jeff): 3 domains — Chat / 帳本 / 工作台。
// 帳本獨立 domain (Jeff 每天看帳); 詢問整進 Chat (Gmail 回覆走 Agent 通知)。
//   primary  = 每天手動看 → sub-nav 直接顯示
//   advanced = 偶爾用 → 收進「進階」下拉
//   hidden   = 幾乎不用 → 不進 sub-nav, 只留在 IA 供 CMD+K 搜尋 (見 allPages)
const IA: Record<
  DomainId,
  { domain: Domain; primary: PageDef[]; advanced: PageDef[]; hidden?: PageDef[] }
> = {
  chat: {
    domain: { id: "chat", label: "Chat", icon: MessageSquare },
    primary: [
      { id: "agent-chat", label: "PACK&GO Agent" },
      { id: "today", label: "收件匣" },
      { id: "inquiries", label: "詢問" },
    ],
    advanced: [],
    hidden: [
      { id: "command-center", label: "指揮中心" },
    ],
  },
  ledger: {
    // 帳本 — Jeff 每天看帳, 獨立 domain。
    domain: { id: "ledger", label: "帳本", icon: BookOpen },
    primary: [
      { id: "bank-ledger", label: "交易明細" },
      { id: "finance-reports", label: "報表" },
    ],
    advanced: [],
    hidden: [
      { id: "finance-landing", label: "財務總覽" },
    ],
  },
  workspace: {
    // 工作台 — 訂單 + 行程, 其餘全靠 Agent 或 CMD+K。
    domain: { id: "workspace", label: "工作台", icon: ClipboardList },
    primary: [
      { id: "bookings", label: "訂單" },
      { id: "tours", label: "行程" },
    ],
    advanced: [],
    hidden: [
      { id: "departures-calendar", label: "出發日曆" },
      { id: "customers-crm", label: "客戶" },
      { id: "ops-landing", label: "營運總覽" },
      { id: "tour-monitor", label: "供應商監控" },
      { id: "suppliers", label: "供應商同步" },
      { id: "customers-landing", label: "客戶總覽" },
      { id: "reviews", label: "評價" },
      { id: "packpoint", label: "Packpoint" },
      { id: "vouchers", label: "Voucher" },
      { id: "ai-quotes", label: "AI 報價單" },
      { id: "tool-quote", label: "報價單" },
      { id: "wechat-assist", label: "WeChat 助手" },
      { id: "newsletter", label: "Newsletter" },
      { id: "marketing-landing", label: "行銷總覽" },
      { id: "marketing", label: "行銷自動化" },
      { id: "marketing-content", label: "AI 文案" },
      { id: "posters", label: "海報" },
      { id: "analytics", label: "流量分析" },
      { id: "competitor-monitor", label: "競品監控" },
      { id: "affiliate", label: "Trip.com 聯盟" },
      { id: "ai-hub", label: "AI 中心" },
      { id: "llm-cost", label: "AI 成本" },
      { id: "task-history", label: "任務記錄" },
      { id: "audit-log", label: "審計日誌" },
      { id: "calibration-review", label: "QA 審查" },
      { id: "autonomous-agents", label: "自主 Agent" },
      { id: "skills", label: "AI 技能" },
      { id: "visa", label: "中國簽證" },
      { id: "cleanup", label: "清理" },
      { id: "supplier-enrichment", label: "供應商深度同步" },
    ],
  },
};

function allPages(cfg: {
  primary: PageDef[];
  advanced: PageDef[];
  hidden?: PageDef[];
}): PageDef[] {
  // hidden = pages kept in the registry for ⌘K search but NOT rendered in the
  // sidebar sub-nav. primary/advanced render; hidden is palette-only.
  return [...cfg.primary, ...cfg.advanced, ...(cfg.hidden ?? [])];
}

const PAGE_TO_DOMAIN: Record<PageId, DomainId> = {
  ...(Object.fromEntries(
    Object.entries(IA).flatMap(([d, cfg]) =>
      allPages(cfg).map((p) => [p.id, d])
    )
  ) as Record<PageId, DomainId>),
  // The 5 report sub-views are no longer standalone tabs (folded into 報表),
  // so allPages() doesn't list them. Map them to 帳本 so a deep-link to
  // e.g. "reconciliation" still highlights the right domain.
  "profit-loss": "ledger",
  "trust-compliance": "ledger",
  "invoices": "ledger",
  "reconciliation": "ledger",
  "accounting": "ledger",
};

// Finance report sub-views fold into the 報表 hub (FinanceReports). This maps
// each routable alias → the hub's inner view; presence in this map also tells
// the shell to highlight the 報表 tab + label the breadcrumb as 報表.
const FINANCE_REPORT_VIEW: Partial<
  Record<PageId, "pl" | "recon" | "invoices" | "trust" | "tax">
> = {
  "finance-reports": "pl",
  "profit-loss": "pl",
  "reconciliation": "recon",
  "invoices": "invoices",
  "trust-compliance": "trust",
  "accounting": "tax",
};

// ────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────

export default function AdminV2() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [, setLocation] = useLocation();
  // Default landing = Agent Chat (💬 Chat domain). Jeff opens /admin and can type
  // immediately; 今日總覽 / 指揮中心 stay reachable via the Chat sidebar tabs.
  const [activePage, setActivePage] = useState<PageId>("agent-chat");
  const [paletteOpen, setPaletteOpen] = useCommandPaletteHotkey();
  const activeDomain = PAGE_TO_DOMAIN[activePage] ?? "chat";
  const isMobile = useIsMobile();
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
  const chatBadge = totalUnreadAgents + (pendingForJeff?.length ?? 0);
  const inquiryBadge = statsData?.pendingInquiries;

  const domains: Domain[] = [
    { ...IA.chat.domain, badge: (chatBadge > 0 ? chatBadge : undefined) ?? (inquiryBadge ? inquiryBadge : undefined) },
    { ...IA.ledger.domain },
    { ...IA.workspace.domain },
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

  // A deep-link can land on a finance report sub-view that no longer has its
  // own tab. Highlight the 報表 hub tab for any of those aliases.
  const isFinanceReportAlias =
    activePage !== "finance-reports" && activePage in FINANCE_REPORT_VIEW;
  const subNavActive: PageId = isFinanceReportAlias ? "finance-reports" : activePage;

  const activePageMeta = allPages(IA[activeDomain]).find((p) => p.id === subNavActive);
  const breadcrumb = [
    { label: IA[activeDomain].domain.label },
    { label: activePageMeta?.label ?? "" },
  ];

  // CommandPalette actions: every page across both domains (incl. hidden)
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
          breadcrumb={mobileBreadcrumbText}
          onMenuClick={() => setMobileMenuOpen(true)}
          showBack={activePage !== "agent-chat"}
          onBack={() => setActivePage("agent-chat")}
          onSearchClick={() => setMobileSearchOpen(true)}
          fullHeight={activePage === "agent-chat"}
        >
          <Suspense fallback={<LoadingPage text="載入中…" />}>
            {renderMobilePage()}
          </Suspense>
        </MobileShell>
        <MobileMenuDrawer
          open={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
          actions={paletteActions}
        />
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
            active={subNavActive}
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
    case "command-center":
      return <CommandCenterTab />;
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
    case "departures-calendar":
      return <DepartureCalendarV2 />;

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
    case "newsletter":
      return <NewsletterTabV2 />;

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

    // Finance — 總覽 / 帳本 are standalone; the 5 report aliases all resolve
    // into the FinanceReports hub at the right inner view.
    case "finance-landing":
      return <FinanceLanding onNavigate={(t) => setActivePage(t as PageId)} />;
    case "bank-ledger":
      return <BankLedgerV2 />;
    case "finance-reports":
      return <FinanceReports />;
    case "profit-loss":
      return <FinanceReports initialView="pl" />;
    case "trust-compliance":
      return <FinanceReports initialView="trust" />;
    case "invoices":
      return <FinanceReports initialView="invoices" />;
    case "reconciliation":
      return <FinanceReports initialView="recon" />;
    case "accounting":
      return <FinanceReports initialView="tax" />;

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
    case "skills":
      return <SkillsTab />;
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
