import { useState, useRef, useEffect } from "react"
import { useLocale } from "@/contexts/LocaleContext"
import CustomerList from "@/components/admin/customers/CustomerList"
import CustomerDetail from "@/components/admin/customers/CustomerDetail"
import CustomerChat from "@/components/admin/customers/CustomerChat"
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
  const chatFocusRef = useRef<((prefill?: string) => void) | null>(null)
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
    approveDraft,
    isApprovingDraft,
  } = useCustomerData(selected, showHidden, activeProjectId)

  // Default to the newest project when the customer or their project set
  // changes; no projects → 未分類 (null). Keyed on the project ids so a manual
  // pick survives a background refetch (e.g. rename, which keeps the same ids),
  // and a just-created order (new id) jumps the bar to it.
  const projectIdsKey = projects.map((p) => p.id).join(",")
  useEffect(() => {
    setActiveProjectId(projects[0]?.id ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.kind, projectIdsKey])

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
          onAddCustomer={() => chatFocusRef.current?.(t("admin.customers.drafts.addCustomerPrefill"))}
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
              onFocusReady={(fn) => { chatFocusRef.current = fn }}
            />
          )}
        </>
      ) : (
        <>
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
            {t("admin.customers.selectCustomer")}
          </div>
          <CustomerChat
            customer={null}
            chatMessages={[]}
            onApproveDraft={async () => {}}
            isApprovingDraft={false}
            onFocusReady={(fn) => { chatFocusRef.current = fn }}
          />
        </>
      )}
    </div>
  )
}
