/**
 * PACK&GO Admin — Session A IA cleanup (Round 81+).
 *
 * 5 domains, each with 1 primary tab + advanced dropdown:
 *   - 🏢 辦公室     primary: 收件匣            adv: 聊天 / 練習場 / AI 中心 / QA / 任務 / 成本
 *   - 📋 營運       primary: 行程              adv: 總覽 / 收件匣 / 訂單 / 詢問 / 供應商監控
 *   - 👥 客戶       primary: 評價              adv: 報價單 / AI 報價 / Packpoint / Voucher / WeChat / 中國簽證
 *   - 📢 行銷       primary: 海報              adv: 自動化 / AI 文案 / 流量 / 競品 / Trip.com 聯盟
 *   - 💰 財務       primary: 總覽              adv: 帳務 / 發票 / 對帳
 *
 * One-person ops principle: surface daily-flow first, push everything else
 * into the 進階 dropdown so sub-nav stays calm.
 *
 * Design system codified in:
 *   ~/.claude/projects/-Users-jeff-Desktop---/memory/feedback_admin_design_system.md
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoadingPage } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc";
import {
  Building2,
  ClipboardList,
  Users,
  Megaphone,
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

// All existing tab components (wrapped in the new shell — no behavior change)
import DashboardTab from "@/components/admin/DashboardTab";
import ToursTab from "@/components/admin/ToursTab";
import BookingsTab from "@/components/admin/BookingsTab";
import InquiriesTab from "@/components/admin/InquiriesTab";
import InboxTab from "@/components/admin/InboxTab";
import ReviewsTab from "@/components/admin/ReviewsTab";
import AiHubTab from "@/components/admin/AiHubTab";
import AnalyticsTab from "@/components/admin/AnalyticsTab";
import TaskHistoryContent from "@/components/admin/TaskHistoryContent";
import AuditLogTab from "@/components/admin/AuditLogTab";
import CalibrationReviewTab from "@/components/admin/CalibrationReviewTab";
import CompetitorMonitorTab from "@/components/admin/CompetitorMonitorTab";
import MarketingTab from "@/components/admin/MarketingTab";
import VisaManagementTab from "@/components/admin/VisaManagementTab";
import AffiliateTab from "@/components/admin/AffiliateTab";
import AccountingTab from "@/components/admin/AccountingTab";
import FinanceTab from "@/components/admin/FinanceTab";
import SuppliersTab from "@/components/admin/SuppliersTab";
import MonitorDashboard from "@/components/admin/MonitorDashboard";
import AiQuotesTab from "@/components/admin/AiQuotesTab";
import WechatAssistTab from "@/components/admin/WechatAssistTab";
import InvoicesTab from "@/components/admin/InvoicesTab";
import ReconciliationTab from "@/components/admin/ReconciliationTab";
import MarketingContentTab from "@/components/admin/MarketingContentTab";
import LlmCostTab from "@/components/admin/LlmCostTab";
import PackpointTab from "@/components/admin/PackpointTab";
import VouchersTab from "@/components/admin/VouchersTab";
import PostersTab from "@/components/admin/PostersTab";
import AutonomousAgentsTab from "@/components/admin/AutonomousAgentsTab";
import OfficeOverviewTab from "@/components/admin/OfficeOverviewTab";
// Round 81 Phase A: server-side PACK&GO skill (quote PDF)
import QuoteToolTab from "@/components/admin/tools/QuoteToolTab";
// Round 81 Phase 1 of C workflow: Inbox-first default landing
import OfficeInboxTab from "@/components/admin/OfficeInboxTab";
// Round 81 — per-agent Slack-like channel view; replaces legacy
// OfficeOverviewTab as the "聊天" page. Built on agentMessages table.
import ChatsTab from "@/components/admin/ChatsTab";
// Round 81 (2026-05-17) — Today's-pulse landing: single-screen 5-domain
// KPIs + triage + recent activity. Replaces office-inbox as Jeff's
// default entry. Office-inbox stays accessible as "advanced" sub-page.
import TodayOverview from "@/components/admin/TodayOverview";
// Round 81 (2026-05-17) — 4 per-domain landing pages. Each domain (Ops,
// Customers, Marketing, Finance) gets a dedicated at-a-glance dashboard
// at the top of its menu, before drilling into specific sub-pages.
import OpsLanding from "@/components/admin/landings/OpsLanding";
import CustomersLanding from "@/components/admin/landings/CustomersLanding";
import MarketingLanding from "@/components/admin/landings/MarketingLanding";
import FinanceLanding from "@/components/admin/landings/FinanceLanding";

// ────────────────────────────────────────────────────────────────────────
// Information architecture
// ────────────────────────────────────────────────────────────────────────

type PageId =
  // Round 81 (2026-05-17) — TodayOverview is the new default landing
  | "today"
  // Office — Inbox is the default; everything else is advanced
  | "office-inbox" | "office-chat" | "autonomous-agents" | "ai-hub" | "task-history" | "calibration-review" | "llm-cost" | "audit-log"
  // Round 81 (2026-05-17) — Per-domain landing pages
  | "ops-landing" | "customers-landing" | "marketing-landing" | "finance-landing"
  // Operations
  | "dashboard" | "inbox" | "tours" | "bookings" | "inquiries" | "tour-monitor" | "suppliers"
  // Customers — now includes 中國簽證
  | "reviews" | "packpoint" | "vouchers" | "ai-quotes" | "wechat-assist" | "tool-quote" | "visa"
  // Marketing — now includes Trip.com 聯盟
  | "marketing" | "marketing-content" | "posters" | "analytics" | "competitor-monitor" | "affiliate"
  // Finance (formerly System)
  | "finance" | "accounting" | "invoices" | "reconciliation";

type DomainId = "office" | "ops" | "customers" | "marketing" | "system";

type PageDef = { id: PageId; label: string };

const IA: Record<DomainId, { domain: Domain; primary: PageDef[]; advanced: PageDef[] }> = {
  office: {
    domain: { id: "office", label: "辦公室", icon: Building2 },
    primary: [
      { id: "today", label: "🏠 今日概覽" },
      { id: "office-chat", label: "💬 Agent Chats" },
      { id: "office-inbox", label: "📥 收件匣" },
    ],
    advanced: [
      // 2026-05-17: removed "練習場" (autonomous-agents) per Jeff —
      // not needed in daily flow. Component file kept for any deep
      // links from elsewhere but not surfaced in nav.
      { id: "ai-hub", label: "AI 中心" },
      { id: "calibration-review", label: "QA 審查" },
      { id: "task-history", label: "任務記錄" },
      { id: "audit-log", label: "審計日誌" },
      { id: "llm-cost", label: "AI 成本" },
    ],
  },
  ops: {
    domain: { id: "ops", label: "營運", icon: ClipboardList },
    primary: [
      { id: "ops-landing", label: "🗺 總覽" },
      { id: "tours", label: "行程" },
      { id: "bookings", label: "訂單" },
      { id: "inquiries", label: "詢問" },
    ],
    advanced: [
      { id: "dashboard", label: "Dashboard" },
      { id: "inbox", label: "舊收件匣" },
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
      { id: "visa", label: "中國簽證" },
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
  system: {
    domain: { id: "system", label: "財務", icon: Settings },
    primary: [
      { id: "finance-landing", label: "💰 總覽" },
      { id: "accounting", label: "帳務" },
    ],
    advanced: [
      { id: "finance", label: "舊總覽" },
      { id: "invoices", label: "發票" },
      { id: "reconciliation", label: "對帳" },
    ],
  },
};

function allPages(cfg: { primary: PageDef[]; advanced: PageDef[] }): PageDef[] {
  return [...cfg.primary, ...cfg.advanced];
}

// Reverse lookup: pageId → domainId
const PAGE_TO_DOMAIN: Record<PageId, DomainId> = Object.fromEntries(
  Object.entries(IA).flatMap(([d, cfg]) =>
    allPages(cfg).map((p) => [p.id, d])
  )
) as Record<PageId, DomainId>;

// ────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────

export default function Admin() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [activePage, setActivePage] = useState<PageId>("today");
  const [paletteOpen, setPaletteOpen] = useCommandPaletteHotkey();
  const activeDomain = PAGE_TO_DOMAIN[activePage] ?? "office";

  // Badge counts
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

  // Compute domain-level badges
  const totalUnreadAgents = unreadAgents
    ? Object.values(unreadAgents).reduce((s, n) => s + n, 0)
    : 0;
  const officeBadge = totalUnreadAgents + (pendingForJeff?.length ?? 0);
  const opsBadge = statsData?.pendingInquiries;
  const marketingBadge =
    typeof competitorUnread === "number" && competitorUnread > 0
      ? competitorUnread
      : undefined;

  // Inject badges into domains
  const domains: Domain[] = [
    { ...IA.office.domain, badge: officeBadge > 0 ? officeBadge : undefined },
    { ...IA.ops.domain, badge: opsBadge },
    { ...IA.customers.domain },
    { ...IA.marketing.domain, badge: marketingBadge },
    { ...IA.system.domain },
  ];

  // Sub-nav for the active domain — primary inline, advanced in dropdown
  const toSubNavItem = (p: PageDef): SubNavItem => {
    let badge: number | undefined;
    if (p.id === "inquiries") badge = statsData?.pendingInquiries;
    if (p.id === "tours") badge = statsData?.activeTours;
    if (p.id === "competitor-monitor")
      badge =
        typeof competitorUnread === "number" && competitorUnread > 0
          ? competitorUnread
          : undefined;
    if (p.id === "office-inbox") badge = pendingForJeff?.length;
    if (p.id === "autonomous-agents")
      badge = totalUnreadAgents > 0 ? totalUnreadAgents : undefined;
    return { id: p.id, label: p.label, badge };
  };
  const primaryItems: SubNavItem[] = IA[activeDomain].primary.map(toSubNavItem);
  const advancedItems: SubNavItem[] = IA[activeDomain].advanced.map(toSubNavItem);

  const activePageMeta = allPages(IA[activeDomain]).find((p) => p.id === activePage);
  const breadcrumb = [
    { label: IA[activeDomain].domain.label },
    { label: activePageMeta?.label ?? "" },
  ];

  // Palette actions: every page in IA as a jump
  const paletteActions = Object.entries(IA).flatMap(([d, cfg]) =>
    allPages(cfg).map((p) => ({
      id: p.id,
      label: p.label,
      hint: cfg.domain.label,
      icon: <cfg.domain.icon className="h-3.5 w-3.5" />,
      onSelect: () => setActivePage(p.id),
    }))
  );

  const handleSelectDomain = (id: string) => {
    const domain = id as DomainId;
    // Switching domain → jump to that domain's primary page
    setActivePage(IA[domain].primary[0].id);
  };

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
          <main className="flex-1 overflow-auto px-4 lg:px-6 py-4">
            {renderPage(activePage, setActivePage)}
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
      return <TodayOverview onNavigate={(t) => setActivePage(t as PageId)} />;
    // Round 81 (2026-05-17) — Per-domain landing pages
    case "ops-landing":
      return <OpsLanding onNavigate={(t) => setActivePage(t as PageId)} />;
    case "customers-landing":
      return <CustomersLanding onNavigate={(t) => setActivePage(t as PageId)} />;
    case "marketing-landing":
      return <MarketingLanding onNavigate={(t) => setActivePage(t as PageId)} />;
    case "finance-landing":
      return <FinanceLanding onNavigate={(t) => setActivePage(t as PageId)} />;
    case "office-inbox":
      return <OfficeInboxTab onNavigate={(t) => setActivePage(t as PageId)} />;
    case "office-chat":
      // Round 81 (2026-05-17): swap OfficeOverviewTab → ChatsTab per Jeff's
      // "Slack-like per-agent channel" requirement. OfficeOverviewTab still
      // exists for now in case we need to compare; safe to delete after a
      // week of ChatsTab usage proves it covers all the same flows.
      return <ChatsTab />;
    case "autonomous-agents":
      return <AutonomousAgentsTab />;
    case "ai-hub":
      return <AiHubTab />;
    case "task-history":
      return <TaskHistoryContent />;
    case "audit-log":
      return <AuditLogTab />;
    case "calibration-review":
      return <CalibrationReviewTab />;
    case "llm-cost":
      return <LlmCostTab />;

    // Operations
    case "dashboard":
      return <DashboardTab onNavigate={(t) => setActivePage(t as PageId)} />;
    case "inbox":
      return <InboxTab onNavigate={(t) => setActivePage(t as PageId)} />;
    case "tours":
      return <ToursTab />;
    case "bookings":
      return <BookingsTab />;
    case "inquiries":
      return <InquiriesTab />;
    case "tour-monitor":
      return <MonitorDashboard />;
    case "suppliers":
      return <SuppliersTab />;

    // Customers
    case "reviews":
      return <ReviewsTab />;
    case "packpoint":
      return <PackpointTab />;
    case "vouchers":
      return <VouchersTab />;
    case "ai-quotes":
      return <AiQuotesTab />;
    case "wechat-assist":
      return <WechatAssistTab />;
    case "tool-quote":
      return <QuoteToolTab />;

    // Marketing
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

    // System
    case "finance":
      return <FinanceTab />;
    case "accounting":
      return <AccountingTab />;
    case "invoices":
      return <InvoicesTab />;
    case "reconciliation":
      return <ReconciliationTab />;
    case "visa":
      return <VisaManagementTab />;
    case "affiliate":
      return <AffiliateTab />;

    default:
      return <div className="text-center py-16 text-gray-400">Unknown page: {page}</div>;
  }
}
