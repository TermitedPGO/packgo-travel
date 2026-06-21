import { useMemo } from "react"
import { trpc } from "@/lib/trpc"
import { useLocale } from "@/contexts/LocaleContext"
import { format } from "date-fns"
import type { ListItem, AdaptedCustomer, ChatMessage, Doc, Draft } from "./types"
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
  deriveFollowup,
  buildInquiryEditedPayload,
  OPEN_INQUIRY_STATUSES,
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
  const createManualCustomer = trpc.admin.createManualCustomer.useMutation({
    onSuccess: invalidateLists,
  })

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

  const userDocsQ = trpc.admin.customerDocs.useQuery(
    { userId: userId! },
    { enabled: userId !== null },
  )
  const guestDocsQ = trpc.admin.customerDocs.useQuery(
    { profileId: profileId! },
    { enabled: profileId !== null },
  )

  // Batch 2 — pending AI reply drafts for this customer (both stores, unified).
  const userDraftsQ = trpc.admin.customerDrafts.useQuery(
    { userId: userId! },
    { enabled: userId !== null },
  )
  const guestDraftsQ = trpc.admin.customerDrafts.useQuery(
    { profileId: profileId! },
    { enabled: profileId !== null },
  )

  // Approve→send reuses the EXISTING audited mutations, dispatched by source.
  const invalidateDrafts = () => {
    void utils.admin.customerDrafts.invalidate()
    void utils.admin.customerConversationThread.invalidate()
  }
  const approveInquiryDraft = trpc.commandCenter.approve.useMutation({
    onSuccess: invalidateDrafts,
  })
  const sendEscalationDraft = trpc.commandCenter.escalationReply.useMutation({
    onSuccess: invalidateDrafts,
  })

  /** Approve+send one draft. editedBody (optional) = Jeff's inline edit. */
  const approveDraft = async (draft: Draft, editedBody?: string) => {
    if (draft.source === "email" && draft.messageId != null) {
      const body = editedBody ?? draft.body
      if (!body.trim()) throw new Error("empty draft body")
      await sendEscalationDraft.mutateAsync({ messageId: draft.messageId, body })
      return
    }
    if (draft.source === "inquiry" && draft.taskId != null) {
      // editedBody present → rebuild payload (buildInquiryEditedPayload throws on
      // empty body / bad payload, so an edit is never silently dropped and the
      // original 碰錢碰法律 draft is never sent in place of Jeff's correction).
      const editedPayload =
        editedBody != null
          ? buildInquiryEditedPayload(draft.payload, editedBody)
          : undefined
      await approveInquiryDraft.mutateAsync({ id: draft.taskId, editedPayload })
    }
  }

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
          needsFollowup: u.needsFollowup,
        },
        tagLabels,
        formatDate,
      ),
    )

    const guests = (guestListQ.data ?? []).map((g) => {
      const avatar = deriveAvatar(g.profileId)
      const emailName = g.email?.split("@")[0] ?? ""
      const phone = g.phone ?? ""
      const name =
        g.name?.trim() || emailName || phone || t("admin.customers.unnamed")
      return {
        id: g.profileId,
        kind: "guest" as const,
        name,
        email: g.email ?? "",
        phone,
        initials: deriveInitials(g.name ?? null, g.email || phone || "?"),
        ...avatar,
        lastContact: g.updatedAt ? formatDate(new Date(g.updatedAt)) : "",
        tag: "inquiry" as const,
        tagLabel: tagLabels.inquiry ?? "",
        notifs: 0,
        blocked: g.blocked ?? false,
        needsFollowup: g.needsFollowup ?? false,
      }
    })

    return [...users, ...guests]
  }, [customerListQ.data, guestListQ.data, language])

  const detail = useMemo<AdaptedCustomer | null>(() => {
    if (selected === null) return null

    // Documents (文件 tab) come from the dedicated customerDocs query, mapped to
    // the UI Doc shape. Same list for guest + registered, keyed by selection.
    const rawDocs = (selected.kind === "guest" ? guestDocsQ.data : userDocsQ.data) ?? []
    const docs: Doc[] = rawDocs.map((d) => ({
      id: d.id,
      kind: d.kind,
      name: d.name,
      url: d.url,
      meta: d.meta,
      date: formatDate(new Date(d.createdAt)),
    }))

    // Pending AI reply drafts (both stores), mapped to the UI Draft shape.
    const rawDrafts = (selected.kind === "guest" ? guestDraftsQ.data : userDraftsQ.data) ?? []
    const drafts: Draft[] = rawDrafts.map((d) => ({
      id: d.id,
      source: d.source,
      type: d.kind,
      to: d.to,
      subject: d.subject,
      attachments: d.attachments,
      body: d.body,
      sensitive: d.sensitive,
      taskId: d.taskId,
      messageId: d.messageId,
      payload: d.payload,
    }))

    // Last contact = newest message in the merged conversation thread (either
    // side), which mergeThread returns oldest→newest.
    const msgs = chatQ.data?.messages ?? []
    const lastContactAt = msgs.length ? msgs[msgs.length - 1].createdAt : null

    // Guest: build the detail from inquiries (no user row exists). A manual
    // phone-only customer has no email, so we key on identity from the profile
    // row itself, not email.
    if (selected.kind === "guest") {
      const g = guestOpenItemsQ.data
      if (!g) return null
      const followup = deriveFollowup(
        {
          lastContactAt,
          openInquiries: g.inquiries.map((i) => ({
            handled: !OPEN_INQUIRY_STATUSES.has(i.status),
            createdAt: i.createdAt,
          })),
          sentQuotes: [],
        },
        Date.now(),
      )
      return {
        ...guestToAdaptedCustomer(
          {
            profileId: selected.id,
            name: g.name,
            email: g.email,
            phone: g.phone,
            source: g.source,
            hasPassport: g.hasPassport,
            inquiries: g.inquiries.map((i) => ({
              id: i.id,
              subject: i.subject,
              status: i.status,
              createdAt: i.createdAt,
            })),
          },
          t,
        ),
        docs,
        followup,
        drafts,
      }
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
      profileQ.data?.hasPassport ?? false,
    )
    const orders = toOrders(d.recentBookings)
    const timeline = toTimeline(
      d.recentBookings,
      d.recentInquiries,
      d.recentPoints,
    )
    const followup = deriveFollowup(
      {
        lastContactAt,
        openInquiries: (openItemsQ.data?.openInquiries ?? []).map((q) => ({
          handled: q.handled,
          createdAt: q.createdAt,
        })),
        sentQuotes: (d.recentQuotes ?? []).map((q) => ({
          status: q.status,
          createdAt: q.createdAt,
        })),
      },
      Date.now(),
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
      followup,
      status,
      drafts,
      profile,
      orders,
      docs,
      timeline,
    }
  }, [
    selected,
    detailQ.data,
    openItemsQ.data,
    profileQ.data,
    guestOpenItemsQ.data,
    userDocsQ.data,
    guestDocsQ.data,
    userDraftsQ.data,
    guestDraftsQ.data,
    chatQ.data,
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
    createManualCustomer: createManualCustomer.mutateAsync,
    isCreating: createManualCustomer.isPending,
    approveDraft,
    isApprovingDraft: approveInquiryDraft.isPending || sendEscalationDraft.isPending,
  }
}
