import { useState } from "react"
import { useLocale } from "@/contexts/LocaleContext"
import CustomerList from "@/components/admin/customers/CustomerList"
import CustomerDetail from "@/components/admin/customers/CustomerDetail"
import CustomerChat from "@/components/admin/customers/CustomerChat"
import AddCustomerDialog from "@/components/admin/customers/AddCustomerDialog"
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
  const [addOpen, setAddOpen] = useState(false)
  const {
    customers,
    isListLoading,
    detail,
    isDetailLoading,
    chatMessages,
    conversationMessages,
    isChatLoading,
    markNotCustomer,
    restoreCustomer,
    createManualCustomer,
    isCreating,
    approveDraft,
    isApprovingDraft,
  } = useCustomerData(selected, showHidden)

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
          onAddCustomer={() => setAddOpen(true)}
        />
      )}
      {selected !== null ? (
        <>
          {isDetailLoading ? (
            <div className="flex-1">
              <CustomerDetailSkeleton />
            </div>
          ) : detail ? (
            <CustomerDetail customer={detail} chatMessages={conversationMessages} />
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
              onApproveDraft={approveDraft}
              isApprovingDraft={isApprovingDraft}
            />
          )}
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
          {t("admin.customers.selectCustomer")}
        </div>
      )}
      <AddCustomerDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreate={createManualCustomer}
        isCreating={isCreating}
      />
    </div>
  )
}
