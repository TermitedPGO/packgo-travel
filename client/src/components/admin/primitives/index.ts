/**
 * PACK&GO Admin Design System — primitives barrel.
 *
 * North star: high information density + minimal visual chrome.
 * Reference apps: Linear, Cron, GitHub Issues.
 *
 * Every admin page should be built from these primitives. Adding a new
 * page-level component? Check whether one of these covers the case first.
 *
 * Design rules codified in:
 *   ~/.claude/projects/-Users-jeff-Desktop---/memory/feedback_admin_design_system.md
 */

export { TopBar } from "./TopBar";
export { DomainSidebar, type Domain } from "./DomainSidebar";
export { DomainSubNav, type SubNavItem } from "./DomainSubNav";
export { PageHeader } from "./PageHeader";
export { KPIStrip, type KPI } from "./KPIStrip";
export { DataTable, type Column } from "./DataTable";
export { StatusDot, type StatusTone } from "./StatusDot";
export { EmptyState } from "./EmptyState";
export { CommandPalette } from "./CommandPalette";
export { FilterChip } from "./FilterChip";
