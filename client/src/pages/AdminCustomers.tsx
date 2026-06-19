import { useState } from "react"
import { useLocale } from "@/contexts/LocaleContext"
import CustomerList from "@/components/admin/customers/CustomerList"
import CustomerDetail from "@/components/admin/customers/CustomerDetail"
import CustomerChat from "@/components/admin/customers/CustomerChat"
import { useCustomerData } from "@/components/admin/customers/useCustomerData"
import {
  CustomerListSkeleton,
  CustomerDetailSkeleton,
  CustomerChatSkeleton,
} from "@/components/admin/customers/Skeletons"

export default function AdminCustomers() {
  const { t } = useLocale()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const { customers, isListLoading, detail, isDetailLoading, chatMessages, isChatLoading } =
    useCustomerData(selectedId)

  return (
    <div className="h-full flex">
      {isListLoading ? (
        <div className="w-[300px] flex-shrink-0 border-r border-gray-200">
          <CustomerListSkeleton />
        </div>
      ) : (
        <CustomerList
          customers={customers}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      )}
      {selectedId !== null ? (
        <>
          {isDetailLoading ? (
            <div className="flex-1">
              <CustomerDetailSkeleton />
            </div>
          ) : detail ? (
            <CustomerDetail customer={detail} chatMessages={chatMessages} />
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
            <CustomerChat customer={detail} chatMessages={chatMessages} />
          )}
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
          {t("admin.customers.selectCustomer")}
        </div>
      )}
    </div>
  )
}
