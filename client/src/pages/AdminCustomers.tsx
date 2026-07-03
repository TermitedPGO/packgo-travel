import { useState } from "react"
import { useLocale } from "@/contexts/LocaleContext"
import CustomerList from "@/components/admin/customers/CustomerList"
import CustomerDetail from "@/components/admin/customers/CustomerDetail"
import CustomerChat from "@/components/admin/customers/CustomerChat"
import TodayList from "@/components/admin/customers/TodayList"
import { useCustomerData, type Selection } from "@/components/admin/customers/useCustomerData"
import {
  CustomerListSkeleton,
  CustomerDetailSkeleton,
  CustomerChatSkeleton,
} from "@/components/admin/customers/Skeletons"

export default function AdminCustomers() {
  const { t } = useLocale()
  const [selected, setSelected] = useState<Selection | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  // customer-projects (0104) — the active project (=customOrder). null =「未分類」.
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null)
  const {
    customers,
    isListLoading,
    detail,
    isDetailLoading,
    projects,
    chatMessages,
    conversationMessages,
    isChatLoading,
    markNotCustomer,
    restoreCustomer,
    deleteGuest,
    approveDraft,
    isApprovingDraft,
  } = useCustomerData(selected, showHidden, activeProjectId)

  // 訪客刪除 — the deleted row may be the open one; drop the selection so the
  // detail pane never keeps rendering a customer that no longer exists.
  const handleDeleteGuest = (profileId: number) => {
    deleteGuest(profileId)
    if (selected?.kind === "guest" && selected.id === profileId) setSelected(null)
  }

  // Default to the newest project when the customer or their project set
  // changes; no projects → 未分類 (null). Keyed on the project ids so a manual
  // pick survives a background refetch (e.g. rename, which keeps the same ids),
  // and a just-created order (new id) jumps the bar to it.
  //
  // Runs DURING render behind a prev-key guard (React's adjust-state-on-props
  // pattern), NOT in a useEffect: the effect version ran after paint, so one
  // committed frame still carried the PREVIOUS customer's activeProjectId —
  // OverviewTab hit the React Query cache with that stale orderId and flashed
  // the previous customer's 售價/已收 facts card on the new customer (P3 防閃).
  // React re-renders synchronously on the render-phase setState, so no frame
  // with the stale id ever commits.
  const projectIdsKey = projects.map((p) => p.id).join(",")
  const resetKey = `${selected?.kind ?? "none"}:${selected?.id ?? "none"}:${projectIdsKey}`
  const [prevResetKey, setPrevResetKey] = useState<string | null>(null)
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey)
    setActiveProjectId(projects[0]?.id ?? null)
  }

  return (
    <div className="h-full flex">
      {isListLoading ? (
        <div className="w-[300px] flex-shrink-0 border-r border-gray-200">
          <CustomerListSkeleton />
        </div>
      ) : (
        <CustomerList
          customers={customers}
          selected={selected}
          onSelect={setSelected}
          showHidden={showHidden}
          onToggleHidden={setShowHidden}
          onMarkNotCustomer={markNotCustomer}
          onRestoreCustomer={restoreCustomer}
          onDeleteGuest={handleDeleteGuest}
        />
      )}
      {selected !== null ? (
        <>
          {isDetailLoading ? (
            <div className="flex-1">
              <CustomerDetailSkeleton />
            </div>
          ) : detail ? (
            <CustomerDetail
              customer={detail}
              chatMessages={conversationMessages}
              projects={projects}
              activeProjectId={activeProjectId}
              onSelectProject={setActiveProjectId}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
              {t("admin.customers.selectCustomer")}
            </div>
          )}
          {isChatLoading ? (
            <div className="w-[340px] border-l border-gray-200">
              <CustomerChatSkeleton />
            </div>
          ) : (
            <CustomerChat
              customer={detail}
              chatMessages={chatMessages}
              activeProjectId={activeProjectId}
              onApproveDraft={approveDraft}
              isApprovingDraft={isApprovingDraft}
            />
          )}
        </>
      ) : (
        <>
          <TodayList onSelect={setSelected} />
          <CustomerChat
            customer={null}
            chatMessages={[]}
            onApproveDraft={async () => {}}
            isApprovingDraft={false}
          />
        </>
      )}
    </div>
  )
}
