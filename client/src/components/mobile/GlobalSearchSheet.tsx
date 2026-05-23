/**
 * Global mobile search sheet — Mobile Phase 3 (2026-05-22).
 *
 * Fullscreen modal triggered by the 🔍 button in MobileShell header.
 * Searches tours / customers / bookings via trpc.globalSearch.search.
 * Empty state shows recent contacts from the last 7 days.
 *
 * Designed for one-handed thumb use — autofocused input, large tap
 * targets, native phone/SMS/WeChat/email deeplinks.
 */

import { useEffect, useState } from "react";
import { X, Search, Phone, MessageCircle, Mail, MapPin, User, Receipt } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

export default function GlobalSearchSheet({
  open,
  onClose,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
}) {
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 250);

  const search = trpc.globalSearch.search.useQuery(
    { q: debouncedQ },
    { enabled: open && debouncedQ.trim().length > 0 },
  );
  const recent = trpc.globalSearch.recentContacts.useQuery(undefined, {
    enabled: open && debouncedQ.trim().length === 0,
  });

  // Reset on close
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  if (!open) return null;

  const empty = debouncedQ.trim().length === 0;
  const hasResults =
    !empty &&
    ((search.data?.tours.length ?? 0) +
      (search.data?.customers.length ?? 0) +
      (search.data?.bookings.length ?? 0)) >
      0;

  return (
    <div className="fixed inset-0 z-[60] bg-white flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 h-14 border-b border-gray-200 flex items-center gap-2 px-3">
        <Search className="w-5 h-5 text-gray-400 flex-shrink-0" />
        <input
          autoFocus
          type="search"
          placeholder="搜尋客人 / 行程 / 訂單..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1 h-10 text-base outline-none placeholder-gray-400"
        />
        <button
          type="button"
          onClick={onClose}
          className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-gray-100 active:bg-gray-200"
          aria-label="關閉"
        >
          <X className="w-5 h-5 text-gray-700" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {empty ? (
          <RecentContactsSection
            recent={recent.data ?? []}
            loading={recent.isLoading}
            onNavigate={onNavigate}
            onClose={onClose}
          />
        ) : search.isLoading ? (
          <div className="px-4 py-6 text-sm text-gray-400">搜尋中…</div>
        ) : !hasResults ? (
          <div className="px-4 py-6 text-sm text-gray-400">
            沒有結果 ＂{debouncedQ}＂
          </div>
        ) : (
          <SearchResults
            data={search.data!}
            onNavigate={onNavigate}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

function RecentContactsSection({
  recent,
  loading,
  onNavigate,
  onClose,
}: {
  recent: any[];
  loading: boolean;
  onNavigate: (path: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="px-4 py-3">
      <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">
        🔥 最近聯絡 (7 天內)
      </h2>
      {loading ? (
        <div className="text-sm text-gray-400 py-2">載入中…</div>
      ) : recent.length === 0 ? (
        <div className="text-sm text-gray-400 py-2">
          7 天內沒有客戶活動。試試直接搜尋姓名 / 電話 / Booking ID。
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {recent.map((c) => (
            <CustomerRow
              key={c.id}
              customer={c}
              onNavigate={() => {
                onClose();
                onNavigate("customers-landing");
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SearchResults({
  data,
  onNavigate,
  onClose,
}: {
  data: { tours: any[]; customers: any[]; bookings: any[] };
  onNavigate: (path: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="divide-y divide-gray-100">
      {data.tours.length > 0 && (
        <section className="px-4 py-3">
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5" />
            行程 ({data.tours.length})
          </h3>
          <ul className="space-y-2">
            {data.tours.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    window.location.href = `/tours/${t.id}`;
                  }}
                  className="w-full text-left p-2 rounded-lg hover:bg-gray-50 active:bg-gray-100"
                >
                  <div className="text-sm text-gray-900 font-medium truncate">
                    {t.title}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {t.destinationCountry} · {t.destinationCity ?? "—"} ·{" "}
                    {t.duration ?? "—"} · 評分 {t.originalityScore ?? "—"}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.customers.length > 0 && (
        <section className="px-4 py-3">
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2 flex items-center gap-1.5">
            <User className="w-3.5 h-3.5" />
            客戶 ({data.customers.length})
          </h3>
          <ul className="divide-y divide-gray-100">
            {data.customers.map((c) => (
              <CustomerRow
                key={c.id}
                customer={c}
                onNavigate={() => {
                  onClose();
                  onNavigate("customers-landing");
                }}
              />
            ))}
          </ul>
        </section>
      )}

      {data.bookings.length > 0 && (
        <section className="px-4 py-3">
          <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2 flex items-center gap-1.5">
            <Receipt className="w-3.5 h-3.5" />
            訂單 ({data.bookings.length})
          </h3>
          <ul className="space-y-2">
            {data.bookings.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onNavigate("bookings");
                  }}
                  className="w-full text-left p-2 rounded-lg hover:bg-gray-50 active:bg-gray-100"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-900 font-medium truncate">
                      #{b.id} · {b.customerName}
                    </span>
                    <span className="text-xs text-gray-500 tabular-nums">
                      ${b.totalPrice?.toLocaleString() ?? "?"}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {b.bookingStatus} ·{" "}
                    {b.createdAt
                      ? new Date(b.createdAt).toLocaleDateString("zh-TW")
                      : "—"}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CustomerRow({
  customer,
  onNavigate,
}: {
  customer: any;
  onNavigate: () => void;
}) {
  const displayName =
    customer.email || customer.wechatId || customer.phone || `#${customer.id}`;
  const lang = customer.preferredLanguage ?? "zh-TW";
  const greeting =
    lang === "en"
      ? "Hi, this is Jeff from PACK&GO. Following up on your inquiry."
      : "您好,我是 PACK&GO 的 Jeff,跟進您的詢問。";

  return (
    <li className="py-2">
      <div className="flex items-center justify-between gap-2 mb-1">
        <button
          type="button"
          onClick={onNavigate}
          className="text-left flex-1 min-w-0"
        >
          <div className="text-sm text-gray-900 font-medium truncate">
            {displayName}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            VIP {customer.vipScore ?? 0} · {lang}
            {customer.lastInteractionAt && (
              <>
                {" · "}
                {new Date(customer.lastInteractionAt).toLocaleDateString("zh-TW")}
              </>
            )}
          </div>
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        {customer.phone && (
          <a
            href={`tel:${customer.phone}`}
            className="flex-1 h-8 flex items-center justify-center gap-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium active:bg-emerald-100"
          >
            <Phone className="w-3.5 h-3.5" /> 撥打
          </a>
        )}
        {customer.phone && (
          <a
            href={`sms:${customer.phone}?body=${encodeURIComponent(greeting)}`}
            className="flex-1 h-8 flex items-center justify-center gap-1 rounded-lg bg-blue-50 text-blue-700 text-xs font-medium active:bg-blue-100"
          >
            <MessageCircle className="w-3.5 h-3.5" /> SMS
          </a>
        )}
        {customer.wechatId && (
          <a
            href={`weixin://dl/chat?${encodeURIComponent(customer.wechatId)}`}
            className="flex-1 h-8 flex items-center justify-center gap-1 rounded-lg bg-green-50 text-green-700 text-xs font-medium active:bg-green-100"
          >
            <MessageCircle className="w-3.5 h-3.5" /> WeChat
          </a>
        )}
        {customer.email && (
          <a
            href={`mailto:${customer.email}?subject=${encodeURIComponent("Re: PACK&GO 行程")}&body=${encodeURIComponent(greeting)}`}
            className="flex-1 h-8 flex items-center justify-center gap-1 rounded-lg bg-slate-50 text-slate-700 text-xs font-medium active:bg-slate-100"
          >
            <Mail className="w-3.5 h-3.5" /> Email
          </a>
        )}
      </div>
    </li>
  );
}
