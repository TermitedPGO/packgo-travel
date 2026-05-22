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

// v2 Wave 1 Module 1.5 — every tab is lazy-loaded so the Admin shell stays
// small (was ~967 KB, target <200 KB). Vite emits each tab as its own chunk
// loaded only on first navigation to that tab. Single <Suspense> boundary
// at the renderPage call site shows <LoadingPage/> during the network fetch.
const DashboardTab = lazy(() => import("@/components/admin/DashboardTab"));
const ToursTab = lazy(() => import("@/components/admin/ToursTab"));
const BookingsTab = lazy(() => import("@/components/admin/BookingsTab"));
const InquiriesTab = lazy(() => import("@/components/admin/InquiriesTab"));
const InboxTab = lazy(() => import("@/components/admin/InboxTab"));
const ReviewsTab = lazy(() => import("@/components/admin/ReviewsTab"));
const AiHubTab = lazy(() => import("@/components/admin/AiHubTab"));
const AnalyticsTab = lazy(() => import("@/components/admin/AnalyticsTab"));
const TaskHistoryContent = lazy(() => import("@/components/admin/TaskHistoryContent"));
const AuditLogTab = lazy(() => import("@/components/admin/AuditLogTab"));
const CalibrationReviewTab = lazy(() => import("@/components/admin/CalibrationReviewTab"));
const CompetitorMonitorTab = lazy(() => import("@/components/admin/CompetitorMonitorTab"));
const MarketingTab = lazy(() => import("@/components/admin/MarketingTab"));
const VisaManagementTab = lazy(() => import("@/components/admin/VisaManagementTab"));
const AffiliateTab = lazy(() => import("@/components/admin/AffiliateTab"));
const AccountingTab = lazy(() => import("@/components/admin/AccountingTab"));
const FinanceTab = lazy(() => import("@/components/admin/FinanceTab"));
const SuppliersTab = lazy(() => import("@/components/admin/SuppliersTab"));
const MonitorDashboard = lazy(() => import("@/components/admin/MonitorDashboard"));
const AiQuotesTab = lazy(() => import("@/components/admin/AiQuotesTab"));
const WechatAssistTab = lazy(() => import("@/components/admin/WechatAssistTab"));
const InvoicesTab = lazy(() => import("@/components/admin/InvoicesTab"));
const ReconciliationTab = lazy(() => import("@/components/admin/ReconciliationTab"));
const MarketingContentTab = lazy(() => import("@/components/admin/MarketingContentTab"));
const LlmCostTab = lazy(() => import("@/components/admin/LlmCostTab"));
const PackpointTab = lazy(() => import("@/components/admin/PackpointTab"));
const VouchersTab = lazy(() => import("@/components/admin/VouchersTab"));
const PostersTab = lazy(() => import("@/components/admin/PostersTab"));
const AutonomousAgentsTab = lazy(() => import("@/components/admin/AutonomousAgentsTab"));
// Round 81 Phase A: server-side PACK&GO skill (quote PDF)
const QuoteToolTab = lazy(() => import("@/components/admin/tools/QuoteToolTab"));
// Round 81 Phase 1 of C workflow: Inbox-first default landing
const OfficeInboxTab = lazy(() => import("@/components/admin/OfficeInboxTab"));
// Round 81 — per-agent Slack-like channel view. The "聊天" page. Built on
// agentMessages table. (Replaced the legacy OfficeOverviewTab, deleted
// 2026-05-22 — see commit message for that removal.)
const ChatsTab = lazy(() => import("@/components/admin/ChatsTab"));
// Round 81 (2026-05-17) — UnifiedInbox is the default Office landing.
// Single vertical scroll: actionable items → Domain Pulse → activity feed.
// Replaced an earlier 3-tab split (TodayOverview + OfficeInboxTab + ChatsTab).
const UnifiedInbox = lazy(() => import("@/components/admin/UnifiedInbox"));
// Round 81 (2026-05-18) — full-page agent chat. Claude-Code-style
// document messages, wide reading width, full markdown. Replaced an
// earlier slide-out Sheet (FloatingOpsAgent, deleted 2026-05-18).
const AgentChatPage = lazy(() => import("@/components/admin/AgentChatPage"));
// Round 81 (2026-05-17) — 4 per-domain landing pages. Each domain (Ops,
// Customers, Marketing, Finance) gets a dedicated at-a-glance dashboard
// at the top of its menu, before drilling into specific sub-pages.
const OpsLanding = lazy(() => import("@/components/admin/landings/OpsLanding"));
const CustomersLanding = lazy(() => import("@/components/admin/landings/CustomersLanding"));
const MarketingLanding = lazy(() => import("@/components/admin/landings/MarketingLanding"));
const FinanceLanding = lazy(() => import("@/components/admin/landings/FinanceLanding"));

// ────────────────────────────────────────────────────────────────────────
// Information architecture
// ────────────────────────────────────────────────────────────────────────

type PageId =
  | "today"           // UnifiedInbox
  | "agent-chat"      // Full-page Claude-Code-style chat
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
    // 2026-05-18 — Office primary = UnifiedInbox (state + decisions) +
    // Agent Chat (free-form agent conversation). Two coherent landing
    // points; everything else lives in the advanced dropdown.
    primary: [
      { id: "today", label: "🏠 今日總覽" },
      { id: "agent-chat", label: "💬 Agent Chat" },
    ],
    advanced: [
      { id: "office-chat", label: "💬 Agent Chats (舊)" },
      { id: "office-inbox", label: "📥 舊收件匣" },
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
          {/*
            agent-chat is full-bleed (composer pinned to bottom, internal
            scroll inside the chat component). Other pages get the standard
            padded scrollable main. Conditional avoids double-scroll +
            keeps composer at the viewport bottom.
          */}
          <main
            className={
              activePage === "agent-chat"
                ? "flex-1 overflow-hidden"
                : "flex-1 overflow-auto px-4 lg:px-6 py-4"
            }
          >
            {/*
              v2 Wave 1 Module 1.5 — single Suspense boundary at the
              tab-render block. Each tab is its own lazy chunk; on first
              navigation Vite fetches that chunk and React shows
              <LoadingPage/> briefly. Subsequent tab switches reuse the
              cached chunk (instant).
            */}
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
      // Full-bleed: uses h-full + provides its own scrolling.
      return <AgentChatPage />;
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
      // "Slack-like per-agent channel" requirement. OfficeOverviewTab deleted
      // 2026-05-22 once ChatsTab + its inline GmailPanel (47d5a8d) covered
      // every flow the legacy tab held.
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
