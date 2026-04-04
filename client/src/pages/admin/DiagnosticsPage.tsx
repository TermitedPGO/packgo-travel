/**
 * AI 行程生成診斷工具頁面
 * 
 * 功能：
 * 1. 測試雄獅旅遊 URL 的爬取結果
 * 2. 檢查 dailyItinerary 和 activities 是否有資料
 * 3. 驗證 LLM Fallback 是否被觸發
 * 4. 顯示每個 Agent 的輸入/輸出
 * 5. 標出問題卡在哪一個環節
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Search, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  SkipForward,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  Bug,
  Lightbulb,
  FileJson,
  ArrowRight,
} from "lucide-react";

// 診斷步驟類型
interface DiagnosticStep {
  name: string;
  status: 'success' | 'warning' | 'error' | 'skipped';
  duration: number;
  input?: any;
  output?: any;
  error?: string;
  details?: string;
  subSteps?: DiagnosticStep[];
}

// 診斷報告類型
interface DiagnosticReport {
  url: string;
  timestamp: string;
  totalDuration: number;
  overallStatus: 'success' | 'partial' | 'failed';
  problemSummary: string[];
  steps: DiagnosticStep[];
  recommendations: string[];
}

// 狀態圖標組件
function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    case 'warning':
      return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
    case 'error':
      return <XCircle className="h-5 w-5 text-red-500" />;
    case 'skipped':
      return <SkipForward className="h-5 w-5 text-gray-400" />;
    default:
      return null;
  }
}

// 狀態徽章組件
function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    success: "default",
    warning: "secondary",
    error: "destructive",
    skipped: "outline",
  };
  
  const labels: Record<string, string> = {
    success: "成功",
    warning: "警告",
    error: "錯誤",
    skipped: "跳過",
  };
  
  return (
    <Badge variant={variants[status] || "outline"}>
      {labels[status] || status}
    </Badge>
  );
}

// JSON 檢視器組件
function JsonViewer({ data, title }: { data: any; title: string }) {
  const [isOpen, setIsOpen] = useState(false);
  
  if (!data) return null;
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <FileJson className="h-4 w-4" />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ScrollArea className="h-[200px] mt-2 rounded-md border bg-muted/50 p-4">
          <pre className="text-xs font-mono whitespace-pre-wrap">
            {JSON.stringify(data, null, 2)}
          </pre>
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  );
}

// 診斷步驟卡片組件
function StepCard({ step, index }: { step: DiagnosticStep; index: number }) {
  const [isOpen, setIsOpen] = useState(step.status === 'error' || step.status === 'warning');
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className={`border-l-4 ${
        step.status === 'success' ? 'border-l-green-500' :
        step.status === 'warning' ? 'border-l-yellow-500' :
        step.status === 'error' ? 'border-l-red-500' :
        'border-l-gray-300'
      }`}>
        <CollapsibleTrigger className="w-full">
          <CardHeader className="py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-muted-foreground">#{index + 1}</span>
                <StatusIcon status={step.status} />
                <CardTitle className="text-base">{step.name}</CardTitle>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {step.duration}ms
                </div>
                <StatusBadge status={step.status} />
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            {/* 詳細說明 */}
            {step.details && (
              <p className="text-sm">{step.details}</p>
            )}
            
            {/* 錯誤訊息 */}
            {step.error && (
              <div className="p-3 rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-700 dark:text-red-300 font-medium">
                  ❌ {step.error}
                </p>
              </div>
            )}
            
            {/* 子步驟 */}
            {step.subSteps && step.subSteps.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">子步驟檢查：</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {step.subSteps.map((subStep, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <StatusIcon status={subStep.status} />
                      <span>{subStep.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* 輸入/輸出資料 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <JsonViewer data={step.input} title="輸入資料" />
              <JsonViewer data={step.output} title="輸出資料" />
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export default function DiagnosticsPage() {
  const [url, setUrl] = useState("https://travel.liontravel.com/tour/V2_2025XMAS-ALISHAN-TRAIN-3D/detail?departureDate=2025-12-24");
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  
  const diagnoseMutation = trpc.tours.diagnose.useMutation({
    onSuccess: (data) => {
      setReport(data as DiagnosticReport);
    },
  });
  
  const handleDiagnose = () => {
    if (!url.trim()) return;
    diagnoseMutation.mutate({ url });
  };
  
  return (
    <div className="container max-w-5xl py-8 space-y-8">
      {/* 標題區 */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Bug className="h-8 w-8 text-primary" />
          AI 行程生成診斷工具
        </h1>
        <p className="text-muted-foreground">
          測試 URL 爬取結果，檢查每個 Agent 的輸入/輸出，標出問題環節
        </p>
      </div>
      
      {/* 輸入區 */}
      <Card>
        <CardHeader>
          <CardTitle>診斷 URL</CardTitle>
          <CardDescription>
            輸入要診斷的旅遊行程 URL（支援雄獅旅遊等網站）
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <Input
              placeholder="https://travel.liontravel.com/tour/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1"
            />
            <Button 
              onClick={handleDiagnose}
              disabled={diagnoseMutation.isPending || !url.trim()}
            >
              {diagnoseMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  診斷中...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  開始診斷
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
      
      {/* 診斷進行中 */}
      {diagnoseMutation.isPending && (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-lg font-medium">正在執行診斷...</p>
              <p className="text-sm text-muted-foreground">
                這可能需要 1-2 分鐘，請耐心等待
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* 診斷報告 */}
      {report && !diagnoseMutation.isPending && (
        <div className="space-y-6">
          {/* 摘要卡片 */}
          <Card className={`border-2 ${
            report.overallStatus === 'success' ? 'border-green-500 bg-green-50 dark:bg-green-950' :
            report.overallStatus === 'partial' ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950' :
            'border-red-500 bg-red-50 dark:bg-red-950'
          }`}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <StatusIcon status={
                    report.overallStatus === 'success' ? 'success' :
                    report.overallStatus === 'partial' ? 'warning' : 'error'
                  } />
                  <CardTitle className="text-xl">
                    診斷結果：{
                      report.overallStatus === 'success' ? '全部通過' :
                      report.overallStatus === 'partial' ? '部分問題' : '診斷失敗'
                    }
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  總耗時 {(report.totalDuration / 1000).toFixed(1)} 秒
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 問題摘要 */}
              {report.problemSummary.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-500" />
                    發現的問題：
                  </h4>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    {report.problemSummary.map((problem, i) => (
                      <li key={i} className="text-red-700 dark:text-red-300">{problem}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              {/* 建議修復 */}
              {report.recommendations.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-yellow-500" />
                    建議修復：
                  </h4>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    {report.recommendations.map((rec, i) => (
                      <li key={i}>{rec}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
          
          {/* 步驟流程圖 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowRight className="h-5 w-5" />
                診斷流程
              </CardTitle>
              <CardDescription>
                點擊展開查看每個步驟的詳細輸入/輸出
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {report.steps.map((step, index) => (
                  <StepCard key={index} step={step} index={index} />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      
      {/* 錯誤訊息 */}
      {diagnoseMutation.error && (
        <Card className="border-red-500">
          <CardContent className="py-6">
            <div className="flex items-center gap-3 text-red-500">
              <XCircle className="h-6 w-6" />
              <div>
                <p className="font-medium">診斷失敗</p>
                <p className="text-sm">{diagnoseMutation.error.message}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
