import { useMemo } from "react"
import { trpc } from "@/lib/trpc"
import { useLocale } from "@/contexts/LocaleContext"
import { format } from "date-fns"
import type { ListItem, AdaptedCustomer, ChatMessage } from "./types"
import {
  toListItem,
  toOrders,
  toTimeline,
  deriveStatus,
  deriveAiSummary,
  deriveProfile,
  deriveInitials,
  deriveAvatar,
} from "./adapters"

export function useCustomerData(selectedId: number | null, showHidden = false) {
  const { t, language } = useLocale()
  const utils = trpc.useUtils()
  const formatDate = (d: Date) =>
    format(new Date(d), "M/d")

  const tagLabels: Record<string, string> = {
    active: t("admin.customers.tagActive"),
    inquiry: t("admin.customers.tagInquiry"),
    pending: t("admin.customers.tagPending"),
  }

  const customerListQ = trpc.admin.customerList.useQuery({ includeHidden: showHidden })
  const guestListQ = trpc.admin.guestList.useQuery()

  const invalidateList = () => {
    void utils.admin.customerList.invalidate()
  }
  const markNotCustomer = trpc.admin.markNotCustomer.useMutation({ onSuccess: invalidateList })
  const restoreCustomer = trpc.admin.restoreCustomer.useMutation({ onSuccess: invalidateList })

  const detailQ = trpc.admin.customerDetail.useQuery(
    { userId: selectedId! },
    { enabled: selectedId !== null },
  )
  const openItemsQ = trpc.admin.customerOpenItems.useQuery(
    { userId: selectedId! },
    { enabled: selectedId !== null },
  )
  const profileQ = trpc.admin.customerProfileData.useQuery(
    { userId: selectedId! },
    { enabled: selectedId !== null },
  )
  const chatQ = trpc.admin.customerConversationThread.useQuery(
    { userId: selectedId! },
    { enabled: selectedId !== null },
  )

  const customers = useMemo<ListItem[]>(() => {
    const users = (customerListQ.data ?? []).map((u) =>
      toListItem(
        {
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone,
          bookingCount: u.bookingCount,
          inquiryCount: u.inquiryCount,
          lastSignedIn: u.lastSignedIn,
          blocked: u.blocked,
        },
        tagLabels,
        formatDate,
      ),
    )

    const guests = (guestListQ.data ?? []).map((g) => {
      const avatar = deriveAvatar(g.profileId)
      const emailName = g.email?.split("@")[0] ?? ""
      return {
        id: g.profileId,
        kind: "guest" as const,
        name: emailName,
        email: g.email ?? "",
        phone: "",
        initials: deriveInitials(null, g.email ?? "?"),
        ...avatar,
        lastContact: g.updatedAt ? formatDate(new Date(g.updatedAt)) : "",
        tag: "inquiry" as const,
        tagLabel: tagLabels.inquiry ?? "",
        notifs: 0,
        blocked: false,
      }
    })

    return [...users, ...guests]
  }, [customerListQ.data, guestListQ.data, language])

  const detail = useMemo<AdaptedCustomer | null>(() => {
    const d = detailQ.data
    if (!d?.user || selectedId === null) return null

    const avatar = deriveAvatar(d.user.id)
    const status = deriveStatus(openItemsQ.data ?? null, t)
    const aiSummary = deriveAiSummary(d, openItemsQ.data ?? null, t)
    const profile = deriveProfile(
      { totalSpend: d.user.totalSpend, bookingCount: d.user.bookingCount },
      profileQ.data ?? null,
      t,
    )
    const orders = toOrders(d.recentBookings)
    const timeline = toTimeline(
      d.recentBookings,
      d.recentInquiries,
      d.recentPoints,
    )

    return {
      id: d.user.id,
      kind: "user",
      name: d.user.name ?? d.user.email.split("@")[0],
      email: d.user.email,
      phone: d.user.phone ?? "",
      initials: deriveInitials(d.user.name, d.user.email),
      ...avatar,
      aiSummary,
      status,
      drafts: [],
      profile,
      orders,
      docs: [],
      timeline,
    }
  }, [detailQ.data, openItemsQ.data, profileQ.data, selectedId, language])

  const chatMessages = useMemo<ChatMessage[]>(() => {
    return (chatQ.data?.messages ?? []).map((m) => ({
      id: m.id,
      senderRole: m.senderRole,
      body: m.body,
      context: m.context,
      createdAt: new Date(m.createdAt),
    }))
  }, [chatQ.data])

  return {
    customers,
    isListLoading: customerListQ.isLoading,
    detail,
    isDetailLoading: detailQ.isLoading,
    chatMessages,
    isChatLoading: chatQ.isLoading,
    markNotCustomer: (userId: number) => markNotCustomer.mutate({ userId }),
    restoreCustomer: (userId: number) => restoreCustomer.mutate({ userId }),
  }
}
