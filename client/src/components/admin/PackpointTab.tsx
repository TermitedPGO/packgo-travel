/**
 * PackpointTab — Round 80.22 Phase C admin panel for the loyalty system.
 *
 * Three things in one place:
 *   1. Manual adjust: comp customers, give promo points, claw back fraud.
 *      Search user → input ± delta → reason → submit. Audited.
 *   2. Trigger maintenance: button to fire the daily cron (auto-upgrade,
 *      expiry, birthday) on demand for testing without waiting.
 *   3. Recent transactions across all users (visibility into what's happening).
 *
 * Permissions: adminProcedure on the server enforces this.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Coins, RefreshCw, ArrowUpRight, ArrowDownRight, Loader2, Search } from "lucide-react";

export default function PackpointTab() {
  const [searchEmail, setSearchEmail] = useState("");
  const [foundUser, setFoundUser] = useState<{
    id: number;
    email: string;
    name: string | null;
    tier: string;
    balance: number;
    lifetime: number;
  } | null>(null);
  const [adjustDelta, setAdjustDelta] = useState<number>(0);
  const [adjustReason, setAdjustReason] = useState<string>("");
  const [isSearching, setIsSearching] = useState(false);

  const adminLookupQuery = trpc.admin.lookupUserByEmail.useQuery(
    { email: searchEmail.trim() },
    { enabled: false, retry: false }
  );

  const adjustMutation = trpc.packpoint.adminAdjust.useMutation({
    onSuccess: (res) => {
      toast.success(`調整完成 — 新餘額 ${res.newBalance.toLocaleString()} pts`);
      setAdjustDelta(0);
      setAdjustReason("");
      // Refetch user balance
      handleSearch();
    },
    onError: (e) => toast.error(e.message),
  });

  const triggerMutation = trpc.packpoint.adminTriggerMaintenance.useMutation({
    onSuccess: (res) => toast.success(`Maintenance job queued (id: ${res.jobId})`),
    onError: (e) => toast.error(e.message),
  });

  const handleSearch = async () => {
    if (!searchEmail.trim()) {
      toast.error("輸入 email 才能搜尋");
      return;
    }
    setIsSearching(true);
    try {
      const result = await adminLookupQuery.refetch();
      if (result.data) {
        setFoundUser(result.data);
      } else {
        setFoundUser(null);
        toast.error("找不到此用戶");
      }
    } catch (err: any) {
      toast.error(err.message || "搜尋失敗");
      setFoundUser(null);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Coins className="h-6 w-6 text-[#c9a563]" />
            Packpoint 管理
          </h2>
          <p className="text-sm text-foreground/60 mt-1">
            手動調整用戶點數 / 觸發每日維護(自動升級 / 過期 / 生日)
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => triggerMutation.mutate()}
          disabled={triggerMutation.isPending}
          className="rounded-lg"
        >
          {triggerMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          手動觸發每日維護
        </Button>
      </div>

      {/* User search + adjust */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">手動調整用戶 Packpoint</CardTitle>
          <p className="text-xs text-foreground/60">
            正數 = 加點(comp / 補償 / 行銷送點)·  負數 = 扣點(欺詐回收 / 失誤更正)
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Step 1: search user */}
          <div className="flex gap-2">
            <Input
              type="email"
              value={searchEmail}
              onChange={(e) => setSearchEmail(e.target.value)}
              placeholder="輸入用戶 email"
              className="flex-1 rounded-lg"
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <Button
              onClick={handleSearch}
              disabled={isSearching || !searchEmail.trim()}
              className="rounded-lg"
            >
              {isSearching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Step 2: show user + adjust form */}
          {foundUser && (
            <div className="border border-foreground/10 rounded-xl p-4 bg-foreground/[0.02] space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-xs text-foreground/50 uppercase">用戶</p>
                  <p className="font-semibold">{foundUser.name || "—"}</p>
                  <p className="text-xs text-foreground/60">{foundUser.email}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground/50 uppercase">等級</p>
                  <p className="font-semibold capitalize">{foundUser.tier}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground/50 uppercase">當前餘額</p>
                  <p className="font-bold text-[#8a6f3a] text-lg tabular-nums">
                    {foundUser.balance.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-foreground/50 uppercase">累計賺得</p>
                  <p className="font-bold tabular-nums">{foundUser.lifetime.toLocaleString()}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="delta">調整點數(±)</Label>
                  <Input
                    id="delta"
                    type="number"
                    value={adjustDelta || ""}
                    onChange={(e) => setAdjustDelta(parseInt(e.target.value, 10) || 0)}
                    placeholder="例:500 或 -100"
                    className="mt-1 rounded-lg tabular-nums"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="reason">原因(會寫進 audit log)</Label>
                  <Input
                    id="reason"
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    placeholder="例:VIP 補償 / 推薦獎勵手動發放 / 行銷活動"
                    className="mt-1 rounded-lg"
                    maxLength={500}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Button
                  onClick={() =>
                    adjustMutation.mutate({
                      userId: foundUser.id,
                      delta: adjustDelta,
                      description: adjustReason,
                    })
                  }
                  disabled={
                    adjustMutation.isPending ||
                    adjustDelta === 0 ||
                    adjustReason.length < 3
                  }
                  className="rounded-lg bg-[#c9a563] hover:bg-[#d4b478] text-foreground"
                >
                  {adjustMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : adjustDelta > 0 ? (
                    <ArrowUpRight className="h-4 w-4 mr-2" />
                  ) : (
                    <ArrowDownRight className="h-4 w-4 mr-2" />
                  )}
                  確認 {adjustDelta > 0 ? "加" : adjustDelta < 0 ? "扣" : ""}{" "}
                  {Math.abs(adjustDelta || 0).toLocaleString()} 點
                </Button>
                {adjustDelta !== 0 && (
                  <span className="text-sm text-foreground/60">
                    調整後餘額預計:
                    <span className="font-semibold text-foreground ml-1">
                      {Math.max(0, foundUser.balance + adjustDelta).toLocaleString()} pts
                    </span>
                  </span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">說明</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-foreground/70 space-y-2">
          <p>· <strong>每日維護</strong>(02:00 UTC / 10:00 Taipei)自動跑:</p>
          <ul className="list-disc list-inside ml-4 space-y-1 text-xs">
            <li>檢查所有 Free 用戶 — 12 個月累積消費 ≥ $5,000 → 升 Plus 1 年</li>
            <li>檢查所有 Plus 用戶 — 12 個月累積消費 ≥ $20,000 → 升 Concierge 1 年</li>
            <li>清空 18 個月以上沒活動的點數</li>
            <li>當天生日的用戶 +100 Packpoint(每年只發一次)</li>
          </ul>
          <p>· 想立刻測試 → 點右上「手動觸發每日維護」</p>
          <p>· 所有調整都會留 audit log,客人查歷史時看得到</p>
        </CardContent>
      </Card>
    </div>
  );
}
