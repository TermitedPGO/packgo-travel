// Shared helpers for the 訂製單 (custom-orders) UI. Pure — no JSX.

import type { AdaptedCustomer } from "./types"

/** Customer-page selection → router input (userId for members, profileId for guests). */
export function toSelection(c: AdaptedCustomer): { userId: number } | { profileId: number } {
  return c.kind === "user" ? { userId: c.id } : { profileId: c.id }
}

/** customer-projects (0105) — 總類 keys. Label via
 *  t(`admin.customers.projects.category.${key}`). varchar on the server so new
 *  keys只要在這裡 + i18n 加,免 migration. */
export const PROJECT_CATEGORY_KEYS = ["flight", "quote", "visa", "general"] as const
export type ProjectCategory = (typeof PROJECT_CATEGORY_KEYS)[number]

/** Currency symbol — USD for direct customers; never bare $ for TWD. */
export function currencySymbol(currency?: string | null): string {
  const c = (currency || "USD").toUpperCase()
  if (c === "USD") return "$"
  if (c === "TWD") return "NT$"
  return `${c} `
}

/** Format a decimal-string / number amount, or em-dash-free placeholder. */
export function fmtMoney(amount: string | number | null | undefined, currency?: string | null): string {
  if (amount == null || amount === "") return "·"
  const n = typeof amount === "string" ? Number(amount) : amount
  if (!Number.isFinite(n)) return "·"
  const body = Number.isInteger(n)
    ? n.toLocaleString()
    : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${currencySymbol(currency)}${body}`
}

export const num = (s: string | number | null | undefined): number | null => {
  if (s == null || s === "") return null
  const n = typeof s === "string" ? Number(s) : s
  return Number.isFinite(n) ? n : null
}

/** Suggested deposit = 30% of total (decision A); whole-dollar rounded. */
export function suggestedDeposit(total: number | null): number | null {
  if (total == null) return null
  return Math.round(total * 0.3)
}

/** Short YYYY-MM-DD from a Date or ISO string. */
export function shortDate(d: string | Date | null | undefined): string {
  if (!d) return ""
  const dt = typeof d === "string" ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) return typeof d === "string" ? d : ""
  return dt.toISOString().slice(0, 10)
}

/** Today's calendar date in the LOCAL timezone as YYYY-MM-DD (no UTC rollover). */
export function todayLocal(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

/** Parse a YYYY-MM-DD input as LOCAL noon so the stored instant keeps its day. */
export function localDateAtNoon(ymd: string): Date {
  return new Date(`${ymd}T12:00:00`)
}

/**
 * Upload a PDF File to R2 via a presigned PUT and return the durable read URL.
 * `presign` is the createPdfUpload mutation's mutateAsync. Shared by the order
 * detail (attach to existing order) and the new-order form (create + attach).
 */
export async function uploadPdfViaPresign(
  presign: (args: {
    orderId: number
    kind: "quote" | "confirmation"
    filename: string
    size: number
  }) => Promise<{ putUrl: string; fileUrl: string }>,
  orderId: number,
  kind: "quote" | "confirmation",
  file: File,
): Promise<string> {
  const { putUrl, fileUrl } = await presign({
    orderId,
    kind,
    filename: file.name,
    size: file.size,
  })
  const put = await fetch(putUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body: file,
  })
  if (!put.ok) throw new Error(`R2 PUT ${put.status}`)
  return fileUrl
}
