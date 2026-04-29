/**
 * InboxTab — v78z-z3 Sprint 9: unified queue across 3 customer-message
 * channels (Web inquiry / WeChat / AI Quote follow-up).
 *
 * Per UX audit: solo founder needs ONE inbox, not three. Falling behind on
 * any single channel costs a $5-15K booking. This tab merges the queues with
 * a channel filter + sort by recency. Each row links to the original
 * detail tab so existing approve/reply workflows still work.
 *
 * Data sources:
 *   - trpc.inquiries.list — website contact form
 *   - trpc.wechatAssist.listPending — WeChat drafts ready for review
 *   - trpc.aiQuotes.adminList(status=generated) — new quotes to follow up
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { MessageSquare, Sparkles, AlertCircle, Globe, ArrowRight, Clock, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";

type Channel = "all" | "web" | "wechat" | "quote";
type SlaLevel = "fresh" | "warn" | "urgent"; // <12h / 12-24h / >24h

type InboxItem = {
  id: string;
  channel: "web" | "wechat" | "quote";
  channelLabel: string;
  channelBg: string;
  channelText: string;
  channelIcon: typeof MessageSquare;
  customerName: string;
  preview: string;
  createdAt: Date | null;
  targetTab: string; // admin tab to navigate to
  sla: SlaLevel;
};

interface Props {
  onNavigate?: (tab: string) => void;
}

export default function InboxTab({ onNavigate }: Props = {}) {
  const { t, language } = useLocale();
  const [filter, setFilter] = useState<Channel>("all");

  const { data: inquiries, isLoading: l1 } = trpc.inquiries.list.useQuery();
  const { data: pendingWechat, isLoading: l2 } = trpc.wechatAssist.listPending.useQuery({ limit: 50 });
  const { data: pendingQuotes, isLoading: l3 } = trpc.aiQuotes.adminList.useQuery({
    status: "generated",
    limit: 50,
    offset: 0,
  });

  const isLoading = l1 || l2 || l3;
  const isEN = language === "en";

  const items: InboxItem[] = useMemo(() => {
    const list: InboxItem[] = [];
    const now = Date.now();
    // v78z-z3 Sprint 10 (C2): two-tier SLA per UX audit
    // <12h fresh · 12-24h warn (amber) · >24h urgent (red)
    const WARN_MS = 12 * 60 * 60 * 1000;
    const URGENT_MS = 24 * 60 * 60 * 1000;
    const slaLevel = (createdAt: Date | null): SlaLevel => {
      if (!createdAt) return "fresh";
      const age = now - createdAt.getTime();
      if (age > URGENT_MS) return "urgent";
      if (age > WARN_MS) return "warn";
      return "fresh";
    };

    // Web inquiries (only "new" status — others are handled)
    (inquiries || [])
      .filter((i: any) => i.status === "new")
      .forEach((i: any) => {
        const createdAt = i.createdAt ? new Date(i.createdAt) : null;
        list.push({
          id: `web-${i.id}`,
          channel: "web",
          channelLabel: t("inboxTab.channelWeb"),
          channelBg: "bg-amber-50 border-amber-200",
          channelText: "text-amber-700",
          channelIcon: Globe,
          customerName: i.name || i.email || "—",
          preview: i.subject || i.message?.slice(0, 80) || "",
          createdAt,
          targetTab: "inquiries",
          sla: slaLevel(createdAt),
        });
      });

    // WeChat drafts
    (pendingWechat || []).forEach((w: any) => {
      const createdAt = w.createdAt ? new Date(w.createdAt) : null;
      list.push({
        id: `wechat-${w.id}`,
        channel: "wechat",
        channelLabel: t("inboxTab.channelWechat"),
        channelBg: "bg-emerald-50 border-emerald-200",
        channelText: "text-emerald-700",
        channelIcon: MessageSquare,
        customerName: w.customerName || w.fromName || "—",
        preview: (w.aiDraftReply || w.inboundText || "").slice(0, 100),
        createdAt,
        targetTab: "wechat-assist",
        sla: slaLevel(createdAt),
      });
    });

    // AI Quote follow-ups
    (pendingQuotes || []).forEach((q: any) => {
      const createdAt = q.createdAt ? new Date(q.createdAt) : null;
      list.push({
        id: `quote-${q.id}`,
        channel: "quote",
        channelLabel: t("inboxTab.channelQuote"),
        channelBg: "bg-blue-50 border-blue-200",
        channelText: "text-blue-700",
        channelIcon: Sparkles,
        customerName: q.customerName || q.contactEmail || "—",
        preview: q.rawRequest?.slice(0, 100) || "",
        createdAt,
        targetTab: "ai-quotes",
        sla: slaLevel(createdAt),
      });
    });

    // Sort: urgent (red) → warn (amber) → fresh, then by recency desc
    const slaPriority: Record<SlaLevel, number> = { urgent: 0, warn: 1, fresh: 2 };
    list.sort((a, b) => {
      const da = slaPriority[a.sla];
      const db = slaPriority[b.sla];
      if (da !== db) return da - db;
      const ta = a.createdAt?.getTime() || 0;
      const tb = b.createdAt?.getTime() || 0;
      return tb - ta;
    });

    return list;
  }, [inquiries, pendingWechat, pendingQuotes, t]);

  const filtered = filter === "all" ? items : items.filter((i) => i.channel === filter);
  const counts = {
    all: items.length,
    web: items.filter((i) => i.channel === "web").length,
    wechat: items.filter((i) => i.channel === "wechat").length,
    quote: items.filter((i) => i.channel === "quote").length,
  };

  const fmtTime = (d: Date | null) => {
    if (!d) return "—";
    const diffMs = Date.now() - d.getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    if (hours < 1) return t("inboxTab.justNow");
    if (hours < 24) return t("inboxTab.hoursAgo", { n: String(hours) });
    const days = Math.floor(hours / 24);
    return t("inboxTab.daysAgo", { n: String(days) });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{t("inboxTab.title")}</h2>
          <p className="text-sm text-gray-500 mt-1">{t("inboxTab.subtitle")}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-gray-900 tabular-nums">{items.length}</p>
          <p className="text-xs text-gray-500 uppercase tracking-wide">{t("inboxTab.totalLabel")}</p>
        </div>
      </div>

      {/* Channel filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-4 w-4 text-gray-400 mr-1" />
        {([
          { key: "all", label: t("inboxTab.filterAll"), count: counts.all },
          { key: "web", label: t("inboxTab.channelWeb"), count: counts.web },
          { key: "wechat", label: t("inboxTab.channelWechat"), count: counts.wechat },
          { key: "quote", label: t("inboxTab.channelQuote"), count: counts.quote },
        ] as const).map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`
              px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2
              ${filter === f.key
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }
            `}
          >
            <span>{f.label}</span>
            <span
              className={`
                text-xs px-1.5 py-0.5 rounded-full tabular-nums
                ${filter === f.key ? "bg-white/20 text-white" : "bg-white text-gray-600"}
              `}
            >
              {f.count}
            </span>
          </button>
        ))}
      </div>

      {/* Queue */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Clock className="h-8 w-8 mx-auto text-gray-300 mb-3 animate-pulse" />
          <p className="text-sm text-gray-500">{t("common.loading")}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <AlertCircle className="h-8 w-8 mx-auto text-emerald-300 mb-3" />
          <p className="text-sm text-gray-500">
            {filter === "all" ? t("inboxTab.emptyAll") : t("inboxTab.emptyChannel")}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
          {filtered.map((item) => {
            const Icon = item.channelIcon;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate?.(item.targetTab)}
                className="w-full flex items-start gap-4 p-4 hover:bg-gray-50 transition-colors text-left group"
              >
                {/* Channel badge */}
                <div className={`flex-shrink-0 w-10 h-10 rounded-xl ${item.channelBg} ${item.channelText} flex items-center justify-center border`}>
                  <Icon className="h-5 w-5" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-bold uppercase tracking-wide ${item.channelText}`}>
                      {item.channelLabel}
                    </span>
                    {item.sla === "urgent" && (
                      <span className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-md">
                        {t("inboxTab.urgent")}
                      </span>
                    )}
                    {item.sla === "warn" && (
                      <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md">
                        {t("inboxTab.warn")}
                      </span>
                    )}
                    <span className="text-xs text-gray-400">·</span>
                    <span className="text-xs text-gray-500">{fmtTime(item.createdAt)}</span>
                  </div>
                  <p className="text-sm font-semibold text-gray-900 mb-0.5 truncate">
                    {item.customerName}
                  </p>
                  <p className="text-sm text-gray-600 line-clamp-1">{item.preview || "—"}</p>
                </div>

                {/* Arrow */}
                <ArrowRight className="h-4 w-4 text-gray-300 flex-shrink-0 mt-3 group-hover:text-gray-600 transition-colors" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
