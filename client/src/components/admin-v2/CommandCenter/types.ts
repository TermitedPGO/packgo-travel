/**
 * Shared client-side types for the 指揮中心 審核箱 (S-4).
 *
 * Mirrors the server enums in server/_core/approvalTasks.ts. Kept as a small
 * local type so the UI doesn't import server modules; the tRPC layer validates
 * the real shapes at the boundary.
 */

export type ApprovalLane = "cs" | "quote" | "marketing" | "finance";

export type RiskLevel = "auto" | "review" | "hard_gate";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "sent"
  | "failed"
  | "expired";

/** One row as returned by commandCenter.list. */
export interface ApprovalTaskRow {
  id: number;
  lane: ApprovalLane;
  taskType: string;
  riskLevel: RiskLevel;
  status: ApprovalStatus;
  title: string;
  summary: string | null;
  payload: string;
  relatedType: string | null;
  relatedId: string | null;
  createdBy: string;
  decidedBy: number | null;
  decidedAt: string | Date | null;
  errorMessage: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}
