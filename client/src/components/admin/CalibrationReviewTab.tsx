/**
 * CalibrationReviewTab.tsx
 * Admin interface for reviewing tours that are pending QA calibration review.
 * Shows calibration scores, issues, and allows approve/reject actions.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
  Eye,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CalibrationIssue {
  check: string;
  severity: "critical" | "warning" | "info";
  message: string;
  field?: string;
  autoFixable: boolean;
}

interface AutoFix {
  field: string;
  before: string;
  after: string;
}

interface CalibrationResult {
  id: number;
  tourId: number;
  contentFidelityScore: number;
  translationScore: number;
  imageScore: number;
  completenessScore: number;
  marketingScore: number;
  totalScore: number;
  verdict: "approved" | "review" | "rejected";
  issues: string | null;
  autoFixesApplied: string | null;
  createdAt: Date;
}

interface PendingTour {
  id: number;
  title: string;
  destinationCountry: string;
  destinationCity: string;
  duration: number;
  price: number;
  status: string;
  createdAt: Date;
  calibration: CalibrationResult | null;
}

// ─── Score Bar ────────────────────────────────────────────────────────────────

function ScoreBar({ label, score }: { label: string; score: number }) {
  const color =
    score >= 80 ? "bg-green-500" : score >= 60 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-600">
        <span>{label}</span>
        <span className="font-medium">{score}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-200">
        <div
          className={`h-1.5 rounded-full transition-all ${color}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

// ─── Verdict Badge ────────────────────────────────────────────────────────────

function VerdictBadge({ verdict }: { verdict: "approved" | "review" | "rejected" }) {
  if (verdict === "approved")
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200">
        <CheckCircle className="w-3 h-3 mr-1" /> 通過
      </Badge>
    );
  if (verdict === "rejected")
    return (
      <Badge className="bg-red-100 text-red-800 border-red-200">
        <XCircle className="w-3 h-3 mr-1" /> 拒絕
      </Badge>
    );
  return (
    <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
      <AlertTriangle className="w-3 h-3 mr-1" /> 待審
    </Badge>
  );
}

// ─── Issue Severity Badge ─────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === "critical")
    return <Badge className="bg-red-100 text-red-700 text-xs">嚴重</Badge>;
  if (severity === "warning")
    return <Badge className="bg-yellow-100 text-yellow-700 text-xs">警告</Badge>;
  return <Badge className="bg-blue-100 text-blue-700 text-xs">提示</Badge>;
}

// ─── Tour Card ────────────────────────────────────────────────────────────────

function TourCalibrationCard({
  tour,
  onApprove,
  onReject,
  isApproving,
  isRejecting,
}: {
  tour: PendingTour;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  isApproving: boolean;
  isRejecting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const cal = tour.calibration;

  const issues: CalibrationIssue[] = cal?.issues ? JSON.parse(cal.issues) : [];
  const autoFixes: AutoFix[] = cal?.autoFixesApplied
    ? JSON.parse(cal.autoFixesApplied)
    : [];

  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  return (
    <Card className="border border-gray-200 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base font-semibold text-gray-900 truncate">
              {tour.title}
            </CardTitle>
            <CardDescription className="mt-1 text-sm text-gray-500">
              {tour.destinationCountry}
              {tour.destinationCity ? ` · ${tour.destinationCity}` : ""} ·{" "}
              {tour.duration} 天 · NT$ {tour.price?.toLocaleString()}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {cal ? (
              <VerdictBadge verdict={cal.verdict} />
            ) : (
              <Badge variant="outline" className="text-gray-500">
                無校準資料
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Score Summary */}
        {cal && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                總分：
                <span
                  className={`ml-1 font-bold ${
                    cal.totalScore >= 80
                      ? "text-green-600"
                      : cal.totalScore >= 60
                      ? "text-yellow-600"
                      : "text-red-600"
                  }`}
                >
                  {cal.totalScore} / 100
                </span>
              </span>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                {criticalCount > 0 && (
                  <span className="text-red-600 font-medium">
                    {criticalCount} 嚴重問題
                  </span>
                )}
                {warningCount > 0 && (
                  <span className="text-yellow-600 font-medium">
                    {warningCount} 警告
                  </span>
                )}
                {autoFixes.length > 0 && (
                  <span className="text-green-600 font-medium">
                    {autoFixes.length} 自動修正
                  </span>
                )}
              </div>
            </div>

            {/* Score Bars */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              <ScoreBar label="內容忠實度 (30%)" score={cal.contentFidelityScore} />
              <ScoreBar label="翻譯品質 (20%)" score={cal.translationScore} />
              <ScoreBar label="圖片品質 (20%)" score={cal.imageScore} />
              <ScoreBar label="完整度 (15%)" score={cal.completenessScore} />
              <ScoreBar label="行銷品質 (15%)" score={cal.marketingScore} />
            </div>

            {/* Expandable Issues */}
            {issues.length > 0 && (
              <div>
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                >
                  {expanded ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                  {expanded ? "收起問題清單" : `查看 ${issues.length} 個問題`}
                </button>
                {expanded && (
                  <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
                    {issues.map((issue, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2 p-2 rounded-md bg-gray-50 text-xs"
                      >
                        <SeverityBadge severity={issue.severity} />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-gray-700">
                            [{issue.check}]
                          </span>{" "}
                          <span className="text-gray-600">{issue.message}</span>
                          {issue.field && (
                            <span className="ml-1 text-gray-400">
                              ({issue.field})
                            </span>
                          )}
                        </div>
                        {issue.autoFixable && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <CheckCircle className="w-3 h-3 text-green-500 shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>已自動修正</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDetailOpen(true)}
              className="text-xs h-8"
            >
              <Eye className="w-3 h-3 mr-1" />
              查看詳情
            </Button>
            <Button
              variant="outline"
              size="sm"
              asChild
              className="text-xs h-8"
            >
              <a
                href={`/tours/${tour.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                預覽行程
              </a>
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onReject(tour.id)}
              disabled={isRejecting || isApproving}
              className="text-xs h-8 border-red-200 text-red-600 hover:bg-red-50"
            >
              <XCircle className="w-3 h-3 mr-1" />
              拒絕
            </Button>
            <Button
              size="sm"
              onClick={() => onApprove(tour.id)}
              disabled={isApproving || isRejecting}
              className="text-xs h-8 bg-green-600 hover:bg-green-700 text-white"
            >
              <CheckCircle className="w-3 h-3 mr-1" />
              核准上架
            </Button>
          </div>
        </div>
      </CardContent>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>校準詳情 — {tour.title}</DialogTitle>
            <DialogDescription>
              校準時間：{cal ? new Date(cal.createdAt).toLocaleString() : "無資料"}
            </DialogDescription>
          </DialogHeader>
          {cal ? (
            <div className="space-y-4">
              {/* All scores */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-gray-700">評分詳情</h4>
                <ScoreBar label="內容忠實度 (30%)" score={cal.contentFidelityScore} />
                <ScoreBar label="翻譯品質 (20%)" score={cal.translationScore} />
                <ScoreBar label="圖片品質 (20%)" score={cal.imageScore} />
                <ScoreBar label="完整度 (15%)" score={cal.completenessScore} />
                <ScoreBar label="行銷品質 (15%)" score={cal.marketingScore} />
                <div className="pt-1 border-t">
                  <ScoreBar label="加權總分" score={cal.totalScore} />
                </div>
              </div>

              {/* Issues */}
              {issues.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-gray-700">
                    問題清單 ({issues.length})
                  </h4>
                  <div className="space-y-2">
                    {issues.map((issue, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2 p-3 rounded-lg bg-gray-50 text-sm"
                      >
                        <SeverityBadge severity={issue.severity} />
                        <div className="flex-1">
                          <span className="font-medium">[{issue.check}]</span>{" "}
                          {issue.message}
                          {issue.field && (
                            <span className="ml-1 text-gray-400 text-xs">
                              (欄位: {issue.field})
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Auto Fixes */}
              {autoFixes.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-gray-700">
                    自動修正 ({autoFixes.length})
                  </h4>
                  <div className="space-y-2">
                    {autoFixes.map((fix, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg bg-green-50 border border-green-100 text-xs space-y-1"
                      >
                        <div className="font-medium text-green-700">
                          欄位：{fix.field}
                        </div>
                        <div className="text-gray-500 line-through truncate">
                          {fix.before}
                        </div>
                        <div className="text-green-700 truncate">{fix.after}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-gray-400">
              <Info className="w-8 h-8 mx-auto mb-2" />
              <p>此行程尚無校準資料</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              關閉
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export default function CalibrationReviewTab() {
  const utils = trpc.useUtils();
  const { data: pendingTours, isLoading, refetch } =
    trpc.tours.getPendingReview.useQuery(undefined, {
      refetchInterval: 30_000, // Auto-refresh every 30s
    });

  const approveMutation = trpc.tours.approveTour.useMutation({
    onSuccess: (data) => {
      toast.success("行程已核准", { description: data.message });
      utils.tours.getPendingReview.invalidate();
    },
    onError: (err) => {
      toast.error("核准失敗", { description: err.message });
    },
  });

  const rejectMutation = trpc.tours.rejectTour.useMutation({
    onSuccess: (data) => {
      toast.success("行程已拒絕", { description: data.message });
      utils.tours.getPendingReview.invalidate();
    },
    onError: (err) => {
      toast.error("拒絕失敗", { description: err.message });
    },
  });

  const tours = (pendingTours ?? []) as PendingTour[];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">QA 品質審查</h2>
          <p className="text-sm text-gray-500 mt-1">
            審查 AI 自動生成行程的品質校準結果，核准後行程將自動上架。
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isLoading}
          className="gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          重新整理
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border border-gray-200">
          <CardContent className="pt-4 pb-4">
            <div className="text-2xl font-bold text-gray-900">{tours.length}</div>
            <div className="text-xs text-gray-500 mt-1">待審行程</div>
          </CardContent>
        </Card>
        <Card className="border border-gray-200">
          <CardContent className="pt-4 pb-4">
            <div className="text-2xl font-bold text-yellow-600">
              {tours.filter((t) => t.calibration?.verdict === "review").length}
            </div>
            <div className="text-xs text-gray-500 mt-1">需人工審查</div>
          </CardContent>
        </Card>
        <Card className="border border-gray-200">
          <CardContent className="pt-4 pb-4">
            <div className="text-2xl font-bold text-red-600">
              {tours.filter(
                (t) =>
                  t.calibration &&
                  t.calibration.issues &&
                  JSON.parse(t.calibration.issues).filter(
                    (i: CalibrationIssue) => i.severity === "critical"
                  ).length > 0
              ).length}
            </div>
            <div className="text-xs text-gray-500 mt-1">含嚴重問題</div>
          </CardContent>
        </Card>
      </div>

      {/* Tour List */}
      {isLoading ? (
        <div className="py-16 text-center text-gray-400">
          <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin" />
          <p>載入中...</p>
        </div>
      ) : tours.length === 0 ? (
        <div className="py-16 text-center text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
          <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-400" />
          <p className="text-lg font-medium text-gray-600">目前沒有待審行程</p>
          <p className="text-sm mt-1">所有 AI 生成行程均已完成審查</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {tours.map((tour) => (
            <TourCalibrationCard
              key={tour.id}
              tour={tour}
              onApprove={(id) => approveMutation.mutate({ id })}
              onReject={(id) => rejectMutation.mutate({ id })}
              isApproving={
                approveMutation.isPending &&
                approveMutation.variables?.id === tour.id
              }
              isRejecting={
                rejectMutation.isPending &&
                rejectMutation.variables?.id === tour.id
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
