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
  guestToAdaptedCustomer,
} from "./adapters"

/** Which row is selected — id alone is ambiguous (a profileId can collide with a
 *  userId), so kind decides which routes to hit and how to read the id. */
export type Selection = { id: number; kind: "user" | "guest" }

export function useCustomerData(selected: Selection | null, showHidden = false) {
  const { t, language } = useLocale()
  const utils = trpc.useUtils()
  const formatDate = (d: Date) => format(new Date(d), "M/d")

  const tagLabels: Record<string, string> = {
    active: t("admin.customers.tagActive"),
    inquiry: t("admin.customers.tagInquiry"),
    pending: t("admin.customers.tagPending"),
  }

  const customerListQ = trpc.admin.customerList.useQuery({ includeHidden: showHidden })
  const guestListQ = trpc.admin.guestList.useQuery({ includeHidden: showHidden })

  const invalidateLists = () => {
    void utils.admin.customerList.invalidate()
    void utils.admin.guestList.invalidate()
  }
  const markNotCustomer = trpc.admin.markNotCustomer.useMutation({ onSuccess: invalidateLists })
  const restoreCustomer = trpc.admin.restoreCustomer.useMutation({ onSuccess: invalidateLists })

  // Resolve the selection into the two id spaces. A guest's id is a profileId, a
  // registered customer's id is a userId — never cross them.
  const userId = selected?.kind === "user" ? selected.id : null
  const profileId = selected?.kind === "guest" ? selected.id : null

  const detailQ = trpc.admin.customerDetail.useQuery(
    { userId: userId! },
    { enabled: userId !== null },
  )
  const openItemsQ = trpc.admin.customerOpenItems.useQuery(
    { userId: userId! },
    { enabled: userId !== null },
  )
  const profileQ = trpc.admin.customerProfileData.useQuery(
    { userId: userId! },
    { enabled: userId !== null },
  )
  const guestOpenItemsQ = trpc.admin.guestOpenItems.useQuery(
    { profileId: profileId! },
    { enabled: profileId !== null },
  )
  const userChatQ = trpc.admin.customerConversationThread.useQuery(
    { userId: userId! },
    { enabled: userId !== null },
  )
  const guestChatQ = trpc.admin.customerConversationThread.useQuery(
    { profileId: profileId! },
    { enabled: profileId !== null },
  )
  const chatQ = selected?.kind === "guest" ? guestChatQ : userChatQ

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
        blocked: g.blocked ?? false,
      }
    })

    return [...users, ...guests]
  }, [customerListQ.data, guestListQ.data, language])

  const detail = useMemo<AdaptedCustomer | null>(() => {
    if (selected === null) return null

    // Guest: build the detail from inquiries (no user row exists).
    if (selected.kind === "guest") {
      const g = guestOpenItemsQ.data
      if (!g?.email) return null
      return guestToAdaptedCustomer(
        {
          profileId: selected.id,
          email: g.email,
          inquiries: g.inquiries.map((i) => ({
            id: i.id,
            subject: i.subject,
            status: i.status,
            createdAt: i.createdAt,
          })),
        },
        t,
      )
    }

    // Registered customer.
    const d = detailQ.data
    if (!d?.user) return null

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
  }, [
    selected,
    detailQ.data,
    openItemsQ.data,
    profileQ.data,
    guestOpenItemsQ.data,
    language,
  ])

  const chatMessages = useMemo<ChatMessage[]>(() => {
    return (chatQ.data?.messages ?? []).map((m) => ({
      id: m.id,
      senderRole: m.senderRole,
      body: m.body,
      context: m.context,
      createdAt: new Date(m.createdAt),
    }))
  }, [chatQ.data])

  const isDetailLoading =
    selected?.kind === "guest" ? guestOpenItemsQ.isLoading : detailQ.isLoading

  return {
    customers,
    isListLoading: customerListQ.isLoading || guestListQ.isLoading,
    detail,
    isDetailLoading,
    chatMessages,
    isChatLoading: chatQ.isLoading,
    markNotCustomer: (item: Selection) =>
      markNotCustomer.mutate(
        item.kind === "guest" ? { profileId: item.id } : { userId: item.id },
      ),
    restoreCustomer: (item: Selection) =>
      restoreCustomer.mutate(
        item.kind === "guest" ? { profileId: item.id } : { userId: item.id },
      ),
  }
}
