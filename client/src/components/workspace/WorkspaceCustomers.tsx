/**
 * WorkspaceCustomers — 整合工作台 客戶清單 (P2).
 *
 * Master-detail: customer list (left) + the selected customer's inbox
 * (right). Reuses admin.customerList for the roster and CustomerInbox for
 * the per-customer worklist. Per-row open-count badges land in P2.1
 * (needs a batched open-count query).
 */
import { useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import { LoadingPage } from "@/components/ui/spinner";
import CustomerInbox from "./CustomerInbox";

export default function WorkspaceCustomers() {
  const { t } = useLocale();
  const list = trpc.admin.customerList.useQuery();
  const [selected, setSelected] = useState<number | null>(null);
  const [q, setQ] = useState("");

  const rows = (list.data ?? []).filter((c) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (
      (c.name || "").toLowerCase().includes(s) ||
      (c.email || "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="flex h-full">
      {/* customer list */}
      <div className="w-72 flex-shrink-0 border-r border-gray-200 flex flex-col">
        <div className="p-3 border-b border-gray-100 flex-shrink-0">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("workspace.searchCustomers")}
            className="w-full h-8 px-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-gray-400"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {list.isLoading ? (
            <div className="p-6">
              <LoadingPage text={t("workspace.loading")} />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">
              {t("workspace.noCustomers")}
            </div>
          ) : (
            rows.map((c) => {
              const on = selected === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelected(c.id)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2.5 ${
                    on ? "bg-gray-100" : "hover:bg-gray-50"
                  }`}
                >
                  <div className="h-7 w-7 rounded-full bg-gray-200 text-gray-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                    {(c.name || c.email || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">
                      {c.name || c.email}
                    </div>
                    <div className="text-[11px] text-gray-400 truncate">
                      {c.email}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* selected customer inbox */}
      <div className="flex-1 min-w-0">
        {selected == null ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">
            {t("workspace.selectCustomer")}
          </div>
        ) : (
          <CustomerInbox userId={selected} />
        )}
      </div>
    </div>
  );
}
