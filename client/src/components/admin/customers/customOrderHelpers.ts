// Shared helpers for the 訂製單 (custom-orders) UI. Pure — no JSX.

import type { AdaptedCustomer } from "./types"

/** Customer-page selection → router input (userId for members, profileId for guests). */
export function toSelection(c: AdaptedCustomer): { userId: number } | { profileId: number } {
  return c.kind === "user" ? { userId: c.id } : { profileId: c.id }
}

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
