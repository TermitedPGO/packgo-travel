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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatAmount(amount: string | number, currency = "TWD"): string {
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
    currency: "TWD",
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
    currency: "TWD",
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
    currency: "TWD",
    notes: "",
    dueDate: "",
  });

  const utils = trpc.useUtils();

  // Queries
  const startDate = useMemo(() => new Date(dateRange.start + "T00:00:00"), [dateRange.start]);
  const endDate = useMemo(() => new Date(dateRange.end + "T23:59:59"), [dateRange.end]);

  const dashboardQuery = trpc.accounting.dashboard.useQuery({ startDate, endDate });
  const entriesQuery = trpc.accounting.list.useQuery({
    startDate,
    endDate,
    entryType: filterType === "all" ? undefined : filterType,
    category: filterCategory === "all" ? undefined : filterCategory,
    limit: 200,
  });
  const invoicesQuery = trpc.invoices.list.useQuery({ limit: 100 });
  const recurringQuery = trpc.recurringExpenses.list.useQuery();
  const trendQuery = trpc.accounting.monthlyTrend.useQuery({ months: 6 });
  const taxYear = new Date().getFullYear();
  const taxQuery = trpc.accounting.taxSummary.useQuery({ year: taxYear });

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

  const stats = dashboardQuery.data?.stats;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{t("admin.accounting.pageTitle")}</h2>
          <p className="text-sm text-gray-500 mt-1">{t("admin.accounting.pageDesc")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="rounded-lg" onClick={handleExportCsv}>
            <Download className="h-4 w-4 mr-1" /> {t("admin.accounting.exportCsv")}
          </Button>
          <Button size="sm" className="rounded-lg" onClick={() => { setEditingEntry(null); setEntryForm({ entryType: "expense", category: "other_expense", amount: "", currency: "TWD", description: "", entryDate: new Date().toISOString().slice(0, 10), isTaxDeductible: false, taxCategory: "", notes: "" }); setEntryDialog(true); }}>
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

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-green-600" />
              <span className="text-xs text-green-700 font-medium">{t("admin.accounting.statsCurrentIncome")}</span>
            </div>
            <div className="text-xl font-bold text-green-800">{formatAmount(stats.totalIncome)}</div>
            <div className="text-xs text-green-600 mt-1">{t("admin.accounting.statsYearTotal", { value: formatAmount(stats.yearIncome) })}</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="h-4 w-4 text-red-600" />
              <span className="text-xs text-red-700 font-medium">{t("admin.accounting.statsCurrentExpenses")}</span>
            </div>
            <div className="text-xl font-bold text-red-800">{formatAmount(stats.totalExpenses)}</div>
            <div className="text-xs text-red-600 mt-1">{t("admin.accounting.statsYearTotal", { value: formatAmount(stats.yearExpenses) })}</div>
          </div>
          <div className={`${stats.netProfit >= 0 ? "bg-blue-50 border-blue-200" : "bg-orange-50 border-orange-200"} border rounded-lg p-4`}>
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className={`h-4 w-4 ${stats.netProfit >= 0 ? "text-blue-600" : "text-orange-600"}`} />
              <span className={`text-xs font-medium ${stats.netProfit >= 0 ? "text-blue-700" : "text-orange-700"}`}>{t("admin.accounting.statsCurrentNet")}</span>
            </div>
            <div className={`text-xl font-bold ${stats.netProfit >= 0 ? "text-blue-800" : "text-orange-800"}`}>{formatAmount(stats.netProfit)}</div>
            <div className={`text-xs mt-1 ${stats.netProfit >= 0 ? "text-blue-600" : "text-orange-600"}`}>{t("admin.accounting.statsYearTotal", { value: formatAmount(stats.yearNetProfit) })}</div>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="h-4 w-4 text-purple-600" />
              <span className="text-xs text-purple-700 font-medium">{t("admin.accounting.statsProfitMargin")}</span>
            </div>
            <div className="text-xl font-bold text-purple-800">
              {stats.totalIncome > 0 ? ((stats.netProfit / stats.totalIncome) * 100).toFixed(1) : "0"}%
            </div>
            <div className="text-xs text-purple-600 mt-1">
              {t("admin.accounting.statsYearPercent", { value: stats.yearIncome > 0 ? (((stats.yearIncome - stats.yearExpenses) / stats.yearIncome) * 100).toFixed(1) : "0" })}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full max-w-lg rounded-lg">
          <TabsTrigger value="overview" className="rounded-md">{t("admin.accounting.tabOverview")}</TabsTrigger>
          <TabsTrigger value="entries" className="rounded-md">{t("admin.accounting.tabEntries")}</TabsTrigger>
          <TabsTrigger value="invoices" className="rounded-md">{t("admin.accounting.tabInvoices")}</TabsTrigger>
          <TabsTrigger value="recurring" className="rounded-md">{t("admin.accounting.tabRecurring")}</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6 pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Monthly Trend */}
            <div className="bg-white border rounded-xl p-4">
              <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <BarChart3 className="h-4 w-4" /> {t("admin.accounting.monthlyTrend")}
              </h3>
              {trendQuery.data && (
                <div className="space-y-2">
                  {trendQuery.data.slice(-6).map(m => (
                    <div key={m.month} className="flex items-center gap-2 text-sm">
                      <span className="text-gray-500 w-16">{m.month.slice(5)}</span>
                      <div className="flex-1 flex gap-1">
                        <div className="h-5 bg-green-200 rounded text-xs flex items-center justify-center text-green-800 font-medium px-1"
                          style={{ width: `${Math.max(5, (m.income / (Math.max(...trendQuery.data.map(x => x.income)) || 1)) * 100)}%`, minWidth: "40px" }}>
                          {formatAmount(m.income)}
                        </div>
                      </div>
                      <div className={`text-xs font-medium ${m.netProfit >= 0 ? "text-green-700" : "text-red-700"}`}>
                        {m.netProfit >= 0 ? "+" : ""}{formatAmount(m.netProfit)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tax Summary */}
            <div className="bg-white border rounded-xl p-4">
              <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <Receipt className="h-4 w-4" /> {t("admin.accounting.taxSummaryTitle", { year: String(taxYear) })}
              </h3>
              {taxQuery.data && (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between py-1 border-b">
                    <span className="text-gray-600">{t("admin.accounting.taxYearIncome")}</span>
                    <span className="font-medium text-green-700">{formatAmount(taxQuery.data.totalIncome)}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b">
                    <span className="text-gray-600">{t("admin.accounting.taxDeductible")}</span>
                    <span className="font-medium text-red-700">-{formatAmount(taxQuery.data.taxDeductibleExpenses)}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b">
                    <span className="text-gray-600">{t("admin.accounting.taxNonDeductible")}</span>
                    <span className="font-medium text-gray-600">{formatAmount(taxQuery.data.nonDeductibleExpenses)}</span>
                  </div>
                  <div className="flex justify-between py-2 bg-yellow-50 rounded-md px-2">
                    <span className="font-semibold text-gray-800">{t("admin.accounting.taxEstimatedTaxable")}</span>
                    <span className="font-bold text-yellow-800">{formatAmount(taxQuery.data.estimatedTaxableIncome)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Top Categories */}
          {dashboardQuery.data && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white border rounded-xl p-4">
                <h3 className="font-semibold text-gray-800 mb-3">{t("admin.accounting.incomeSources")}</h3>
                <div className="space-y-2">
                  {dashboardQuery.data.topIncomeCategories.map(c => (
                    <div key={c.category} className="flex items-center gap-2 text-sm">
                      <span className="text-gray-600 w-24 truncate">{getCategoryLabel(c.category)}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div className="bg-green-500 h-2 rounded-full" style={{ width: `${c.percentage}%` }} />
                      </div>
                      <span className="text-gray-700 font-medium w-20 text-right">{formatAmount(c.amount)}</span>
                    </div>
                  ))}
                  {dashboardQuery.data.topIncomeCategories.length === 0 && (
                    <p className="text-gray-400 text-sm">{t("admin.accounting.emptyIncome")}</p>
                  )}
                </div>
              </div>
              <div className="bg-white border rounded-xl p-4">
                <h3 className="font-semibold text-gray-800 mb-3">{t("admin.accounting.expenseCategories")}</h3>
                <div className="space-y-2">
                  {dashboardQuery.data.topExpenseCategories.map(c => (
                    <div key={c.category} className="flex items-center gap-2 text-sm">
                      <span className="text-gray-600 w-24 truncate">{getCategoryLabel(c.category)}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div className="bg-red-400 h-2 rounded-full" style={{ width: `${c.percentage}%` }} />
                      </div>
                      <span className="text-gray-700 font-medium w-20 text-right">{formatAmount(c.amount)}</span>
                    </div>
                  ))}
                  {dashboardQuery.data.topExpenseCategories.length === 0 && (
                    <p className="text-gray-400 text-sm">{t("admin.accounting.emptyExpenses")}</p>
                  )}
                </div>
              </div>
            </div>
          )}
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
                {entriesQuery.data?.entries.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">{t("admin.accounting.emptyEntries")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Invoices Tab */}
        <TabsContent value="invoices" className="space-y-4 pt-4">
          <div className="flex justify-end">
            <Button size="sm" className="rounded-lg" onClick={() => { setInvoiceForm({ customerName: "", customerEmail: "", customerPhone: "", description: "", amount: "", taxRate: "0", currency: "TWD", notes: "", dueDate: "" }); setInvoiceDialog(true); }}>
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
                {(invoicesQuery.data?.length ?? 0) === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">{t("admin.accounting.emptyInvoices")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Recurring Expenses Tab */}
        <TabsContent value="recurring" className="space-y-4 pt-4">
          <div className="flex justify-end">
            <Button size="sm" className="rounded-lg" onClick={() => { setRecurringForm({ name: "", category: "rent", amount: "", currency: "TWD", frequency: "monthly", nextDueDate: new Date().toISOString().slice(0, 10), isTaxDeductible: false, taxCategory: "", notes: "" }); setRecurringDialog(true); }}>
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
            {recurringQuery.data?.length === 0 && (
              <div className="col-span-2 text-center py-8 text-gray-400">{t("admin.accounting.emptyRecurring")}</div>
            )}
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
