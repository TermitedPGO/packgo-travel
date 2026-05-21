/**
 * Round 81 — Autonomous AI Agents foundation.
 *
 * tRPC endpoints for the Layer 0 (outcome tracking) + Layer 1 (customer
 * memory) infrastructure. Each individual agent (Inquiry / Review /
 * Marketing / Followup / Refund) reads + writes through this router so
 * we have a single point of audit + access control.
 *
 * v2 Wave 2 Module 2.10 (2026-05-21): 2,804-LOC monolith split into
 * ten domain sub-routers under `./agent/`. This file is now a thin
 * composition shell that spreads each sub-router's procedures back
 * under the `agent` namespace, so external `trpc.agent.<name>` paths
 * stay byte-identical to the pre-split surface.
 *
 * Sub-routers (50 procedures total):
 *   - profiles  (5) — customer profile + interaction logging
 *   - outcomes  (4) — Layer-0 outcome tracking + snapshot
 *   - policy    (8) — policy versioning, auto-send threshold, proposal lifecycle
 *   - office    (5) — Jeff's office dashboard (pending / activity / metrics / ack)
 *   - overview  (1) — global office-overview tree (autonomous + tooling)
 *   - demo      (5) — Layer-2 demo-mode entry points for all five agents
 *   - inbox     (4) — central agentMessages inbox: list / unread / reply / post
 *   - chat      (8) — #全體 channel + per-agent DMs + sendToAgent
 *   - reports   (2) — requestAgentReport / requestAllAgentReports
 *   - ops       (3) — OpsAgent natural-language queries + retrospective
 *   - gmail     (5) — Gmail OAuth + pipeline runner
 *
 * Shared helpers (AGENT_NAMES, ensurePolicy, ensureCustomerByEmail) live in
 * `./agent/_shared.ts`.
 */

import { router } from "../_core/trpc";
import { profilesRouter } from "./agent/profiles";
import { outcomesRouter } from "./agent/outcomes";
import { policyRouter } from "./agent/policy";
import { officeRouter } from "./agent/office";
import { overviewRouter } from "./agent/overview";
import { demoRouter } from "./agent/demo";
import { inboxRouter } from "./agent/inbox";
import { chatRouter } from "./agent/chat";
import { reportsRouter } from "./agent/reports";
import { opsRouter } from "./agent/ops";
import { gmailRouter } from "./agent/gmail";

// Compose all sub-router procedures back under the `agent` namespace.
// Spread merges each sub-router's procedure map so that the existing
// `trpc.agent.<procedureName>` client paths resolve identically.
export const agentRouter = router({
  ...profilesRouter._def.procedures,
  ...outcomesRouter._def.procedures,
  ...policyRouter._def.procedures,
  ...officeRouter._def.procedures,
  ...overviewRouter._def.procedures,
  ...demoRouter._def.procedures,
  ...inboxRouter._def.procedures,
  ...chatRouter._def.procedures,
  ...reportsRouter._def.procedures,
  ...opsRouter._def.procedures,
  ...gmailRouter._def.procedures,
});
