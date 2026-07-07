import { useEffect, useMemo } from "react"
import { toast } from "sonner"
import { trpc } from "@/lib/trpc"
import { useLocale } from "@/contexts/LocaleContext"
import type { ListItem, AdaptedCustomer, ChatMessage, AiChatMessage, Doc, Draft, Project } from "./types"
import { stripQuotedReply } from "./conversationText"
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
  buildEscalationReplyInput,
  escalationSendFailure,
  inquiryApproveFailure,
  DraftSendFailedError,
  OPEN_INQUIRY_STATUSES,
  formatMonthDayLA,
} from "./adapters"

/** Which row is selected — id alone is ambiguous (a profileId can collide with a
 *  userId), so kind decides which routes to hit and how to read the id. */
export type Selection = { id: number; kind: "user" | "guest" }

export function useCustomerData(
  selected: Selection | null,
  showHidden = false,
  // customer-projects (0104) — the active project (=customOrder) scopes the AI
  // chat thread. null =「未分類」basket (customOrderId IS NULL). The real
  // conversation thread (Overview / 真相條 / followup) stays customer-wide.
  activeProjectId: number | null = null,
) {
  const { t, language } = useLocale()
  const utils = trpc.useUtils()
  // 列表日期一律以美西曆日渲染(不吃瀏覽器本機時區),見 formatMonthDayLA。
  const formatDate = (d: Date) => formatMonthDayLA(d)

  const tagLabels: Record<string, string> = {
    active: t("admin.customers.tagActive"),
    inquiry: t("admin.customers.tagInquiry"),
    pending: t("admin.customers.tagPending"),
  }

  // customer-unread — 60s refetch so a customer message lights the red dot
  // without F5 (Jeff:「每當客人來訊息 我還沒看到明顯得notification」).
  const customerListQ = trpc.admin.customerList.useQuery(
    { includeHidden: showHidden },
    { refetchInterval: 60_000 },
  )
  const guestListQ = trpc.admin.guestList.useQuery(
    { includeHidden: showHidden },
    { refetchInterval: 60_000 },
  )

  const invalidateLists = () => {
    void utils.admin.customerList.invalidate()
    void utils.admin.guestList.invalidate()
  }
  const markNotCustomer = trpc.admin.markNotCustomer.useMutation({ onSuccess: invalidateLists })
  const restoreCustomer = trpc.admin.restoreCustomer.useMutation({ onSuccess: invalidateLists })

  // customer-unread — opening a customer marks them seen (jeffViewedAt=NOW).
  // Optimistically clear that row's unread flag so the dot dies on click, not
  // on the next refetch; the rail badge recount follows the server truth.
  const markSeen = trpc.admin.markCustomerSeen.useMutation({
    onSuccess: () => void utils.admin.customerUnreadCount.invalidate(),
  })
  const markSeenMutate = markSeen.mutate
  useEffect(() => {
    if (!selected) return
    const input = { includeHidden: showHidden }
    if (selected.kind === "user") {
      utils.admin.customerList.setData(input, (old) =>
        old?.map((r) => (r.id === selected.id ? { ...r, unreadInbound: false } : r)),
      )
      markSeenMutate({ userId: selected.id })
    } else {
      utils.admin.guestList.setData(input, (old) =>
        old?.map((r) => (r.profileId === selected.id ? { ...r, unreadInbound: false } : r)),
      )
      markSeenMutate({ profileId: selected.id })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.kind])

  // 訪客刪除 (Jeff:「不只是隱藏 也可以選擇刪除」) — guests only; the server
  // refuses registered accounts and anyone with orders/spend (hide instead).
  const deleteGuestCustomer = trpc.admin.deleteGuestCustomer.useMutation({
    onSuccess: () => {
      invalidateLists()
      void utils.admin.customerUnreadCount.invalidate()
    },
    // The server gate speaks the honest reason (registered account / has
    // orders or spend → hide instead) — surface it, never fail silently.
    onError: (err) =>
      toast.error(err.message || t("admin.customers.deleteConfirm.failed")),
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
  // limit 200 (server max) — the default 50 truncated long histories, so the
  // detail thread looked like it "didn't read all the messages". 200 covers the
  // full conversation for virtually every customer.
  const userChatQ = trpc.admin.customerConversationThread.useQuery(
    { userId: userId!, limit: 200 },
    { enabled: userId !== null },
  )
  const guestChatQ = trpc.admin.customerConversationThread.useQuery(
    { profileId: profileId!, limit: 200 },
    { enabled: profileId !== null },
  )
  const chatQ = selected?.kind === "guest" ? guestChatQ : userChatQ

  // Jeff ↔ AI ops-agent chat (distinct from customer conversation thread above).
  // customer-projects (0104) — scoped to the active project; orderId omitted →
  // the「未分類」basket (customOrderId IS NULL).
  const orderId = activeProjectId ?? undefined
  const userAiChatQ = trpc.admin.customerChatList.useQuery(
    { userId: userId!, limit: 200, orderId },
    { enabled: userId !== null },
  )
  const guestAiChatQ = trpc.admin.customerChatList.useQuery(
    { profileId: profileId!, limit: 200, orderId },
    { enabled: profileId !== null },
  )
  const aiChatQ = selected?.kind === "guest" ? guestAiChatQ : userAiChatQ

  // customer-projects (0104) — this customer's projects (=customOrders) for the
  // ProjectBar. Newest first (server orders createdAt desc).
  const projectsQ = trpc.customerOrders.listForCustomer.useQuery(
    userId !== null ? { userId } : { profileId: profileId! },
    { enabled: selected !== null },
  )

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
  // 2026-07-02 — invalidation moved INTO approveDraft, success-only: both
  // mutations resolve HTTP 200 even when the send FAILED ({sent:false} /
  // {status:"failed"}), and refetching drafts on a failed send could drop the
  // card Jeff still needs to retry from.
  const invalidateDrafts = () => {
    void utils.admin.customerDrafts.invalidate()
    void utils.admin.customerConversationThread.invalidate()
  }
  const approveInquiryDraft = trpc.commandCenter.approve.useMutation()
  const sendEscalationDraft = trpc.commandCenter.escalationReply.useMutation()

  /** Approve+send one draft. editedBody (optional) = Jeff's inline edit.
   *  THROWS DraftSendFailedError on a resolved-but-failed send (the server
   *  answers 200 with an honest errorMessage; prod 實錄:回信炸
   *  "Requested entity was not found" 而 UI 靜默) — the caller shows it. */
  const approveDraft = async (draft: Draft, editedBody?: string) => {
    if (draft.source === "email" && draft.messageId != null) {
      // buildEscalationReplyInput throws on empty body and carries the draft's
      // attachments in the server zod shape ({key, filename}[]) — the card's
      // chips and what actually goes out must be the same files, never a
      // silent body-only send.
      const res = await sendEscalationDraft.mutateAsync(
        buildEscalationReplyInput(draft, editedBody),
      )
      const failure = escalationSendFailure(res)
      if (failure) throw new DraftSendFailedError(failure)
      invalidateDrafts()
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
      const res = await approveInquiryDraft.mutateAsync({
        id: draft.taskId,
        editedPayload,
      })
      const failure = inquiryApproveFailure(res)
      if (failure) throw new DraftSendFailedError(failure)
      invalidateDrafts()
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
          lastContactAt: u.lastContactAt,
          blocked: u.blocked,
          needsFollowup: u.needsFollowup,
          unread: u.unread,
          unreadInbound: u.unreadInbound,
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
        // A2 (Phase6; v787 回爐) — guestList 的 lastContactAt 現在由 server 端
        // computeLastContactAt 算(inbound / outbound 取較新者,兩者皆空才落
        // createdAt,絕不 updatedAt — updatedAt 被 02:00 cron 的 onUpdateNow 蓋章),
        // 且已在 server 錨成 UTC 真 Date,與 registered rows 完全同一口徑;client
        // 只要以美西曆日渲染(formatMonthDayLA)。
        lastContact: g.lastContactAt ? formatDate(new Date(g.lastContactAt)) : "",
        tag: "inquiry" as const,
        tagLabel: tagLabels.inquiry ?? "",
        notifs: g.unread ?? 0,
        unread: g.unreadInbound ?? false,
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
      customOrderId: d.customOrderId ?? null,
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
          followUpDate: g.followUpDate ?? null,
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
        followUpDate: d.followUpDate ?? null,
        // 批十二-5:我方最近一筆外寄(profile 級)—— 已回的 open 詢問不再算逾期未回。
        lastOutboundAt: openItemsQ.data?.lastOutboundAt ?? null,
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

  // Jeff ↔ AI ops chat (for CustomerChat panel)
  const chatMessages = useMemo<AiChatMessage[]>(() => {
    return (aiChatQ.data ?? []).map((m) => ({
      id: String(m.id),
      senderRole: m.senderRole,
      body: m.body,
      context: m.context,
      createdAt: new Date(m.createdAt),
    }))
  }, [aiChatQ.data])

  // Real customer conversation thread (for CustomerDetail 最近對話 + ball-in-court)
  const conversationMessages = useMemo<ChatMessage[]>(() => {
    return (chatQ.data?.messages ?? []).map((m) => ({
      id: m.id,
      senderRole: m.senderRole,
      body: stripQuotedReply(m.body),
      context: m.context,
      createdAt: new Date(m.createdAt),
    }))
  }, [chatQ.data])

  // customer-projects (0104) — lean projection for the ProjectBar.
  const projects = useMemo<Project[]>(
    () =>
      (projectsQ.data ?? []).map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        title: o.title,
        category: o.category,
        status: o.status,
        departureDate: o.departureDate,
      })),
    [projectsQ.data],
  )

  const isDetailLoading =
    selected?.kind === "guest" ? guestOpenItemsQ.isLoading : detailQ.isLoading

  return {
    customers,
    isListLoading: customerListQ.isLoading || guestListQ.isLoading,
    detail,
    isDetailLoading,
    projects,
    chatMessages,
    conversationMessages,
    isChatLoading: aiChatQ.isLoading,
    markNotCustomer: (item: Selection) =>
      markNotCustomer.mutate(
        item.kind === "guest" ? { profileId: item.id } : { userId: item.id },
      ),
    restoreCustomer: (item: Selection) =>
      restoreCustomer.mutate(
        item.kind === "guest" ? { profileId: item.id } : { userId: item.id },
      ),
    deleteGuest: (profileId: number) =>
      deleteGuestCustomer.mutate({ profileId }),
    approveDraft,
    isApprovingDraft: approveInquiryDraft.isPending || sendEscalationDraft.isPending,
  }
}
