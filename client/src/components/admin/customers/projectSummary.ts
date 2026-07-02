// Per-project deterministic 摘要三行 for the 概覽 tab (customer-projects).
//
// When a ProjectBar chip is active, the AI 摘要 block shows THAT project's
// 客人要什麼 / 做了什麼 / 給了什麼 instead of the whole-customer LLM blend. Every
// line here is 100% 搬運 from the order row + its filed docs (both already loaded
// in OverviewTab) — no LLM, no server round-trip — so it can never fabricate
// (Jeff 憲法: AI 出手處資訊 100% 正確,搬運不生成). Mirrors the server
// deriveActions / deriveDelivered wording but scoped to ONE order, client-side.
//
// Pure + unit-tested. The JSX localizes the returned keys + formats the raw
// timestamps (the deriveBallInCourt / deriveNextMove pattern), so no Chinese and
// no date-format choice is baked in here.

/** The five lifecycle stamps we can read straight off a customOrders row. */
export interface ProjectOrderFacts {
  quoteSentAt: string | Date | null
  collectionSentAt: string | Date | null
  depositPaidAt: string | Date | null
  balancePaidAt: string | Date | null
  confirmedAt: string | Date | null
}

export type ProjActionKey =
  | "quoteSent"
  | "collectionSent"
  | "depositPaid"
  | "balancePaid"
  | "confirmed"

export interface ProjAction {
  key: ProjActionKey
  at: string | Date
}

/**
 * 做了什麼 — the action verbs that actually happened on THIS order, in lifecycle
 * order, each carrying its real timestamp. Only pushes on a truthy stamp, so it
 * can never claim an action that did not happen (寄報價 / 收訂金 / 出確認書 are
 * all authoritative state-machine timestamps).
 */
export function deriveProjectActions(o: ProjectOrderFacts): ProjAction[] {
  const out: ProjAction[] = []
  if (o.quoteSentAt) out.push({ key: "quoteSent", at: o.quoteSentAt })
  if (o.collectionSentAt) out.push({ key: "collectionSent", at: o.collectionSentAt })
  if (o.depositPaidAt) out.push({ key: "depositPaid", at: o.depositPaidAt })
  if (o.balancePaidAt) out.push({ key: "balancePaid", at: o.balancePaidAt })
  if (o.confirmedAt) out.push({ key: "confirmed", at: o.confirmedAt })
  return out
}

export type ProjDeliveredKey = "quote" | "confirm"

export interface ProjDelivered {
  key: ProjDeliveredKey
  at: string | Date
}

/**
 * 給了什麼 (order-derived half) — the concrete outputs this order produced:
 * 報價 when quoteSentAt, 確認書 when confirmedAt. The filed-doc NAMES are appended
 * by projectDeliveredDocNames (kept separate so this stays a pure order deriver).
 */
export function deriveProjectDelivered(o: ProjectOrderFacts): ProjDelivered[] {
  const out: ProjDelivered[] = []
  if (o.quoteSentAt) out.push({ key: "quote", at: o.quoteSentAt })
  if (o.confirmedAt) out.push({ key: "confirm", at: o.confirmedAt })
  return out
}

/**
 * 誤讀防護 — which summary the 概覽 tab may show for the active ProjectBar chip.
 *
 *   none     — no chip → whole-customer LLM blend, no caption needed.
 *   project  — the order row loaded → THIS project's deterministic 摘要三行.
 *   loading  — chip active but the order hasn't arrived yet → skeleton. The
 *              whole-customer text must NOT render here: unlabeled, it would
 *              impersonate the project for a frame (or seconds on a slow net).
 *   fallback — chip active but the query settled without an order (failed /
 *              deleted) → whole-customer text is allowed ONLY with an explicit
 *              整體 caption (summary.overallCaption), never unlabeled.
 *
 * Pure so the "silently 退回整戶內容" bug class is unit-tested, not buried in JSX.
 */
export type ProjectSummaryState = "none" | "project" | "loading" | "fallback"

export function deriveProjectSummaryState(s: {
  activeProjectId: number | null
  hasOrder: boolean
  isFetching: boolean
}): ProjectSummaryState {
  if (s.activeProjectId == null) return "none"
  if (s.hasOrder) return "project"
  return s.isFetching ? "loading" : "fallback"
}

/**
 * order-ai-understanding (0107) — which AI 客人理解 card the 概覽 tab may show.
 * Jeff:「AI 客人理解 每一個專案都應該是專門的 太多會太亂」。
 *
 *   profile — no chip → the whole-customer LearnedPreferencesSection (only then).
 *   loading — chip active but the order row hasn't arrived → skeleton. The
 *             whole-customer card must NOT render here (would impersonate the
 *             project, same bug class as deriveProjectSummaryState).
 *   hidden  — chip active but the query settled without an order (failed /
 *             deleted) → render nothing (no order row = nothing to analyze,
 *             and the profile card is not allowed while a chip is active).
 *   cached  — order loaded and it HAS a stored aiUnderstanding → show it +
 *             generated-at caption + 重新分析.
 *   empty   — order loaded, no stored understanding → honest empty state +
 *             重新分析 button. NEVER auto-computes (no silent LLM spend).
 *
 * Pure so the render decision is unit-tested, not buried in JSX.
 */
export type OrderUnderstandingState =
  | "profile"
  | "loading"
  | "hidden"
  | "cached"
  | "empty"

export function deriveOrderUnderstandingState(s: {
  activeProjectId: number | null
  hasOrder: boolean
  isFetching: boolean
  aiUnderstanding: string | null
}): OrderUnderstandingState {
  if (s.activeProjectId == null) return "profile"
  if (!s.hasOrder) return s.isFetching ? "loading" : "hidden"
  return s.aiUnderstanding && s.aiUnderstanding.trim() ? "cached" : "empty"
}

/**
 * Split a stored aiUnderstanding text into narrative paragraphs + key-fact
 * bullet lines for rendering. The server stores 一段敘述 + 條列 key facts in ONE
 * TEXT column; bullets survive the sanitizer as lines starting with ・ (or the
 * raw -/• if a row predates the wash). Pure + unit-tested.
 */
export function splitOrderUnderstanding(text: string): {
  paragraphs: string[]
  facts: string[]
} {
  const paragraphs: string[] = []
  const facts: string[] = []
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^[・•-]\s*(.*)$/)
    if (m) {
      const fact = m[1].trim()
      if (fact) facts.push(fact) // a bare marker is noise, not an empty fact
      continue
    }
    paragraphs.push(line)
  }
  return { paragraphs, facts }
}

/** Doc kinds that are unambiguously things WE produced for the customer. */
const OUTBOUND_DOC_KINDS = new Set(["quote", "invoice", "confirmation", "flight"])

/**
 * 給了什麼 (doc half) — names of docs filed to THIS project that we actually gave
 * the customer. Inbound PII scans (passport / visa / insurance / medical) and
 * ambiguous generic uploads (kind="file", which is where chat_upload / email
 * attachments land) are excluded, so a customer's uploaded passport can never be
 * mislabeled「給了客人」. Quote / confirmation PDFs additionally require the
 * order's own 已寄出 stamp (quoteSentAt / confirmedAt) — a PDF Jeff uploaded but
 * has not sent yet (quotePdfUrl set, stamp still null) is NOT a delivery, and
 * without this gate the card contradicts deriveProjectDelivered / Actions right
 * above it. Pure — safety gates live here so they are unit-tested, not buried
 * in JSX.
 */
export function projectDeliveredDocNames(
  docs: { kind: string; name: string; customOrderId: number | null }[],
  projectId: number,
  order: Pick<ProjectOrderFacts, "quoteSentAt" | "confirmedAt">,
): string[] {
  return docs
    .filter((d) => {
      if ((d.customOrderId ?? null) !== projectId || !OUTBOUND_DOC_KINDS.has(d.kind)) return false
      if (d.kind === "quote") return Boolean(order.quoteSentAt)
      if (d.kind === "confirmation") return Boolean(order.confirmedAt)
      return true
    })
    .map((d) => d.name)
}
