/**
 * Customer profile lookup — search by email / phone / wechatId and view
 * the cross-channel merged record + last 20 interactions
 * (Phase 5 module 5B).
 */
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Search, Users } from "lucide-react";

export function CustomerProfileLookup({
  search,
  setSearch,
}: {
  search: string;
  setSearch: (v: string) => void;
}) {
  const trimmed = search.trim();
  const isEmail = trimmed.includes("@");
  const isPhone = /^\+?[\d\s\-]{6,}$/.test(trimmed);
  const findArgs =
    !trimmed || trimmed.length < 3
      ? null
      : isEmail
      ? { email: trimmed }
      : isPhone
      ? { phone: trimmed.replace(/\s+/g, "") }
      : { wechatId: trimmed };

  const found = trpc.agent.findProfile.useQuery(findArgs ?? {}, {
    enabled: !!findArgs,
  });

  const profileId = found.data?.id;
  const ctx = trpc.agent.getProfileWithContext.useQuery(
    { profileId: profileId ?? 0 },
    { enabled: !!profileId }
  );

  return (
    <Card className="rounded-xl">
      <CardHeader>
        <CardTitle className="text-lg font-bold flex items-center gap-2">
          <Users className="h-4 w-4" />
          客戶記憶查詢
        </CardTitle>
        <p className="text-xs text-gray-500 mt-1">
          支援 email / 電話 / wechatId — 跨頻道身份合併後的完整記憶。
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="cs@example.com 或 +1 510..."
            className="pl-9 rounded-lg"
          />
        </div>

        {!findArgs && (
          <p className="text-xs text-gray-400 italic">請輸入至少 3 個字符。</p>
        )}

        {findArgs && found.data === null && !found.isLoading && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>查無 profile — 第一次互動時 agent 會自動建立。</span>
          </div>
        )}

        {found.data && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="VIP 分數" value={found.data.vipScore} />
              <Stat
                label="總消費"
                value={`$${(found.data.totalSpend / 100).toFixed(0)}`}
              />
              <Stat label="預訂次數" value={found.data.bookingCount} />
              <Stat label="狀態" value={found.data.status} />
            </div>

            {found.data.aiNotes && (
              <Card className="rounded-lg bg-gray-50 border-gray-200">
                <CardContent className="p-3">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1 font-bold">
                    AI 觀察筆記
                  </p>
                  <p className="text-xs text-gray-700 whitespace-pre-wrap">
                    {found.data.aiNotes}
                  </p>
                </CardContent>
              </Card>
            )}

            {ctx.data && ctx.data.recentInteractions.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-gray-600 mb-2 uppercase tracking-wider">
                  最近 20 次互動
                </h4>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <Th>時間</Th>
                        <Th>頻道</Th>
                        <Th>方向</Th>
                        <Th>來源</Th>
                        <Th>情感</Th>
                        <Th>分類</Th>
                        <Th>內容摘要</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {ctx.data.recentInteractions.map((i: any) => (
                        <tr key={i.id}>
                          <Td>
                            {new Date(i.createdAt).toLocaleString("zh-TW", {
                              month: "numeric",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </Td>
                          <Td>{i.channel}</Td>
                          <Td>
                            {i.direction === "inbound" ? "← 客戶" : "→ AI"}
                          </Td>
                          <Td>{i.generatedBy ?? "—"}</Td>
                          <Td>{i.sentiment ?? "—"}</Td>
                          <Td>{i.classification ?? "—"}</Td>
                          <Td className="max-w-xs truncate">
                            {i.contentSummary ?? i.content.slice(0, 60)}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-3 py-2 whitespace-nowrap ${className}`}>{children}</td>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
        {label}
      </div>
      <div className="text-xl font-bold text-gray-900 tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}
