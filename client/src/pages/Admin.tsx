import { useAuth } from "@/_core/hooks/useAuth";
import { LoadingPage } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import {
  Home,
  LogOut,
  LayoutDashboard,
  Plane,
  ShoppingCart,
  MessageSquare,
  Star,
  Brain,
  ChevronRight,
  Menu,
  X,
  BarChart2,
  TrendingUp,
  ListChecks,
  CheckCircle2,
  Binoculars,
  Activity,
  Megaphone,
  FileText,
  DollarSign,
  Sparkles,
  Receipt,
  Calculator,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";

// Import tab components
import DashboardTab from "@/components/admin/DashboardTab";
import ToursTab from "@/components/admin/ToursTab";
import BookingsTab from "@/components/admin/BookingsTab";
import InquiriesTab from "@/components/admin/InquiriesTab";
import ReviewsTab from "@/components/admin/ReviewsTab";
import TranslationsTab from "@/components/admin/TranslationsTab";
import AiHubTab from "@/components/admin/AiHubTab";
import AnalyticsTab from "@/components/admin/AnalyticsTab";
import TaskHistoryContent from "@/components/admin/TaskHistoryContent";
import CalibrationReviewTab from "@/components/admin/CalibrationReviewTab";
import CompetitorMonitorTab from "@/components/admin/CompetitorMonitorTab";
import MarketingTab from "@/components/admin/MarketingTab";
import VisaManagementTab from "@/components/admin/VisaManagementTab";
import AffiliateTab from "@/components/admin/AffiliateTab";
import AccountingTab from "@/components/admin/AccountingTab";
import MonitorDashboard from "@/components/admin/MonitorDashboard";
// v78 productivity tools
import AiQuotesTab from "@/components/admin/AiQuotesTab";
import WechatAssistTab from "@/components/admin/WechatAssistTab";
import InvoicesTab from "@/components/admin/InvoicesTab";
import ReconciliationTab from "@/components/admin/ReconciliationTab";
import MarketingContentTab from "@/components/admin/MarketingContentTab";

type AdminTab = "dashboard" | "tours" | "bookings" | "inquiries" | "reviews" | "ai-hub" | "analytics" | "task-history" | "calibration-review" | "competitor-monitor" | "tour-monitor" | "marketing" | "visa" | "affiliate" | "accounting" | "ai-quotes" | "wechat-assist" | "invoices" | "reconciliation" | "marketing-content";

export default function Admin() {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { t } = useLocale();
  const [activeTab, setActiveTab] = useState<AdminTab>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Get stats for badge counts
  const { data: statsData } = trpc.admin.getStats.useQuery();
  const { data: competitorUnread } = trpc.competitor.unreadAlertCount.useQuery();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [loading, isAuthenticated, setLocation]);

  const handleLogout = () => {
    logout();
    setLocation("/");
  };

  // 導航分組結構
  const navGroups: {
    label: string;
    items: { id: AdminTab; icon: React.ElementType; label: string; badge?: number }[];
  }[] = [
    {
      label: '日常管理',
      items: [
        { id: 'dashboard', icon: LayoutDashboard, label: '總覽儀表板' },
        { id: 'tours', icon: Plane, label: '行程管理', badge: statsData?.activeTours },
        { id: 'bookings', icon: ShoppingCart, label: '訂單管理' },
        { id: 'ai-quotes', icon: Sparkles, label: 'AI 報價單' },
        { id: 'wechat-assist', icon: MessageSquare, label: 'WeChat 助手' },
        { id: 'inquiries', icon: MessageSquare, label: '客戶詢問', badge: statsData?.pendingInquiries },
        { id: 'reviews', icon: Star, label: '客戶評價' },
      ],
    },
    {
      label: '進階功能',
      items: [
        { id: 'analytics', icon: TrendingUp, label: '流量分析' },
        { id: 'ai-hub', icon: Brain, label: 'AI 中心' },
        { id: 'task-history', icon: ListChecks, label: 'AI 任務記錄' },
        { id: 'calibration-review', icon: CheckCircle2, label: 'QA 品質審查' },
        { id: 'competitor-monitor', icon: Binoculars, label: '競品監控', badge: typeof competitorUnread === 'number' && competitorUnread > 0 ? competitorUnread : undefined },
        { id: 'tour-monitor', icon: Activity, label: '供應商監控' },
        { id: 'marketing', icon: Megaphone, label: '行銷自動化' },
        { id: 'marketing-content', icon: Sparkles, label: 'AI 社群文案' },
      ],
    },
    {
      label: '簽證服務',
      items: [
        { id: 'visa', icon: FileText, label: '中國簽證管理' },
      ],
    },
    {
      label: '聯盟行銷',
      items: [
        { id: 'affiliate', icon: TrendingUp, label: 'Trip.com 聯盟管理' },
      ],
    },
    {
      label: '財務管理',
      items: [
        { id: 'invoices', icon: Receipt, label: '發票管理' },
        { id: 'reconciliation', icon: Calculator, label: '對帳中心' },
        { id: 'accounting', icon: DollarSign, label: '會計記帳' },
      ],
    },
  ];

  const navItems = navGroups.flatMap(g => g.items);

  const currentNavItem = navItems.find(item => item.id === activeTab);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <LoadingPage text={t('admin.loading')} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-full w-64 bg-white border-r border-gray-200 z-40 flex flex-col
          transform transition-transform duration-200 ease-in-out
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          lg:translate-x-0 lg:static lg:z-auto
        `}
      >
        {/* Sidebar Header */}
        <div className="px-6 py-6 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">PACK&GO</p>
              <h2 className="text-lg font-bold text-gray-900">{t('admin.title')}</h2>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-1 rounded hover:bg-gray-100"
            >
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center text-sm font-bold">
              {(user?.name || "A").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{user?.name || t('admin.administrator')}</p>
              <p className="text-xs text-gray-500 truncate">{user?.email}</p>
            </div>
          </div>
        </div>

        {/* Navigation - 分組導航 */}
        <nav className="flex-1 py-3 overflow-y-auto">
          {navGroups.map((group, groupIdx) => (
            <div key={group.label} className={groupIdx > 0 ? "mt-4 pt-4 border-t border-gray-100" : ""}>
              {/* Group label */}
              <div className="px-6 pb-1.5">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.15em]">
                  {group.label}
                </span>
              </div>
              <div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveTab(item.id);
                        setSidebarOpen(false);
                      }}
                      className={`
                        w-full flex items-center justify-between px-6 py-2.5 text-sm
                        transition-colors duration-100 group relative
                        ${isActive
                          ? "text-gray-900 font-semibold bg-gray-50"
                          : "text-gray-500 font-normal hover:text-gray-900 hover:bg-gray-50/60"
                        }
                      `}
                    >
                      {/* Active left border */}
                      <span
                        className={`absolute left-0 top-1 bottom-1 w-[2.5px] transition-all duration-100
                          ${isActive ? "bg-gray-900" : "bg-transparent"}
                        `}
                      />
                      <div className="flex items-center gap-3">
                        <Icon
                          className={`h-[15px] w-[15px] flex-shrink-0 transition-colors
                            ${isActive ? "text-gray-900" : "text-gray-400 group-hover:text-gray-600"}
                          `}
                        />
                        <span className="tracking-tight">{item.label}</span>
                      </div>
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className={`
                          text-[11px] font-semibold px-1.5 py-px min-w-[20px] text-center
                          ${isActive
                            ? "bg-gray-900 text-white"
                            : "bg-gray-100 text-gray-500 group-hover:bg-gray-200"
                          }
                        `}>
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Sidebar Footer */}
        <div className="py-3 border-t border-gray-100">
          <button
            onClick={() => setLocation("/")}
            className="w-full flex items-center gap-3 px-6 py-2.5 text-sm font-normal text-gray-500 hover:text-gray-900 hover:bg-gray-50/60 transition-colors"
          >
            <Home className="h-[15px] w-[15px] text-gray-400" />
            <span className="tracking-tight">{t('admin.backToHome')}</span>
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-6 py-2.5 text-sm font-normal text-gray-500 hover:text-red-600 hover:bg-red-50/60 transition-colors"
          >
            <LogOut className="h-[15px] w-[15px] text-gray-400" />
            <span className="tracking-tight">{t('admin.logout')}</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 lg:ml-0">
        {/* Top Bar */}
        <header className="bg-white border-b border-gray-200 sticky top-0 z-20 px-4 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            {/* Mobile menu button */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg hover:bg-gray-100"
            >
              <Menu className="h-5 w-5 text-gray-600" />
            </button>

            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-400">{t('admin.title')}</span>
              <ChevronRight className="h-4 w-4 text-gray-300" />
              <span className="font-semibold text-gray-900">{currentNavItem?.label}</span>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 px-4 lg:px-8 py-8 overflow-auto">
          {activeTab === "dashboard" && <DashboardTab onNavigate={(tab) => setActiveTab(tab as AdminTab)} />}
          {activeTab === "tours" && <ToursTab />}
          {activeTab === "bookings" && <BookingsTab />}
          {activeTab === "inquiries" && <InquiriesTab />}
          {activeTab === "reviews" && <ReviewsTab />}
          {activeTab === "analytics" && <AnalyticsTab />}
          {activeTab === "ai-hub" && <AiHubTab />}
          {activeTab === "task-history" && <TaskHistoryContent />}
          {activeTab === "calibration-review" && <CalibrationReviewTab />}
          {activeTab === "competitor-monitor" && <CompetitorMonitorTab />}
          {activeTab === "tour-monitor" && <MonitorDashboard />}
          {activeTab === "marketing" && <MarketingTab />}
          {activeTab === "visa" && <VisaManagementTab />}
          {activeTab === "affiliate" && <AffiliateTab />}
          {activeTab === "accounting" && <AccountingTab />}
          {activeTab === "ai-quotes" && <AiQuotesTab />}
          {activeTab === "wechat-assist" && <WechatAssistTab />}
          {activeTab === "invoices" && <InvoicesTab />}
          {activeTab === "reconciliation" && <ReconciliationTab />}
          {activeTab === "marketing-content" && <MarketingContentTab />}
        </main>
      </div>
    </div>
  );
}
