import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import {
  TrendingUp, TrendingDown, DollarSign, Plus, Download,
  RefreshCw, Trash2, Edit, Eye, Calendar, BarChart3, Receipt, Clock
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface EntryFormData {
  entryType: "income" | "expense";
  category: string;
  amount: string;
  currency: string;
  description: string;
  entryDate: string;
  isTaxDeductible: boolean;
  taxCategory: string;
  notes: string;
}

// Category value → i18n key mapping (kept stable regardless of language)
const INCOME_CATEGORY_KEYS: Record<string, string> = {
  tour_booking: "catTourBooking",
  visa_service: "catVisaService",
  affiliate_commission: "catAffiliateCommission",
  flight_booking: "catFlightBooking",
  hotel_booking: "catHotelBooking",
  other_income: "catOtherIncome",
};

const EXPENSE_CATEGORY_KEYS: Record<string, string> = {
  rent: "catRent",
  utilities: "catUtilities",
  salary: "catSalary",
  marketing: "catMarketing",
  travel_cost: "catTravelCost",
  supplier_payment: "catSupplierPayment",
  office_supplies: "catOfficeSupplies",
  software: "catSoftware",
  insurance: "catInsurance",
  tax_payment: "catTaxPayment",
  bank_fee: "catBankFee",
  stripe_fee: "catStripeFee",
  consulate_fee: "catConsulateFee",
  other_expense: "catOtherExpense",
};

const INCOME_CATEGORY_VALUES = Object.keys(INCOME_CATEGORY_KEYS);
const EXPENSE_CATEGORY_VALUES = Object.keys(EXPENSE_CATEGORY_KEYS);

const CURRENCIES = ["TWD", "USD", "EUR", "GBP", "JPY", "CNY"];

const FREQ_KEYS: Record<string, string> = {
  monthly: "freqMonthly",
  quarterly: "freqQuarterly",
  annually: "freqAnnually",
  yearly: "freqYearly",
};

const INVOICE_STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
};

const INVOICE_STATUS_KEYS: Record<string, string> = {
  draft: "invStatusDraft",
  sent: "invStatusSent",
  paid: "invStatusPaid",
  overdue: "invStatusOverdue",
  cancelled: "invStatusCancelled",
};

// ─── Plaid P&L category labels (Schedule C keys) ────────────────────────────

const PL_CATEGORY_LABELS: Record<string, { zh: string; en: string; line: string }> = {
  income_booking: { zh: "訂單收入", en: "Booking Income", line: "Line 1" },
  cogs_tour:      { zh: "供應商成本", en: "Supplier Cost", line: "Line 4" },
  cogs_other:     { zh: "手續費", en: "Processing Fees", line: "Line 4" },
  expense_marketing: { zh: "行銷", en: "Advertising", line: "Line 8" },
  expense_software:  { zh: "軟體", en: "Software", line: "Line 18" },
  expense_office:    { zh: "辦公", en: "Office", line: "Line 18" },
  expense_travel:    { zh: "差旅", en: "Travel", line: "Line 24a" },
  refund:            { zh: "退款", en: "Refunds", line: "Line 2" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatAmount(amount: string | number, currency = "USD"): string {
  const n = Number(amount);
  const symbols: Record<string, string> = { USD: "$", TWD: "NT$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥" };
  const sym = symbols[currency] ?? currency + " ";
  return `${sym}${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AccountingTab() {
  const { t, language } = useLocale();
  const locale = language === "en" ? "en-US" : "zh-TW";

  function formatDate(date: Date | string): string {
    return new Date(date).toLocaleDateString(locale);
  }

  function getCategoryLabel(category: string): string {
    const key = INCOME_CATEGORY_KEYS[category] || EXPENSE_CATEGORY_KEYS[category];
    return key ? t(`admin.accounting.${key}`) : category;
  }

  const INCOME_CATEGORIES = useMemo(
    () => INCOME_CATEGORY_VALUES.map(v => ({ value: v, label: t(`admin.accounting.${INCOME_CATEGORY_KEYS[v]}`) })),
    [t]
  );
  const EXPENSE_CATEGORIES = useMemo(
    () => EXPENSE_CATEGORY_VALUES.map(v => ({ value: v, label: t(`admin.accounting.${EXPENSE_CATEGORY_KEYS[v]}`) })),
    [t]
  );

  const [activeTab, setActiveTab] = useState("overview");
  const [filterType, setFilterType] = useState<"all" | "income" | "expense">("all");
  const [filterCategory] = useState("all");
  const [dateRange, setDateRange] = useState(() => {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10),
    };
  });

  // Entry dialog
  const [entryDialog, setEntryDialog] = useState(false);
  const [editingEntry, setEditingEntry] = useState<number | null>(null);
  const [entryForm, setEntryForm] = useState<EntryFormData>({
    entryType: "expense",
    category: "other_expense",
    amount: "",
    currency: "USD",
    description: "",
    entryDate: new Date().toISOString().slice(0, 10),
    isTaxDeductible: false,
    taxCategory: "",
    notes: "",
  });

  // Recurring expense dialog
  const [recurringDialog, setRecurringDialog] = useState(false);
  const [recurringForm, setRecurringForm] = useState({
    name: "",
    category: "rent",
    amount: "",
    currency: "USD",
    frequency: "monthly" as "monthly" | "quarterly" | "yearly",
    nextDueDate: new Date().toISOString().slice(0, 10),
    isTaxDeductible: false,
    taxCategory: "",
    notes: "",
  });

  // Invoice dialog
  const [invoiceDialog, setInvoiceDialog] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    description: "",
    amount: "",
    taxRate: "0",
    currency: "USD",
    notes: "",
    dueDate: "",
  });

  const utils = trpc.useUtils();

  // Queries — all powered by Plaid bank data (not the dead manual entries table)
  const startDate = useMemo(() => new Date(dateRange.start + "T00:00:00"), [dateRange.start]);
  const endDate = useMemo(() => new Date(dateRange.end + "T23:59:59"), [dateRange.end]);

  // P&L for selected period
  const plReport = trpc.plaid.profitLossReport.useQuery({
    startDate: dateRange.start,
    endDate: dateRange.end,
  });
  // YTD P&L for tax summary
  const taxYear = new Date().getFullYear();
  const startOfYear = useMemo(() => `${taxYear}-01-01`, [taxYear]);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const ytdReport = trpc.plaid.profitLossReport.useQuery({
    startDate: startOfYear,
    endDate: today,
  });
  // 6-month trend
  const plTrend = trpc.plaid.profitLossTrend.useQuery({ months: 6 });
  // Manual entries (kept for the Entries tab)
  const entriesQuery = trpc.accounting.list.useQuery({
    startDate,
    endDate,
    entryType: filterType === "all" ? undefined : filterType,
    category: filterCategory === "all" ? undefined : filterCategory,
    limit: 200,
  });
  const invoicesQuery = trpc.invoices.list.useQuery({ limit: 100 });
  const recurringQuery = trpc.recurringExpenses.list.useQuery();

  // Mutations
  const createEntry = trpc.accounting.create.useMutation({
    onSuccess: () => {
      toast.success(t("admin.accounting.toastEntryCreated"));
      setEntryDialog(false);
      utils.accounting.list.invalidate();
      utils.accounting.dashboard.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateEntry = trpc.accounting.update.useMutation({
    onSuccess: () => {
      toast.success(t("admin.accounting.toastUpdated"));
      setEntryDialog(false);
      setEditingEntry(null);
      utils.accounting.list.invalidate();
      utils.accounting.dashboard.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteEntry = trpc.accounting.delete.useMutation({
    onSuccess: () => {
      toast.success(t("admin.accounting.toastDeleted"));
      utils.accounting.list.invalidate();
      utils.accounting.dashboard.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const createRecurring = trpc.recurringExpenses.create.useMutation({
    onSuccess: () => {
      toast.success(t("admin.accounting.toastRecurringCreated"));
      setRecurringDialog(false);
      utils.recurringExpenses.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteRecurring = trpc.recurringExpenses.delete.useMutation({
    onSuccess: () => {
      toast.success(t("admin.accounting.toastDeleted"));
      utils.recurringExpenses.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const applyRecurring = trpc.recurringExpenses.applyExpense.useMutation({
    onSuccess: (data) => {
      toast.success(t("admin.accounting.toastRecurringApplied", { date: formatDate(data.nextDueDate) }));
      utils.recurringExpenses.list.invalidate();
      utils.accounting.list.invalidate();
      utils.accounting.dashboard.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const createInvoice = trpc.invoices.create.useMutation({
    onSuccess: () => {
      toast.success(t("admin.accounting.toastInvoiceCreated"));
      setInvoiceDialog(false);
      utils.invoices.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateInvoiceStatus = trpc.invoices.updateStatus.useMutation({
    onSuccess: () => {
      toast.success(t("admin.accounting.toastInvoiceStatusUpdated"));
      utils.invoices.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteInvoice = trpc.invoices.delete.useMutation({
    onSuccess: () => {
      toast.success(t("admin.accounting.toastDeleted"));
      utils.invoices.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // ── 待確認支出 (email-receipt-intake) ──────────────────────────────────────
  const pendingQuery = trpc.accounting.pendingExpenses.list.useQuery({
    status: "pending",
    limit: 100,
  });
  const pendingCountQuery = trpc.accounting.pendingExpenses.count.useQuery();
  // 1A0a(Codex 7-18 R3):count 讀取失敗 ≠ 0 —— null 時 badge 顯「!」而非隱藏,
  // 不把可行動的待確認佇列靜默藏掉(U1 error 折 0 反樣式)。
  const pendingCount = pendingCountQuery.data?.pending ?? null;

  const [pendingDialog, setPendingDialog] = useState(false);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [bookingSearch, setBookingSearch] = useState("");
  const [pendingForm, setPendingForm] = useState({
    handledMode: "ledger" as "ledger" | "receipt_only",
    account: "operating" as "trust" | "operating",
    vendor: "",
    amount: "",
    currency: "USD",
    receiptDate: new Date().toISOString().slice(0, 10),
    description: "",
    entryCategory: "supplier_payment",
    isTaxDeductible: true,
    bookingId: null as number | null,
    bookingLabel: "",
    notes: "",
  });

  const bookingResults = trpc.globalSearch.search.useQuery(
    { q: bookingSearch },
    { enabled: bookingSearch.trim().length >= 2 },
  );

  const invalidatePending = () => {
    utils.accounting.pendingExpenses.list.invalidate();
    utils.accounting.pendingExpenses.count.invalidate();
  };

  const confirmPending = trpc.accounting.pendingExpenses.confirm.useMutation({
    onSuccess: (r) => {
      toast.success(
        r.handledMode === "ledger"
          ? t("admin.accounting.pending.toastBooked")
          : t("admin.accounting.pending.toastArchived"),
      );
      setPendingDialog(false);
      setConfirmingId(null);
      invalidatePending();
      utils.accounting.list.invalidate();
      utils.accounting.dashboard.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const rejectPending = trpc.accounting.pendingExpenses.reject.useMutation({
    onSuccess: () => {
      toast.success(t("admin.accounting.pending.toastRejected"));
      invalidatePending();
    },
    onError: (e) => toast.error(e.message),
  });

  function openConfirmDialog(row: NonNullable<typeof pendingQuery.data>["rows"][number]) {
    setConfirmingId(row.id);
    setBookingSearch("");
    setPendingForm({
      handledMode: "ledger",
      account: "operating",
      vendor: row.vendor ?? "",
      amount: row.amount != null ? String(row.amount) : "",
      currency: row.currency ?? "USD",
      receiptDate: row.receiptDate
        ? new Date(row.receiptDate).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      description: row.description ?? "",
      entryCategory: "supplier_payment",
      isTaxDeductible: true,
      bookingId: row.bookingId ?? null,
      bookingLabel: "",
      notes: "",
    });
    setPendingDialog(true);
  }

  function submitConfirm() {
    if (confirmingId == null) return;
    confirmPending.mutate({
      id: confirmingId,
      handledMode: pendingForm.handledMode,
      account: pendingForm.account,
      vendor: pendingForm.vendor || undefined,
      amount: pendingForm.amount ? Number(pendingForm.amount) : undefined,
      currency: pendingForm.currency,
      receiptDate: pendingForm.receiptDate
        ? new Date(pendingForm.receiptDate + "T00:00:00")
        : undefined,
      description: pendingForm.description || undefined,
      bookingId: pendingForm.bookingId ?? undefined,
      entryCategory:
        pendingForm.handledMode === "ledger" ? pendingForm.entryCategory : undefined,
      isTaxDeductible: pendingForm.isTaxDeductible,
      notes: pendingForm.notes || undefined,
    });
  }

  async function previewReceipt(id: number) {
    try {
      const { url } = await utils.accounting.pendingExpenses.attachmentUrl.fetch({ id });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  // Export CSV
  const exportCsvQuery = trpc.accounting.exportCsv.useQuery(
    { startDate, endDate },
    { enabled: false }
  );

  const handleExportCsv = async () => {
    const result = await exportCsvQuery.refetch();
    if (result.data) {
      const blob = new Blob([result.data.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.data.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("admin.accounting.toastCsvExported"));
    }
  };

  // Entry form submit
  const handleEntrySubmit = () => {
    const amount = parseFloat(entryForm.amount);
    if (!amount || amount <= 0) { toast.error(t("admin.accounting.validAmountRequired")); return; }
    if (!entryForm.description) { toast.error(t("admin.accounting.descRequired")); return; }

    if (editingEntry) {
      updateEntry.mutate({
        id: editingEntry,
        entryType: entryForm.entryType,
        category: entryForm.category,
        amount,
        currency: entryForm.currency,
        description: entryForm.description,
        entryDate: new Date(entryForm.entryDate),
        isTaxDeductible: entryForm.isTaxDeductible,
        taxCategory: entryForm.taxCategory || undefined,
        notes: entryForm.notes || undefined,
      });
    } else {
      createEntry.mutate({
        entryType: entryForm.entryType,
        category: entryForm.category,
        amount,
        currency: entryForm.currency,
        description: entryForm.description,
        entryDate: new Date(entryForm.entryDate),
        isTaxDeductible: entryForm.isTaxDeductible,
        taxCategory: entryForm.taxCategory || undefined,
        notes: entryForm.notes || undefined,
      });
    }
  };

  // Invoice form submit
  const handleInvoiceSubmit = () => {
    const amount = parseFloat(invoiceForm.amount);
    if (!amount || amount <= 0) { toast.error(t("admin.accounting.validAmountRequired")); return; }
    if (!invoiceForm.customerName) { toast.error(t("admin.accounting.customerNameRequired")); return; }
    if (!invoiceForm.description) { toast.error(t("admin.accounting.serviceDescRequired")); return; }

    const taxRate = parseFloat(invoiceForm.taxRate) || 0;
    const taxAmount = amount * (taxRate / 100);
    const totalAmount = amount + taxAmount;

    createInvoice.mutate({
      customerName: invoiceForm.customerName,
      customerEmail: invoiceForm.customerEmail || undefined,
      customerPhone: invoiceForm.customerPhone || undefined,
      lineItems: [{ description: invoiceForm.description, quantity: 1, unitPrice: amount, amount }],
      subtotal: amount,
      taxRate,
      taxAmount,
      totalAmount,
      currency: invoiceForm.currency,
      notes: invoiceForm.notes || undefined,
      dueDate: invoiceForm.dueDate ? new Date(invoiceForm.dueDate) : undefined,
    });
  };

  const pl = plReport.data;
  const ytd = ytdReport.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{t("admin.accounting.pageTitle")}</h2>
          <p className="text-sm text-gray-500 mt-1">{language === "zh-TW" ? "Plaid 銀行資料即時損益" : "Real-time P&L from Plaid bank data"}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="rounded-lg" onClick={handleExportCsv}>
            <Download className="h-4 w-4 mr-1" /> {t("admin.accounting.exportCsv")}
          </Button>
          <Button size="sm" className="rounded-lg" onClick={() => { setEditingEntry(null); setEntryForm({ entryType: "expense", category: "other_expense", amount: "", currency: "USD", description: "", entryDate: new Date().toISOString().slice(0, 10), isTaxDeductible: false, taxCategory: "", notes: "" }); setEntryDialog(true); }}>
            <Plus className="h-4 w-4 mr-1" /> {t("admin.accounting.addEntry")}
          </Button>
        </div>
      </div>

      {/* Date Range Filter */}
      <div className="flex items-center gap-3 bg-gray-50 p-3 rounded-lg">
        <Calendar className="h-4 w-4 text-gray-500" />
        <span className="text-sm text-gray-600">{t("admin.accounting.datePeriod")}</span>
        <Input type="date" value={dateRange.start} onChange={e => setDateRange(p => ({ ...p, start: e.target.value }))} className="w-40 h-8 text-sm rounded-lg" />
        <span className="text-gray-400">—</span>
        <Input type="date" value={dateRange.end} onChange={e => setDateRange(p => ({ ...p, end: e.target.value }))} className="w-40 h-8 text-sm rounded-lg" />
      </div>

      {/* 1A0a:P&L 讀取失敗顯性(原本 pl 為 undefined 時整區靜默消失=假無事);
          cached refetch 失敗 = stale 標記(Codex 7-18 P1-6) */}
      {((plReport.isError && plReport.data === undefined) ||
        (ytdReport.isError && ytdReport.data === undefined) ||
        (plTrend.isError && plTrend.data === undefined)) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          {t("admin.accounting.plUnverifiable")}
        </div>
      )}
      {((plReport.isError && plReport.data !== undefined) ||
        (ytdReport.isError && ytdReport.data !== undefined) ||
        (plTrend.isError && plTrend.data !== undefined)) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          {t("financeCockpit.truth.staleHint")}
        </div>
      )}

      {/* Stats Cards — from Plaid P&L */}
      {pl && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-green-600" />
              <span className="text-xs text-green-700 font-medium">{t("admin.accounting.statsCurrentIncome")}</span>
            </div>
            <div className="text-xl font-bold text-green-800">{formatAmount(pl.income.total)}</div>
            {ytd && <div className="text-xs text-green-600 mt-1">{t("admin.accounting.statsYearTotal", { value: formatAmount(ytd.income.total) })}</div>}
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="h-4 w-4 text-red-600" />
              <span className="text-xs text-red-700 font-medium">{t("admin.accounting.statsCurrentExpenses")}</span>
            </div>
            <div className="text-xl font-bold text-red-800">{formatAmount(pl.expenses.total)}</div>
            {ytd && <div className="text-xs text-red-600 mt-1">{t("admin.accounting.statsYearTotal", { value: formatAmount(ytd.expenses.total) })}</div>}
          </div>
          <div className={`${pl.netProfit >= 0 ? "bg-blue-50 border-blue-200" : "bg-orange-50 border-orange-200"} border rounded-lg p-4`}>
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className={`h-4 w-4 ${pl.netProfit >= 0 ? "text-blue-600" : "text-orange-600"}`} />
              <span className={`text-xs font-medium ${pl.netProfit >= 0 ? "text-blue-700" : "text-orange-700"}`}>{t("admin.accounting.statsCurrentNet")}</span>
            </div>
            <div className={`text-xl font-bold ${pl.netProfit >= 0 ? "text-blue-800" : "text-orange-800"}`}>{formatAmount(pl.netProfit)}</div>
            {ytd && <div className={`text-xs mt-1 ${pl.netProfit >= 0 ? "text-blue-600" : "text-orange-600"}`}>{t("admin.accounting.statsYearTotal", { value: formatAmount(ytd.netProfit) })}</div>}
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="h-4 w-4 text-purple-600" />
              <span className="text-xs text-purple-700 font-medium">{t("admin.accounting.statsProfitMargin")}</span>
            </div>
            <div className="text-xl font-bold text-purple-800">
              {pl.profitMargin.toFixed(1)}%
            </div>
            {ytd && (
              <div className="text-xs text-purple-600 mt-1">
                {t("admin.accounting.statsYearPercent", { value: ytd.profitMargin.toFixed(1) })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-3 sm:grid-cols-5 w-full max-w-2xl rounded-lg">
          <TabsTrigger value="overview" className="rounded-md">{t("admin.accounting.tabOverview")}</TabsTrigger>
          <TabsTrigger value="pending" className="rounded-md flex items-center gap-1.5">
            {t("admin.accounting.pending.tab")}
            {/* 1A0a(Codex 7-18 P1-3):loading≠error≠zero。載入中不出徽章(未知,不畫 0
                也不畫錯誤 !);cold-error 才顯 ! ;真數 >0 顯數字。 */}
            {pendingCountQuery.isLoading ? null : pendingCountQuery.isError && pendingCount === null ? (
              <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-amber-500 text-white text-[10px] font-semibold" title={t("admin.trustCompliance.loadFailed")}>!</span>
            ) : pendingCount !== null && pendingCount > 0 ? (
              <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-amber-500 text-white text-[10px] font-semibold">
                {pendingCount}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="entries" className="rounded-md">{t("admin.accounting.tabEntries")}</TabsTrigger>
          <TabsTrigger value="invoices" className="rounded-md">{t("admin.accounting.tabInvoices")}</TabsTrigger>
          <TabsTrigger value="recurring" className="rounded-md">{t("admin.accounting.tabRecurring")}</TabsTrigger>
        </TabsList>

        {/* Overview Tab — Plaid-powered P&L */}
        <TabsContent value="overview" className="space-y-6 pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Monthly Trend */}
            <div className="bg-white border rounded-xl p-4">
              <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <BarChart3 className="h-4 w-4" /> {t("admin.accounting.monthlyTrend")}
              </h3>
              {/* 1A0a(Codex 7-18 P1-3):loading / cold-error 不得畫成「沒有趨勢資料」 */}
              {plTrend.isLoading ? (
                <div className="animate-pulse space-y-2 py-2">{[0,1,2].map(i => <div key={i} className="h-5 rounded bg-gray-100" />)}</div>
              ) : plTrend.isError && plTrend.data === undefined ? (
                <p className="text-amber-700 text-sm py-4 text-center">{t("admin.trustCompliance.loadFailed")}</p>
              ) : plTrend.isError && (plTrend.data?.length ?? 0) === 0 ? (
                /* 1A0a(Codex 7-18 15:56 P1-2):cached-empty stale 不得落 clean
                   「沒有趨勢資料」—— 空快取 + refetch 失敗 ≠ 可核實的真零 */
                <p className="text-amber-700 text-sm py-4 text-center">{t("financeCockpit.truth.staleHint")}</p>
              ) : plTrend.data && plTrend.data.length > 0 ? (
                <div className="space-y-2">
                  {plTrend.isError && (
                    <p className="text-[10px] text-amber-700">{t("financeCockpit.truth.staleHint")}</p>
                  )}
                  {plTrend.data.slice(-6).map(m => {
                    const maxIncome = Math.max(...plTrend.data!.map(x => x.income)) || 1;
                    return (
                      <div key={m.month} className="flex items-center gap-2 text-sm">
                        <span className="text-gray-500 w-16">{m.month.slice(5)}</span>
                        <div className="flex-1 flex gap-1">
                          <div className="h-5 bg-green-200 rounded text-xs flex items-center justify-center text-green-800 font-medium px-1"
                            style={{ width: `${Math.max(5, (m.income / maxIncome) * 100)}%`, minWidth: "40px" }}>
                            {formatAmount(m.income)}
                          </div>
                        </div>
                        <div className={`text-xs font-medium ${m.netProfit >= 0 ? "text-green-700" : "text-red-700"}`}>
                          {m.netProfit >= 0 ? "+" : ""}{formatAmount(m.netProfit)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-gray-400 text-sm py-4 text-center">{language === "zh-TW" ? "沒有趨勢資料" : "No trend data"}</p>
              )}
            </div>

            {/* Tax Summary — YTD from Plaid P&L */}
            <div className="bg-white border rounded-xl p-4">
              <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <Receipt className="h-4 w-4" /> {t("admin.accounting.taxSummaryTitle", { year: String(taxYear) })}
              </h3>
              {ytd ? (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between py-1 border-b">
                    <span className="text-gray-600">{t("admin.accounting.taxYearIncome")}</span>
                    <span className="font-medium text-green-700">{formatAmount(ytd.income.total)}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b">
                    <span className="text-gray-600">{t("admin.accounting.taxDeductible")}</span>
                    <span className="font-medium text-red-700">-{formatAmount(ytd.expenses.total)}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b">
                    <span className="text-gray-600">{language === "zh-TW" ? "退款 (Line 2)" : "Refunds (Line 2)"}</span>
                    <span className="font-medium text-gray-600">-{formatAmount(ytd.refunds)}</span>
                  </div>
                  <div className="flex justify-between py-2 bg-yellow-50 rounded-md px-2">
                    <span className="font-semibold text-gray-800">{t("admin.accounting.taxEstimatedTaxable")}</span>
                    <span className="font-bold text-yellow-800">{formatAmount(ytd.netProfit)}</span>
                  </div>
                  {ytd.trustDeferredIncome > 0 && (
                    <div className="flex justify-between py-1 text-xs text-gray-500">
                      <span>{language === "zh-TW" ? "客人訂金（還沒轉收入）" : "Customer deposits (not yet income)"}</span>
                      <span>{formatAmount(ytd.trustDeferredIncome)}</span>
                    </div>
                  )}
                  {ytd.uncategorizedCount > 0 && (
                    <div className="flex justify-between py-1 text-xs text-amber-600">
                      <span>{language === "zh-TW" ? "未分類交易" : "Uncategorized txns"}</span>
                      <span>{ytd.uncategorizedCount}</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-gray-400 text-sm py-4 text-center">{language === "zh-TW" ? "載入中..." : "Loading..."}</p>
              )}
            </div>
          </div>

          {/* Schedule C Breakdown — from Plaid P&L byCategory */}
          {pl && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white border rounded-xl p-4">
                <h3 className="font-semibold text-gray-800 mb-3">{t("admin.accounting.incomeSources")}</h3>
                <div className="space-y-2">
                  {Object.entries(pl.income.byCategory)
                    .filter(([, amt]) => amt > 0)
                    .sort(([, a], [, b]) => b - a)
                    .map(([cat, amt]) => {
                      const meta = PL_CATEGORY_LABELS[cat];
                      const label = meta ? (language === "zh-TW" ? meta.zh : meta.en) : cat;
                      const line = meta?.line ?? "";
                      const pct = pl.income.total > 0 ? (amt / pl.income.total) * 100 : 0;
                      return (
                        <div key={cat} className="flex items-center gap-2 text-sm">
                          <span className="text-gray-600 w-28 truncate" title={line}>{label}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-2">
                            <div className="bg-green-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-gray-700 font-medium w-20 text-right">{formatAmount(amt)}</span>
                          {line && <span className="text-[10px] text-gray-400 w-14">{line}</span>}
                        </div>
                      );
                    })}
                  {Object.keys(pl.income.byCategory).length === 0 && (
                    <p className="text-gray-400 text-sm">{t("admin.accounting.emptyIncome")}</p>
                  )}
                </div>
              </div>
              <div className="bg-white border rounded-xl p-4">
                <h3 className="font-semibold text-gray-800 mb-3">{t("admin.accounting.expenseCategories")}</h3>
                <div className="space-y-2">
                  {Object.entries(pl.expenses.byCategory)
                    .filter(([, amt]) => amt > 0)
                    .sort(([, a], [, b]) => b - a)
                    .map(([cat, amt]) => {
                      const meta = PL_CATEGORY_LABELS[cat];
                      const label = meta ? (language === "zh-TW" ? meta.zh : meta.en) : cat;
                      const line = meta?.line ?? "";
                      const pct = pl.expenses.total > 0 ? (amt / pl.expenses.total) * 100 : 0;
                      return (
                        <div key={cat} className="flex items-center gap-2 text-sm">
                          <span className="text-gray-600 w-28 truncate" title={line}>{label}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-2">
                            <div className="bg-red-400 h-2 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-gray-700 font-medium w-20 text-right">{formatAmount(amt)}</span>
                          {line && <span className="text-[10px] text-gray-400 w-14">{line}</span>}
                        </div>
                      );
                    })}
                  {Object.keys(pl.expenses.byCategory).length === 0 && (
                    <p className="text-gray-400 text-sm">{t("admin.accounting.emptyExpenses")}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* 待確認支出 Tab — Gmail 自動讀出的收據,Jeff 逐筆確認才入帳 */}
        <TabsContent value="pending" className="space-y-4 pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-gray-500">{t("admin.accounting.pending.hint")}</p>
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => invalidatePending()}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>

          <div className="bg-white border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-2 text-gray-600 font-medium">{t("admin.accounting.pending.colVendor")}</th>
                  <th className="text-right px-4 py-2 text-gray-600 font-medium">{t("admin.accounting.pending.colAmount")}</th>
                  <th className="text-left px-4 py-2 text-gray-600 font-medium">{t("admin.accounting.pending.colDate")}</th>
                  <th className="text-left px-4 py-2 text-gray-600 font-medium">{t("admin.accounting.pending.colSource")}</th>
                  <th className="text-center px-4 py-2 text-gray-600 font-medium">{t("admin.accounting.pending.colReceipt")}</th>
                  <th className="text-center px-4 py-2 text-gray-600 font-medium">{t("admin.accounting.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {pendingQuery.data?.rows.map((row) => (
                  <tr key={row.id} className="border-b hover:bg-gray-50 align-top">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-800 font-medium">{row.vendor ?? "—"}</span>
                        {row.needsReview === 1 && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-amber-100 text-amber-700">
                            {t("admin.accounting.pending.needsReview")}
                          </span>
                        )}
                      </div>
                      {row.description && (
                        <div className="text-xs text-gray-400 max-w-xs truncate" title={row.description}>{row.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-gray-800">
                      {row.amount != null && row.currency
                        ? formatAmount(row.amount, row.currency)
                        : <span className="text-amber-600">{t("admin.accounting.pending.unreadable")}</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{row.receiptDate ? formatDate(row.receiptDate) : "—"}</td>
                    <td className="px-4 py-2 text-gray-500">
                      <div className="max-w-[14rem] truncate" title={row.fromAddress ?? ""}>{row.fromAddress ?? "—"}</div>
                      {row.emailSubject && (
                        <div className="text-xs text-gray-400 max-w-[14rem] truncate" title={row.emailSubject}>{row.emailSubject}</div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {row.attachmentKey ? (
                        <Button variant="ghost" size="sm" className="h-6 px-2 rounded-md" onClick={() => previewReceipt(row.id)}>
                          <Eye className="h-3 w-3" />
                        </Button>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <div className="flex justify-center gap-1">
                        <Button size="sm" className="h-7 rounded-md" onClick={() => openConfirmDialog(row)}>
                          {t("admin.accounting.pending.confirm")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-md text-red-500 hover:text-red-700"
                          onClick={() => {
                            if (confirm(t("admin.accounting.pending.confirmReject"))) {
                              rejectPending.mutate({ id: row.id });
                            }
                          }}
                        >
                          {t("admin.accounting.pending.reject")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {/* 1A0a R3:讀取失敗 ≠ 沒有待確認(cached-empty+error / 冷載都不得顯假空) */}
                {pendingQuery.isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-300">{t("admin.accounting.loading")}</td></tr>
                ) : pendingQuery.isError && pendingQuery.data === undefined ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-amber-700">{t("admin.trustCompliance.loadFailed")}</td></tr>
                ) : pendingQuery.isError ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-amber-700">{t("financeCockpit.truth.staleHint")}</td></tr>
                ) : pendingQuery.data?.rows.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">{t("admin.accounting.pending.empty")}</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Entries Tab */}
        <TabsContent value="entries" className="space-y-4 pt-4">
          <div className="flex items-center gap-3">
            <Select value={filterType} onValueChange={(v) => setFilterType(v as typeof filterType)}>
              <SelectTrigger className="w-32 h-8 text-sm rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("admin.accounting.filterAll")}</SelectItem>
                <SelectItem value="income">{t("admin.accounting.filterIncome")}</SelectItem>
                <SelectItem value="expense">{t("admin.accounting.filterExpense")}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => utils.accounting.list.invalidate()}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>

          <div className="bg-white border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-2 text-gray-600 font-medium">{t("admin.accounting.colDate")}</th>
                  <th className="text-left px-4 py-2 text-gray-600 font-medium">{t("admin.accounting.colType")}</th>
                  <th className="text-left px-4 py-2 text-gray-600 font-medium">{t("admin.accounting.colCategory")}</th>
                  <th className="text-left px-4 py-2 text-gray-600 font-medium">{t("admin.accounting.colDescription")}</th>
                  <th className="text-right px-4 py-2 text-gray-600 font-medium">{t("admin.accounting.colAmount")}</th>
                  <th className="text-center px-4 py-2 text-gray-600 font-medium">{t("admin.accounting.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {entriesQuery.data?.entries.map(entry => (
                  <tr key={entry.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-600">{formatDate(entry.entryDate)}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${entry.entryType === "income" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {entry.entryType === "income" ? t("admin.accounting.typeIncome") : t("admin.accounting.typeExpense")}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-700">{getCategoryLabel(entry.category)}</td>
                    <td className="px-4 py-2 text-gray-700 max-w-xs truncate">{entry.description}</td>
                    <td className={`px-4 py-2 text-right font-semibold ${entry.entryType === "income" ? "text-green-700" : "text-red-700"}`}>
                      {entry.entryType === "income" ? "+" : "-"}{formatAmount(entry.amount, entry.currency)}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <div className="flex justify-center gap-1">
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 rounded-md" onClick={() => {
                          setEditingEntry(entry.id);
                          setEntryForm({
                            entryType: entry.entryType as "income" | "expense",
                            category: entry.category,
                            amount: String(entry.amount),
                            currency: entry.currency,
                            description: entry.description ?? "",
                            entryDate: new Date(entry.entryDate).toISOString().slice(0, 10),
                            isTaxDeductible: entry.isTaxDeductible === 1,
                            taxCategory: entry.taxCategory ?? "",
                            notes: entry.notes ?? "",
                          });
                          setEntryDialog(true);
                        }}>
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 rounded-md text-red-500 hover:text-red-700" onClick={() => {
                          if (confirm(t("admin.accounting.confirmDeleteEntry"))) deleteEntry.mutate({ id: entry.id });
                        }}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {/* 1A0a R3:讀取失敗 ≠ 沒有分錄 */}
                {entriesQuery.isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-300">{t("admin.accounting.loading")}</td></tr>
                ) : entriesQuery.isError && entriesQuery.data === undefined ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-amber-700">{t("admin.trustCompliance.loadFailed")}</td></tr>
                ) : entriesQuery.isError ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-amber-700">{t("financeCockpit.truth.staleHint")}</td></tr>
                ) : entriesQuery.data?.entries.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">{t("admin.accounting.emptyEntries")}</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Invoices Tab */}
        <TabsContent value="invoices" className="space-y-4 pt-4">
          <div className="flex justify-end">
            <Button size="sm" className="rounded-lg" onClick={() => { setInvoiceForm({ customerName: "", customerEmail: "", customerPhone: "", description: "", amount: "", taxRate: "0", currency: "USD", notes: "", dueDate: "" }); setInvoiceDialog(true); }}>
              <Plus className="h-4 w-4 mr-1" /> {t("admin.accounting.addInvoice")}
            </Button>
          </div>

          <div className="bg-white border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-2 text-gray-600 font-medium">{t("admin.accounting.colInvoiceNumber")}</th>
                  <th className="text-left px-4 py-2 text-gray-600 font-medium">{t("admin.accounting.colCustomer")}</th>
                  <th className="text-left px-4 py-2 text-gray-600 font-medium">{t("admin.accounting.colIssueDate")}</th>
                  <th className="text-right px-4 py-2 text-gray-600 font-medium">{t("admin.accounting.colAmount")}</th>
                  <th className="text-center px-4 py-2 text-gray-600 font-medium">{t("admin.accounting.colStatus")}</th>
                  <th className="text-center px-4 py-2 text-gray-600 font-medium">{t("admin.accounting.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {invoicesQuery.data?.map(inv => (
                  <tr key={inv.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-gray-700">{inv.invoiceNumber}</td>
                    <td className="px-4 py-2 text-gray-700">{inv.customerName}</td>
                    <td className="px-4 py-2 text-gray-600">{formatDate(inv.createdAt)}</td>
                    <td className="px-4 py-2 text-right font-semibold text-gray-800">{formatAmount(inv.totalAmount, inv.currency)}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${INVOICE_STATUS_COLORS[inv.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {INVOICE_STATUS_KEYS[inv.status] ? t(`admin.accounting.${INVOICE_STATUS_KEYS[inv.status]}`) : inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <div className="flex justify-center gap-1">
                        {inv.pdfUrl && (
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 rounded-md" onClick={() => window.open(inv.pdfUrl!, "_blank")}>
                            <Eye className="h-3 w-3" />
                          </Button>
                        )}
                        {inv.status !== "paid" && (
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-green-700 rounded-md" onClick={() => updateInvoiceStatus.mutate({ id: inv.id, status: "paid" })}>
                            {t("admin.accounting.markPaid")}
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 rounded-md text-red-500" onClick={() => {
                          if (confirm(t("admin.accounting.confirmDeleteInvoice"))) deleteInvoice.mutate({ id: inv.id });
                        }}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {/* 1A0a R3:讀取失敗 ≠ 沒有發票(冷載 data===undefined 不得算 0) */}
                {invoicesQuery.isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-300">{t("admin.accounting.loading")}</td></tr>
                ) : invoicesQuery.isError && invoicesQuery.data === undefined ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-amber-700">{t("admin.trustCompliance.loadFailed")}</td></tr>
                ) : invoicesQuery.isError ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-amber-700">{t("financeCockpit.truth.staleHint")}</td></tr>
                ) : (invoicesQuery.data?.length ?? 0) === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">{t("admin.accounting.emptyInvoices")}</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Recurring Expenses Tab */}
        <TabsContent value="recurring" className="space-y-4 pt-4">
          <div className="flex justify-end">
            <Button size="sm" className="rounded-lg" onClick={() => { setRecurringForm({ name: "", category: "rent", amount: "", currency: "USD", frequency: "monthly", nextDueDate: new Date().toISOString().slice(0, 10), isTaxDeductible: false, taxCategory: "", notes: "" }); setRecurringDialog(true); }}>
              <Plus className="h-4 w-4 mr-1" /> {t("admin.accounting.addRecurring")}
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recurringQuery.data?.map(exp => {
              const freqKey = FREQ_KEYS[exp.frequency];
              const freqLabel = freqKey ? t(`admin.accounting.${freqKey}`) : exp.frequency;
              return (
                <div key={exp.id} className="bg-white border rounded-xl p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-gray-800">{exp.description}</div>
                      <div className="text-sm text-gray-500 mt-0.5">{getCategoryLabel(exp.category)} · {freqLabel}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-red-700">{formatAmount(exp.amount, exp.currency)}</div>
                      <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1 justify-end">
                        <Clock className="h-3 w-3" /> {t("admin.accounting.monthlyDay", { n: String(exp.dayOfMonth ?? 1) })}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    {exp.isTaxDeductible === 1 && (
                      <Badge variant="outline" className="text-xs text-green-700 border-green-300 rounded-md">
                        {t("admin.accounting.taxDeductibleBadge")}
                      </Badge>
                    )}
                    <div className="flex-1" />
                    <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg" onClick={() => applyRecurring.mutate({ id: exp.id })}>
                      {t("admin.accounting.applyNow")}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-md text-red-500" onClick={() => {
                      if (confirm(t("admin.accounting.confirmDeleteRecurring"))) deleteRecurring.mutate({ id: exp.id });
                    }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
            {/* 1A0a R3:讀取失敗 ≠ 沒有定期支出 */}
            {recurringQuery.isLoading ? (
              <div className="col-span-2 text-center py-8 text-gray-300">{t("admin.accounting.loading")}</div>
            ) : recurringQuery.isError && recurringQuery.data === undefined ? (
              <div className="col-span-2 text-center py-8 text-amber-700">{t("admin.trustCompliance.loadFailed")}</div>
            ) : recurringQuery.isError ? (
              <div className="col-span-2 text-center py-8 text-amber-700">{t("financeCockpit.truth.staleHint")}</div>
            ) : recurringQuery.data?.length === 0 ? (
              <div className="col-span-2 text-center py-8 text-gray-400">{t("admin.accounting.emptyRecurring")}</div>
            ) : null}
          </div>
        </TabsContent>
      </Tabs>

      {/* Entry Dialog */}
      <Dialog open={entryDialog} onOpenChange={setEntryDialog}>
        <DialogContent className="max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle>{editingEntry ? t("admin.accounting.entryDialogTitleEdit") : t("admin.accounting.entryDialogTitleAdd")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t("admin.accounting.fieldType")}</Label>
                <Select value={entryForm.entryType} onValueChange={v => setEntryForm(p => ({ ...p, entryType: v as "income" | "expense", category: v === "income" ? "other_income" : "other_expense" }))}>
                  <SelectTrigger className="h-8 text-sm mt-1 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="income">{t("admin.accounting.typeIncome")}</SelectItem>
                    <SelectItem value="expense">{t("admin.accounting.typeExpense")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("admin.accounting.fieldDate")}</Label>
                <Input type="date" value={entryForm.entryDate} onChange={e => setEntryForm(p => ({ ...p, entryDate: e.target.value }))} className="h-8 text-sm mt-1 rounded-lg" />
              </div>
            </div>
            <div>
              <Label className="text-xs">{t("admin.accounting.fieldCategory")}</Label>
              <Select value={entryForm.category} onValueChange={v => setEntryForm(p => ({ ...p, category: v }))}>
                <SelectTrigger className="h-8 text-sm mt-1 rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(entryForm.entryType === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t("admin.accounting.fieldDescription")}</Label>
              <Input value={entryForm.description} onChange={e => setEntryForm(p => ({ ...p, description: e.target.value }))} placeholder={t("admin.accounting.descPlaceholder")} className="h-8 text-sm mt-1 rounded-lg" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t("admin.accounting.fieldAmount")}</Label>
                <Input type="number" value={entryForm.amount} onChange={e => setEntryForm(p => ({ ...p, amount: e.target.value }))} placeholder="0" className="h-8 text-sm mt-1 rounded-lg" />
              </div>
              <div>
                <Label className="text-xs">{t("admin.accounting.fieldCurrency")}</Label>
                <Select value={entryForm.currency} onValueChange={v => setEntryForm(p => ({ ...p, currency: v }))}>
                  <SelectTrigger className="h-8 text-sm mt-1 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="taxDeductible" checked={entryForm.isTaxDeductible} onChange={e => setEntryForm(p => ({ ...p, isTaxDeductible: e.target.checked }))} className="h-4 w-4" />
              <Label htmlFor="taxDeductible" className="text-xs cursor-pointer">{t("admin.accounting.fieldTaxDeductible")}</Label>
            </div>
            {entryForm.isTaxDeductible && (
              <div>
                <Label className="text-xs">{t("admin.accounting.fieldTaxCategory")}</Label>
                <Input value={entryForm.taxCategory} onChange={e => setEntryForm(p => ({ ...p, taxCategory: e.target.value }))} placeholder={t("admin.accounting.taxCategoryPlaceholder")} className="h-8 text-sm mt-1 rounded-lg" />
              </div>
            )}
            <div>
              <Label className="text-xs">{t("admin.accounting.fieldNotes")}</Label>
              <Input value={entryForm.notes} onChange={e => setEntryForm(p => ({ ...p, notes: e.target.value }))} placeholder={t("admin.accounting.notesPlaceholder")} className="h-8 text-sm mt-1 rounded-lg" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-lg" onClick={() => setEntryDialog(false)}>{t("admin.accounting.cancel")}</Button>
            <Button className="rounded-lg" onClick={handleEntrySubmit} disabled={createEntry.isPending || updateEntry.isPending}>
              {createEntry.isPending || updateEntry.isPending ? t("admin.accounting.saving") : t("admin.accounting.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 確認支出 Dialog (待確認支出 → 入帳/歸檔) */}
      <Dialog open={pendingDialog} onOpenChange={setPendingDialog}>
        <DialogContent className="max-w-md rounded-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("admin.accounting.pending.dialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* handledMode */}
            <div>
              <Label className="text-xs">{t("admin.accounting.pending.handledMode")}</Label>
              <Select value={pendingForm.handledMode} onValueChange={(v) => setPendingForm({ ...pendingForm, handledMode: v as "ledger" | "receipt_only" })}>
                <SelectTrigger className="rounded-lg"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ledger">{t("admin.accounting.pending.modeLedger")}</SelectItem>
                  <SelectItem value="receipt_only">{t("admin.accounting.pending.modeReceiptOnly")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-gray-400 mt-1">
                {pendingForm.handledMode === "ledger"
                  ? t("admin.accounting.pending.modeLedgerHint")
                  : t("admin.accounting.pending.modeReceiptOnlyHint")}
              </p>
            </div>

            {/* account */}
            <div>
              <Label className="text-xs">{t("admin.accounting.pending.account")}</Label>
              <Select value={pendingForm.account} onValueChange={(v) => setPendingForm({ ...pendingForm, account: v as "trust" | "operating" })}>
                <SelectTrigger className="rounded-lg"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="operating">{t("admin.accounting.pending.accountOperating")}</SelectItem>
                  <SelectItem value="trust">{t("admin.accounting.pending.accountTrust")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* vendor */}
            <div>
              <Label className="text-xs">{t("admin.accounting.pending.vendor")}</Label>
              <Input className="rounded-lg" value={pendingForm.vendor} onChange={(e) => setPendingForm({ ...pendingForm, vendor: e.target.value })} />
            </div>

            {/* amount + currency */}
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Label className="text-xs">{t("admin.accounting.pending.amount")}</Label>
                <Input type="number" step="0.01" className="rounded-lg" value={pendingForm.amount} onChange={(e) => setPendingForm({ ...pendingForm, amount: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">{t("admin.accounting.fieldCurrency")}</Label>
                <Select value={pendingForm.currency} onValueChange={(v) => setPendingForm({ ...pendingForm, currency: v })}>
                  <SelectTrigger className="rounded-lg"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* date */}
            <div>
              <Label className="text-xs">{t("admin.accounting.pending.date")}</Label>
              <Input type="date" className="rounded-lg" value={pendingForm.receiptDate} onChange={(e) => setPendingForm({ ...pendingForm, receiptDate: e.target.value })} />
            </div>

            {/* description */}
            <div>
              <Label className="text-xs">{t("admin.accounting.pending.description")}</Label>
              <Input className="rounded-lg" value={pendingForm.description} onChange={(e) => setPendingForm({ ...pendingForm, description: e.target.value })} />
            </div>

            {/* booking picker (算哪一團) */}
            <div>
              <Label className="text-xs">{t("admin.accounting.pending.booking")}</Label>
              {pendingForm.bookingId != null ? (
                <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                  <span className="text-gray-700 truncate">
                    #{pendingForm.bookingId}{pendingForm.bookingLabel ? ` · ${pendingForm.bookingLabel}` : ""}
                  </span>
                  <Button variant="ghost" size="sm" className="h-6 px-2 rounded-md" onClick={() => setPendingForm({ ...pendingForm, bookingId: null, bookingLabel: "" })}>
                    {t("admin.accounting.pending.clear")}
                  </Button>
                </div>
              ) : (
                <>
                  <Input className="rounded-lg" placeholder={t("admin.accounting.pending.bookingSearchPlaceholder")} value={bookingSearch} onChange={(e) => setBookingSearch(e.target.value)} />
                  {bookingSearch.trim().length >= 2 && (bookingResults.data?.bookings.length ?? 0) > 0 && (
                    <div className="mt-1 border rounded-lg divide-y max-h-40 overflow-y-auto">
                      {bookingResults.data!.bookings.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50"
                          onClick={() => setPendingForm({ ...pendingForm, bookingId: b.id, bookingLabel: b.customerName ?? "" })}
                        >
                          #{b.id} · {b.customerName ?? "—"}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ledger-only fields */}
            {pendingForm.handledMode === "ledger" && (
              <>
                <div>
                  <Label className="text-xs">{t("admin.accounting.pending.entryCategory")}</Label>
                  <Select value={pendingForm.entryCategory} onValueChange={(v) => setPendingForm({ ...pendingForm, entryCategory: v })}>
                    <SelectTrigger className="rounded-lg"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">{t("admin.accounting.fieldNotes")}</Label>
                  <Input className="rounded-lg" value={pendingForm.notes} onChange={(e) => setPendingForm({ ...pendingForm, notes: e.target.value })} />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" className="rounded" checked={pendingForm.isTaxDeductible} onChange={(e) => setPendingForm({ ...pendingForm, isTaxDeductible: e.target.checked })} />
                  {t("admin.accounting.taxDeductible")}
                </label>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-lg" onClick={() => setPendingDialog(false)}>{t("admin.accounting.cancel")}</Button>
            <Button className="rounded-lg" disabled={confirmPending.isPending} onClick={submitConfirm}>
              {pendingForm.handledMode === "ledger" ? t("admin.accounting.pending.doBook") : t("admin.accounting.pending.doArchive")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invoice Dialog */}
      <Dialog open={invoiceDialog} onOpenChange={setInvoiceDialog}>
        <DialogContent className="max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle>{t("admin.accounting.invoiceDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">{t("admin.accounting.fieldCustomerName")}</Label>
              <Input value={invoiceForm.customerName} onChange={e => setInvoiceForm(p => ({ ...p, customerName: e.target.value }))} className="h-8 text-sm mt-1 rounded-lg" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t("admin.accounting.fieldEmail")}</Label>
                <Input type="email" value={invoiceForm.customerEmail} onChange={e => setInvoiceForm(p => ({ ...p, customerEmail: e.target.value }))} className="h-8 text-sm mt-1 rounded-lg" />
              </div>
              <div>
                <Label className="text-xs">{t("admin.accounting.fieldPhone")}</Label>
                <Input value={invoiceForm.customerPhone} onChange={e => setInvoiceForm(p => ({ ...p, customerPhone: e.target.value }))} className="h-8 text-sm mt-1 rounded-lg" />
              </div>
            </div>
            <div>
              <Label className="text-xs">{t("admin.accounting.fieldServiceDesc")}</Label>
              <Input value={invoiceForm.description} onChange={e => setInvoiceForm(p => ({ ...p, description: e.target.value }))} placeholder={t("admin.accounting.serviceDescPlaceholder")} className="h-8 text-sm mt-1 rounded-lg" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">{t("admin.accounting.fieldAmountReq")}</Label>
                <Input type="number" value={invoiceForm.amount} onChange={e => setInvoiceForm(p => ({ ...p, amount: e.target.value }))} className="h-8 text-sm mt-1 rounded-lg" />
              </div>
              <div>
                <Label className="text-xs">{t("admin.accounting.fieldTaxRate")}</Label>
                <Input type="number" value={invoiceForm.taxRate} onChange={e => setInvoiceForm(p => ({ ...p, taxRate: e.target.value }))} className="h-8 text-sm mt-1 rounded-lg" />
              </div>
              <div>
                <Label className="text-xs">{t("admin.accounting.fieldCurrency")}</Label>
                <Select value={invoiceForm.currency} onValueChange={v => setInvoiceForm(p => ({ ...p, currency: v }))}>
                  <SelectTrigger className="h-8 text-sm mt-1 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">{t("admin.accounting.fieldDueDate")}</Label>
              <Input type="date" value={invoiceForm.dueDate} onChange={e => setInvoiceForm(p => ({ ...p, dueDate: e.target.value }))} className="h-8 text-sm mt-1 rounded-lg" />
            </div>
            <div>
              <Label className="text-xs">{t("admin.accounting.fieldNotesSimple")}</Label>
              <Input value={invoiceForm.notes} onChange={e => setInvoiceForm(p => ({ ...p, notes: e.target.value }))} className="h-8 text-sm mt-1 rounded-lg" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-lg" onClick={() => setInvoiceDialog(false)}>{t("admin.accounting.cancel")}</Button>
            <Button className="rounded-lg" onClick={handleInvoiceSubmit} disabled={createInvoice.isPending}>
              {createInvoice.isPending ? t("admin.accounting.creating") : t("admin.accounting.createInvoice")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recurring Expense Dialog */}
      <Dialog open={recurringDialog} onOpenChange={setRecurringDialog}>
        <DialogContent className="max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle>{t("admin.accounting.recurringDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">{t("admin.accounting.fieldName")}</Label>
              <Input value={recurringForm.name} onChange={e => setRecurringForm(p => ({ ...p, name: e.target.value }))} placeholder={t("admin.accounting.namePlaceholder")} className="h-8 text-sm mt-1 rounded-lg" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t("admin.accounting.fieldCategory")}</Label>
                <Select value={recurringForm.category} onValueChange={v => setRecurringForm(p => ({ ...p, category: v }))}>
                  <SelectTrigger className="h-8 text-sm mt-1 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("admin.accounting.fieldFrequency")}</Label>
                <Select value={recurringForm.frequency} onValueChange={v => setRecurringForm(p => ({ ...p, frequency: v as typeof recurringForm.frequency }))}>
                  <SelectTrigger className="h-8 text-sm mt-1 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">{t("admin.accounting.freqMonthly")}</SelectItem>
                    <SelectItem value="quarterly">{t("admin.accounting.freqQuarterly")}</SelectItem>
                    <SelectItem value="yearly">{t("admin.accounting.freqYearly")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t("admin.accounting.fieldAmount")}</Label>
                <Input type="number" value={recurringForm.amount} onChange={e => setRecurringForm(p => ({ ...p, amount: e.target.value }))} className="h-8 text-sm mt-1 rounded-lg" />
              </div>
              <div>
                <Label className="text-xs">{t("admin.accounting.fieldCurrency")}</Label>
                <Select value={recurringForm.currency} onValueChange={v => setRecurringForm(p => ({ ...p, currency: v }))}>
                  <SelectTrigger className="h-8 text-sm mt-1 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">{t("admin.accounting.fieldNextDueDate")}</Label>
              <Input type="date" value={recurringForm.nextDueDate} onChange={e => setRecurringForm(p => ({ ...p, nextDueDate: e.target.value }))} className="h-8 text-sm mt-1 rounded-lg" />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="recTaxDeductible" checked={recurringForm.isTaxDeductible} onChange={e => setRecurringForm(p => ({ ...p, isTaxDeductible: e.target.checked }))} className="h-4 w-4" />
              <Label htmlFor="recTaxDeductible" className="text-xs cursor-pointer">{t("admin.accounting.fieldTaxDeductible")}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-lg" onClick={() => setRecurringDialog(false)}>{t("admin.accounting.cancel")}</Button>
            <Button className="rounded-lg" onClick={() => {
              const amount = parseFloat(recurringForm.amount);
              if (!amount || !recurringForm.name) { toast.error(t("admin.accounting.nameAmountRequired")); return; }
              createRecurring.mutate({
                name: recurringForm.name,
                category: recurringForm.category,
                amount,
                currency: recurringForm.currency,
                frequency: recurringForm.frequency,
                nextDueDate: new Date(recurringForm.nextDueDate),
                isTaxDeductible: recurringForm.isTaxDeductible,
                taxCategory: recurringForm.taxCategory || undefined,
                notes: recurringForm.notes || undefined,
              });
            }} disabled={createRecurring.isPending}>
              {createRecurring.isPending ? t("admin.accounting.saving") : t("admin.accounting.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
