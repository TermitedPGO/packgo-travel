/**
 * ToursTabBulkImportDialog — v80.24 fast bulk-import from Lion Travel.
 *
 * Why: regular AI generation runs the full LLM pipeline (60-90s/tour).
 * For power-users importing 30+ tours at a time, that's 30-45 minutes.
 * This dialog uses a faster path: it pulls Lion's raw data directly
 * (~500ms/tour) and inserts it as draft tours, then optionally queues
 * background LLM rewrite. Result: ~30 seconds for 30 tours vs. 30 minutes.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Download, Loader2, CheckCircle2, AlertCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function ToursTabBulkImportDialog({ open, onOpenChange, onSuccess }: Props) {
  const [categoryPath, setCategoryPath] = useState<string>("");
  const [limit, setLimit] = useState<number>(20);
  const [queueRewrite, setQueueRewrite] = useState<boolean>(true);
  const [result, setResult] = useState<any>(null);

  const { data: categories } = trpc.tours.listLionCategories.useQuery();
  const utils = trpc.useUtils();

  const importMutation = trpc.tours.bulkImportFromLion.useMutation({
    onSuccess: (data: any) => {
      setResult(data);
      utils.tours.list.invalidate();
      const msg = `匯入完成：${data.imported}/${data.total} 筆（耗時 ${(data.durationMs / 1000).toFixed(1)}秒）`;
      toast.success(msg);
      onSuccess?.();
    },
    onError: (err) => {
      toast.error(`匯入失敗：${err.message}`);
    },
  });

  const handleStart = () => {
    if (!categoryPath) {
      toast.error("請選擇雄獅分類");
      return;
    }
    setResult(null);
    importMutation.mutate({ categoryPath, limit, queueRewrite });
  };

  const isRunning = importMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !isRunning) {
          setResult(null);
          onOpenChange(false);
        } else if (o) onOpenChange(true);
      }}
    >
      <DialogContent className="max-w-lg rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-[#c9a563]" />
            從雄獅旅遊批次匯入
          </DialogTitle>
          <DialogDescription>
            從雄獅分類頁直接抓取行程清單，**不走 LLM 重寫**（速度約 30 秒匯入 20-30 筆）。
            匯入後可選擇排隊背景升級為 PACK&GO 風格。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">雄獅分類</Label>
            <Select value={categoryPath} onValueChange={setCategoryPath} disabled={isRunning}>
              <SelectTrigger className="rounded-lg">
                <SelectValue placeholder="選擇分類（例如：歐洲｜中西歐）" />
              </SelectTrigger>
              <SelectContent>
                {(categories || []).map((c) => (
                  <SelectItem key={c.path} value={c.path}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">最多匯入幾筆</Label>
            <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))} disabled={isRunning}>
              <SelectTrigger className="rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5 筆（快速測試）</SelectItem>
                <SelectItem value="10">10 筆</SelectItem>
                <SelectItem value="20">20 筆（建議）</SelectItem>
                <SelectItem value="50">50 筆</SelectItem>
                <SelectItem value="100">100 筆（最多）</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-start gap-2 px-3 py-2.5 bg-[#FAF8F2] border border-[#c9a563]/30 rounded-lg">
            <input
              type="checkbox"
              id="queueRewrite"
              checked={queueRewrite}
              onChange={(e) => setQueueRewrite(e.target.checked)}
              disabled={isRunning}
              className="mt-0.5 h-4 w-4 rounded border-foreground/40 text-foreground"
            />
            <Label htmlFor="queueRewrite" className="text-xs leading-relaxed cursor-pointer flex-1">
              <strong className="text-foreground">背景排隊 LLM 升級</strong>
              <span className="block text-foreground/60 mt-0.5">
                匯入完成後，自動排隊背景升級每筆為 PACK&GO 風格（每筆約 60-90 秒，序列執行）。
                **不勾選則只匯入 raw 資料**，之後可手動點選個別行程升級。
              </span>
            </Label>
          </div>

          {/* Result panel */}
          {result && (
            <div className="rounded-lg border border-foreground/15 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[#c9a563]" />
                <span className="font-semibold text-sm">
                  匯入完成 {result.imported} / {result.total}
                  <span className="ml-2 text-xs text-foreground/55">
                    （{(result.durationMs / 1000).toFixed(1)} 秒）
                  </span>
                </span>
              </div>
              {result.queued > 0 && (
                <div className="flex items-center gap-2 text-xs text-foreground/70">
                  <Sparkles className="h-3.5 w-3.5 text-[#c9a563]" />
                  已排隊 {result.queued} 筆背景 LLM 升級
                </div>
              )}
              {result.failed > 0 && (
                <div className="flex items-center gap-2 text-xs text-red-600">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {result.failed} 筆失敗（檢查 fly logs 詳情）
                </div>
              )}
              {/* List successful imports */}
              <div className="max-h-40 overflow-y-auto text-xs space-y-1 mt-2 pt-2 border-t border-foreground/10">
                {(result.results || [])
                  .filter((r: any) => r.success)
                  .slice(0, 10)
                  .map((r: any) => (
                    <div key={r.tourId} className="flex items-baseline gap-2">
                      <span className="text-foreground/55 tabular-nums">#{r.tourId}</span>
                      <span className="truncate flex-1">{r.title}</span>
                      <span className="text-foreground/45">
                        {r.destinationCountry} · {r.durationDays}日
                      </span>
                    </div>
                  ))}
                {result.results?.filter((r: any) => r.success).length > 10 && (
                  <div className="text-foreground/55 italic">
                    ...另 {result.results.filter((r: any) => r.success).length - 10} 筆
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={isRunning}
            onClick={() => {
              setResult(null);
              onOpenChange(false);
            }}
            className="rounded-lg"
          >
            {result ? "關閉" : "取消"}
          </Button>
          <Button
            onClick={handleStart}
            disabled={isRunning || !categoryPath}
            className="bg-foreground text-white hover:bg-foreground/85 rounded-lg"
          >
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                匯入中...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2 text-[#c9a563]" />
                {result ? "再匯入一批" : "開始匯入"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
